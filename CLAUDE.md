# PlayIQ — Project Blueprint for Claude

## What This Project Is
PlayIQ is a dark-mode sports betting intelligence dashboard with an HUD / sci-fi aesthetic. The user picks a sport → browses today's games → drills into a game for deep analysis across multiple tabs (Overview, H2H, Last 5, Rosters, MLB Edge Finder, Pitching, Low HR Model, High Contact, AI Plays).

It is a **full-stack app** with a vanilla-JS Node backend and a React-via-CDN browser frontend (no build step).

---

## File Structure
```
playiq/
├── index.html                                  — Shell: React + Babel CDN, nav, API-key input, global CSS
├── frontend/
│   ├── data/
│   │   ├── shared/core.js                      — ESPN helpers, SPORTS_CONFIG, fetchAllGames, fetchTeamForm, fetchH2H, fetchInjuries, fetchRoster, Claude API, AI plays
│   │   ├── mlb/index.js                        — MLB-only helpers: fetchGameBvp, fetchHighContactReport, fetchWeather, fetchMlbStarters, fetchPlayerGameLog, buildMlbEdgeData
│   │   ├── nba/index.js                        — NBA-only helpers: fetchHoopsPlayerGameLog (shared w/ WNBA), buildNbaEdgeData (incl. per-player `proj` distribution), lineup + positional-defense fetchers, threshold projection model (nbaThresholdProbability + buckets)
│   │   └── wnba/index.js                       — WNBA: buildWnbaEdgeData. Reuses the basketball gamelog parser + the (sport-agnostic) threshold model; NO Rotowire lineups / defense-vs-position (NBA-only backends), so the board runs without a matchup adjustment
│   ├── shared/
│   │   ├── ui-atoms.jsx                        — Primitive UI components (HudCard, PlayerCard, Sparkline, OpsGauge, WeatherPill, TabLoader, etc.)
│   │   ├── tabs/common-tabs.jsx                — Sport-agnostic tabs: OverviewTab, H2HTab, FormTab, RosterTab, AIPlaysTab
│   │   └── screens/
│   │       ├── home-screen.jsx                 — HomeScreen (sport picker)
│   │       ├── games-screen.jsx                — GamesScreen (today's games; MLB cards show a research-readiness strip: SP + LINEUP pills + ● READY, from /api/mlb/games readiness flags)
│   │       └── game-detail-screen.jsx          — GameDetailScreen + TABS_MLB / TABS_NBA / TABS_OTHER + Phase 1 / Phase 2 loading
│   └── sports/
│       ├── mlb/tabs.jsx                        — MLB-specific tabs: EdgeFinderTab (incl. PROP PROJECTION MODEL board: transparent Log5 P(Hits/RBI/K≥line)), PitchingEdgeTab (incl. PITCHER PROJECTION MODEL board: P(K/Outs/ER/HR≥line) + per-start bar charts), LowHrModelTab, HighContactTab
│       └── nba/tabs.jsx                        — NBA-specific tabs: NbaEdgeFinderTab (incl. PROJECTION MODEL board: P(stat≥line) per player), NbaLineupTab, NbaDefenseVsPositionTab
├── manifest.json                               — PWA manifest
├── icon.svg                                    — PWA icon
├── server/
│   ├── index.js                                — Node HTTP server (port 3001): routes to mlb/ and nba/ services
│   ├── shared/{cache.js,http.js}               — In-memory cache + fetch helpers
│   ├── index.js                                — Node HTTP server (also loads + scores the F5 model)
│   ├── mlb/service.js                          — MLB Stats API + Baseball Savant: games, lineups, BvP, weather, high-contact report (pitcher stats + arsenal + splits + bullpen + scoring, each sub-score carries a `methodology` entry: source + exact endpoint + inputs + formula for verifiability), low-HR model, F5 money-line model (buildF5Features + scoreF5 zero-dep XGBoost tree-walker; folded into the high-contact report as `f5`), batter-prop model (`getBatterPropModel`: transparent Log5 + Binomial/Poisson, served at `/api/mlb/prop-model` — no ML, computed live), pitcher-prop model (`getPitcherPropModel`: P(K/Outs/ER/HR ≥ line) via Log5 K-matchup + Binomial/Normal/Poisson + per-start log, served at `/api/mlb/pitcher-props`)
│   ├── data/{f5_model.json,f5_feature_spec.json}  — F5 XGBoost model + feature contract (committed by CI; see ml/)
│   ├── nba/{service.js,positional-defense.js,positions.js}  — NBA endpoints (lineups, def-vs-position)
│   ├── package.json
│   ├── start.sh                                — Kills any existing :3001 process, starts server in background, logs to server.log
│   └── server.log
├── ml/                                         — OFFLINE XGBoost pipeline for the F5 model (Python; runs in CI, not in the app)
│   ├── f5_common.py                            — shared feature order + park table + fallbacks (parity contract)
│   ├── collect_mlb_f5.py                       — builds leak-free dataset from MLB schedule + pitcher game logs
│   ├── train_f5.py                             — trains XGBoost multi:softprob, exports full-precision trees + parity samples
│   └── README.md                               — how the pipeline + CI automation work
├── .github/workflows/train-f5.yml             — weekly retrain → commit model → Render autoDeploy
└── CLAUDE.md                                   — This file
```

