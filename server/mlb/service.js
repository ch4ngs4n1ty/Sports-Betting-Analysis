const { cacheGet, cacheSet, CACHE_TTL, LIVE_CACHE_TTL } = require('../shared/cache');
const { fetchUrl, fetchJson } = require('../shared/http');

const MLB_API = 'https://statsapi.mlb.com/api/v1';
const UNCONFIRMED_LINEUP_TTL = 30 * 1000;
const CONFIRMED_LINEUP_TTL = 30 * 60 * 1000;
const WEATHER_TTL = 24 * 60 * 60 * 1000;

function getLocalDate() {
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

function normalizeName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lastNameKey(s) {
  const parts = normalizeName(s).split(' ');
  return parts[parts.length - 1] || '';
}

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
      const entry = { id: person.id, name: person.fullName, position: p.position?.abbreviation || '?' };
      const fullKey = normalizeName(person.fullName);
      if (fullKey) byFull[fullKey] = entry;
      const lastKey = lastNameKey(person.fullName);
      if (lastKey) byLast[lastKey] = byLast[lastKey] === undefined ? entry : null;
    }
    const map = { byFull, byLast };
    cacheSet(cacheKey, map, CONFIRMED_LINEUP_TTL);
    return map;
  } catch {
    return { byFull: {}, byLast: {} };
  }
}

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
      return { id: pid, name: person.fullName || `Player ${pid}`, position: p.position?.abbreviation || '?', order: idx + 1 };
    });

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
      }).filter(b => b.id);
    }

    const pp = probablePitchers[side];
    result[side] = {
      teamId: team.team?.id,
      teamName: team.team?.name,
      lineup,
      probablePitcher: pp ? { id: pp.id, name: pp.fullName } : null,
    };
  }

  const fullyLoaded = result.away.lineup.length >= 9 && result.home.lineup.length >= 9 && result.away.probablePitcher && result.home.probablePitcher;
  const ttl = fullyLoaded ? CONFIRMED_LINEUP_TTL : UNCONFIRMED_LINEUP_TTL;
  cacheSet(cacheKey, result, ttl);
  return result;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { result.push(current); current = ''; }
    else current += ch;
  }
  result.push(current);
  return result;
}

function parseCsv(text) {
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

function summarizeBvP(pitches, batterId, pitcherId) {
  let pa = 0, ab = 0, hits = 0, hr = 0, doubles = 0, triples = 0, singles = 0;
  let bb = 0, k = 0, hbp = 0, sf = 0;
  const gameResults = {};

  for (const p of pitches) {
    const ev = (p.events || '').trim();
    if (!ev) continue;
    pa++;
    const gameDate = p.game_date || '';
    const gamePk = p.game_pk || null;

    switch (ev) {
      case 'single': singles++; hits++; ab++; break;
      case 'double': doubles++; hits++; ab++; break;
      case 'triple': triples++; hits++; ab++; break;
      case 'home_run': hr++; hits++; ab++; break;
      case 'strikeout':
      case 'strikeout_double_play': k++; ab++; break;
      case 'walk':
      case 'intent_walk': bb++; break;
      case 'hit_by_pitch': hbp++; break;
      case 'sac_fly':
      case 'sac_fly_double_play': sf++; break;
      case 'sac_bunt':
      case 'sac_bunt_double_play': break;
      default: ab++;
    }

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
      case 'strikeout':
      case 'strikeout_double_play': gm.k++; gm.ab++; break;
      case 'walk':
      case 'intent_walk': gm.bb++; break;
      case 'hit_by_pitch': gm.hbp++; break;
      case 'sac_fly':
      case 'sac_fly_double_play': gm.sf++; break;
      case 'sac_bunt':
      case 'sac_bunt_double_play': break;
      default: gm.ab++;
    }
  }

  const avg = ab > 0 ? hits / ab : 0;
  const obp = (ab + bb + hbp + sf) > 0 ? ((hits + bb + hbp) / (ab + bb + hbp + sf)) : 0;
  const slg = ab > 0 ? ((singles + doubles * 2 + triples * 3 + hr * 4) / ab) : 0;

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
    pa, ab, hits, singles, doubles, triples, hr, bb, k, hbp, sf,
    avg: Number(avg.toFixed(3)),
    obp: Number(obp.toFixed(3)),
    slg: Number(slg.toFixed(3)),
    ops: Number((obp + slg).toFixed(3)),
    gamesPlayed: Object.keys(gameResults).length,
    lastFaced: Object.keys(gameResults).sort().pop() || null,
    gameByGame,
  };
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
      if (attempt < 2) await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

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
  } catch {
    cacheSet(cacheKey, null, WEATHER_TTL);
    return null;
  }
}

