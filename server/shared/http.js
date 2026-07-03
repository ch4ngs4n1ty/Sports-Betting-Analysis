const http = require('http');
const https = require('https');
const { URL } = require('url');

function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'PlayIQ/1.0',
        ...options.headers,
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode}: ${url}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

async function fetchJson(url) {
  const text = await fetchUrl(url);
  return JSON.parse(text);
}

// Public read-only data API: CORS defaults to "*" (no cookies/auth to protect).
// Set CORS_ORIGIN in the environment to lock it to a specific origin if desired.
const ALLOW_ORIGIN = process.env.CORS_ORIGIN || '*';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    ...CORS_HEADERS,
  });
  res.end(JSON.stringify(data));
}

function sendError(res, message, status = 400) {
  sendJson(res, { error: message }, status);
}

module.exports = {
  http,
  URL,
  fetchUrl,
  fetchJson,
  sendJson,
  sendError,
  CORS_HEADERS,
};
