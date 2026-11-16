'use strict';

// This process is reachable only through the authenticated Nginx locations.
const http = require('node:http');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const nodePath = require('node:path');
const { gzip } = require('node:zlib');
const { promisify } = require('node:util');
const { validateAuthConfig, createAuthGuard } = require('./auth.cjs');
const { login } = require('./login.cjs');

const gzipAsync = promisify(gzip);
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const MAX_CONFIG_BYTES = 32 * 1024 * 1024;
const MAX_FETCHES = 8;

function relativePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 &&
    !/[\\%?#\x00-\x1f\x7f]/.test(value) &&
    value.split('/').every(part => part && part !== '.' && part !== '..');
}

function processValue(value) {
  return value === undefined || (typeof value === 'string' &&
    /^[A-Za-z0-9_,/.:-]{1,2048}$/.test(value));
}

function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid configuration');
  // Restrict credentials to an official regional OSS service endpoint.
  if (typeof input.endpoint !== 'string' ||
      !/^https:\/\/oss-[a-z0-9]+(?:-[a-z0-9]+)*\.aliyuncs\.com\/?$/.test(input.endpoint)) {
    throw new Error('Invalid endpoint');
  }
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(input.bucket || '')) throw new Error('Invalid bucket');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.accessKeyId || '') ||
      typeof input.accessKeySecret !== 'string' ||
      !/^[^\s\x00-\x1f\x7f]{1,256}$/.test(input.accessKeySecret)) throw new Error('Invalid credentials');
  if (!input.resources || typeof input.resources !== 'object' || Array.isArray(input.resources)) throw new Error('Invalid resources');
  const resources = new Map();
  for (const [path, resource] of Object.entries(input.resources)) {
    if (!relativePath(path) || !resource || typeof resource !== 'object' || Array.isArray(resource) ||
        !relativePath(resource.key) || !processValue(resource.process)) throw new Error('Invalid resource');
    resources.set(path, Object.freeze({ key: resource.key, ...(resource.process === undefined ? {} : { process: resource.process }) }));
  }
  if (typeof input.chatPrefix !== 'string' || !input.chatPrefix.endsWith('/') ||
      !relativePath(input.chatPrefix.slice(0, -1))) throw new Error('Invalid chat prefix');
  if (!Array.isArray(input.chatPaths)) throw new Error('Invalid chat paths');
  const chatPaths = new Set();
  for (const path of input.chatPaths) {
    if (!relativePath(path) || !path.endsWith('.json') ||
        !relativePath(input.chatPrefix + path)) throw new Error('Invalid chat path');
    chatPaths.add(path);
  }
  const chatObjects = new Map();
  if (input.chatObjects !== undefined) {
    if (!input.chatObjects || typeof input.chatObjects !== 'object' || Array.isArray(input.chatObjects)) throw new Error('Invalid chat objects');
    for (const [path, key] of Object.entries(input.chatObjects)) {
      if (!chatPaths.has(path) || !relativePath(key) || !key.startsWith('chatData/') || !key.endsWith('.json')) throw new Error('Invalid chat object');
      chatObjects.set(path, key);
    }
  }
  if (input.mediaRegistry !== undefined && !/^[a-f0-9]{24}$/.test(input.mediaRegistry)) throw new Error('Invalid media registry');
  return Object.freeze({
    endpoint: input.endpoint.replace(/\/$/, ''), bucket: input.bucket,
    accessKeyId: input.accessKeyId, accessKeySecret: input.accessKeySecret,
    resources, chatPrefix: input.chatPrefix, chatPaths, chatObjects, mediaRegistry: input.mediaRegistry,
    auth: input.auth === undefined ? undefined : validateAuthConfig(input.auth)
  });
}

