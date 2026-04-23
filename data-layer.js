/* ============================================================
   PLAYIQ — DATA LAYER
   ESPN public APIs + PlayIQ backend (localhost:3001)
   All functions exported to window for cross-script access.
   ============================================================ */

const API_BASE = 'http://localhost:3001';

const SPORTS_CONFIG = [
  { key: 'mlb',    sport: 'baseball',   league: 'mlb',                    label: 'MLB'   },
  { key: 'nba',    sport: 'basketball', league: 'nba',                    label: 'NBA'   },
  { key: 'nhl',    sport: 'hockey',     league: 'nhl',                    label: 'NHL'   },
  { key: 'ncaamb', sport: 'basketball', league: 'mens-college-basketball', label: 'NCAAB' },
];

function teamLogoUrl(league, abbr, teamId) {
  const pro = ['nba','nfl','mlb','nhl'];
  return pro.includes(league)
    ? `https://a.espncdn.com/i/teamlogos/${league}/500-dark/${(abbr||'').toLowerCase()}.png`
    : `https://a.espncdn.com/i/teamlogos/ncaa/500/${teamId}.png`;
}

async function espnFetch(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function getSeasonYear(sportKey) {
  const now = new Date(), year = now.getFullYear(), month = now.getMonth() + 1;
  if (sportKey === 'nfl' || sportKey === 'ncaafb') return month < 8 ? year - 1 : year;
  return year;
}

/* ── ALL GAMES (dashboard) ────────────────────────────── */
async function fetchAllGames(date) {
  const dateStr = (date || new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })).replace(/-/g, '');
  const results = await Promise.all(
    SPORTS_CONFIG.map(sp =>
      espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/scoreboard?dates=${dateStr}`)
        .then(data => ({ sp, events: data?.events || [] }))
    )
  );
  const allGames = [];
  for (const { sp, events } of results) {
    for (const ev of events) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const home = comp.competitors?.find(c => c.homeAway === 'home');
      const away = comp.competitors?.find(c => c.homeAway === 'away');
      if (!home || !away) continue;
      const odds = comp.odds?.[0];
      const parseScore = s => { const v = parseInt(s?.displayValue ?? s ?? ''); return isNaN(v) ? null : v; };
      allGames.push({
        sportKey: sp.key, sportLabel: sp.label, sport: sp.sport, league: sp.league,
        eventId: ev.id,
        awayFull: away.team.displayName, awayAbbr: away.team.abbreviation, awayTeamId: away.team.id,
        awayScore: parseScore(away.score), awayLogo: teamLogoUrl(sp.league, away.team.abbreviation, away.team.id),
        homeFull: home.team.displayName, homeAbbr: home.team.abbreviation, homeTeamId: home.team.id,
        homeScore: parseScore(home.score), homeLogo: teamLogoUrl(sp.league, home.team.abbreviation, home.team.id),
        statusText: ev.status?.type?.description || 'Scheduled',
        statusState: ev.status?.type?.state,
        statusDetail: ev.status?.type?.shortDetail || '',
        date: ev.date, venue: comp.venue?.fullName,
        spread: odds?.details, overUnder: odds?.overUnder,
        awayMoneyline: odds?.awayTeamOdds?.moneyLine,
        homeMoneyline: odds?.homeTeamOdds?.moneyLine,
      });
    }
  }
  return allGames;
}

/* ── TEAM FORM (last 10) ─────────────────────────────── */
async function fetchTeamForm(sportKey, teamId) {
  const sp = SPORTS_CONFIG.find(s => s.key === sportKey);
  if (!sp) return [];
  const season = getSeasonYear(sportKey);
  const data = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/schedule?season=${season}`);
  if (!data?.events) return [];
  const completed = data.events.filter(e => e.competitions?.[0]?.status?.type?.completed).slice(-10);
  return completed.map(ev => {
    const comp = ev.competitions[0];
    const mine = comp.competitors?.find(c => c.team?.id === teamId);
    const opp  = comp.competitors?.find(c => c.team?.id !== teamId);
    const ps = s => parseInt(s?.displayValue ?? s ?? 0) || 0;
    const myScore = ps(mine?.score), oppScore = ps(opp?.score);
    const result = mine?.winner === true ? 'W' : mine?.winner === false ? 'L' : myScore > oppScore ? 'W' : myScore < oppScore ? 'L' : 'T';
    return {
      eventId: ev.id, result,
      opponent: opp?.team?.abbreviation || '?', opponentFull: opp?.team?.displayName || '',
      oppLogo: teamLogoUrl(sp.league, opp?.team?.abbreviation, opp?.team?.id),
      myScore, oppScore, home: comp.competitors?.find(c => c.homeAway==='home')?.team?.id === teamId,
      date: new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    };
  });
}

