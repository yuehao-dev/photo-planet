'use strict';

const crypto = require('node:crypto');
const { isIP } = require('node:net');

const MAX_STATES = 10000;
// One HTTP/2 page load can open over a hundred authenticated resources.
const MAX_IP_PENDING = 256;
const MAX_KDFS = 2;
const MAX_KDF_QUEUE = 64;
const SUCCESS_CACHE_MS = 60000;
let activeKdfs = 0;
let peakKdfs = 0;
const waitingKdfs = [];

function validateAuthConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      typeof value.username !== 'string' || !/^[A-Za-z0-9_.@-]{1,64}$/.test(value.username) ||
      (value.usernameOnly !== undefined && typeof value.usernameOnly !== 'boolean') ||
      (value.caseInsensitive !== undefined && typeof value.caseInsensitive !== 'boolean') ||
      (value.sessionSecret !== undefined && (typeof value.sessionSecret !== 'string' || !/^[a-f0-9]{64}$/i.test(value.sessionSecret))) ||
      (value.usernameOnly !== true && (
        typeof value.passwordSalt !== 'string' || !/^[a-f0-9]{32,128}$/i.test(value.passwordSalt) ||
        typeof value.passwordHash !== 'string' || !/^[a-f0-9]{64}$/i.test(value.passwordHash)))) {
    throw new Error('Invalid authentication configuration');
  }
  const result = { username: value.username, usernameOnly: value.usernameOnly === true,
    caseInsensitive: value.caseInsensitive === true,
    ...(value.sessionSecret ? { sessionSecret: value.sessionSecret } : {}),
    ...(value.usernameOnly === true ? {} : { passwordSalt: value.passwordSalt, passwordHash: value.passwordHash.toLowerCase() }) };
  const basePath = value.basePath === undefined ? '/album/' : value.basePath;
  if (typeof basePath !== 'string' || !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(basePath)) throw new Error('Invalid base path');
  const publicOrigin = value.publicOrigin === undefined ? 'https://album.example.com' : value.publicOrigin;
  let origin;
  try { origin = new URL(publicOrigin); } catch { throw new Error('Invalid public origin'); }
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.origin !== publicOrigin) throw new Error('Invalid public origin');
  for (const [key, fallback] of [['loginTitle', '来照片星球坐坐。'], ['loginNote', '那些小小的开心，都收在这里。']]) {
    const text = value[key] === undefined ? fallback : value[key];
    if (typeof text !== 'string' || text.length > 100 || /[\x00-\x1f\x7f]/.test(text)) throw new Error('Invalid login text');
    result[key] = text;
  }
  result.basePath = basePath;
  result.publicOrigin = publicOrigin;
  for (const [key, fallback, max] of [['maxFailures', 5, 20], ['windowSeconds', 900, 86400], ['lockSeconds', 900, 86400]]) {
    const number = value[key] === undefined ? fallback : value[key];
    if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new Error('Invalid authentication limits');
    result[key] = number;
  }
  return Object.freeze(result);
}

function runKdf(password, salt) {
  return new Promise((resolve, reject) => {
    const task = () => {
      activeKdfs++;
      peakKdfs = Math.max(peakKdfs, activeKdfs);
      crypto.scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 24 * 1024 * 1024 }, (error, key) => {
        activeKdfs--;
        const next = waitingKdfs.shift();
        if (next) next();
        if (error) reject(new Error('Authentication temporarily unavailable'));
        else resolve(key);
      });
    };
    if (activeKdfs < MAX_KDFS) task();
    else if (waitingKdfs.length < MAX_KDF_QUEUE) waitingKdfs.push(task);
    else reject(new Error('Authentication temporarily unavailable'));
  });
}

function parseBasic(header) {
  if (typeof header !== 'string' || header.length > 2048) return null;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header);
  if (!match || match[1].length % 4 !== 0) return null;
  try {
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.toString('base64') !== match[1]) return null;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const colon = text.indexOf(':');
    if (colon < 1 || /[\x00-\x1f\x7f]/.test(text)) return null;
    return { username: text.slice(0, colon), password: text.slice(colon + 1) };
  } catch { return null; }
}

