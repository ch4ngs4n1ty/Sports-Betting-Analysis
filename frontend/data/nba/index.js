/* ============================================================
   PLAYIQ — NBA DATA LAYER
   NBA-only frontend helpers
   ============================================================ */

// Shared by NBA and WNBA — ESPN returns identical stat columns for both, so the
// parser is the same; only the league segment of the URL changes.
async function fetchHoopsPlayerGameLog(playerId, { season, league = 'nba', sportKey = 'nba' } = {}) {
  if (!playerId) return [];
  const yr = season || getSeasonYear(sportKey);
  const data = await espnFetch(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/${league}/athletes/${playerId}/gamelog?season=${yr}`);
  if (!data) return [];

  const names = (data.names || []).map(n => String(n).toLowerCase());
  // Try a couple of known label variants for the FG/3P/FT pairs
  const findIdx = (...candidates) => {
    for (const c of candidates) { const i = names.indexOf(c); if (i >= 0) return i; }
    return -1;
  };
  const idx = {
    min: findIdx('minutes'),
    reb: findIdx('totalrebounds', 'rebounds'),
    ast: findIdx('assists'),
    pts: findIdx('points'),
    stl: findIdx('steals'),
    blk: findIdx('blocks'),
    to:  findIdx('turnovers'),
    fgm: findIdx('fieldgoalsmade'),
    fga: findIdx('fieldgoalsattempted'),
    tpm: findIdx('threepointfieldgoalsmade'),
    tpa: findIdx('threepointfieldgoalsattempted'),
    ftm: findIdx('freethrowsmade'),
    fta: findIdx('freethrowsattempted'),
  };

  const events = data.events || {};
  const out = [];
  for (const st of (data.seasonTypes || [])) {
    const typeName = String(st.displayName || '').toLowerCase();
    if (typeName.includes('preseason')) continue;
    for (const cat of (st.categories || [])) {
      for (const ev of (cat.events || [])) {
        const meta = events[ev.eventId] || {};
        const stats = ev.stats || [];
        const num = i => { if (i < 0) return 0; const v = parseFloat(stats[i]); return Number.isNaN(v) ? 0 : v; };
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
          stl: num(idx.stl),
          blk: num(idx.blk),
          to:  num(idx.to),
          fgm: num(idx.fgm),
          fga: num(idx.fga),
          tpm: num(idx.tpm),
          tpa: num(idx.tpa),
          ftm: num(idx.ftm),
          fta: num(idx.fta),
          result: meta.gameResult || null,
          score: meta.score || null,
        });
      }
    }
  }
  out.sort((a, b) => String(b.rawDate).localeCompare(String(a.rawDate)));
  return out;
}

// Back-compat wrapper — existing NBA callers keep working unchanged.
async function fetchNbaPlayerGameLog(playerId, opts = {}) {
  return fetchHoopsPlayerGameLog(playerId, { ...opts, league: 'nba', sportKey: 'nba' });
}

async function buildNbaEdgeData(gameInfo) {
  if (gameInfo?.sportKey !== 'nba') return null;

  // Pull rosters AND the official starting lineup in parallel
  const [awayRoster, homeRoster, realStarters] = await Promise.all([
    fetchRoster('nba', gameInfo.awayTeamId),
    fetchRoster('nba', gameInfo.homeTeamId),
    fetchNbaStartingLineup(gameInfo),
  ]);

  const TOP_N = 8;
  const POOL_N = 16;
  const isActive = p => !/^(out|suspended|injured_reserve)/i.test(p.status || '');

  const buildMeta = (players, side, teamAbbr, teamColor, oppTeamId, oppAbbr, starterIds) =>
    players.map(p => ({
      id: String(p.id), name: p.name, pos: p.pos, jersey: p.jersey,
      headshot: p.headshot, status: p.status,
      side, teamAbbr, teamColor, oppTeamId: String(oppTeamId), oppAbbr,
      isStarter: starterIds.has(String(p.id)),
    }));

  // Build the candidate pool per side: real starters (always kept) + roster pool
  const buildSide = (roster, side, teamAbbr, teamColor, oppTeamId, oppAbbr, starters) => {
    const starterIds = new Set((starters || []).map(s => String(s.id)));
    const rosterPool = (roster || []).filter(isActive).slice(0, POOL_N);

    // Merge: starters first (de-duplicated against roster), then everyone else.
    // We keep everyone in the merged pool and trim later by minutes.
    const seen = new Set();
    const merged = [];
    for (const s of (starters || [])) {
      if (!s.id || seen.has(String(s.id))) continue;
      seen.add(String(s.id));
      merged.push({ id: s.id, name: s.name, pos: s.pos, jersey: s.jersey,
        headshot: s.headshot, status: 'Active' });
    }
    for (const p of rosterPool) {
      if (!p.id || seen.has(String(p.id))) continue;
      seen.add(String(p.id));
      merged.push(p);
    }
    return buildMeta(merged, side, teamAbbr, teamColor, oppTeamId, oppAbbr, starterIds);
  };

  const all = [
    ...buildSide(awayRoster, 'away', gameInfo.awayAbbr, '#00d4ff', gameInfo.homeTeamId, gameInfo.homeAbbr, realStarters?.away),
    ...buildSide(homeRoster, 'home', gameInfo.homeAbbr, '#ffd060', gameInfo.awayTeamId, gameInfo.awayAbbr, realStarters?.home),
  ];

  await Promise.all(all.map(async p => {
    const log = await fetchNbaPlayerGameLog(p.id);
    p.l5 = log.slice(0, 5);
    p.h2h = log.filter(g => g.oppTeamId === p.oppTeamId).slice(0, 5);
    const avg = (arr, key) => arr.length ? arr.reduce((s, g) => s + (g[key] || 0), 0) / arr.length : 0;
    p.avgPts = avg(p.l5, 'pts');
    p.avgReb = avg(p.l5, 'reb');
    p.avgAst = avg(p.l5, 'ast');
    p.seasonMpg = avg(log, 'min');
    p.seasonGames = log.length;

    // Projection inputs: per-stat game-by-game arrays (most-recent first),
    // built from games actually PLAYED so DNPs don't drag the mean to 0.
    // The threshold model fits a distribution to these at render time.
    const played = log.filter(g => (g.min || 0) > 0);
    const col = key => played.map(g => Number(g[key]) || 0);
    const minutes = col('min');
    p.proj = {
      gamesPlayed: played.length,
      minMean: _nbaMean(minutes),
      minStd: _nbaStd(minutes),
      vals: {
        pts: col('pts'),
        reb: col('reb'),
        ast: col('ast'),
        pra: played.map(g => (g.pts || 0) + (g.reb || 0) + (g.ast || 0)),
      },
    };
  }));

  // Trim per side: starters always kept, then top bench by minutes to fill TOP_N.
  const trimSide = side => {
    const teamPlayers = all.filter(p => p.side === side);
    const starters = teamPlayers.filter(p => p.isStarter);
    const bench = teamPlayers.filter(p => !p.isStarter && p.seasonGames > 0)
      .sort((a, b) => (b.seasonMpg || 0) - (a.seasonMpg || 0));
    const remaining = Math.max(0, TOP_N - starters.length);
    const keepIds = new Set([
      ...starters.map(p => p.id),
      ...bench.slice(0, remaining).map(p => p.id),
    ]);
    return keepIds;
  };
  const keepAway = trimSide('away');
  const keepHome = trimSide('home');
  const allTrimmed = all.filter(p => (p.side === 'away' ? keepAway : keepHome).has(p.id));
  all.length = 0;
  allTrimmed.forEach(p => all.push(p));

  all.forEach(p => {
    const l5Pts = p.avgPts;
    const h2hPts = p.h2h.length ? p.h2h.reduce((s, g) => s + (g.pts || 0), 0) / p.h2h.length : 0;
    const l3Pts = p.l5.slice(0, 3).length
      ? p.l5.slice(0, 3).reduce((s, g) => s + (g.pts || 0), 0) / p.l5.slice(0, 3).length : l5Pts;

    const trendRatio = l5Pts > 0 ? Math.min(l3Pts / l5Pts, 2.0) : 1.0;
    const elevationBonus = h2hPts > l5Pts ? (h2hPts - l5Pts) * 0.5 : 0;

    let ptStreak = 0;
    for (const g of p.l5) { if ((g.pts || 0) >= 20) ptStreak++; else break; }

    p.hotScore = p.h2h.length
      ? (h2hPts * 0.5 + l5Pts * 0.5) * trendRatio + elevationBonus + ptStreak * 0.3
      : l5Pts * trendRatio + ptStreak * 0.3;

    const h2hElite = h2hPts > 0 && h2hPts >= l5Pts * 1.15 && h2hPts >= 20;
    if ((ptStreak >= 3 && l5Pts >= 20) || h2hElite) p.hotTier = 'elite';
    else if (trendRatio >= 1.15 || (h2hPts > 0 && h2hPts > l5Pts)) p.hotTier = 'hot';
    else if (trendRatio < 0.80 || (p.l5.length >= 3 && l5Pts < 8)) p.hotTier = 'cold';
    else p.hotTier = 'neutral';
  });

  const sortByHot = list => list.slice().sort((a, b) => (b.hotScore ?? 0) - (a.hotScore ?? 0));
  const away = sortByHot(all.filter(p => p.side === 'away'));
  const home = sortByHot(all.filter(p => p.side === 'home'));

  return { players: [...away, ...home], awayAbbr: gameInfo.awayAbbr, homeAbbr: gameInfo.homeAbbr };
}

/* ============================================================
   NBA STARTING LINEUP
   Pulls Rotowire-confirmed lineups (with PG/SG/SF/PF/C labels)
   from our backend, then matches each player by name against
   the ESPN roster to enrich with athlete id + headshot.
   Falls back to ESPN's boxscore (coarse G/F/C labels) when
   Rotowire doesn't have the matchup.
   Returns { away: [...], home: [...] } or null.
   ============================================================ */

function _nbaNormalizeName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')      // strip accents
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')              // drop suffixes
    .replace(/[^a-z0-9\s]/g, '')                           // drop punctuation
    .replace(/\s+/g, ' ').trim();
}

function _nbaBuildRosterMap(roster) {
  const byFull = {};
  const byLast = {};
  for (const p of roster || []) {
    if (!p?.id) continue;
    const full = _nbaNormalizeName(p.name);
    if (full) byFull[full] = p;
    const lastKey = full.split(' ').slice(-1)[0];
    if (lastKey) byLast[lastKey] = byLast[lastKey] === undefined ? p : null; // null = ambiguous
  }
  return { byFull, byLast };
}

function _nbaResolveRoster(rotowireName, rosterMap) {
  const full = _nbaNormalizeName(rotowireName);
  if (rosterMap.byFull[full]) return rosterMap.byFull[full];
  // First+last (e.g. "Kelly Oubre" should match "Kelly Oubre Jr." after suffix strip)
  const lastKey = full.split(' ').slice(-1)[0];
  if (lastKey && rosterMap.byLast[lastKey]) return rosterMap.byLast[lastKey];
  // First-name + space + first 4 chars of last? (handle short names) — skip.
  return null;
}

async function fetchNbaStartingLineup(gameInfo, options = {}) {
  const awayAbbr = gameInfo?.awayAbbr;
  const homeAbbr = gameInfo?.homeAbbr;
  if (!awayAbbr || !homeAbbr) return null;

  // Step 1: try Rotowire (specific PG/SG/SF/PF/C labels) — pass refresh=1 to
  // bypass the backend's 5-min cache when the user/poller asks for fresh data.
  let rotowire = null;
  try {
    const refreshParam = options.refresh ? '&refresh=1' : '';
    const r = await fetch(`${API_BASE}/api/nba/starting-lineups?away=${encodeURIComponent(awayAbbr)}&home=${encodeURIComponent(homeAbbr)}${refreshParam}`);
    if (r.ok) rotowire = await r.json();
  } catch (_) { /* backend unavailable */ }

  if (rotowire?.game) {
    // Match Rotowire names against ESPN rosters for IDs/headshots
    const [awayRoster, homeRoster] = await Promise.all([
      fetchRoster('nba', gameInfo.awayTeamId),
      fetchRoster('nba', gameInfo.homeTeamId),
    ]);
    const awayMap = _nbaBuildRosterMap(awayRoster);
    const homeMap = _nbaBuildRosterMap(homeRoster);

    const enrichSide = (rotoStarters, rosterMap) => rotoStarters.map(s => {
      const matched = _nbaResolveRoster(s.name, rosterMap);
      return {
        id: matched?.id ? String(matched.id) : null,
        name: matched?.name || s.name,
        pos: s.pos, // PG/SG/SF/PF/C straight from Rotowire
        jersey: matched?.jersey || '—',
        headshot: matched?.headshot
          || (matched?.id ? `https://a.espncdn.com/i/headshots/nba/players/full/${matched.id}.png` : null),
        starter: true,
        injuryStatus: s.injuryStatus || null,
        rotowireName: s.name,
      };
    });

    return {
      away: enrichSide(rotowire.game.away?.starters || [], awayMap),
      home: enrichSide(rotowire.game.home?.starters || [], homeMap),
      source: 'rotowire',
      status: { away: rotowire.game.away?.status, home: rotowire.game.home?.status },
    };
  }

  // Step 2: fall back to ESPN boxscore (coarse G/F/C labels) when Rotowire
  // doesn't have the matchup yet (e.g. unconfirmed pre-game).
  if (!gameInfo.eventId) return null;
  const summary = await espnFetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${gameInfo.eventId}`);
  if (!summary) return null;

  const playerGroups = summary?.boxscore?.players || [];
  if (!playerGroups.length) return null;

  const result = { away: [], home: [], source: 'espn-boxscore' };

  for (const grp of playerGroups) {
    const teamId = String(grp.team?.id);
    const side = teamId === String(gameInfo.awayTeamId) ? 'away'
      : teamId === String(gameInfo.homeTeamId) ? 'home'
      : null;
    if (!side) continue;

    const athletes = grp.statistics?.[0]?.athletes || [];
    const starters = athletes.filter(a => a.starter === true).map(a => {
      const ath = a.athlete || {};
      const pos = a.position?.abbreviation
        || ath.position?.abbreviation
        || a.position?.displayName
        || '—';
      return {
        id: ath.id ? String(ath.id) : null,
        name: ath.displayName || ath.fullName || '—',
        pos,
        jersey: ath.jersey || '—',
        headshot: ath.headshot?.href
          || (ath.id ? `https://a.espncdn.com/i/headshots/nba/players/full/${ath.id}.png` : null),
        starter: true,
      };
    }).filter(p => p.id);

    result[side] = starters;
  }

  if (!result.away.length && !result.home.length) return null;
  return result;
}