const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// OSS V1 signs the unescaped object key and process value, then URL-encodes them.
function sign(config, resource, { method = 'GET', expires = Math.floor(Date.now() / 1000) + 300 } = {}) {
  if (!['GET', 'HEAD'].includes(method) || !Number.isSafeInteger(expires) || expires <= 0 ||
      !resource || !relativePath(resource.key) || !processValue(resource.process)) throw new Error('Invalid signing input');
  const canonical = '/' + config.bucket + '/' + resource.key +
    (resource.process === undefined ? '' : '?x-oss-process=' + resource.process);
  const signature = crypto.createHmac('sha1', config.accessKeySecret)
    .update(method + '\n\n\n' + expires + '\n' + canonical).digest('base64');
  const query = [
    ['OSSAccessKeyId', config.accessKeyId], ['Expires', String(expires)], ['Signature', signature],
    ...(resource.process === undefined ? [] : [['x-oss-process', resource.process]])
  ].map(([key, value]) => encode(key) + '=' + encode(value)).join('&');
  const host = new URL(config.endpoint).hostname;
  return 'https://' + config.bucket + '.' + host + '/' + resource.key.split('/').map(encode).join('/') + '?' + query;
}

async function readConfig(path) {
  if (!path) throw new Error('Missing configuration');
  if ((await fs.stat(path)).size > MAX_CONFIG_BYTES) throw new Error('Configuration too large');
  const bytes = await fs.readFile(path);
  if (bytes.length > MAX_CONFIG_BYTES) throw new Error('Configuration too large');
  return validateConfig(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')));
}

function requestPath(target) {
  if (typeof target !== 'string' || target.length > 8192 || !target.startsWith('/') ||
      target.startsWith('//') || target.includes('#')) return null;
  const raw = target.split('?', 1)[0];
  if (/%(?:2f|5c)/i.test(raw)) return null;
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  return relativePath(decoded.slice(1)) ? decoded : null;
}

function acceptsGzip(value = '') {
  return value.split(',').some(entry => {
    const [name, ...params] = entry.trim().toLowerCase().split(';');
    if (name.trim() !== 'gzip') return false;
    const quality = params.find(param => /^\s*q\s*=/.test(param));
    return !quality || Number(quality.split('=')[1]) > 0;
  });
}

function reply(req, res, status, value, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': bytes.length,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers
  });
  res.end(req.method === 'HEAD' ? undefined : bytes);
}

