/* ═══════════════════════════════════════════════════════════
   PlayIQ — Security helpers (zero dependency)
   In-memory rate limiting + input validation/sanitization.
   The backend has no DB, no auth, and no user data — these guard
   against abuse of the public read-only data proxy and against
   malformed input reaching upstream (MLB/ESPN/Savant) URLs.
═══════════════════════════════════════════════════════════ */

// ── Client IP (Render/most PaaS put the real IP in x-forwarded-for) ──
function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// ── Sliding-window rate limiter (per ip + bucket) ──
const _hits = new Map(); // "bucket:ip" -> number[] (timestamps)

function rateLimit(ip, { limit, windowMs, bucket = 'g' }) {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  let arr = _hits.get(key);
  if (!arr) { arr = []; _hits.set(key, arr); }
  while (arr.length && now - arr[0] > windowMs) arr.shift();
  if (arr.length >= limit) return false;
  arr.push(now);
  return true;
}

// Periodic prune so the map can't grow unbounded from unique IPs.
const _pruneTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of _hits) {
    while (arr.length && now - arr[0] > 120000) arr.shift();
    if (arr.length === 0) _hits.delete(k);
  }
}, 120000);
if (_pruneTimer.unref) _pruneTimer.unref();

// ── Validators for params that get interpolated into upstream URLs ──
// (positive integer ids, ISO dates, seasons). Reject clearly-malformed input.
const isIntId  = v => typeof v === 'string' && /^\d{1,12}$/.test(v);
const isYmd    = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isSeason = v => typeof v === 'string' && /^\d{4}(-\d{2})?$/.test(v);

// Free-text params (team/player names) are only used for matching, never
// interpolated raw into a URL path. We don't allow-list charset (that would
// break accented names like "Pena"/"Jose"); instead we drop ASCII control
// chars + HTML angle brackets and cap length to stop injection/abuse.
function cleanText(v, max = 80) {
  if (v == null) return undefined;
  let out = '';
  const src = String(v);
  for (let i = 0; i < src.length && out.length < max; i++) {
    const c = src[i];
    const code = src.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) continue; // control chars
    if (c === '<' || c === '>') continue;       // HTML-ish
    out += c;
  }
  out = out.trim();
  return out || undefined;
}

module.exports = {
  getClientIp,
  rateLimit,
  isIntId,
  isYmd,
  isSeason,
  cleanText,
};