/* ============================================================
   NBA LINEUP MATCHUPS
   Pick the most-likely starter at each position (PG/SG/SF/PF/C)
   and pair them across teams. For each pair compute season
   averages AND head-to-head averages (games where both faced
   the opposing team) for MIN/PTS/REB/AST/STL/BLK/FG%/3P%/FT%.
   ============================================================ */

const NBA_LINEUP_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

function _avgGames(games, key) {
  if (!games?.length) return 0;
  const sum = games.reduce((s, g) => s + (Number(g[key]) || 0), 0);
  return sum / games.length;
}

function _pctSafe(num, den) {
  if (!den) return 0;
  return num / den;
}

// Aggregate a list of games into season-style averages for a player
function _aggregatePlayerGames(games) {
  if (!games?.length) return null;
  const sumKey = key => games.reduce((s, g) => s + (Number(g[key]) || 0), 0);
  const fgm = sumKey('fgm'), fga = sumKey('fga');
  const tpm = sumKey('tpm'), tpa = sumKey('tpa');
  const ftm = sumKey('ftm'), fta = sumKey('fta');
  return {
    games: games.length,
    min: _avgGames(games, 'min'),
    pts: _avgGames(games, 'pts'),
    reb: _avgGames(games, 'reb'),
    ast: _avgGames(games, 'ast'),
    stl: _avgGames(games, 'stl'),
    blk: _avgGames(games, 'blk'),
    to:  _avgGames(games, 'to'),
    fgPct: _pctSafe(fgm, fga),
    tpPct: _pctSafe(tpm, tpa),
    ftPct: _pctSafe(ftm, fta),
  };
}