/* ── ENRICH FORM WITH PLAYER STATS ─────────────────────── */
async function enrichFormWithPlayerStats(sportKey, teamId, formGames) {
  const sp = SPORTS_CONFIG.find(s => s.key === sportKey);
  if (!sp) return formGames;
  const MLB_CATS = [
    { key: 'hits', label: 'H', espnBoxLabel: 'H', espnLeaderCat: 'hits' },
    { key: 'rbi',  label: 'RBI', espnBoxLabel: 'RBI', espnLeaderCat: 'RBI' },
    { key: 'runs', label: 'R', espnBoxLabel: 'R', espnLeaderCat: 'runs' },
  ];
  const NBA_CATS = [
    { key: 'pts', label: 'PTS', espnBoxLabel: 'PTS' },
    { key: 'reb', label: 'REB', espnBoxLabel: 'REB' },
    { key: 'ast', label: 'AST', espnBoxLabel: 'AST' },
  ];
  const cats = sportKey === 'mlb' ? MLB_CATS : NBA_CATS;
  const summaries = await Promise.all(
    formGames.map(g => g.eventId
      ? espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/summary?event=${g.eventId}`)
      : Promise.resolve(null))
  );
  return formGames.map((g, i) => {
    const summary = summaries[i];
    const teamPlayers = summary?.boxscore?.players?.find(p => String(p.team?.id) === String(teamId));
    const statsGroup = teamPlayers?.statistics?.[0];
    if (!statsGroup) return { ...g, player: null };
    const labels = statsGroup.labels || [];
    const athletes = statsGroup.athletes || [];
    const player = {};
    cats.forEach(c => {
      const idx = labels.indexOf(c.espnBoxLabel);
      if (idx === -1) return;
      let best = null, max = -1;
      for (const ath of athletes) {
        const val = parseInt(ath.stats?.[idx] || 0);
        if (val > max) {
          max = val;
          const a = ath.athlete || {};
          best = { name: a.shortName || a.displayName || '?', value: val,
            headshot: a.headshot?.href || (a.id ? `https://a.espncdn.com/i/headshots/${sp.league}/players/full/${a.id}.png` : null) };
        }
      }
      player[c.key] = best;
    });
    return { ...g, player, cats };
  });
}