async function enrichBvpGamesWithWeather(gameByGame) {
  if (!gameByGame?.length) return gameByGame;
  const pks = [...new Set(gameByGame.map(g => g.gamePk).filter(Boolean))];
  const weatherByPk = {};
  await Promise.all(pks.map(async pk => { weatherByPk[pk] = await fetchGameWeather(pk); }));
  return gameByGame.map(g => ({ ...g, weather: g.gamePk ? weatherByPk[g.gamePk] || null : null }));
}

async function getGameBvp(gamePk, options = {}) {
  const lineups = await getGameLineups(gamePk, options);
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
      matchups.push({ side, teamName: team.teamName, pitcher: null, pitcherTeam: opponent.teamName, error: 'Probable pitcher not yet announced', batters: [] });
      continue;
    }
    if (!team.lineup?.length) {
      matchups.push({ side, teamName: team.teamName, pitcher: { id: pitcher.id, name: pitcher.name }, pitcherTeam: opponent.teamName, error: 'Lineup not yet posted', batters: [] });
      continue;
    }

    const batters = team.lineup;
    totalBatters += batters.length;
    const bvpResults = await Promise.all(
      batters.map(b =>
        fetchSavantBvP(b.id, pitcher.id, options).catch(err => ({
          batterId: b.id, pitcherId: pitcher.id, error: err.message,
          pa: 0, ab: 0, hits: 0, hr: 0, bb: 0, k: 0,
          avg: 0, obp: 0, slg: 0, ops: 0,
          totalPitches: 0, gamesPlayed: 0, lastFaced: null,
        }))
      )
    );

    bvpResults.forEach(r => { if (r.error) failedBatters++; else resolvedBatters++; });
    await Promise.all(bvpResults.map(async r => { if (r.gameByGame?.length) r.gameByGame = await enrichBvpGamesWithWeather(r.gameByGame); }));

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

  const awayFull = lineups.away.lineup.length >= 9 && lineups.away.probablePitcher;
  const homeFull = lineups.home.lineup.length >= 9 && lineups.home.probablePitcher;
  const lineupStatus = awayFull && homeFull ? 'confirmed' : (lineups.away.lineup.length || lineups.home.lineup.length) ? 'partial' : 'pending';

  return {
    gamePk,
    matchups,
    status: {
      lineupStatus,
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
    cacheSet(cacheKey, map, 24 * 60 * 60 * 1000);
    return map;
  } catch {
    return {};
  }
}

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
    const games = data.dates?.[0]?.games || [];
    const gamePk = games[0]?.gamePk || null;
    cacheSet(cacheKey, gamePk, CACHE_TTL);
    return gamePk;
  } catch {
    return null;
  }
}

function normalizeTeamName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '');
}

function matchTeams(games, aq, hq) {
  for (const g of games) {
    const gAway = normalizeTeamName(g.away.name);
    const gHome = normalizeTeamName(g.home.name);
    if ((gAway.includes(aq) || aq.includes(gAway)) && (gHome.includes(hq) || hq.includes(gHome))) return g.gamePk;
  }
  return null;
}

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function findGamePkByTeams(awayName, homeName, date) {
  const aq = normalizeTeamName(awayName);
  const hq = normalizeTeamName(homeName);
  const today = getLocalDate();
  const candidates = [...new Set([date, date ? offsetDate(date, -1) : null, today, offsetDate(today, -1), offsetDate(today, 1)].filter(Boolean))];
  for (const d of candidates) {
    const games = await getGames(d).catch(() => []);
    const gamePk = matchTeams(games, aq, hq);
    if (gamePk) return gamePk;
  }
  return null;
}

