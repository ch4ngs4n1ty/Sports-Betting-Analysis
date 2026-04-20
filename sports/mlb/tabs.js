/* ── MLB TABS ─────────────────────────────────────────────
   MLB-specific tab fetch/render logic for Pitching Edge.

   Depends on shared helpers from app.js:
   - espn(), getSeasonYear(), fetchTeamStats()
─────────────────────────────────────────────────────────── */
/* ═══════════════════════════════════════════════════════════
   PITCHING EDGE (MLB ONLY)
   Fetches starting pitcher stats, team batting/pitching
   stats, and renders matchup analysis for MLB games.
═══════════════════════════════════════════════════════════ */

function parseMlbStatCategory(cat) {
  if (!cat?.names?.length || !cat?.statistics?.length) return [];
  return cat.statistics.map(row => {
    const stats = {};
    cat.names.forEach((name, i) => {
      const raw = row.stats?.[i];
      const num = parseFloat(raw);
      stats[name] = Number.isNaN(num) ? raw : num;
    });
    return {
      season: row.season?.year || null,
      displayName: row.displayName || '',
      stats,
    };
  });
}

function pickSeasonRow(rows, seasonYear) {
  const matches = rows.filter(r => r.season === seasonYear);
  if (!matches.length) return null;
  return matches.find(r => /totals/i.test(r.displayName)) || matches[matches.length - 1];
}

function toMlbRate(numerator, denominator) {
  if (numerator == null || denominator == null || !denominator) return null;
  return numerator / denominator;
}

function toBb9(walks, innings) {
  if (walks == null || innings == null || !innings) return null;
  return (walks * 9) / innings;
}

function extractMlbOverallTeamStats(stats) {
  if (!stats) return {};
  const g = (key) => stats[key]?.value ?? null;
  const r = (key) => stats[key]?.rank ?? null;
  // ESPN uses varying key names across endpoints — try multiple variants
  const first = (...keys) => { for (const k of keys) { const v = g(k); if (v != null) return v; } return null; };
  const firstR = (...keys) => { for (const k of keys) { const v = r(k); if (v != null) return v; } return null; };
  return {
    era: first('ERA', 'earnedRunAverage'), eraRank: firstR('ERA', 'earnedRunAverage'),
    whip: first('WHIP', 'walksAndHitsPerInningPitched'), whipRank: firstR('WHIP', 'walksAndHitsPerInningPitched'),
    k9: first('strikeoutsPerNineInnings', 'K/9', 'strikeoutsPer9Inn'), k9Rank: firstR('strikeoutsPerNineInnings', 'K/9', 'strikeoutsPer9Inn'),
    bb9: first('walksPerNineInnings', 'BB/9', 'basesOnBallsPerNineInnings', 'walksPer9Inn'), bb9Rank: firstR('walksPerNineInnings', 'BB/9', 'basesOnBallsPerNineInnings', 'walksPer9Inn'),
    battingAvg: first('avg', 'battingAvg', 'AVG'), battingAvgRank: firstR('avg', 'battingAvg', 'AVG'),
    ops: first('OPS', 'onBasePlusSlugging'), opsRank: firstR('OPS', 'onBasePlusSlugging'),
    obp: first('onBasePct', 'OBP', 'onBasePercentage'),
    strikeouts: first('strikeouts'),
    walks: first('walks', 'basesOnBalls'),
    plateAppearances: first('plateAppearances'),
    innings: first('innings', 'inningsPitched'),
    kRate: first('strikeoutsPerPlateAppearance', 'strikeoutRate', 'strikeoutPct'),
    walkRate: first('walksPerPlateAppearance', 'walkRate', 'walkPct', 'basesOnBallsPct'),
  };
}

async function fetchMlbTeamSplitStats(teamId) {
  const data = await espn(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${teamId}/statistics`);
  const splits = data?.results?.splits || [];
  const statsCategories = data?.results?.stats?.categories || [];

  // Extract overall pitching stats from the main stats block
  const pitchingStats = {};
  for (const cat of statsCategories) {
    if (cat.name === 'pitching' || cat.displayName === 'Pitching') {
      for (const stat of cat.stats || []) {
        pitchingStats[stat.name] = { value: stat.value, rank: stat.rank ?? null };
      }
    }
  }

  const normalizeSplit = (label) => {
    if (!Array.isArray(splits)) return null;
    const entry = splits.find(s => s?.displayName === label || s?.name === label);
    const batting = entry?.categories?.find(c => c.name === 'batting');
    if (!batting?.stats?.length) return null;
    const statMap = {};
    batting.stats.forEach(stat => { statMap[stat.name] = stat.value; });
    const pa = statMap.plateAppearances;
    const strikeouts = statMap.strikeouts;
    const walks = statMap.walks;
    return {
      battingAvg: statMap.avg ?? null,
      ops: statMap.OPS ?? null,
      obp: statMap.onBasePct ?? null,
      strikeouts,
      walks,
      plateAppearances: pa ?? null,
      kRate: toMlbRate(strikeouts, pa),
      walkRate: toMlbRate(walks, pa),
    };
  };

  return {
    vsLeft: normalizeSplit('vs. Left'),
    vsRight: normalizeSplit('vs. Right'),
    home: normalizeSplit('Home'),
    away: normalizeSplit('Away'),
    pitchingStats,
  };
}

async function fetchMlbAthleteStats(athleteId) {
  return espn(`https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${athleteId}/stats?region=us&lang=en&contentorigin=espn`);
}

// ── ESPN roster → normalized-name map (for backend-lineup fallback) ──
const _mlbRosterCache = new Map();
async function fetchMlbRosterMap(teamId) {
  if (!teamId) return {};
  if (_mlbRosterCache.has(teamId)) return _mlbRosterCache.get(teamId);
  const data = await espn(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/${teamId}/roster`);
  const map = {};
  const groups = data?.athletes || [];
  groups.forEach(group => {
    (group.items || []).forEach(a => {
      if (!a?.id) return;
      const key = normalizePlayerName(a.displayName || a.fullName || '');
      if (key) map[key] = {
        id: a.id,
        shortName: a.shortName || a.displayName,
        pos: a.position?.abbreviation || '—',
      };
    });
  });
  _mlbRosterCache.set(teamId, map);
  return map;
}

async function fetchMlbAthleteSplits(athleteId, season) {
  return espn(`https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${athleteId}/splits?region=us&lang=en&contentorigin=espn&season=${season}`);
}

function extractVsTeamFromSplits(splitsData, opponentTeamName) {
  if (!splitsData?.splitCategories) return null;
  const names = splitsData.names || [];
  const oppCat = splitsData.splitCategories.find(c => c.displayName === 'Opponent' || c.name === 'opponent');
  if (!oppCat) return null;
  const target = opponentTeamName.toLowerCase();
  const match = oppCat.splits?.find(s => s.displayName?.toLowerCase().includes(target));
  if (!match?.stats?.length) return null;
  const stats = {};
  names.forEach((n, i) => { stats[n] = match.stats[i]; });
  return {
    ab: parseInt(stats.atBats) || 0,
    hits: parseInt(stats.hits) || 0,
    hr: parseInt(stats.homeRuns) || 0,
    rbi: parseInt(stats.RBIs) || 0,
    k: parseInt(stats.strikeouts) || 0,
    avg: stats.avg || '.000',
  };
}

function extractPitcherVsTeamFromSplits(splitsData, opponentTeamName) {
  if (!splitsData?.splitCategories) return null;
  const names = splitsData.names || [];
  const oppCat = splitsData.splitCategories.find(c => c.displayName === 'Opponent' || c.name === 'byOpponent');
  if (!oppCat) return null;
  const target = opponentTeamName.toLowerCase();
  const match = oppCat.splits?.find(s => s.displayName?.toLowerCase().includes(target));
  if (!match?.stats?.length) return null;
  const stats = {};
  names.forEach((n, i) => { stats[n] = match.stats[i]; });
  return {
    era: stats.ERA || '—',
    w: parseInt(stats.wins) || 0,
    l: parseInt(stats.losses) || 0,
    gp: parseInt(stats.gamesPlayed) || 0,
    ip: stats.innings || '—',
    h: parseInt(stats.hits) || 0,
    hr: parseInt(stats.homeRuns) || 0,
    bb: parseInt(stats.walks) || 0,
    k: parseInt(stats.strikeouts) || 0,
    oba: stats.opponentAvg || '—',
  };
}

async function fetchPitcherCareerVsTeam(pitcherId, opponentFullName) {
  const currentYear = getSeasonYear('mlb');
  const seasons = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];
  const fetches = seasons.map(yr =>
    espn(`https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${pitcherId}/splits?region=us&lang=en&contentorigin=espn&season=${yr}&category=pitching`).catch(() => null)
  );
  const results = await Promise.all(fetches);
  const rows = [];
  for (let i = 0; i < results.length; i++) {
    const data = results[i];
    if (!data) continue;
    const vs = extractPitcherVsTeamFromSplits(data, opponentFullName);
    if (vs && vs.gp > 0) {
      rows.push({ season: seasons[i], ...vs });
    }
  }
  if (!rows.length) return null;
  const totals = { gp: 0, ip: 0, h: 0, hr: 0, bb: 0, k: 0, er: 0 };
  for (const r of rows) {
    totals.gp += r.gp;
    totals.h += r.h;
    totals.hr += r.hr;
    totals.bb += r.bb;
    totals.k += r.k;
    const ipDec = baseballInningsToDecimal(r.ip);
    if (ipDec) totals.ip += ipDec;
  }
  return { rows, totals, seasons: rows.length };
}

async function fetchCareerVsTeam(athleteId, opponentFullName) {
  const currentYear = getSeasonYear('mlb');
  const seasons = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];
  const fetches = seasons.map(yr => fetchMlbAthleteSplits(athleteId, yr).catch(() => null));
  const results = await Promise.all(fetches);
  const rows = [];
  for (let i = 0; i < results.length; i++) {
    const data = results[i];
    if (!data) continue;
    const vs = extractVsTeamFromSplits(data, opponentFullName);
    if (vs && vs.ab > 0) {
      rows.push({ season: seasons[i], ...vs });
    }
  }
  if (!rows.length) return null;
  const totals = { ab: 0, hits: 0, hr: 0, rbi: 0, k: 0 };
  for (const r of rows) { totals.ab += r.ab; totals.hits += r.hits; totals.hr += r.hr; totals.rbi += r.rbi; totals.k += r.k; }
  totals.avg = totals.ab > 0 ? (totals.hits / totals.ab).toFixed(3) : '.000';
  return { rows, totals, seasons: rows.length };
}

async function fetchMlbAthleteGameLog(athleteId) {
  return espn(`https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${athleteId}/gamelog?region=us&lang=en&contentorigin=espn`);
}

// ── WEATHER ─────────────────────────────────────────────
// Per-game weather via PlayIQ backend (MLB Stats feed/live). ESPN's MLB
// summary endpoint doesn't include weather, so we bridge ESPN gamelog dates
// to MLB gamePk on the backend via team abbreviation + date. Cached by
// date+abbr to dedupe across batters.
const _mlbWeatherCache = new Map();
async function fetchMlbGameWeather(date, teamAbbr) {
  if (!date || !teamAbbr) return null;
  const key = `${date}_${teamAbbr.toUpperCase()}`;
  if (_mlbWeatherCache.has(key)) return _mlbWeatherCache.get(key);
  try {
    const r = await fetch(`http://localhost:3001/api/mlb/weather?date=${encodeURIComponent(date)}&teamAbbr=${encodeURIComponent(teamAbbr)}`);
    if (!r.ok) {
      _mlbWeatherCache.set(key, null);
      return null;
    }
    const data = await r.json();
    const weather = data?.weather || null;
    _mlbWeatherCache.set(key, weather);
    return weather;
  } catch (_) {
    _mlbWeatherCache.set(key, null);
    return null;
  }
}

// Small formatter for chart tooltips / strips.
function formatWeatherLine(wx) {
  if (!wx) return '';
  const parts = [];
  if (wx.temp != null) parts.push(`${Math.round(wx.temp)}°F`);
  if (wx.condition) parts.push(wx.condition);
  if (wx.wind) parts.push(`Wind ${wx.wind}`);
  return parts.join(' · ');
}

// Render a weather strip inside an element by id, one chip per game.
// Hides itself if no game has weather data.
function renderMlbWeatherStrip(elId, games) {
  const el = document.getElementById(elId);
  if (!el) return;
  const anyWeather = games.some(g => g.weather);
  if (!anyWeather) {
    el.style.display = 'none';
    return;
  }
  el.innerHTML = games.map(g => {
    const wx = g.weather;
    if (!wx) return `<div class="ef-wx-chip ef-wx-empty">—</div>`;
    const temp = wx.temp != null ? `${Math.round(wx.temp)}°` : '—';
    const wind = wx.wind || '—';
    const tip = `${formatWeatherLine(wx)}${wx.venue ? ' @ ' + wx.venue : ''}`;
    return `<div class="ef-wx-chip" title="${escapeHtml(tip)}">
      <span class="ef-wx-temp">${temp}</span>
      <span class="ef-wx-wind">${escapeHtml(wind)}</span>
    </div>`;
  }).join('');
  el.style.display = 'grid';
  el.style.gridTemplateColumns = `repeat(${games.length}, minmax(0, 1fr))`;
}

