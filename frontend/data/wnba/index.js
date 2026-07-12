/* ============================================================
   PLAYIQ — WNBA DATA LAYER
   WNBA reuses the basketball machinery: ESPN serves the same
   game-log stat columns as the NBA, and the threshold projection
   model (nbaThresholdProbability) is pure math over `p.proj`, so
   it is sport-agnostic.

   Differences vs NBA: no Rotowire starting lineups and no
   defense-vs-position table (both are NBA-only backends), so the
   projection board runs without a matchup adjustment — it already
   degrades gracefully to "no matchup adj".
   ============================================================ */

async function buildWnbaEdgeData(gameInfo) {
  if (gameInfo?.sportKey !== 'wnba') return null;

  const [awayRoster, homeRoster] = await Promise.all([
    fetchRoster('wnba', gameInfo.awayTeamId),
    fetchRoster('wnba', gameInfo.homeTeamId),
  ]);

  const TOP_N = 8;
  const isActive = p => !/^(out|suspended|injured_reserve)/i.test(p.status || '');

  const buildSide = (roster, side, teamAbbr, teamColor, oppTeamId, oppAbbr) =>
    (roster || []).filter(isActive).slice(0, 12).map(p => ({
      id: String(p.id), name: p.name, pos: p.pos, jersey: p.jersey,
      headshot: p.headshot, status: p.status,
      side, teamAbbr, teamColor, oppTeamId: String(oppTeamId), oppAbbr,
      isStarter: false,          // no confirmed-lineup feed for WNBA
    }));

  const all = [
    ...buildSide(awayRoster, 'away', gameInfo.awayAbbr, '#00d4ff', gameInfo.homeTeamId, gameInfo.homeAbbr),
    ...buildSide(homeRoster, 'home', gameInfo.homeAbbr, '#ffd060', gameInfo.awayTeamId, gameInfo.awayAbbr),
  ];

  await Promise.all(all.map(async p => {
    const log = await fetchHoopsPlayerGameLog(p.id, { league: 'wnba', sportKey: 'wnba' });
    p.l5 = log.slice(0, 5);
    p.h2h = log.filter(g => g.oppTeamId === p.oppTeamId).slice(0, 5);
    const avg = (arr, key) => arr.length ? arr.reduce((s, g) => s + (g[key] || 0), 0) / arr.length : 0;
    p.avgPts = avg(p.l5, 'pts');
    p.avgReb = avg(p.l5, 'reb');
    p.avgAst = avg(p.l5, 'ast');
    p.seasonMpg = avg(log, 'min');
    p.seasonGames = log.length;

    // Same `proj` shape the threshold model expects (see nbaThresholdProbability):
    // per-stat game-by-game arrays, most-recent-first, from games actually played.
    const played = log.filter(g => (g.min || 0) > 0);
    const col = key => played.map(g => Number(g[key]) || 0);
    const minutes = col('min');
    p.proj = {
      gamesPlayed: played.length,
      minMean: _wnbaMean(minutes),
      minStd: _wnbaStd(minutes),
      vals: {
        pts: col('pts'),
        reb: col('reb'),
        ast: col('ast'),
        pra: played.map(g => (g.pts || 0) + (g.reb || 0) + (g.ast || 0)),
      },
    };
  }));

  // Keep the top rotation players by minutes (no confirmed starters to anchor on).
  const trim = side => all
    .filter(p => p.side === side && p.seasonGames > 0)
    .sort((a, b) => (b.seasonMpg || 0) - (a.seasonMpg || 0))
    .slice(0, TOP_N);
  const kept = [...trim('away'), ...trim('home')];

  kept.forEach(p => {
    const l5Pts = p.avgPts;
    const h2hPts = p.h2h.length ? p.h2h.reduce((s, g) => s + (g.pts || 0), 0) / p.h2h.length : 0;
    const l3 = p.l5.slice(0, 3);
    const l3Pts = l3.length ? l3.reduce((s, g) => s + (g.pts || 0), 0) / l3.length : l5Pts;
    const trendRatio = l5Pts > 0 ? Math.min(l3Pts / l5Pts, 2.0) : 1.0;

    let ptStreak = 0;
    for (const g of p.l5) { if ((g.pts || 0) >= 15) ptStreak++; else break; }

    p.hotScore = p.h2h.length
      ? (h2hPts * 0.5 + l5Pts * 0.5) * trendRatio + ptStreak * 0.3
      : l5Pts * trendRatio + ptStreak * 0.3;

    if (ptStreak >= 3 && l5Pts >= 16) p.hotTier = 'elite';
    else if (trendRatio >= 1.15 || (h2hPts > 0 && h2hPts > l5Pts)) p.hotTier = 'hot';
    else if (trendRatio < 0.80 || (p.l5.length >= 3 && l5Pts < 6)) p.hotTier = 'cold';
    else p.hotTier = 'neutral';
  });

  const sortByHot = list => list.slice().sort((a, b) => (b.hotScore ?? 0) - (a.hotScore ?? 0));
  const away = sortByHot(kept.filter(p => p.side === 'away'));
  const home = sortByHot(kept.filter(p => p.side === 'home'));

  return { players: [...away, ...home], awayAbbr: gameInfo.awayAbbr, homeAbbr: gameInfo.homeAbbr };
}

