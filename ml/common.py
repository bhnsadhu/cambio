"""Shared loading, metrics and export for the call and action models.

Every model is chosen on validation data only. Random seeds are fixed, and
each exported model records the data it was trained on (the manifest's
SHA-256), so a model can always be traced back to its data version.
"""
import hashlib
import os
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("ML_DATA", ROOT / "data"))
REPORTS = ROOT / "reports"
MODELS = ROOT.parent / "src" / "lib" / "game" / "models"
LEVELS = ["easy", "medium", "hard"]
SEED = 20261015


def load(split):
    manifest = json.loads((DATA / f"{split}.manifest.json").read_text())
    rows = [json.loads(line) for line in (DATA / f"{split}.jsonl").read_text().splitlines() if line]
    return manifest, rows


def data_version(manifest):
    return {"split": manifest["split"], "seeds": manifest["seeds"], "commit": manifest["commit"], "sha256": manifest["sha256"], "rollouts": manifest["rollouts"]}


def write_json(path, value, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, separators=(",", ":")) if compact else json.dumps(value, indent=1)
    path.write_text(text + "\n")


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def r6(x):
    """Round for export: enough precision for the TypeScript forward pass to match closely."""
    return float(f"{float(x):.10g}")


# ---------------------------------------------------------------- metrics


def log_loss(p, y, w=None):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    losses = -(y * np.log(p) + (1 - y) * np.log(1 - p))
    return float(np.average(losses, weights=w))


def brier(p, y, w=None):
    return float(np.average((p - y) ** 2, weights=w))


def ece(p, y, w=None, bins=10):
    """Expected calibration error with equal width bins, weighted by each bin's share."""
    w = np.ones_like(p) if w is None else w
    index = np.minimum((p * bins).astype(int), bins - 1)
    total = w.sum()
    error = 0.0
    for b in range(bins):
        mask = index == b
        if not mask.any():
            continue
        weight = w[mask].sum()
        error += weight / total * abs(np.average(p[mask], weights=w[mask]) - np.average(y[mask], weights=w[mask]))
    return float(error)


def auroc(p, y, w=None):
    """Area under the ROC curve, with ties counted as half, for weighted labels."""
    w = np.ones_like(p) if w is None else w
    order = np.argsort(p, kind="mergesort")
    p, y, w = p[order], y[order], w[order]
    pos = w * y
    neg = w * (1 - y)
    total_pos, total_neg = pos.sum(), neg.sum()
    if total_pos == 0 or total_neg == 0:
        return float("nan")
    area = 0.0
    neg_below = 0.0
    i = 0
    while i < len(p):
        j = i
        while j < len(p) and p[j] == p[i]:
            j += 1
        group_pos, group_neg = pos[i:j].sum(), neg[i:j].sum()
        area += group_pos * (neg_below + 0.5 * group_neg)
        neg_below += group_neg
        i = j
    return float(area / (total_pos * total_neg))


def reliability(p, y, w=None, bins=10):
    w = np.ones_like(p) if w is None else w
    index = np.minimum((p * bins).astype(int), bins - 1)
    out = []
    for b in range(bins):
        mask = index == b
        weight = float(w[mask].sum())
        out.append({
            "from": b / bins, "to": (b + 1) / bins, "weight": weight,
            "mean_prediction": float(np.average(p[mask], weights=w[mask])) if weight else None,
            "observed": float(np.average(y[mask], weights=w[mask])) if weight else None,
        })
    return out


# ---------------------------------------------------------------- export


def export_scaler(scaler):
    return {"mean": [r6(v) for v in scaler.mean_], "scale": [r6(v) for v in scaler.scale_]}


def export_logistic(scaler, model, features):
    return {"type": "logistic", "features": features, **export_scaler(scaler), "coef": [r6(v) for v in model.coef_[0]], "intercept": r6(model.intercept_[0])}


def export_mlp(scaler, model, features, output):
    layers = [{"weights": [[r6(v) for v in row] for row in w.T], "bias": [r6(v) for v in b]} for w, b in zip(model.coefs_, model.intercepts_)]
    return {"type": "mlp", "features": features, **export_scaler(scaler), "activation": model.activation, "output": output, "layers": layers}


def export_gbdt(model, features):
    trees = []
    for estimator in model.estimators_[:, 0]:
        t = estimator.tree_
        trees.append({
            "feature": [int(v) for v in t.feature],
            # Exact: sklearn compares float32 features against these thresholds.
            "threshold": [float(v) for v in t.threshold],
            "left": [int(v) for v in t.children_left],
            "right": [int(v) for v in t.children_right],
            "value": [r6(v) for v in t.value[:, 0, 0]],
        })
    init = model.init_.constant_[0][0] if hasattr(model.init_, "constant_") else 0.0
    return {"type": "gbdt", "features": features, "init": r6(init), "learningRate": r6(model.learning_rate), "trees": trees}


def predict_exported(model, X):
    """The exported model's own forward pass, the reference the TypeScript test matches."""
    X = np.asarray(X, dtype=float)
    if model["type"] == "gbdt":
        out = np.full(len(X), model["init"], dtype=float)
        X = X.astype(np.float32).astype(float)
        for tree in model["trees"]:
            for row in range(len(X)):
                node = 0
                while tree["left"][node] != -1:
                    node = tree["left"][node] if X[row, tree["feature"][node]] <= tree["threshold"][node] else tree["right"][node]
                out[row] += model["learningRate"] * tree["value"][node]
        return out
    Z = (X - np.array(model["mean"])) / np.array(model["scale"])
    if model["type"] == "logistic":
        return 1 / (1 + np.exp(-(Z @ np.array(model["coef"]) + model["intercept"])))
    h = Z
    for index, layer in enumerate(model["layers"]):
        h = h @ np.array(layer["weights"]).T + np.array(layer["bias"])
        if index < len(model["layers"]) - 1:
            h = np.maximum(h, 0) if model["activation"] == "relu" else np.tanh(h)
    h = h[:, 0]
    return 1 / (1 + np.exp(-h)) if model["output"] == "sigmoid" else h