/* ── HIGH-CONTACT PITCHING REPORT ───────────────────────
   Backend for the MLB game-detail "HIGH CONTACT" tab.
   Pulls pitcher current/prev season stats, Savant pitch arsenal,
   opposing-team splits vs the pitcher's hand, bullpen aggregate,
   weather, and a lineup BvP summary. Combines into a 0-100
   hit-risk score with weighted sub-signals.
   ──────────────────────────────────────────────────────── */

const PITCHER_STATS_TTL = 6 * 60 * 60 * 1000;   // 6h
const ARSENAL_TTL = 24 * 60 * 60 * 1000;        // 24h (league CSV)
const TEAM_SPLITS_TTL = 6 * 60 * 60 * 1000;
const BULLPEN_TTL = 60 * 60 * 1000;             // 1h (workload changes daily)

function currentMlbSeason() {
  const d = new Date();
  // MLB season runs Mar–Oct; before March use previous year as 'current'.
  return d.getMonth() < 2 ? d.getFullYear() - 1 : d.getFullYear();
}

function pickPitchingLine(splits) {
  // MLB Stats API season-stat splits are an array; the season aggregate
  // is the one with no `team` filter narrowing. We just take the first.
  const line = splits?.[0]?.stat || {};
  const num = v => (v == null || v === '' || v === '-.--' || v === '.---') ? null : Number(v);
  return {
    era:        num(line.era),
    whip:       num(line.whip),
    ip:         num(line.inningsPitched),
    gs:         num(line.gamesStarted),
    gp:         num(line.gamesPlayed),
    hits:       num(line.hits),
    h9:         num(line.hitsPer9Inn),
    bb9:        num(line.walksPer9Inn),
    k9:         num(line.strikeoutsPer9Inn),
    oppAvg:     num(line.avg),
    oppObp:     num(line.obp),
    oppSlg:     num(line.slg),
    oppOps:     num(line.ops),
    hrPer9:     num(line.homeRunsPer9),
    record:     (line.wins != null && line.losses != null) ? `${line.wins}-${line.losses}` : null,
    throws:     line.pitchHand?.code || null,
  };
}

async function fetchPitcherSeason(pitcherId, season) {
  // season aggregate
  const url = `${MLB_API}/people/${pitcherId}/stats?stats=season&group=pitching&season=${season}`;
  try {
    const data = await fetchJson(url);
    return pickPitchingLine(data?.stats?.[0]?.splits || []);
  } catch { return null; }
}

async function fetchPitcherSplits(pitcherId, season) {
  // home/away splits — sitCodes: h (home), a (away), vr (vs RHB), vl (vs LHB)
  const url = `${MLB_API}/people/${pitcherId}/stats?stats=statSplits&group=pitching&season=${season}&sitCodes=h,a,vr,vl`;
  try {
    const data = await fetchJson(url);
    const splits = data?.stats?.[0]?.splits || [];
    const byCode = {};
    for (const s of splits) {
      const code = s.split?.code;
      if (!code) continue;
      byCode[code] = pickPitchingLine([s]);
    }
    return byCode; // { h, a, vr, vl }
  } catch { return {}; }
}

