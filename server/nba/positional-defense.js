/* ═══════════════════════════════════════════════════════════
   NBA Positional Defense
   For every team × position (PG/SG/SF/PF/C), computes the
   total points scored against that defense by players at
   that position, plus the minutes those players logged, and
   the resulting points-allowed-per-48. Then ranks all 150
   rows by per-48 (1 = best defense, 150 = worst).

   Source: ESPN scoreboard for game discovery + ESPN box score
   for per-player stats. Player → specific position is resolved
   via basketball-reference (see ./positions.js).

   Designed to run once per day. Results cached in memory + on
   disk so we don't re-crawl 1200 box scores on every request.
═══════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { fetchJson } = require('../shared/http');
const { cacheGet, cacheSet } = require('../shared/cache');
const { fetchNbaBoxScore } = require('./box-score');
const { getPositionMap, resolvePosition, getCurrentSeasonKey, VALID_POS } = require('./positions');

const DEFENSE_TTL = 24 * 60 * 60 * 1000; // 24h
const CACHE_KEY = 'nba_positional_defense';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DISK_PATH = path.join(DATA_DIR, 'nba-positional-defense.json');
const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

// Safety allowlist of canonical NBA abbreviations. Catches All-Star
// "STARS"/"WORLD"/"STRIPES" and international exhibition rosters.
// Box-score abbreviations are normalized upstream so we never see ESPN
// short forms (GS/NO/NY/SA/PHX/UTAH/WSH) here.
const NBA_TEAM_ABBRS = new Set([
  'ATL', 'BKN', 'BOS', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHO', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS',
]);

// Async lock so concurrent requests don't all start crawling at once
let inflightCompute = null;

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) { /* exists */ }
}

