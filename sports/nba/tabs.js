/* ── NBA TABS ───────────────────────────────────────────────
   NBA-specific tab fetch/render logic.

   Depends on shared helpers from app.js:
   - espn(), getSeasonYear(), SPORTS, S
─────────────────────────────────────────────────────────── */
/* ═══════════════════════════════════════════════════════════
   LINEUPS FETCH (NBA ONLY)
   Uses ESPN depthcharts endpoint — first player per position
   is the starter.
═══════════════════════════════════════════════════════════ */
async function fetchLineups(sportKey, teamId) {
  const sp = SPORTS.find(s => s.key === sportKey);
  if (!sp) return [];
  const data = await espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/depthcharts`);

  const charts = data?.depthchart || data?.items || [];
  if (!charts.length) return [];

  const posOrder = ['pg', 'sg', 'sf', 'pf', 'c'];
  const posLabels = { pg: 'PG', sg: 'SG', sf: 'SF', pf: 'PF', c: 'C' };
  const starters = [];

  for (const chart of charts) {
    const positions = chart.positions || {};
    for (const posKey of posOrder) {
      const pos = positions[posKey];
      if (!pos?.athletes?.length) continue;
      const a = pos.athletes[0];
      if (a.id && !starters.find(s => s.athleteId === a.id)) {
        starters.push({
          athleteId: a.id,
          name: a.displayName || 'Unknown',
          shortName: a.shortName || a.displayName?.split(' ').pop() || '?',
          pos: posLabels[posKey] || posKey.toUpperCase(),
          jersey: a.jersey || '—',
          headshotUrl: `https://a.espncdn.com/i/headshots/${sp.league}/players/full/${a.id}.png`,
        });
      }
    }
    if (starters.length >= 5) break;
  }

  return starters;
}

/* ── PLAYER SEASON STATS (NBA) ─────────────────────────── */
async function fetchPlayerSeasonStats(athleteId) {
  const data = await espn(
    `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${athleteId}/stats?region=us&lang=en&contentorigin=espn`
  );
  if (!data?.categories) return null;

  const avgCat = data.categories.find(c => c.name === 'averages');
  if (!avgCat?.names?.length || !avgCat?.statistics?.length) return null;

  const currentSeason = avgCat.statistics.reduce((best, entry) =>
    (!best || (entry.season?.year || 0) > (best.season?.year || 0)) ? entry : best
  , null);
  if (!currentSeason?.stats?.length) return null;

  const stats = {};
  avgCat.names.forEach((name, i) => {
    const raw = currentSeason.stats[i];
    const val = parseFloat(raw);
    if (!isNaN(val)) stats[name] = val;
  });

  stats._gp = stats.gamesPlayed || 0;
  return Object.keys(stats).length > 1 ? stats : null;
}

async function enrichLineupsWithStats(lineup) {
  if (!lineup?.length) return lineup;
  const results = await Promise.all(
    lineup.map(p => fetchPlayerSeasonStats(p.athleteId))
  );
  return lineup.map((p, i) => ({ ...p, stats: results[i] }));
}

/* ── H2H PLAYER STATS (from boxscores) ────────────────────
   Extracts per-player stats from H2H game summaries.
   Only counts games where BOTH players in a position matchup
   actually played — so the GP count matches and it's a true
   head-to-head comparison.
   ────────────────────────────────────────────────────────── */
const H2H_STAT_MAP = {
  'MIN': 'avgMinutes', 'PTS': 'avgPoints', 'REB': 'avgRebounds',
  'AST': 'avgAssists', 'STL': 'avgSteals', 'BLK': 'avgBlocks',
  'TO': 'avgTurnovers', 'FG%': 'fieldGoalPct',
};
const H2H_LABELS = Object.keys(H2H_STAT_MAP);

function playerPlayedInGame(summary, athleteId) {
  if (!summary?.boxscore?.players || !athleteId) return false;
  for (const teamData of summary.boxscore.players) {
    for (const grp of teamData.statistics || []) {
      const ath = grp.athletes?.find(a => a.athlete?.id == athleteId);
      if (!ath) continue;
      if (ath.didNotPlay || !ath.stats?.length || ath.stats?.[0] === 'DNP' || ath.stats?.[0] === '0:00') return false;
      return true;
    }
  }
  return false;
}

function extractPlayerGameStats(summary, athleteId) {
  if (!summary?.boxscore?.players || !athleteId) return null;
  for (const teamData of summary.boxscore.players) {
    for (const grp of teamData.statistics || []) {
      const lbls = grp.labels || [];
      const ath = grp.athletes?.find(a => a.athlete?.id == athleteId);
      if (!ath) continue;
      if (ath.didNotPlay || !ath.stats?.length || ath.stats?.[0] === 'DNP' || ath.stats?.[0] === '0:00') return null;
      const game = {};
      H2H_LABELS.forEach(lbl => {
        const idx = lbls.indexOf(lbl);
        if (idx > -1 && ath.stats[idx] != null) {
          const val = parseFloat(String(ath.stats[idx]));
          if (!isNaN(val)) game[H2H_STAT_MAP[lbl]] = val;
        }
      });
      return Object.keys(game).length > 0 ? game : null;
    }
  }
  return null;
}

function averageStats(gameStats) {
  if (!gameStats.length) return null;
  const avg = {};
  const allKeys = new Set(gameStats.flatMap(g => Object.keys(g)));
  allKeys.forEach(key => {
    const vals = gameStats.map(g => g[key]).filter(v => v != null);
    if (vals.length) avg[key] = vals.reduce((a, b) => a + b, 0) / vals.length;
  });
  avg._gp = gameStats.length;
  return avg;
}

function enrichLineupsWithH2HStats(awayLineup, homeLineup, summaries) {
  if (!summaries?.length) return { away: awayLineup, home: homeLineup };
  const posOrder = ['PG', 'SG', 'SF', 'PF', 'C'];

  const enrichedAway = awayLineup.map(p => ({ ...p }));
  const enrichedHome = homeLineup.map(p => ({ ...p }));

  for (const pos of posOrder) {
    const awayP = enrichedAway.find(p => p.pos === pos);
    const homeP = enrichedHome.find(p => p.pos === pos);
    if (!awayP || !homeP) continue;

    const sharedGames = summaries.filter(s =>
      playerPlayedInGame(s, awayP.athleteId) && playerPlayedInGame(s, homeP.athleteId)
    );

    if (!sharedGames.length) continue;

    const awayGameStats = sharedGames.map(s => extractPlayerGameStats(s, awayP.athleteId)).filter(Boolean);
    const homeGameStats = sharedGames.map(s => extractPlayerGameStats(s, homeP.athleteId)).filter(Boolean);

    awayP.stats = averageStats(awayGameStats);
    homeP.stats = averageStats(homeGameStats);
  }

  return { away: enrichedAway, home: enrichedHome };
}

