# F5 Money-Line Model (MLB First-5-Innings)

XGBoost model that predicts which side leads after **5 innings** (a 3-way
market: home / tie / away). Surfaced at the top of the **High Contact** tab.
First-5 is starter-dominated, which is exactly what that tab already analyzes.

You normally **never run this manually** — GitHub Actions retrains it weekly and
commits the model; Render auto-deploys. This folder is for understanding /
debugging the pipeline.

## How it flows

```
GitHub Actions (weekly cron)
  └─ python collect_mlb_f5.py   → ml/data/f5_dataset.csv  (+ server/data/f5_feature_spec.json)
  └─ python train_f5.py         → server/data/f5_model.json
  └─ git commit + push  →  Render autoDeploy  →  live High Contact tab
```

At request time the Node backend ([server/mlb/service.js](../server/mlb/service.js))
assembles the **same feature vector** for today's game and scores it with a tiny
dependency-free tree-walker (`scoreF5`). The app ships zero ML dependencies; the
Python only runs in CI.

## Data sources (MLB Stats API, public)

- **Label** — `schedule?...&hydrate=linescore`: per-inning runs, summed over the
  first 5 → `sign(home5 − away5)` = home / tie / away.
- **Features** — `people/{id}/stats?stats=gameLog&group=pitching`: per-start
  lines for leak-free, season-to-date pitcher rolling stats.

## Features (the train/serve contract)

Defined once in [f5_common.py](f5_common.py) (`FEATURE_ORDER`) and mirrored in
`server/data/f5_feature_spec.json`. Per game, entering it (strictly games before
its date — no leakage):

- each starting pitcher's season-to-date `era / whip / k9 / bb9 / hr9 /
  ip_per_start` (fallback prior season if < 3 starts, then league average)
- each team's last-15-games `runs_pg`
- `park_hr_factor`

**Label:** 0 home / 1 tie / 2 away leads after 5 innings.

## Parity (train == serve)

`train_f5.py` exports full-precision trees + the per-class base margin, plus a
handful of `parity_samples` (feature vector → XGBoost `predict_proba`). The Node
scorer must reproduce these. Check:

```bash
node -e "const {scoreF5}=require('./server/mlb/service.js');const m=require('./server/data/f5_model.json');let e=0;for(const s of m.parity_samples){const g=scoreF5(s.features);for(let i=0;i<3;i++)e=Math.max(e,Math.abs(g[i]-s.proba[i]))}console.log('max diff',e)"
```

Expect ~1e-7.

## Run locally (optional, for debugging)

```bash
python3 -m venv ml/.venv && ml/.venv/bin/pip install -r ml/requirements.txt
ml/.venv/bin/python ml/collect_mlb_f5.py   # builds dataset (caches game logs)
ml/.venv/bin/python ml/train_f5.py         # prints val metrics vs baselines, writes model
```

macOS note: XGBoost needs OpenMP — `brew install libomp`.

`F5_SEASONS=2022,2023,2024,2025,2026` overrides the default rolling 5-season
window.

## Honest notes

- 3-way market — ties are modeled as their own class.
- No sportsbook line is wired in, so we show model probability + **fair** odds,
  not true EV. Compare fair odds to the book's F5 price yourself.
- F5 is low-signal: the model beats a base-rate and a logistic baseline on the
  held-out current season, but only modestly (AUC ≈ 0.58). `train_f5.py` prints
  the comparison every run so the edge is never overstated.