**IMPORTANT** — `data-layer.js`, `tabs.jsx`, `screens-v2.jsx`, `ui-atoms.jsx` in the repo root are dead legacy files NOT loaded by `index.html` (leftovers from before the `frontend/` reorg). Always edit the `frontend/` paths above; editing the root files will compile fine but nothing will change in the browser.

---

## Tech Stack
### Frontend (browser, no build step)
- **React 18 + Babel Standalone** via unpkg CDN — `.jsx` files are Babel-transpiled in the browser (`<script type="text/babel" src="…">`)
- **ESPN public API** — undocumented but free, no key
- **Claude API (Haiku)** — called directly from browser using `anthropic-dangerous-direct-browser-access: true`. API key is entered in the top nav and persisted to `localStorage` as `piq_key`.
- **Fonts** — Orbitron (display, Bebas-like caps) + Space Mono (all UI / body) via Google Fonts

### Backend (Node, zero dependencies)
- Pure `http` + `https` — no npm deps, run with `node server/index.js` (or `./server/start.sh` to daemonize)
- Serves MLB Stats API data (schedule, lineups, weather, probable pitchers) and Baseball Savant BvP analytics at `http://localhost:3001`
- In-memory cache with 2-min TTL for live data, 15-min TTL for BvP

---

## CSS Design System
All colors are CSS variables in `:root` in `index.html`.

```css
--bg        #05080f   /* page background (near-black navy) */
--surface   #090d1a   /* subtle panel bg */
--card      #0d1524   /* card bg */
--cyan      #00d4ff   /* PRIMARY accent — links, highlights, away team */
--green     #00ff88   /* wins, live pulse, positive edges */
--orange    #ff6b35   /* losses, injuries OUT, negative edges */
--gold      #ffd060   /* home team, lean verdicts, warnings */
--text      #c0d4e8   /* primary text */
--muted     #4a6080   /* secondary text */
--dim       #2a3a50   /* dividers, placeholders, disabled */
```

**Fonts:** always `'Orbitron, monospace'` for display headings/numbers, `'Space Mono, monospace'` for everything else. Never use Inter, Roboto, Arial, or system fonts.

**Card pattern:** `HudCard` atom (corner brackets that brighten on hover) — use it everywhere instead of plain divs.

---

## Frontend Architecture

### Script load order (matters — later scripts depend on earlier)
1. `data-layer.js` — regular `<script>`, exports helpers to `window`
2. `ui-atoms.jsx` — `<script type="text/babel">`, defines primitives, exports to `window`
3. `tabs.jsx` — defines tab components, uses atoms
4. `screens-v2.jsx` — defines HomeScreen / GamesScreen / GameDetailScreen, uses atoms + tabs
5. Inline `<script type="text/babel">` in `index.html` — defines `<App>` + `ApiKeyInput` and mounts to `#root`

Because there is no bundler, components communicate by attaching to `window` (`Object.assign(window, { HudCard, … })`). Always remember to export new components this way.

### App state (React)
- Top-level `view` state: `'home' | 'games' | 'detail'` — persisted in `sessionStorage.piq_view`
- `selectedSport` (for games view), `selectedGame` (for detail view) — `sessionStorage.piq_game`
- `tab` state inside `GameDetailScreen` — persisted in `sessionStorage.piq_tab`
- Claude API key — `localStorage.piq_key` (typed into `ApiKeyInput` in the top nav)