/* ============================================================
   WNBA LINEUP MATCHUPS
   ESPN publishes starters only once the game is live (the pre-game
   boxscore is empty), and we have no Rotowire scraper for WNBA. So:
     • live/final → CONFIRMED starters from the ESPN box score
     • pre-game   → PROJECTED lineup (top 5 by season minutes)
   Positions are coarse (G/F/C), so pair by POSITION GROUP rather than
   forcing a fake PG/SG/SF/PF/C grid (same lesson as the NBA fix).
   ============================================================ */

async function fetchWnbaStartingLineup(gameInfo) {
  if (!gameInfo?.eventId) return null;
  const summary = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary?event=${gameInfo.eventId}`);
  const groups = summary?.boxscore?.players || [];
  if (!groups.length) return null;                 // pre-game: no boxscore yet

  const result = { away: [], home: [], source: 'espn-boxscore' };
  for (const grp of groups) {
    const teamId = String(grp.team?.id);
    const side = teamId === String(gameInfo.awayTeamId) ? 'away'
      : teamId === String(gameInfo.homeTeamId) ? 'home' : null;
    if (!side) continue;
    const athletes = grp.statistics?.[0]?.athletes || [];
    result[side] = athletes
      .filter(a => a.starter === true)
      .map(a => {
        const ath = a.athlete || {};
        return {
          id: ath.id ? String(ath.id) : null,
          name: ath.displayName || ath.fullName || '—',
          pos: a.position?.abbreviation || ath.position?.abbreviation || '—',
          jersey: ath.jersey || '—',
          headshot: ath.headshot?.href || (ath.id ? `https://a.espncdn.com/i/headshots/wnba/players/full/${ath.id}.png` : null),
          starter: true,
        };
      })
      .filter(p => p.id);
  }
  if (!result.away.length && !result.home.length) return null;
  return result;
}

async function buildWnbaLineupData(gameInfo, awayRoster, homeRoster, options = {}) {
  if (gameInfo?.sportKey !== 'wnba') return null;

  const realStarters = await fetchWnbaStartingLineup(gameInfo);
  const awayConfirmed = (realStarters?.away?.length || 0) >= 5;
  const homeConfirmed = (realStarters?.home?.length || 0) >= 5;

  const isActive = p => !/^(out|suspended|injured_reserve)/i.test(p.status || '');
  const POOL = 10;
  const awayPool = awayConfirmed ? realStarters.away : (awayRoster || []).filter(isActive).slice(0, POOL);
  const homePool = homeConfirmed ? realStarters.home : (homeRoster || []).filter(isActive).slice(0, POOL);

  // Season / vs-this-opponent / last-5 aggregates for each player.
  const enrich = (players, oppTeamId) => Promise.all(players.map(async p => {
    const log = await fetchHoopsPlayerGameLog(p.id, { league: 'wnba', sportKey: 'wnba' });
    const h2hGames = log.filter(g => g.oppTeamId === String(oppTeamId));
    return {
      id: p.id, name: p.name, pos: p.pos, jersey: p.jersey, headshot: p.headshot, status: p.status,
      season: aggregateHoopsGames(log),
      h2h: aggregateHoopsGames(h2hGames),
      h2hCount: h2hGames.length,
      l5: aggregateHoopsGames(log.slice(0, 5)),
    };
  }));

  const [awayEnriched, homeEnriched] = await Promise.all([
    enrich(awayPool, gameInfo.homeTeamId),
    enrich(homePool, gameInfo.awayTeamId),
  ]);

  // Pre-game fallback: project the five by season minutes.
  const top5ByMinutes = list => list.slice()
    .sort((a, b) => (b.season?.min || 0) - (a.season?.min || 0))
    .slice(0, 5);
  const awayFive = awayConfirmed ? awayEnriched : top5ByMinutes(awayEnriched);
  const homeFive = homeConfirmed ? homeEnriched : top5ByMinutes(homeEnriched);

  const aB = bucketStartersByGroup(awayFive);
  const hB = bucketStartersByGroup(homeFive);
  const matchups = [
    ...buildBucketMatchups(aB.G, hB.G, 'G'),
    ...buildBucketMatchups(aB.F, hB.F, 'F'),
    ...buildBucketMatchups(aB.C, hB.C, 'C'),
  ];

  return {
    matchups,
    source: (awayConfirmed || homeConfirmed) ? 'espn-boxscore' : 'minutes-heuristic',
    lineupStatus: {
      away: awayConfirmed ? 'confirmed' : 'projected',
      home: homeConfirmed ? 'confirmed' : 'projected',
    },
    awayAbbr: gameInfo.awayAbbr,
    homeAbbr: gameInfo.homeAbbr,
    awayTeamId: gameInfo.awayTeamId,
    homeTeamId: gameInfo.homeTeamId,
    fetchedAt: Date.now(),
  };
}

function _wnbaMean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function _wnbaStd(a) {
  if (a.length < 2) return 0;
  const m = _wnbaMean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}

Object.assign(window, { buildWnbaEdgeData, buildWnbaLineupData, fetchWnbaStartingLineup });