function loadFromDisk() {
  try {
    const raw = fs.readFileSync(DISK_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function saveToDisk(data) {
  try {
    ensureDataDir();
    fs.writeFileSync(DISK_PATH, JSON.stringify(data));
  } catch (err) {
    console.error('[nba/positional-defense] disk write failed:', err.message);
  }
}

// "2026-04-15" → "20260415"
function dateToEspn(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

// Iterate from start to end, yielding YYYYMMDD strings
function* dateRange(start, end) {
  const d = new Date(start);
  while (d <= end) {
    yield dateToEspn(d);
    d.setDate(d.getDate() + 1);
  }
}

// Default season window: NBA seasons start in late October
function seasonStartDate(seasonKey) {
  const m = String(seasonKey).match(/(\d{4})-/);
  if (!m) return new Date('2025-10-01');
  return new Date(`${m[1]}-10-01`);
}

// ESPN seasonType: 1=preseason, 2=regular, 3=post-season, 4=all-star, 5=preseason intl
const ALLOWED_SEASON_TYPES = new Set([2, 3]);

async function fetchScoreboardForDate(yyyymmdd) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${yyyymmdd}`;
  const cacheKey = `nba_scoreboard_${yyyymmdd}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const data = await fetchJson(url);
    const events = data?.events || [];
    const completed = events
      .filter(e => e.status?.type?.state === 'post')
      // Drop preseason, all-star, and exhibition/international games
      .filter(e => ALLOWED_SEASON_TYPES.has(Number(e.season?.type)))
      .map(e => ({ id: String(e.id), date: e.date }));
    cacheSet(cacheKey, completed, 60 * 60 * 1000); // 1h
    return completed;
  } catch (err) {
    return [];
  }
}

async function gatherSeasonGameIds(seasonKey, sinceDateStr) {
  const start = sinceDateStr ? new Date(sinceDateStr) : seasonStartDate(seasonKey);
  const today = new Date();
  const ids = [];
  for (const dateStr of dateRange(start, today)) {
    const completed = await fetchScoreboardForDate(dateStr);
    for (const g of completed) ids.push(g);
  }
  return ids;
}

// Process box scores in parallel batches to limit ESPN load
async function processInBatches(ids, batchSize, handler) {
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    await Promise.all(batch.map(handler));
  }
}

// Aggregate shape: agg[teamAbbr][position] = { points, minutes, gameSet }
function emptyAggregate() {
  const agg = {};
  return agg;
}

function emptyBucket() {
  return {
    points: 0, minutes: 0,
    fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0,
    reb: 0, ast: 0, stl: 0, blk: 0, to: 0,
    gameSet: new Set(),
  };
}

function ensureBucket(agg, team, pos) {
  if (!agg[team]) agg[team] = {};
  if (!agg[team][pos]) agg[team][pos] = emptyBucket();
  return agg[team][pos];
}

// Walk a single completed game, attributing every player's stats to the
// OPPOSING team's positional defense bucket.
function attributeBoxScore(box, positionMap, agg) {
  if (!box?.players) return;
  // Drop the whole game if either team isn't a real NBA franchise (catches
  // All-Star, Rising Stars, and international exhibitions that slip through).
  if (!NBA_TEAM_ABBRS.has(box.awayAbbr) || !NBA_TEAM_ABBRS.has(box.homeAbbr)) return;
  for (const p of box.players) {
    if (p.minutes <= 0) continue;
    const pos = resolvePosition(p.name, positionMap);
    if (!pos || !VALID_POS.has(pos)) continue; // skip unknowns per spec
    const def = p.opponentAbbr;
    if (!def || !NBA_TEAM_ABBRS.has(def)) continue;
    const b = ensureBucket(agg, def, pos);
    b.points  += p.points || 0;
    b.minutes += p.minutes || 0;
    b.fgm += p.fgm || 0;  b.fga += p.fga || 0;
    b.tpm += p.tpm || 0;  b.tpa += p.tpa || 0;
    b.ftm += p.ftm || 0;  b.fta += p.fta || 0;
    b.reb += p.reb || 0;
    b.ast += p.ast || 0;
    b.stl += p.stl || 0;
    b.blk += p.blk || 0;
    b.to  += p.to  || 0;
    b.gameSet.add(box.eventId);
  }
}

// Stats with metadata: per-48 vs percentage, sort direction
const STAT_META = [
  { key: 'pts',     label: 'PTS',  type: 'per48' },
  { key: 'fg_pct',  label: 'FG%',  type: 'pct' },
  { key: 'ft_pct',  label: 'FT%',  type: 'pct' },
  { key: 'three_pm', label: '3PM', type: 'per48' },
  { key: 'reb',     label: 'REB',  type: 'per48' },
  { key: 'ast',     label: 'AST',  type: 'per48' },
  { key: 'stl',     label: 'STL',  type: 'per48' },
  { key: 'blk',     label: 'BLK',  type: 'per48' },
  { key: 'to',      label: 'TO',   type: 'per48' },
];

function aggregateToRows(seasonKey, agg) {
  const rows = [];
  for (const team of Object.keys(agg)) {
    for (const pos of POSITIONS) {
      const b = agg[team][pos] || emptyBucket();
      const per48 = (raw) => b.minutes > 0 ? (raw / b.minutes) * 48 : 0;
      const pct = (m, a) => a > 0 ? m / a : 0;
      rows.push({
        season: seasonKey,
        defensive_team: team,
        position: pos,
        total_points_allowed: b.points,
        total_minutes_against_position: Number(b.minutes.toFixed(2)),
        games_sampled: b.gameSet.size,
        // Per-48 / percentage values (all "allowed to opposing position")
        points_allowed_per_48: Number(per48(b.points).toFixed(2)),
        fg_pct: Number(pct(b.fgm, b.fga).toFixed(4)),
        ft_pct: Number(pct(b.ftm, b.fta).toFixed(4)),
        three_pm_per_48: Number(per48(b.tpm).toFixed(2)),
        reb_per_48: Number(per48(b.reb).toFixed(2)),
        ast_per_48: Number(per48(b.ast).toFixed(2)),
        stl_per_48: Number(per48(b.stl).toFixed(2)),
        blk_per_48: Number(per48(b.blk).toFixed(2)),
        to_per_48: Number(per48(b.to).toFixed(2)),
        // Raw totals so the frontend can re-derive if needed
        totals: {
          fgm: b.fgm, fga: b.fga,
          tpm: b.tpm, tpa: b.tpa,
          ftm: b.ftm, fta: b.fta,
          reb: b.reb, ast: b.ast, stl: b.stl, blk: b.blk, to: b.to,
        },
      });
    }
  }

  // Compute per-stat ranks. Convention: lower allowed = lower rank = stronger
  // defense. Same direction for ALL stats so the green/yellow/red color tiers
  // mean "Top 50 / Mid 50 / Bottom 50" consistently across the table.
  const valueGetter = {
    pts:      r => r.points_allowed_per_48,
    fg_pct:   r => r.fg_pct,
    ft_pct:   r => r.ft_pct,
    three_pm: r => r.three_pm_per_48,
    reb:      r => r.reb_per_48,
    ast:      r => r.ast_per_48,
    stl:      r => r.stl_per_48,
    blk:      r => r.blk_per_48,
    to:       r => r.to_per_48,
  };

  for (const s of STAT_META) {
    const sorted = rows.slice().sort((a, b) => valueGetter[s.key](a) - valueGetter[s.key](b));
    sorted.forEach((r, i) => {
      r.ranks = r.ranks || {};
      r.ranks[s.key] = i + 1;
    });
  }

  // Backwards-compat: the existing `rank` and `signal` fields are tied to PTS
  rows.sort((a, b) => a.points_allowed_per_48 - b.points_allowed_per_48);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.signal = signalForRank(i + 1, rows.length);
  });
  return rows;
}