// Pick the most-played player at a given position from a roster, given that
// player's gamelog for sorting. Falls back to looser matches (G/F) when no
// exact PG/SG/SF/PF/C match is available.
function _pickStarterByPosition(playersWithLogs, position, takenIds) {
  const exactMatch = playersWithLogs
    .filter(p => !takenIds.has(p.id))
    .filter(p => (p.pos || '').toUpperCase() === position)
    .sort((a, b) => (b.season?.min || 0) - (a.season?.min || 0));
  if (exactMatch[0]) return exactMatch[0];

  // Fallbacks for ambiguous "G" / "F" / "G-F" rosters
  const looseGroup = position === 'PG' || position === 'SG' ? ['G']
    : position === 'SF' || position === 'PF' ? ['F']
    : [];
  if (looseGroup.length) {
    const loose = playersWithLogs
      .filter(p => !takenIds.has(p.id))
      .filter(p => looseGroup.includes((p.pos || '').toUpperCase()))
      .sort((a, b) => (b.season?.min || 0) - (a.season?.min || 0));
    if (loose[0]) return loose[0];
  }
  return null;
}

// ESPN's NBA boxscore uses coarse positions only: G, F, C. Don't force
// players into PG/SG/SF/PF/C — bucket them by group and pair across teams
// within the same bucket. Within a bucket, sort by season MPG (most-played
// = primary) so the comparisons line up sensibly.
function _bucketStartersByGroup(starters) {
  const buckets = { G: [], F: [], C: [] };
  for (const s of starters || []) {
    const p = String(s.pos || '').toUpperCase();
    // Center: C, CENTER, or any pos starting with C
    if (p === 'C' || p === 'CENTER') buckets.C.push(s);
    // Forward: F, SF, PF, FORWARD
    else if (p === 'F' || p === 'SF' || p === 'PF' || p === 'FORWARD') buckets.F.push(s);
    // Guard: G, PG, SG, GUARD (default fallback for unknowns)
    else buckets.G.push(s);
  }
  return buckets;
}