/* ── HEAD TO HEAD ─────────────────────────────────────── */
async function fetchH2H(gameInfo) {
  const sp = SPORTS_CONFIG.find(s => s.key === gameInfo.sportKey);
  if (!sp) return { games: [], summaries: [] };
  const baseSeason = getSeasonYear(gameInfo.sportKey);
  const seasons = [baseSeason, baseSeason - 1, baseSeason - 2];
  const fetched = await Promise.all(
    seasons.flatMap(season => [2, 3].map(stype =>
      espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${gameInfo.awayTeamId}/schedule?season=${season}&seasontype=${stype}`)
        .then(d => d?.events || [])
    ))
  );
  const seen = new Set();
  const allEvents = [];
  for (const list of fetched) {
    for (const ev of list) {
      if (ev?.id && !seen.has(ev.id)) { seen.add(ev.id); allEvents.push(ev); }
    }
  }
  const h2h = allEvents
    .filter(ev => {
      const comp = ev.competitions?.[0];
      return comp?.status?.type?.completed && comp.competitors?.some(c => c.team?.id === gameInfo.homeTeamId);
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);
  const summaries = await Promise.all(
    h2h.map(ev => espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/summary?event=${ev.id}`))
  );
  const MLB_CATS = [
    { key: 'hits', espnLeaderCat: 'hits' },
    { key: 'rbi',  espnLeaderCat: 'RBI' },
    { key: 'runs', espnLeaderCat: 'runs' },
  ];
  const NBA_CATS = [
    { key: 'pts', espnLeaderCat: 'points' },
    { key: 'reb', espnLeaderCat: 'rebounds' },
    { key: 'ast', espnLeaderCat: 'assists' },
  ];
  const cats = gameInfo.sportKey === 'mlb' ? MLB_CATS : NBA_CATS;
  const games = h2h.map((ev, i) => {
    const comp = ev.competitions[0];
    const awayC = comp.competitors.find(c => c.homeAway === 'away');
    const homeC = comp.competitors.find(c => c.homeAway === 'home');
    const ps = s => parseInt(s?.displayValue ?? s ?? 0) || 0;
    const awayScore = ps(awayC?.score), homeScore = ps(homeC?.score);
    const leaders = summaries[i]?.leaders || [];
    const getLeader = (teamAbbr, catName) => {
      const tl = leaders.find(l => l.team?.abbreviation === teamAbbr);
      const cat = tl?.leaders?.find(c => c.name === catName);
      const top = cat?.leaders?.[0];
      return top ? {
        name: top.athlete?.shortName || top.athlete?.displayName || '?',
        value: parseInt(top.displayValue) || 0,
        headshot: top.athlete?.headshot?.href || (top.athlete?.id ? `https://a.espncdn.com/i/headshots/${sp.league}/players/full/${top.athlete.id}.png` : null)
      } : null;
    };
    const awayLeaders = {}, homeLeaders = {};
    cats.forEach(c => {
      awayLeaders[c.key] = getLeader(gameInfo.awayAbbr, c.espnLeaderCat);
      homeLeaders[c.key] = getLeader(gameInfo.homeAbbr, c.espnLeaderCat);
    });
    return {
      date: new Date(ev.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      awayAbbr: awayC?.team?.abbreviation, homeAbbr: homeC?.team?.abbreviation,
      awayScore, homeScore,
      winner: awayC?.winner === true ? 'away' : homeC?.winner === true ? 'home' : awayScore > homeScore ? 'away' : 'home',
      awayLeaders, homeLeaders,
    };
  });
  return { games, summaries };
}

/* ── INJURIES ─────────────────────────────────────────── */
async function fetchInjuries(gameInfo) {
  const sp = SPORTS_CONFIG.find(s => s.key === gameInfo.sportKey);
  if (!sp) return { away: [], home: [] };
  const data = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/injuries`);
  if (!data?.injuries) return { away: [], home: [] };
  const filter = (teamId) => {
    const t = data.injuries.find(t => String(t.id) === String(teamId));
    return (t?.injuries || []).map(inj => {
      const athleteId = inj.athlete?.id || null;
      return {
        name: inj.athlete?.displayName || '—',
        status: inj.status || 'Unknown',
        pos: inj.athlete?.position?.abbreviation || '',
        athleteId,
        headshot: athleteId ? `https://a.espncdn.com/i/headshots/${sp.league}/players/full/${athleteId}.png` : null,
        desc: (inj.shortComment || '').match(/\(([^)]+)\)/)?.[1] || '',
      };
    });
  };
  return { away: filter(gameInfo.awayTeamId), home: filter(gameInfo.homeTeamId) };
}

/* ── ROSTER ───────────────────────────────────────────── */
async function fetchRoster(sportKey, teamId) {
  const sp = SPORTS_CONFIG.find(s => s.key === sportKey);
  if (!sp) return [];
  const data = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/roster`);
  if (!data?.athletes) return [];
  const players = [];
  (data.athletes || []).forEach(group => {
    (group.items || [group]).forEach(p => {
      if (!p.fullName) return;
      const injStatus = typeof p.injuries?.[0]?.status === 'string' ? p.injuries[0].status : (p.injuries?.[0]?.status?.description || null);
      const status = injStatus || (typeof p.status === 'string' ? p.status : p.status?.description || 'Active');
      players.push({
        id: p.id, name: p.displayName || p.fullName,
        pos: p.position?.abbreviation || '—', jersey: p.jersey || '—',
        status, injuryDesc: p.injuries?.[0]?.type?.description || '',
        headshot: p.headshot?.href || (p.id ? `https://a.espncdn.com/i/headshots/${sp.league}/players/full/${p.id}.png` : null),
      });
    });
  });
  return players;
}