function extractRecentPitcherWorkload(gameLogData, limit = 5) {
  if (!gameLogData?.labels?.length || !gameLogData?.seasonTypes?.length) return [];
  const labels = gameLogData.labels;
  const ipIdx = labels.indexOf('IP');
  const pIdx = labels.indexOf('P');
  const kIdx = labels.indexOf('K');
  const bbIdx = labels.indexOf('BB');
  const eventMeta = gameLogData.events || {};
  const events = [];

  const normalizeOpponent = (opponent) => {
    if (!opponent) return { label: '?', fullName: '', logo: '' };
    if (typeof opponent === 'string') return { label: opponent, fullName: opponent, logo: '' };
    return {
      label: opponent.abbreviation || opponent.shortDisplayName || opponent.displayName || '?',
      fullName: opponent.displayName || opponent.shortDisplayName || opponent.abbreviation || '',
      logo: opponent.logo || '',
    };
  };

  gameLogData.seasonTypes.forEach(seasonType => {
    (seasonType.categories || []).forEach(cat => {
      (cat.events || []).forEach(ev => {
        const meta = eventMeta[ev.eventId] || {};
        const opponent = normalizeOpponent(meta.opponent);
        events.push({
          eventId: ev.eventId,
          date: meta.gameDate || '',
          opponent: opponent.label,
          opponentFullName: opponent.fullName,
          opponentLogo: opponent.logo,
          homeAway: meta.atVs || '',
          ip: ipIdx > -1 ? parseFloat(ev.stats?.[ipIdx]) || 0 : null,
          pitchCount: pIdx > -1 ? parseInt(ev.stats?.[pIdx]) || null : null,
          strikeouts: kIdx > -1 ? parseInt(ev.stats?.[kIdx]) || 0 : null,
          walks: bbIdx > -1 ? parseInt(ev.stats?.[bbIdx]) || 0 : null,
        });
      });
    });
  });

  return events
    .filter(ev => ev.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
}

function extractMlbLineups(summary, gameInfo) {
  const result = { away: [], home: [] };
  const rosters = summary?.rosters || [];
  rosters.forEach(teamData => {
    const side = String(teamData.team?.id) === String(gameInfo.awayTeamId) ? 'away' : 'home';
    const starters = (teamData.roster || [])
      .filter(p => p?.starter)
      .sort((a, b) => (a.batOrder || 99) - (b.batOrder || 99))
      .map(p => ({
        name: p.athlete?.displayName || p.athlete?.shortName || '?',
        shortName: p.athlete?.shortName || p.athlete?.displayName || '?',
        athleteId: p.athlete?.id,
        order: p.batOrder || null,
        pos: p.position?.abbreviation || '—',
      }));
    result[side] = starters;
  });
  return result;
}

async function enrichPitcherProfile(basePitcher) {
  if (!basePitcher?.id) return basePitcher;

  const currentSeason = getSeasonYear('mlb');
  const [statsData, gameLogData] = await Promise.all([
    fetchMlbAthleteStats(basePitcher.id),
    fetchMlbAthleteGameLog(basePitcher.id),
  ]);

  const pitchingCat = statsData?.categories?.find(c => c.name === 'pitching');
  const expandedCat = statsData?.categories?.find(c => c.name === 'expanded-pitching');

  const pitchingRows = parseMlbStatCategory(pitchingCat);
  const expandedRows = parseMlbStatCategory(expandedCat);
  const currentRow = pickSeasonRow(pitchingRows, currentSeason);
  const prevRow = pickSeasonRow(pitchingRows, currentSeason - 1);
  const currentExpanded = pickSeasonRow(expandedRows, currentSeason);

  const recentWorkload = extractRecentPitcherWorkload(gameLogData);
  const avgPitchCount = recentWorkload.length
    ? recentWorkload.reduce((sum, g) => sum + (g.pitchCount || 0), 0) / recentWorkload.length
    : null;
  const avgInnings = recentWorkload.length
    ? recentWorkload.reduce((sum, g) => sum + (g.ip || 0), 0) / recentWorkload.length
    : null;

  return {
    ...basePitcher,
    era: basePitcher.era ?? currentRow?.stats?.ERA ?? null,
    whip: basePitcher.whip ?? currentRow?.stats?.WHIP ?? null,
    currentSeason: currentRow ? {
      era: currentRow.stats.ERA ?? null,
      whip: currentRow.stats.WHIP ?? null,
      innings: currentRow.stats.innings ?? null,
      strikeouts: currentRow.stats.strikeouts ?? null,
      walks: currentRow.stats.walks ?? null,
      bb9: toBb9(currentRow.stats.walks, currentRow.stats.innings),
      k9: currentExpanded?.stats?.strikeoutsPerNineInnings ?? null,
    } : null,
    previousSeason: prevRow ? {
      era: prevRow.stats.ERA ?? null,
      whip: prevRow.stats.WHIP ?? null,
      innings: prevRow.stats.innings ?? null,
      strikeouts: prevRow.stats.strikeouts ?? null,
      walks: prevRow.stats.walks ?? null,
      bb9: toBb9(prevRow.stats.walks, prevRow.stats.innings),
    } : null,
    recentWorkload,
    avgPitchCount,
    avgInnings,
  };
}

async function fetchStartingPitchers(gameInfo, summary) {
  const result = { away: null, home: null };
  const competitors = summary?.header?.competitions?.[0]?.competitors || [];
  competitors.forEach(team => {
    const side = String(team.team?.id || team.id) === String(gameInfo.awayTeamId) ? 'away' : 'home';
    const probable = (team.probables || []).find(p => p?.athlete);
    if (!probable?.athlete) return;

    const statCats = probable.statistics?.splits?.categories || [];
    const statMap = {};
    statCats.forEach(stat => { statMap[stat.name] = stat.value ?? stat.displayValue ?? null; });

    result[side] = {
      id: probable.athlete.id,
      name: probable.athlete.displayName || probable.athlete.shortName || '?',
      shortName: probable.athlete.shortName || probable.athlete.displayName || '?',
      headshotUrl: probable.athlete.headshot?.href || `https://a.espncdn.com/i/headshots/mlb/players/full/${probable.athlete.id}.png`,
      record: statMap.record || null,
      throws: probable.athlete.throws?.abbreviation || probable.athlete.throws?.displayValue || null,
      era: statMap.ERA ?? null,
      whip: statMap.WHIP ?? null,
    };
  });

  const enriched = await Promise.all([
    enrichPitcherProfile(result.away),
    enrichPitcherProfile(result.home),
  ]);

  return { away: enriched[0], home: enriched[1] };
}

async function buildPitchingEdgeData(gameData) {
  const { gameInfo, h2h } = gameData;
  const summary = await espn(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${gameInfo.eventId}`);
  if (!summary) return null;

  const [pitchers, awayStats, homeStats, awaySplits, homeSplits] = await Promise.all([
    fetchStartingPitchers(gameInfo, summary),
    fetchTeamStats(gameInfo.sportKey, gameInfo.awayTeamId),
    fetchTeamStats(gameInfo.sportKey, gameInfo.homeTeamId),
    fetchMlbTeamSplitStats(gameInfo.awayTeamId),
    fetchMlbTeamSplitStats(gameInfo.homeTeamId),
  ]);

  // Merge fetchTeamStats results with pitching-specific stats from the split endpoint
  const mergeWithPitching = (teamStats, splitResult) => {
    const merged = { ...(teamStats || {}) };
    const ps = splitResult?.pitchingStats || {};
    // Fill in pitching stats that fetchTeamStats may have missed
    for (const [key, obj] of Object.entries(ps)) {
      if (!merged[key]) merged[key] = obj;
    }
    return merged;
  };
  const away = extractMlbOverallTeamStats(mergeWithPitching(awayStats, awaySplits));
  const home = extractMlbOverallTeamStats(mergeWithPitching(homeStats, homeSplits));

  // Compute BB/9 and K/9 from raw stats if not directly available
  const computeDerived = (team) => {
    if (team.bb9 == null && team.walks != null && team.innings != null && team.innings > 0) {
      team.bb9 = (team.walks * 9) / team.innings;
    }
    if (team.k9 == null && team.strikeouts != null && team.innings != null && team.innings > 0) {
      team.k9 = (team.strikeouts * 9) / team.innings;
    }
    if (team.kRate == null && team.strikeouts != null && team.plateAppearances != null && team.plateAppearances > 0) {
      team.kRate = team.strikeouts / team.plateAppearances;
    }
    if (team.walkRate == null && team.walks != null && team.plateAppearances != null && team.plateAppearances > 0) {
      team.walkRate = team.walks / team.plateAppearances;
    }
  };
  computeDerived(away);
  computeDerived(home);

  const lineups = extractMlbLineups(summary, gameInfo);

  const matchupSplitFor = (teamSplits, handedness) => {
    if (!teamSplits || !handedness) return null;
    return /^L/i.test(handedness) ? teamSplits.vsLeft : teamSplits.vsRight;
  };

  const awayVsHand = matchupSplitFor(awaySplits, pitchers.home?.throws);
  const homeVsHand = matchupSplitFor(homeSplits, pitchers.away?.throws);

  let pitchingEdge = null;
  if (pitchers.away?.currentSeason?.era != null && pitchers.home?.currentSeason?.era != null) {
    const diff = Math.abs(pitchers.away.currentSeason.era - pitchers.home.currentSeason.era);
    if (diff >= 0.75) {
      pitchingEdge = pitchers.away.currentSeason.era < pitchers.home.currentSeason.era
        ? { side: 'away', abbr: gameInfo.awayAbbr, diff: diff.toFixed(2) }
        : { side: 'home', abbr: gameInfo.homeAbbr, diff: diff.toFixed(2) };
    }
  }

  const kEdges = [];
  if (pitchers.away?.currentSeason?.k9 && homeVsHand?.kRate) {
    const score = pitchers.away.currentSeason.k9 * homeVsHand.kRate;
    if (score >= 2.4) {
      kEdges.push({
        pitcher: pitchers.away.name,
        team: gameInfo.awayAbbr,
        k9: pitchers.away.currentSeason.k9,
        oppKRate: homeVsHand.kRate,
        splitLabel: pitchers.away.throws ? `vs ${pitchers.away.throws}HP` : 'Matchup split',
        score,
      });
    }
  }
  if (pitchers.home?.currentSeason?.k9 && awayVsHand?.kRate) {
    const score = pitchers.home.currentSeason.k9 * awayVsHand.kRate;
    if (score >= 2.4) {
      kEdges.push({
        pitcher: pitchers.home.name,
        team: gameInfo.homeAbbr,
        k9: pitchers.home.currentSeason.k9,
        oppKRate: awayVsHand.kRate,
        splitLabel: pitchers.home.throws ? `vs ${pitchers.home.throws}HP` : 'Matchup split',
        score,
      });
    }
  }
  kEdges.sort((a, b) => b.score - a.score);

  const bbEdges = [];
  if (pitchers.away?.currentSeason?.bb9 && homeVsHand?.obp) {
    if (pitchers.away.currentSeason.bb9 >= 3 && homeVsHand.obp >= 0.320) {
      bbEdges.push({
        pitcher: pitchers.away.name,
        team: gameInfo.awayAbbr,
        bb9: pitchers.away.currentSeason.bb9,
        oppObp: homeVsHand.obp,
        splitLabel: pitchers.away.throws ? `vs ${pitchers.away.throws}HP` : 'Matchup split',
      });
    }
  }
  if (pitchers.home?.currentSeason?.bb9 && awayVsHand?.obp) {
    if (pitchers.home.currentSeason.bb9 >= 3 && awayVsHand.obp >= 0.320) {
      bbEdges.push({
        pitcher: pitchers.home.name,
        team: gameInfo.homeAbbr,
        bb9: pitchers.home.currentSeason.bb9,
        oppObp: awayVsHand.obp,
        splitLabel: pitchers.home.throws ? `vs ${pitchers.home.throws}HP` : 'Matchup split',
      });
    }
  }

  return {
    pitchers,
    away,
    home,
    awaySplits,
    homeSplits,
    awayVsHand,
    homeVsHand,
    lineups,
    pitchingEdge,
    kEdges,
    bbEdges,
    h2hCount: h2h?.length || 0,
    dataGaps: [
      'Pitch mix is not exposed in the ESPN endpoints this tab currently uses.',
      'Pitcher home/away season splits are not yet exposed from the current ESPN player stats path.',
    ],
  };
}

function renderPitchingEdge(data, gameData) {
  const el = document.getElementById('pitchingContent');
  if (!el) return;
  const { gameInfo } = gameData;

  if (!data) {
    el.innerHTML = '<div class="pe-empty">Pitching data not available for this game.</div>';
    return;
  }

  const { pitchers, away, home, awayVsHand, homeVsHand, lineups, pitchingEdge, kEdges, bbEdges, dataGaps } = data;
  const fv = (v, dec = 2) => v != null ? Number(v).toFixed(dec) : '—';
  const rk = (v) => v != null ? `<span class="pe-rank">#${v}</span>` : '';
  const pct = (v) => v != null ? `${(v * 100).toFixed(1)}%` : '—';
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

  // Unified pitcher card — profile + matchup signals + workload in one card
  const pitcherCard = (p, teamAbbr, color, matchupSplit) => {
    if (!p) return `<div class="pe-pitcher-card"><div class="pe-no-pitcher">SP not announced</div></div>`;
    const workload = p.recentWorkload?.length ? `
      <div class="pe-mini-section">
        <div class="pe-mini-title">Last ${p.recentWorkload.length} Starts</div>
        <div class="pe-workload-list">
          ${p.recentWorkload.map(g => `
            <div class="pe-workload-row">
              <span class="pe-workload-opponent">
                ${g.opponentLogo ? `<img class="pe-workload-logo" src="${g.opponentLogo}" alt="${g.opponentFullName || g.opponent || ''}" onerror="this.style.display='none'">` : ''}
                ${fmtDate(g.date)} ${g.homeAway || ''} ${g.opponent || ''}
              </span>
              <span class="pe-workload-stats">${fv(g.ip, 1)} IP · ${g.pitchCount ?? '—'}P · ${g.strikeouts ?? '—'}K · ${g.walks ?? '—'}BB</span>
            </div>`).join('')}
        </div>
      </div>` : '';

    return `
      <div class="pe-pitcher-card" style="border-color:${color}">
        <div class="pe-pitcher-head">
          <img class="pe-pitcher-hs" src="${p.headshotUrl}" alt="${p.name}" onerror="this.style.display='none'">
          <div class="pe-pitcher-info">
            <span class="pe-pitcher-name">${p.name}</span>
            <span class="pe-pitcher-meta" style="color:${color}">${teamAbbr}${p.throws ? ' · ' + p.throws + 'HP' : ''}${p.record ? ' · ' + p.record : ''}</span>
          </div>
        </div>
        <div class="pe-pitcher-stats">
          ${p.era != null ? `<div class="pe-ps"><span class="pe-ps-val">${fv(p.era)}</span><span class="pe-ps-label">ERA</span></div>` : ''}
          ${p.whip != null ? `<div class="pe-ps"><span class="pe-ps-val">${fv(p.whip)}</span><span class="pe-ps-label">WHIP</span></div>` : ''}
          ${p.currentSeason?.k9 != null ? `<div class="pe-ps"><span class="pe-ps-val">${fv(p.currentSeason.k9, 1)}</span><span class="pe-ps-label">K/9</span></div>` : ''}
          ${p.currentSeason?.bb9 != null ? `<div class="pe-ps"><span class="pe-ps-val">${fv(p.currentSeason.bb9, 1)}</span><span class="pe-ps-label">BB/9</span></div>` : ''}
          ${p.avgInnings != null ? `<div class="pe-ps"><span class="pe-ps-val">${fv(p.avgInnings, 1)}</span><span class="pe-ps-label">Avg IP</span></div>` : ''}
          ${p.avgPitchCount != null ? `<div class="pe-ps"><span class="pe-ps-val">${fv(p.avgPitchCount, 0)}</span><span class="pe-ps-label">Avg P</span></div>` : ''}
        </div>
        <div class="pe-season-splits">
          <div class="pe-season-row"><span>Current</span><span>ERA ${fv(p.currentSeason?.era)} · WHIP ${fv(p.currentSeason?.whip)}</span></div>
          <div class="pe-season-row"><span>Previous</span><span>ERA ${fv(p.previousSeason?.era)} · WHIP ${fv(p.previousSeason?.whip)}</span></div>
        </div>
        ${matchupSplit ? `
          <div class="pe-mini-section">
            <div class="pe-mini-title">Opponent ${p.throws ? `vs ${p.throws}HP` : 'Matchup'}</div>
            <div class="pe-signal-grid">
              <div><span>K Rate</span><strong>${pct(matchupSplit.kRate)}</strong></div>
              <div><span>BB Rate</span><strong>${pct(matchupSplit.walkRate)}</strong></div>
              <div><span>AVG</span><strong>${fv(matchupSplit.battingAvg, 3)}</strong></div>
              <div><span>OPS</span><strong>${fv(matchupSplit.ops, 3)}</strong></div>
            </div>
          </div>` : ''}
        ${workload}
      </div>`;
  };

  const statRow = (label, awayVal, homeVal, awayRank, homeRank, lower, dec = 3) => {
    const aBetter = lower ? awayVal < homeVal : awayVal > homeVal;
    const hBetter = !aBetter;
    const aColor = (awayVal != null && homeVal != null) ? (aBetter ? 'var(--green)' : 'var(--text2)') : 'var(--text2)';
    const hColor = (awayVal != null && homeVal != null) ? (hBetter ? 'var(--green)' : 'var(--text2)') : 'var(--text2)';
    return `
      <div class="pe-stat-row">
        <span class="pe-sr-val" style="color:${aColor}">${fv(awayVal, dec)} ${rk(awayRank)}</span>
        <span class="pe-sr-label">${label}</span>
        <span class="pe-sr-val" style="color:${hColor}">${fv(homeVal, dec)} ${rk(homeRank)}</span>
      </div>`;
  };

  const lineupList = (teamName, lineup) => `
    <div class="pe-lineup-card">
      <div class="pe-mini-title">${teamName}</div>
      ${lineup?.length ? `
        <div class="pe-lineup-list">
          ${lineup.map(p => `<div class="pe-lineup-row"><span>${p.order || '—'}. ${p.name}</span><span>${p.pos}</span></div>`).join('')}
        </div>` : '<div class="pe-lineup-empty">Lineup not confirmed on ESPN yet.</div>'}
    </div>`;

  el.innerHTML = `
    <div class="pe-header">
      <div class="pe-title">MLB Research</div>
      <div class="pe-subtitle">Starting pitcher profiles, matchup splits, team stats, and prop signals</div>
    </div>

    ${pitchingEdge ? `
      <div class="pe-advantage">
        <span class="pe-adv-label">F5 Pitching Advantage</span>
        <span class="pe-adv-team">${pitchingEdge.abbr}</span>
        <span class="pe-adv-diff">${pitchingEdge.diff} ERA gap</span>
      </div>` : ''}

    <!-- Starting Pitchers (unified — profile + matchup signals + workload) -->
    <div class="pe-section">
      <div class="pe-section-title">Starting Pitchers</div>
      <div class="pe-pitchers-grid">
        ${pitcherCard(pitchers.away, gameInfo.awayAbbr, 'var(--blue)', homeVsHand)}
        ${pitcherCard(pitchers.home, gameInfo.homeAbbr, 'var(--lime)', awayVsHand)}
      </div>
    </div>

    <!-- Team Pitching -->
    <div class="pe-section">
      <div class="pe-section-title">Team Pitching</div>
      <div class="pe-compare-header">
        <span style="color:var(--blue)">${gameInfo.awayAbbr}</span>
        <span></span>
        <span style="color:var(--lime)">${gameInfo.homeAbbr}</span>
      </div>
      ${statRow('ERA', away.era, home.era, away.eraRank, home.eraRank, true, 2)}
      ${statRow('WHIP', away.whip, home.whip, away.whipRank, home.whipRank, true)}
      ${statRow('K/9', away.k9, home.k9, away.k9Rank, home.k9Rank, false, 1)}
      ${statRow('BB/9', away.bb9, home.bb9, away.bb9Rank, home.bb9Rank, true, 1)}
    </div>

    <!-- Team Batting -->
    <div class="pe-section">
      <div class="pe-section-title">Team Batting</div>
      <div class="pe-compare-header">
        <span style="color:var(--blue)">${gameInfo.awayAbbr}</span>
        <span></span>
        <span style="color:var(--lime)">${gameInfo.homeAbbr}</span>
      </div>
      ${statRow('AVG', away.battingAvg, home.battingAvg, away.battingAvgRank, home.battingAvgRank, false)}
      ${statRow('OPS', away.ops, home.ops, away.opsRank, home.opsRank, false)}
      ${statRow('OBP', away.obp, home.obp, null, null, false)}
      ${statRow('K Rate', away.kRate, home.kRate, null, null, true)}
      ${statRow('BB Rate', away.walkRate, home.walkRate, null, null, false)}
    </div>

    <!-- Lineup Confirmation -->
    <div class="pe-section">
      <div class="pe-section-title">Lineup Confirmation</div>
      <div class="pe-two-col">
        ${lineupList(gameInfo.awayFull, lineups?.away)}
        ${lineupList(gameInfo.homeFull, lineups?.home)}
      </div>
    </div>

    <!-- Strikeout Edges -->
    ${kEdges.length ? `
      <div class="pe-section">
        <div class="pe-section-title">Strikeout Prop Edges</div>
        <div class="pe-hint">Starter K/9 matched against the opponent's ESPN handedness split</div>
        ${kEdges.map(e => `
          <div class="pe-edge-card">
            <span class="pe-edge-team" style="color:var(--green)">${e.pitcher}</span>
            <span class="pe-edge-detail">${e.splitLabel} · K/9 ${fv(e.k9, 1)} vs Opp K Rate ${pct(e.oppKRate)}</span>
            <span class="ef-badge-notable">K EDGE</span>
          </div>`).join('')}
      </div>` : ''}

    <!-- Walk Edges -->
    ${bbEdges.length ? `
      <div class="pe-section">
        <div class="pe-section-title">Walk Prop Edges</div>
        <div class="pe-hint">Starter BB/9 matched against the opponent's ESPN handedness split OBP</div>
        ${bbEdges.map(e => `
          <div class="pe-edge-card">
            <span class="pe-edge-team" style="color:var(--yellow)">${e.pitcher}</span>
            <span class="pe-edge-detail">${e.splitLabel} · BB/9 ${fv(e.bb9, 1)} vs Opp OBP ${fv(e.oppObp, 3)}</span>
            <span class="ef-badge-notable">BB EDGE</span>
          </div>`).join('')}
      </div>` : ''}

    ${dataGaps?.length ? `
      <div class="pe-section">
        <div class="pe-section-title">Current ESPN Gaps</div>
        <div class="pe-note-list">
          ${dataGaps.map(note => `<div class="pe-note">${note}</div>`).join('')}
        </div>
      </div>` : ''}
  `;
}

/* ═══════════════════════════════════════════════════════════
   LOW HOME RUN MATCHUPS (MLB ONLY)
   Strict ESPN-only implementation of the requested no-home-run strategy.
   If any required strategy field is missing from verified ESPN payloads,
   this module stops and returns the exact failsafe message.
═══════════════════════════════════════════════════════════ */

function lowHrDataNotFound() {
  return 'DATA NOT FOUND';
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function parseRatioStat(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.includes('/')) {
    const [left, right] = value.split('/').map(v => parseFloat(v));
    if (Number.isFinite(left) && Number.isFinite(right) && right) return left / right;
  }
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

function formatMetricValue(value, digits = 3, suffix = '') {
  if (value == null) return lowHrDataNotFound();
  return `${Number(value).toFixed(digits)}${suffix}`;
}

function findRowStat(stats, exactKeys = [], patterns = []) {
  if (!stats) return null;
  for (const key of exactKeys) {
    if (stats[key] != null) return { key, value: stats[key] };
  }
  const entries = Object.entries(stats);
  for (const pattern of patterns) {
    const hit = entries.find(([key]) => pattern.test(key));
    if (hit) return { key: hit[0], value: hit[1] };
  }
  return null;
}

function pickSeasonRowFromCategory(statsData, categoryNames, seasonYear) {
  for (const categoryName of categoryNames) {
    const cat = statsData?.categories?.find(c => c.name === categoryName);
    const rows = parseMlbStatCategory(cat);
    const row = pickSeasonRow(rows, seasonYear) || rows[rows.length - 1];
    if (row) return { row, categoryName };
  }
  return null;
}

function buildEspnSource(url, label) {
  return { label, url };
}

function extractLineupStatus(lineup) {
  if (!lineup?.length || lineup.length < 9) return 'UNCONFIRMED';
  const orders = lineup.map(player => Number(player.order)).filter(Number.isFinite).sort((a, b) => a - b);
  return orders.length >= 9 && orders.slice(0, 9).every((order, idx) => order === idx + 1)
    ? 'CONFIRMED'
    : 'UNCONFIRMED';
}

function lowHrFailsafe(reason, sourceLinks = []) {
  return {
    error: 'DATA NOT AVAILABLE – cannot complete strategy',
    reason,
    source_links: sourceLinks,
  };
}

function normalizePlayerName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function baseballInningsToDecimal(inningsValue) {
  if (inningsValue == null || inningsValue === '') return null;
  if (typeof inningsValue === 'number') inningsValue = String(inningsValue);
  const text = String(inningsValue);
  if (!text.includes('.')) {
    const whole = parseInt(text, 10);
    return Number.isFinite(whole) ? whole : null;
  }
  const [wholePart, fracPart] = text.split('.');
  const whole = parseInt(wholePart, 10);
  const frac = parseInt(fracPart || '0', 10);
  if (!Number.isFinite(whole) || !Number.isFinite(frac)) return null;
  if (frac === 1) return whole + (1 / 3);
  if (frac === 2) return whole + (2 / 3);
  return parseFloat(text);
}

function extractPitcherHr9FromEspnStats(statsData) {
  const seasonYear = getSeasonYear('mlb');
  const pitching = pickSeasonRowFromCategory(statsData, ['pitching', 'expanded-pitching'], seasonYear);
  const expanded = pickSeasonRowFromCategory(statsData, ['expanded-pitching', 'pitching'], seasonYear);
  const oppBatting = pickSeasonRowFromCategory(statsData, ['opponent-batting'], seasonYear);
  const stats = { ...(pitching?.row?.stats || {}), ...(expanded?.row?.stats || {}), ...(oppBatting?.row?.stats || {}) };
  const hr9 = findRowStat(
    stats,
    ['homeRunsPerNineInnings', 'homeRunsAllowedPerNineInnings', 'HR/9'],
    [/home.*runs?.*nine/i, /hr\/9/i]
  );
  if (hr9?.value != null) return parseRatioStat(hr9.value);
  const hrAllowed = findRowStat(stats, ['homeRuns', 'HR'], [/^hr$/i, /homeRuns/i]);
  const innings = findRowStat(stats, ['innings', 'inningsPitched', 'IP'], [/innings/i, /^ip$/i]);
  const hrAllowedValue = parseRatioStat(hrAllowed?.value);
  const inningsValue = baseballInningsToDecimal(innings?.value);
  if (hrAllowedValue == null || inningsValue == null || inningsValue <= 0) return null;
  return (hrAllowedValue * 9) / inningsValue;
}

function extractSeasonHrAbProbabilities(statsData) {
  const seasonYear = getSeasonYear('mlb');
  const current = pickSeasonRowFromCategory(statsData, ['career-batting', 'batting', 'expanded-batting'], seasonYear);
  const prior = pickSeasonRowFromCategory(statsData, ['career-batting', 'batting', 'expanded-batting'], seasonYear - 1);
  const read = (row) => {
    const stats = row?.row?.stats || {};
    const ab = parseRatioStat(findRowStat(stats, ['atBats', 'AB'], [/^ab$/i, /atBats/i])?.value);
    const hr = parseRatioStat(findRowStat(stats, ['homeRuns', 'HR'], [/^hr$/i, /homeRuns/i])?.value);
    if (ab == null || hr == null || ab <= 0) return null;
    const hrProbability = hr / ab;
    return {
      ab,
      hr,
      hr_probability: hrProbability,
      no_hr_probability: 1 - hrProbability,
    };
  };
  return {
    current: read(current),
    prior: read(prior),
  };
}


async function buildLowHrMatchupData(gameData) {
  const { gameInfo } = gameData;
  const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${gameInfo.eventId}`;
  const summary = await espn(summaryUrl);
  if (!summary?.header?.competitions?.[0]) {
    return lowHrFailsafe('Required ESPN game summary payload is unavailable.', [
      buildEspnSource(summaryUrl, 'Game summary'),
    ]);
  }

  const sources = [buildEspnSource(summaryUrl, 'Game summary')];
  const pitchers = await fetchStartingPitchers(gameInfo, summary);
  const lineups = extractMlbLineups(summary, gameInfo);
  const awayLineupStatus = extractLineupStatus(lineups.away);
  const homeLineupStatus = extractLineupStatus(lineups.home);

  if (!pitchers.away?.id || !pitchers.home?.id) {
    return lowHrFailsafe('ESPN probable pitcher data is missing — check back closer to game time.', sources);
  }

  const [awayPitcherStats, homePitcherStats, awayPitcherVsTeam, homePitcherVsTeam] = await Promise.all([
    fetchMlbAthleteStats(pitchers.away.id),
    fetchMlbAthleteStats(pitchers.home.id),
    fetchPitcherCareerVsTeam(pitchers.away.id, gameInfo.homeFull).catch(() => null),
    fetchPitcherCareerVsTeam(pitchers.home.id, gameInfo.awayFull).catch(() => null),
  ]);
  sources.push(
    buildEspnSource(`https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${pitchers.away.id}/stats`, `${pitchers.away.name} stats`),
    buildEspnSource(`https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${pitchers.home.id}/stats`, `${pitchers.home.name} stats`)
  );

  const awayHr9 = awayPitcherStats ? extractPitcherHr9FromEspnStats(awayPitcherStats) : null;
  const homeHr9 = homePitcherStats ? extractPitcherHr9FromEspnStats(homePitcherStats) : null;

  const result = {
    game: `${gameInfo.awayAbbr} vs ${gameInfo.homeAbbr}`,
    lineup_status: { away: awayLineupStatus, home: homeLineupStatus },
    starting_pitchers: [
      {
        team: gameInfo.awayAbbr,
        name: pitchers.away.name,
        hr_per_9: awayHr9 != null ? Number(awayHr9.toFixed(3)) : null,
        hr_per_9_label: awayHr9 != null ? (awayHr9 <= 1.0 ? 'LOW' : 'ELEVATED') : 'N/A',
        vs_team: awayPitcherVsTeam,
        vs_team_name: gameInfo.homeAbbr,
      },
      {
        team: gameInfo.homeAbbr,
        name: pitchers.home.name,
        hr_per_9: homeHr9 != null ? Number(homeHr9.toFixed(3)) : null,
        hr_per_9_label: homeHr9 != null ? (homeHr9 <= 1.0 ? 'LOW' : 'ELEVATED') : 'N/A',
        vs_team: homePitcherVsTeam,
        vs_team_name: gameInfo.awayAbbr,
      },
    ],
    matchups: [],
    source_links: sources,
  };

  // Build matchups: each pitcher vs the opposing lineup
  const sides = [
    { pitcher: pitchers.away, hr9: awayHr9, lineup: lineups.home, lineupStatus: homeLineupStatus, team: gameInfo.awayAbbr, oppTeam: gameInfo.homeAbbr, pitcherTeamFull: gameInfo.awayFull, battingSide: 'home' },
    { pitcher: pitchers.home, hr9: homeHr9, lineup: lineups.away, lineupStatus: awayLineupStatus, team: gameInfo.homeAbbr, oppTeam: gameInfo.awayAbbr, pitcherTeamFull: gameInfo.homeFull, battingSide: 'away' },
  ];

  // ── Fetch BvP data from backend (Baseball Savant via PlayIQ server) ──
  // Pass ESPN lineup names so backend can resolve them via MLB rosters when
  // boxscore battingOrder is empty (MLB API often lags behind ESPN).
  let bvpData = null;
  try {
    const gameDate = gameInfo.date ? gameInfo.date.slice(0, 10) : '';
    const awayNames = lineups.away.map(b => b.name).join(',');
    const homeNames = lineups.home.map(b => b.name).join(',');
    const bvpUrl = `http://localhost:3001/api/mlb/game-bvp`
      + `?away=${encodeURIComponent(gameInfo.awayFull)}`
      + `&home=${encodeURIComponent(gameInfo.homeFull)}`
      + (gameDate ? `&date=${gameDate}` : '')
      + (awayNames ? `&awayLineup=${encodeURIComponent(awayNames)}` : '')
      + (homeNames ? `&homeLineup=${encodeURIComponent(homeNames)}` : '')
      + (pitchers.away?.name ? `&awayPitcher=${encodeURIComponent(pitchers.away.name)}` : '')
      + (pitchers.home?.name ? `&homePitcher=${encodeURIComponent(pitchers.home.name)}` : '');
    console.log('[Low HR] Fetching BvP from:', bvpUrl);
    const bvpResp = await fetch(bvpUrl);
    if (bvpResp.ok) {
      bvpData = await bvpResp.json();
      console.log('[Low HR] BvP data loaded:', bvpData?.matchups?.length, 'matchups, gamePk:', bvpData?.gamePk);
    } else {
      console.warn('[Low HR] BvP backend responded with status:', bvpResp.status);
    }
  } catch (err) {
    console.warn('[Low HR] BvP backend not available:', err.message);
  }

  // Build an order→bvp lookup from backend data
  // Match by batting order (1–9) — reliable across ESPN and MLB Stats API
  // Also build a name fallback for cases where order differs
  function buildBvpByOrder(bvpMatchups, battingSide) {
    if (!bvpMatchups?.length) return { byOrder: {}, byName: {}, pitcherName: null };
    const m = bvpMatchups.find(mu => mu.side === battingSide);
    if (!m?.batters?.length) return { byOrder: {}, byName: {}, pitcherName: null };
    const byOrder = {};
    const byName = {};
    for (const b of m.batters) {
      byOrder[b.order] = b.bvp;
      byName[normalizePlayerName(b.name)] = b.bvp;
    }
    return { byOrder, byName, pitcherName: m.pitcher?.name || null };
  }

  for (const side of sides) {
    const batters = side.lineup || [];
    if (!batters.length) {
      result.matchups.push({
        pitcher: side.pitcher.name,
        pitcher_team: side.team,
        hr_per_9: side.hr9 != null ? Number(side.hr9.toFixed(3)) : null,
        hr_per_9_label: side.hr9 != null ? (side.hr9 <= 1.0 ? 'LOW' : 'ELEVATED') : 'N/A',
        opponent_team: side.oppTeam,
        lineup_status: side.lineupStatus,
        hitters: [],
        note: side.lineupStatus !== 'CONFIRMED' ? 'Lineup not confirmed yet — check back closer to first pitch' : 'No lineup data available',
      });
      continue;
    }

    // Build BvP lookup — match by batting order first, name as fallback
    const { byOrder: bvpByOrder, byName: bvpByName, pitcherName: bvpPitcherName } = buildBvpByOrder(bvpData?.matchups, side.battingSide);

    // Fetch batter season stats AND career vs pitcher's team in parallel
    const batterFetches = batters.map(b => Promise.all([
      fetchMlbAthleteStats(b.athleteId).catch(() => null),
      fetchCareerVsTeam(b.athleteId, side.pitcherTeamFull).catch(() => null),
    ]));
    const batterResults = await Promise.all(batterFetches);

    const hitters = [];
    for (let i = 0; i < batters.length; i++) {
      const batter = batters[i];
      const [stats, vsTeam] = batterResults[i];
      sources.push(buildEspnSource(
        `https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/${batter.athleteId}/stats`,
        `${batter.name} stats`
      ));

      const seasonal = stats ? extractSeasonHrAbProbabilities(stats) : { current: null, prior: null };

      // Use current season if available, fall back to prior
      const curr = seasonal.current;
      const prior = seasonal.prior;
      const bestSeason = curr || prior;

      // Match BvP — order first, name fallback, always set a value
      const bvp = bvpByOrder[batter.order]
        ?? bvpByName[normalizePlayerName(batter.name)]
        ?? (bvpPitcherName ? { pa: 0, neverFaced: true } : null);

      hitters.push({
        name: batter.name,
        lineup_position: batter.order || '—',
        current_season: curr ? {
          ab: curr.ab,
          hr: curr.hr,
          hr_rate: Number((curr.hr_probability * 100).toFixed(2)),
          no_hr_rate: Number((curr.no_hr_probability * 100).toFixed(2)),
        } : null,
        prior_season: prior ? {
          ab: prior.ab,
          hr: prior.hr,
          hr_rate: Number((prior.hr_probability * 100).toFixed(2)),
          no_hr_rate: Number((prior.no_hr_probability * 100).toFixed(2)),
        } : null,
        vs_team: vsTeam,
        bvp,
        // ranking value = current season no_hr %, fallback to prior
        rank_no_hr: bestSeason ? Number((bestSeason.no_hr_probability * 100).toFixed(2)) : null,
      });
    }

    // Sort by no-HR probability descending (highest = safest no-HR bet)
    hitters.sort((a, b) => (b.rank_no_hr ?? -1) - (a.rank_no_hr ?? -1));

    result.matchups.push({
      pitcher: side.pitcher.name || bvpPitcherName,
      pitcher_team: side.team,
      hr_per_9: side.hr9 != null ? Number(side.hr9.toFixed(3)) : null,
      hr_per_9_label: side.hr9 != null ? (side.hr9 <= 1.0 ? 'LOW' : 'ELEVATED') : 'N/A',
      opponent_team: side.oppTeam,
      lineup_status: side.lineupStatus,
      bvp_available: !!bvpPitcherName,
      hitters,
    });
  }

  return result;
}

/* ═══════════════════════════════════════════════════════════
   MLB EDGE FINDER
   Compares batter-vs-pitcher (Savant) performance against
   season batting averages to surface prop betting edges.
   Stats: AVG, K rate, HR rate, OBP, SLG
═══════════════════════════════════════════════════════════ */

const MLB_EDGE_STATS = [
  { key: 'avg',    label: 'AVG',   format: v => v != null ? (v < 1 ? String(v.toFixed(3)).substring(1) : v.toFixed(3)) : '—', higher: true },
  { key: 'kRate',  label: 'K%',    format: v => v != null ? (v * 100).toFixed(1) + '%' : '—', higher: false },
  { key: 'hrRate', label: 'HR%',   format: v => v != null ? (v * 100).toFixed(1) + '%' : '—', higher: true },
  { key: 'obp',    label: 'OBP',   format: v => v != null ? (v < 1 ? String(v.toFixed(3)).substring(1) : v.toFixed(3)) : '—', higher: true },
  { key: 'slg',    label: 'SLG',   format: v => v != null ? (v < 1 ? String(v.toFixed(3)).substring(1) : v.toFixed(3)) : '—', higher: true },
];

function extractBatterSeasonStats(statsData) {
  const seasonYear = getSeasonYear('mlb');
  const battingResult = pickSeasonRowFromCategory(statsData, ['batting', 'career-batting'], seasonYear);
  if (!battingResult) return null;
  const stats = battingResult.row.stats || {};

  const ab = parseRatioStat(findRowStat(stats, ['atBats', 'AB'], [/^ab$/i, /atBats/i])?.value);
  const hits = parseRatioStat(findRowStat(stats, ['hits', 'H'], [/^h$/i, /^hits$/i])?.value);
  const hr = parseRatioStat(findRowStat(stats, ['homeRuns', 'HR'], [/^hr$/i, /homeRuns/i])?.value);
  const rbi = parseRatioStat(findRowStat(stats, ['RBIs', 'RBI'], [/^rbi/i])?.value);
  const runs = parseRatioStat(findRowStat(stats, ['runs', 'R'], [/^runs$/i, /^r$/i])?.value);
  const k = parseRatioStat(findRowStat(stats, ['strikeouts', 'K', 'SO'], [/strikeout/i])?.value);
  const bb = parseRatioStat(findRowStat(stats, ['walks', 'BB'], [/^walks$/i, /^bb$/i])?.value);
  const hbp = parseRatioStat(findRowStat(stats, ['hitByPitches', 'HBP'], [/hitByPitch/i])?.value) || 0;
  const sf = parseRatioStat(findRowStat(stats, ['sacFlies', 'SF'], [/sacFl/i])?.value) || 0;
  const gp = parseRatioStat(findRowStat(stats, ['gamesPlayed', 'GP', 'G'], [/games/i])?.value);
  const pa = parseRatioStat(findRowStat(stats, ['plateAppearances', 'PA'], [/plate/i])?.value);
  const doubles = parseRatioStat(findRowStat(stats, ['doubles', '2B'], [/doubles/i])?.value) || 0;
  const triples = parseRatioStat(findRowStat(stats, ['triples', '3B'], [/triples/i])?.value) || 0;

  const avgVal = findRowStat(stats, ['avg', 'AVG', 'battingAverage'], [/^avg$/i])?.value;
  const avg = parseRatioStat(avgVal);
  const opsVal = findRowStat(stats, ['OPS', 'onBasePlusSlugging'], [/^ops$/i])?.value;
  const ops = parseRatioStat(opsVal);
  const obpVal = findRowStat(stats, ['onBasePct', 'OBP', 'onBasePercentage'], [/^obp$/i])?.value;
  const obpStat = parseRatioStat(obpVal);
  const slgVal = findRowStat(stats, ['slugPct', 'SLG', 'sluggingPercentage', 'sluggingPct'], [/^slg$/i, /slugging/i])?.value;
  const slgStat = parseRatioStat(slgVal);

  // Compute derived rates
  const kRate = (k != null && pa != null && pa > 0) ? k / pa : null;
  const hrRate = (hr != null && ab != null && ab > 0) ? hr / ab : null;
  const computedObp = obpStat ?? ((ab != null && bb != null && hits != null) ?
    (hits + (bb || 0) + hbp) / (ab + (bb || 0) + hbp + sf) : null);
  const computedSlg = slgStat ?? ((ab != null && ab > 0 && hits != null) ?
    ((hits - (doubles || 0) - (triples || 0) - (hr || 0)) + doubles * 2 + triples * 3 + (hr || 0) * 4) / ab : null);

  return {
    gp, pa, ab, hits, hr, rbi, runs, k, bb,
    avg: avg ?? ((ab && ab > 0) ? hits / ab : null),
    obp: computedObp,
    slg: computedSlg,
    ops,
    kRate,
    hrRate,
    hitsPerGame: (gp && gp > 0 && hits != null) ? hits / gp : null,
    rbiPerGame: (gp && gp > 0 && rbi != null) ? rbi / gp : null,
    runsPerGame: (gp && gp > 0 && runs != null) ? runs / gp : null,
    kPerGame: (gp && gp > 0 && k != null) ? k / gp : null,
  };
}

function computeMlbBatterEdge(bvp, season) {
  if (!bvp || bvp.pa === 0 || !season) return null;

  const edges = {};
  let bestEdge = { stat: null, value: 0, key: null };

  // AVG edge
  const avgEdge = (bvp.avg != null && season.avg != null) ? bvp.avg - season.avg : null;
  edges.avg = { bvp: bvp.avg, season: season.avg, edge: avgEdge };

  // K rate edge (lower BvP K% = good for batter, so edge is season - bvp)
  const bvpKRate = bvp.pa > 0 ? bvp.k / bvp.pa : null;
  edges.kRate = { bvp: bvpKRate, season: season.kRate, edge: (bvpKRate != null && season.kRate != null) ? bvpKRate - season.kRate : null };

  // HR rate edge
  const bvpHrRate = bvp.ab > 0 ? bvp.hr / bvp.ab : null;
  edges.hrRate = { bvp: bvpHrRate, season: season.hrRate, edge: (bvpHrRate != null && season.hrRate != null) ? bvpHrRate - season.hrRate : null };

  // OBP edge
  edges.obp = { bvp: bvp.obp, season: season.obp, edge: (bvp.obp != null && season.obp != null) ? bvp.obp - season.obp : null };

  // SLG edge
  edges.slg = { bvp: bvp.slg, season: season.slg, edge: (bvp.slg != null && season.slg != null) ? bvp.slg - season.slg : null };

  // Find best edge for prop suggestion
  for (const cfg of MLB_EDGE_STATS) {
    const e = edges[cfg.key];
    if (e?.edge == null) continue;
    // For K rate, a positive edge means more strikeouts (bad for batter, good for K over)
    const absEdge = Math.abs(e.edge);
    if (absEdge > Math.abs(bestEdge.value)) {
      bestEdge = { stat: cfg.label, value: e.edge, key: cfg.key };
    }
  }

  // Rating based on absolute magnitude of best edge
  const absBest = Math.abs(bestEdge.value);
  let rating = null;
  if (edges.avg?.edge != null) {
    // Use AVG edge thresholds (.050+ = STRONG, .030+ = NOTABLE)
    const absAvg = Math.abs(edges.avg.edge);
    if (absAvg >= 0.080) rating = 'STRONG';
    else if (absAvg >= 0.040) rating = 'NOTABLE';
  }
  // Also check K rate and HR rate for significance
  if (!rating && edges.kRate?.edge != null) {
    const absK = Math.abs(edges.kRate.edge);
    if (absK >= 0.10) rating = rating || 'STRONG';
    else if (absK >= 0.05) rating = rating || 'NOTABLE';
  }
  if (!rating && edges.hrRate?.edge != null) {
    const absHR = Math.abs(edges.hrRate.edge);
    if (absHR >= 0.04) rating = rating || 'STRONG';
    else if (absHR >= 0.02) rating = rating || 'NOTABLE';
  }

  return { edges, bestEdge, rating };
}

function deriveEdgeProps(batter) {
  const props = [];
  if (!batter.edgeResult) return props;
  const { edges } = batter.edgeResult;
  const bvp = batter.bvp;
  const season = batter.season;
  if (!bvp || bvp.pa < 3) return props;

  // Hits prop: BvP avg significantly higher → Hits Over
  if (edges.avg?.edge != null && edges.avg.edge >= 0.040 && bvp.pa >= 5) {
    props.push({
      type: 'Hits Over',
      confidence: edges.avg.edge >= 0.080 ? 'HIGH' : 'MEDIUM',
      reason: `${MLB_EDGE_STATS[0].format(bvp.avg)} BvP AVG vs ${MLB_EDGE_STATS[0].format(season.avg)} season`,
    });
  }

  // K prop: BvP K rate significantly higher → K Over (for the pitcher)
  const bvpKRate = bvp.pa > 0 ? bvp.k / bvp.pa : null;
  if (edges.kRate?.edge != null && edges.kRate.edge >= 0.05 && bvp.pa >= 5) {
    props.push({
      type: 'Strikeout Over',
      confidence: edges.kRate.edge >= 0.10 ? 'HIGH' : 'MEDIUM',
      reason: `${(bvpKRate * 100).toFixed(0)}% BvP K rate vs ${(season.kRate * 100).toFixed(0)}% season`,
    });
  }

  // K Under: BvP K rate significantly lower
  if (edges.kRate?.edge != null && edges.kRate.edge <= -0.05 && bvp.pa >= 5) {
    props.push({
      type: 'Strikeout Under',
      confidence: edges.kRate.edge <= -0.10 ? 'HIGH' : 'MEDIUM',
      reason: `${(bvpKRate * 100).toFixed(0)}% BvP K rate vs ${(season.kRate * 100).toFixed(0)}% season`,
    });
  }

  // HR prop: BvP HR rate elevated
  if (edges.hrRate?.edge != null && edges.hrRate.edge >= 0.02 && bvp.hr > 0) {
    props.push({
      type: 'HR Yes',
      confidence: edges.hrRate.edge >= 0.04 ? 'HIGH' : 'MEDIUM',
      reason: `${bvp.hr} HR in ${bvp.ab} AB vs this pitcher`,
    });
  }

  return props;
}

async function buildMlbEdgeFinderData(gameData, options = {}) {
  const { gameInfo } = gameData;

  // Step 1: fetch ESPN summary first — we need its lineup to pass to backend
  // (MLB's own boxscore often lags behind ESPN by hours)
  const summary = await espn(`https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary?event=${gameInfo.eventId}`);
  const pitchers = summary ? await fetchStartingPitchers(gameInfo, summary) : { away: null, home: null };
  const lineups = summary ? extractMlbLineups(summary, gameInfo) : { away: [], home: [] };

  // Step 2: build backend BvP URL, passing ESPN lineup names so the server can
  // resolve them against MLB rosters when boxscore battingOrder is empty.
  const gameDate = gameInfo.date ? gameInfo.date.slice(0, 10) : '';
  const awayNames = lineups.away.map(b => b.name).join(',');
  const homeNames = lineups.home.map(b => b.name).join(',');
  const bvpUrl = `http://localhost:3001/api/mlb/game-bvp`
    + `?away=${encodeURIComponent(gameInfo.awayFull)}`
    + `&home=${encodeURIComponent(gameInfo.homeFull)}`
    + (gameDate ? `&date=${gameDate}` : '')
    + (awayNames ? `&awayLineup=${encodeURIComponent(awayNames)}` : '')
    + (homeNames ? `&homeLineup=${encodeURIComponent(homeNames)}` : '')
    + (pitchers.away?.name ? `&awayPitcher=${encodeURIComponent(pitchers.away.name)}` : '')
    + (pitchers.home?.name ? `&homePitcher=${encodeURIComponent(pitchers.home.name)}` : '')
    + (options.refresh ? `&refresh=1` : '');

  let bvpData = null;
  try {
    const r = await fetch(bvpUrl);
    if (r.ok) bvpData = await r.json();
  } catch (_) { /* backend unavailable */ }

  if (!summary && !bvpData) return null;

  // Bail only if BOTH sources are completely empty
  const backendHasAny = bvpData?.matchups?.some(m => m.batters?.length || m.pitcher);
  const espnHasAny = pitchers.away?.id || pitchers.home?.id;
  if (!espnHasAny && !backendHasAny) return null;

  const sides = [
    { pitcher: pitchers.away, lineup: lineups.home, team: gameInfo.awayAbbr, oppTeam: gameInfo.homeAbbr, battingSide: 'home', battingTeamId: gameInfo.homeTeamId, teamColor: 'var(--lime)' },
    { pitcher: pitchers.home, lineup: lineups.away, team: gameInfo.homeAbbr, oppTeam: gameInfo.awayAbbr, battingSide: 'away', battingTeamId: gameInfo.awayTeamId, teamColor: 'var(--blue)' },
  ];

  const allBatters = [];

  for (const side of sides) {
    const bvpMatchup = bvpData?.matchups?.find(m => m.side === side.battingSide);

    // Fallback: if ESPN lineup is empty or ESPN pitcher missing, use the
    // backend's MLB Stats API data (which usually posts earlier and is more reliable).
    let effectiveLineup = side.lineup;
    let effectivePitcher = side.pitcher;

    const needLineupFallback = !effectiveLineup?.length && bvpMatchup?.batters?.length;
    const needPitcherFallback = !effectivePitcher?.id && bvpMatchup?.pitcher?.id;

    if (needLineupFallback) {
      const rosterMap = await fetchMlbRosterMap(side.battingTeamId);
      effectiveLineup = bvpMatchup.batters.map(b => {
        const espnMatch = rosterMap[normalizePlayerName(b.name)] || {};
        return {
          name: b.name,
          shortName: espnMatch.shortName || b.name.split(' ').slice(-1)[0],
          athleteId: espnMatch.id || null,   // may be null → no ESPN stats fallback, but BvP still renders
          mlbId: b.id,                        // used for MLB headshot fallback
          order: b.order,
          pos: b.position || espnMatch.pos || '—',
        };
      });
    }

    if (needPitcherFallback) {
      effectivePitcher = {
        id: null,                             // no ESPN id — season stats widgets that need it will skip
        name: bvpMatchup.pitcher.name,
        shortName: bvpMatchup.pitcher.name.split(' ').slice(-1)[0],
      };
    }

    if (!effectiveLineup?.length || !effectivePitcher?.name) continue;

    // Build BvP lookup
    const bvpByOrder = {};
    const bvpByName = {};
    if (bvpMatchup?.batters?.length) {
      for (const b of bvpMatchup.batters) {
        bvpByOrder[b.order] = b.bvp;
        bvpByName[normalizePlayerName(b.name)] = b.bvp;
      }
    }

    // Fetch season stats for all batters in parallel — skip when ESPN id unknown
    const seasonFetches = effectiveLineup.map(b => b.athleteId
      ? fetchMlbAthleteStats(b.athleteId).catch(() => null)
      : Promise.resolve(null));
    const seasonResults = await Promise.all(seasonFetches);

    for (let i = 0; i < effectiveLineup.length; i++) {
      const batter = effectiveLineup[i];
      const bvp = bvpByOrder[batter.order]
        ?? bvpByName[normalizePlayerName(batter.name)]
        ?? null;
      const seasonRaw = seasonResults[i];
      const season = seasonRaw ? extractBatterSeasonStats(seasonRaw) : null;
      const edgeResult = computeMlbBatterEdge(bvp, season);

      // Prefer ESPN headshot; fall back to MLB photo CDN when we only have an MLB id.
      const headshotUrl = batter.athleteId
        ? `https://a.espncdn.com/i/headshots/mlb/players/full/${batter.athleteId}.png`
        : batter.mlbId
          ? `https://midfield.mlbstatic.com/v1/people/${batter.mlbId}/spots/120`
          : '';

      const entry = {
        name: batter.name,
        shortName: batter.shortName || batter.name.split(' ').pop(),
        athleteId: batter.athleteId,
        order: batter.order,
        pos: batter.pos,
        pitcher: effectivePitcher.name,
        pitcherTeam: side.team,
        battingTeam: side.oppTeam,
        teamColor: side.teamColor,
        headshotUrl,
        bvp: (bvp && bvp.pa > 0) ? bvp : null,
        neverFaced: !bvp || bvp.pa === 0,
        season,
        edgeResult,
      };

      entry.props = deriveEdgeProps(entry);
      allBatters.push(entry);
    }
  }

  // Sort by best edge magnitude (batters with data first, then no-data)
  allBatters.sort((a, b) => {
    if (a.edgeResult && !b.edgeResult) return -1;
    if (!a.edgeResult && b.edgeResult) return 1;
    if (!a.edgeResult && !b.edgeResult) return 0;
    const aVal = Math.abs(a.edgeResult.bestEdge.value || 0);
    const bVal = Math.abs(b.edgeResult.bestEdge.value || 0);
    return bVal - aVal;
  });

  // Top edge picks (best rated batter per team)
  const topPicks = [];
  for (const team of [gameInfo.awayAbbr, gameInfo.homeAbbr]) {
    const pick = allBatters.find(b => b.battingTeam === team && b.edgeResult?.rating);
    if (pick) topPicks.push(pick);
  }

  return {
    batters: allBatters,
    topPicks,
    pitchers,
    bvpAvailable: !!bvpData,
    bvpStatus: bvpData?.status || null,
    awayAbbr: gameInfo.awayAbbr,
    homeAbbr: gameInfo.homeAbbr,
    fetchedAt: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────
//  Auto-refresh: poll backend while BvP data is incomplete
//  Runs until lineups confirmed + all batters resolved, or until
//  the user leaves the MLB analysis.
// ─────────────────────────────────────────────────────────────
let _mlbEdgePollTimer = null;
let _mlbEdgePollAttempts = 0;

function mlbEdgeIsComplete(data) {
  if (!data) return false;
  const s = data.bvpStatus;
  if (!s) return false;
  if (s.lineupStatus !== 'confirmed') return false;
  if (!s.totalBatters) return false;
  // Accept if at least 80% of batters resolved (some historical pitcher/batter
  // combos legitimately have zero PA — don't poll forever chasing them)
  return s.resolvedBatters / s.totalBatters >= 0.8;
}

function stopMlbEdgePolling() {
  if (_mlbEdgePollTimer) {
    clearTimeout(_mlbEdgePollTimer);
    _mlbEdgePollTimer = null;
  }
  _mlbEdgePollAttempts = 0;
}

function scheduleMlbEdgeAutoRefresh(gameData) {
  stopMlbEdgePolling();
  const data = gameData.mlbEdgeData;
  if (mlbEdgeIsComplete(data)) return;

  // Back off gradually: 45s, 60s, 90s, then 120s repeating (max ~15 min)
  const delays = [45000, 60000, 90000, 120000];
  const delay = delays[Math.min(_mlbEdgePollAttempts, delays.length - 1)];
  if (_mlbEdgePollAttempts >= 15) return; // give up after ~20 min

  _mlbEdgePollTimer = setTimeout(async () => {
    _mlbEdgePollAttempts++;
    // Skip if the user navigated away from the MLB analysis entirely
    if (!document.getElementById('mlbEdgesContent')) {
      stopMlbEdgePolling();
      return;
    }
    try {
      const fresh = await buildMlbEdgeFinderData(gameData, { refresh: true });
      if (fresh) {
        gameData.mlbEdgeData = fresh;
        renderMlbEdgeFinder(fresh, gameData);
      }
    } catch (e) {
      console.warn('MLB edge auto-refresh failed:', e);
    }
    scheduleMlbEdgeAutoRefresh(gameData);
  }, delay);
}

async function refreshMlbEdgeFinder() {
  if (!S?.gameData) return;
  const btn = document.getElementById('mlbEdgeRefreshBtn');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Refreshing...'; }
  try {
    stopMlbEdgePolling();
    const fresh = await buildMlbEdgeFinderData(S.gameData, { refresh: true });
    if (fresh) {
      S.gameData.mlbEdgeData = fresh;
      renderMlbEdgeFinder(fresh, S.gameData);
    }
  } catch (e) {
    console.error('MLB edge manual refresh failed:', e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh'; }
  }
}

function renderMlbEdgeFinder(data, gameData) {
  const el = document.getElementById('mlbEdgesContent');
  if (!el) return;
  const { gameInfo } = gameData;

  if (!data || !data.batters?.length) {
    el.innerHTML = `<div class="ef-empty">No edge data available — lineups may not be confirmed yet.</div>`;
    return;
  }

  const edgeColor = (val, cfg) => {
    if (val == null) return '';
    const abs = Math.abs(val);
    // For K rate, positive = more K's (bad for batter), so reverse color
    const isGood = cfg.key === 'kRate' ? val < 0 : val > 0;
    if (cfg.key === 'avg' || cfg.key === 'obp' || cfg.key === 'slg') {
      if (abs >= 0.080) return isGood ? 'ef-edge-pos' : 'ef-edge-neg';
      if (abs >= 0.040) return isGood ? 'ef-edge-mild-pos' : 'ef-edge-mild-neg';
    } else if (cfg.key === 'kRate') {
      if (abs >= 0.10) return isGood ? 'ef-edge-pos' : 'ef-edge-neg';
      if (abs >= 0.05) return isGood ? 'ef-edge-mild-pos' : 'ef-edge-mild-neg';
    } else if (cfg.key === 'hrRate') {
      if (abs >= 0.04) return isGood ? 'ef-edge-pos' : 'ef-edge-neg';
      if (abs >= 0.02) return isGood ? 'ef-edge-mild-pos' : 'ef-edge-mild-neg';
    }
    return '';
  };

  const fmtEdge = (val, cfg) => {
    if (val == null) return '—';
    if (cfg.key === 'kRate' || cfg.key === 'hrRate') {
      const sign = val > 0 ? '+' : '';
      return `${sign}${(val * 100).toFixed(1)}%`;
    }
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(3)}`;
  };

  // Top picks section
  const renderTopPick = (batter) => {
    if (!batter) return '<div class="ef-no-pick">No clear edge found</div>';
    const er = batter.edgeResult;
    const ratingClass = er.rating === 'STRONG' ? 'ef-badge-strong' : 'ef-badge-notable';
    const topProps = batter.props.slice(0, 2);
    return `
      <div class="ef-top-prop">
        <div class="ef-top-prop-player">
          <img class="ef-top-hs" src="${batter.headshotUrl}" alt="${batter.name}" onerror="this.style.display='none'">
          <div class="ef-top-info">
            <span class="ef-top-name">${batter.name}</span>
            <span class="ef-top-meta">${batter.battingTeam} · ${batter.pos} · #${batter.order} · vs ${batter.pitcher}</span>
          </div>
          <span class="${ratingClass}">${er.rating}</span>
        </div>
        <div class="ef-top-prop-stats">
          ${MLB_EDGE_STATS.filter(cfg => er.edges[cfg.key]?.edge != null).slice(0, 4).map(cfg => {
            const e = er.edges[cfg.key];
            return `
              <div class="ef-top-stat-col">
                <span class="ef-top-stat-label">${cfg.label}</span>
                <span class="ef-top-stat-val ${edgeColor(e.edge, cfg)}">${fmtEdge(e.edge, cfg)}</span>
              </div>`;
          }).join('')}
        </div>
        ${topProps.length ? `
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
            ${topProps.map(p => `<span class="me-prop-pill me-prop-${p.confidence.toLowerCase()}">${p.type}</span>`).join('')}
          </div>` : ''}
        ${batter.bvp ? `<div style="font-family:var(--font-m);font-size:10px;color:var(--text3);margin-top:6px">${batter.bvp.pa} PA · ${batter.bvp.hits}-${batter.bvp.ab} · ${batter.bvp.hr} HR · ${batter.bvp.k} K vs this pitcher</div>` : ''}
      </div>`;
  };

  // Season stats summary row
  const seasonRow = (batter) => {
    const s = batter.season;
    if (!s) return '<span style="color:var(--text3)">No season data</span>';
    return `${s.gp || '—'}G · ${s.hits || '—'}H · ${s.hr || '—'}HR · ${s.rbi || '—'}RBI · ${s.k || '—'}K · ${MLB_EDGE_STATS[0].format(s.avg)} AVG`;
  };

  // Store batters for drill-down access
  S._mlbEdgeBatters = data.batters;

  // Desktop table rows
  const playerRows = data.batters.map((b, idx) => {
    const er = b.edgeResult;
    const teamColorStyle = `color:${b.teamColor}`;
    return `
      <tr class="ef-row-clickable" onclick="toggleMlbEdgeDetail(${idx})">
        <td class="ef-player-cell">
          <img class="ef-row-hs" src="${b.headshotUrl}" alt="${b.shortName}" onerror="this.style.display='none'">
          <div class="ef-row-info">
            <span class="ef-row-name">${b.shortName}</span>
            <span class="ef-row-meta" style="${teamColorStyle}">${b.battingTeam} · ${b.pos} · #${b.order}</span>
          </div>
        </td>
        <td class="ef-td-center" style="font-family:var(--font-m);font-size:10px;color:var(--text3)">${b.neverFaced ? '—' : (b.bvp?.pa || 0)}</td>
        <td class="ef-td-stat">
          <span class="ef-h2h-val">${b.season?.hr ?? '—'}</span>
          <span class="ef-season-val">${b.season?.rbi ?? '—'}</span>
          <span class="ef-edge-val" style="color:var(--text3)">${b.season?.runs ?? '—'}</span>
        </td>
        <td class="ef-td-stat">
          <span class="ef-h2h-val">${b.season?.hits ?? '—'}</span>
          <span class="ef-season-val">${b.season?.k ?? '—'}</span>
          <span class="ef-edge-val" style="color:var(--text3)">${b.season?.gp ?? '—'}</span>
        </td>
        ${MLB_EDGE_STATS.map(cfg => {
          if (!er) return '<td class="ef-td-stat"><span class="ef-h2h-val">—</span><span class="ef-season-val">—</span><span class="ef-edge-val">—</span></td>';
          const e = er.edges[cfg.key];
          return `
            <td class="ef-td-stat">
              <span class="ef-h2h-val">${e?.bvp != null ? cfg.format(e.bvp) : '—'}</span>
              <span class="ef-season-val">${e?.season != null ? cfg.format(e.season) : '—'}</span>
              <span class="ef-edge-val ${edgeColor(e?.edge, cfg)}">${fmtEdge(e?.edge, cfg)}</span>
            </td>`;
        }).join('')}
        <td class="ef-td-center">${er?.rating ? `<span class="${er.rating === 'STRONG' ? 'ef-badge-strong' : 'ef-badge-notable'}">${er.rating}</span>` : (b.neverFaced ? '<span style="font-size:9px;color:var(--text3)">NEW</span>' : '')}</td>
      </tr>`;
  }).join('');

  // Mobile cards
  const playerCards = data.batters.map((b, idx) => {
    const er = b.edgeResult;
    const topEdges = er ? MLB_EDGE_STATS.filter(cfg => er.edges[cfg.key]?.edge != null)
      .sort((a, c) => Math.abs(er.edges[c.key].edge) - Math.abs(er.edges[a.key].edge))
      .slice(0, 3) : [];
    return `
      <div class="ef-card" onclick="toggleMlbEdgeDetail(${idx})">
        <div class="ef-card-left">
          <img class="ef-card-hs" src="${b.headshotUrl}" alt="${b.shortName}" onerror="this.style.display='none'">
          <div class="ef-card-info">
            <span class="ef-card-name">${b.shortName}</span>
            <span class="ef-card-meta" style="color:${b.teamColor}">${b.battingTeam} · ${b.pos} · #${b.order}</span>
            ${b.season ? `<span class="ef-card-meta" style="color:var(--text3)">${b.season.hr ?? 0}HR · ${b.season.rbi ?? 0}RBI · ${b.season.runs ?? 0}R · ${b.season.hits ?? 0}H · ${b.season.k ?? 0}K</span>` : ''}
          </div>
        </div>
        <div class="ef-card-right">
          ${topEdges.map(cfg => {
            const e = er.edges[cfg.key];
            return `<span class="ef-card-edge ${edgeColor(e.edge, cfg)}">${cfg.label} ${fmtEdge(e.edge, cfg)}</span>`;
          }).join('')}
          ${er?.rating ? `<span class="${er.rating === 'STRONG' ? 'ef-badge-strong' : 'ef-badge-notable'}">${er.rating}</span>` : (b.neverFaced ? '<span style="font-size:9px;color:var(--text3)">NEW</span>' : '')}
        </div>
      </div>`;
  }).join('');

  // Prop edge summary — collect all prop suggestions
  const allProps = data.batters.filter(b => b.props.length > 0);

  const propsHtml = allProps.length ? `
    <div class="ef-section">
      <div class="ef-section-title">Prop Edge Summary</div>
      <div class="pe-hint" style="margin-bottom:10px">Based on BvP vs season stat comparison — higher confidence = larger deviation from season norms</div>
      <div class="me-props-grid">
        ${allProps.map(b => `
          <div class="me-prop-card">
            <div class="me-prop-head">
              <img class="ef-card-hs" src="${b.headshotUrl}" alt="${b.shortName}" onerror="this.style.display='none'">
              <div>
                <div style="font-family:var(--font-m);font-size:12px;font-weight:600;color:var(--text)">${b.shortName}</div>
                <div style="font-family:var(--font-m);font-size:10px;color:${b.teamColor}">${b.battingTeam} vs ${b.pitcher}</div>
              </div>
            </div>
            <div class="me-prop-list">
              ${b.props.map(p => `
                <div class="me-prop-row">
                  <span class="me-prop-pill me-prop-${p.confidence.toLowerCase()}">${p.type}</span>
                  <span class="me-prop-reason">${p.reason}</span>
                </div>`).join('')}
            </div>
            <div style="font-family:var(--font-m);font-size:9px;color:var(--text3);margin-top:4px">${b.bvp ? `${b.bvp.pa} PA career vs pitcher` : ''}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  const withBvp = data.batters.filter(b => !b.neverFaced).length;
  const neverFaced = data.batters.filter(b => b.neverFaced).length;

  // Data status banner — shown when lineups/BvP aren't fully resolved
  const status = data.bvpStatus;
  const complete = mlbEdgeIsComplete(data);
  let statusBanner = '';
  if (status) {
    const resolvedPct = status.totalBatters ? Math.round((status.resolvedBatters / status.totalBatters) * 100) : 0;
    const statusLabel = status.lineupStatus === 'confirmed' ? 'Lineups confirmed'
      : status.lineupStatus === 'partial' ? 'Partial lineups (auto-refreshing)'
      : 'Lineups not yet posted (auto-refreshing)';
    const color = complete ? 'var(--green)' : 'var(--yellow)';
    statusBanner = `
      <div class="me-status-banner" style="border-left:2px solid ${color}">
        <div class="me-status-text">
          <span style="color:${color};font-weight:600">${statusLabel}</span>
          <span style="color:var(--text3)">· ${status.resolvedBatters}/${status.totalBatters} BvP resolved (${resolvedPct}%)</span>
          ${status.failedBatters ? `<span style="color:var(--red)">· ${status.failedBatters} failed</span>` : ''}
        </div>
        <button class="refresh-btn" id="mlbEdgeRefreshBtn" onclick="refreshMlbEdgeFinder()">↻ Refresh</button>
      </div>`;
  } else if (!data.bvpAvailable) {
    statusBanner = `
      <div class="me-status-banner" style="border-left:2px solid var(--red)">
        <div class="me-status-text"><span style="color:var(--red);font-weight:600">BvP backend offline</span></div>
        <button class="refresh-btn" id="mlbEdgeRefreshBtn" onclick="refreshMlbEdgeFinder()">↻ Retry</button>
      </div>`;
  }

  el.innerHTML = `
    <div class="ef-header">
      <div class="ef-title">MLB Edge Finder</div>
      <div class="ef-subtitle">BvP (Savant) vs Season stats · ${withBvp} batters with history · ${neverFaced} first matchups</div>
    </div>

    ${statusBanner}

    ${data.topPicks.length ? `
    <div class="ef-section">
      <div class="ef-section-title">Top Edge Picks</div>
      <div class="ef-top-props-grid">
        ${data.topPicks.map(p => renderTopPick(p)).join('')}
      </div>
    </div>` : ''}

    ${propsHtml}

    <div class="ef-section">
      <div class="ef-section-title">All Batter Edges</div>
      <div class="ef-table-wrap ef-desktop-only">
        <table class="ef-table">
          <thead>
            <tr>
              <th class="ef-th-player">Batter</th>
              <th class="ef-th-center">PA</th>
              <th class="ef-th-stat">Season<div class="ef-th-sub">HR / RBI / R</div></th>
              <th class="ef-th-stat">Season<div class="ef-th-sub">H / K / GP</div></th>
              ${MLB_EDGE_STATS.map(s => `<th class="ef-th-stat">${s.label}<div class="ef-th-sub">BvP / SZN / Edge</div></th>`).join('')}
              <th class="ef-th-center">Rating</th>
            </tr>
          </thead>
          <tbody>${playerRows}</tbody>
        </table>
      </div>
      <div class="ef-card-list ef-mobile-only">
        ${playerCards}
      </div>
    </div>
  `;

  // Kick off (or cancel) background polling depending on completeness
  if (gameData && !complete && data.bvpAvailable) {
    scheduleMlbEdgeAutoRefresh(gameData);
  } else {
    stopMlbEdgePolling();
  }
}

/* ── MLB EDGE DETAIL DRILL-DOWN ───────────────────────────
   Click a player row → expand a detail panel with:
   1. Last 5 season games (H, R, RBI, K bar charts)
   2. Games vs this specific pitcher (H, HR, K, BB bar charts)
─────────────────────────────────────────────────────────── */

const MLB_DETAIL_STATS = [
  { key: 'h', label: 'H', espnIdx: 'H' },
  { key: 'hr', label: 'HR', espnIdx: 'HR' },
  { key: 'r', label: 'R', espnIdx: 'R' },
  { key: 'rbi', label: 'RBI', espnIdx: 'RBI' },
  { key: 'k', label: 'K', espnIdx: 'SO' },
];

const MLB_BVP_GAME_STATS = [
  { key: 'h', label: 'H' },
  { key: 'hr', label: 'HR' },
  { key: 'k', label: 'K' },
  { key: 'bb', label: 'BB' },
];

function extractBatterRecentGames(gameLogData, limit = 5) {
  if (!gameLogData?.labels?.length || !gameLogData?.seasonTypes?.length) return [];
  const labels = gameLogData.labels;
  const idxMap = {};
  ['AB', 'R', 'H', '2B', '3B', 'HR', 'RBI', 'BB', 'SO', 'AVG'].forEach(lbl => {
    const i = labels.indexOf(lbl);
    if (i > -1) idxMap[lbl] = i;
  });
  const eventMeta = gameLogData.events || {};
  const games = [];

  gameLogData.seasonTypes.forEach(seasonType => {
    (seasonType.categories || []).forEach(cat => {
      (cat.events || []).forEach(ev => {
        const meta = eventMeta[ev.eventId] || {};
        const opponent = meta.opponent;
        const oppLabel = opponent?.abbreviation || opponent?.shortDisplayName || opponent?.displayName || '?';
        const oppLogo = opponent?.logo || '';
        const st = ev.stats || [];
        games.push({
          eventId: ev.eventId,
          date: meta.gameDate || '',
          opponent: oppLabel,
          opponentLogo: oppLogo,
          homeAway: meta.atVs || '',
          ab: idxMap.AB != null ? parseInt(st[idxMap.AB]) || 0 : 0,
          h: idxMap.H != null ? parseInt(st[idxMap.H]) || 0 : 0,
          r: idxMap.R != null ? parseInt(st[idxMap.R]) || 0 : 0,
          hr: idxMap.HR != null ? parseInt(st[idxMap.HR]) || 0 : 0,
          rbi: idxMap.RBI != null ? parseInt(st[idxMap.RBI]) || 0 : 0,
          bb: idxMap.BB != null ? parseInt(st[idxMap.BB]) || 0 : 0,
          k: idxMap.SO != null ? parseInt(st[idxMap.SO]) || 0 : 0,
        });
      });
    });
  });

  return games
    .filter(g => g.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);
}

function destroyMlbEdgeCharts(idx) {
  ['meL5_', 'meBvp_'].forEach(prefix => {
    const key = `${prefix}${idx}`;
    if (S.charts[key]) { S.charts[key].destroy(); delete S.charts[key]; }
  });
}

function toggleMlbEdgeDetail(idx) {
  const existing = document.getElementById(`me-detail-${idx}`);
  if (existing) {
    destroyMlbEdgeCharts(idx);
    existing.remove();
    return;
  }

  // Close any other open detail
  document.querySelectorAll('[id^="me-detail-"]').forEach(el => {
    const oldIdx = el.dataset.idx;
    destroyMlbEdgeCharts(oldIdx);
    el.remove();
  });

  const b = S._mlbEdgeBatters?.[idx];
  if (!b) return;

  const defaultL5Stat = 'h';
  const defaultBvpStat = 'h';

  const l5Btns = MLB_DETAIL_STATS.map((c, i) =>
    `<button class="ef-detail-stat-btn${i === 0 ? ' active' : ''}" onclick="event.stopPropagation(); switchMlbL5Stat(${idx}, '${c.key}', this)">${c.label}</button>`
  ).join('');

  const bvpBtns = MLB_BVP_GAME_STATS.map((c, i) =>
    `<button class="ef-detail-stat-btn${i === 0 ? ' active' : ''}" onclick="event.stopPropagation(); switchMlbBvpStat(${idx}, '${c.key}', this)">${c.label}</button>`
  ).join('');

  const hasBvpGames = b.bvp?.gameByGame?.length > 0;

  const panelHTML = `
    <div class="ef-detail-panel">
      <div class="ef-detail-header">
        <img class="ef-detail-hs" src="${b.headshotUrl}" alt="${b.shortName}" onerror="this.style.display='none'">
        <div class="ef-detail-info">
          <span class="ef-detail-name">${b.name}</span>
          <span class="ef-detail-meta" style="color:${b.teamColor}">${b.battingTeam} · ${b.pos} · #${b.order} · vs ${b.pitcher}</span>
        </div>
      </div>

      <!-- Season Last 5 Games -->
      <div class="ef-detail-section-label">Last 5 Games (Season)</div>
      <div class="ef-detail-controls">
        <span class="ef-detail-label">Stat</span>
        <div class="ef-detail-toggle" id="meL5Toggle_${idx}">${l5Btns}</div>
      </div>
      <div class="ef-detail-chart-wrap" id="meL5Wrap_${idx}">
        <div class="ef-detail-loading" id="meL5Loading_${idx}">
          <div class="mini-spin"></div> Loading last 5 games…
        </div>
        <canvas id="meL5Chart_${idx}" height="140" style="display:none"></canvas>
      </div>
      <div class="ef-wx-strip" id="meL5Weather_${idx}" style="display:none"></div>
      <div class="ef-detail-summary" id="meL5Summary_${idx}"></div>

      <!-- Games vs This Pitcher (BvP) -->
      <div class="ef-detail-section-label" style="margin-top:10px">Games vs ${escapeHtml(b.pitcher)} (Savant)</div>
      <div class="ef-detail-controls">
        <span class="ef-detail-label">Stat</span>
        <div class="ef-detail-toggle" id="meBvpToggle_${idx}">${bvpBtns}</div>
      </div>
      <div class="ef-detail-chart-wrap" id="meBvpWrap_${idx}">
        ${hasBvpGames
          ? `<canvas id="meBvpChart_${idx}" height="140"></canvas>`
          : `<div class="ef-detail-loading" style="color:var(--text3)">${b.neverFaced ? 'These two have never faced each other' : 'No per-game BvP data available'}</div>`
        }
      </div>
      <div class="ef-wx-strip" id="meBvpWeather_${idx}" style="display:none"></div>
      <div class="ef-detail-summary" id="meBvpSummary_${idx}"></div>
    </div>`;

  // Insert into DOM
  const edgesEl = document.getElementById('mlbEdgesContent');
  if (!edgesEl) return;
  const cardList = edgesEl.querySelector('.ef-card-list');
  const isMobile = cardList && cardList.offsetParent !== null;

  let detailEl;
  if (isMobile) {
    const card = edgesEl.querySelectorAll('.ef-card')[idx];
    if (!card) return;
    detailEl = document.createElement('div');
    detailEl.id = `me-detail-${idx}`;
    detailEl.className = 'ef-detail-panel-outer';
    detailEl.dataset.idx = idx;
    detailEl.innerHTML = panelHTML;
    card.after(detailEl);
  } else {
    const clickedRow = edgesEl.querySelectorAll('.ef-row-clickable')[idx];
    if (!clickedRow) return;
    const colCount = clickedRow.cells.length;
    const tr = document.createElement('tr');
    tr.id = `me-detail-${idx}`;
    tr.className = 'ef-detail-panel-outer ef-detail-tr';
    tr.dataset.idx = idx;
    tr.innerHTML = `<td colspan="${colCount}" class="ef-detail-cell">${panelHTML}</td>`;
    clickedRow.after(tr);
    detailEl = tr;
  }

  requestAnimationFrame(() => detailEl.classList.add('ef-detail-visible'));
  detailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  // Render BvP chart immediately if data exists
  if (hasBvpGames) {
    renderMlbBvpChart(idx, defaultBvpStat);
  }

  // Fetch last 5 games async from ESPN gamelog
  fetchMlbAthleteGameLog(b.athleteId).then(async gameLogData => {
    const games = extractBatterRecentGames(gameLogData);
    b._last5Games = games;
    const loadEl = document.getElementById(`meL5Loading_${idx}`);
    const canvasEl = document.getElementById(`meL5Chart_${idx}`);
    if (loadEl) loadEl.style.display = 'none';
    if (canvasEl) canvasEl.style.display = 'block';
    if (!games?.length) {
      const wrap = document.getElementById(`meL5Wrap_${idx}`);
      if (wrap) wrap.innerHTML = '<div class="ef-detail-loading" style="color:var(--text3)">No recent games found</div>';
      return;
    }
    renderMlbL5Chart(idx, defaultL5Stat);

    // Enrich L5 games with weather from MLB Stats API (backend-routed).
    // ESPN MLB summaries don't include weather, so we look it up by
    // batter's team abbr + game date. Mutating weather onto the existing
    // game objects lets the chart's tooltip closure pick it up on hover.
    const teamAbbr = b.battingTeam;
    Promise.all(games.map(async g => {
      const d = g.date ? new Date(g.date).toISOString().slice(0, 10) : null;
      g.weather = await fetchMlbGameWeather(d, teamAbbr).catch(() => null);
    })).then(() => {
      if (document.getElementById(`me-detail-${idx}`)) {
        renderMlbWeatherStrip(`meL5Weather_${idx}`, games);
      }
    });
  }).catch(() => {
    const wrap = document.getElementById(`meL5Wrap_${idx}`);
    if (wrap) wrap.innerHTML = '<div class="ef-detail-loading" style="color:var(--text3)">Failed to load game log</div>';
  });
}

function switchMlbL5Stat(idx, statKey, btn) {
  btn.closest('.ef-detail-toggle').querySelectorAll('.ef-detail-stat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMlbL5Chart(idx, statKey);
}

function switchMlbBvpStat(idx, statKey, btn) {
  btn.closest('.ef-detail-toggle').querySelectorAll('.ef-detail-stat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderMlbBvpChart(idx, statKey);
}

function renderMlbL5Chart(idx, statKey) {
  const b = S._mlbEdgeBatters?.[idx];
  if (!b || !b._last5Games?.length) return;

  const chartKey = `meL5_${idx}`;
  const ctx = document.getElementById(`meL5Chart_${idx}`);
  if (!ctx) return;
  if (S.charts[chartKey]) S.charts[chartKey].destroy();

  const games = b._last5Games;
  const statCfg = MLB_DETAIL_STATS.find(c => c.key === statKey);
  const statLabel = statCfg?.label || statKey;

  const values = games.map(g => g[statKey] || 0);
  const labels = games.map(g => {
    const d = g.date ? new Date(g.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?';
    return `${g.homeAway || ''}${g.opponent}\n${d}`;
  });
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const colors = values.map(v => v > avg ? 'rgba(35,209,139,0.82)' : 'rgba(77,139,255,0.75)');

  S.charts[chartKey] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderRadius: 5,
          borderSkipped: false,
          barPercentage: 0.5,
          maxBarThickness: 48,
          minBarLength: 4,
        },
        {
          type: 'line',
          label: 'L5 Avg',
          data: new Array(values.length).fill(parseFloat(avg.toFixed(1))),
          borderColor: 'rgba(255,255,255,0.18)',
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 120 },
      layout: { padding: { top: 6, bottom: 2 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const g = games[items[0].dataIndex];
              const d = g.date ? new Date(g.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
              return `${g.homeAway || ''}${g.opponent}  ${d}`;
            },
            label: (item) => {
              if (item.datasetIndex > 0) return `${item.dataset.label}: ${item.raw}`;
              const g = games[item.dataIndex];
              return `${statLabel}: ${item.raw}  (${g.ab} AB · ${g.h}H · ${g.r}R · ${g.rbi}RBI · ${g.hr}HR · ${g.k}K)`;
            },
            afterLabel: (item) => {
              if (item.datasetIndex > 0) return null;
              const g = games[item.dataIndex];
              const line = formatWeatherLine(g.weather);
              return line ? `☁ ${line}` : null;
            },
          },
          backgroundColor: 'rgba(13,13,18,0.95)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#f0f0fa',
          bodyColor: '#b8bce8',
          padding: 10,
        },
      },
      scales: {
        x: {
          ticks: { color: '#b8bce8', font: { family: 'IBM Plex Mono', size: 9 }, maxRotation: 0 },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          ticks: { color: '#8888b0', font: { family: 'IBM Plex Mono', size: 10 }, stepSize: 1 },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { display: false },
          beginAtZero: true,
        },
      },
    },
  });

  renderMlbWeatherStrip(`meL5Weather_${idx}`, games);

  // Summary
  const summaryEl = document.getElementById(`meL5Summary_${idx}`);
  if (summaryEl) {
    const max = Math.max(...values);
    const min = Math.min(...values);
    const total = values.reduce((s, v) => s + v, 0);
    summaryEl.innerHTML = `
      <div class="ef-detail-summary-grid">
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">L5 Avg</span>
          <span class="ef-detail-summary-val">${avg.toFixed(1)}</span>
        </div>
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">Total</span>
          <span class="ef-detail-summary-val">${total}</span>
        </div>
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">High</span>
          <span class="ef-detail-summary-val" style="color:var(--green)">${max}</span>
        </div>
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">Low</span>
          <span class="ef-detail-summary-val" style="color:var(--red)">${min}</span>
        </div>
      </div>`;
  }
}

function renderMlbBvpChart(idx, statKey) {
  const b = S._mlbEdgeBatters?.[idx];
  if (!b?.bvp?.gameByGame?.length) return;

  const chartKey = `meBvp_${idx}`;
  const ctx = document.getElementById(`meBvpChart_${idx}`);
  if (!ctx) return;
  if (S.charts[chartKey]) S.charts[chartKey].destroy();

  const games = b.bvp.gameByGame.slice(0, 10); // Show up to last 10 games vs pitcher
  const statCfg = MLB_BVP_GAME_STATS.find(c => c.key === statKey);
  const statLabel = statCfg?.label || statKey;

  const values = games.map(g => g[statKey] || 0);
  const labels = games.map(g => {
    const d = g.date ? new Date(g.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '?';
    return d;
  });
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;

  // Season avg for comparison line (if available)
  const seasonAvg = b.season ? {
    h: b.season.hitsPerGame,
    hr: (b.season.hr && b.season.gp) ? b.season.hr / b.season.gp : null,
    k: b.season.kPerGame,
    bb: (b.season.bb && b.season.gp) ? b.season.bb / b.season.gp : null,
  }[statKey] : null;

  const colors = values.map(v => {
    if (seasonAvg != null) return v > seasonAvg ? 'rgba(212,245,60,0.82)' : 'rgba(255,61,90,0.72)';
    return 'rgba(212,245,60,0.75)';
  });

  const datasets = [
    {
      data: values,
      backgroundColor: colors,
      borderRadius: 5,
      borderSkipped: false,
      barPercentage: 0.5,
      maxBarThickness: 48,
      minBarLength: 4,
    },
    {
      type: 'line',
      label: 'BvP Avg',
      data: new Array(values.length).fill(parseFloat(avg.toFixed(1))),
      borderColor: 'rgba(212,245,60,0.35)',
      borderWidth: 1,
      pointRadius: 0,
      fill: false,
      tension: 0,
    },
  ];
  if (seasonAvg != null) {
    datasets.push({
      type: 'line',
      label: 'Season Avg',
      data: new Array(values.length).fill(parseFloat(seasonAvg.toFixed(1))),
      borderColor: 'rgba(255,255,255,0.18)',
      borderWidth: 1,
      pointRadius: 0,
      fill: false,
      tension: 0,
    });
  }

  S.charts[chartKey] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 120 },
      layout: { padding: { top: 6, bottom: 2 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const g = games[items[0].dataIndex];
              return g.date || '?';
            },
            label: (item) => {
              if (item.datasetIndex > 0) return `${item.dataset.label}: ${item.raw}`;
              const g = games[item.dataIndex];
              return `${statLabel}: ${item.raw}  (${g.ab} AB · ${g.h}H · ${g.hr}HR · ${g.k}K · ${g.bb}BB)`;
            },
            afterLabel: (item) => {
              if (item.datasetIndex > 0) return null;
              const g = games[item.dataIndex];
              const line = formatWeatherLine(g.weather);
              return line ? `☁ ${line}` : null;
            },
          },
          backgroundColor: 'rgba(13,13,18,0.95)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#f0f0fa',
          bodyColor: '#b8bce8',
          padding: 10,
        },
      },
      scales: {
        x: {
          ticks: { color: '#b8bce8', font: { family: 'IBM Plex Mono', size: 9 }, maxRotation: 45 },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          ticks: { color: '#8888b0', font: { family: 'IBM Plex Mono', size: 10 }, stepSize: 1 },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { display: false },
          beginAtZero: true,
        },
      },
    },
  });

  renderMlbWeatherStrip(`meBvpWeather_${idx}`, games);

  // Summary
  const summaryEl = document.getElementById(`meBvpSummary_${idx}`);
  if (summaryEl) {
    const max = Math.max(...values);
    const min = Math.min(...values);
    const total = values.reduce((s, v) => s + v, 0);
    summaryEl.innerHTML = `
      <div class="ef-detail-summary-grid">
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">BvP Avg</span>
          <span class="ef-detail-summary-val" style="color:var(--lime)">${avg.toFixed(1)}</span>
        </div>
        ${seasonAvg != null ? `
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">Season Avg</span>
          <span class="ef-detail-summary-val">${seasonAvg.toFixed(1)}</span>
        </div>` : ''}
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">${games.length} Game${games.length !== 1 ? 's' : ''}</span>
          <span class="ef-detail-summary-val">${total} total</span>
        </div>
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">High</span>
          <span class="ef-detail-summary-val" style="color:var(--green)">${max}</span>
        </div>
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">Low</span>
          <span class="ef-detail-summary-val" style="color:var(--red)">${min}</span>
        </div>
      </div>`;
  }
}

function renderLowHrMatchup(data, gameData) {
  const el = document.getElementById('lowHrContent');
  if (!el) return;
  const esc = escapeHtml;

  // ── Error state ──
  if (!data || data.error) {
    el.innerHTML = `
      <div class="pe-header">
        <div class="pe-title">Low HR Scanner</div>
        <div class="pe-subtitle">No-home-run probability analysis from ESPN season stats</div>
      </div>
      <div class="lhr-verdict lhr-verdict--fail">
        <span class="lhr-verdict-icon">&#x26A0;</span>
        <div>
          <div class="lhr-verdict-text">${esc(data?.error || 'Unable to load Low HR data')}</div>
          ${data?.reason ? `<div class="lhr-verdict-sub">${esc(data.reason)}</div>` : ''}
        </div>
      </div>`;
    return;
  }

  const { gameInfo } = gameData;

  // ── Pitcher card ──
  const pitcherCard = (sp) => {
    if (!sp) return '';
    const isLow = sp.hr_per_9_label === 'LOW';
    const color = sp.team === gameInfo.awayAbbr ? 'var(--blue)' : 'var(--lime)';
    const vs = sp.vs_team;

    const vsTeamHtml = vs ? `
      <div class="lhr-vs-section" style="margin-top:12px">
        <div class="lhr-vs-label">Career vs ${esc(sp.vs_team_name)}</div>
        <div style="font-family:var(--font-m);font-size:10px;color:var(--text3);display:grid;grid-template-columns:50px repeat(6,1fr);gap:4px;padding:4px 0;border-bottom:1px solid var(--border);margin-bottom:4px">
          <span>Year</span><span style="text-align:center">IP</span><span style="text-align:center">H</span><span style="text-align:center">HR</span><span style="text-align:center">BB</span><span style="text-align:center">K</span><span style="text-align:center">ERA</span>
        </div>
        ${vs.rows.map(r => `
        <div style="font-family:var(--font-m);font-size:11px;display:grid;grid-template-columns:50px repeat(6,1fr);gap:4px;padding:3px 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--text3)">${r.season}</span>
          <span style="text-align:center">${r.ip}</span>
          <span style="text-align:center">${r.h}</span>
          <span style="text-align:center;color:${r.hr === 0 ? 'var(--green)' : r.hr >= 3 ? 'var(--red)' : 'var(--text)'}">${r.hr}</span>
          <span style="text-align:center">${r.bb}</span>
          <span style="text-align:center">${r.k}</span>
          <span style="text-align:center">${r.era}</span>
        </div>`).join('')}
        <div style="font-family:var(--font-m);font-size:11px;font-weight:700;display:grid;grid-template-columns:50px repeat(6,1fr);gap:4px;padding:4px 0;margin-top:2px">
          <span style="color:var(--lime)">${vs.seasons}yr</span>
          <span style="text-align:center">${vs.totals.ip > 0 ? vs.totals.ip.toFixed(1) : '—'}</span>
          <span style="text-align:center">${vs.totals.h}</span>
          <span style="text-align:center;color:${vs.totals.hr === 0 ? 'var(--green)' : 'var(--text)'}">${vs.totals.hr}</span>
          <span style="text-align:center">${vs.totals.bb}</span>
          <span style="text-align:center">${vs.totals.k}</span>
          <span style="text-align:center">—</span>
        </div>
      </div>` : '';

    return `
      <div class="lhr-pitcher-card"${isLow ? ' style="border-color:var(--green);box-shadow:0 0 14px rgba(35,209,139,0.07)"' : ''}>
        <div class="lhr-pitcher-head">
          <div>
            <div class="lhr-pitcher-name">${esc(sp.name)}</div>
            <div class="lhr-pitcher-team" style="color:${color}">${esc(sp.team)}</div>
          </div>
          <span class="lhr-signal-badge ${isLow ? 'lhr-signal-badge--pass' : 'lhr-signal-badge--fail'}">${esc(sp.hr_per_9_label)}</span>
        </div>
        <div class="lhr-metrics-grid" style="grid-template-columns:1fr">
          <div class="lhr-metric${isLow ? ' lhr-metric--hit' : ''}">
            <span class="lhr-metric-val" style="font-size:22px">${sp.hr_per_9 != null ? sp.hr_per_9 : '—'}</span>
            <span class="lhr-metric-label">HR / 9 Inn</span>
          </div>
        </div>
        ${vsTeamHtml}
      </div>`;
  };

  // ── Hitter card with BvP + career vs team + season splits ──
  const hitterRow = (h, rank, pitcherTeam, pitcherName) => {
    const noHr = h.rank_no_hr;
    const barColor = noHr != null && noHr >= 97 ? 'var(--green)' : noHr != null && noHr >= 95 ? 'var(--lime)' : 'var(--text2)';
    const curr = h.current_season;
    const prev = h.prior_season;
    const vs = h.vs_team;
    const bvp = h.bvp;

    // BvP section — the primary data from Baseball Savant
    const bvpHtml = bvp && bvp.pa > 0 ? `
      <div class="lhr-vs-section" style="border-left:2px solid var(--lime);padding-left:10px">
        <div class="lhr-vs-label" style="color:var(--lime)">vs ${esc(pitcherName)} (Savant)</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px">
          <div style="text-align:center">
            <div style="font-family:var(--font-m);font-size:16px;font-weight:700;color:var(--text)">${bvp.pa}</div>
            <div style="font-family:var(--font-m);font-size:9px;color:var(--text3);text-transform:uppercase">PA</div>
          </div>
          <div style="text-align:center">
            <div style="font-family:var(--font-m);font-size:16px;font-weight:700;color:var(--text)">${bvp.hits}-${bvp.ab}</div>
            <div style="font-family:var(--font-m);font-size:9px;color:var(--text3);text-transform:uppercase">H-AB</div>
          </div>
          <div style="text-align:center">
            <div style="font-family:var(--font-m);font-size:16px;font-weight:700;color:${bvp.hr === 0 ? 'var(--green)' : bvp.hr >= 2 ? 'var(--red)' : 'var(--text)'}">${bvp.hr}</div>
            <div style="font-family:var(--font-m);font-size:9px;color:var(--text3);text-transform:uppercase">HR</div>
          </div>
          <div style="text-align:center">
            <div style="font-family:var(--font-m);font-size:16px;font-weight:700;color:var(--text)">${bvp.k}</div>
            <div style="font-family:var(--font-m);font-size:9px;color:var(--text3);text-transform:uppercase">K</div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px">
          <div style="text-align:center">
            <div style="font-family:var(--font-m);font-size:13px;font-weight:600;color:var(--text)">${bvp.avg > 0 ? (bvp.avg < 1 ? String(bvp.avg.toFixed(3)).substring(1) : bvp.avg.toFixed(3)) : '.000'}</div>
            <div style="font-family:var(--font-m);font-size:9px;color:var(--text3);text-transform:uppercase">AVG</div>
          </div>
          <div style="text-align:center">
            <div style="font-family:var(--font-m);font-size:13px;font-weight:600;color:var(--text)">${bvp.obp > 0 ? (bvp.obp < 1 ? String(bvp.obp.toFixed(3)).substring(1) : bvp.obp.toFixed(3)) : '.000'}</div>
            <div style="font-family:var(--font-m);font-size:9px;color:var(--text3);text-transform:uppercase">OBP</div>
          </div>
          <div style="text-align:center">
            <div style="font-family:var(--font-m);font-size:13px;font-weight:600;color:var(--text)">${bvp.slg > 0 ? (bvp.slg < 1 ? String(bvp.slg.toFixed(3)).substring(1) : bvp.slg.toFixed(3)) : '.000'}</div>
            <div style="font-family:var(--font-m);font-size:9px;color:var(--text3);text-transform:uppercase">SLG</div>
          </div>
          <div style="text-align:center">
            <div style="font-family:var(--font-m);font-size:13px;font-weight:600;color:var(--text)">${bvp.bb}</div>
            <div style="font-family:var(--font-m);font-size:9px;color:var(--text3);text-transform:uppercase">BB</div>
          </div>
        </div>
        ${bvp.lastFaced ? `<div style="font-family:var(--font-m);font-size:9px;color:var(--text3);margin-top:6px">Last faced: ${bvp.lastFaced} · ${bvp.gamesPlayed} game${bvp.gamesPlayed !== 1 ? 's' : ''}</div>` : ''}
      </div>` : bvp ? `
      <div class="lhr-vs-section" style="border-left:2px solid var(--border2);padding-left:10px">
        <div class="lhr-vs-label" style="color:var(--text3)">vs ${esc(pitcherName)}</div>
        <div style="font-family:var(--font-m);font-size:11px;color:var(--text3);margin-top:4px;font-style:italic">These two have never faced each other</div>
      </div>` : '';

    return `
      <div class="lhr-hitter-card">
        <div class="lhr-hitter-head">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="lhr-rank-badge">${rank}</span>
            <div>
              <div class="lhr-hitter-name">${esc(h.name)}</div>
              <span style="font-family:var(--font-m);font-size:10px;color:var(--text3)">Lineup #${esc(String(h.lineup_position))}</span>
            </div>
          </div>
          ${noHr != null ? `<span style="font-family:var(--font-m);font-size:16px;font-weight:700;color:${barColor}">${noHr}%</span>` : ''}
        </div>
        ${noHr != null ? `
        <div style="margin:8px 0 12px">
          <div style="background:var(--bg2);border-radius:6px;overflow:hidden;height:5px;position:relative">
            <div style="position:absolute;left:0;top:0;height:100%;width:${Math.min(noHr, 100)}%;background:${barColor};border-radius:6px"></div>
          </div>
        </div>` : ''}

        ${bvpHtml}

        ${vs ? `
        <div class="lhr-vs-section">
          <div class="lhr-vs-label">vs ${esc(pitcherTeam)} by Season</div>
          <div style="font-family:var(--font-m);font-size:10px;color:var(--text3);display:grid;grid-template-columns:50px repeat(5,1fr);gap:4px;padding:4px 0;border-bottom:1px solid var(--border);margin-bottom:4px">
            <span>Year</span><span style="text-align:center">H-AB</span><span style="text-align:center">HR</span><span style="text-align:center">RBI</span><span style="text-align:center">K</span><span style="text-align:center">AVG</span>
          </div>
          ${vs.rows.map(r => `
          <div style="font-family:var(--font-m);font-size:11px;display:grid;grid-template-columns:50px repeat(5,1fr);gap:4px;padding:3px 0;border-bottom:1px solid var(--border)">
            <span style="color:var(--text3)">${r.season}</span>
            <span style="text-align:center">${r.hits}-${r.ab}</span>
            <span style="text-align:center;color:${r.hr === 0 ? 'var(--green)' : 'var(--text)'}">${r.hr}</span>
            <span style="text-align:center">${r.rbi}</span>
            <span style="text-align:center">${r.k}</span>
            <span style="text-align:center">${r.avg.startsWith('0') ? r.avg.substring(1) : r.avg}</span>
          </div>`).join('')}
          <div style="font-family:var(--font-m);font-size:11px;font-weight:700;display:grid;grid-template-columns:50px repeat(5,1fr);gap:4px;padding:4px 0;margin-top:2px">
            <span style="color:var(--lime)">Total</span>
            <span style="text-align:center">${vs.totals.hits}-${vs.totals.ab}</span>
            <span style="text-align:center;color:${vs.totals.hr === 0 ? 'var(--green)' : 'var(--text)'}">${vs.totals.hr}</span>
            <span style="text-align:center">${vs.totals.rbi}</span>
            <span style="text-align:center">${vs.totals.k}</span>
            <span style="text-align:center">${vs.totals.avg.startsWith('0') ? vs.totals.avg.substring(1) : vs.totals.avg}</span>
          </div>
        </div>` : `
        <div class="lhr-vs-section">
          <div class="lhr-vs-label" style="color:var(--text3)">vs ${esc(pitcherTeam)}: No data</div>
        </div>`}

        <div class="lhr-season-splits">
          <div class="lhr-split-row">
            <span class="lhr-split-label">Current</span>
            <span class="lhr-split-stats">${curr ? `${curr.ab} AB · ${curr.hr} HR · <span style="color:${curr.no_hr_rate >= 95 ? 'var(--green)' : 'var(--text)'}">${curr.no_hr_rate}% No-HR</span>` : '—'}</span>
          </div>
          <div class="lhr-split-row">
            <span class="lhr-split-label">Prior</span>
            <span class="lhr-split-stats">${prev ? `${prev.ab} AB · ${prev.hr} HR · <span style="color:${prev.no_hr_rate >= 95 ? 'var(--green)' : 'var(--text)'}">${prev.no_hr_rate}% No-HR</span>` : '—'}</span>
          </div>
        </div>
      </div>`;
  };

  // ── Matchup sections ──
  const matchupsHtml = (data.matchups || []).map(m => {
    const isLow = m.hr_per_9_label === 'LOW';
    const hitters = m.hitters || [];

    if (m.note) {
      return `
        <div class="pe-section">
          <div class="pe-section-title">${esc(m.pitcher)} (${esc(m.pitcher_team)}) vs ${esc(m.opponent_team)} Lineup</div>
          <div class="lhr-verdict lhr-verdict--fail" style="margin-bottom:0">
            <span class="lhr-verdict-icon">&#x23F3;</span>
            <div>
              <div class="lhr-verdict-text">${esc(m.note)}</div>
            </div>
          </div>
        </div>`;
    }

    return `
      <div class="pe-section">
        <div class="pe-section-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
          <span>${esc(m.pitcher)} (${esc(m.pitcher_team)}) vs ${esc(m.opponent_team)} Lineup</span>
          <span class="lhr-signal-badge ${isLow ? 'lhr-signal-badge--pass' : 'lhr-signal-badge--fail'}" style="font-size:9px;padding:2px 8px">HR/9: ${m.hr_per_9 != null ? m.hr_per_9 : '—'}</span>
        </div>
        <div class="pe-hint" style="margin-bottom:12px">${m.bvp_available ? `BvP (Savant) · career vs ${esc(m.pitcher_team)} · season splits` : `Career vs ${esc(m.pitcher_team)} · season splits · BvP unavailable (lineup not confirmed)`}</div>
        <div class="lhr-hitters-grid">
          ${hitters.map((h, i) => hitterRow(h, i + 1, m.pitcher_team, m.pitcher)).join('')}
        </div>
      </div>`;
  }).join('');

  // ── Status pills ──
  const statusPill = (label, status) => `<span class="lhr-pill ${status === 'CONFIRMED' ? 'lhr-pill--confirmed' : 'lhr-pill--unconfirmed'}">${esc(label)}: ${esc(status)}</span>`;

  el.innerHTML = `
    <div class="pe-header">
      <div class="pe-title">Low HR Scanner</div>
      <div class="pe-subtitle">Batter vs Pitcher (Savant) + Pitcher HR/9 + career vs team + no-HR probability</div>
    </div>

    <div class="lhr-context-row">
      ${statusPill('Away Lineup', data.lineup_status?.away || '—')}
      ${statusPill('Home Lineup', data.lineup_status?.home || '—')}
    </div>

    <div class="pe-section">
      <div class="pe-section-title">Starting Pitchers — HR/9</div>
      <div class="pe-pitchers-grid">
        ${(data.starting_pitchers || []).map(sp => pitcherCard(sp)).join('')}
      </div>
    </div>

    ${matchupsHtml}
  `;
}
