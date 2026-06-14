"""
Collect a leak-free training dataset for the MLB First-5-innings (F5) money line.

For each completed regular-season game (2021..2025):
  - LABEL  = sign(home_runs_first5 - away_runs_first5)  -> 0 home / 1 tie / 2 away
  - FEATURES (entering the game, strictly games before its date):
      each starting pitcher's season-to-date ERA/WHIP/K9/BB9/HR9/IP-per-start
      (fallback prior season, then league avg), each team's last-15 runs/game,
      and the park HR factor.

Sources (MLB Stats API, public):
  - schedule + linescore + probablePitcher : labels, team runs, SP ids, venue
  - people/{id}/stats?stats=gameLog&group=pitching : per-start lines for rolling

Outputs:
  ml/data/f5_dataset.csv
  server/data/f5_feature_spec.json   (feature order + fallbacks for the server)

Pitcher game logs are cached under ml/cache/ so reruns (and CI with actions/cache)
are fast. Run: python ml/collect_mlb_f5.py
"""
import os
import json
import csv
from collections import defaultdict
from datetime import date

from f5_common import (
    MLB_API, FEATURE_ORDER, LEAGUE_FALLBACK, PARK_HR_FACTORS,
    park_hr_factor, ip_to_outs, rate_per9, get_json,
)

# Default: the 5 most recent seasons ending with the current one (rolls
# automatically year to year). Override with F5_SEASONS="2022,2023,...".
_cur_year = date.today().year
SEASONS = ([int(s) for s in os.environ["F5_SEASONS"].split(",")]
           if os.environ.get("F5_SEASONS")
           else list(range(_cur_year - 4, _cur_year + 1)))
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(HERE, "cache")
DATA_DIR = os.path.join(HERE, "data")
SERVER_DATA = os.path.join(HERE, "..", "server", "data")
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(SERVER_DATA, exist_ok=True)

MONTH_RANGES = [(3, 1, 4, 30), (5, 1, 6, 30), (7, 1, 8, 31), (9, 1, 11, 15)]


def fetch_season_schedule(season):
    """Return list of game dicts for a season (regular season, with linescore)."""
    games = []
    for (m1, d1, m2, d2) in MONTH_RANGES:
        start = f"{season}-{m1:02d}-{d1:02d}"
        end = f"{season}-{m2:02d}-{d2:02d}"
        url = (f"{MLB_API}/schedule?sportId=1&startDate={start}&endDate={end}"
               f"&gameType=R&hydrate=linescore,probablePitcher,venue")
        data = get_json(url)
        for day in data.get("dates", []):
            for g in day.get("games", []):
                games.append(g)
    return games


def parse_game(g):
    """Extract the fields we need from a schedule game; None if unusable."""
    if g.get("gameType") != "R":
        return None
    if (g.get("status", {}).get("abstractGameState")) != "Final":
        return None
    ls = g.get("linescore", {})
    innings = ls.get("innings", [])
    if len(innings) < 5:
        return None  # suspended / shortened
    away5 = sum((i.get("away", {}).get("runs") or 0) for i in innings[:5])
    home5 = sum((i.get("home", {}).get("runs") or 0) for i in innings[:5])
    teams = g.get("teams", {})
    home, away = teams.get("home", {}), teams.get("away", {})
    home_sp = (home.get("probablePitcher") or {}).get("id")
    away_sp = (away.get("probablePitcher") or {}).get("id")
    gd = (g.get("gameDate") or "")[:10]
    if not gd or home_sp is None or away_sp is None:
        return None
    label = 0 if home5 > away5 else (2 if away5 > home5 else 1)
    return {
        "gamePk": g.get("gamePk"),
        "date": gd,
        "home_id": home.get("team", {}).get("id"),
        "away_id": away.get("team", {}).get("id"),
        "home_sp": home_sp,
        "away_sp": away_sp,
        "venue": g.get("venue", {}).get("name"),
        "home_runs": home.get("score"),
        "away_runs": away.get("score"),
        "label": label,
    }


def fetch_pitcher_log(pid, season, no_cache=False):
    """Per-start lines for a pitcher in a season.

    Past seasons are immutable -> cached to disk (and restored by CI's
    actions/cache). The live season grows week to week, so it bypasses the
    cache entirely to stay fresh on each retrain.
    """
    cache = os.path.join(CACHE_DIR, f"pitlog_{pid}_{season}.json")
    if not no_cache and os.path.exists(cache):
        with open(cache) as f:
            return json.load(f)
    url = f"{MLB_API}/people/{pid}/stats?stats=gameLog&group=pitching&season={season}"
    try:
        data = get_json(url)
    except RuntimeError:
        data = {}
    starts = []
    for s in (data.get("stats", [{}])[0].get("splits", []) if data.get("stats") else []):
        st = s.get("stat", {})
        starts.append({
            "date": s.get("date"),
            "outs": ip_to_outs(st.get("inningsPitched", 0)),
            "er": int(st.get("earnedRuns", 0) or 0),
            "h": int(st.get("hits", 0) or 0),
            "bb": int(st.get("baseOnBalls", 0) or 0),
            "k": int(st.get("strikeOuts", 0) or 0),
            "hr": int(st.get("homeRuns", 0) or 0),
            "gs": int(st.get("gamesStarted", 0) or 0),
        })
    if not no_cache:
        with open(cache, "w") as f:
            json.dump(starts, f)
    return starts