function signalForRank(rank, total) {
  // total is 150 in steady state but may be smaller mid-season if some
  // team-position pairs have no qualifying minutes yet.
  const fromBottom = total - rank + 1;
  if (fromBottom <= 20) return 'Strong scoring matchup vs this position';
  if (fromBottom <= 30) return 'Above-average scoring matchup vs this position';
  if (rank <= 30) return 'Tough defense vs this position';
  return 'Average defense vs this position';
}

// Reload an aggregate that had its gameSet serialized as an array.
// Returns null if the stored bucket schema is older than the current one
// (signals the caller to discard the disk cache and re-aggregate fresh).
function rehydrateAggregate(serialized) {
  const agg = {};
  for (const team of Object.keys(serialized || {})) {
    agg[team] = {};
    for (const pos of Object.keys(serialized[team])) {
      const b = serialized[team][pos];
      // Schema v2 requires fgm / fga / etc. on every bucket
      if (b.fgm === undefined || b.fga === undefined) return null;
      agg[team][pos] = {
        points: b.points || 0,
        minutes: b.minutes || 0,
        fgm: b.fgm || 0, fga: b.fga || 0,
        tpm: b.tpm || 0, tpa: b.tpa || 0,
        ftm: b.ftm || 0, fta: b.fta || 0,
        reb: b.reb || 0, ast: b.ast || 0,
        stl: b.stl || 0, blk: b.blk || 0,
        to: b.to || 0,
        gameSet: new Set(b.gameSet || []),
      };
    }
  }
  return agg;
}

function freezeAggregate(agg) {
  const out = {};
  for (const team of Object.keys(agg)) {
    out[team] = {};
    for (const pos of Object.keys(agg[team])) {
      const b = agg[team][pos];
      out[team][pos] = {
        points: b.points,
        minutes: b.minutes,
        fgm: b.fgm, fga: b.fga,
        tpm: b.tpm, tpa: b.tpa,
        ftm: b.ftm, fta: b.fta,
        reb: b.reb, ast: b.ast, stl: b.stl, blk: b.blk, to: b.to,
        gameSet: [...b.gameSet],
      };
    }
  }
  return out;
}

