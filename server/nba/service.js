/* ═══════════════════════════════════════════════════════════
   NBA Service
   Scrapes Rotowire for confirmed starting lineups with the
   specific PG/SG/SF/PF/C positions that ESPN doesn't expose.
═══════════════════════════════════════════════════════════ */

const { fetchUrl } = require('../shared/http');
const { cacheGet, cacheSet } = require('../shared/cache');

const ROTOWIRE_URL = 'https://www.rotowire.com/basketball/nba-lineups.php';
const LINEUP_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchRotowireHtml() {
  return fetchUrl(ROTOWIRE_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
}

const VALID_POS = new Set(['PG', 'SG', 'SF', 'PF', 'C']);

// Parse a single team's <ul class="lineup__list ..."> block.
// Returns up to 5 starters with PG/SG/SF/PF/C labels.
function parseTeamList(listHtml) {
  const players = [];
  const rowRe = /<li class="lineup__player[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = rowRe.exec(listHtml)) !== null) {
    const row = m[1];
    const posMatch = row.match(/<div class="lineup__pos"[^>]*>([^<]+)<\/div>/);
    const linkMatch = row.match(/<a[^>]*title="([^"]+)"[^>]*href="\/basketball\/player\/([^"]+)"/);
    if (!posMatch || !linkMatch) continue;
    const pos = posMatch[1].trim().toUpperCase();
    if (!VALID_POS.has(pos)) continue;
    const injuryMatch = row.match(/lineup__inj is-([a-z]+)/);
    players.push({
      pos,
      name: linkMatch[1].trim(),
      slug: linkMatch[2].trim(),
      injuryStatus: injuryMatch ? injuryMatch[1].toUpperCase() : null,
    });
    if (players.length >= 5) break;
  }
  return players;
}

async function getNbaStartingLineups({ refresh = false } = {}) {
  const cacheKey = 'nba_lineups_rotowire';
  if (!refresh) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const html = await fetchRotowireHtml();

  // Each matchup is wrapped in a `<div class="lineup is-nba ...">` block.
  // Split the HTML on those boundaries so each block contains exactly one game.
  const blocks = [];
  const blockRe = /<div class="lineup is-nba[^"]*"[\s\S]*?(?=<div class="lineup is-nba[^"]*"|<footer|$)/g;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    blocks.push(m[0]);
  }

  const games = [];
  for (const block of blocks) {
    const abbrs = [...block.matchAll(/<div class="lineup__abbr">([A-Z]+)<\/div>/g)].map(x => x[1]);
    if (abbrs.length < 2) continue;
    const [awayAbbr, homeAbbr] = abbrs;

    const visitListM = block.match(/<ul class="lineup__list is-visit"[\s\S]*?<\/ul>/);
    const homeListM = block.match(/<ul class="lineup__list is-home"[\s\S]*?<\/ul>/);
    if (!visitListM || !homeListM) continue;

    const awayStatus = (visitListM[0].match(/lineup__status is-([a-z]+)/) || [])[1] || 'unknown';
    const homeStatus = (homeListM[0].match(/lineup__status is-([a-z]+)/) || [])[1] || 'unknown';

    games.push({
      awayAbbr,
      homeAbbr,
      away: {
        abbr: awayAbbr,
        status: awayStatus,
        starters: parseTeamList(visitListM[0]),
      },
      home: {
        abbr: homeAbbr,
        status: homeStatus,
        starters: parseTeamList(homeListM[0]),
      },
    });
  }

  const result = {
    source: 'rotowire',
    fetchedAt: new Date().toISOString(),
    games,
  };
  cacheSet(cacheKey, result, LINEUP_TTL);
  return result;
}

// Find a single matchup in the parsed lineups. Tries both team-order
// directions (away/home from the caller may not match Rotowire's labels
// since Rotowire orders games by start time, not by who-is-home).
function findGameLineup(parsed, awayAbbr, homeAbbr) {
  if (!parsed?.games) return null;
  const a = String(awayAbbr || '').toUpperCase();
  const h = String(homeAbbr || '').toUpperCase();
  // Rotowire abbreviations are mostly the same as ESPN's, with a few exceptions:
  // ESPN→Rotowire mismatches. Apply best-effort aliasing.
  const ALIAS = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', PHX: 'PHO' };
  const norm = x => ALIAS[x] || x;
  const an = norm(a);
  const hn = norm(h);
  for (const g of parsed.games) {
    if ((g.awayAbbr === an && g.homeAbbr === hn) || (g.awayAbbr === a && g.homeAbbr === h)) {
      return g;
    }
  }
  return null;
}

module.exports = {
  getNbaStartingLineups,
  findGameLineup,
};
