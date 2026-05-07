/* ═══════════════════════════════════════════════════════════
   NBA Box Score Fetcher
   Pulls one game's boxscore from ESPN and returns a normalized
   list of per-player stats { name, team, opponent, pts, min }.
═══════════════════════════════════════════════════════════ */

const { fetchJson } = require('../shared/http');
const { cacheGet, cacheSet } = require('../shared/cache');

const BOX_SCORE_TTL = 7 * 24 * 60 * 60 * 1000; // 7d — completed games never change

// ESPN uses several non-standard short abbreviations. Normalize everything to
// the canonical NBA codes also used by Rotowire and basketball-reference so
// downstream lookups (defense table, edge-finder) can match by abbr.
const ESPN_ABBR_NORMALIZE = {
  GS: 'GSW',
  NO: 'NOP',
  NY: 'NYK',
  SA: 'SAS',
  UTAH: 'UTA',
  WSH: 'WAS',
  PHX: 'PHO',
};
function normalizeAbbr(a) {
  const up = String(a || '').toUpperCase();
  return ESPN_ABBR_NORMALIZE[up] || up;
}

// "32:30" → 32.5 ; "43" → 43 ; "" / "DNP" → 0
function parseMinutes(s) {
  if (!s) return 0;
  const str = String(s).trim();
  if (!str || /^(dnp|dnd|did not play)/i.test(str)) return 0;
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str);
  const parts = str.split(':');
  if (parts.length === 2) {
    const m = Number(parts[0]) || 0;
    const sec = Number(parts[1]) || 0;
    return m + sec / 60;
  }
  const n = Number(str);
  return Number.isNaN(n) ? 0 : n;
}

function parseInt0(s) {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

// "7-18" → [7, 18]
function parseMA(s) {
  if (!s) return [0, 0];
  const m = String(s).match(/^(\d+)-(\d+)$/);
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10)] : [0, 0];
}

// Returns null if the game wasn't completed or boxscore is missing
async function fetchNbaBoxScore(eventId) {
  if (!eventId) return null;
  // v2 = stat schema with FG/FT/3P/REB/AST/STL/BLK/TO (post May 2026)
  const cacheKey = `nba_boxscore_v2_${eventId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const data = await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`);

  const hdr = data?.header || {};
  const comp = (hdr.competitions || [])[0] || {};
  const status = comp.status?.type?.state;
  if (status !== 'post') return null; // only count completed games

  const competitors = comp.competitors || [];
  const teamByHomeAway = {};
  for (const c of competitors) {
    const t = c.team || {};
    teamByHomeAway[c.homeAway] = {
      id: String(t.id || ''),
      abbr: normalizeAbbr(t.abbreviation),
      name: t.displayName || '',
    };
  }
  if (!teamByHomeAway.home || !teamByHomeAway.away) return null;

  const teamIdToSide = {
    [teamByHomeAway.home.id]: 'home',
    [teamByHomeAway.away.id]: 'away',
  };

  const players = [];
  const groups = data?.boxscore?.players || [];
  for (const grp of groups) {
    const teamId = String(grp.team?.id || '');
    const side = teamIdToSide[teamId];
    if (!side) continue;
    const team = teamByHomeAway[side];
    const opponent = teamByHomeAway[side === 'home' ? 'away' : 'home'];
    const stats = grp.statistics?.[0] || {};
    const keys = stats.keys || [];
    const idx = {
      min: keys.indexOf('minutes'),
      pts: keys.indexOf('points'),
      fg: keys.indexOf('fieldGoalsMade-fieldGoalsAttempted'),
      tp: keys.indexOf('threePointFieldGoalsMade-threePointFieldGoalsAttempted'),
      ft: keys.indexOf('freeThrowsMade-freeThrowsAttempted'),
      reb: keys.indexOf('rebounds'),
      ast: keys.indexOf('assists'),
      stl: keys.indexOf('steals'),
      blk: keys.indexOf('blocks'),
      to: keys.indexOf('turnovers'),
    };
    const athletes = stats.athletes || [];
    for (const a of athletes) {
      if (a.didNotPlay) continue;
      const ath = a.athlete || {};
      const arr = a.stats || [];
      const minutes = parseMinutes(idx.min >= 0 ? arr[idx.min] : '');
      if (minutes <= 0) continue; // user spec: ignore 0-minute players
      const points = parseInt0(idx.pts >= 0 ? arr[idx.pts] : '');
      const [fgm, fga] = parseMA(idx.fg >= 0 ? arr[idx.fg] : '');
      const [tpm, tpa] = parseMA(idx.tp >= 0 ? arr[idx.tp] : '');
      const [ftm, fta] = parseMA(idx.ft >= 0 ? arr[idx.ft] : '');
      players.push({
        athleteId: ath.id ? String(ath.id) : null,
        name: ath.displayName || ath.fullName || '',
        teamId: team.id,
        teamAbbr: team.abbr,
        opponentAbbr: opponent.abbr,
        opponentId: opponent.id,
        position: a.position?.abbreviation || ath.position?.abbreviation || '',
        minutes,
        points,
        fgm, fga, tpm, tpa, ftm, fta,
        reb: parseInt0(idx.reb >= 0 ? arr[idx.reb] : ''),
        ast: parseInt0(idx.ast >= 0 ? arr[idx.ast] : ''),
        stl: parseInt0(idx.stl >= 0 ? arr[idx.stl] : ''),
        blk: parseInt0(idx.blk >= 0 ? arr[idx.blk] : ''),
        to:  parseInt0(idx.to  >= 0 ? arr[idx.to]  : ''),
      });
    }
  }

  const result = {
    eventId: String(eventId),
    date: comp.date || hdr.date || null,
    awayAbbr: teamByHomeAway.away.abbr,
    homeAbbr: teamByHomeAway.home.abbr,
    players,
  };
  cacheSet(cacheKey, result, BOX_SCORE_TTL);
  return result;
}

module.exports = {
  fetchNbaBoxScore,
  parseMinutes,
};