/* ═══════════════════════════════════════════════════════════
   EDGE FINDER (NBA ONLY)
   Compares H2H player performance vs season averages to
   identify prop betting edges. Analyzes positional defense
   from H2H boxscores and surfaces top picks per team.
═══════════════════════════════════════════════════════════ */

const EDGE_STAT_MAP = {
  'MIN': 'avgMinutes', 'PTS': 'avgPoints', 'REB': 'avgRebounds',
  'AST': 'avgAssists', 'STL': 'avgSteals', 'BLK': 'avgBlocks',
  'TO': 'avgTurnovers', 'FG%': 'fieldGoalPct',
};

const EDGE_DISPLAY_STATS = [
  { key: 'avgPoints',    label: 'PTS', boxLabel: 'PTS', higher: true },
  { key: 'avgRebounds',  label: 'REB', boxLabel: 'REB', higher: true },
  { key: 'avgAssists',   label: 'AST', boxLabel: 'AST', higher: true },
  { key: 'avgSteals',    label: 'STL', boxLabel: 'STL', higher: true },
  { key: 'avgBlocks',    label: 'BLK', boxLabel: 'BLK', higher: true },
  { key: 'avg3PM',       label: '3PM', boxLabel: null,  higher: true },
];

const SEASON_KEY_MAP = {
  'avgPoints': 'avgPoints',
  'avgRebounds': 'avgRebounds',
  'avgAssists': 'avgAssists',
  'avgSteals': 'avgSteals',
  'avgBlocks': 'avgBlocks',
  'avg3PM': 'threePointFieldGoalsMade',
};

function extractAllH2HPlayers(summaries, teamId) {
  if (!summaries?.length) return [];
  const playerMap = new Map();

  for (const summary of summaries) {
    if (!summary?.boxscore?.players) continue;
    const teamData = summary.boxscore.players.find(p => String(p.team?.id) === String(teamId));
    if (!teamData) continue;

    for (const grp of teamData.statistics || []) {
      const lbls = grp.labels || [];
      for (const ath of grp.athletes || []) {
        const id = ath.athlete?.id;
        if (!id || ath.didNotPlay || !ath.stats?.length || ath.stats?.[0] === 'DNP' || ath.stats?.[0] === '0:00') continue;

        if (!playerMap.has(id)) {
          playerMap.set(id, {
            athleteId: id,
            name: ath.athlete?.displayName || ath.athlete?.shortName || '?',
            shortName: ath.athlete?.shortName || ath.athlete?.displayName?.split(' ').pop() || '?',
            headshotUrl: `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`,
            gameStats: [],
          });
        }

        const game = {};
        lbls.forEach((lbl, idx) => {
          if (EDGE_STAT_MAP[lbl] && ath.stats[idx] != null) {
            const val = parseFloat(String(ath.stats[idx]));
            if (!isNaN(val)) game[EDGE_STAT_MAP[lbl]] = val;
          }
        });
        const threeLbl = ['3PM', '3PT', 'FG3M'].find(l => lbls.includes(l));
        if (threeLbl) {
          const idx = lbls.indexOf(threeLbl);
          const val = parseFloat(String(ath.stats[idx]));
          if (!isNaN(val)) game['avg3PM'] = val;
        }

        if (Object.keys(game).length > 0) {
          playerMap.get(id).gameStats.push(game);
        }
      }
    }
  }
  return Array.from(playerMap.values());
}

function normalizePosition(pos) {
  if (!pos) return null;
  const p = pos.toUpperCase().trim();
  if (['PG', 'SG', 'SF', 'PF', 'C'].includes(p)) return p;
  if (p.includes('-')) {
    const first = p.split('-')[0];
    if (['PG', 'SG', 'SF', 'PF', 'C'].includes(first)) return first;
  }
  if (p === 'G') return 'SG';
  if (p === 'F') return 'SF';
  if (p === 'G-F' || p === 'GF') return 'SG';
  if (p === 'F-G' || p === 'FG') return 'SF';
  if (p === 'F-C' || p === 'FC') return 'PF';
  if (p === 'C-F' || p === 'CF') return 'C';
  return null;
}

async function fetchFullDepthChart(sportKey, teamId) {
  const sp = SPORTS.find(s => s.key === sportKey);
  if (!sp) return [];
  const data = await espn(`https://site.api.espn.com/apis/site/v2/sports/${sp.sport}/${sp.league}/teams/${teamId}/depthcharts`);
  const charts = data?.depthchart || data?.items || [];
  if (!charts.length) return [];

  const posOrder = ['pg', 'sg', 'sf', 'pf', 'c'];
  const posLabels = { pg: 'PG', sg: 'SG', sf: 'SF', pf: 'PF', c: 'C' };
  const players = [];

  for (const chart of charts) {
    const positions = chart.positions || {};
    for (const posKey of posOrder) {
      const pos = positions[posKey];
      if (!pos?.athletes?.length) continue;
      for (const a of pos.athletes) {
        if (a.id && !players.find(p => p.athleteId === a.id)) {
          players.push({ athleteId: a.id, pos: posLabels[posKey] || posKey.toUpperCase() });
        }
      }
    }
  }
  return players;
}

function buildPositionMap(depthChart) {
  const map = new Map();
  for (const p of depthChart || []) {
    if (p.athleteId && p.pos) map.set(String(p.athleteId), p.pos);
  }
  return map;
}