/* ── TEAM STATS ───────────────────────────────────────── */
async function fetchTeamStats(sportKey, teamId) {
  const sp = SPORTS_CONFIG.find(s => s.key === sportKey);
  if (!sp) return null;
  const data = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/statistics`);
  if (!data?.results?.stats?.categories) return null;
  const result = {};
  for (const cat of data.results.stats.categories) {
    for (const stat of cat.stats || []) {
      result[stat.name] = { value: stat.value, rank: stat.rank ?? null };
    }
  }
  return Object.keys(result).length ? result : null;
}

/* ── BACKEND: GAME BVP ───────────────────────────────── */
async function fetchGameBvp(gameInfo, lineups, pitchers) {
  try {
    const date = gameInfo.date ? gameInfo.date.slice(0, 10) : '';
    const awayNames = (lineups?.away || []).map(b => b.name).join(',');
    const homeNames = (lineups?.home || []).map(b => b.name).join(',');
    const url = `${API_BASE}/api/mlb/game-bvp`
      + `?away=${encodeURIComponent(gameInfo.awayFull)}`
      + `&home=${encodeURIComponent(gameInfo.homeFull)}`
      + (date ? `&date=${date}` : '')
      + (awayNames ? `&awayLineup=${encodeURIComponent(awayNames)}` : '')
      + (homeNames ? `&homeLineup=${encodeURIComponent(homeNames)}` : '')
      + (pitchers?.away?.name ? `&awayPitcher=${encodeURIComponent(pitchers.away.name)}` : '')
      + (pitchers?.home?.name ? `&homePitcher=${encodeURIComponent(pitchers.home.name)}` : '');
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/* ── BACKEND: WEATHER ────────────────────────────────── */
async function fetchWeather(gamePk) {
  try {
    const r = await fetch(`${API_BASE}/api/mlb/weather?gamePk=${gamePk}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d?.weather || null;
  } catch { return null; }
}

/* ── MLB PLAYER GAME LOG (last N season games) ──────── */
// MLB Stats API `/gameLog` only returns opponent {id, name} — no abbr —
// so we map team id → abbr here (stable set of 30 MLB teams).
const MLB_TEAM_ABBR = {
  108:'LAA', 109:'ARI', 110:'BAL', 111:'BOS', 112:'CHC', 113:'CIN', 114:'CLE',
  115:'COL', 116:'DET', 117:'HOU', 118:'KC',  119:'LAD', 120:'WSH', 121:'NYM',
  133:'ATH', 134:'PIT', 135:'SD',  136:'SEA', 137:'SF',  138:'STL', 139:'TB',
  140:'TEX', 141:'TOR', 142:'MIN', 143:'PHI', 144:'ATL', 145:'CWS', 146:'MIA',
  147:'NYY', 158:'MIL',
};

