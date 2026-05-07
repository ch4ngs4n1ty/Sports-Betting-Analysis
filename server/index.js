/* ═══════════════════════════════════════════════════════════
   PlayIQ Backend Server
   Thin entrypoint that routes to sport-specific services
═══════════════════════════════════════════════════════════ */

const { http, URL, sendJson, sendError } = require('./shared/http');
const { cache } = require('./shared/cache');
const {
  getGames,
  getGameLineups,
  fetchSavantBvP,
  getGameBvp,
  fetchGameWeather,
  findGamePkByAbbrDate,
  findGamePkByTeams,
} = require('./mlb/service');
const {
  getNbaStartingLineups,
  findGameLineup: findNbaGameLineup,
} = require('./nba/service');

const PORT = 3001;

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    // GET /api/mlb/games?date=2026-04-13 — games for a date (defaults to today)
    if (path === '/api/mlb/games') {
      const date = url.searchParams.get('date') || undefined;
      const games = await getGames(date);
      return sendJson(res, { games });
    }

    // GET /api/mlb/lineups?gamePk=...&refresh=1
    if (path === '/api/mlb/lineups') {
      const gamePk = url.searchParams.get('gamePk');
      if (!gamePk) return sendError(res, 'gamePk required');
      const refresh = url.searchParams.get('refresh') === '1';
      const lineups = await getGameLineups(gamePk, { refresh });
      return sendJson(res, lineups);
    }

    // GET /api/mlb/bvp?batterId=...&pitcherId=...&refresh=1
    if (path === '/api/mlb/bvp') {
      const batterId = url.searchParams.get('batterId');
      const pitcherId = url.searchParams.get('pitcherId');
      if (!batterId || !pitcherId) return sendError(res, 'batterId and pitcherId required');
      const refresh = url.searchParams.get('refresh') === '1';
      const bvp = await fetchSavantBvP(batterId, pitcherId, { refresh });
      return sendJson(res, bvp);
    }

    // GET /api/mlb/game-bvp?gamePk=... OR ?away=...&home=...&date=2026-04-13
    // Optional: &awayLineup=Name1,Name2,...&homeLineup=... to supply lineup when
    // MLB boxscore hasn't posted battingOrder yet (e.g. ESPN already has it).
    // Add &refresh=1 to bypass caches.
    if (path === '/api/mlb/game-bvp') {
      let gamePk = url.searchParams.get('gamePk');
      if (!gamePk) {
        const away = url.searchParams.get('away');
        const home = url.searchParams.get('home');
        const date = url.searchParams.get('date') || undefined;
        if (!away || !home) return sendError(res, 'gamePk or away+home team names required');
        gamePk = await findGamePkByTeams(away, home, date);
        if (!gamePk) return sendError(res, `No game found for ${away} @ ${home}`, 404);
      }
      const refresh = url.searchParams.get('refresh') === '1';
      const parseLineup = param => {
        const v = url.searchParams.get(param);
        return v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined;
      };
      const awayLineup = parseLineup('awayLineup');
      const homeLineup = parseLineup('homeLineup');
      const awayPitcher = url.searchParams.get('awayPitcher') || undefined;
      const homePitcher = url.searchParams.get('homePitcher') || undefined;
      const result = await getGameBvp(gamePk, { refresh, awayLineup, homeLineup, awayPitcher, homePitcher });
      return sendJson(res, result);
    }

    // GET /api/mlb/weather?date=YYYY-MM-DD&teamAbbr=ATL
    // Returns weather for that team's game on that date (condition/temp/wind/venue).
    // Used by the frontend to decorate each L5 game in the MLB Edge Finder.
    if (path === '/api/mlb/weather') {
      const date = url.searchParams.get('date');
      const teamAbbr = url.searchParams.get('teamAbbr');
      if (!date || !teamAbbr) return sendError(res, 'date and teamAbbr required');
      const gamePk = await findGamePkByAbbrDate(teamAbbr, date);
      if (!gamePk) return sendJson(res, { weather: null, gamePk: null });
      const weather = await fetchGameWeather(gamePk);
      return sendJson(res, { weather, gamePk });
    }

    // GET /api/nba/starting-lineups
    //   Returns Rotowire-confirmed starting 5s for every NBA game today
    //   with specific PG/SG/SF/PF/C positions.
    // GET /api/nba/starting-lineups?away=PHI&home=NYK
    //   Returns just that one matchup (or null if not found).
    // Add &refresh=1 to bypass the 5-min cache.
    if (path === '/api/nba/starting-lineups') {
      const refresh = url.searchParams.get('refresh') === '1';
      const away = url.searchParams.get('away');
      const home = url.searchParams.get('home');
      const all = await getNbaStartingLineups({ refresh });
      if (away && home) {
        const game = findNbaGameLineup(all, away, home);
        return sendJson(res, { source: all.source, fetchedAt: all.fetchedAt, game });
      }
      return sendJson(res, all);
    }

    // Health check
    if (path === '/api/health') {
      return sendJson(res, { status: 'ok', cache_size: cache.size });
    }

    sendError(res, 'Not found', 404);
  } catch (err) {
    console.error(`[ERROR] ${path}:`, err.message);
    sendError(res, err.message, 500);
  }
});

server.listen(PORT, () => {
  const now = new Date().toLocaleString('en-US', { timeZoneName: 'short' });
  console.log(`[${now}] PlayIQ server running on http://localhost:${PORT}`);
});

// ── Keep alive — catch unhandled errors so server never crashes ──
process.on('uncaughtException', err => {
  console.error('[UNCAUGHT]', err.message);
});
process.on('unhandledRejection', reason => {
  console.error('[UNHANDLED REJECTION]', reason);
});