### Screens
- **HomeScreen** (`screens-v2.jsx`) — sport picker grid (MLB/NBA/NHL/NCAAB)
- **GamesScreen** (`screens-v2.jsx`) — today's games from all active sports, date picker, sport filter tabs
- **GameDetailScreen** (`screens-v2.jsx`) — orchestrates the tab bar + per-tab data loading. Loads form/injuries/rosters/H2H in parallel, then (MLB only) fetches BvP and builds edge data. MLB gets extra tabs: `edges` and `pitching`.

### Tabs (all in `tabs.jsx`)
- `OverviewTab` — side-by-side team stats (W/L, streak, avg PF/PA, FormDots) + injury blocks
- `H2HTab` — last 5 matchups with stat leaders per game
- `FormTab` — last N games with best player per stat (PTS/REB/AST for NBA, H/RBI/R for MLB)
- `RosterTab` — grid of PlayerCards with status pills
- `EdgeFinderTab` (MLB only) — per-batter BvP vs. today's starter: AVG/OBP/SLG/OPS gauge + bar chart + sparkline
- `PitchingEdgeTab` (MLB only) — starting pitcher cards: ERA/WHIP/record
- `AIPlaysTab` — generate plays via Claude + free-form "discuss your play" box

---

## Data Layer (`data-layer.js`)

Everything attaches to `window` for cross-script access. Exports include:

| Function | Purpose |
|---|---|
| `fetchAllGames(date)` | ESPN scoreboards for all `SPORTS_CONFIG` sports on a given date |
| `fetchTeamForm(sportKey, teamId)` | Last 10 completed games, W/L, scores |
| `enrichFormWithPlayerStats(sportKey, teamId, formGames)` | Attaches top player (PTS/H/etc.) per game via ESPN box scores |
| `fetchH2H(gameInfo)` | Last 5 head-to-head across last 3 seasons, with stat leaders |
| `fetchInjuries(gameInfo)` | ESPN injuries for both teams |
| `fetchRoster(sportKey, teamId)` | Full roster with status + headshot |
| `fetchTeamStats(sportKey, teamId)` | Team season stats |
| `fetchMlbStarters(gameInfo)` | ESPN probable pitchers + lineups for an MLB game |
| `fetchGameBvp(gameInfo, lineups, pitchers)` | Calls **our backend** `/api/mlb/game-bvp` for Savant BvP |
| `fetchWeather(gamePk)` | Calls **our backend** `/api/mlb/weather` |
| `buildMlbEdgeData(gameInfo, bvpData)` | Shapes BvP output for `EdgeFinderTab` |
| `generateAIPlays(gameData)` | Claude call for 3 recommended plays (returns `{error:'NO_API_KEY'}` when key missing) |
| `claudeComplete(prompt, opts)` | Low-level Claude call — used by `AIPlaysTab` discuss flow |

`SPORTS_CONFIG` is the single source of truth for which sports/leagues are wired up: `mlb`, `nba`, `wnba`, `nhl`, `ncaamb`. Add a new sport by appending here.

**Gotcha when adding a sport:** `teamLogoUrl` has a `pro` allowlist — leagues NOT in it fall through to the NCAA *team-id* logo path and render no logo. Add the league there too (this is why `wnba` is listed).

### ESPN fetch helper
```js
async function espnFetch(url) {
  try { const r = await fetch(url, { cache: 'no-store' }); return r.ok ? await r.json() : null; }
  catch { return null; }
}
```
Always use this (never bare `fetch`) for ESPN calls.

---

## Claude API Integration

### Direct browser → Anthropic (requires user-supplied key)
The `ApiKeyInput` atom in the top nav writes `sk-ant-…` keys to `localStorage.piq_key`. `claudeComplete()` reads it and POSTs directly to `https://api.anthropic.com/v1/messages`.

### Required headers
```js
'Content-Type': 'application/json',
'x-api-key': getApiKey(),
'anthropic-version': '2023-06-01',
'anthropic-dangerous-direct-browser-access': 'true',  // REQUIRED for browser calls
```

### Model
Always `claude-haiku-4-5-20251001` unless the user explicitly asks for a smarter/more expensive model.

### Response parsing pattern
```js
const text = data.content?.[0]?.text || '';
const match = text.match(/\[[\s\S]*\]/);   // for JSON-array responses
if (match) return JSON.parse(match[0]);
```

### Compatibility shim
For any legacy code that calls `window.claude.complete(prompt)`, `data-layer.js` installs a shim pointing at `claudeComplete` so it just works.

---

## Backend (`server/index.js`)

