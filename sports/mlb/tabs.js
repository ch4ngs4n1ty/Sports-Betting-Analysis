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
