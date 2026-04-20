/* ═══════════════════════════════════════════════════════════
   PlayIQ Backend Server
   MLB Stats API (live data) + Baseball Savant (BvP analytics)
   Zero dependencies — pure Node.js
═══════════════════════════════════════════════════════════ */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = 3001;

// ── In-memory cache ──────────────────────────────────────
const cache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes for BvP (historical, doesn't change often)
const LIVE_CACHE_TTL = 2 * 60 * 1000; // 2 minutes for live MLB data

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, ttl = CACHE_TTL) {
  cache.set(key, { data, ts: Date.now(), ttl });
  // Evict old entries if cache grows too large
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > v.ttl) cache.delete(k);
    }
  }
}

// ── HTTP fetch helper ────────────────────────────────────
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'PlayIQ/1.0',
        ...options.headers,
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

async function fetchJson(url) {
  const text = await fetchUrl(url);
  return JSON.parse(text);
}

// ══════════════════════════════════════════════════════════
//  MLB STATS API — Live Data
// ══════════════════════════════════════════════════════════

const MLB_API = 'https://statsapi.mlb.com/api/v1';

function getLocalDate() {
  // Use local timezone, not UTC — games are listed by local calendar date
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function getGames(dateOverride) {
  const date = dateOverride || getLocalDate();
  const cacheKey = `games_${date}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await fetchJson(`${MLB_API}/schedule?sportId=1&date=${date}&hydrate=probablePitcher`);
  const games = [];
  for (const d of data.dates || []) {
    for (const g of d.games || []) {
      games.push({
        gamePk: g.gamePk,
        away: {
          id: g.teams.away.team.id,
          name: g.teams.away.team.name,
          probablePitcher: g.teams.away.probablePitcher ? {
            id: g.teams.away.probablePitcher.id,
            name: g.teams.away.probablePitcher.fullName,
          } : null,
        },
        home: {
          id: g.teams.home.team.id,
          name: g.teams.home.team.name,
          probablePitcher: g.teams.home.probablePitcher ? {
            id: g.teams.home.probablePitcher.id,
            name: g.teams.home.probablePitcher.fullName,
          } : null,
        },
        status: g.status.detailedState,
        startTime: g.gameDate,
      });
    }
  }
  cacheSet(cacheKey, games, LIVE_CACHE_TTL);
  return games;
}

// Short TTL for unconfirmed lineups so we repoll quickly as they get announced
const UNCONFIRMED_LINEUP_TTL = 30 * 1000; // 30s
const CONFIRMED_LINEUP_TTL = 30 * 60 * 1000; // 30min — once confirmed, rarely changes

// Name normalization that survives diacritics, punctuation, and suffixes
// so "Peña" matches "Pena", "J.T. Realmuto" matches "JT Realmuto", etc.
function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')                       // split accents into base + combining marks
    .replace(/[\u0300-\u036f]/g, '')        // drop combining marks (é → e, ñ → n)
    .toLowerCase()
    .replace(/\./g, '')                     // JT vs J.T.
    .replace(/\s+(jr|sr|ii|iii|iv)\b/g, '') // ignore Jr./Sr./roman numerals
    .replace(/[^a-z0-9\s]/g, '')            // apostrophes, hyphens, etc.
    .replace(/\s+/g, ' ')
    .trim();
}

// Last-name-only key as a fallback when full-name match fails
function lastNameKey(s) {
  const parts = normalizeName(s).split(' ');
  return parts[parts.length - 1] || '';
}

// Fetch MLB team's 40-man roster as a normalized name → {id, name, position} map
async function getTeamRosterMap(teamId) {
  if (!teamId) return { byFull: {}, byLast: {} };
  const cacheKey = `mlb_roster_${teamId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const data = await fetchJson(`${MLB_API}/teams/${teamId}/roster?rosterType=40Man`);
    const byFull = {};
    const byLast = {};
    for (const p of data.roster || []) {
      const person = p.person || {};
      if (!person.id || !person.fullName) continue;
      const entry = {
        id: person.id,
        name: person.fullName,
        position: p.position?.abbreviation || '?',
      };
      const fullKey = normalizeName(person.fullName);
      if (fullKey) byFull[fullKey] = entry;
      const lastKey = lastNameKey(person.fullName);
      // Only index last-name if unique on this roster (ambiguous matches = skip)
      if (lastKey) byLast[lastKey] = byLast[lastKey] === undefined ? entry : null;
    }
    const map = { byFull, byLast };
    cacheSet(cacheKey, map, CONFIRMED_LINEUP_TTL);
    return map;
  } catch (err) {
    return { byFull: {}, byLast: {} };
  }
}

// Resolve an ESPN lineup name against an MLB roster map using escalating
// strategies: exact full-name, then unique last-name. Returns null if no match.
function resolveRosterEntry(name, rosterMap) {
  const fullKey = normalizeName(name);
  if (rosterMap.byFull[fullKey]) return rosterMap.byFull[fullKey];
  const lastKey = lastNameKey(name);
  if (lastKey && rosterMap.byLast[lastKey]) return rosterMap.byLast[lastKey];
  return null;
}

async function getGameLineups(gamePk, options = {}) {
  const cacheKey = `lineup_${gamePk}_${options.awayLineup?.join(',') || ''}_${options.homeLineup?.join(',') || ''}`;
  if (!options.refresh) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const [boxData, feedData] = await Promise.all([
    fetchJson(`${MLB_API}/game/${gamePk}/boxscore`),
    fetchJson(`${MLB_API.replace('/v1', '/v1.1')}/game/${gamePk}/feed/live`),
  ]);

  const probablePitchers = feedData.gameData?.probablePitchers || {};
  const result = {};

  for (const side of ['away', 'home']) {
    const team = boxData.teams[side];
    const battingOrder = team.battingOrder || [];
    const players = team.players || {};

    let lineup = battingOrder.slice(0, 9).map((pid, idx) => {
      const p = players[`ID${pid}`] || {};
      const person = p.person || {};
      return {
        id: pid,
        name: person.fullName || `Player ${pid}`,
        position: p.position?.abbreviation || '?',
        order: idx + 1,
      };
    });

    // Fallback: MLB boxscore battingOrder is sometimes empty even when ESPN has
    // the lineup. If the caller passed a lineup (e.g. names scraped from ESPN),
    // resolve names against the team's 40-man roster to get MLB ids.
    const providedLineup = options[`${side}Lineup`];
    if (lineup.length === 0 && Array.isArray(providedLineup) && providedLineup.length) {
      const rosterMap = await getTeamRosterMap(team.team?.id);
      lineup = providedLineup.slice(0, 9).map((name, idx) => {
        const hit = resolveRosterEntry(name, rosterMap);
        return hit ? {
          id: hit.id,
          name: hit.name,
          position: hit.position,
          order: idx + 1,
          resolvedFrom: 'roster',
        } : {
          id: null,
          name,
          position: '?',
          order: idx + 1,
          resolvedFrom: 'unmatched',
        };
      }).filter(b => b.id); // drop unmatched — no MLB id means no Savant query
    }

    const pp = probablePitchers[side];
    result[side] = {
      teamId: team.team?.id,
      teamName: team.team?.name,
      lineup,
      probablePitcher: pp ? { id: pp.id, name: pp.fullName } : null,
    };
  }

  const fullyLoaded =
    result.away.lineup.length >= 9 &&
    result.home.lineup.length >= 9 &&
    result.away.probablePitcher &&
    result.home.probablePitcher;
  const ttl = fullyLoaded ? CONFIRMED_LINEUP_TTL : UNCONFIRMED_LINEUP_TTL;
  cacheSet(cacheKey, result, ttl);
  return result;
}


// ══════════════════════════════════════════════════════════
//  BASEBALL SAVANT — BvP Statcast Data
// ══════════════════════════════════════════════════════════

function parseCsv(text) {
  // Remove BOM
  text = text.replace(/^\ufeff/, '');
  const lines = text.split('\n');
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

async function fetchSavantBvP(batterId, pitcherId, options = {}) {
  const cacheKey = `bvp_${batterId}_${pitcherId}`;
  if (!options.refresh) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const url = `https://baseballsavant.mlb.com/statcast_search/csv?all=true`
    + `&player_type=batter`
    + `&batters_lookup%5B%5D=${batterId}`
    + `&pitchers_lookup%5B%5D=${pitcherId}`
    + `&game_date_gt=2015-01-01`
    + `&game_date_lt=2026-12-31`
    + `&type=details`
    + `&min_pitches=0&min_results=0&min_pas=0`;

  // Retry up to 3 times with exponential backoff — Savant is flaky
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = await fetchUrl(url);
      const pitches = parseCsv(text);
      const summary = summarizeBvP(pitches, batterId, pitcherId);
      cacheSet(cacheKey, summary);
      return summary;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

function summarizeBvP(pitches, batterId, pitcherId) {
  let pa = 0, ab = 0, hits = 0, hr = 0, doubles = 0, triples = 0, singles = 0;
  let bb = 0, k = 0, hbp = 0, sf = 0;
  const gameResults = {};

  for (const p of pitches) {
    const ev = (p.events || '').trim();
    if (!ev) continue; // Not a plate appearance result

    pa++;
    const gameDate = p.game_date || '';
    const gamePk = p.game_pk || null;

    switch (ev) {
      case 'single':
        singles++; hits++; ab++; break;
      case 'double':
        doubles++; hits++; ab++; break;
      case 'triple':
        triples++; hits++; ab++; break;
      case 'home_run':
        hr++; hits++; ab++; break;
      case 'strikeout':
      case 'strikeout_double_play':
        k++; ab++; break;
      case 'walk':
      case 'intent_walk':
        bb++; break;
      case 'hit_by_pitch':
        hbp++; break;
      case 'sac_fly':
      case 'sac_fly_double_play':
        sf++; break;
      case 'sac_bunt':
      case 'sac_bunt_double_play':
        break; // PA but not AB
      default:
        ab++; // field_out, force_out, grounded_into_double_play, etc.
    }

    // Track per-game results with full stats
    if (!gameResults[gameDate]) {
      gameResults[gameDate] = { gamePk, pa: 0, ab: 0, h: 0, hr: 0, bb: 0, k: 0, hbp: 0, singles: 0, doubles: 0, triples: 0, sf: 0, events: [] };
    }
    const gm = gameResults[gameDate];
    if (!gm.gamePk && gamePk) gm.gamePk = gamePk;
    gm.pa++;
    gm.events.push(ev);
    switch (ev) {
      case 'single': gm.singles++; gm.h++; gm.ab++; break;
      case 'double': gm.doubles++; gm.h++; gm.ab++; break;
      case 'triple': gm.triples++; gm.h++; gm.ab++; break;
      case 'home_run': gm.hr++; gm.h++; gm.ab++; break;
      case 'strikeout': case 'strikeout_double_play': gm.k++; gm.ab++; break;
      case 'walk': case 'intent_walk': gm.bb++; break;
      case 'hit_by_pitch': gm.hbp++; break;
      case 'sac_fly': case 'sac_fly_double_play': gm.sf++; break;
      case 'sac_bunt': case 'sac_bunt_double_play': break;
      default: gm.ab++; break;
    }
  }

  const avg = ab > 0 ? (hits / ab) : 0;
  const obp = (ab + bb + hbp + sf) > 0 ? ((hits + bb + hbp) / (ab + bb + hbp + sf)) : 0;
  const slg = ab > 0 ? ((singles + doubles * 2 + triples * 3 + hr * 4) / ab) : 0;

  // Build per-game breakdown sorted by date descending
  const gameByGame = Object.entries(gameResults)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, g]) => ({
      date,
      gamePk: g.gamePk || null,
      pa: g.pa, ab: g.ab, h: g.h, hr: g.hr, bb: g.bb, k: g.k,
      avg: g.ab > 0 ? Number((g.h / g.ab).toFixed(3)) : 0,
    }));

  return {
    batterId: Number(batterId),
    pitcherId: Number(pitcherId),
    totalPitches: pitches.length,
    pa,
    ab,
    hits,
    singles,
    doubles,
    triples,
    hr,
    bb,
    k,
    hbp,
    sf,
    avg: Number(avg.toFixed(3)),
    obp: Number(obp.toFixed(3)),
    slg: Number(slg.toFixed(3)),
    ops: Number((obp + slg).toFixed(3)),
    gamesPlayed: Object.keys(gameResults).length,
    lastFaced: Object.keys(gameResults).sort().pop() || null,
    gameByGame,
  };
}