- Port **3001**, zero npm deps, pure Node `http` + `https`
- CORS is open so the browser frontend can call it directly
- Start: `./server/start.sh` (kills any existing :3001 process, daemonizes to `server/server.log`) or `node server/index.js` for foreground
- Key endpoints (consumed by `data-layer.js`):
  - `GET /api/mlb/game-bvp?away=&home=&date=&awayLineup=&homeLineup=&awayPitcher=&homePitcher=` — per-batter BvP vs. starter
  - `GET /api/mlb/weather?gamePk=…` — MLB park weather / roof / wind
- Internal caches: 2-min for live MLB, 15-min for historical BvP (max 500 entries, LRU eviction)

**Rule: maintain the backend's current shape.** Add new endpoints rather than mutating existing ones, and keep it dependency-free.

---

## Machine Learning (F5 money-line model)

The only ML model in the app. Predicts the **first-5-innings money line** (3-way: home/tie/away leads after 5), shown atop the MLB **High Contact** tab via `F5MoneyLineCard`.

- **Trained offline** with real XGBoost in `ml/` (Python), **never in the app**. GitHub Actions retrains weekly and commits `server/data/f5_model.json`; Render auto-deploys. The user never runs Python.
- **Scored live, zero-dep**: `scoreF5()` in `server/mlb/service.js` walks the exported trees (full-precision, round-robin tree→class + per-class `base_margin`, softmax) — no ML library in the runtime.
- **Train/serve parity is load-bearing**: features are defined once (`ml/f5_common.py` ↔ `server/data/f5_feature_spec.json`) and must be computed identically by `collect_mlb_f5.py` (historical) and `buildF5Features()` (live). `train_f5.py` embeds `parity_samples` so the Node scorer can self-check (expect ~1e-7). If you change a feature, change BOTH sides and retrain.
- Don't add an ML dependency to the Node app or a build step. Keep training in `ml/`. See `ml/README.md`.

---

## Known limitations / common issues

| Issue | Cause | Fix |
|---|---|---|
| "No games found" | Date has no scheduled games, or all sports off-season | Try another date; NCAAB is often off-season in spring |
| AI Plays button does nothing | No API key saved | Enter `sk-ant-…` in the top nav `ApiKeyInput` |
| MLB Edge Finder says "loading or unavailable" | Backend down, lineups not announced, or `bvpData.matchups` empty | Check `server/server.log`; lineups typically post ~2h before first pitch |
| Roster empty for a team | ESPN API structure varies by sport | Inspect `data.athletes` shape in `fetchRoster` |
| Claude returns non-JSON | Prompt drifted | Tighten the prompt in `generateAIPlays` — the app expects a single `[…]` array |
| Logos missing | ESPN CDN path differs for NCAAB (uses teamId, not abbr) | Fix in `teamLogoUrl` |

---

## How to add a new feature

### Add a new tab
1. Write the component in `tabs.jsx`, export via the `Object.assign(window, …)` at the bottom
2. Add its id/label to `TABS_MLB` or `TABS_OTHER` in `screens-v2.jsx`
3. Add the `{tab === 'newtab' && <NewTab gameData={gameData} />}` branch inside `GameDetailScreen`
4. If it needs new data, fetch it in the `load()` effect and include it in `setGameData({...})`

### Add a new data source
1. Add a `fetchXxx` function to `data-layer.js`
2. Export it on `window` via the `Object.assign` at the bottom
3. Call it from the `load()` effect in `GameDetailScreen`, include in `gameData`

### Add a new sport
1. Append to `SPORTS_CONFIG` in `data-layer.js`
2. Add it to the `sports` array in `HomeScreen` with `active: true`
3. Fetch/rendering code in tabs is sport-agnostic for overview/form/h2h/roster; sport-specific tabs (`EdgeFinderTab`, `PitchingEdgeTab`) are gated by `game.sportKey === 'mlb'`

### Improve AI play quality
- Tune the prompt in `generateAIPlays()` — the schema is `[{play, confidence, reason, type}]`
- Add more context (injuries, weather, BvP summary) to the prompt string

---

## Style Guide
- CSS variables only — no hardcoded hex colors except in component-local styles where you need a specific channel value (e.g. `'#00ff88'` for a win color)
- Use `HudCard` for all card-shaped containers
- Orbitron for numbers and labels; Space Mono for everything else
- Do NOT introduce a bundler, TypeScript, or npm-installed React. The "no build step" constraint is intentional — keep it that way.
- When adding components to a `.jsx` file, remember to append them to the `Object.assign(window, { … })` export at the bottom, or the next script won't find them.