async function getPitcherStats(pitcherId, season) {
  if (!pitcherId) return null;
  const cacheKey = `pitcher_stats_${pitcherId}_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const cur = season;
  const prev = season - 1;
  const [current, previous, splits] = await Promise.all([
    fetchPitcherSeason(pitcherId, cur),
    fetchPitcherSeason(pitcherId, prev),
    fetchPitcherSplits(pitcherId, cur),
  ]);

  // Pull throws hand from /people if not captured in splits
  let throws = current?.throws || previous?.throws || null;
  if (!throws) {
    try {
      const p = await fetchJson(`${MLB_API}/people/${pitcherId}`);
      throws = p?.people?.[0]?.pitchHand?.code || null;
    } catch {}
  }

  const result = {
    pitcherId: Number(pitcherId),
    throws,                                       // 'R' | 'L'
    current,                                      // current season aggregate
    previous,                                     // prev season aggregate
    home: splits.h || null,
    away: splits.a || null,
    vsRHB: splits.vr || null,
    vsLHB: splits.vl || null,
  };
  cacheSet(cacheKey, result, PITCHER_STATS_TTL);
  return result;
}

/* ── Savant pitch-arsenal: league CSV cached, lookup by id ──
   Endpoint returns one row per (pitcher_id, pitch_type) with
   usage%, BA-allowed, SLG-allowed, xwOBA, whiff%, hard-hit%. */
async function getArsenalIndex(season) {
  const cacheKey = `arsenal_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats`
    + `?type=pitcher&pitchType=&year=${season}&team=&min=1&csv=true`;

  try {
    const text = await fetchUrl(url);
    const rows = parseCsv(text);
    const byPitcher = {};
    for (const r of rows) {
      const pid = r.player_id || r.pitcher_id || r.id;
      if (!pid) continue;
      if (!byPitcher[pid]) byPitcher[pid] = { name: r['last_name, first_name'] || r.player_name || null, pitches: [] };
      byPitcher[pid].pitches.push({
        type:      r.pitch_type || r.pitch_name || '?',
        name:      r.pitch_name || r.pitch_type || '?',
        usage:     Number(r.pitch_usage ?? r.pitches ?? 0) || 0,
        ba:        r.ba       ? Number(r.ba)       : null,
        slg:       r.slg      ? Number(r.slg)      : null,
        woba:      r.woba     ? Number(r.woba)     : null,
        xwoba:     r.est_woba ? Number(r.est_woba) : (r.xwoba ? Number(r.xwoba) : null),
        whiffPct:  r.whiff_percent ? Number(r.whiff_percent) : null,
        hardHit:   r.hard_hit_percent ? Number(r.hard_hit_percent) : null,
      });
    }
    cacheSet(cacheKey, byPitcher, ARSENAL_TTL);
    return byPitcher;
  } catch {
    cacheSet(cacheKey, {}, 30 * 60 * 1000); // shorter TTL on failure
    return {};
  }
}

async function getPitcherArsenal(pitcherId, season) {
  if (!pitcherId) return [];
  const index = await getArsenalIndex(season);
  const entry = index[pitcherId] || index[String(pitcherId)];
  if (!entry?.pitches?.length) return [];
  // Sort by usage descending; keep up to 6 pitches.
  return entry.pitches.slice().sort((a, b) => (b.usage || 0) - (a.usage || 0)).slice(0, 6);
}

/* ── Team batting splits vs RHP / LHP ─────────────────── */
async function getTeamHandSplits(teamId, season) {
  if (!teamId) return null;
  const cacheKey = `team_hand_${teamId}_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const url = `${MLB_API}/teams/${teamId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=vr,vl`;
  try {
    const data = await fetchJson(url);
    const splits = data?.stats?.[0]?.splits || [];
    const byCode = {};
    const num = v => (v == null || v === '' || v === '.---' || v === '-.--') ? null : Number(v);
    for (const s of splits) {
      const code = s.split?.code;
      const st = s.stat || {};
      if (!code) continue;
      byCode[code] = {
        avg: num(st.avg),
        obp: num(st.obp),
        slg: num(st.slg),
        ops: num(st.ops),
        kPct: st.atBats ? Math.round((Number(st.strikeOuts || 0) / Number(st.atBats)) * 1000) / 10 : null,
        bbPct: st.plateAppearances ? Math.round((Number(st.baseOnBalls || 0) / Number(st.plateAppearances)) * 1000) / 10 : null,
      };
    }
    const result = { vsR: byCode.vr || null, vsL: byCode.vl || null };
    cacheSet(cacheKey, result, TEAM_SPLITS_TTL);
    return result;
  } catch { return null; }
}