// ══════════════════════════════════════════════════════════
//  WEATHER — MLB feed/live provides temp + wind + condition
//  per game. Cached per gamePk (weather doesn't change post-game).
// ══════════════════════════════════════════════════════════

const WEATHER_TTL = 24 * 60 * 60 * 1000; // 24h — historical weather is static

async function fetchGameWeather(gamePk) {
  if (!gamePk) return null;
  const cacheKey = `weather_${gamePk}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;

  try {
    const data = await fetchJson(`${MLB_API.replace('/v1', '/v1.1')}/game/${gamePk}/feed/live`);
    const w = data?.gameData?.weather || {};
    const venue = data?.gameData?.venue || {};
    const result = {
      condition: w.condition || null,
      temp: w.temp ? Number(w.temp) : null,
      wind: w.wind || null,
      venue: venue.name || null,
      roofType: venue.roofType || null,
    };
    cacheSet(cacheKey, result, WEATHER_TTL);
    return result;
  } catch (err) {
    cacheSet(cacheKey, null, WEATHER_TTL);
    return null;
  }
}

// Enrich a batter's gameByGame array with weather, deduping identical gamePks
// (all 9 batters share the same gamePk for a given game — caching makes this cheap).
async function enrichBvpGamesWithWeather(gameByGame) {
  if (!gameByGame?.length) return gameByGame;
  const pks = [...new Set(gameByGame.map(g => g.gamePk).filter(Boolean))];
  const weatherByPk = {};
  await Promise.all(pks.map(async pk => {
    weatherByPk[pk] = await fetchGameWeather(pk);
  }));
  return gameByGame.map(g => ({
    ...g,
    weather: g.gamePk ? weatherByPk[g.gamePk] || null : null,
  }));
}


// ══════════════════════════════════════════════════════════
//  HIGH-LEVEL: getGameBvp(gamePk)
//  Returns BvP for every batter vs opposing starter
// ══════════════════════════════════════════════════════════

async function getGameBvp(gamePk, options = {}) {
  const lineups = await getGameLineups(gamePk, options);

  // Resolve ESPN pitcher name overrides to MLB ids via roster lookup.
  // This ensures we use the pitcher ESPN confirmed, not whatever MLB's live
  // feed has — the two sources sometimes disagree when multiple pitchers are listed.
  const pitcherOverrides = {};
  for (const side of ['away', 'home']) {
    const pitcherName = options[`${side}Pitcher`];
    if (pitcherName && lineups[side]?.teamId) {
      const rosterMap = await getTeamRosterMap(lineups[side].teamId);
      const resolved = resolveRosterEntry(pitcherName, rosterMap);
      if (resolved) pitcherOverrides[side] = { id: resolved.id, name: resolved.name };
    }
  }

  const matchups = [];
  let totalBatters = 0;
  let resolvedBatters = 0;
  let failedBatters = 0;

  for (const [side, oppSide] of [['away', 'home'], ['home', 'away']]) {
    const team = lineups[side];
    const opponent = lineups[oppSide];
    const pitcher = pitcherOverrides[oppSide] || opponent.probablePitcher;

    if (!pitcher) {
      matchups.push({
        side,
        teamName: team.teamName,
        pitcher: null,
        pitcherTeam: opponent.teamName,
        error: 'Probable pitcher not yet announced',
        batters: [],
      });
      continue;
    }

    if (!team.lineup?.length) {
      matchups.push({
        side,
        teamName: team.teamName,
        pitcher: { id: pitcher.id, name: pitcher.name },
        pitcherTeam: opponent.teamName,
        error: 'Lineup not yet posted',
        batters: [],
      });
      continue;
    }

    // Fetch all BvP in parallel — fetchSavantBvP has built-in retries
    const batters = team.lineup;
    totalBatters += batters.length;
    const bvpResults = await Promise.all(
      batters.map(b =>
        fetchSavantBvP(b.id, pitcher.id, options).catch(err => ({
          batterId: b.id,
          pitcherId: pitcher.id,
          error: err.message,
          pa: 0, ab: 0, hits: 0, hr: 0, bb: 0, k: 0,
          avg: 0, obp: 0, slg: 0, ops: 0,
          totalPitches: 0, gamesPlayed: 0, lastFaced: null,
        }))
      )
    );

    bvpResults.forEach(r => {
      if (r.error) failedBatters++;
      else resolvedBatters++;
    });

    // Attach weather to each per-game BvP entry. All batters in this matchup
    // share the same gamePks (same games), so caching makes this ~1 fetch per
    // unique game rather than per batter.
    await Promise.all(bvpResults.map(async r => {
      if (r.gameByGame?.length) {
        r.gameByGame = await enrichBvpGamesWithWeather(r.gameByGame);
      }
    }));

    const batterDetails = batters.map((b, i) => ({
      id: b.id,
      name: b.name,
      position: b.position,
      order: b.order,
      bvp: bvpResults[i],
    }));

    matchups.push({
      side,
      teamName: team.teamName,
      pitcher: { id: pitcher.id, name: pitcher.name },
      pitcherTeam: opponent.teamName,
      batters: batterDetails,
    });
  }

  // Infer lineup status for frontend auto-refresh decisions
  const awayFull = lineups.away.lineup.length >= 9 && lineups.away.probablePitcher;
  const homeFull = lineups.home.lineup.length >= 9 && lineups.home.probablePitcher;
  const lineupStatus = awayFull && homeFull
    ? 'confirmed'
    : (lineups.away.lineup.length || lineups.home.lineup.length) ? 'partial' : 'pending';

  return {
    gamePk,
    matchups,
    status: {
      lineupStatus,           // 'confirmed' | 'partial' | 'pending'
      totalBatters,
      resolvedBatters,
      failedBatters,
      awayLineupPosted: lineups.away.lineup.length >= 9,
      homeLineupPosted: lineups.home.lineup.length >= 9,
      awayPitcherPosted: !!lineups.away.probablePitcher,
      homePitcherPosted: !!lineups.home.probablePitcher,
    },
    source: 'Baseball Savant Statcast + MLB Stats API',
    cachedAt: new Date().toISOString(),
  };
}


// ══════════════════════════════════════════════════════════
//  TEAM ABBREVIATION MAP — ESPN and MLB use the same abbrs
//  (ATL, NYY, LAD, etc.) so we can bridge ESPN gamelog data
//  to MLB gamePk → weather without a name match.
// ══════════════════════════════════════════════════════════

async function getMlbTeamsByAbbr() {
  const cacheKey = 'mlb_teams_by_abbr';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const data = await fetchJson(`${MLB_API}/teams?sportId=1`);
    const map = {};
    for (const t of data.teams || []) {
      if (t.abbreviation) map[t.abbreviation.toUpperCase()] = { id: t.id, name: t.name };
    }
    cacheSet(cacheKey, map, 24 * 60 * 60 * 1000); // 24h — team list is static
    return map;
  } catch (err) {
    return {};
  }
}

// Given a date and a team abbreviation, find the MLB gamePk for that team's
// game on that day. Doubleheaders pick the first game listed.
async function findGamePkByAbbrDate(teamAbbr, date) {
  if (!teamAbbr || !date) return null;
  const teams = await getMlbTeamsByAbbr();
  const team = teams[teamAbbr.toUpperCase()];
  if (!team) return null;
  const cacheKey = `gamepk_${team.id}_${date}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null) return cached;
  try {
    const data = await fetchJson(`${MLB_API}/schedule?sportId=1&date=${date}&teamId=${team.id}`);
    const games = (data.dates?.[0]?.games) || [];
    const gamePk = games[0]?.gamePk || null;
    cacheSet(cacheKey, gamePk, CACHE_TTL);
    return gamePk;
  } catch (err) {
    return null;
  }
}


