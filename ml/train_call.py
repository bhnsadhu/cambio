"""Call models: the chance that calling Cambio now wins, one model per level.

Labels are rollout outcomes of calling now (a tie counts as a win, as in
H2). Each decision point's rollouts are kept as separate labels, so a
point with 8 rollouts weighs 8 outcomes. Candidates, compared on the
validation data only:

  gate        the frozen gate's own win belief, taken as a probability
  gate_platt  the gate's two beliefs recalibrated by logistic regression
  logistic    logistic regression on every call feature
  mlp         a small neural net on every call feature

The chosen model per level is the logistic or neural net with the lower
validation log loss. Run: python ml/train_call.py
"""
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

from common import LEVELS, MODELS, REPORTS, SEED, auroc, brier, data_version, ece, export_logistic, export_mlp, load, log_loss, predict_exported, reliability, write_json


def table(rows, level):
    own = [row for row in rows if row["type"] == "call" and row["level"] == level]
    X = np.array([row["features"] for row in own], dtype=float)
    won = np.array([[1.0 if share > 0 else 0.0 for share in row["call"]["share"]] for row in own])
    gate = np.array([[row["gate"]["winChance"], row["gate"]["nearWinChance"]] for row in own])
    return X, won, gate


def expand(X, won):
    """One sample per rollout outcome."""
    n, r = won.shape
    return np.repeat(X, r, axis=0), won.reshape(-1)


def logit(p):
    p = np.clip(p, 0.5 / 192, 1 - 0.5 / 192)
    return np.log(p / (1 - p))


def metrics(p, y):
    return {"log_loss": log_loss(p, y), "brier": brier(p, y), "ece": ece(p, y), "auroc": auroc(p, y)}


def main():
    train_manifest, train = load("train")
    val_manifest, val = load("validation")
    features = train_manifest["callFeatures"]
    assert features == val_manifest["callFeatures"]
    report = {"data": {"train": data_version(train_manifest), "validation": data_version(val_manifest)}, "levels": {}}
    charts = {}
    fixtures = {}
    for level in LEVELS:
        Xt, wt, gt = table(train, level)
        Xv, wv, gv = table(val, level)
        Xte, yte = expand(Xt, wt)
        Xve, yve = expand(Xv, wv)
        rollouts = wt.shape[1]
        gate_v = np.repeat(gv[:, 0], rollouts)
        results = {"gate": {"validation": metrics(gate_v, yve)}}

        platt = LogisticRegression(C=1e6, max_iter=5000).fit(logit(np.repeat(gt, rollouts, axis=0)), yte)
        results["gate_platt"] = {"validation": metrics(platt.predict_proba(logit(np.repeat(gv, rollouts, axis=0)))[:, 1], yve)}

        scaler = StandardScaler().fit(Xt)
        Zte, Zve = scaler.transform(Xte), scaler.transform(Xve)
        best = None
        for C in [0.01, 0.1, 1.0, 10.0]:
            model = LogisticRegression(C=C, max_iter=5000).fit(Zte, yte)
            score = log_loss(model.predict_proba(Zve)[:, 1], yve)
            if best is None or score < best[0]:
                best = (score, C, model)
        logistic = best[2]
        results["logistic"] = {"C": best[1], "validation": metrics(logistic.predict_proba(Zve)[:, 1], yve)}

        best = None
        for hidden in [(8,), (16,)]:
            for alpha in [1e-2, 1e-1, 1.0]:
                model = MLPClassifier(hidden_layer_sizes=hidden, alpha=alpha, max_iter=3000, random_state=SEED).fit(Zte, yte)
                score = log_loss(model.predict_proba(Zve)[:, 1], yve)
                if best is None or score < best[0]:
                    best = (score, hidden, alpha, model)
        mlp = best[3]
        results["mlp"] = {"hidden": list(best[1]), "alpha": best[2], "validation": metrics(mlp.predict_proba(Zve)[:, 1], yve)}

        chosen = "logistic" if results["logistic"]["validation"]["log_loss"] <= results["mlp"]["validation"]["log_loss"] else "mlp"
        exported = export_logistic(scaler, logistic, features) if chosen == "logistic" else export_mlp(scaler, mlp, features, "sigmoid")
        exported = {"level": level, "target": "calling now wins", "chosen": chosen, "data": report["data"]["train"]["sha256"], **exported}
        p_val = predict_exported(exported, Xv)
        # The exported model must reproduce sklearn's own predictions.
        reference = (logistic.predict_proba(scaler.transform(Xv)) if chosen == "logistic" else mlp.predict_proba(scaler.transform(Xv)))[:, 1]
        assert np.max(np.abs(p_val - reference)) < 1e-6, np.max(np.abs(p_val - reference))
        write_json(MODELS / f"call-{level}.json", exported, compact=True)
        fixtures[level] = {"features": Xv[:16].tolist(), "predictions": reference[:16].tolist()}
        report["levels"][level] = {
            "train_points": len(Xt), "validation_points": len(Xv), "rollouts": rollouts,
            "train_win_rate": float(wt.mean()), "validation_win_rate": float(wv.mean()),
            "models": results, "chosen": chosen,
            "reliability": {"gate": reliability(gate_v, yve), "model": reliability(np.repeat(p_val, rollouts), yve)},
        }
        charts[level] = (gate_v, np.repeat(p_val, rollouts), yve)
        print(level, chosen, {name: round(r["validation"]["log_loss"], 4) for name, r in results.items()})
    write_json(REPORTS / "call-validation.json", report)
    # sklearn's own predictions on a fixed sample, which the TypeScript forward pass must match.
    write_json(MODELS / "fixtures-call.json", fixtures, compact=True)
    chart(charts)


def chart(charts):
    import matplotlib
    matplotlib.use("svg")
    import matplotlib.pyplot as plt
    plt.rcParams["svg.hashsalt"] = "cambio"
    plt.rcParams["svg.fonttype"] = "none"
    fig, axes = plt.subplots(1, 3, figsize=(10.5, 3.6), sharey=True)
    for ax, level in zip(axes, LEVELS):
        gate, model, y = charts[level]
        ax.plot([0, 1], [0, 1], color="#9aa0a6", linewidth=1)
        for name, p, color in [("Gate belief", gate, "#c2410c"), ("Call model", model, "#1d4ed8")]:
            bins = [b for b in reliability(p, y) if b["weight"] >= 30]
            ax.plot([b["mean_prediction"] for b in bins], [b["observed"] for b in bins], marker="o", color=color, label=name, linewidth=1.5)
        ax.set_title(level.capitalize())
        ax.set_xlim(0, 1)
        ax.set_ylim(0, 1)
        ax.set_xlabel("Stated chance of winning")
    axes[0].set_ylabel("Observed share of wins")
    axes[0].legend(frameon=False, loc="upper left")
    fig.suptitle("Calling now, validation rollouts (bins with at least 30 outcomes)")
    fig.tight_layout()
    REPORTS.mkdir(parents=True, exist_ok=True)
    fig.savefig(REPORTS / "call-reliability-validation.svg", metadata={"Date": None})


if __name__ == "__main__":
    main()
