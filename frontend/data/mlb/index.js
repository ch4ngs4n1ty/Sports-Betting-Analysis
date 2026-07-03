/* ============================================================
   PLAYIQ — MLB DATA LAYER
   MLB-only frontend helpers and backend endpoints
   ============================================================ */

// ESPN's ev.date is a UTC timestamp, so a night game (e.g. 8pm ET) is already
// the NEXT calendar day in UTC. Slicing it (`.slice(0,10)`) would send the
// backend tomorrow's date, which for a series resolves TOMORROW's game/pitcher.
// MLB's schedule buckets by the ballpark business date (ET), so normalize to ET
// — the same convention fetchAllGames already uses for the date picker.
function mlbBusinessDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); }
  catch { return String(iso).slice(0, 10); }
}

async function fetchGameBvp(gameInfo, lineups, pitchers) {
  try {
    const date = mlbBusinessDate(gameInfo.date);
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
  } catch {
    return null;
  }
}

async function fetchHighContactReport(gameInfo, lineups, pitchers) {
  try {
    const date = mlbBusinessDate(gameInfo.date);
    const awayNames = (lineups?.away || []).map(b => b.name).join(',');
    const homeNames = (lineups?.home || []).map(b => b.name).join(',');
    const url = `${API_BASE}/api/mlb/high-contact`
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
  } catch {
    return null;
  }
}

async function fetchLowHrReport(gameInfo, lineups, pitchers) {
  try {
    const date = mlbBusinessDate(gameInfo.date);
    const awayNames = (lineups?.away || []).map(b => b.name).join(',');
    const homeNames = (lineups?.home || []).map(b => b.name).join(',');
    const url = `${API_BASE}/api/mlb/low-hr-model`
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
  } catch {
    return null;
  }
}

async function fetchMlbPropModel(gameInfo, lineups, pitchers) {
  try {
    const date = mlbBusinessDate(gameInfo.date);
    const awayNames = (lineups?.away || []).map(b => b.name).join(',');
    const homeNames = (lineups?.home || []).map(b => b.name).join(',');
    const url = `${API_BASE}/api/mlb/prop-model`
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
  } catch {
    return null;
  }
}

