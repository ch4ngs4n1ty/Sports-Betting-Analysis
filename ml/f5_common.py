"""
Shared constants + helpers for the MLB First-5-innings (F5) model pipeline.

Kept in one place so the collector and trainer agree on the feature contract,
and so the exact same park table / fallback constants can be exported to the
Node server (server/data/f5_feature_spec.json) for train/serve parity.
"""
import re
import time
import requests

MLB_API = "https://statsapi.mlb.com/api/v1"

# Feature vector order — MUST match buildF5Features() in server/mlb/service.js.
FEATURE_ORDER = [
    "home_sp_era", "home_sp_whip", "home_sp_k9", "home_sp_bb9", "home_sp_hr9", "home_sp_ip_per_start",
    "away_sp_era", "away_sp_whip", "away_sp_k9", "away_sp_bb9", "away_sp_hr9", "away_sp_ip_per_start",
    "home_runs_pg", "away_runs_pg",
    "park_hr_factor",
]

# League-average fallbacks used when a pitcher/team has no usable prior sample.
# Mirrored into f5_feature_spec.json so the server falls back identically.
LEAGUE_FALLBACK = {
    "sp_era": 4.20, "sp_whip": 1.30, "sp_k9": 8.6, "sp_bb9": 3.2, "sp_hr9": 1.20, "sp_ip_per_start": 5.1,
    "runs_pg": 4.5,
    "park_hr_factor": 100.0,
}

# Class index convention (multi:softprob). MUST match the server + frontend.
CLASSES = ["home", "tie", "away"]  # 0 = home leads F5, 1 = tie, 2 = away leads F5

# Approx multi-year HR park factors keyed by venue name (mirror of PARK_HR_FACTORS
# in server/mlb/service.js). 100 = neutral.
PARK_HR_FACTORS = [
    (r"great american", 124), (r"yankee", 117), (r"citizens bank", 115),
    (r"rate field|guaranteed rate", 113), (r"dodger", 112), (r"truist", 110),
    (r"american family", 108), (r"coors", 106), (r"sutter health", 105),
    (r"steinbrenner", 105), (r"angel", 104), (r"rogers centre", 104),
    (r"daikin|minute maid", 104), (r"citi field", 102), (r"chase field", 102),
    (r"nationals", 102), (r"wrigley", 100), (r"globe life", 98), (r"target field", 98),
    (r"progressive", 98), (r"fenway", 96), (r"camden", 96), (r"petco", 95),
    (r"comerica", 94), (r"busch", 92), (r"t-mobile", 92), (r"loandepot|loan depot", 90),
    (r"pnc", 90), (r"kauffman", 88), (r"oracle", 84),
]


def park_hr_factor(venue_name):
    if not venue_name:
        return None
    v = venue_name.lower()
    for pat, factor in PARK_HR_FACTORS:
        if re.search(pat, v):
            return factor
    return None


def ip_to_outs(ip):
    """Innings like 5.2 mean 5 and 2/3 -> convert to outs before summing."""
    try:
        n = float(ip)
    except (TypeError, ValueError):
        return 0
    whole = int(n)
    frac = round((n - whole) * 10)
    return whole * 3 + frac


def rate_per9(stat_total, outs):
    ip = outs / 3.0
    return (stat_total * 9.0 / ip) if ip > 0 else None


_session = requests.Session()
_session.headers.update({"User-Agent": "playiq-f5-trainer"})


def get_json(url, retries=3, pause=0.5):
    last = None
    for attempt in range(retries):
        try:
            r = _session.get(url, timeout=30)
            if r.status_code == 200:
                return r.json()
            last = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            last = str(e)
        time.sleep(pause * (2 ** attempt))
    raise RuntimeError(f"GET failed after {retries}: {url} ({last})")