async function createServer({
  config, configPath = process.env.ALBUM_CONFIG,
  fetchImpl = globalThis.fetch, now = Date.now,
  logger = event => process.stdout.write(JSON.stringify({ event }) + '\n'),
  requestTimeoutMs = 15000
  , mediaIndexRoot = process.env.ALBUM_MEDIA_INDEX_ROOT || '/run/album/media-index'
} = {}) {
  const log = event => { try { logger(event); } catch { /* Logging must not break serving. */ } };
  const makeState = value => ({ config: value, cache: new Map(), cacheBytes: 0, inflight: new Map(),
    mediaShards: new Map(), mediaShardTasks: new Map(),
    authGuard: value.auth === undefined ? null : createAuthGuard(value.auth, { now }) });
  let state = makeState(config === undefined ? await readConfig(configPath) : validateConfig(config));
  let reloadTask = null;

  async function mediaResource(snapshot, name) {
    const configured = snapshot.config.resources.get(name);
    if (configured) return configured;
    if (!snapshot.config.mediaRegistry || !/^chat-assets\/[a-f0-9]{64}\.[a-z0-9]{1,15}$/.test(name)) return null;
    const filename = name.slice('chat-assets/'.length), prefix = filename.slice(0, 2);
    let shard = snapshot.mediaShards.get(prefix);
    if (!shard) {
      let task = snapshot.mediaShardTasks.get(prefix);
      if (!task) {
        if (snapshot.mediaShardTasks.size >= 8) throw new Error('Media registry busy');
        task = (async () => {
          const file = nodePath.join(mediaIndexRoot, snapshot.config.mediaRegistry, prefix + '.json');
          if ((await fs.stat(file)).size > 512 * 1024) throw new Error('Media shard too large');
          const raw = await fs.readFile(file);
          if (raw.length > 512 * 1024) throw new Error('Media shard too large');
          const parsed = JSON.parse(raw);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length > 1000) throw new Error('Invalid media shard');
          const checked = new Map();
          for (const [route, resource] of Object.entries(parsed)) {
            if (!/^[a-f0-9]{64}\.[a-z0-9]{1,15}$/.test(route) || !route.startsWith(prefix) || !resource ||
                !relativePath(resource.key) || !/^(?:photo\/|chatData\/media\/)/.test(resource.key) || !processValue(resource.process)) throw new Error('Invalid media entry');
            checked.set(route, Object.freeze({ key: resource.key, ...(resource.process === undefined ? {} : { process: resource.process }) }));
          }
          while (snapshot.mediaShards.size >= 8) snapshot.mediaShards.delete(snapshot.mediaShards.keys().next().value);
          snapshot.mediaShards.set(prefix, checked); return checked;
        })().finally(() => snapshot.mediaShardTasks.delete(prefix));
        snapshot.mediaShardTasks.set(prefix, task);
      }
      shard = await task;
    } else { snapshot.mediaShards.delete(prefix); snapshot.mediaShards.set(prefix, shard); }
    return shard.get(filename) || null;
  }

  function remember(snapshot, path, entry) {
    // index.json can change between imports; versioned data is immutable.
    if (path === 'index.json') return;
    const size = entry.raw.length + entry.gzip.length;
    while (snapshot.cacheBytes + size > MAX_CACHE_BYTES && snapshot.cache.size) {
      const oldest = snapshot.cache.keys().next().value;
      const removed = snapshot.cache.get(oldest);
      snapshot.cache.delete(oldest);
      snapshot.cacheBytes -= removed.raw.length + removed.gzip.length;
    }
    snapshot.cache.set(path, entry);
    snapshot.cacheBytes += size;
  }

  async function readJSON(snapshot, path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    let reader;
    try {
      const key = snapshot.config.chatObjects.get(path) || snapshot.config.chatPrefix + path;
      const url = sign(snapshot.config, { key }, { expires: Math.floor(now() / 1000) + 60 });
      // No browser request headers, cookies, or Basic credentials are forwarded.
      // Redirects are rejected so server credentials cannot leave the configured OSS host.
      const response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json' }
      });
      if (!response.ok || !response.body) throw new Error('Upstream unavailable');
      const length = response.headers.get('content-length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_JSON_BYTES)) throw new Error('Upstream too large');
      reader = response.body.getReader();
      const parts = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_JSON_BYTES) throw new Error('Upstream too large');
        parts.push(Buffer.from(value));
      }
      const raw = Buffer.concat(parts, size);
      // Validate UTF-8 and JSON instead of reflecting an OSS HTML/XML error body.
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      const compressed = await gzipAsync(raw);
      const entry = {
        raw, gzip: compressed,
        etag: 'W/"' + crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32) + '"'
      };
      remember(snapshot, path, entry);
      return entry;
    } finally {
      clearTimeout(timeout);
      // Cancel a rejected or oversized body promptly; never log its content.
      controller.abort();
      if (reader) { try { await reader.cancel(); } catch {} }
    }
  }

  async function chat(req, res, snapshot, path) {
    let entry = snapshot.cache.get(path);
    if (entry) {
      snapshot.cache.delete(path);
      snapshot.cache.set(path, entry);
    } else {
      let task = snapshot.inflight.get(path);
      if (!task) {
        if (snapshot.inflight.size >= MAX_FETCHES) return reply(req, res, 503, { error: 'busy' }, { 'Retry-After': '1' });
        task = readJSON(snapshot, path).finally(() => snapshot.inflight.delete(path));
        snapshot.inflight.set(path, task);
      }
      entry = await task;
    }
    if (res.destroyed) return;
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': path === 'index.json' ? 'private, no-cache, max-age=0, must-revalidate' : 'private, max-age=2592000, immutable',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      Vary: 'Accept-Encoding', ETag: entry.etag
    };
    if ((req.headers['if-none-match'] || '').split(',').map(v => v.trim()).includes(entry.etag)) {
      res.writeHead(304, headers); res.end(); return;
    }
    const useGzip = acceptsGzip(req.headers['accept-encoding']);
    const bytes = useGzip ? entry.gzip : entry.raw;
    if (useGzip) headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, { ...headers, 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const path = requestPath(req.url);
      if (!path) return reply(req, res, 400, { error: 'invalid_path' });
      if (path === '/auth/login' || path === '/auth/logout') {
        if (!state.authGuard) return reply(req, res, 503, { error: 'authentication_unavailable' });
        return await login(req, res, state.authGuard, path === '/auth/logout');
      }
      if (!['GET', 'HEAD'].includes(req.method)) return reply(req, res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, HEAD' });
      if (path === '/health') return reply(req, res, 200, { ok: true });
      const snapshot = state;
      if (path === '/auth/check' || path === '/auth/session') {
        if (!snapshot.authGuard) return reply(req, res, 503, { error: 'authentication_unavailable' });
        return await snapshot.authGuard.handle(req, res);
      }
      if (path.startsWith('/media/')) {
        const resource = await mediaResource(snapshot, path.slice('/media/'.length));
        if (!resource) return reply(req, res, 404, { error: 'not_found' });
        // Native players may request another byte range well into a long recording.
        const longMedia = resource.key.startsWith('chatData/media/audio/') || resource.key.startsWith('chatData/media/video/');
        const expiresAt = Math.floor(now() / 1000) + (longMedia ? 3600 : 300);
        const resolveURL = new URL(req.url, 'http://gateway.invalid').searchParams.get('resolve') === '1';
        if (resolveURL) {
          if (req.method !== 'GET') return reply(req, res, 405, { error: 'method_not_allowed' }, { Allow: 'GET' });
          return reply(req, res, 200, { url: sign(snapshot.config, resource, { method: 'GET', expires: expiresAt }), expiresAt });
        }
        const location = sign(snapshot.config, resource, { method: req.method, expires: expiresAt });
        res.writeHead(302, { Location: location, 'Content-Length': '0',
          'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
        res.end(); return;
      }
      if (path.startsWith('/data/chat/')) {
        const relative = path.slice('/data/chat/'.length);
        if (!snapshot.config.chatPaths.has(relative)) return reply(req, res, 404, { error: 'not_found' });
        return await chat(req, res, snapshot, relative);
      }
      reply(req, res, 404, { error: 'not_found' });
    } catch {
      log('upstream_request_failed');
      if (!res.headersSent && !res.destroyed) reply(req, res, 502, { error: 'temporarily_unavailable' });
      else res.destroy();
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  server.reloadConfig = () => {
    if (reloadTask) return reloadTask;
    reloadTask = readConfig(configPath).then(next => {
      state = makeState(next);
      log('configuration_reloaded');
      return true;
    }).catch(() => { log('configuration_reload_failed'); return false; })
      .finally(() => { reloadTask = null; });
    return reloadTask;
  };
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('gateway_start_failed\n'); process.exitCode = 1;
  } else {
    createServer().then(server => {
      process.on('SIGHUP', () => { void server.reloadConfig(); });
      server.on('error', () => { process.stderr.write('gateway_server_failed\n'); process.exitCode = 1; });
      server.listen(port, '0.0.0.0', () => process.stdout.write('gateway_ready\n'));
    }).catch(() => { process.stderr.write('gateway_start_failed\n'); process.exitCode = 1; });
  }
}

module.exports = { createServer, sign, validateConfig };
