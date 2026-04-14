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
    { pitcher: pitchers.away, hr9: awayHr9, lineup: lineups.home, lineupStatus: homeLineupStatus, team: gameInfo.awayAbbr, oppTeam: gameInfo.homeAbbr, pitcherTeamFull: gameInfo.awayFull },
    { pitcher: pitchers.home, hr9: homeHr9, lineup: lineups.away, lineupStatus: awayLineupStatus, team: gameInfo.homeAbbr, oppTeam: gameInfo.awayAbbr, pitcherTeamFull: gameInfo.homeFull },
  ];

  // ── Fetch BvP data from backend (Baseball Savant via PlayIQ server) ──
  let bvpData = null;
  try {
    const bvpUrl = `http://localhost:3001/api/mlb/game-bvp?away=${encodeURIComponent(gameInfo.awayFull)}&home=${encodeURIComponent(gameInfo.homeFull)}`;
    const bvpResp = await fetch(bvpUrl);
    if (bvpResp.ok) bvpData = await bvpResp.json();
  } catch { /* backend not running — continue without BvP */ }

  // Build a name→bvp lookup from backend data
  function buildBvpLookup(bvpMatchups, pitcherName) {
    if (!bvpMatchups?.length) return {};
    const m = bvpMatchups.find(mu =>
      normalizePlayerName(mu.pitcher?.name).includes(normalizePlayerName(pitcherName).split(' ').pop())
    );
    if (!m?.batters?.length) return {};
    const lookup = {};
    for (const b of m.batters) {
      lookup[normalizePlayerName(b.name)] = b.bvp;
    }
    return lookup;
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

    // Build BvP lookup for this side's pitcher
    const bvpLookup = buildBvpLookup(bvpData?.matchups, side.pitcher.name);

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

      // Match BvP from Savant backend
      const bvp = bvpLookup[normalizePlayerName(batter.name)] || null;

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
      pitcher: side.pitcher.name,
      pitcher_team: side.team,
      hr_per_9: side.hr9 != null ? Number(side.hr9.toFixed(3)) : null,
      hr_per_9_label: side.hr9 != null ? (side.hr9 <= 1.0 ? 'LOW' : 'ELEVATED') : 'N/A',
      opponent_team: side.oppTeam,
      lineup_status: side.lineupStatus,
      hitters,
    });
  }

  return result;
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
      <div class="lhr-vs-section" style="border-left:2px solid var(--border);padding-left:10px">
        <div class="lhr-vs-label" style="color:var(--text3)">vs ${esc(pitcherName)}: No matchup history</div>
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
        <div class="pe-hint" style="margin-bottom:12px">Batters ranked by no-HR probability. BvP from Baseball Savant + career vs ${esc(m.pitcher_team)} + season splits.</div>
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
