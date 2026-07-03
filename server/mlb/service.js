const fs = require('fs');
const path = require('path');
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

  // `lineups` hydration returns awayPlayers/homePlayers once each batting order
  // is posted — lets the slate show research-readiness in ONE call (no per-game
  // fetches). probablePitcher gives the SP-decided signal.
  const data = await fetchJson(`${MLB_API}/schedule?sportId=1&date=${date}&hydrate=probablePitcher,lineups`);
  const games = [];
  for (const d of data.dates || []) {
    for (const g of d.games || []) {
      const awaySP = !!g.teams.away.probablePitcher?.id;
      const homeSP = !!g.teams.home.probablePitcher?.id;
      const lu = g.lineups || {};
      const awayLU = (lu.awayPlayers || []).length >= 9;
      const homeLU = (lu.homePlayers || []).length >= 9;
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
        // Slate research-readiness (both sides required for the ✓ state).
        readiness: {
          awayPitcher: awaySP, homePitcher: homeSP, pitchers: awaySP && homeSP,
          awayLineup: awayLU, homeLineup: homeLU, lineups: awayLU && homeLU,
          researchReady: awaySP && homeSP && awayLU && homeLU,
        },
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
  // Pitcher overrides participate in the cache key so an override-resolved
  // result isn't served to a call that didn't pass one (and vice versa).
  const cacheKey = `lineup_${gamePk}_${options.awayLineup?.join(',') || ''}_${options.homeLineup?.join(',') || ''}`
    + `_${options.awayPitcher || ''}_${options.homePitcher || ''}`;
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
    let probablePitcher = pp ? { id: pp.id, name: pp.fullName } : null;

    // MLB Stats API's probablePitchers field lags ESPN (or is missing until
    // close to first pitch). When the caller supplies the starter's name
    // (the frontend passes ESPN's probable via awayPitcher/homePitcher),
    // resolve it against the roster so every consumer — High Contact, Low HR,
    // and the prop model — sees the same starter the Pitching/Edge Finder
    // tabs already show. Only used as a fallback; MLB's own field wins.
    if (!probablePitcher) {
      const provided = options[`${side}Pitcher`];
      if (provided && team.team?.id) {
        const rosterMap = await getTeamRosterMap(team.team.id);
        const resolved = resolveRosterEntry(provided, rosterMap);
        if (resolved) probablePitcher = { id: resolved.id, name: resolved.name };
      }
    }

    result[side] = {
      teamId: team.team?.id,
      teamName: team.team?.name,
      lineup,
      probablePitcher,
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
    goAo:       num(line.groundOutsToAirouts),
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

// All sub-scores normalized to 0-100 (higher = more hit risk). Each scorer
// returns { score, inputs, formula, note } so the exact numbers and method
// that produced the score travel with it (verifiable + can't drift from code).
function scorePitcherTraffic(stats) {
  // WHIP and H/9 are the load-bearing stats. K% reduces traffic.
  const cur = stats?.current;
  if (!cur || cur.whip == null) return { score: null, inputs: {}, note: 'no current-season pitching line' };
  const whip = cur.whip;
  const h9 = cur.h9 ?? 8.5;
  const k9 = cur.k9 ?? 8.5;
  // Anchors: WHIP 1.10 → 0, 1.60 → 100. H/9 7 → 0, 11 → 100. K/9 inverse: 11 → 0, 5 → 100.
  const whipScore = clamp((whip - 1.10) / (1.60 - 1.10) * 100, 0, 100);
  const h9Score   = clamp((h9 - 7.0) / (11.0 - 7.0) * 100, 0, 100);
  const k9Score   = clamp((11.0 - k9) / (11.0 - 5.0) * 100, 0, 100);
  return {
    score: Math.round(whipScore * 0.5 + h9Score * 0.35 + k9Score * 0.15),
    inputs: {
      WHIP: whip, 'H/9': h9, 'K/9': k9,
      whipScore: Math.round(whipScore), h9Score: Math.round(h9Score), k9Score: Math.round(k9Score),
    },
    formula: 'WHIP[1.10→0,1.60→100]×0.50 + H9[7→0,11→100]×0.35 + K9[11→0,5→100, inverted]×0.15',
  };
}

function scorePitchTypeWeakness(arsenal) {
  if (!arsenal?.length) return { score: null, inputs: {}, note: 'no arsenal rows returned' };
  // Weighted by usage. xwOBA league avg ≈ 0.310. .280 → 0, .400 → 100.
  let usageSum = 0, weightedXwoba = 0, worstXwoba = 0, worstPitch = null;
  for (const p of arsenal) {
    const u = p.usage || 0;
    if (p.xwoba == null) continue;
    usageSum += u;
    weightedXwoba += p.xwoba * u;
    if (u >= 10 && p.xwoba > worstXwoba) { worstXwoba = p.xwoba; worstPitch = p.name || p.type; }
  }
  if (usageSum < 50) return { score: null, inputs: { usageCoveragePct: Math.round(usageSum) }, note: 'xwOBA usage coverage < 50% (insufficient Savant rows)' };
  const wXwoba = weightedXwoba / usageSum;
  const wScore = clamp((wXwoba - 0.280) / (0.400 - 0.280) * 100, 0, 100);
  const worstScore = worstXwoba ? clamp((worstXwoba - 0.300) / (0.430 - 0.300) * 100, 0, 100) : 0;
  // Blend the weighted-average pitch quality with the single worst high-usage pitch.
  return {
    score: Math.round(wScore * 0.65 + worstScore * 0.35),
    inputs: {
      usageWeightedXwoba: Math.round(wXwoba * 1000) / 1000,
      worstHighUsagePitch: worstPitch,
      worstPitchXwoba: worstXwoba || null,
      pitchesCounted: arsenal.length,
    },
    formula: 'usage-weighted xwOBA[.280→0,.400→100]×0.65 + worst ≥10%-usage pitch xwOBA[.300→0,.430→100]×0.35',
  };
}

function scoreOppVsHand(teamSplits, throws) {
  if (!teamSplits || !throws) return { score: null, inputs: {}, note: 'missing team splits or pitcher hand' };
  const side = throws === 'L' ? teamSplits.vsL : teamSplits.vsR;
  if (!side || side.ops == null) return { score: null, inputs: {}, note: `no opponent split vs ${throws}HP` };
  // OPS .650 → 0, .850 → 100.
  return {
    score: Math.round(clamp((side.ops - 0.650) / (0.850 - 0.650) * 100, 0, 100)),
    inputs: { vsHand: throws === 'L' ? 'LHP' : 'RHP', OPS: side.ops, AVG: side.avg, OBP: side.obp, SLG: side.slg },
    formula: 'team OPS vs this pitcher hand [.650→0, .850→100]',
  };
}

function scoreLineupStrength(lineupBvp) {
  // lineupBvp = { avgOps, samplePa, batters: [{ops, pa}, ...] }
  // Without team-vs-hand-individualized hitter OPS we proxy lineup strength
  // by the lineup's BvP OPS against this exact pitcher (richer than season OPS).
  if (!lineupBvp || !lineupBvp.batters?.length) return { score: null, inputs: {}, note: 'no BvP batters' };
  const opsList = lineupBvp.batters.map(b => b.ops).filter(v => v != null);
  if (!opsList.length) return { score: null, inputs: {}, note: 'no batter OPS vs this pitcher' };
  const avgOps = opsList.reduce((a, b) => a + b, 0) / opsList.length;
  return {
    score: Math.round(clamp((avgOps - 0.500) / (1.000 - 0.500) * 100, 0, 100)),
    inputs: { avgLineupBvpOps: Math.round(avgOps * 1000) / 1000, battersWithBvp: opsList.length, totalBvpPa: lineupBvp.samplePa },
    formula: 'mean of each batter\'s career OPS vs this exact pitcher [.500→0, 1.000→100]',
  };
}

function scoreWeather(weather) {
  if (!weather) return { score: null, inputs: {}, note: 'no weather feed' };
  // Domes neutralize wind/temp; assume park-average baseline.
  if (weather.roofType && /indoor|closed|dome/i.test(weather.roofType)) {
    return { score: 50, inputs: { roofType: weather.roofType }, formula: 'roof closed / indoor → neutral 50' };
  }
  const temp = weather.temp;
  const windStr = String(weather.wind || '');
  const windMph = parseInt(windStr) || 0;
  const blowingOut = /out|to (cf|rf|lf)/i.test(windStr);
  const blowingIn  = /in|from (cf|rf|lf)/i.test(windStr);
  let tempAdj = 0, windAdj = 0;
  if (temp != null) {
    if (temp >= 85) tempAdj = 18;
    else if (temp >= 75) tempAdj = 10;
    else if (temp <= 50) tempAdj = -18;
    else if (temp <= 60) tempAdj = -8;
  }
  if (blowingOut) windAdj = Math.min(20, windMph * 1.5);
  if (blowingIn)  windAdj = -Math.min(20, windMph * 1.5);
  return {
    score: Math.round(clamp(50 + tempAdj + windAdj, 0, 100)),
    inputs: { temp, wind: weather.wind || null, tempAdj, windAdj },
    formula: 'base 50 + temp[≥85:+18, ≥75:+10, ≤60:−8, ≤50:−18] + wind[out:+min(20,mph×1.5), in:−min(20,mph×1.5)]',
  };
}

function scoreBvP(lineupBvp) {
  if (!lineupBvp || !lineupBvp.batters?.length) return { score: null, inputs: {}, note: 'no BvP batters' };
  const opsList = lineupBvp.batters.map(b => b.ops).filter(v => v != null);
  const paList  = lineupBvp.batters.map(b => b.pa).filter(v => v != null);
  if (!opsList.length) return { score: null, inputs: {}, note: 'no batter OPS vs this pitcher' };
  const totalPa = paList.reduce((a, b) => a + b, 0);
  // Confidence shrinks if total PA is small (< 60 PA across whole lineup).
  const conf = clamp(totalPa / 60, 0.2, 1.0);
  const avgOps = opsList.reduce((a, b) => a + b, 0) / opsList.length;
  const raw = clamp((avgOps - 0.500) / (1.000 - 0.500) * 100, 0, 100);
  return {
    score: Math.round(raw * conf + 50 * (1 - conf)),
    inputs: { avgBvpOps: Math.round(avgOps * 1000) / 1000, totalBvpPa: totalPa, confidence: Math.round(conf * 100) / 100 },
    formula: 'rawOPS[.500→0,1.000→100] shrunk toward 50 by confidence = min(1, totalPA/60)',
  };
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

/* ── FIRST-5-INNINGS (F5) MONEY LINE MODEL ──────────────
   Scores the XGBoost model trained offline by ml/train_f5.py (committed as
   server/data/f5_model.json). Pure-JS tree-walker, zero deps. Features are
   assembled with the SAME formulas as ml/collect_mlb_f5.py — see
   server/data/f5_feature_spec.json (the parity contract). Outputs P(home /
   tie / away leads after 5 innings). Returns null if the model isn't present. */

let _f5Model = null, _f5Spec = null, _f5Loaded = false;
function loadF5() {
  if (_f5Loaded) return;
  _f5Loaded = true;
  try {
    const dir = path.join(__dirname, '..', 'data');
    _f5Model = JSON.parse(fs.readFileSync(path.join(dir, 'f5_model.json'), 'utf8'));
    _f5Spec = JSON.parse(fs.readFileSync(path.join(dir, 'f5_feature_spec.json'), 'utf8'));
    // Flatten each tree to a nodeid→node map once for O(depth) traversal.
    for (const t of _f5Model.trees) {
      const map = {};
      (function flat(n) { map[n.nodeid] = n; (n.children || []).forEach(flat); })(t);
      t.__map = map;
    }
  } catch { _f5Model = null; _f5Spec = null; }
}

function _f5Leaf(tree, feats) {
  let node = tree;
  while (!('leaf' in node)) {
    const v = feats[node.split];
    const nextId = (v == null || Number.isNaN(v)) ? node.missing
      : (v < node.split_condition ? node.yes : node.no);
    node = tree.__map[nextId];
  }
  return node.leaf;
}

// featObj keyed by feature names → [pHome, pTie, pAway]. Per-class margin =
// learned base_margin (intercept) + Σ leaf values over that class's trees
// (round-robin tree→class mapping), then softmax.
function scoreF5(featObj) {
  loadF5();
  if (!_f5Model) return null;
  const K = _f5Model.num_class;
  const base = _f5Model.base_margin || new Array(K).fill(0);
  const margins = base.slice(0, K);
  _f5Model.trees.forEach((t, i) => { margins[i % K] += _f5Leaf(t, featObj); });
  const mx = Math.max(...margins);
  const exps = margins.map(m => Math.exp(m - mx));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

// Average runs scored over a team's last N completed regular-season games.
async function getTeamRecentRuns(teamId, season, n = 15) {
  if (!teamId) return null;
  const cacheKey = `team_runs_${teamId}_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached !== null && cached !== undefined) return cached;
  try {
    const data = await fetchJson(`${MLB_API}/schedule?sportId=1&teamId=${teamId}&season=${season}&gameType=R&hydrate=linescore`);
    const games = [];
    for (const d of data.dates || []) {
      for (const g of d.games || []) {
        if (g.status?.abstractGameState !== 'Final') continue;
        const home = g.teams?.home, away = g.teams?.away;
        let runs = null;
        if (String(home?.team?.id) === String(teamId)) runs = home?.score;
        else if (String(away?.team?.id) === String(teamId)) runs = away?.score;
        if (runs != null) games.push({ date: g.gameDate, runs });
      }
    }
    games.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const last = games.slice(-n);
    const val = last.length ? Math.round(last.reduce((s, g) => s + g.runs, 0) / last.length * 10000) / 10000 : null;
    cacheSet(cacheKey, val, LIVE_CACHE_TTL);
    return val;
  } catch { return null; }
}

// Pitcher sub-features. Uses current-season aggregate (= season-to-date during
// the season) when the SP has ≥3 starts, else prior season, else league avg —
// matching the fallback logic in ml/collect_mlb_f5.py.
function _f5Pitcher(stats, fb) {
  const cur = stats?.current, prev = stats?.previous;
  const src = (cur && cur.gs != null && cur.gs >= 3) ? cur : (prev && prev.whip != null ? prev : null);
  const ipps = (src && src.ip != null && src.gs) ? src.ip / src.gs : null;
  return {
    era: src?.era ?? fb.sp_era,
    whip: src?.whip ?? fb.sp_whip,
    k9: src?.k9 ?? fb.sp_k9,
    bb9: src?.bb9 ?? fb.sp_bb9,
    hr9: src?.hrPer9 ?? fb.sp_hr9,
    ip_per_start: ipps ?? fb.sp_ip_per_start,
  };
}

async function buildF5Features(awayStats, homeStats, lineups, weather, season, spec) {
  const fb = spec.league_fallback;
  const home = _f5Pitcher(homeStats, fb);
  const away = _f5Pitcher(awayStats, fb);
  const [homeRuns, awayRuns] = await Promise.all([
    getTeamRecentRuns(lineups.home?.teamId, season),
    getTeamRecentRuns(lineups.away?.teamId, season),
  ]);
  return {
    home_sp_era: home.era, home_sp_whip: home.whip, home_sp_k9: home.k9, home_sp_bb9: home.bb9, home_sp_hr9: home.hr9, home_sp_ip_per_start: home.ip_per_start,
    away_sp_era: away.era, away_sp_whip: away.whip, away_sp_k9: away.k9, away_sp_bb9: away.bb9, away_sp_hr9: away.hr9, away_sp_ip_per_start: away.ip_per_start,
    home_runs_pg: homeRuns ?? fb.runs_pg,
    away_runs_pg: awayRuns ?? fb.runs_pg,
    park_hr_factor: parkHrFactor(weather?.venue) ?? fb.park_hr_factor,
  };
}

function _f5FairOdds(p) {
  if (p == null || p <= 0 || p >= 1) return null;
  return p > 0.5 ? -Math.round(100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
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

    // Each scorer returns { score, inputs, formula, note }. Keep the numeric
    // subscores (for the bars) and assemble a methodology array (for citations).
    const computed = {
      pitcherTraffic: scorePitcherTraffic(stats),
      pitchType:      scorePitchTypeWeakness(arsenal),
      oppVsHand:      scoreOppVsHand(oppHandSplits, throws),
      lineupStrength: scoreLineupStrength(lineupBvp),
      weather:        scoreWeather(weather),
      bvp:            scoreBvP(lineupBvp),
    };
    const subscores = Object.fromEntries(Object.entries(computed).map(([k, v]) => [k, v.score]));
    const parts = Object.keys(HC_WEIGHTS).map(k => ({ key: k, score: computed[k].score, weight: HC_WEIGHTS[k] }));
    const { score, level } = combineRisk(parts);

    // Data provenance per parameter — concrete source + the exact endpoint the
    // value was pulled from, so the numbers can be independently verified.
    const SAVANT = 'https://baseballsavant.mlb.com';
    const STATS = 'https://statsapi.mlb.com/api/v1';
    const PARAM_META = {
      pitcherTraffic: { label: 'PITCHER TRAFFIC', source: 'MLB Stats API · season pitching aggregate',
        endpoint: `${STATS}/people/${pitcher.id}/stats?stats=season&group=pitching&season=${season}` },
      pitchType:      { label: 'PITCH-TYPE WEAKNESS', source: 'Baseball Savant · pitch-arsenal-stats leaderboard (Statcast xwOBA)',
        endpoint: `${SAVANT}/leaderboard/pitch-arsenal-stats?type=pitcher&year=${season}&min=1&csv=true` },
      oppVsHand:      { label: 'OPP vs HAND', source: 'MLB Stats API · opponent team hitting statSplits',
        endpoint: `${STATS}/teams/${oppInfo?.teamId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=vr,vl` },
      lineupStrength: { label: 'LINEUP STRENGTH', source: 'Baseball Savant · Statcast batter-vs-pitcher (per hitter vs this SP)',
        endpoint: `${SAVANT}/statcast_search/csv?player_type=batter&pitchers_lookup[]=${pitcher.id}&batters_lookup[]={each lineup hitter}&type=details` },
      weather:        { label: 'WEATHER', source: 'MLB Stats API · live game feed (gameData.weather + venue.roofType)',
        endpoint: `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live` },
      bvp:            { label: 'BvP', source: 'Baseball Savant · Statcast batter-vs-pitcher (lineup PA confidence)',
        endpoint: `${SAVANT}/statcast_search/csv?player_type=batter&pitchers_lookup[]=${pitcher.id}&batters_lookup[]={each lineup hitter}&type=details` },
    };
    const methodology = Object.keys(HC_WEIGHTS).map(k => ({
      key: k,
      label: PARAM_META[k].label,
      weight: HC_WEIGHTS[k],
      score: computed[k].score,
      source: PARAM_META[k].source,
      endpoint: PARAM_META[k].endpoint,
      inputs: computed[k].inputs || {},
      formula: computed[k].formula || null,
      note: computed[k].note || null,
    }));

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
      methodology,
      riskScore: score,
      riskLevel: level,
      verified,
    };
  };

  const [away, home] = await Promise.all([buildSide('away'), buildSide('home')]);

  // First-5-innings money-line model (XGBoost) — top-of-tab projection.
  let f5 = null;
  loadF5();
  if (_f5Model && _f5Spec && away?.pitcher && home?.pitcher) {
    try {
      const weatherForPark = await fetchGameWeather(gamePk);
      const features = await buildF5Features(away.stats, home.stats, lineups, weatherForPark, season, _f5Spec);
      const probs = scoreF5(features);
      if (probs) {
        const [pHome, pTie, pAway] = probs;
        const labels = ['home', 'tie', 'away'];
        const pick = labels[probs.indexOf(Math.max(...probs))];
        f5 = {
          probs: { home: pHome, tie: pTie, away: pAway },
          pick,
          fairOdds: { home: _f5FairOdds(pHome), tie: _f5FairOdds(pTie), away: _f5FairOdds(pAway) },
          features,
          model: { trainedAt: _f5Model.trained_at, val: _f5Model.val, nTrees: _f5Model.n_trees },
          source: 'XGBoost (multi:softprob) · MLB Stats API features',
        };
      }
    } catch (e) { console.error('F5 model failed', e.message); }
  }

  const result = {
    gamePk,
    season,
    away,
    home,
    f5,
    source: 'MLB Stats API + Baseball Savant',
    riskFormula: 'Risk = Σ(subscore × weight) ÷ Σ(weight of present parts), renormalized over available signals. Levels: HIGH ≥ 65, MEDIUM ≥ 40, LOW < 40.',
    dataSources: {
      'MLB Stats API': 'https://statsapi.mlb.com — pitcher season stats, team hitting splits, bullpen, lineups, live weather feed',
      'Baseball Savant': 'https://baseballsavant.mlb.com — Statcast pitch-arsenal xwOBA and batter-vs-pitcher (BvP)',
    },
    cachedAt: new Date().toISOString(),
  };
  cacheSet(cacheKey, result, LIVE_CACHE_TTL);
  return result;
}

/* ── LOW HOME RUN MODEL ─────────────────────────────────
   Backend for the MLB game-detail "LOW HR MODEL" tab.
   Finds Under-0.5-HR parlay candidates by combining:
   - opposing pitcher HR/9 + rank among qualified starters
   - batter career BvP HR history vs today's SP (Savant)
   - batter no-HR rate (PA-based, scaled to game level)
   - Savant statcast power profile (barrel% / hard-hit%)
   - park HR factor, weather/wind, lineup spot
   Scored with the 13-point blueprint: 10+ strong, 7-9 decent. */

const HR9_BOARD_TTL = 6 * 60 * 60 * 1000;
const STATCAST_TTL = 24 * 60 * 60 * 1000;
const BATTER_PROFILE_TTL = 6 * 60 * 60 * 1000;

// Approximate multi-year HR park factors (100 = league neutral).
// Static by design — park HR behavior moves slowly year to year.
const PARK_HR_FACTORS = [
  { match: /great american/i, factor: 124 },
  { match: /yankee/i, factor: 117 },
  { match: /citizens bank/i, factor: 115 },
  { match: /rate field|guaranteed rate/i, factor: 113 },
  { match: /dodger/i, factor: 112 },
  { match: /truist/i, factor: 110 },
  { match: /american family/i, factor: 108 },
  { match: /coors/i, factor: 106 },
  { match: /sutter health/i, factor: 105 },
  { match: /steinbrenner/i, factor: 105 },
  { match: /angel/i, factor: 104 },
  { match: /rogers centre/i, factor: 104 },
  { match: /daikin|minute maid/i, factor: 104 },
  { match: /citi field/i, factor: 102 },
  { match: /chase field/i, factor: 102 },
  { match: /nationals/i, factor: 102 },
  { match: /wrigley/i, factor: 100 },
  { match: /globe life/i, factor: 98 },
  { match: /target field/i, factor: 98 },
  { match: /progressive/i, factor: 98 },
  { match: /fenway/i, factor: 96 },
  { match: /camden/i, factor: 96 },
  { match: /petco/i, factor: 95 },
  { match: /comerica/i, factor: 94 },
  { match: /busch/i, factor: 92 },
  { match: /t-mobile/i, factor: 92 },
  { match: /loandepot|loan depot/i, factor: 90 },
  { match: /pnc/i, factor: 90 },
  { match: /kauffman/i, factor: 88 },
  { match: /oracle/i, factor: 84 },
];

function parkHrFactor(venueName) {
  if (!venueName) return null;
  const hit = PARK_HR_FACTORS.find(p => p.match.test(venueName));
  return hit ? hit.factor : null;
}

// Innings like 5.2 mean 5⅔ — convert to outs before summing.
function ipToOuts(ip) {
  const n = Number(ip) || 0;
  return Math.floor(n) * 3 + Math.round((n % 1) * 10);
}

async function getHr9Leaderboard(season) {
  const cacheKey = `hr9_board_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // QUALIFIED is too strict mid-season (~65 pitchers); rank among all active
  // starters instead so today's probables actually appear on the board.
  let all = [];
  try {
    const url = `${MLB_API}/stats?stats=season&group=pitching&season=${season}&gameType=R&playerPool=ALL&limit=1500`;
    const data = await fetchJson(url);
    all = (data?.stats?.[0]?.splits || []).map(s => {
      const st = s.stat || {};
      return {
        id: s.player?.id,
        name: s.player?.fullName || null,
        hrPer9: st.homeRunsPer9 != null && st.homeRunsPer9 !== '' ? Number(st.homeRunsPer9) : null,
        ip: Number(st.inningsPitched || 0),
        gs: Number(st.gamesStarted || 0),
      };
    }).filter(r => r.id && r.hrPer9 != null);
  } catch {}

  let rows = all.filter(r => r.ip >= 30 && r.gs >= 5);
  if (rows.length < 30) rows = all.filter(r => r.ip >= 15 && r.gs >= 3); // early season
  rows.sort((a, b) => a.hrPer9 - b.hrPer9);

  const byId = {};
  rows.forEach((r, i) => { byId[r.id] = { rank: i + 1, hrPer9: r.hrPer9, name: r.name }; });
  const leagueAvgHr9 = rows.length ? Math.round(rows.reduce((s, r) => s + r.hrPer9, 0) / rows.length * 100) / 100 : 1.10;

  const board = {
    byId,
    total: rows.length,
    leagueAvgHr9,
    hr9List: rows.map(r => r.hrPer9), // sorted asc — used for virtual ranking
  };
  cacheSet(cacheKey, board, rows.length ? HR9_BOARD_TTL : 30 * 60 * 1000);
  return board;
}

// Savant statcast leaderboard (exit velo / barrels), one row per player.
async function getStatcastIndex(season, type) {
  const cacheKey = `statcast_${type}_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const url = `https://baseballsavant.mlb.com/leaderboard/statcast`
    + `?type=${type}&year=${season}&position=&team=&min=25&csv=true`;
  try {
    const text = await fetchUrl(url);
    const rows = parseCsv(text);
    const num = v => (v == null || v === '') ? null : Number(v);
    const byId = {};
    for (const r of rows) {
      const pid = r.player_id || r.id;
      if (!pid) continue;
      byId[String(pid).trim()] = {
        barrelPct: num(r.brl_percent ?? r.barrel_batted_rate),
        hardHitPct: num(r.ev95percent ?? r.hard_hit_percent),
        avgEv: num(r.avg_hit_speed),
      };
    }
    cacheSet(cacheKey, byId, STATCAST_TTL);
    return byId;
  } catch {
    cacheSet(cacheKey, {}, 30 * 60 * 1000);
    return {};
  }
}

async function getPitcherRecentHr(pitcherId, season) {
  if (!pitcherId) return null;
  const cacheKey = `pitcher_recent_hr_${pitcherId}_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const data = await fetchJson(`${MLB_API}/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${season}`);
    const splits = data?.stats?.[0]?.splits || [];
    const last3 = splits.slice(-3);
    const hrLast3 = last3.reduce((s, g) => s + Number(g.stat?.homeRuns || 0), 0);
    const outs = last3.reduce((s, g) => s + ipToOuts(g.stat?.inningsPitched), 0);
    const result = { hrLast3, ipLast3: Math.round(outs / 3 * 10) / 10, games: last3.length };
    cacheSet(cacheKey, result, PITCHER_STATS_TTL);
    return result;
  } catch { return null; }
}

// One call per batter: season line + vs-hand splits + game log for HR trend.
async function getBatterHrProfile(batterId, season) {
  if (!batterId) return null;
  const cacheKey = `batter_hr_${batterId}_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const num = v => (v == null || v === '' || v === '.---' || v === '-.--') ? null : Number(v);
  try {
    const url = `${MLB_API}/people/${batterId}/stats`
      + `?stats=season,statSplits,gameLog&group=hitting&season=${season}&sitCodes=vr,vl`;
    const data = await fetchJson(url);
    const byType = {};
    for (const g of data?.stats || []) byType[g.type?.displayName || ''] = g.splits || [];

    const st = byType.season?.[0]?.stat || {};
    const avg = num(st.avg), slg = num(st.slg);
    const profSeason = {
      pa: Number(st.plateAppearances || 0),
      g: Number(st.gamesPlayed || 0),
      hr: Number(st.homeRuns || 0),
      avg, slg,
      iso: (avg != null && slg != null) ? Math.round((slg - avg) * 1000) / 1000 : null,
    };

    const hand = {};
    for (const s of byType.statSplits || []) {
      const code = s.split?.code;
      if (code !== 'vr' && code !== 'vl') continue;
      const sp = s.stat || {};
      const a = num(sp.avg), sl = num(sp.slg);
      const pa = Number(sp.plateAppearances || 0);
      const hr = Number(sp.homeRuns || 0);
      hand[code] = {
        pa, hr,
        iso: (a != null && sl != null) ? Math.round((sl - a) * 1000) / 1000 : null,
        hrPerPa: pa > 0 ? hr / pa : null,
      };
    }

    const logs = byType.gameLog || []; // chronological ascending
    const hrInLast = n => logs.slice(-n).reduce((s, g) => s + Number(g.stat?.homeRuns || 0), 0);
    const result = {
      season: profSeason,
      vsR: hand.vr || null,
      vsL: hand.vl || null,
      recent: { hr7: hrInLast(7), hr15: hrInLast(15), hr30: hrInLast(30) },
    };
    cacheSet(cacheKey, result, BATTER_PROFILE_TTL);
    return result;
  } catch { return null; }
}

function scoreLowHrCandidate({ side, batter, teamName, prof, bvpRow, sc, oppPitcher, parkFactor, windFlag, weather, leagueAvgHr9 }) {
  const season = prof?.season || {};
  const hrPerPa = season.pa > 0 ? season.hr / season.pa : null;
  const paPerGame = season.g > 0 ? season.pa / season.g : null;
  // P(no HR in a game) from the per-PA rate raised to typical PAs per game.
  const gameNoHrPct = (hrPerPa != null && paPerGame) ? Math.pow(1 - hrPerPa, paPerGame) : null;
  const iso = season.iso ?? null;
  const vsHand = oppPitcher?.throws === 'L' ? prof?.vsL : oppPitcher?.throws === 'R' ? prof?.vsR : null;

  const breakdown = [];
  const add = (key, label, max, pts, detail) => breakdown.push({ key, label, max, pts, detail });

  add('pitcherTop15', 'SP TOP-15 LOW HR/9', 2, oppPitcher?.top15 ? 2 : 0,
    oppPitcher?.hrPer9 != null
      ? `${oppPitcher.hrPer9.toFixed(2)} HR/9 · rank ${oppPitcher.rank ?? '—'}/${oppPitcher.totalRanked ?? '—'}`
      : 'no HR/9 data');

  // 0 career HR vs SP: full credit needs a real sample; never-faced is neutral.
  const bvpPa = bvpRow?.pa ?? 0;
  const bvpHr = bvpRow?.hr ?? 0;
  const bvpPts = bvpPa > 0 && bvpHr === 0 ? (bvpPa >= 6 ? 2 : 1) : bvpPa === 0 ? 1 : 0;
  add('bvpZeroHr', '0 HR vs PITCHER', 2, bvpPts,
    bvpPa > 0 ? `${bvpHr} HR in ${bvpPa} PA vs ${oppPitcher?.name || 'SP'}` : 'never faced (neutral credit)');

  add('noHr94', 'NO-HR RATE ≥ 94%', 3, gameNoHrPct != null && gameNoHrPct >= 0.94 ? 3 : 0,
    gameNoHrPct != null
      ? `${(gameNoHrPct * 100).toFixed(1)}% HR-less games (${season.hr} HR / ${season.pa} PA)`
      : 'no season sample');

  add('lowIso', 'LOW ISO', 1, iso != null && iso <= 0.120 ? 1 : 0,
    iso != null ? `ISO ${iso.toFixed(3)}` : 'no data');

  add('lowBarrel', 'LOW BARREL%', 1, sc?.barrelPct != null && sc.barrelPct < 6 ? 1 : 0,
    sc?.barrelPct != null ? `${sc.barrelPct.toFixed(1)}% barrels` : 'no statcast sample');

  add('pitcherGb', 'SP GROUND-BALL LEAN', 1, oppPitcher?.goAo != null && oppPitcher.goAo >= 1.3 ? 1 : 0,
    oppPitcher?.goAo != null ? `GO/AO ${oppPitcher.goAo.toFixed(2)}` : 'no data');

  add('parkSuppress', 'PARK SUPPRESSES HR', 1, parkFactor != null && parkFactor <= 96 ? 1 : 0,
    parkFactor != null ? `park HR factor ${parkFactor}` : 'unknown park');

  add('windOk', 'WIND NOT OUT', 1, windFlag !== 'OUT' ? 1 : 0,
    windFlag === 'DOME' ? 'roof closed / dome' : `wind: ${weather?.wind || 'unknown'}`);

  add('bottomLineup', 'BATTING 7-9', 1, (batter.order || 0) >= 7 ? 1 : 0,
    batter.order ? `batting #${batter.order}` : 'order unknown');

  const score = breakdown.reduce((s, b) => s + b.pts, 0);
  const maxScore = breakdown.reduce((s, b) => s + b.max, 0);
  const rating = score >= 10 ? 'STRONG' : score >= 7 ? 'DECENT' : 'AVOID';

  const flags = [];
  if (bvpPa > 0 && bvpPa < 6 && bvpHr === 0) flags.push('SMALL BvP SAMPLE');
  if (bvpPa === 0) flags.push('NO BvP HISTORY');
  if (vsHand?.iso != null && vsHand.iso >= 0.180) flags.push(`POWER vs ${oppPitcher?.throws || '?'}HP`);
  if ((prof?.recent?.hr7 ?? 0) >= 2 || (prof?.recent?.hr15 ?? 0) >= 4) flags.push('HOT HR TREND');
  if ((sc?.barrelPct ?? 0) >= 10 || (iso ?? 0) >= 0.200) flags.push('POWER BAT');

  // Naive model probability of no HR today: season per-PA rate blended with
  // the vs-hand rate, adjusted for pitcher / park / weather, raised to an
  // estimated PA count for the lineup spot. Compare vs sportsbook implied.
  let modelNoHrPct = null, fairOdds = null;
  if (hrPerPa != null && paPerGame) {
    // Smooth toward the league HR/PA rate (~3.1%) with a 60-PA prior so small
    // samples and 0-HR hitters don't produce a misleading 100% probability.
    const LEAGUE_HR_PA = 0.031, PRIOR_PA = 60;
    const smooth = (hr, pa) => (hr + LEAGUE_HR_PA * PRIOR_PA) / (pa + PRIOR_PA);
    let eff = smooth(season.hr, season.pa);
    if (vsHand?.hrPerPa != null && vsHand.pa >= 60) eff = 0.5 * eff + 0.5 * smooth(vsHand.hr, vsHand.pa);
    let mult = 1;
    if (oppPitcher?.hrPer9 != null && leagueAvgHr9) mult *= clamp(oppPitcher.hrPer9 / leagueAvgHr9, 0.5, 1.6);
    if (parkFactor != null) mult *= clamp(parkFactor / 100, 0.8, 1.25);
    if (windFlag === 'OUT') mult *= 1.10;
    if (windFlag === 'IN') mult *= 0.90;
    const temp = weather?.temp;
    if (windFlag !== 'DOME' && temp != null) {
      if (temp >= 85) mult *= 1.05;
      else if (temp <= 55) mult *= 0.95;
    }
    const paEst = clamp(4.8 - 0.12 * ((batter.order || 5) - 1), 3.5, 5.0);
    const p = clamp(Math.pow(clamp(1 - eff * mult, 0, 1), paEst), 0.01, 0.995);
    modelNoHrPct = Math.round(p * 1000) / 10;
    fairOdds = p > 0.5 ? -Math.round(100 * p / (1 - p)) : Math.round(100 * (1 - p) / p);
  }

  return {
    side,
    id: batter.id,
    name: batter.name,
    position: batter.position,
    order: batter.order,
    teamName,
    pitcher: oppPitcher?.name || null,
    pitcherThrows: oppPitcher?.throws || null,
    bvp: bvpRow ? { pa: bvpRow.pa, ab: bvpRow.ab, h: bvpRow.hits ?? 0, hr: bvpRow.hr, k: bvpRow.k } : null,
    season: {
      pa: season.pa ?? null, g: season.g ?? null, hr: season.hr ?? null,
      avg: season.avg ?? null, slg: season.slg ?? null, iso,
      hrPerPaPct: hrPerPa != null ? Math.round(hrPerPa * 1000) / 10 : null,
      gameNoHrPct: gameNoHrPct != null ? Math.round(gameNoHrPct * 1000) / 10 : null,
    },
    statcast: sc ? { barrelPct: sc.barrelPct, hardHitPct: sc.hardHitPct } : null,
    vsHand: vsHand ? { hand: oppPitcher?.throws, pa: vsHand.pa, hr: vsHand.hr, iso: vsHand.iso } : null,
    recent: prof?.recent || null,
    score, maxScore, rating, breakdown, flags,
    modelNoHrPct, fairOdds,
  };
}

async function getLowHrReport(gamePk, options = {}) {
  const cacheKey = `lowhr_${gamePk}`;
  if (!options.refresh) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const season = currentMlbSeason();
  const [bvp, lineups, weather, hr9Board, scBat, scPit] = await Promise.all([
    getGameBvp(gamePk, options),
    getGameLineups(gamePk, options),
    fetchGameWeather(gamePk),
    getHr9Leaderboard(season),
    getStatcastIndex(season, 'batter'),
    getStatcastIndex(season, 'pitcher'),
  ]);

  // Shared game context: park + wind flag
  const venue = weather?.venue || null;
  const factor = parkHrFactor(venue);
  const roof = weather?.roofType || null;
  const domed = /dome|roof closed/i.test(String(weather?.condition || ''))
    || /indoor|dome/i.test(String(roof || ''));
  const windStr = String(weather?.wind || '');
  const windFlag = domed ? 'DOME'
    : /out/i.test(windStr) ? 'OUT'
    : /\bin\b|in from/i.test(windStr) ? 'IN'
    : 'NEUTRAL';

  const buildPitcher = async side => {
    const p = lineups[side]?.probablePitcher;
    if (!p) return null;
    const [stats, recent] = await Promise.all([
      getPitcherStats(p.id, season),
      getPitcherRecentHr(p.id, season),
    ]);
    const boardRow = hr9Board.byId[p.id] || null;
    const sc = scPit[String(p.id)] || null;
    const hrPer9 = stats?.current?.hrPer9 ?? boardRow?.hrPer9 ?? null;
    // Not on the board (missed the workload filter) but enough IP to trust the
    // rate: slot them virtually into the sorted board to get a fair rank.
    let rank = boardRow?.rank ?? null;
    let rankSource = boardRow ? 'board' : null;
    if (!boardRow && hrPer9 != null && (stats?.current?.ip ?? 0) >= 15 && hr9Board.hr9List?.length) {
      const idx = hr9Board.hr9List.findIndex(v => v >= hrPer9);
      rank = idx === -1 ? hr9Board.hr9List.length + 1 : idx + 1;
      rankSource = 'virtual';
    }
    return {
      id: p.id,
      name: p.name,
      throws: stats?.throws || null,
      hrPer9,
      prevHrPer9: stats?.previous?.hrPer9 ?? null,
      rank,
      rankSource,
      totalRanked: hr9Board.total,
      top15: rank != null && rank <= 15,
      goAo: stats?.current?.goAo ?? null,
      barrelPctAllowed: sc?.barrelPct ?? null,
      hardHitPctAllowed: sc?.hardHitPct ?? null,
      hrLast3: recent?.hrLast3 ?? null,
      ipLast3: recent?.ipLast3 ?? null,
      era: stats?.current?.era ?? null,
      ip: stats?.current?.ip ?? null,
    };
  };
  const [awayPitcher, homePitcher] = await Promise.all([buildPitcher('away'), buildPitcher('home')]);
  const pitchers = { away: awayPitcher, home: homePitcher };

  // Score every batter against the OPPOSING starter.
  const candidates = [];
  for (const side of ['away', 'home']) {
    const oppSide = side === 'away' ? 'home' : 'away';
    const team = lineups[side];
    const oppPitcher = pitchers[oppSide];
    if (!oppPitcher || !team?.lineup?.length) continue;
    const matchup = bvp?.matchups?.find(m => m.side === side) || null;

    const profiles = await Promise.all(team.lineup.map(b => getBatterHrProfile(b.id, season)));
    team.lineup.forEach((b, i) => {
      const bvpRow = matchup?.batters?.find(x => x.id === b.id)?.bvp || null;
      candidates.push(scoreLowHrCandidate({
        side, batter: b, teamName: team.teamName,
        prof: profiles[i],
        bvpRow: bvpRow && !bvpRow.error ? bvpRow : null,
        sc: scBat[String(b.id)] || null,
        oppPitcher,
        parkFactor: factor, windFlag, weather,
        leagueAvgHr9: hr9Board.leagueAvgHr9,
      }));
    });
  }
  candidates.sort((a, b) => (b.score - a.score) || ((b.modelNoHrPct ?? 0) - (a.modelNoHrPct ?? 0)));

  // Suggested 2-4 leg slip: strong candidates first, fill with decent.
  const slipPool = candidates.filter(c => c.score >= 7);
  const slip = slipPool.length >= 2
    ? slipPool.slice(0, 4).map(c => ({
        name: c.name, side: c.side, teamName: c.teamName, order: c.order,
        score: c.score, maxScore: c.maxScore, rating: c.rating,
        modelNoHrPct: c.modelNoHrPct, fairOdds: c.fairOdds, pitcher: c.pitcher,
      }))
    : [];

  const result = {
    gamePk,
    season,
    park: {
      venue,
      factor,
      roofType: roof,
      classification: factor == null ? 'UNKNOWN' : factor >= 105 ? 'HR-FRIENDLY' : factor <= 96 ? 'HR-SUPPRESSING' : 'NEUTRAL',
    },
    weather,
    windFlag,
    leagueAvgHr9: hr9Board.leagueAvgHr9,
    pitchers,
    candidates,
    slip,
    status: bvp?.status || null,
    source: 'MLB Stats API + Baseball Savant Statcast',
    cachedAt: new Date().toISOString(),
  };
  cacheSet(cacheKey, result, LIVE_CACHE_TTL);
  return result;
}

/* ── BATTER PROP PROJECTION MODEL (transparent) ─────────
   Top-of-tab board for the MLB Edge Finder. For each hitter vs the opposing
   starter, estimates P(Hits ≥ line), P(RBI ≥ line), P(K ≥ line) using Bill
   James Log5 to combine batter & pitcher rates against league average, then a
   Binomial (hits, K) / Poisson (RBI) tail over expected AB/PA. Rates are
   shrunk to league mean by sample size and nudged by park, weather, platoon,
   and a small sample-weighted BvP adjustment. No ML — every number is shown
   in the UI's "how this is calculated" panel so it's verifiable. */

const PROP_LINES = { hits: [0.5, 1.5], rbi: [0.5], k: [0.5, 1.5] };
const LG = { avg: 0.245, kpa: 0.222, rbiG: 0.48, oppOps: 0.715, bf9: 38.3, whiff: 25 };

const _r = (x, d) => x == null ? null : Math.round(x * 10 ** d) / 10 ** d;
function _clampN(x, a, b) { return Math.max(a, Math.min(b, x)); }

function log5(b, p, L) {
  b = _clampN(b, 0.001, 0.999); p = _clampN(p, 0.001, 0.999);
  const num = b * p / L;
  return num / (num + (1 - b) * (1 - p) / (1 - L));
}
function binomTailGE(n, p, k) {
  n = Math.max(1, Math.round(n)); p = _clampN(p, 0, 1);
  let cdf = 0, comb = 1;
  for (let i = 0; i < k; i++) {
    if (i > 0) comb = comb * (n - i + 1) / i;
    cdf += comb * Math.pow(p, i) * Math.pow(1 - p, n - i);
  }
  return _clampN(1 - cdf, 0, 1);
}
function poissonTailGE(lam, k) {
  lam = Math.max(0, lam);
  let cdf = 0, term = Math.exp(-lam);
  for (let i = 0; i < k; i++) { if (i > 0) term = term * lam / i; cdf += term; }
  return _clampN(1 - cdf, 0, 1);
}

// Batter season + last-15 hitting profile (for the prop model).
async function getBatterHitProfile(batterId, season) {
  if (!batterId) return null;
  const cacheKey = `batter_hit_${batterId}_${season}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const data = await fetchJson(`${MLB_API}/people/${batterId}/stats?stats=season,gameLog&group=hitting&season=${season}`);
    const byType = {};
    for (const g of data?.stats || []) byType[g.type?.displayName || ''] = g.splits || [];
    const st = byType.season?.[0]?.stat || {};
    const pa = Number(st.plateAppearances || 0), ab = Number(st.atBats || 0), g = Number(st.gamesPlayed || 0);
    const h = Number(st.hits || 0), k = Number(st.strikeOuts || 0), bb = Number(st.baseOnBalls || 0), rbi = Number(st.rbi || 0);
    const logs = byType.gameLog || [];               // ascending by date
    const last = logs.slice(-15);
    const sv = (arr, key) => arr.reduce((s, x) => s + Number(x.stat?.[key] || 0), 0);
    const l15ab = sv(last, 'atBats'), l15pa = sv(last, 'plateAppearances'), l15h = sv(last, 'hits'), l15k = sv(last, 'strikeOuts');
    const result = {
      season: {
        pa, ab, g, h, k, bb, rbi,
        avg: ab > 0 ? h / ab : null,
        kPerPa: pa > 0 ? k / pa : null,
        bbPerPa: pa > 0 ? bb / pa : null,
        rbiPerG: g > 0 ? rbi / g : null,
        abPerG: g > 0 ? ab / g : null,
        paPerG: g > 0 ? pa / g : null,
      },
      recent: {
        ab: l15ab, pa: l15pa, h: l15h, k: l15k,
        hPerAb: l15ab > 0 ? l15h / l15ab : null,
        kPerPa: l15pa > 0 ? l15k / l15pa : null,
      },
    };
    cacheSet(cacheKey, result, 6 * 60 * 60 * 1000);
    return result;
  } catch { return null; }
}

// Batter handedness ('L' | 'R' | 'S') for platoon — cached a week.
async function getBatterHand(batterId) {
  if (!batterId) return null;
  const cacheKey = `batter_hand_${batterId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const data = await fetchJson(`${MLB_API}/people/${batterId}`);
    const code = data?.people?.[0]?.batSide?.code || null;
    if (code) cacheSet(cacheKey, code, 7 * 24 * 60 * 60 * 1000);
    return code;
  } catch { return null; }
}

function _arsenalWhiff(arsenal) {
  if (!arsenal?.length) return null;
  let u = 0, w = 0;
  for (const p of arsenal) { if (p.whiffPct == null) continue; u += p.usage || 0; w += p.whiffPct * (p.usage || 0); }
  return u > 0 ? w / u : null;
}

function computeBatterProps({ bp, pit, arsenal, weather, parkFactor, batHand, bvp }) {
  const s = bp?.season || {};
  const cur = pit?.current || {};
  const throws = pit?.throws || cur.throws || null;

  // Shrink batter & pitcher rates toward league mean by sample size.
  const wB = s.pa > 0 ? s.pa / (s.pa + 100) : 0;
  const battAvg = (s.avg != null ? wB * s.avg : 0) + (1 - wB) * LG.avg;
  const battKpa = (s.kPerPa != null ? wB * s.kPerPa : 0) + (1 - wB) * LG.kpa;
  const ip = cur.ip || 0, wP = ip / (ip + 50);
  const pAvg = (cur.oppAvg != null ? wP * cur.oppAvg : 0) + (1 - wP) * LG.avg;
  const pKpaRaw = (cur.k9 != null ? cur.k9 : LG.kpa * LG.bf9) / LG.bf9;
  const pKpa = wP * pKpaRaw + (1 - wP) * LG.kpa;

  // Context multipliers (small, clamped).
  const platoonAdv = batHand === 'S' || (!!batHand && !!throws && batHand !== throws);
  const dome = weather?.roofType && /indoor|closed|dome/i.test(weather.roofType);
  const temp = weather?.temp, windStr = String(weather?.wind || '');
  const windOut = /out|to (cf|rf|lf)/i.test(windStr), windIn = /\bin\b|from (cf|rf|lf)/i.test(windStr);
  let wxOff = 1;
  if (!dome) {
    if (temp >= 80) wxOff += 0.02; else if (temp <= 50) wxOff -= 0.02;
    if (windOut) wxOff += 0.02; else if (windIn) wxOff -= 0.02;
  }
  const pf = parkFactor == null ? 100 : parkFactor;
  const parkHitMult = 1 + (pf - 100) * 0.0010;
  const parkRbiMult = 1 + (pf - 100) * 0.0030;

  // HITS — Log5(batter AVG, pitcher AVG-against, league), context, BvP nudge.
  let pHit = log5(battAvg, pAvg, LG.avg) * parkHitMult * wxOff * (platoonAdv ? 1.04 : 0.96);
  if (bvp && bvp.ab >= 10) { const w = Math.min(bvp.ab / 50, 0.3); pHit = (1 - w) * pHit + w * (bvp.hits / bvp.ab); }
  pHit = _clampN(pHit, 0.01, 0.95);
  const abExp = s.abPerG || 3.9;

  // STRIKEOUTS — Log5(batter K/PA, pitcher K/PA, league), whiff + platoon, BvP.
  let pK = log5(battKpa, pKpa, LG.kpa) * (platoonAdv ? 0.95 : 1.05);
  const whiff = _arsenalWhiff(arsenal);
  if (whiff != null) pK *= _clampN(whiff / LG.whiff, 0.85, 1.15);
  if (bvp && bvp.pa >= 10) { const w = Math.min(bvp.pa / 50, 0.3); pK = (1 - w) * pK + w * (bvp.k / bvp.pa); }
  pK = _clampN(pK, 0.01, 0.8);
  const paExp = s.paPerG || 4.2;

  // RBIs — Poisson on a run-environment-adjusted RBI/game rate.
  const wG = s.g > 0 ? s.g / (s.g + 30) : 0;
  let lam = (s.rbiPerG != null ? wG * s.rbiPerG : 0) + (1 - wG) * LG.rbiG;
  const rbiPitMult = _clampN((cur.oppOps != null ? cur.oppOps : LG.oppOps) / LG.oppOps, 0.8, 1.25);
  lam = Math.max(0.02, lam * rbiPitMult * parkRbiMult * wxOff);

  return {
    predictions: {
      hits: { '0.5': binomTailGE(abExp, pHit, 1), '1.5': binomTailGE(abExp, pHit, 2) },
      rbi: { '0.5': poissonTailGE(lam, 1) },
      k: { '0.5': binomTailGE(paExp, pK, 1), '1.5': binomTailGE(paExp, pK, 2) },
    },
    inputs: {
      hits: { battAvg: _r(battAvg, 3), pitchAvgAgainst: _r(pAvg, 3), pHit: _r(pHit, 3), abExp: _r(abExp, 2), parkMult: _r(parkHitMult, 3), wxMult: _r(wxOff, 3), platoonAdv },
      k: { battKpa: _r(battKpa, 3), pitchKpa: _r(pKpa, 3), pK: _r(pK, 3), paExp: _r(paExp, 2), whiffPct: whiff != null ? _r(whiff, 1) : null },
      rbi: { rbiPerG: s.rbiPerG != null ? _r(s.rbiPerG, 2) : null, lambda: _r(lam, 2), pitchMult: _r(rbiPitMult, 3) },
    },
    platoonAdv,
  };
}

async function getBatterPropModel(gamePk, options = {}) {
  const cacheKey = `props_${gamePk}`;
  if (!options.refresh) { const c = cacheGet(cacheKey); if (c) return c; }

  const season = currentMlbSeason();
  const bvpData = await getGameBvp(gamePk, options);
  const lineups = await getGameLineups(gamePk, options);
  const weather = await fetchGameWeather(gamePk);
  const parkFactor = parkHrFactor(weather?.venue);

  const buildSide = async (side) => {
    const oppSide = side === 'away' ? 'home' : 'away';
    const team = lineups[side];
    const oppPitcher = lineups[oppSide]?.probablePitcher;
    if (!team?.lineup?.length || !oppPitcher) return [];
    const [pit, arsenal] = await Promise.all([
      getPitcherStats(oppPitcher.id, season),
      getPitcherArsenal(oppPitcher.id, season),
    ]);
    const matchup = bvpData?.matchups?.find(m => m.side === side) || null;
    const profiles = await Promise.all(team.lineup.map(b => Promise.all([getBatterHitProfile(b.id, season), getBatterHand(b.id)])));
    return team.lineup.map((b, i) => {
      const [bp, batHand] = profiles[i];
      const bvpRow = matchup?.batters?.find(x => x.id === b.id)?.bvp || null;
      const bvp = bvpRow && !bvpRow.error ? { ab: bvpRow.ab, hits: bvpRow.hits, k: bvpRow.k, pa: bvpRow.pa } : null;
      const { predictions, inputs, platoonAdv } = computeBatterProps({ bp, pit, arsenal, weather, parkFactor, batHand, bvp });
      const g = bp?.season?.g || 0;
      return {
        id: b.id, name: b.name, side, order: b.order, position: b.position,
        pitcher: oppPitcher.name, pitcherThrows: pit?.throws || null,
        predictions, inputs,
        context: { bvpPa: bvp?.pa ?? 0, bvpH: bvp?.hits ?? 0, bvpK: bvp?.k ?? 0, platoonAdv, batHand },
        games: g,
        confidence: (g >= 40 && (bvp?.pa ?? 0) >= 10) ? 'HIGH' : g >= 15 ? 'MED' : 'LOW',
      };
    });
  };

  const [away, home] = await Promise.all([buildSide('away'), buildSide('home')]);
  const result = {
    gamePk, season,
    lines: PROP_LINES,
    park: { venue: weather?.venue || null, factor: parkFactor ?? null },
    weather,
    leagueRates: { avg: LG.avg, kPerPa: LG.kpa, rbiPerG: LG.rbiG },
    away, home,
    status: bvpData?.status || null,
    source: 'Log5 matchup model · MLB Stats API season stats + Baseball Savant BvP/arsenal',
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
  getLowHrReport,
  scoreF5,
  getBatterPropModel,
};