// Returns [{date, opp, home, gamePk, hits, hr, r, rbi, k, bb}] newest-first.
async function fetchPlayerGameLog(playerId, { count = 5, season } = {}) {
  if (!playerId) return [];
  const yr = season || getSeasonYear('mlb');
  const data = await espnFetch(
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=hitting&season=${yr}`
  );
  const splits = data?.stats?.[0]?.splits || [];
  const recent = splits.slice(-count).reverse(); // newest first
  return recent.map(s => {
    const st = s.stat || {};
    const oppId = s.opponent?.id;
    const oppAbbr = MLB_TEAM_ABBR[oppId] || s.opponent?.name?.split(' ').slice(-1)[0]?.slice(0,3).toUpperCase() || '?';
    return {
      date: s.date ? new Date(s.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '',
      rawDate: s.date || '',
      opp: oppAbbr,
      home: s.isHome === true,
      gamePk: s.game?.gamePk || null,
      hits:  Number(st.hits ?? 0),
      hr:    Number(st.homeRuns ?? 0),
      r:     Number(st.runs ?? 0),
      rbi:   Number(st.rbi ?? 0),
      k:     Number(st.strikeOuts ?? 0),
      bb:    Number(st.baseOnBalls ?? 0),
      ab:    Number(st.atBats ?? 0),
    };
  });
}

// Decorate a gameLog with weather via our backend (/api/mlb/weather?date=&teamAbbr=).
// Uses teamAbbr from the player's side so the backend can resolve the correct gamePk.
async function attachWeatherToGameLog(gameLog, teamAbbr) {
  if (!gameLog?.length || !teamAbbr) return gameLog;
  const weathers = await Promise.all(gameLog.map(async g => {
    if (!g.rawDate) return null;
    try {
      const r = await fetch(`${API_BASE}/api/mlb/weather?date=${g.rawDate}&teamAbbr=${encodeURIComponent(teamAbbr)}`);
      if (!r.ok) return null;
      const j = await r.json();
      return j?.weather || null;
    } catch { return null; }
  }));
  return gameLog.map((g, i) => ({ ...g, weather: weathers[i] }));
}

/* ── MLB EDGE FINDER DATA ─────────────────────────────── */
// Builds edge data from BvP backend + ESPN athlete stats + MLB gameLog enrichment.
async function buildMlbEdgeData(gameInfo, bvpData) {
  if (!bvpData?.matchups?.length) return null;
  const MLB_EDGE_STATS = [
    { key: 'avg',    label: 'AVG',  higher: true,  fmt: v => v?.toFixed(3) ?? '—' },
    { key: 'kRate',  label: 'K%',   higher: false, fmt: v => v != null ? (v*100).toFixed(1)+'%' : '—' },
    { key: 'hrRate', label: 'HR%',  higher: true,  fmt: v => v != null ? (v*100).toFixed(1)+'%' : '—' },
    { key: 'obp',    label: 'OBP',  higher: true,  fmt: v => v?.toFixed(3) ?? '—' },
    { key: 'slg',    label: 'SLG',  higher: true,  fmt: v => v?.toFixed(3) ?? '—' },
  ];
  const allBatters = [];
  for (const matchup of bvpData.matchups) {
    if (!matchup.batters?.length || matchup.error) continue;
    const teamColor = matchup.side === 'away' ? '#00d4ff' : '#ffd060';
    const teamAbbr  = matchup.side === 'away' ? gameInfo.awayAbbr : gameInfo.homeAbbr;
    for (const b of matchup.batters) {
      const bvp = b.bvp;
      // b.id is an MLB Stats API person id (not ESPN), so use MLB's CDN.
      const headshotUrl = b.id
        ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current/w_426,q_auto:best/v1/people/${b.id}/headshot/67/current`
        : null;
      const base = { ...b, side: matchup.side, teamAbbr, pitcher: matchup.pitcher?.name, teamColor, headshotUrl };
      if (!bvp || bvp.pa < 3) {
        allBatters.push({ ...base, edgeStats: null });
        continue;
      }
      const bvpKRate = bvp.pa > 0 ? bvp.k / bvp.pa : null;
      const bvpHrRate = bvp.ab > 0 ? bvp.hr / bvp.ab : null;
      const edgeStats = {
        avg:    { bvp: bvp.avg,    label: 'AVG' },
        kRate:  { bvp: bvpKRate,   label: 'K%' },
        hrRate: { bvp: bvpHrRate,  label: 'HR%' },
        obp:    { bvp: bvp.obp,    label: 'OBP' },
        slg:    { bvp: bvp.slg,    label: 'SLG' },
      };
      const opsColor = bvp.ops >= 0.900 ? '#00ff88' : bvp.ops >= 0.700 ? '#ffd060' : bvp.ops >= 0.500 ? '#00d4ff' : '#ff6b35';
      allBatters.push({ ...base, edgeStats, opsColor, MLB_EDGE_STATS });
    }
  }
  allBatters.sort((a, b) => {
    const aOps = a.bvp?.ops ?? -1, bOps = b.bvp?.ops ?? -1;
    return bOps - aOps;
  });

  // Fetch last-5 season game logs for every batter in parallel, then decorate
  // each with weather via our backend. MLB Stats API is fast; the weather
  // endpoint is heavily cached per-gamePk so duplicates across a lineup share.
  await Promise.all(allBatters.map(async b => {
    if (!b.id) { b.gameLog = []; return; }
    const log = await fetchPlayerGameLog(b.id, { count: 5 });
    b.gameLog = await attachWeatherToGameLog(log, b.teamAbbr);
  }));

  return { batters: allBatters, bvpStatus: bvpData.status, MLB_EDGE_STATS };
}