function computePositionalDefense(summaries, defendingTeamId, attackingRosterPosMap, currentRosterIds) {
  const posData = {};
  const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
  positions.forEach(p => { posData[p] = { totalPts: 0, games: 0 }; });

  const playerMap = new Map();

  for (const summary of summaries || []) {
    if (!summary?.boxscore?.players) continue;
    const attackingData = summary.boxscore.players.find(p => String(p.team?.id) !== String(defendingTeamId));
    if (!attackingData) continue;

    const gamePosPts = {};
    positions.forEach(p => { gamePosPts[p] = 0; });
    let hasData = false;

    for (const grp of attackingData.statistics || []) {
      const lbls = grp.labels || [];
      const ptsIdx = lbls.indexOf('PTS');
      if (ptsIdx === -1) continue;

      for (const ath of grp.athletes || []) {
        const id = ath.athlete?.id;
        if (!id || ath.didNotPlay) continue;
        if (currentRosterIds && !currentRosterIds.has(String(id))) continue;
        const pos = attackingRosterPosMap.get(String(id));
        if (!pos || !posData[pos]) continue;
        const pts = parseFloat(String(ath.stats?.[ptsIdx])) || 0;
        gamePosPts[pos] += pts;
        hasData = true;

        if (!playerMap.has(id)) {
          playerMap.set(id, {
            athleteId: id,
            name: ath.athlete?.displayName || ath.athlete?.shortName || '?',
            shortName: ath.athlete?.shortName || ath.athlete?.displayName?.split(' ').pop() || '?',
            pos,
            totalPts: 0, gp: 0,
            headshotUrl: `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`,
          });
        }
        const p = playerMap.get(id);
        p.totalPts += pts;
        p.gp++;
      }
    }

    if (hasData) {
      positions.forEach(p => {
        posData[p].totalPts += gamePosPts[p];
        posData[p].games++;
      });
    }
  }

  let weakest = null, maxAvg = -1;
  positions.forEach(p => {
    posData[p].avg = posData[p].games > 0 ? posData[p].totalPts / posData[p].games : 0;
    if (posData[p].avg > maxAvg) { maxAvg = posData[p].avg; weakest = p; }
  });

  const playersByPos = {};
  positions.forEach(pos => {
    playersByPos[pos] = Array.from(playerMap.values())
      .filter(p => p.pos === pos && p.gp > 0)
      .map(p => ({ ...p, avg: p.totalPts / p.gp }))
      .sort((a, b) => b.avg - a.avg);
  });

  return { positions: posData, weakest, playersByPos };
}

async function batchFetchSeasonStats(players, batchSize = 8) {
  const results = new Map();
  for (let i = 0; i < players.length; i += batchSize) {
    const batch = players.slice(i, i + batchSize);
    const stats = await Promise.all(
      batch.map(p => fetchPlayerSeasonStats(p.athleteId))
    );
    batch.forEach((p, j) => { if (stats[j]) results.set(String(p.athleteId), stats[j]); });
  }
  return results;
}

function computePlayerEdges(players, seasonStatsMap, positionMap, starterIds) {
  return players.map(p => {
    const h2hAvg = averageStats(p.gameStats);
    if (!h2hAvg) return null;

    const seasonStats = seasonStatsMap.get(String(p.athleteId));
    const pos = positionMap.get(String(p.athleteId)) || '—';
    const isStarter = starterIds.has(String(p.athleteId));

    const edges = {};
    let bestEdge = { stat: null, value: 0 };

    EDGE_DISPLAY_STATS.forEach(cfg => {
      const h2hVal = h2hAvg[cfg.key];
      const seasonKey = SEASON_KEY_MAP[cfg.key];
      const seasonVal = seasonStats?.[seasonKey];
      const edge = (h2hVal != null && seasonVal != null) ? h2hVal - seasonVal : null;

      edges[cfg.key] = { h2h: h2hVal, season: seasonVal, edge };

      if (edge != null && cfg.higher && edge > bestEdge.value) {
        bestEdge = { stat: cfg.label, value: edge, key: cfg.key };
      }
    });

    const rating = bestEdge.value >= 3 ? 'STRONG' : bestEdge.value >= 1.5 ? 'NOTABLE' : null;

    return {
      ...p,
      pos, isStarter, h2hAvg, seasonStats,
      gp: p.gameStats.length,
      avgMinutes: h2hAvg.avgMinutes || 0,
      edges, bestEdge, rating,
    };
  }).filter(Boolean);
}

async function buildEdgeFinderData(gameData) {
  const { gameInfo, h2hSummaries, h2hDates, awayRoster, homeRoster, awayLineup, homeLineup, injuries } = gameData;
  if (!h2hSummaries?.length) return null;

  const currentSeason = getSeasonYear(gameInfo.sportKey);
  const seasonStart = new Date(currentSeason - 1, 9, 1);
  const currentSummaries = h2hSummaries.filter((_, i) => {
    const d = h2hDates?.[i];
    return d && d >= seasonStart;
  });
  if (!currentSummaries.length) return null;

  const awayPlayers = extractAllH2HPlayers(currentSummaries, gameInfo.awayTeamId);
  const homePlayers = extractAllH2HPlayers(currentSummaries, gameInfo.homeTeamId);

  const [awayDepth, homeDepth] = await Promise.all([
    fetchFullDepthChart(gameInfo.sportKey, gameInfo.awayTeamId),
    fetchFullDepthChart(gameInfo.sportKey, gameInfo.homeTeamId),
  ]);
  const awayPosMap = buildPositionMap(awayDepth);
  const homePosMap = buildPositionMap(homeDepth);

  const awayRosterIds = new Set((awayRoster || []).map(p => String(p.id)));
  const homeRosterIds = new Set((homeRoster || []).map(p => String(p.id)));

  const filterPlayers = (players, rosterIds) => players.filter(p => {
    if (!rosterIds.has(String(p.athleteId))) return false;
    const avg = p.gameStats.reduce((sum, g) => sum + (g.avgMinutes || 0), 0) / (p.gameStats.length || 1);
    return avg >= 15;
  });
  const filteredAway = filterPlayers(awayPlayers, awayRosterIds);
  const filteredHome = filterPlayers(homePlayers, homeRosterIds);
  const allFiltered = [...filteredAway, ...filteredHome];

  const seasonStatsMap = await batchFetchSeasonStats(allFiltered);

  const awayStarterIds = new Set((awayLineup || []).map(p => String(p.athleteId)));
  const homeStarterIds = new Set((homeLineup || []).map(p => String(p.athleteId)));

  const awayEdges = computePlayerEdges(filteredAway, seasonStatsMap, awayPosMap, awayStarterIds);
  const homeEdges = computePlayerEdges(filteredHome, seasonStatsMap, homePosMap, homeStarterIds);

  const awayDefense = computePositionalDefense(currentSummaries, gameInfo.awayTeamId, homePosMap, homeRosterIds);
  const homeDefense = computePositionalDefense(currentSummaries, gameInfo.homeTeamId, awayPosMap, awayRosterIds);

  const findTopProp = (edges, teamAbbr, opponentDefense, teamInjuries) => {
    let best = null;
    for (const p of edges) {
      if (!p.bestEdge.stat || p.bestEdge.value < 1.5) continue;
      const inj = teamInjuries?.find(i => String(i.athleteId) === String(p.athleteId));
      if (inj && /out/i.test(inj.status)) continue;

      const posDefense = opponentDefense?.positions?.[p.pos];
      const injNote = inj ? `${inj.status}` : null;

      if (!best || p.bestEdge.value > best.edge) {
        best = {
          player: p.name, team: teamAbbr, pos: p.pos,
          stat: p.bestEdge.stat, statKey: p.bestEdge.key,
          seasonAvg: p.edges[p.bestEdge.key]?.season,
          h2hAvg: p.edges[p.bestEdge.key]?.h2h,
          edge: p.bestEdge.value,
          rating: p.rating,
          posDefAvg: posDefense?.avg,
          posDefWeakest: opponentDefense?.weakest === p.pos,
          injuryNote: injNote,
          headshot: p.headshotUrl,
          gp: p.gp,
        };
      }
    }
    return best;
  };

  const awayTopProp = findTopProp(awayEdges, gameInfo.awayAbbr, homeDefense, injuries?.away);
  const homeTopProp = findTopProp(homeEdges, gameInfo.homeAbbr, awayDefense, injuries?.home);

  return {
    awayEdges, homeEdges,
    awayDefense, homeDefense,
    awayTopProp, homeTopProp,
    h2hGames: currentSummaries.length,
  };
}