/* ── Bullpen status ───────────────────────────────────── */
async function getBullpenStats(teamId, season) {
  if (!teamId) return null;
  const cacheKey = `bullpen_${teamId}_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  // playerPool=Bullpen is not honored by the API; fetch all team pitchers and
  // filter by role locally: relievers have ≤2 starts and ≥5 appearances.
  const url = `${MLB_API}/stats?stats=season&group=pitching&teamId=${teamId}&season=${season}`
    + `&gameType=R&playerPool=ALL&limit=200`;
  try {
    const data = await fetchJson(url);
    const allPitchers = data?.stats?.[0]?.splits || [];
    const relievers = allPitchers.filter(s => {
      const st = s.stat || {};
      const gs = Number(st.gamesStarted || 0);
      const gp = Number(st.gamesPlayed || 0);
      return gs <= 2 && gp >= 3;
    });
    if (!relievers.length) {
      cacheSet(cacheKey, null, BULLPEN_TTL);
      return null;
    }
    let totalIP = 0, totalER = 0, totalH = 0, totalBB = 0, totalK = 0, totalBF = 0;
    for (const s of relievers) {
      const st = s.stat || {};
      const ip = Number(st.inningsPitched || 0);
      const er = Number(st.earnedRuns || 0);
      const h  = Number(st.hits || 0);
      const bb = Number(st.baseOnBalls || 0);
      const k  = Number(st.strikeOuts || 0);
      const bf = Number(st.battersFaced || 0);
      totalIP += ip; totalER += er; totalH += h; totalBB += bb; totalK += k; totalBF += bf;
    }
    const era = totalIP > 0 ? Math.round((totalER * 9 / totalIP) * 100) / 100 : null;
    const whip = totalIP > 0 ? Math.round(((totalH + totalBB) / totalIP) * 100) / 100 : null;
    const kPct = totalBF > 0 ? Math.round((totalK / totalBF) * 1000) / 10 : null;
    const result = { era, whip, kPct, ip: Math.round(totalIP * 10) / 10, relieverCount: relievers.length };
    cacheSet(cacheKey, result, BULLPEN_TTL);
    return result;
  } catch { return null; }
}

/* ── Risk scoring ─────────────────────────────────────── */
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

// All sub-scores normalized to 0-100 (higher = more hit risk).
function scorePitcherTraffic(stats) {
  // WHIP and H/9 are the load-bearing stats. K% reduces traffic.
  const cur = stats?.current;
  if (!cur || cur.whip == null) return null;
  const whip = cur.whip;
  const h9 = cur.h9 ?? 8.5;
  const k9 = cur.k9 ?? 8.5;
  // Anchors: WHIP 1.10 → 0, 1.60 → 100. H/9 7 → 0, 11 → 100. K/9 inverse: 11 → 0, 5 → 100.
  const whipScore = clamp((whip - 1.10) / (1.60 - 1.10) * 100, 0, 100);
  const h9Score   = clamp((h9 - 7.0) / (11.0 - 7.0) * 100, 0, 100);
  const k9Score   = clamp((11.0 - k9) / (11.0 - 5.0) * 100, 0, 100);
  return Math.round(whipScore * 0.5 + h9Score * 0.35 + k9Score * 0.15);
}

function scorePitchTypeWeakness(arsenal) {
  if (!arsenal?.length) return null;
  // Weighted by usage. xwOBA league avg ≈ 0.310. .280 → 0, .400 → 100.
  let usageSum = 0, weightedXwoba = 0, worstXwoba = 0;
  for (const p of arsenal) {
    const u = p.usage || 0;
    if (p.xwoba == null) continue;
    usageSum += u;
    weightedXwoba += p.xwoba * u;
    if (u >= 10 && p.xwoba > worstXwoba) worstXwoba = p.xwoba;
  }
  if (usageSum < 50) return null;
  const wXwoba = weightedXwoba / usageSum;
  const wScore = clamp((wXwoba - 0.280) / (0.400 - 0.280) * 100, 0, 100);
  const worstScore = worstXwoba ? clamp((worstXwoba - 0.300) / (0.430 - 0.300) * 100, 0, 100) : 0;
  // Blend the weighted-average pitch quality with the single worst high-usage pitch.
  return Math.round(wScore * 0.65 + worstScore * 0.35);
}

function scoreOppVsHand(teamSplits, throws) {
  if (!teamSplits || !throws) return null;
  const side = throws === 'L' ? teamSplits.vsL : teamSplits.vsR;
  if (!side || side.ops == null) return null;
  // OPS .650 → 0, .850 → 100.
  return Math.round(clamp((side.ops - 0.650) / (0.850 - 0.650) * 100, 0, 100));
}

function scoreLineupStrength(lineupBvp) {
  // lineupBvp = { avgOps, samplePa, batters: [{ops, pa}, ...] }
  // Without team-vs-hand-individualized hitter OPS we proxy lineup strength
  // by the lineup's BvP OPS against this exact pitcher (richer than season OPS).
  if (!lineupBvp || !lineupBvp.batters?.length) return null;
  const opsList = lineupBvp.batters.map(b => b.ops).filter(v => v != null);
  if (!opsList.length) return null;
  const avgOps = opsList.reduce((a, b) => a + b, 0) / opsList.length;
  return Math.round(clamp((avgOps - 0.500) / (1.000 - 0.500) * 100, 0, 100));
}

function scoreWeather(weather) {
  if (!weather) return null;
  // Domes neutralize wind/temp; assume park-average baseline.
  if (weather.roofType && /indoor|closed|dome/i.test(weather.roofType)) return 50;
  const temp = weather.temp;
  const windStr = String(weather.wind || '');
  const windMph = parseInt(windStr) || 0;
  const blowingOut = /out|to (cf|rf|lf)/i.test(windStr);
  const blowingIn  = /in|from (cf|rf|lf)/i.test(windStr);
  let score = 50;
  if (temp != null) {
    if (temp >= 85) score += 18;
    else if (temp >= 75) score += 10;
    else if (temp <= 50) score -= 18;
    else if (temp <= 60) score -= 8;
  }
  if (blowingOut) score += Math.min(20, windMph * 1.5);
  if (blowingIn)  score -= Math.min(20, windMph * 1.5);
  return Math.round(clamp(score, 0, 100));
}

function scoreBvP(lineupBvp) {
  if (!lineupBvp || !lineupBvp.batters?.length) return null;
  const opsList = lineupBvp.batters.map(b => b.ops).filter(v => v != null);
  const paList  = lineupBvp.batters.map(b => b.pa).filter(v => v != null);
  if (!opsList.length) return null;
  const totalPa = paList.reduce((a, b) => a + b, 0);
  // Confidence shrinks if total PA is small (< 60 PA across whole lineup).
  const conf = clamp(totalPa / 60, 0.2, 1.0);
  const avgOps = opsList.reduce((a, b) => a + b, 0) / opsList.length;
  const raw = clamp((avgOps - 0.500) / (1.000 - 0.500) * 100, 0, 100);
  return Math.round(raw * conf + 50 * (1 - conf));
}

const HC_WEIGHTS = {
  pitcherTraffic: 0.28,
  pitchType:      0.23,
  oppVsHand:      0.17,
  lineupStrength: 0.17,
  weather:        0.10,
  bvp:            0.05,
};

function combineRisk(parts) {
  // Each part is { score: 0-100 | null, weight }. Renormalize over present parts.
  let totalW = 0, totalS = 0;
  for (const p of parts) {
    if (p.score == null) continue;
    totalW += p.weight;
    totalS += p.score * p.weight;
  }
  if (totalW === 0) return { score: null, level: 'UNKNOWN' };
  const score = Math.round(totalS / totalW);
  const level = score >= 65 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  return { score, level };
}

function summarizeLineupBvp(matchup) {
  if (!matchup?.batters?.length) return null;
  const batters = matchup.batters
    .filter(b => b.bvp && !b.bvp.error)
    .map(b => ({
      name: b.name,
      pa:  b.bvp?.pa  ?? 0,
      ab:  b.bvp?.ab  ?? 0,
      avg: b.bvp?.avg ?? null,
      ops: b.bvp?.ops ?? null,
    }));
  const totalPa = batters.reduce((a, b) => a + (b.pa || 0), 0);
  const opsList = batters.map(b => b.ops).filter(v => v != null);
  const avgOps = opsList.length ? opsList.reduce((a, b) => a + b, 0) / opsList.length : null;
  return { batters, samplePa: totalPa, avgOps: avgOps != null ? Math.round(avgOps * 1000) / 1000 : null };
}

async function getHighContactReport(gamePk, options = {}) {
  const cacheKey = `hc_${gamePk}`;
  if (!options.refresh) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const season = currentMlbSeason();
  // Pull lineups + BvP up front — same machinery that powers EdgeFinder.
  const bvp = await getGameBvp(gamePk, options);
  const lineups = await getGameLineups(gamePk, options);

  // For each side we score the STARTING pitcher of that side
  // against the OPPOSING lineup (the team that has to bat against them).
  const sides = ['away', 'home'];
  const buildSide = async (side) => {
    const oppSide = side === 'away' ? 'home' : 'away';
    const teamInfo = lineups[side];
    const oppInfo  = lineups[oppSide];
    const pitcher  = teamInfo?.probablePitcher;
    if (!pitcher) {
      return {
        side,
        teamName: teamInfo?.teamName || null,
        pitcher: null,
        opponent: oppInfo?.teamName || null,
        error: 'Probable pitcher not yet announced',
      };
    }

    const [stats, arsenal, oppHandSplits, bullpen, weather] = await Promise.all([
      getPitcherStats(pitcher.id, season),
      getPitcherArsenal(pitcher.id, season),
      getTeamHandSplits(oppInfo?.teamId, season),
      getBullpenStats(teamInfo?.teamId, season),
      fetchGameWeather(gamePk),
    ]);

    // Find the BvP matchup for the OPPOSING lineup vs THIS pitcher.
    // bvp.matchups items have side === lineup side; their pitcher is from the other team.
    const matchup = bvp?.matchups?.find(m => m.side === oppSide && m.pitcher?.id === pitcher.id) || null;
    const lineupBvp = summarizeLineupBvp(matchup);
    const throws = stats?.throws || null;

    const subscores = {
      pitcherTraffic: scorePitcherTraffic(stats),
      pitchType:      scorePitchTypeWeakness(arsenal),
      oppVsHand:      scoreOppVsHand(oppHandSplits, throws),
      lineupStrength: scoreLineupStrength(lineupBvp),
      weather:        scoreWeather(weather),
      bvp:            scoreBvP(lineupBvp),
    };
    const parts = Object.keys(HC_WEIGHTS).map(k => ({ key: k, score: subscores[k], weight: HC_WEIGHTS[k] }));
    const { score, level } = combineRisk(parts);

    // Verified-data status: what evidence did we actually collect?
    const verified = {
      pitcherStats:    !!(stats?.current?.whip != null),
      prevSeasonStats: !!(stats?.previous?.whip != null),
      arsenal:         (arsenal?.length || 0) > 0,
      lineupPosted:    (oppInfo?.lineup?.length || 0) >= 9,
      oppHandSplits:   !!(oppHandSplits && (oppHandSplits.vsR || oppHandSplits.vsL)),
      bullpen:         !!(bullpen?.era != null),
      weather:         !!weather,
      bvpSample:       (lineupBvp?.samplePa || 0) >= 15,
    };

    return {
      side,
      teamName: teamInfo?.teamName || null,
      opponent: oppInfo?.teamName || null,
      pitcher: { id: pitcher.id, name: pitcher.name, throws },
      stats,
      arsenal,
      oppHandSplits,
      bullpen,
      weather,
      lineupBvp,
      subscores,
      weights: HC_WEIGHTS,
      riskScore: score,
      riskLevel: level,
      verified,
    };
  };

  const [away, home] = await Promise.all([buildSide('away'), buildSide('home')]);
  const result = {
    gamePk,
    season,
    away,
    home,
    source: 'MLB Stats API + Baseball Savant',
    cachedAt: new Date().toISOString(),
  };
  cacheSet(cacheKey, result, LIVE_CACHE_TTL);
  return result;
}

module.exports = {
  getGames,
  getGameLineups,
  fetchSavantBvP,
  getGameBvp,
  fetchGameWeather,
  findGamePkByAbbrDate,
  findGamePkByTeams,
  getHighContactReport,
};
