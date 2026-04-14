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

async function getGamesToday() {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `games_${today}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await fetchJson(`${MLB_API}/schedule?sportId=1&date=${today}&hydrate=probablePitcher`);
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

async function getGameLineups(gamePk) {
  const cacheKey = `lineup_${gamePk}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

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

    const lineup = battingOrder.slice(0, 9).map((pid, idx) => {
      const p = players[`ID${pid}`] || {};
      const person = p.person || {};
      return {
        id: pid,
        name: person.fullName || `Player ${pid}`,
        position: p.position?.abbreviation || '?',
        order: idx + 1,
      };
    });

    const pp = probablePitchers[side];
    result[side] = {
      teamId: team.team?.id,
      teamName: team.team?.name,
      lineup,
      probablePitcher: pp ? { id: pp.id, name: pp.fullName } : null,
    };
  }

  cacheSet(cacheKey, result, LIVE_CACHE_TTL);
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

async function fetchSavantBvP(batterId, pitcherId) {
  const cacheKey = `bvp_${batterId}_${pitcherId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `https://baseballsavant.mlb.com/statcast_search/csv?all=true`
    + `&player_type=batter`
    + `&batters_lookup%5B%5D=${batterId}`
    + `&pitchers_lookup%5B%5D=${pitcherId}`
    + `&game_date_gt=2015-01-01`
    + `&game_date_lt=2026-12-31`
    + `&type=details`
    + `&min_pitches=0&min_results=0&min_pas=0`;

  const text = await fetchUrl(url);
  const pitches = parseCsv(text);
  const summary = summarizeBvP(pitches, batterId, pitcherId);
  cacheSet(cacheKey, summary);
  return summary;
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

    // Track per-game results
    if (!gameResults[gameDate]) gameResults[gameDate] = [];
    gameResults[gameDate].push(ev);
  }

  const avg = ab > 0 ? (hits / ab) : 0;
  const obp = (ab + bb + hbp + sf) > 0 ? ((hits + bb + hbp) / (ab + bb + hbp + sf)) : 0;
  const slg = ab > 0 ? ((singles + doubles * 2 + triples * 3 + hr * 4) / ab) : 0;

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
  };
}


// ══════════════════════════════════════════════════════════
//  HIGH-LEVEL: getGameBvp(gamePk)
//  Returns BvP for every batter vs opposing starter
// ══════════════════════════════════════════════════════════

async function getGameBvp(gamePk) {
  const lineups = await getGameLineups(gamePk);

  const matchups = [];

  for (const [side, oppSide] of [['away', 'home'], ['home', 'away']]) {
    const team = lineups[side];
    const opponent = lineups[oppSide];
    const pitcher = opponent.probablePitcher;

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

    // Fetch all BvP in parallel (with concurrency limit)
    const batters = team.lineup;
    const bvpResults = await Promise.all(
      batters.map(b =>
        fetchSavantBvP(b.id, pitcher.id).catch(err => ({
          batterId: b.id,
          pitcherId: pitcher.id,
          error: err.message,
          pa: 0, ab: 0, hits: 0, hr: 0, bb: 0, k: 0,
          avg: 0, obp: 0, slg: 0, ops: 0,
          totalPitches: 0, gamesPlayed: 0, lastFaced: null,
        }))
      )
    );

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

  return {
    gamePk,
    matchups,
    source: 'Baseball Savant Statcast + MLB Stats API',
    cachedAt: new Date().toISOString(),
  };
}


// ══════════════════════════════════════════════════════════
//  TEAM NAME MATCHING — map ESPN names to MLB gamePk
// ══════════════════════════════════════════════════════════

function normalizeTeamName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '');
}

async function findGamePkByTeams(awayName, homeName) {
  const games = await getGamesToday();
  const aq = normalizeTeamName(awayName);
  const hq = normalizeTeamName(homeName);

  // Try exact-ish match first
  for (const g of games) {
    const gAway = normalizeTeamName(g.away.name);
    const gHome = normalizeTeamName(g.home.name);
    if ((gAway.includes(aq) || aq.includes(gAway)) &&
        (gHome.includes(hq) || hq.includes(gHome))) {
      return g.gamePk;
    }
  }
  // Try partial word match
  for (const g of games) {
    const gAway = normalizeTeamName(g.away.name);
    const gHome = normalizeTeamName(g.home.name);
    const awayWords = aq.length > 3 ? [aq] : [];
    const homeWords = hq.length > 3 ? [hq] : [];
    if (awayWords.some(w => gAway.includes(w)) && homeWords.some(w => gHome.includes(w))) {
      return g.gamePk;
    }
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
    // GET /api/mlb/games — today's games
    if (path === '/api/mlb/games') {
      const games = await getGamesToday();
      return sendJson(res, { games });
    }

    // GET /api/mlb/lineups?gamePk=...
    if (path === '/api/mlb/lineups') {
      const gamePk = url.searchParams.get('gamePk');
      if (!gamePk) return sendError(res, 'gamePk required');
      const lineups = await getGameLineups(gamePk);
      return sendJson(res, lineups);
    }

    // GET /api/mlb/bvp?batterId=...&pitcherId=...
    if (path === '/api/mlb/bvp') {
      const batterId = url.searchParams.get('batterId');
      const pitcherId = url.searchParams.get('pitcherId');
      if (!batterId || !pitcherId) return sendError(res, 'batterId and pitcherId required');
      const bvp = await fetchSavantBvP(batterId, pitcherId);
      return sendJson(res, bvp);
    }

    // GET /api/mlb/game-bvp?gamePk=... OR ?away=...&home=...
    if (path === '/api/mlb/game-bvp') {
      let gamePk = url.searchParams.get('gamePk');
      if (!gamePk) {
        const away = url.searchParams.get('away');
        const home = url.searchParams.get('home');
        if (!away || !home) return sendError(res, 'gamePk or away+home team names required');
        gamePk = await findGamePkByTeams(away, home);
        if (!gamePk) return sendError(res, `No game found for ${away} @ ${home}`, 404);
      }
      const result = await getGameBvp(gamePk);
      return sendJson(res, result);
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
  console.log(`PlayIQ server running on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET /api/mlb/games         — today\'s games');
  console.log('  GET /api/mlb/lineups       — game lineups (gamePk)');
  console.log('  GET /api/mlb/bvp           — single BvP (batterId, pitcherId)');
  console.log('  GET /api/mlb/game-bvp      — full game BvP (gamePk)');
  console.log('  GET /api/health            — health check');
});