function _buildBucketMatchups(awayBucket, homeBucket, label) {
  const sortByMin = arr => arr.slice().sort((a, b) => (b.season?.min || 0) - (a.season?.min || 0));
  const a = sortByMin(awayBucket || []);
  const h = sortByMin(homeBucket || []);
  const max = Math.max(a.length, h.length);
  const rows = [];
  for (let i = 0; i < max; i++) {
    rows.push({
      position: max > 1 ? `${label}${i + 1}` : label,
      away: a[i] || null,
      home: h[i] || null,
    });
  }
  return rows;
}

async function buildNbaLineupData(gameInfo, awayRoster, homeRoster, options = {}) {
  if (gameInfo?.sportKey !== 'nba') return null;

  // Step 1: pull the OFFICIAL starting lineup (Rotowire preferred, ESPN fallback)
  const realStarters = await fetchNbaStartingLineup(gameInfo, options);
  const haveRealStarters = realStarters && (realStarters.away.length > 0 || realStarters.home.length > 0);
  const fromRotowire = realStarters?.source === 'rotowire';

  // Step 2: figure out which players we need to enrich with stats
  // - If real starters exist, use them
  // - Otherwise, fall back to top-12 active roster and pick by minutes
  const isActive = p => !/^(out|suspended|injured_reserve)/i.test(p.status || '');
  const TOP_N = 12;

  let awayPlayers, homePlayers;
  if (haveRealStarters && realStarters.away.length >= 5) {
    awayPlayers = realStarters.away;
  } else {
    awayPlayers = (awayRoster || []).filter(isActive).slice(0, TOP_N);
  }
  if (haveRealStarters && realStarters.home.length >= 5) {
    homePlayers = realStarters.home;
  } else {
    homePlayers = (homeRoster || []).filter(isActive).slice(0, TOP_N);
  }

  const enrich = async (players, oppTeamId) => {
    return Promise.all(players.map(async p => {
      const log = await fetchNbaPlayerGameLog(p.id);
      const h2hGames = log.filter(g => g.oppTeamId === String(oppTeamId));
      return {
        id: p.id,
        name: p.name,
        pos: p.pos,
        jersey: p.jersey,
        headshot: p.headshot,
        status: p.status,
        season: _aggregatePlayerGames(log),
        h2h: _aggregatePlayerGames(h2hGames),
        h2hCount: h2hGames.length,
        l5: _aggregatePlayerGames(log.slice(0, 5)),
      };
    }));
  };

  const [awayEnriched, homeEnriched] = await Promise.all([
    enrich(awayPlayers, gameInfo.homeTeamId),
    enrich(homePlayers, gameInfo.awayTeamId),
  ]);

  // Step 3: build position matchups
  let matchups;
  if (haveRealStarters && fromRotowire) {
    // Rotowire gives us specific PG/SG/SF/PF/C — slot directly into 5 rows
    const slotByPos = (players, pos) => players.find(p => (p.pos || '').toUpperCase() === pos) || null;
    matchups = NBA_LINEUP_POSITIONS.map(pos => ({
      position: pos,
      away: slotByPos(awayEnriched, pos),
      home: slotByPos(homeEnriched, pos),
    }));
  } else if (haveRealStarters) {
    // ESPN-only fallback: coarse G/F/C — pair by group
    const awayBuckets = _bucketStartersByGroup(awayEnriched);
    const homeBuckets = _bucketStartersByGroup(homeEnriched);
    matchups = [
      ..._buildBucketMatchups(awayBuckets.G, homeBuckets.G, 'G'),
      ..._buildBucketMatchups(awayBuckets.F, homeBuckets.F, 'F'),
      ..._buildBucketMatchups(awayBuckets.C, homeBuckets.C, 'C'),
    ];
  } else {
    // Fallback (no ESPN starter data): use roster's specific positions
    // (PG/SG/SF/PF/C) and pick most-played at each. Different from the
    // real-starters path because rosters have finer position info.
    const awayTaken = new Set();
    const homeTaken = new Set();
    matchups = [];
    for (const pos of NBA_LINEUP_POSITIONS) {
      const a = _pickStarterByPosition(awayEnriched, pos, awayTaken);
      const h = _pickStarterByPosition(homeEnriched, pos, homeTaken);
      if (a) awayTaken.add(a.id);
      if (h) homeTaken.add(h.id);
      matchups.push({ position: pos, away: a || null, home: h || null });
    }
  }

  return {
    matchups,
    source: haveRealStarters ? (realStarters.source || 'espn-boxscore') : 'minutes-heuristic',
    lineupStatus: realStarters?.status || null,
    awayAbbr: gameInfo.awayAbbr,
    homeAbbr: gameInfo.homeAbbr,
    awayTeamId: gameInfo.awayTeamId,
    homeTeamId: gameInfo.homeTeamId,
    fetchedAt: Date.now(),
  };
}