// ══════════════════════════════════════════════════════════
//  TEAM NAME MATCHING — map ESPN names to MLB gamePk
// ══════════════════════════════════════════════════════════

function normalizeTeamName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '');
}

function matchTeams(games, aq, hq) {
  for (const g of games) {
    const gAway = normalizeTeamName(g.away.name);
    const gHome = normalizeTeamName(g.home.name);
    if ((gAway.includes(aq) || aq.includes(gAway)) &&
        (gHome.includes(hq) || hq.includes(gHome))) {
      return g.gamePk;
    }
  }
  return null;
}

function offsetDate(dateStr, days) {
  // dateStr = 'YYYY-MM-DD', days = -1 for yesterday, +1 for tomorrow
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function findGamePkByTeams(awayName, homeName, date) {
  const aq = normalizeTeamName(awayName);
  const hq = normalizeTeamName(homeName);

  // Build list of dates to search: given date, yesterday, today, tomorrow
  const today = getLocalDate();
  const candidates = [...new Set([
    date,
    date ? offsetDate(date, -1) : null,
    today,
    offsetDate(today, -1),
    offsetDate(today, 1),
  ].filter(Boolean))];

  for (const d of candidates) {
    const games = await getGames(d).catch(() => []);
    const gamePk = matchTeams(games, aq, hq);
    if (gamePk) return gamePk;
  }
  return null;
}


// ══════════════════════════════════════════════════════════
//  HTTP SERVER
// ══════════════════════════════════════════════════════════

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, message, status = 400) {
  sendJson(res, { error: message }, status);
}

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // GET /api/mlb/games?date=2026-04-13 — games for a date (defaults to today)
    if (path === '/api/mlb/games') {
      const date = url.searchParams.get('date') || undefined;
      const games = await getGames(date);
      return sendJson(res, { games });
    }

    // GET /api/mlb/lineups?gamePk=...&refresh=1
    if (path === '/api/mlb/lineups') {
      const gamePk = url.searchParams.get('gamePk');
      if (!gamePk) return sendError(res, 'gamePk required');
      const refresh = url.searchParams.get('refresh') === '1';
      const lineups = await getGameLineups(gamePk, { refresh });
      return sendJson(res, lineups);
    }

    // GET /api/mlb/bvp?batterId=...&pitcherId=...&refresh=1
    if (path === '/api/mlb/bvp') {
      const batterId = url.searchParams.get('batterId');
      const pitcherId = url.searchParams.get('pitcherId');
      if (!batterId || !pitcherId) return sendError(res, 'batterId and pitcherId required');
      const refresh = url.searchParams.get('refresh') === '1';
      const bvp = await fetchSavantBvP(batterId, pitcherId, { refresh });
      return sendJson(res, bvp);
    }

    // GET /api/mlb/game-bvp?gamePk=... OR ?away=...&home=...&date=2026-04-13
    // Optional: &awayLineup=Name1,Name2,...&homeLineup=... to supply lineup when
    // MLB boxscore hasn't posted battingOrder yet (e.g. ESPN already has it).
    // Add &refresh=1 to bypass caches.
    if (path === '/api/mlb/game-bvp') {
      let gamePk = url.searchParams.get('gamePk');
      if (!gamePk) {
        const away = url.searchParams.get('away');
        const home = url.searchParams.get('home');
        const date = url.searchParams.get('date') || undefined;
        if (!away || !home) return sendError(res, 'gamePk or away+home team names required');
        gamePk = await findGamePkByTeams(away, home, date);
        if (!gamePk) return sendError(res, `No game found for ${away} @ ${home}`, 404);
      }
      const refresh = url.searchParams.get('refresh') === '1';
      const parseLineup = param => {
        const v = url.searchParams.get(param);
        return v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined;
      };
      const awayLineup = parseLineup('awayLineup');
      const homeLineup = parseLineup('homeLineup');
      const awayPitcher = url.searchParams.get('awayPitcher') || undefined;
      const homePitcher = url.searchParams.get('homePitcher') || undefined;
      const result = await getGameBvp(gamePk, { refresh, awayLineup, homeLineup, awayPitcher, homePitcher });
      return sendJson(res, result);
    }

    // GET /api/mlb/weather?date=YYYY-MM-DD&teamAbbr=ATL
    // Returns weather for that team's game on that date (condition/temp/wind/venue).
    // Used by the frontend to decorate each L5 game in the MLB Edge Finder.
    if (path === '/api/mlb/weather') {
      const date = url.searchParams.get('date');
      const teamAbbr = url.searchParams.get('teamAbbr');
      if (!date || !teamAbbr) return sendError(res, 'date and teamAbbr required');
      const gamePk = await findGamePkByAbbrDate(teamAbbr, date);
      if (!gamePk) return sendJson(res, { weather: null, gamePk: null });
      const weather = await fetchGameWeather(gamePk);
      return sendJson(res, { weather, gamePk });
    }

    // Health check
    if (path === '/api/health') {
      return sendJson(res, { status: 'ok', cache_size: cache.size });
    }

    sendError(res, 'Not found', 404);
  } catch (err) {
    console.error(`[ERROR] ${path}:`, err.message);
    sendError(res, err.message, 500);
  }
});

server.listen(PORT, () => {
  const now = new Date().toLocaleString('en-US', { timeZoneName: 'short' });
  console.log(`[${now}] PlayIQ server running on http://localhost:${PORT}`);
});

// ── Keep alive — catch unhandled errors so server never crashes ──
process.on('uncaughtException', err => {
  console.error('[UNCAUGHT]', err.message);
});
process.on('unhandledRejection', reason => {
  console.error('[UNHANDLED REJECTION]', reason);
});
