"""Action models: the value of each candidate move, one model per level.

Each decision point offers up to six candidates, each valued by rollouts.
A model predicts a candidate's advantage: its value minus the average
value of the candidates at the same point, so it learns what separates
moves rather than how good the position already is. The value is the
seat's mean win share plus a small weight on its mean final margin, which
breaks the many ties in win share; the weight is chosen on validation.

Candidates, compared on the validation data only:

  rule   the frozen rule's own choice (rules_v1)
  gbdt   gradient boosted regression trees
  mlp    a small neural net

Measures: how often the top predicted move is the best move by rollout
win share (ties broken by margin), and the average win share and margin
lost against that best move. The chosen model per level has the lowest
validation win share lost. Each kind of decision then uses the model only
if the model loses less than the rule on that kind in validation, with at
least 20 validation points; otherwise that kind keeps the rule.
Run: python ml/train_action.py
"""
from collections import defaultdict

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler

from common import LEVELS, MODELS, REPORTS, SEED, data_version, export_gbdt, export_mlp, load, predict_exported, write_json

MARGIN_WEIGHTS = [0.0, 0.02, 0.05]
MIN_KIND_POINTS = 20


def points(rows, level):
    own = [row for row in rows if row["type"] == "action" and row["level"] == level and len(row["candidates"]) > 1]
    out = []
    for row in own:
        share = np.array([np.mean(c["outcome"]["share"]) for c in row["candidates"]])
        margin = np.array([np.mean(c["outcome"]["margin"]) for c in row["candidates"]])
        out.append({
            "kind": row["kind"], "X": np.array([c["features"] for c in row["candidates"]], dtype=float),
            "share": share, "margin": margin, "rule": int(np.argmax([c["rule"] for c in row["candidates"]])),
            "has_rule": any(c["rule"] for c in row["candidates"]),
        })
    return out


def flatten(pts, margin_weight):
    X = np.vstack([p["X"] for p in pts])
    y = np.concatenate([value - value.mean() for value in (p["share"] + margin_weight * p["margin"] for p in pts)])
    return X, y


def best_index(p):
    # Highest win share, then highest margin.
    return max(range(len(p["share"])), key=lambda i: (p["share"][i], p["margin"][i]))


def evaluate(pts, choose):
    by_kind = defaultdict(lambda: {"n": 0, "match": 0, "share_lost": 0.0, "margin_lost": 0.0})
    for p in pts:
        chosen, best = choose(p), best_index(p)
        for key in (p["kind"], "all"):
            k = by_kind[key]
            k["n"] += 1
            k["match"] += chosen == best
            k["share_lost"] += p["share"][best] - p["share"][chosen]
            k["margin_lost"] += p["margin"][best] - p["margin"][chosen]
    return {kind: {"points": k["n"], "top_match": k["match"] / k["n"], "share_lost": k["share_lost"] / k["n"], "margin_lost": k["margin_lost"] / k["n"]} for kind, k in sorted(by_kind.items())}


def predictor(model, scaler=None):
    def choose(p):
        X = scaler.transform(p["X"]) if scaler is not None else p["X"]
        return int(np.argmax(model.predict(X)))
    return choose


def main():
    train_manifest, train = load("train")
    val_manifest, val = load("validation")
    features = train_manifest["actionFeatures"]
    assert features == val_manifest["actionFeatures"]
    report = {"data": {"train": data_version(train_manifest), "validation": data_version(val_manifest)}, "levels": {}}
    fixtures = {}
    for level in LEVELS:
        tr, va = points(train, level), points(val, level)
        rule = evaluate(va, lambda p: p["rule"])
        tried = []
        for weight in MARGIN_WEIGHTS:
            X, y = flatten(tr, weight)
            for trees, depth in [(150, 3), (300, 3), (200, 4)]:
                model = GradientBoostingRegressor(n_estimators=trees, max_depth=depth, learning_rate=0.05, subsample=0.8, min_samples_leaf=20, random_state=SEED).fit(X, y)
                tried.append({"type": "gbdt", "margin_weight": weight, "trees": trees, "depth": depth, "model": model, "scaler": None, "validation": evaluate(va, predictor(model))})
            scaler = StandardScaler().fit(X)
            for alpha in [1e-2, 1e-1]:
                model = MLPRegressor(hidden_layer_sizes=(32,), alpha=alpha, max_iter=1000, early_stopping=True, random_state=SEED).fit(scaler.transform(X), y)
                tried.append({"type": "mlp", "margin_weight": weight, "alpha": alpha, "model": model, "scaler": scaler, "validation": evaluate(va, predictor(model, scaler))})
        chosen = min(tried, key=lambda t: (t["validation"]["all"]["share_lost"], t["validation"]["all"]["margin_lost"]))
        kinds = sorted(k for k, m in chosen["validation"].items() if k != "all" and m["points"] >= MIN_KIND_POINTS and m["share_lost"] < rule[k]["share_lost"])
        if chosen["type"] == "gbdt":
            exported = export_gbdt(chosen["model"], features)
        else:
            exported = export_mlp(chosen["scaler"], chosen["model"], features, "identity")
        exported = {"level": level, "target": f"advantage in win share plus {chosen['margin_weight']} times margin", "kinds": kinds, "data": report["data"]["train"]["sha256"], **exported}
        # The exported model must reproduce sklearn's own predictions.
        X_val = np.vstack([p["X"] for p in va])
        reference = chosen["model"].predict(chosen["scaler"].transform(X_val) if chosen["scaler"] is not None else X_val)
        assert np.max(np.abs(predict_exported(exported, X_val) - reference)) < 1e-6
        write_json(MODELS / f"action-{level}.json", exported, compact=True)
        fixtures[level] = {"features": X_val[:16].tolist(), "predictions": reference[:16].tolist()}
        report["levels"][level] = {
            "train_points": len(tr), "validation_points": len(va),
            "rule": rule,
            "tried": [{k: v for k, v in t.items() if k not in ("model", "scaler")} for t in tried],
            "chosen": {k: v for k, v in chosen.items() if k not in ("model", "scaler")},
            "model_kinds": kinds,
        }
        print(level, chosen["type"], chosen["margin_weight"], "share lost", round(chosen["validation"]["all"]["share_lost"], 4), "rule", round(rule["all"]["share_lost"], 4), "kinds", kinds)
    write_json(REPORTS / "action-validation.json", report)
    # sklearn's own predictions on a fixed sample, which the TypeScript forward pass must match.
    write_json(MODELS / "fixtures-action.json", fixtures, compact=True)


if __name__ == "__main__":
    main()