/* ── NBA PLAYER GAME LOG (ESPN) ──────────────────────── */
// Returns [{rawDate, date, opp, oppTeamId, home, pts, reb, ast, min, eventId}] newest-first.
// Includes Regular Season + Postseason; excludes Preseason.
async function fetchNbaPlayerGameLog(playerId, { season } = {}) {
  if (!playerId) return [];
  const yr = season || getSeasonYear('nba');
  const data = await espnFetch(
    `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog?season=${yr}`
  );
  if (!data) return [];

  // Column order is defined by top-level `names` (e.g. 'minutes','totalRebounds','assists','points').
  const names = (data.names || []).map(n => String(n).toLowerCase());
  const idx = { min: names.indexOf('minutes'), reb: names.indexOf('totalrebounds'), ast: names.indexOf('assists'), pts: names.indexOf('points') };

  const events = data.events || {};
  const out = [];
  for (const st of (data.seasonTypes || [])) {
    const typeName = String(st.displayName || '').toLowerCase();
    if (typeName.includes('preseason')) continue;
    for (const cat of (st.categories || [])) {
      for (const ev of (cat.events || [])) {
        const meta = events[ev.eventId] || {};
        const stats = ev.stats || [];
        const num = i => { if (i < 0) return 0; const v = parseInt(stats[i]); return isNaN(v) ? 0 : v; };
        out.push({
          eventId: ev.eventId,
          rawDate: meta.gameDate || '',
          date: meta.gameDate ? new Date(meta.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '',
          opp: meta.opponent?.abbreviation || '?',
          oppTeamId: meta.opponent?.id ? String(meta.opponent.id) : null,
          home: meta.atVs === 'vs',
          min: num(idx.min),
          pts: num(idx.pts),
          reb: num(idx.reb),
          ast: num(idx.ast),
          result: meta.gameResult || null,
          score: meta.score || null,
        });
      }
    }
  }
  // Newest first
  out.sort((a, b) => String(b.rawDate).localeCompare(String(a.rawDate)));
  return out;
}

/* ── NBA EDGE FINDER DATA ─────────────────────────────── */
// For both teams: grab the top-N active roster players, fetch each gamelog in
// parallel, derive last-5 (any opponent) + H2H-vs-opposing-team slices, then
// sort within each side by L5 avg points so stars float to the top.
async function buildNbaEdgeData(gameInfo) {
  if (gameInfo?.sportKey !== 'nba') return null;
  const [awayRoster, homeRoster] = await Promise.all([
    fetchRoster('nba', gameInfo.awayTeamId),
    fetchRoster('nba', gameInfo.homeTeamId),
  ]);

  const TOP_N = 8;
  const isActive = p => !/^(out|suspended|injured_reserve)/i.test(p.status || '');
  const pick = r => (r || []).filter(isActive).slice(0, TOP_N);

  const buildMeta = (players, side, teamAbbr, teamColor, oppTeamId, oppAbbr) =>
    players.map(p => ({
      id: p.id, name: p.name, pos: p.pos, jersey: p.jersey,
      headshot: p.headshot, status: p.status,
      side, teamAbbr, teamColor, oppTeamId: String(oppTeamId), oppAbbr,
    }));

  const all = [
    ...buildMeta(pick(awayRoster), 'away', gameInfo.awayAbbr, '#00d4ff', gameInfo.homeTeamId, gameInfo.homeAbbr),
    ...buildMeta(pick(homeRoster), 'home', gameInfo.homeAbbr, '#ffd060', gameInfo.awayTeamId, gameInfo.awayAbbr),
  ];

  // Parallel gamelog fetch — roughly 16 calls. ESPN is fast (~400ms each).
  await Promise.all(all.map(async p => {
    const log = await fetchNbaPlayerGameLog(p.id);
    p.l5  = log.slice(0, 5);
    p.h2h = log.filter(g => g.oppTeamId === p.oppTeamId).slice(0, 5);
    p.avgPts = p.l5.length ? p.l5.reduce((s, g) => s + (g.pts || 0), 0) / p.l5.length : 0;
    p.avgReb = p.l5.length ? p.l5.reduce((s, g) => s + (g.reb || 0), 0) / p.l5.length : 0;
    p.avgAst = p.l5.length ? p.l5.reduce((s, g) => s + (g.ast || 0), 0) / p.l5.length : 0;
  }));

  const sortByPts = list => list.slice().sort((a, b) => (b.avgPts || 0) - (a.avgPts || 0));
  const away = sortByPts(all.filter(p => p.side === 'away'));
  const home = sortByPts(all.filter(p => p.side === 'home'));

  return { players: [...away, ...home], awayAbbr: gameInfo.awayAbbr, homeAbbr: gameInfo.homeAbbr };
}

/* ── CLAUDE API (direct browser → Anthropic) ──────────── */
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';

function getApiKey() {
  return localStorage.getItem('piq_key') || '';
}

async function claudeComplete(prompt, { maxTokens = 1200 } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('NO_API_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

// Shim so existing UI code that calls window.claude.complete() still works
window.claude = window.claude || {};
window.claude.complete = claudeComplete;

/* ── AI PLAYS ─────────────────────────────────────────── */
async function generateAIPlays(gameData) {
  const { gameInfo, awayForm, homeForm, h2h } = gameData;
  const awayW = (awayForm || []).filter(g => g.result === 'W').length;
  const homeW = (homeForm || []).filter(g => g.result === 'W').length;
  const h2hGames = (h2h?.games || []).slice(0, 3);
  const prompt = `You are a sports betting analyst. Analyze this ${gameInfo.sportLabel} game and provide 3 specific prop or game bets.

Game: ${gameInfo.awayFull} @ ${gameInfo.homeFull}
Venue: ${gameInfo.venue || 'TBD'}
Spread: ${gameInfo.spread || 'N/A'} | O/U: ${gameInfo.overUnder || 'N/A'}
${gameInfo.awayAbbr} last ${awayForm?.length || 0}: ${awayW}W-${(awayForm?.length||0)-awayW}L
${gameInfo.homeAbbr} last ${homeForm?.length || 0}: ${homeW}W-${(homeForm?.length||0)-homeW}L
H2H recent: ${h2hGames.map(g => `${g.awayAbbr} ${g.awayScore}-${g.homeScore} ${g.homeAbbr} (${g.date})`).join(', ') || 'No recent data'}

Respond with exactly 3 plays in this JSON format:
[{"play":"bet description","confidence":"HIGH|MEDIUM|LOW","reason":"1-sentence reason","type":"SPREAD|TOTAL|PROP|ML"}]`;

  try {
    const response = await claudeComplete(prompt, { maxTokens: 900 });
    const match = response.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
  } catch (e) {
    if (e.message === 'NO_API_KEY') return { error: 'NO_API_KEY' };
    console.error('generateAIPlays failed:', e);
  }
  return [];
}

/* ── MLB STARTERS FROM ESPN ──────────────────────────── */
async function fetchMlbStarters(gameInfo) {
  const sp = SPORTS_CONFIG.find(s => s.key === 'mlb');
  const summary = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/summary?event=${gameInfo.eventId}`);
  if (!summary) return { away: null, home: null, lineups: { away: [], home: [] } };
  const pitchers = { away: null, home: null };
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  competitors.forEach(team => {
    const side = String(team.team?.id || team.id) === String(gameInfo.awayTeamId) ? 'away' : 'home';
    const probable = (team.probables || []).find(p => p?.athlete);
    if (!probable?.athlete) return;
    const statMap = {};
    (probable.statistics?.splits?.categories || []).forEach(s => { statMap[s.name] = s.value ?? s.displayValue ?? null; });
    pitchers[side] = {
      id: probable.athlete.id, name: probable.athlete.displayName || '?',
      headshot: probable.athlete.headshot?.href || `https://a.espncdn.com/i/headshots/mlb/players/full/${probable.athlete.id}.png`,
      era: statMap.ERA ?? null, whip: statMap.WHIP ?? null,
      record: statMap.record || null, throws: probable.athlete.throws?.abbreviation || null,
    };
  });
  // Extract lineups from rosters
  const lineups = { away: [], home: [] };
  (summary.rosters || []).forEach(teamData => {
    const side = String(teamData.team?.id) === String(gameInfo.awayTeamId) ? 'away' : 'home';
    lineups[side] = (teamData.roster || [])
      .filter(p => p?.starter)
      .sort((a, b) => (a.batOrder || 99) - (b.batOrder || 99))
      .map(p => ({
        name: p.athlete?.displayName || '?', shortName: p.athlete?.shortName || '?',
        athleteId: p.athlete?.id, order: p.batOrder || null, pos: p.position?.abbreviation || '—',
        headshot: p.athlete?.id ? `https://a.espncdn.com/i/headshots/mlb/players/full/${p.athlete.id}.png` : null,
      }));
  });
  return { pitchers, lineups, summary };
}

/* ── EXPORT ──────────────────────────────────────────── */
Object.assign(window, {
  SPORTS_CONFIG, API_BASE, teamLogoUrl, espnFetch, getSeasonYear,
  fetchAllGames, fetchTeamForm, enrichFormWithPlayerStats,
  fetchH2H, fetchInjuries, fetchRoster, fetchTeamStats,
  fetchGameBvp, fetchWeather, buildMlbEdgeData, generateAIPlays,
  fetchMlbStarters, fetchPlayerGameLog, attachWeatherToGameLog,
  fetchNbaPlayerGameLog, buildNbaEdgeData,
  getApiKey, claudeComplete, CLAUDE_MODEL,
});