function createAuthGuard(input, { now = Date.now } = {}) {
  const config = validateAuthConfig(input);
  const expected = config.usernameOnly ? null : Buffer.from(config.passwordHash, 'hex');
  const states = new Map();
  let lastPrune = 0;
  let verifications = 0;
  const retentionMs = Math.max(config.windowSeconds, config.lockSeconds) * 1000 + SUCCESS_CACHE_MS;
  const cookieName = 'planet_session';
  function sessionValid(req) {
    if (!config.sessionSecret) return false;
    const token = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!token || token.length > 512) return false;
    const parts = token.split('.');
    if (parts.length !== 3 || !/^\d{10,13}$/.test(parts[0]) || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return false;
    const expires = Number(parts[0]);
    if (expires <= now() || expires > now() + 31 * 86400000) return false;
    const expected = crypto.createHmac('sha256', config.sessionSecret).update(config.username + ':' + parts[0] + '.' + parts[1]).digest();
    return crypto.timingSafeEqual(expected, Buffer.from(parts[2], 'hex'));
  }
  function sessionCookie(clear = false) {
    if (!config.sessionSecret) throw new Error('Session unavailable');
    const value = String(now() + 30 * 86400000) + '.' + crypto.randomBytes(16).toString('hex');
    const signature = crypto.createHmac('sha256', config.sessionSecret).update(config.username + ':' + value).digest('hex');
    return cookieName + '=' + (clear ? '' : value + '.' + signature) + '; Path=' + config.basePath + '; HttpOnly; Secure; SameSite=Strict; Max-Age=' + (clear ? '0' : '2592000');
  }

  function send(req, res, status, retryAfter) {
    const headers = { 'Cache-Control': 'private, no-store', 'Content-Length': '0' };
    if (status === 401 && !config.sessionSecret) headers['WWW-Authenticate'] = 'Basic realm="For Photo Planet", charset="UTF-8"';
    if (retryAfter !== undefined) headers['Retry-After'] = String(retryAfter);
    res.writeHead(status, headers);
    res.end();
    return status;
  }

  function prune(at) {
    if (at - lastPrune < 60000 && states.size < MAX_STATES) return;
    lastPrune = at;
    for (const [ip, state] of states) {
      if (state.pending === 0 && state.lockedUntil <= at && at - state.touched >= retentionMs) states.delete(ip);
    }
  }

  async function handle(req, res) {
    if (sessionValid(req)) return send(req, res, 200);
    const header = req.headers.authorization;
    if (header === undefined || header === '') return send(req, res, 401);
    const ip = req.headers['x-album-client-ip'];
    if (typeof ip !== 'string' || !isIP(ip)) return send(req, res, 503, 1);
    const at = now();
    prune(at);
    let state = states.get(ip);
    if (!state) {
      if (states.size >= MAX_STATES) return send(req, res, 503, 1);
      state = { failures: 0, windowStart: at, lockedUntil: 0, touched: at, pending: 0, chain: Promise.resolve(), verifiedHash: '', verifiedUntil: 0 };
      states.set(ip, state);
    }
    if (state.pending >= MAX_IP_PENDING) return send(req, res, 503, 1);
    state.pending++;
    const previous = state.chain;
    let release;
    state.chain = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      let current = now();
      state.touched = current;
      if (state.lockedUntil > current) return send(req, res, 403, Math.max(1, Math.ceil((state.lockedUntil - current) / 1000)));
      if (state.lockedUntil || current - state.windowStart >= config.windowSeconds * 1000) {
        state.failures = 0;
        state.lockedUntil = 0;
        state.windowStart = current;
      }
      const hash = typeof header === 'string' ? crypto.createHash('sha256').update(header).digest('hex') : '';
      if (hash && state.verifiedHash === hash && state.verifiedUntil > current) {
        state.failures = 0;
        state.windowStart = current;
        return send(req, res, 200);
      }
      const parsed = parseBasic(header);
      let valid = false;
      if (parsed) {
        const matchesUsername = config.caseInsensitive
          ? parsed.username.toLowerCase() === config.username.toLowerCase()
          : parsed.username === config.username;
        if (config.usernameOnly) valid = matchesUsername;
        else {
          let key;
          try { key = await runKdf(parsed.password, config.passwordSalt); verifications++; }
          catch { return send(req, res, 503, 1); }
          valid = crypto.timingSafeEqual(key, expected) && matchesUsername;
        }
      }
      current = now();
      state.touched = current;
      if (valid) {
        state.failures = 0;
        state.windowStart = current;
        state.verifiedHash = hash;
        state.verifiedUntil = current + SUCCESS_CACHE_MS;
        return send(req, res, 200);
      }
      state.failures++;
      if (state.failures >= config.maxFailures) {
        state.lockedUntil = current + config.lockSeconds * 1000;
        state.verifiedHash = '';
        state.verifiedUntil = 0;
        return send(req, res, 403, config.lockSeconds);
      }
      return send(req, res, 401);
    } catch { return send(req, res, 503, 1); }
    finally { state.pending--; release(); }
  }

  return Object.freeze({ handle, sessionCookie, settings: Object.freeze({ basePath: config.basePath, publicOrigin: config.publicOrigin, loginTitle: config.loginTitle, loginNote: config.loginNote, usernameOnly: config.usernameOnly }), snapshot: () => ({ states: states.size, verifications, activeKdfs, queuedKdfs: waitingKdfs.length, peakKdfs }) });
}

module.exports = { validateAuthConfig, createAuthGuard };
