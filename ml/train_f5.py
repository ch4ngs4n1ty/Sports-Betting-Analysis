"""
Train the MLB First-5-innings (F5) money line model (XGBoost multi:softprob)
and export it to JSON the zero-dependency Node server can score directly.

- Time-based split: train on earlier seasons, validate on the most recent.
- Reports validation log-loss / accuracy / home-vs-away AUC against two
  baselines (class base rate; multinomial logistic on stat diffs) so we can
  see whether the model actually adds signal.
- Exports server/data/f5_model.json: parsed trees + class mapping + a handful
  of parity samples (feature vector -> xgboost predict_proba) so the Node
  scorer can self-check train/serve agreement with no Python at runtime.

Run: python ml/train_f5.py   (after collect_mlb_f5.py)
"""
import os
import json
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import log_loss, accuracy_score, roc_auc_score
import xgboost as xgb

from f5_common import FEATURE_ORDER, CLASSES

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_CSV = os.path.join(HERE, "data", "f5_dataset.csv")
MODEL_OUT = os.path.join(HERE, "..", "server", "data", "f5_model.json")


def home_away_auc(y_true, proba):
    """AUC on home-vs-away, conditional on no tie (the bettable side)."""
    mask = y_true != 1
    if mask.sum() < 10:
        return None
    yt = (y_true[mask] == 0).astype(int)               # 1 = home leads
    ph, pa = proba[mask, 0], proba[mask, 2]
    cond = ph / np.clip(ph + pa, 1e-9, None)
    try:
        return roc_auc_score(yt, cond)
    except ValueError:
        return None