async function _doCompute({ refresh, season }) {
  const seasonKey = season || getCurrentSeasonKey();

  // Load prior state for incremental processing. If schema is old, drop it.
  const persisted = loadFromDisk();
  let agg = emptyAggregate();
  let processedIds = new Set();
  let sinceDate = null;
  if (!refresh && persisted && persisted.season === seasonKey) {
    const rehydrated = rehydrateAggregate(persisted.aggregate);
    if (rehydrated) {
      agg = rehydrated;
      processedIds = new Set(persisted.processedIds || []);
      sinceDate = persisted.lastDate;
    } else {
      console.log('[nba/positional-defense] schema mismatch — discarding disk cache, full re-aggregate');
    }
  }
  const reuse = processedIds.size > 0;

  // 1) Position map (~24h cache)
  const positionMap = await getPositionMap({ season: seasonKey });

  // 2) Season game IDs
  const games = await gatherSeasonGameIds(seasonKey, sinceDate);
  const newGames = games.filter(g => !processedIds.has(g.id));

  console.log(`[nba/positional-defense] season=${seasonKey} reuse=${reuse} processed=${processedIds.size} new=${newGames.length}`);

  // 3) Crawl each new game's box score (parallel batches of 8)
  let processed = 0, failed = 0;
  await processInBatches(newGames.map(g => g.id), 8, async (id) => {
    try {
      const box = await fetchNbaBoxScore(id);
      if (!box) { return; }
      attributeBoxScore(box, positionMap, agg);
      processedIds.add(id);
      processed++;
    } catch (err) {
      failed++;
    }
  });

  // 4) Build the 150-row table
  const rows = aggregateToRows(seasonKey, agg);

  const result = {
    season: seasonKey,
    builtAt: Date.now(),
    source: { scoreboard: 'espn', boxscore: 'espn', positions: 'basketball-reference' },
    games_total: games.length,
    games_processed_this_run: processed,
    games_failed_this_run: failed,
    games_in_aggregate: processedIds.size,
    position_map_size: positionMap.count,
    rows,
  };

  // 5) Persist (in-memory + disk)
  cacheSet(`${CACHE_KEY}_${seasonKey}`, result, DEFENSE_TTL);
  saveToDisk({
    season: seasonKey,
    builtAt: result.builtAt,
    lastDate: dateToEspn(new Date()),
    processedIds: [...processedIds],
    aggregate: freezeAggregate(agg),
    rows, // cache the final ranked rows too so reads are O(1)
  });

  return result;
}

async function getPositionalDefense({ refresh = false, season = null } = {}) {
  const seasonKey = season || getCurrentSeasonKey();
  const cacheKey = `${CACHE_KEY}_${seasonKey}`;

  if (!refresh) {
    const memCached = cacheGet(cacheKey);
    if (memCached) return memCached;
    const persisted = loadFromDisk();
    if (persisted && persisted.season === seasonKey
      && Date.now() - (persisted.builtAt || 0) < DEFENSE_TTL) {
      // Disk hit — wrap in the same shape and warm the in-memory cache
      const result = {
        season: persisted.season,
        builtAt: persisted.builtAt,
        source: { scoreboard: 'espn', boxscore: 'espn', positions: 'basketball-reference' },
        games_in_aggregate: (persisted.processedIds || []).length,
        rows: persisted.rows || [],
      };
      cacheSet(cacheKey, result, DEFENSE_TTL);
      return result;
    }
  }

  if (!inflightCompute) {
    inflightCompute = _doCompute({ refresh, season: seasonKey })
      .finally(() => { inflightCompute = null; });
  }
  return inflightCompute;
}

// Look up a single (team, position) row
function findRow(table, team, position) {
  if (!table?.rows) return null;
  const t = String(team || '').toUpperCase();
  const p = String(position || '').toUpperCase();
  return table.rows.find(r => r.defensive_team === t && r.position === p) || null;
}

module.exports = {
  getPositionalDefense,
  findRow,
  POSITIONS,
};
