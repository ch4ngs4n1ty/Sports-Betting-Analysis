/* ═══════════════════════════════════════════════════════════
   NBA Player Position Map
   ESPN only exposes coarse G/F/C; we need PG/SG/SF/PF/C to
   compute "defense vs position" stats. Pulls every player's
   primary position from basketball-reference's season-wide
   per_game stats page (single fetch, 24h cache + disk persist).
═══════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const { fetchUrl } = require('../shared/http');
const { cacheGet, cacheSet } = require('../shared/cache');

const POSITION_TTL = 24 * 60 * 60 * 1000; // 24h
const CACHE_KEY = 'nba_position_map';
const DATA_DIR = path.join(__dirname, '..', 'data');
const DISK_PATH = path.join(DATA_DIR, 'nba-position-map.json');

function ensureDataDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (_) { /* exists */ }
}

function loadFromDisk() {
  try {
    const raw = fs.readFileSync(DISK_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (Date.now() - data.builtAt < POSITION_TTL) return data;
  } catch (_) { /* missing or stale */ }
  return null;
}

function saveToDisk(data) {
  try {
    ensureDataDir();
    fs.writeFileSync(DISK_PATH, JSON.stringify(data));
  } catch (err) {
    console.error('[nba/positions] disk write failed:', err.message);
  }
}

// "Luka Dončić" → "luka doncic" (no diacritics, no punct, no suffixes)
function normalizeName(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ').trim();
}

const VALID_POS = new Set(['PG', 'SG', 'SF', 'PF', 'C']);

async function fetchBasketballRefPositions(season) {
  const url = `https://www.basketball-reference.com/leagues/NBA_${season}_per_game.html`;
  const html = await fetchUrl(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  const map = {};
  // Each player row holds <td data-stat="name_display">…</td><td data-stat="pos">PG</td>…
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  const nameRe = /data-stat="name_display"[^>]*>(?:<a[^>]*>)?([^<]+)/;
  const posRe = /data-stat="pos"[^>]*>([A-Z]+)<\/td>/;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const row = m[1];
    const nameMatch = row.match(nameRe);
    const posMatch = row.match(posRe);
    if (!nameMatch || !posMatch) continue;
    const name = nameMatch[1].trim();
    if (name === 'Player') continue; // header row
    const pos = posMatch[1].trim();
    if (!VALID_POS.has(pos)) continue;
    const key = normalizeName(name);
    if (key) map[key] = { name, pos };
  }
  return map;
}

// Parse season string like "2025-26" → year used by basketball-reference URL ("2026")
function brSeasonForKey(seasonKey) {
  const m = String(seasonKey || '').match(/(\d{4})-(\d{2})/);
  if (!m) return new Date().getFullYear();
  return Number(m[1]) + 1; // basketball-reference uses end-year
}

// Current NBA season key like "2025-26"
function getCurrentSeasonKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // NBA season starts in October. Before October, we're in the previous season.
  if (month >= 10) return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
  return `${year - 1}-${String(year % 100).padStart(2, '0')}`;
}

async function getPositionMap({ refresh = false, season = null } = {}) {
  const seasonKey = season || getCurrentSeasonKey();
  const cacheKey = `${CACHE_KEY}_${seasonKey}`;

  if (!refresh) {
    const memCached = cacheGet(cacheKey);
    if (memCached) return memCached;
    const diskCached = loadFromDisk();
    if (diskCached && diskCached.season === seasonKey) {
      cacheSet(cacheKey, diskCached, POSITION_TTL);
      return diskCached;
    }
  }

  const brSeason = brSeasonForKey(seasonKey);
  const map = await fetchBasketballRefPositions(brSeason);
  const data = {
    season: seasonKey,
    builtAt: Date.now(),
    source: 'basketball-reference',
    count: Object.keys(map).length,
    map,
  };
  cacheSet(cacheKey, data, POSITION_TTL);
  saveToDisk(data);
  return data;
}

// Resolve a player name → specific position (PG/SG/SF/PF/C) or null.
// Tries exact normalized match first, then last-name match if unique.
function resolvePosition(playerName, positionMap) {
  if (!playerName || !positionMap?.map) return null;
  const m = positionMap.map;
  const fullKey = normalizeName(playerName);
  if (m[fullKey]) return m[fullKey].pos;
  // Last-name fallback (only when unambiguous)
  const last = fullKey.split(' ').slice(-1)[0];
  if (last) {
    const matches = Object.entries(m).filter(([k]) => k.endsWith(' ' + last) || k === last);
    if (matches.length === 1) return matches[0][1].pos;
  }
  return null;
}

module.exports = {
  getPositionMap,
  resolvePosition,
  normalizeName,
  getCurrentSeasonKey,
  VALID_POS,
};