def main():
    df = pd.read_csv(DATA_CSV)
    print(f"Loaded {len(df)} rows from {DATA_CSV}")

    # Time-based split: hold out the most recent season; fall back to a
    # chronological 85/15 split if that season is too small.
    seasons = sorted(df["season"].unique())
    holdout = seasons[-1]
    val_mask = df["season"] == holdout
    if val_mask.sum() < 200:
        df = df.sort_values("date").reset_index(drop=True)
        cut = int(len(df) * 0.85)
        train_df, val_df = df.iloc[:cut], df.iloc[cut:]
        split_desc = "chronological 85/15"
    else:
        train_df, val_df = df[~val_mask], df[val_mask]
        split_desc = f"train < {holdout}, validate = {holdout}"
    print(f"Split: {split_desc}  ->  train {len(train_df)}, val {len(val_df)}")

    # Carve a chronological early-stopping slice from the END of train so the
    # held-out season stays untouched (train_df is already date-ordered).
    es_cut = int(len(train_df) * 0.88)
    fit_df, es_df = train_df.iloc[:es_cut], train_df.iloc[es_cut:]
    Xfit, yfit = fit_df[FEATURE_ORDER], fit_df["label"].to_numpy()
    Xes, yes = es_df[FEATURE_ORDER], es_df["label"].to_numpy()
    Xtr, ytr = train_df[FEATURE_ORDER], train_df["label"].to_numpy()  # for baselines
    Xva, yva = val_df[FEATURE_ORDER], val_df["label"].to_numpy()

    # ── XGBoost ───────────────────────────────────────────────
    # F5 is a low-signal target; regularize hard and early-stop to avoid the
    # variance that made the unregularized model lose to plain logistic.
    clf = xgb.XGBClassifier(
        objective="multi:softprob", num_class=3,
        n_estimators=800, max_depth=3, learning_rate=0.03,
        subsample=0.8, colsample_bytree=0.8,
        min_child_weight=12, reg_lambda=3.0, gamma=0.5,
        eval_metric="mlogloss", early_stopping_rounds=40,
        n_jobs=4, random_state=42,
    )
    clf.fit(Xfit, yfit, eval_set=[(Xes, yes)], verbose=False)
    print(f"  best_iteration={clf.best_iteration}  (of 800)")
    proba = clf.predict_proba(Xva)
    xgb_ll = log_loss(yva, proba, labels=[0, 1, 2])
    xgb_acc = accuracy_score(yva, proba.argmax(1))
    xgb_auc = home_away_auc(yva, proba)

    # ── Baseline 1: class base rate ───────────────────────────
    base_rate = np.array([(ytr == c).mean() for c in [0, 1, 2]])
    base_proba = np.tile(base_rate, (len(yva), 1))
    base_ll = log_loss(yva, base_proba, labels=[0, 1, 2])

    # ── Baseline 2: multinomial logistic on stat diffs ────────
    def diffs(X):
        return np.column_stack([
            X["home_sp_era"] - X["away_sp_era"],
            X["home_sp_whip"] - X["away_sp_whip"],
            X["home_sp_k9"] - X["away_sp_k9"],
            X["home_runs_pg"] - X["away_runs_pg"],
        ])
    sc = StandardScaler().fit(diffs(Xtr))
    lr = LogisticRegression(max_iter=1000).fit(sc.transform(diffs(Xtr)), ytr)
    lr_proba = lr.predict_proba(sc.transform(diffs(Xva)))
    # align columns to [0,1,2]
    lr_full = np.zeros((len(yva), 3))
    for j, c in enumerate(lr.classes_):
        lr_full[:, c] = lr_proba[:, j]
    lr_ll = log_loss(yva, lr_full, labels=[0, 1, 2])
    lr_auc = home_away_auc(yva, lr_full)

    print("\n=== Validation (lower log-loss = better) ===")
    print(f"  base rate        log-loss {base_ll:.4f}")
    print(f"  logistic (diffs) log-loss {lr_ll:.4f}   AUC {lr_auc}")
    print(f"  XGBoost          log-loss {xgb_ll:.4f}   acc {xgb_acc:.3f}   home/away AUC {xgb_auc}")
    verdict = "BEATS" if xgb_ll < min(base_ll, lr_ll) else "does NOT beat"
    print(f"  -> XGBoost {verdict} both baselines on held-out data")

    # ── Export trees + parity samples for the Node scorer ─────
    booster = clf.get_booster()
    # Build trees from the FULL-PRECISION native JSON (not the rounded text
    # dump, whose truncated thresholds misroute near-boundary samples). Re-emit
    # as a simple nested {split,split_condition,yes,no,missing,children,leaf}
    # so the Node scorer stays tiny. Keep only [0, best_iteration] rounds.
    nat = json.loads(bytes(booster.save_raw(raw_format="json")))
    learner = nat["learner"]
    gbm = nat["gradient_booster"] if "gradient_booster" in nat else learner["gradient_booster"]
    fnames = learner.get("feature_names") or FEATURE_ORDER
    # base_score is the per-class intercept vector (stored as a JSON-array string).
    bs_raw = learner["learner_model_param"].get("base_score", "0.5")
    try:
        base_from_param = [float(x) for x in json.loads(bs_raw)]
    except Exception:
        base_from_param = None
    nat_trees = gbm["model"]["trees"]
    n_keep = (clf.best_iteration + 1) * 3

    def to_nested(t):
        L, R = t["left_children"], t["right_children"]
        SI, SC, DL = t["split_indices"], t["split_conditions"], t["default_left"]

        def node(i):
            if L[i] == -1:                      # leaf: split_conditions holds the leaf weight
                return {"nodeid": i, "leaf": float(SC[i])}
            n = {"nodeid": i, "split": fnames[SI[i]], "split_condition": float(SC[i]),
                 "yes": int(L[i]), "no": int(R[i]), "missing": int(L[i] if DL[i] else R[i])}
            n["children"] = [node(L[i]), node(R[i])]
            return n
        return node(0)

    trees = [to_nested(nat_trees[i]) for i in range(min(n_keep, len(nat_trees)))]

    # Recover the per-class base margin (intercept) empirically so the Node
    # scorer reproduces predict_proba exactly: base = raw_margin − Σ leaves.
    def tree_only_margins(feat):
        marg = [0.0, 0.0, 0.0]
        for i, t in enumerate(trees):
            node = t
            while "leaf" not in node:
                v = feat[node["split"]]
                go_yes = (v < node["split_condition"]) if v is not None else (node["missing"] == node["yes"])
                node = node["children"][0] if go_yes else node["children"][1]
            marg[i % 3] += node["leaf"]
        return np.array(marg)

    raw = booster.predict(xgb.DMatrix(Xva[FEATURE_ORDER]), output_margin=True)
    resid = np.array([raw[i] - tree_only_margins({k: float(Xva.iloc[i][k]) for k in FEATURE_ORDER})
                      for i in range(min(80, len(val_df)))])
    base_emp = resid.mean(axis=0)
    base_margin = np.array(base_from_param) if base_from_param is not None else base_emp
    # With full-precision trees + the parsed intercept, the empirical residual
    # (raw − Σleaves − base) should be ~0, confirming exact Node parity.
    print(f"  base_margin = {np.round(base_margin, 4)}  empirical Δ {np.abs(base_emp - base_margin).max():.2e}  resid std {resid.std(axis=0).max():.2e}")

    sample_idx = list(range(min(8, len(val_df))))
    parity = [{
        "features": {k: float(val_df.iloc[i][k]) for k in FEATURE_ORDER},
        "proba": [float(x) for x in proba[i]],
    } for i in sample_idx]

    model = {
        "objective": "multi:softprob",
        "num_class": 3,
        "classes": CLASSES,
        "feature_order": FEATURE_ORDER,
        "tree_class_mapping": "round_robin (tree_index % num_class)",
        "base_margin": [float(x) for x in base_margin],
        "trees": trees,
        "n_trees": len(trees),
        "trained_at": pd.Timestamp.now("UTC").isoformat(),
        "val": {"split": split_desc, "log_loss": xgb_ll, "accuracy": xgb_acc,
                "home_away_auc": xgb_auc, "base_rate_log_loss": base_ll,
                "logistic_log_loss": lr_ll, "n_val": int(len(val_df))},
        "parity_samples": parity,
    }
    os.makedirs(os.path.dirname(MODEL_OUT), exist_ok=True)
    with open(MODEL_OUT, "w") as f:
        json.dump(model, f)
    print(f"\nWrote model ({len(trees)} trees) -> {MODEL_OUT}")


if __name__ == "__main__":
    main()