def agg_pitcher(rows):
    """Aggregate a list of start rows -> feature dict, or None if no innings."""
    outs = sum(r["outs"] for r in rows)
    if outs <= 0:
        return None
    er = sum(r["er"] for r in rows); h = sum(r["h"] for r in rows)
    bb = sum(r["bb"] for r in rows); k = sum(r["k"] for r in rows)
    hr = sum(r["hr"] for r in rows); gs = sum(r["gs"] for r in rows) or len(rows)
    ip = outs / 3.0
    return {
        "era": rate_per9(er, outs), "whip": (h + bb) / ip,
        "k9": rate_per9(k, outs), "bb9": rate_per9(bb, outs),
        "hr9": rate_per9(hr, outs), "ip_per_start": ip / gs if gs else ip,
    }


def pitcher_features(pid, gdate, logs_by_key, season, prefix):
    """Season-to-date entering gdate; fallback prior season; then league avg."""
    cur = [r for r in logs_by_key.get((pid, season), []) if r["date"] and r["date"] < gdate]
    agg = agg_pitcher(cur) if len(cur) >= 3 else None
    if agg is None:
        prev = logs_by_key.get((pid, season - 1), [])
        agg = agg_pitcher(prev)
    out = {}
    for stat in ("era", "whip", "k9", "bb9", "hr9", "ip_per_start"):
        val = agg.get(stat) if agg else None
        if val is None:
            val = LEAGUE_FALLBACK[f"sp_{stat}"]
        out[f"{prefix}_sp_{stat}"] = round(val, 4)
    return out


def team_runs_pg(team_id, gdate, team_games):
    games = [r for r in team_games.get(team_id, []) if r[0] < gdate]
    games = games[-15:]
    if not games:
        return LEAGUE_FALLBACK["runs_pg"]
    return round(sum(r[1] for r in games) / len(games), 4)


def main():
    print(f"Collecting F5 dataset for seasons {SEASONS}")
    all_games = []
    for season in SEASONS:
        raw = fetch_season_schedule(season)
        parsed = [p for p in (parse_game(g) for g in raw) if p]
        for p in parsed:
            p["season"] = season
        all_games.extend(parsed)
        print(f"  {season}: {len(parsed)} usable games")

    all_games.sort(key=lambda g: g["date"])

    # Global per-team chronological runs (crosses seasons for early-season form).
    team_games = defaultdict(list)
    for g in all_games:
        if g["home_runs"] is not None:
            team_games[g["home_id"]].append((g["date"], g["home_runs"]))
        if g["away_runs"] is not None:
            team_games[g["away_id"]].append((g["date"], g["away_runs"]))
    for tid in team_games:
        team_games[tid].sort(key=lambda r: r[0])

    # Fetch every starter's gamelog for its season AND prior season (cached).
    needed = set()
    for g in all_games:
        for pid in (g["home_sp"], g["away_sp"]):
            needed.add((pid, g["season"]))
            needed.add((pid, g["season"] - 1))
    live_season = max(SEASONS)  # grows week to week -> never cache it
    print(f"Fetching {len(needed)} pitcher-season game logs (live season {live_season} always refetched)...")
    logs_by_key = {}
    for i, (pid, season) in enumerate(sorted(needed)):
        logs_by_key[(pid, season)] = fetch_pitcher_log(pid, season, no_cache=(season == live_season))
        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{len(needed)}")

    # Build feature rows.
    rows = []
    for g in all_games:
        feat = {}
        feat.update(pitcher_features(g["home_sp"], g["date"], logs_by_key, g["season"], "home"))
        feat.update(pitcher_features(g["away_sp"], g["date"], logs_by_key, g["season"], "away"))
        feat["home_runs_pg"] = team_runs_pg(g["home_id"], g["date"], team_games)
        feat["away_runs_pg"] = team_runs_pg(g["away_id"], g["date"], team_games)
        feat["park_hr_factor"] = park_hr_factor(g["venue"]) or LEAGUE_FALLBACK["park_hr_factor"]
        feat["label"] = g["label"]
        feat["season"] = g["season"]
        feat["date"] = g["date"]
        feat["gamePk"] = g["gamePk"]
        rows.append(feat)

    out_csv = os.path.join(DATA_DIR, "f5_dataset.csv")
    cols = FEATURE_ORDER + ["label", "season", "date", "gamePk"]
    with open(out_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)

    # Class balance
    bal = defaultdict(int)
    for r in rows:
        bal[r["label"]] += 1
    n = len(rows) or 1
    print(f"\nWrote {len(rows)} rows -> {out_csv}")
    print(f"Class balance: home={bal[0]} ({bal[0]/n:.1%})  tie={bal[1]} ({bal[1]/n:.1%})  away={bal[2]} ({bal[2]/n:.1%})")

    # Feature spec for the server (parity contract).
    spec = {
        "feature_order": FEATURE_ORDER,
        "classes": ["home", "tie", "away"],
        "league_fallback": LEAGUE_FALLBACK,
        "park_hr_factors": [[p, fct] for (p, fct) in PARK_HR_FACTORS],
        "built_at": date.today().isoformat(),
        "seasons": SEASONS,
    }
    spec_path = os.path.join(SERVER_DATA, "f5_feature_spec.json")
    with open(spec_path, "w") as f:
        json.dump(spec, f, indent=2)
    print(f"Wrote feature spec -> {spec_path}")


if __name__ == "__main__":
    main()