/* ============================================================
   NBA POSITIONAL DEFENSE EDGE
   Pulls the Top-50 / Mid-50 / Bottom-50 defensive ranks for
   tonight's matchup so the Lineups tab can show a colored chip
   under each starter (rank 1-50 = green / 51-100 = yellow /
   101-150 = red).
   ============================================================ */

async function fetchNbaPositionalDefenseEdge(gameInfo, options = {}) {
  if (gameInfo?.sportKey !== 'nba') return null;
  const { awayAbbr, homeAbbr } = gameInfo;
  if (!awayAbbr || !homeAbbr) return null;
  try {
    const refreshParam = options.refresh ? '&refresh=1' : '';
    const r = await fetch(
      `${API_BASE}/api/nba/edge-finder/positional-points`
      + `?away=${encodeURIComponent(awayAbbr)}`
      + `&home=${encodeURIComponent(homeAbbr)}${refreshParam}`
    );
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

// Lookup helper: given a player name + their position + opponent abbr,
// pull their entry from the defense-edge response.
function findNbaDefenseEdge(edgeData, playerName, side) {
  if (!edgeData || !side) return null;
  const list = edgeData[side]?.players || [];
  const norm = s => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const target = norm(playerName);
  // Exact normalized match first; then last-name fallback
  const exact = list.find(p => norm(p.player) === target);
  if (exact) return exact;
  const lastName = target.split(' ').slice(-1)[0];
  if (!lastName) return null;
  const byLast = list.filter(p => norm(p.player).split(' ').slice(-1)[0] === lastName);
  return byLast.length === 1 ? byLast[0] : null;
}

// Top 50 = green, Middle 50 = yellow, Bottom 50 = red
function nbaDefenseRankColor(rank) {
  if (rank == null) return null;
  if (rank <= 50) return 'green';
  if (rank <= 100) return 'yellow';
  return 'red';
}

// Pulls the full 150-row Defense vs Position table for a season.
// Cached on the backend (24h TTL); cheap to refetch.
async function fetchNbaDefenseVsPositionTable(options = {}) {
  try {
    const refreshParam = options.refresh ? '?refresh=1' : '';
    const r = await fetch(`${API_BASE}/api/nba/positional-defense-points${refreshParam}`);
    if (!r.ok) return null;
    return await r.json();
  } catch (_) {
    return null;
  }
}

/* ============================================================
   NBA THRESHOLD PROJECTION MODEL
   A transparent statistical model (NOT a trained ML net): for a
   given player + stat + line, fit a Normal distribution to their
   game-log values, shift the mean by recent form and the opponent's
   defense-vs-position rank, then compute P(stat ≥ line).
   Pure functions over the `p.proj` shape built in buildNbaEdgeData.
   ============================================================ */

// Preset threshold buckets per stat, plus a sensible default line.
const NBA_THRESHOLD_BUCKETS = {
  pts: [10, 15, 20, 25, 30],
  reb: [4, 6, 8, 10, 12],
  ast: [2, 4, 6, 8, 10],
  pra: [20, 25, 30, 35, 40],
};
const NBA_THRESHOLD_DEFAULT_LINE = { pts: 20, reb: 8, ast: 6, pra: 30 };
const NBA_STAT_LABELS = { pts: 'PTS', reb: 'REB', ast: 'AST', pra: 'PRA' };

// Coefficient-of-variation floor + absolute floor on σ. Prevents a tiny or
// low-variance sample from producing an overconfident probability.
const _NBA_CV_FLOOR = { pts: 0.30, reb: 0.42, ast: 0.45, pra: 0.26 };
const _NBA_ABS_FLOOR = { pts: 2.0, reb: 1.3, ast: 1.3, pra: 3.0 };

function _nbaMean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function _nbaStd(a) {
  if (a.length < 2) return 0;
  const m = _nbaMean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
}
// erf (Abramowitz & Stegun 7.1.26) → standard-normal CDF.
function _nbaErf(x) {
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return sign * y;
}
function _nbaNormCdf(x) { return 0.5 * (1 + _nbaErf(x / Math.SQRT2)); }

// Defense-vs-position rank → mean multiplier. rank 1 = toughest D (suppress),
// rank N = weakest D (boost). Capped at ±~12%.
function _nbaDefMultiplier(rank, total) {
  if (rank == null || !total) return 1;
  const pct = (rank - 0.5) / total;          // 0 = toughest .. 1 = weakest
  return Math.max(0.88, Math.min(1.12, 1 + 0.10 * (pct - 0.5) * 2));
}

// defEntry: a row from findNbaDefenseEdge (may be null for bench players).
// Returns null when the player has no usable game sample.
function nbaThresholdProbability(proj, stat, line, defEntry, total) {
  const vals = proj?.vals?.[stat];
  if (!vals || vals.length < 1) return null;
  const n = vals.length;
  const T = total || 150;

  const seasonMean = _nbaMean(vals);
  const recent = vals.slice(0, Math.min(5, n));      // vals are recent-first
  const recentMean = _nbaMean(recent);
  const muBase = n >= 3 ? 0.65 * seasonMean + 0.35 * recentMean : seasonMean;

  // Matchup multiplier — for PRA blend pts/reb/ast by each stat's mean share.
  let mult = 1, defRank = null;
  if (defEntry) {
    if (stat === 'pra') {
      const mp = _nbaMean(proj.vals.pts), mr = _nbaMean(proj.vals.reb), ma = _nbaMean(proj.vals.ast);
      const tot = mp + mr + ma || 1;
      mult = (mp * _nbaDefMultiplier(defEntry.ranks?.pts, T)
            + mr * _nbaDefMultiplier(defEntry.ranks?.reb, T)
            + ma * _nbaDefMultiplier(defEntry.ranks?.ast, T)) / tot;
      defRank = defEntry.ranks?.pts ?? defEntry.rank ?? null;
    } else {
      defRank = defEntry.ranks?.[stat] ?? (stat === 'pts' ? defEntry.rank : null);
      mult = _nbaDefMultiplier(defRank, T);
    }
  }
  const mu = muBase * mult;

  let sd = Math.max(_nbaStd(vals), _NBA_CV_FLOOR[stat] * mu, _NBA_ABS_FLOOR[stat]);

  // P(X ≥ line) with a 0.5 continuity correction (lines are integers).
  const pNorm = 1 - _nbaNormCdf((line - 0.5 - mu) / sd);
  const emp = vals.filter(v => v >= line).length / n;          // empirical hit rate
  let prob = n >= 10 ? 0.8 * pNorm + 0.2 * emp : pNorm;         // light regularization
  prob = Math.max(0.01, Math.min(0.99, prob));

  const minStable = (proj.minStd != null && proj.minMean > 0) ? (proj.minStd / proj.minMean < 0.35) : true;
  const conf = (n >= 15 && defEntry && minStable) ? 'HIGH' : n >= 8 ? 'MED' : 'LOW';

  return {
    prob, proj: mu, baseMean: seasonMean, recentMean, sd,
    line, stat, defRank, total: T, hasMatchup: !!defEntry, mult,
    seasonHitRate: emp,
    l5HitRate: recent.length ? recent.filter(v => v >= line).length / recent.length : null,
    n, conf,
  };
}

// Probability → color token for the model board.
function nbaProbColor(prob) {
  if (prob == null) return 'var(--dim)';
  if (prob >= 0.70) return '#00ff88';
  if (prob >= 0.55) return '#ffd060';
  if (prob >= 0.40) return '#00d4ff';
  return '#ff6b35';
}

Object.assign(window, {
  fetchHoopsPlayerGameLog,
  // Generic basketball helpers — shared with WNBA (see frontend/data/wnba/).
  aggregateHoopsGames: _aggregatePlayerGames,
  bucketStartersByGroup: _bucketStartersByGroup,
  buildBucketMatchups: _buildBucketMatchups,
  fetchNbaPlayerGameLog,
  fetchNbaStartingLineup,
  fetchNbaPositionalDefenseEdge,
  fetchNbaDefenseVsPositionTable,
  findNbaDefenseEdge,
  nbaDefenseRankColor,
  buildNbaEdgeData,
  buildNbaLineupData,
  nbaThresholdProbability,
  nbaProbColor,
  NBA_THRESHOLD_BUCKETS,
  NBA_THRESHOLD_DEFAULT_LINE,
  NBA_STAT_LABELS,
});