async function fetchWeather(gamePk) {
  try {
    const r = await fetch(`${API_BASE}/api/mlb/weather?gamePk=${gamePk}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d?.weather || null;
  } catch {
    return null;
  }
}

const MLB_TEAM_ABBR = {
  108:'LAA', 109:'ARI', 110:'BAL', 111:'BOS', 112:'CHC', 113:'CIN', 114:'CLE',
  115:'COL', 116:'DET', 117:'HOU', 118:'KC', 119:'LAD', 120:'WSH', 121:'NYM',
  133:'ATH', 134:'PIT', 135:'SD', 136:'SEA', 137:'SF', 138:'STL', 139:'TB',
  140:'TEX', 141:'TOR', 142:'MIN', 143:'PHI', 144:'ATL', 145:'CWS', 146:'MIA',
  147:'NYY', 158:'MIL',
};

async function fetchPlayerGameLog(playerId, { count = 5, season } = {}) {
  if (!playerId) return [];
  const yr = season || getSeasonYear('mlb');
  const data = await espnFetch(`https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=hitting&season=${yr}`);
  const splits = data?.stats?.[0]?.splits || [];
  const recent = splits.slice(-count).reverse();
  return recent.map(s => {
    const st = s.stat || {};
    const oppId = s.opponent?.id;
    const oppAbbr = MLB_TEAM_ABBR[oppId] || s.opponent?.name?.split(' ').slice(-1)[0]?.slice(0, 3).toUpperCase() || '?';
    return {
      date: s.date ? new Date(s.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '',
      rawDate: s.date || '',
      opp: oppAbbr,
      home: s.isHome === true,
      gamePk: s.game?.gamePk || null,
      hits: Number(st.hits ?? 0),
      hr: Number(st.homeRuns ?? 0),
      r: Number(st.runs ?? 0),
      rbi: Number(st.rbi ?? 0),
      k: Number(st.strikeOuts ?? 0),
      bb: Number(st.baseOnBalls ?? 0),
      ab: Number(st.atBats ?? 0),
    };
  });
}

async function attachWeatherToGameLog(gameLog, teamAbbr) {
  if (!gameLog?.length || !teamAbbr) return gameLog;
  const weathers = await Promise.all(gameLog.map(async g => {
    if (!g.rawDate) return null;
    try {
      const r = await fetch(`${API_BASE}/api/mlb/weather?date=${g.rawDate}&teamAbbr=${encodeURIComponent(teamAbbr)}`);
      if (!r.ok) return null;
      const j = await r.json();
      return j?.weather || null;
    } catch {
      return null;
    }
  }));
  return gameLog.map((g, i) => ({ ...g, weather: weathers[i] }));
}

async function buildMlbEdgeData(gameInfo, bvpData) {
  if (!bvpData?.matchups?.length) return null;
  const MLB_EDGE_STATS = [
    { key: 'avg', label: 'AVG', higher: true, fmt: v => v?.toFixed(3) ?? '—' },
    { key: 'kRate', label: 'K%', higher: false, fmt: v => v != null ? (v*100).toFixed(1) + '%' : '—' },
    { key: 'hrRate', label: 'HR%', higher: true, fmt: v => v != null ? (v*100).toFixed(1) + '%' : '—' },
    { key: 'obp', label: 'OBP', higher: true, fmt: v => v?.toFixed(3) ?? '—' },
    { key: 'slg', label: 'SLG', higher: true, fmt: v => v?.toFixed(3) ?? '—' },
  ];
  const allBatters = [];
  for (const matchup of bvpData.matchups) {
    if (!matchup.batters?.length || matchup.error) continue;
    const teamColor = matchup.side === 'away' ? '#00d4ff' : '#ffd060';
    const teamAbbr = matchup.side === 'away' ? gameInfo.awayAbbr : gameInfo.homeAbbr;
    for (const b of matchup.batters) {
      const bvp = b.bvp;
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
        avg: { bvp: bvp.avg, label: 'AVG' },
        kRate: { bvp: bvpKRate, label: 'K%' },
        hrRate: { bvp: bvpHrRate, label: 'HR%' },
        obp: { bvp: bvp.obp, label: 'OBP' },
        slg: { bvp: bvp.slg, label: 'SLG' },
      };
      const opsColor = bvp.ops >= 0.900 ? '#00ff88' : bvp.ops >= 0.700 ? '#ffd060' : bvp.ops >= 0.500 ? '#00d4ff' : '#ff6b35';
      allBatters.push({ ...base, edgeStats, opsColor, MLB_EDGE_STATS });
    }
  }

  await Promise.all(allBatters.map(async b => {
    if (!b.id) { b.gameLog = []; return; }
    const log = await fetchPlayerGameLog(b.id, { count: 5 });
    b.gameLog = await attachWeatherToGameLog(log, b.teamAbbr);
  }));

  allBatters.forEach(b => {
    const bvpOps = b.bvp?.ops ?? 0;
    const l5 = b.gameLog || [];
    const hitVals = l5.map(g => g.hits || 0);
    const l5Avg = hitVals.length ? hitVals.reduce((s, v) => s + v, 0) / hitVals.length : 0;
    const l3Avg = hitVals.slice(0, 3).length ? hitVals.slice(0, 3).reduce((s, v) => s + v, 0) / hitVals.slice(0, 3).length : 0;
    const trendRatio = l5Avg > 0 ? Math.min(l3Avg / l5Avg, 2.0) : 1.0;
    let hitStreak = 0;
    for (const h of hitVals) { if (h > 0) hitStreak++; else break; }

    b.hotScore = (bvpOps * 10) * (0.6 + 0.4 * trendRatio) + hitStreak * 0.4;

    if (bvpOps >= 0.850 && hitStreak >= 3) b.hotTier = 'elite';
    else if (bvpOps >= 0.700 || trendRatio >= 1.25) b.hotTier = 'hot';
    else if (l5Avg < 0.4 && bvpOps < 0.400) b.hotTier = 'cold';
    else b.hotTier = 'neutral';
  });

  allBatters.sort((a, b) => (b.hotScore ?? 0) - (a.hotScore ?? 0));
  return { batters: allBatters, bvpStatus: bvpData.status, MLB_EDGE_STATS };
}

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
      id: probable.athlete.id,
      name: probable.athlete.displayName || '?',
      headshot: probable.athlete.headshot?.href || `https://a.espncdn.com/i/headshots/mlb/players/full/${probable.athlete.id}.png`,
      era: statMap.ERA ?? null,
      whip: statMap.WHIP ?? null,
      record: statMap.record || null,
      throws: probable.athlete.throws?.abbreviation || null,
    };
  });
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

Object.assign(window, {
  fetchGameBvp, fetchWeather, fetchHighContactReport, fetchLowHrReport, fetchMlbPropModel,
  fetchPlayerGameLog, attachWeatherToGameLog,
  buildMlbEdgeData, fetchMlbStarters, MLB_TEAM_ABBR,
});