/* ── LINEUPS RENDER (NBA ONLY) ─────────────────────────── */
function renderLineups({ gameInfo, awayLineup, homeLineup, injuries, lineupStatsType }) {
  const el = document.getElementById('lineupsContent');
  if (!el) return;

  if (!awayLineup?.length && !homeLineup?.length) {
    el.innerHTML = `<div class="lu-empty">Lineup data not available for this game.</div>`;
    return;
  }

  const posOrder = ['PG', 'SG', 'SF', 'PF', 'C'];

  const matchupStats = [
    { key: 'avgPoints',      label: 'PTS',  higher: true },
    { key: 'avgRebounds',    label: 'REB',  higher: true },
    { key: 'avgAssists',     label: 'AST',  higher: true },
    { key: 'fieldGoalPct',   label: 'FG%',  higher: true, pct: true },
    { key: 'avgSteals',      label: 'STL',  higher: true },
    { key: 'avgBlocks',      label: 'BLK',  higher: true },
    { key: 'avgMinutes',     label: 'MIN',  higher: true },
    { key: 'avgTurnovers',   label: 'TO',   higher: false },
  ];

  const injStatus = (name) => {
    const allInj = [...(injuries?.away || []), ...(injuries?.home || [])];
    const match = allInj.find(i => i.name === name);
    if (!match || /^active$/i.test(match.status)) return null;
    return match.status;
  };
  const injColor = (s) => {
    if (!s) return '';
    if (/out/i.test(s)) return 'var(--red)';
    if (/doubtful/i.test(s)) return 'var(--orange)';
    return 'var(--yellow)';
  };

  const getEdge = (aVal, hVal, higherBetter) => {
    if (aVal == null || hVal == null) return 'even';
    const diff = Math.abs(aVal - hVal);
    const threshold = Math.max(aVal, hVal) * 0.05;
    if (diff < threshold) return 'even';
    if (higherBetter) return aVal > hVal ? 'away' : 'home';
    return aVal < hVal ? 'away' : 'home';
  };

  const statBar = (aStat, hStat, cfg) => {
    const aVal = aStat?.stats?.[cfg.key];
    const hVal = hStat?.stats?.[cfg.key];
    if (aVal == null && hVal == null) return '';
    const aStr = aVal != null ? (cfg.pct ? aVal.toFixed(1) + '%' : aVal.toFixed(1)) : '—';
    const hStr = hVal != null ? (cfg.pct ? hVal.toFixed(1) + '%' : hVal.toFixed(1)) : '—';
    const edge = getEdge(aVal, hVal, cfg.higher);
    const aColor = edge === 'away' ? 'var(--green)' : edge === 'home' ? 'var(--red)' : 'var(--text2)';
    const hColor = edge === 'home' ? 'var(--green)' : edge === 'away' ? 'var(--red)' : 'var(--text2)';
    return `
      <div class="lu-stat-row">
        <span class="lu-stat-val" style="color:${aColor}">${aStr}</span>
        <span class="lu-stat-label">${cfg.label}</span>
        <span class="lu-stat-val" style="color:${hColor}">${hStr}</span>
      </div>`;
  };

  const overallEdge = (away, home) => {
    if (!away?.stats || !home?.stats) return { label: '—', color: 'var(--text3)', awayWins: 0, homeWins: 0 };
    let awayWins = 0, homeWins = 0;
    matchupStats.forEach(cfg => {
      const edge = getEdge(away.stats[cfg.key], home.stats[cfg.key], cfg.higher);
      if (edge === 'away') awayWins++;
      if (edge === 'home') homeWins++;
    });
    return { awayWins, homeWins };
  };

  const matchupRows = posOrder.map(pos => {
    const away = awayLineup.find(p => p.pos === pos);
    const home = homeLineup.find(p => p.pos === pos);
    const hasStats = away?.stats || home?.stats;
    const edge = overallEdge(away, home);

    const playerSide = (p, color, align) => {
      if (!p) return `<div class="lu-player-side"><div class="lu-player-empty">—</div></div>`;
      const inj = injStatus(p.name);
      const injBadge = inj ? `<span class="lu-inj-badge" style="color:${injColor(inj)};border-color:${injColor(inj)}">${inj}</span>` : '';
      const gpLabel = lineupStatsType === 'h2h' ? 'H2H' : 'GP';
      const gp = p.stats?._gp ? `<span class="lu-gp">${p.stats._gp} ${gpLabel}</span>` : '';
      return `
        <div class="lu-player-side ${align}">
          <div class="lu-hs-wrap" style="border-color:${color}">
            <img class="lu-hs" src="${p.headshotUrl}" alt="${p.name}" onerror="this.style.display='none'">
          </div>
          <div class="lu-player-info">
            <span class="lu-p-name">${p.name}</span>
            <span class="lu-p-meta">#${p.jersey} ${gp}${injBadge}</span>
          </div>
        </div>`;
    };

    const edgeIndicator = hasStats ? (() => {
      const total = edge.awayWins + edge.homeWins;
      if (!total) return '<div class="lu-edge-badge lu-edge-even">EVEN</div>';
      if (edge.awayWins > edge.homeWins) return `<div class="lu-edge-badge lu-edge-away">${gameInfo.awayAbbr} +${edge.awayWins - edge.homeWins}</div>`;
      if (edge.homeWins > edge.awayWins) return `<div class="lu-edge-badge lu-edge-home">${gameInfo.homeAbbr} +${edge.homeWins - edge.awayWins}</div>`;
      return '<div class="lu-edge-badge lu-edge-even">EVEN</div>';
    })() : '';

    const statBars = hasStats ? matchupStats.map(cfg => statBar(away, home, cfg)).join('') : '';

    return `
      <div class="lu-matchup-row${hasStats ? ' lu-matchup-clickable' : ''}"${hasStats ? ' onclick="this.classList.toggle(\'lu-matchup-expanded\')"' : ''}>
        <div class="lu-matchup-header">
          ${playerSide(away, 'var(--blue)', 'lu-align-left')}
          <div class="lu-pos-col">
            <div class="lu-pos-badge">${pos}</div>
            ${edgeIndicator}
          </div>
          ${playerSide(home, 'var(--lime)', 'lu-align-right')}
          ${hasStats ? '<span class="lu-expand-chevron">›</span>' : ''}
        </div>
        ${hasStats ? `<div class="lu-matchup-stats">${statBars}</div>` : ''}
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="lu-header">
      <div class="lu-title">Starting Lineups</div>
      <div class="lu-subtitle">Projected starters · ESPN depth charts · ${lineupStatsType === 'h2h' ? 'Head-to-head averages' : 'Season averages'}</div>
    </div>

    <!-- Team headers -->
    <div class="lu-teams-header">
      <div class="lu-th-side">
        ${gameInfo.awayLogo ? `<img class="lu-th-logo" src="${gameInfo.awayLogo}" alt="${gameInfo.awayAbbr}" onerror="this.style.display='none'">` : ''}
        <span class="lu-th-name" style="color:var(--blue)">${gameInfo.awayAbbr}</span>
      </div>
      <div class="lu-th-vs">VS</div>
      <div class="lu-th-side lu-th-right">
        <span class="lu-th-name" style="color:var(--lime)">${gameInfo.homeAbbr}</span>
        ${gameInfo.homeLogo ? `<img class="lu-th-logo" src="${gameInfo.homeLogo}" alt="${gameInfo.homeAbbr}" onerror="this.style.display='none'">` : ''}
      </div>
    </div>

    <!-- Matchups -->
    <div class="lu-matchups">
      ${matchupRows}
    </div>`;
}

/* ── EDGE FINDER RENDER (NBA ONLY) ────────────────────── */
function renderEdgeFinder(edgeData, gameData) {
  const el = document.getElementById('edgesContent');
  if (!el) return;
  const { gameInfo, injuries } = gameData;

  if (!edgeData) {
    el.innerHTML = `<div class="ef-empty">No head-to-head games found between ${gameInfo.awayAbbr} and ${gameInfo.homeAbbr}.<br>Edge analysis requires H2H game data.</div>`;
    return;
  }

  const { awayEdges, homeEdges, awayDefense, homeDefense, awayTopProp, homeTopProp, h2hGames } = edgeData;

  const renderTopProp = (prop) => {
    if (!prop) return '<div class="ef-no-pick">No clear edge found</div>';
    const edgeSign = prop.edge > 0 ? '+' : '';
    const ratingClass = prop.rating === 'STRONG' ? 'ef-badge-strong' : 'ef-badge-notable';
    return `
      <div class="ef-top-prop">
        <div class="ef-top-prop-player">
          <img class="ef-top-hs" src="${prop.headshot}" alt="${prop.player}" onerror="this.style.display='none'">
          <div class="ef-top-info">
            <span class="ef-top-name">${prop.player}</span>
            <span class="ef-top-meta">${prop.team} · ${prop.pos} · ${prop.gp} H2H</span>
          </div>
          <span class="${ratingClass}">${prop.rating}</span>
        </div>
        <div class="ef-top-prop-stats">
          <div class="ef-top-stat-col">
            <span class="ef-top-stat-label">Prop</span>
            <span class="ef-top-stat-val">${prop.stat} Over</span>
          </div>
          <div class="ef-top-stat-col">
            <span class="ef-top-stat-label">Season</span>
            <span class="ef-top-stat-val">${prop.seasonAvg?.toFixed(1) ?? '—'}</span>
          </div>
          <div class="ef-top-stat-col">
            <span class="ef-top-stat-label">H2H Avg</span>
            <span class="ef-top-stat-val" style="color:var(--green)">${prop.h2hAvg?.toFixed(1) ?? '—'}</span>
          </div>
          <div class="ef-top-stat-col">
            <span class="ef-top-stat-label">Edge</span>
            <span class="ef-top-stat-val ef-edge-pos">${edgeSign}${prop.edge.toFixed(1)}</span>
          </div>
          ${prop.posDefWeakest ? `<div class="ef-top-stat-col"><span class="ef-top-stat-label">Pos Def</span><span class="ef-top-stat-val" style="color:var(--red)">WEAK</span><span class="ef-top-stat-hint">Opponent's weakest defensive position</span></div>` : ''}
        </div>
        ${prop.injuryNote ? `<div class="ef-top-injury">⚠ ${prop.injuryNote}</div>` : ''}
      </div>`;
  };

  const renderPosDefense = (defense, teamAbbr, teamColor) => {
    if (!defense?.positions) return '';
    const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
    return `
      <div class="ef-def-card">
        <div class="ef-def-title">How <span style="color:${teamColor}">${teamAbbr}</span> defends by position</div>
        <div class="ef-def-subtitle">Avg points allowed to each position in ${h2hGames} H2H game${h2hGames > 1 ? 's' : ''}</div>
        <div class="ef-def-hint">Higher = more points given up · WEAKEST = most exploitable position</div>
        ${positions.map(pos => {
          const d = defense.positions[pos];
          const isWeak = defense.weakest === pos;
          const players = defense.playersByPos?.[pos] || [];
          return `
            <div class="ef-pos-group">
              <div class="ef-pos-row ${isWeak ? 'ef-pos-weak' : ''}">
                <span class="ef-pos-label">${pos}</span>
                <div class="ef-pos-bar-wrap">
                  <div class="ef-pos-bar" style="width:${Math.min(100, (d.avg / 35) * 100)}%;background:${isWeak ? 'var(--red)' : 'var(--text3)'}"></div>
                </div>
                <span class="ef-pos-val ${isWeak ? 'ef-pos-val-weak' : ''}">${d.avg.toFixed(1)}</span>
                ${isWeak ? '<span class="ef-weak-tag">WEAKEST</span>' : ''}
              </div>
              ${players.length ? `
                <div class="ef-pos-players">
                  ${players.map((p, i) => `
                    <div class="ef-pos-player ${i === 0 && isWeak ? 'ef-pos-player-top' : ''}">
                      <img class="ef-pos-player-hs" src="${p.headshotUrl}" alt="${p.shortName}" onerror="this.style.display='none'">
                      <span class="ef-pos-player-name">${p.shortName}</span>
                      <span class="ef-pos-player-avg ${i === 0 && isWeak ? 'ef-pos-player-avg-top' : ''}">${p.avg.toFixed(1)}</span>
                      <span class="ef-pos-player-gp">${p.gp}g</span>
                    </div>`).join('')}
                </div>` : ''}
            </div>`;
        }).join('')}
      </div>`;
  };

  const allEdges = [
    ...awayEdges.map(p => ({ ...p, teamAbbr: gameInfo.awayAbbr, teamColor: 'var(--blue)', teamId: gameInfo.awayTeamId })),
    ...homeEdges.map(p => ({ ...p, teamAbbr: gameInfo.homeAbbr, teamColor: 'var(--lime)', teamId: gameInfo.homeTeamId })),
  ].sort((a, b) => (b.bestEdge.value || 0) - (a.bestEdge.value || 0));

  const edgeColor = (val) => {
    if (val == null) return '';
    if (val >= 3) return 'ef-edge-pos';
    if (val <= -3) return 'ef-edge-neg';
    if (val >= 1.5) return 'ef-edge-mild-pos';
    if (val <= -1.5) return 'ef-edge-mild-neg';
    return '';
  };
  const fmtEdge = (val) => {
    if (val == null) return '—';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(1)}`;
  };
  const fmtVal = (val) => val != null ? val.toFixed(1) : '—';

  // Store for click handler access
  S._edgeAllPlayers = allEdges;

  const colCount = 3 + EDGE_DISPLAY_STATS.length; // player + GP + stats + rating

  const playerRows = allEdges.map((p, idx) => `
    <tr class="ef-row-clickable ${p.isStarter ? 'ef-starter' : ''}" onclick="toggleEdgeDetail(${idx}, ${colCount})">
      <td class="ef-player-cell">
        <img class="ef-row-hs" src="${p.headshotUrl}" alt="${p.shortName}" onerror="this.style.display='none'">
        <div class="ef-row-info">
          <span class="ef-row-name">${p.shortName}</span>
          <span class="ef-row-meta" style="color:${p.teamColor}">${p.teamAbbr} · ${p.pos}</span>
        </div>
      </td>
      <td class="ef-td-center">${p.gp}</td>
      ${EDGE_DISPLAY_STATS.map(cfg => {
        const e = p.edges[cfg.key];
        return `
          <td class="ef-td-stat">
            <span class="ef-h2h-val">${fmtVal(e?.h2h)}</span>
            <span class="ef-season-val">${fmtVal(e?.season)}</span>
            <span class="ef-edge-val ${edgeColor(e?.edge)}">${fmtEdge(e?.edge)}</span>
          </td>`;
      }).join('')}
      <td class="ef-td-center">${p.rating ? `<span class="${p.rating === 'STRONG' ? 'ef-badge-strong' : 'ef-badge-notable'}">${p.rating}</span>` : ''}</td>
    </tr>`).join('');

  el.innerHTML = `
    <div class="ef-header">
      <div class="ef-title">Edge Finder</div>
      <div class="ef-subtitle">H2H performance vs season averages · ${h2hGames} game${h2hGames > 1 ? 's' : ''} analyzed</div>
    </div>

    <!-- Top Props -->
    <div class="ef-section">
      <div class="ef-section-title">Top Prop Picks</div>
      <div class="ef-top-props-grid">
        ${renderTopProp(awayTopProp)}
        ${renderTopProp(homeTopProp)}
      </div>
    </div>

    <!-- Positional Defense -->
    <div class="ef-section">
      <div class="ef-section-title">Positional Defense in H2H</div>
      <div class="ef-def-grid">
        ${renderPosDefense(awayDefense, gameInfo.awayAbbr, 'var(--blue)')}
        ${renderPosDefense(homeDefense, gameInfo.homeAbbr, 'var(--lime)')}
      </div>
    </div>

    <!-- All Player Edges -->
    <div class="ef-section">
      <div class="ef-section-title">All Player Edges</div>
      <div class="ef-table-wrap">
        <table class="ef-table">
          <thead>
            <tr>
              <th class="ef-th-player">Player</th>
              <th class="ef-th-center">GP</th>
              ${EDGE_DISPLAY_STATS.map(s => `<th class="ef-th-stat">${s.label}<div class="ef-th-sub">H2H / SZN / Edge</div></th>`).join('')}
              <th class="ef-th-center">Rating</th>
            </tr>
          </thead>
          <tbody>${playerRows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ── EDGE DETAIL DRILL-DOWN ───────────────────────────────
   Click a player row → expand a detail row below with
   bar charts showing per-game H2H stats (GP breakdown).
─────────────────────────────────────────────────────────── */
function destroyEdgeDetailCharts(idx) {
  ['efDetail_', 'efLast5_'].forEach(prefix => {
    const key = `${prefix}${idx}`;
    if (S.charts[key]) { S.charts[key].destroy(); delete S.charts[key]; }
  });
}

function toggleEdgeDetail(idx, colCount) {
  const existing = document.getElementById(`ef-detail-${idx}`);
  if (existing) {
    destroyEdgeDetailCharts(idx);
    existing.remove();
    return;
  }

  // Close any other open detail
  document.querySelectorAll('.ef-detail-row').forEach(row => {
    const oldIdx = row.dataset.idx;
    destroyEdgeDetailCharts(oldIdx);
    row.remove();
  });

  const p = S._edgeAllPlayers?.[idx];
  if (!p || !p.gameStats?.length) return;

  const defaultStat = p.bestEdge?.key || EDGE_DISPLAY_STATS[0].key;

  // Build H2H stat toggle buttons
  const statBtns = EDGE_DISPLAY_STATS.map(cfg => {
    const e = p.edges[cfg.key];
    const active = cfg.key === defaultStat ? ' active' : '';
    const edgeVal = e?.edge;
    const edgeClass = edgeVal != null && edgeVal >= 1.5 ? 'ef-detail-btn-pos' : edgeVal != null && edgeVal <= -1.5 ? 'ef-detail-btn-neg' : '';
    return `<button class="ef-detail-stat-btn${active} ${edgeClass}" onclick="event.stopPropagation(); switchEdgeDetailStat(${idx}, '${cfg.key}', this)">${cfg.label}</button>`;
  }).join('');

  // Build Last 5 stat toggle buttons (uses statCategories: pts, reb, ast)
  const modalCats = window.SportConfig?.[S.gameData?.gameInfo?.sportKey]?.statCategories || [];
  const defaultL5Stat = modalCats[0]?.key || 'pts';
  const last5Btns = modalCats.map((c, i) =>
    `<button class="ef-detail-stat-btn${i === 0 ? ' active' : ''}" onclick="event.stopPropagation(); switchEdgeLast5Stat(${idx}, '${c.key}', this)">${c.label}</button>`
  ).join('');

  // Insert detail row after the clicked row
  const clickedRows = document.querySelectorAll('.ef-row-clickable');
  const clickedRow = clickedRows[idx];
  if (!clickedRow) return;

  const detailRow = document.createElement('tr');
  detailRow.id = `ef-detail-${idx}`;
  detailRow.className = 'ef-detail-row';
  detailRow.dataset.idx = idx;
  detailRow.innerHTML = `
    <td colspan="${colCount}" class="ef-detail-cell">
      <div class="ef-detail-panel">
        <div class="ef-detail-header">
          <img class="ef-detail-hs" src="${p.headshotUrl}" alt="${p.shortName}" onerror="this.style.display='none'">
          <div class="ef-detail-info">
            <span class="ef-detail-name">${p.name}</span>
            <span class="ef-detail-meta" style="color:${p.teamColor}">${p.teamAbbr} · ${p.pos} · ${p.gp} H2H Games</span>
          </div>
        </div>

        <!-- H2H Games Section -->
        <div class="ef-detail-section-label">H2H Games</div>
        <div class="ef-detail-controls">
          <span class="ef-detail-label">Stat</span>
          <div class="ef-detail-toggle" id="efH2hToggle_${idx}">${statBtns}</div>
        </div>
        <div class="ef-detail-chart-wrap">
          <canvas id="efDetailChart_${idx}" height="180"></canvas>
        </div>
        <div class="ef-detail-summary" id="efDetailSummary_${idx}"></div>

        <!-- Last 5 Games Section -->
        <div class="ef-detail-section-label" style="margin-top:16px">Last 5 Games</div>
        <div class="ef-detail-controls">
          <span class="ef-detail-label">Stat</span>
          <div class="ef-detail-toggle" id="efL5Toggle_${idx}">${last5Btns}</div>
        </div>
        <div class="ef-detail-chart-wrap" id="efLast5Wrap_${idx}">
          <div class="ef-detail-loading" id="efLast5Loading_${idx}">
            <div class="mini-spin"></div> Loading last 5 games…
          </div>
          <canvas id="efLast5Chart_${idx}" height="180" style="display:none"></canvas>
        </div>
        <div class="ef-detail-summary" id="efLast5Summary_${idx}"></div>
      </div>
    </td>`;

  clickedRow.after(detailRow);

  // Animate in
  requestAnimationFrame(() => detailRow.classList.add('ef-detail-visible'));

  // Render H2H chart immediately
  renderEdgeDetailChart(idx, defaultStat);

  // Fetch last 5 games async
  const { sportKey } = S.gameData.gameInfo;
  fetchPlayerLastGames(sportKey, p.teamId, p.athleteId).then(games => {
    // Store on the player object for stat switching
    p._last5Games = games;
    const loadEl = document.getElementById(`efLast5Loading_${idx}`);
    const canvasEl = document.getElementById(`efLast5Chart_${idx}`);
    if (loadEl) loadEl.style.display = 'none';
    if (canvasEl) canvasEl.style.display = 'block';
    if (!games?.length) {
      const wrap = document.getElementById(`efLast5Wrap_${idx}`);
      if (wrap) wrap.innerHTML = '<div class="ef-detail-loading" style="color:var(--text3)">No recent games found</div>';
      return;
    }
    renderEdgeLast5Chart(idx, defaultL5Stat);
  });
}

function switchEdgeDetailStat(idx, statKey, btn) {
  btn.closest('.ef-detail-toggle').querySelectorAll('.ef-detail-stat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderEdgeDetailChart(idx, statKey);
}

function renderEdgeDetailChart(idx, statKey) {
  const p = S._edgeAllPlayers?.[idx];
  if (!p) return;

  const chartId = `efDetailChart_${idx}`;
  const ctx = document.getElementById(chartId);
  if (!ctx) return;
  if (S.charts[`efDetail_${idx}`]) S.charts[`efDetail_${idx}`].destroy();

  const games = p.gameStats;
  const statCfg = EDGE_DISPLAY_STATS.find(c => c.key === statKey);
  const statLabel = statCfg?.label || statKey;
  const seasonAvg = p.edges[statKey]?.season;
  const h2hAvg = p.edges[statKey]?.h2h;

  const values = games.map(g => g[statKey] ?? 0);
  const colors = values.map(v => {
    if (seasonAvg == null) return 'rgba(212,245,60,0.75)';
    return v >= seasonAvg ? 'rgba(35,209,139,0.82)' : 'rgba(255,61,90,0.72)';
  });

  const labels = games.map((_, i) => `G${i + 1}`);

  S.charts[`efDetail_${idx}`] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          data: values,
          backgroundColor: colors,
          borderRadius: 5,
          borderSkipped: false,
          barPercentage: 0.7,
        },
        ...(seasonAvg != null ? [{
          type: 'line',
          label: 'Season Avg',
          data: new Array(values.length).fill(parseFloat(seasonAvg.toFixed(1))),
          borderColor: 'rgba(255,255,255,0.25)',
          borderWidth: 1.5,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          tension: 0,
        }] : []),
        ...(h2hAvg != null ? [{
          type: 'line',
          label: 'H2H Avg',
          data: new Array(values.length).fill(parseFloat(h2hAvg.toFixed(1))),
          borderColor: 'rgba(212,245,60,0.4)',
          borderWidth: 1.5,
          borderDash: [3, 3],
          pointRadius: 0,
          fill: false,
          tension: 0,
        }] : []),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 120 },
      layout: { padding: { top: 24, bottom: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `Game ${items[0].dataIndex + 1}`,
            label: (item) => {
              if (item.datasetIndex === 0) return `${statLabel}: ${item.raw}`;
              return `${item.dataset.label}: ${item.raw}`;
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
          ticks: { color: '#8888b0', font: { family: 'IBM Plex Mono', size: 10 } },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          ticks: { color: '#8888b0', font: { family: 'IBM Plex Mono', size: 10 }, stepSize: 5 },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { display: false },
          beginAtZero: true,
        },
      },
    },
  });

  // Update summary
  const summaryEl = document.getElementById(`efDetailSummary_${idx}`);
  if (summaryEl) {
    const max = Math.max(...values);
    const min = Math.min(...values);
    const maxIdx = values.indexOf(max);
    const minIdx = values.indexOf(min);
    const edge = p.edges[statKey]?.edge;
    const edgeSign = edge != null && edge > 0 ? '+' : '';
    const edgeClass = edge != null && edge >= 1.5 ? 'ef-edge-pos' : edge != null && edge <= -1.5 ? 'ef-edge-neg' : '';

    summaryEl.innerHTML = `
      <div class="ef-detail-summary-grid">
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">Season Avg</span>
          <span class="ef-detail-summary-val">${seasonAvg != null ? seasonAvg.toFixed(1) : '—'}</span>
        </div>
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">H2H Avg</span>
          <span class="ef-detail-summary-val" style="color:var(--lime)">${h2hAvg != null ? h2hAvg.toFixed(1) : '—'}</span>
        </div>
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">Edge</span>
          <span class="ef-detail-summary-val ${edgeClass}">${edge != null ? edgeSign + edge.toFixed(1) : '—'}</span>
        </div>
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">High</span>
          <span class="ef-detail-summary-val" style="color:var(--green)">${max} <span class="ef-detail-summary-hint">G${maxIdx + 1}</span></span>
        </div>
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">Low</span>
          <span class="ef-detail-summary-val" style="color:var(--red)">${min} <span class="ef-detail-summary-hint">G${minIdx + 1}</span></span>
        </div>
      </div>`;
  }
}

/* ── LAST 5 GAMES CHART (inside edge detail) ────────────── */
function switchEdgeLast5Stat(idx, statKey, btn) {
  btn.closest('.ef-detail-toggle').querySelectorAll('.ef-detail-stat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderEdgeLast5Chart(idx, statKey);
}

function renderEdgeLast5Chart(idx, statKey) {
  const p = S._edgeAllPlayers?.[idx];
  if (!p || !p._last5Games?.length) return;

  const chartKey = `efLast5_${idx}`;
  const ctx = document.getElementById(`efLast5Chart_${idx}`);
  if (!ctx) return;
  if (S.charts[chartKey]) S.charts[chartKey].destroy();

  const games = p._last5Games;
  const played = games.filter(g => !g.didNotPlay);

  const labels = games.map(g => {
    const lbl = `${g.isHome ? 'vs' : '@'}${g.opponent}`;
    return g.didNotPlay ? `${lbl}\nDNP` : lbl;
  });
  const values = games.map(g => g.didNotPlay ? 0 : (g[statKey] || 0));
  const colors = games.map(g =>
    g.didNotPlay ? 'rgba(120,120,160,0.28)' :
    g.result === 'W' ? 'rgba(35,209,139,0.82)' : 'rgba(255,61,90,0.82)'
  );
  const playedVals = played.map(g => g[statKey] || 0);
  const avg = playedVals.length ? playedVals.reduce((s, v) => s + v, 0) / playedVals.length : 0;

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
          barPercentage: 0.7,
          minBarLength: 6,
        },
        {
          type: 'line',
          label: 'L5 Avg',
          data: new Array(values.length).fill(parseFloat(avg.toFixed(1))),
          borderColor: 'rgba(255,255,255,0.22)',
          borderWidth: 1.5,
          borderDash: [5, 4],
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
      layout: { padding: { top: 24, bottom: 4 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => {
              const g = games[items[0].dataIndex];
              return `${g.isHome ? 'vs' : '@'}${g.opponent}  ${g.date}`;
            },
            label: (item) => {
              const g = games[item.dataIndex];
              if (item.datasetIndex > 0) return `${item.dataset.label}: ${item.raw}`;
              if (g.didNotPlay) return `DNP — ${g.dnpReason}`;
              return `${item.raw} ${statKey.toUpperCase()}  (${g.result}  ${g.myScore}-${g.oppScore})`;
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
          ticks: { color: '#b8bce8', font: { family: 'IBM Plex Mono', size: 10 } },
          grid: { display: false },
          border: { display: false },
        },
        y: {
          ticks: { color: '#8888b0', font: { family: 'IBM Plex Mono', size: 10 }, stepSize: 5 },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { display: false },
          beginAtZero: true,
        },
      },
    },
  });

  // Update Last 5 summary
  const summaryEl = document.getElementById(`efLast5Summary_${idx}`);
  if (summaryEl) {
    if (!played.length) { summaryEl.innerHTML = ''; return; }
    const max = Math.max(...playedVals);
    const min = Math.min(...playedVals);
    const maxGame = played[playedVals.indexOf(max)];
    const minGame = played[playedVals.indexOf(min)];
    const record = `${played.filter(g => g.result === 'W').length}-${played.filter(g => g.result === 'L').length}`;

    summaryEl.innerHTML = `
      <div class="ef-detail-summary-grid">
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">L5 Avg</span>
          <span class="ef-detail-summary-val">${avg.toFixed(1)}</span>
        </div>
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">Record</span>
          <span class="ef-detail-summary-val">${record}</span>
        </div>
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">High</span>
          <span class="ef-detail-summary-val" style="color:var(--green)">${max} <span class="ef-detail-summary-hint">${maxGame ? `${maxGame.isHome ? 'vs' : '@'}${maxGame.opponent}` : ''}</span></span>
        </div>
        <div class="ef-detail-summary-item">
          <span class="ef-detail-summary-label">Low</span>
          <span class="ef-detail-summary-val" style="color:var(--red)">${min} <span class="ef-detail-summary-hint">${minGame ? `${minGame.isHome ? 'vs' : '@'}${minGame.opponent}` : ''}</span></span>
        </div>
      </div>`;
  }
}
