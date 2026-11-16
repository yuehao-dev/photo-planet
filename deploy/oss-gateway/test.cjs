'use strict';

// Run with: node --test deploy/oss-gateway/test.cjs
// Synthetic data only. No network request reaches OSS.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { gunzipSync } = require('node:zlib');
const { createServer, sign, validateConfig } = require('./server.cjs');

const NOW = 1800000000000;
const PROCESS = 'image/auto-orient,1/resize,w_880/format,webp';
const original = () => ({
  endpoint: 'https://oss-cn-beijing.aliyuncs.com', bucket: 'demo-photo-planet',
  accessKeyId: 'fixture-access', accessKeySecret: 'fixture-secret-not-real',
  resources: {
    'public/photos/thumb/test.webp': { key: 'photo/目录/原图.jpg', process: PROCESS },
    'music/spring.ogg': { key: 'chatData/site-media/v1/music/spring.ogg' }
  },
  chatPrefix: 'chatData/releases/v1/',
  chatPaths: ['index.json', 'days/first.json', 'days/second.json']
});

async function start(t, options = {}) {
  const events = [];
  const server = await createServer({ config: original(), now: () => NOW, logger: value => events.push(value), ...options });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  function request(target, { method = 'GET', headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: target, method, headers }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      });
      req.on('error', reject); req.end();
    });
  }
  return { server, request, events };
}

test('OSS V1 fixed vectors cover Unicode keys, image processing and HEAD', () => {
  const config = validateConfig(original());
  const resource = { key: 'photo/目录/原图.jpg', process: PROCESS };
  for (const [method, expected] of [['GET', 'Cy9NbCp626cSvGFhknqqtRGOOKI='], ['HEAD', 'pr0Zep6eZhk/U2XVxkMYB15nncg=']]) {
    const url = new URL(sign(config, resource, { method, expires: 1800000300 }));
    assert.equal(url.origin, 'https://demo-photo-planet.oss-cn-beijing.aliyuncs.com');
    assert.equal(url.pathname, '/photo/%E7%9B%AE%E5%BD%95/%E5%8E%9F%E5%9B%BE.jpg');
    assert.equal(url.searchParams.get('Signature'), expected);
    assert.equal(url.searchParams.get('x-oss-process'), PROCESS);
    assert.equal(url.searchParams.get('Expires'), '1800000300');
  }
  const plain = new URL(sign(config, { key: 'photo/a b(1).jpg' }, { expires: 1800000300 }));
  assert.equal(plain.pathname, '/photo/a%20b%281%29.jpg');
  assert.equal(plain.searchParams.has('x-oss-process'), false);
});

test('configuration rejects endpoint, credential and path escapes', () => {
  const endpoints = ['http://oss-cn-beijing.aliyuncs.com', 'https://oss-cn-beijing.aliyuncs.com.evil.test',
    'https://evil.test@oss-cn-beijing.aliyuncs.com', 'https://oss-cn-beijing.aliyuncs.com:443',
    'https://oss-cn-beijing.aliyuncs.com/path', 'https://oss-cn-beijing.aliyuncs.com?x=1'];
  for (const endpoint of endpoints) assert.throws(() => validateConfig({ ...original(), endpoint }));
  for (const accessKeySecret of ['', 'bad\nsecret', undefined]) assert.throws(() => validateConfig({ ...original(), accessKeySecret }));
  for (const key of ['../escape', '/absolute', 'photo/../escape', 'photo//empty', 'photo\\escape', 'photo/%2e%2e/escape', 'photo/a?b']) {
    assert.throws(() => validateConfig({ ...original(), resources: { 'music/a': { key } } }));
  }
  assert.throws(() => validateConfig({ ...original(), resources: { '../outside': { key: 'photo/a' } } }));
  assert.throws(() => validateConfig({ ...original(), resources: { 'music/a': { key: 'photo/a', process: 'image/resize,w_1&evil=1' } } }));
  assert.throws(() => validateConfig({ ...original(), chatPrefix: '../outside/' }));
  assert.throws(() => validateConfig({ ...original(), chatPaths: ['../outside.json'] }));
  assert.throws(() => validateConfig({ ...original(), chatPaths: ['messages.jsonl'] }));
  assert.throws(() => validateConfig({ ...original(), chatObjects: { 'unlisted.json': 'chatData/old/unlisted.json' } }));
  assert.throws(() => validateConfig({ ...original(), chatObjects: { 'days/first.json': 'photo/first.json' } }));
  assert.throws(() => validateConfig({ ...original(), chatObjects: { 'days/first.json': 'chatData/../first.json' } }));
  assert.throws(() => validateConfig({ ...original(), chatObjects: { 'days/first.json': 'chatData/first.jsonl' } }));
  assert.throws(() => sign(validateConfig(original()), { key: 'photo/a' }, { method: 'DELETE' }));
});

test('media signs only an exact allowlisted mapping and ignores client queries', async t => {
  let fetched = 0;
  const { request } = await start(t, { fetchImpl: () => { fetched++; throw new Error('unexpected'); } });
  const response = await request('/media/public/photos/thumb/test.webp?x-oss-process=evil&key=private/secret&Signature=evil', {
    headers: { Authorization: 'Basic synthetic-browser-secret', Cookie: 'private=fixture' }
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, sign(validateConfig(original()), original().resources['public/photos/thumb/test.webp'], { expires: 1800000300 }));
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.equal(response.body.length, 0);
  assert.equal(fetched, 0);
  assert.equal((await request('/media/photo/unmapped.jpg')).status, 404);
  assert.equal((await request('/media/music/missing.ogg')).status, 404);
  const head = await request('/media/music/spring.ogg', { method: 'HEAD' });
  assert.equal(head.status, 302);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers.location, sign(validateConfig(original()), original().resources['music/spring.ogg'], { method: 'HEAD', expires: 1800000300 }));
});

test('resolved media returns a GET URL without fetching or exposing private configuration', async t => {
  const { request } = await start(t, { fetchImpl: () => { throw new Error('Unexpected upstream'); } });
  const response = await request('/media/public/photos/thumb/test.webp?resolve=1&key=private/escape&x-oss-process=bad');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  const body = JSON.parse(response.body);
  assert.deepEqual(Object.keys(body).sort(), ['expiresAt', 'url']);
  assert.equal(body.expiresAt, NOW / 1000 + 300);
  const url = new URL(body.url);
  assert.equal(decodeURIComponent(url.pathname), '/photo/目录/原图.jpg');
  assert.equal(url.searchParams.get('x-oss-process'), PROCESS);
  assert.equal(url.searchParams.get('Signature'), 'Cy9NbCp626cSvGFhknqqtRGOOKI=');
  assert.equal(response.body.includes(Buffer.from(original().accessKeySecret)), false);
  assert.equal((await request('/media/not-allowlisted?resolve=1')).status, 404);
  assert.equal((await request('/media/music/spring.ogg?resolve=1', { method: 'HEAD' })).status, 405);
  assert.equal((await request('/auth/check')).status, 503);
});

test('internal authentication route uses only its private guard and survives config validation', async t => {
  const salt = 'e101428345487ca9cfa2ac26cdf96e9b';
  const fixturePassword = 'synthetic-strong-pass';
  const auth = { username: 'fixture-user', passwordSalt: salt,
    passwordHash: crypto.scryptSync(fixturePassword, salt, 32).toString('hex'),
    maxFailures: 5, windowSeconds: 900, lockSeconds: 900 };
  const config = { ...original(), auth };
  const { request } = await start(t, { config });
  assert.equal((await request('/auth/check', { headers: { 'X-Album-Client-IP': '192.0.2.1' } })).status, 401);
  const response = await request('/auth/check', { headers: {
    'X-Album-Client-IP': '192.0.2.1', Authorization: 'Basic ' + Buffer.from('fixture-user:' + fixturePassword).toString('base64')
  } });
  assert.equal(response.status, 200);
  assert.equal(response.body.includes(Buffer.from(fixturePassword)), false);
});

test('raw traversal, malformed paths and methods never reach upstream', async t => {
  let fetched = 0;
  const { request } = await start(t, { fetchImpl: () => { fetched++; throw new Error('unexpected'); } });
  for (const target of ['/media/../music/spring.ogg', '/media/%2e%2e/music/spring.ogg',
    '/media/%252e%252e/music/spring.ogg', '/media/%2fprivate', '/media/%5cprivate',
    '/media/music//spring.ogg', '/media/music\\spring.ogg', '/media/%00', '/media/%xx',
    '//media/music/spring.ogg', 'http://evil.test/media/music/spring.ogg', '/data/chat/../index.json']) {
    assert.equal((await request(target)).status, 400, target);
  }
  assert.equal((await request('/media/music/spring.ogg', { method: 'POST' })).status, 405);
  assert.equal((await request('/data/chat/not-listed.json')).status, 404);
  assert.equal((await request('/data/chat/index.json/extra')).status, 404);
  assert.equal((await request('/not-a-route')).status, 404);
  assert.equal(fetched, 0);
  assert.deepEqual(JSON.parse((await request('/health')).body), { ok: true });
});

test('chat fetch is server-only, gzip/HEAD work, and immutable data is cached', async t => {
  const calls = [];
  const payload = JSON.stringify({ version: 1, messages: [{ text: 'synthetic fixture' }] });
  const { request } = await start(t, { fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(payload); } });
  const first = await request('/data/chat/days/first.json?key=private&Signature=bad', {
    headers: { Authorization: 'Basic private-browser-token', Cookie: 'private=fixture', 'Accept-Encoding': 'gzip' }
  });
  assert.equal(first.status, 200);
  assert.equal(first.headers['content-encoding'], 'gzip');
  assert.equal(gunzipSync(first.body).toString(), payload);
  assert.match(first.headers['cache-control'], /private.*immutable/);
  assert.equal(first.headers.location, undefined);
  assert.equal(calls.length, 1);
  const upstream = new URL(calls[0].url);
  assert.equal(upstream.pathname, '/chatData/releases/v1/days/first.json');
  assert.equal(upstream.searchParams.has('key'), false);
  assert.deepEqual(calls[0].options.headers, { Accept: 'application/json' });
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[0].options.method, 'GET');
  const head = await request('/data/chat/days/first.json', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers['content-length']), Buffer.byteLength(payload));
  assert.equal(head.body.length, 0);
  const cached = await request('/data/chat/days/first.json', { headers: { 'If-None-Match': first.headers.etag } });
  assert.equal(cached.status, 304);
  assert.equal(cached.body.length, 0);
  assert.equal(calls.length, 1);
  const noGzip = await request('/data/chat/days/first.json', { headers: { 'Accept-Encoding': 'gzip;q=0, identity' } });
  assert.equal(noGzip.headers['content-encoding'], undefined);
  assert.equal(noGzip.body.toString(), payload);
  const index = await request('/data/chat/index.json');
  await request('/data/chat/index.json');
  assert.match(index.headers['cache-control'], /no-cache/);
  assert.equal(calls.length, 3);
});

test('concurrent reads share a fetch and failed reads can be retried', async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const began = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const { request } = await start(t, { fetchImpl: async () => {
    calls++; started(); await gate;
    return new Response(calls === 1 ? 'invalid JSON' : '{"ok":true}');
  } });
  const first = request('/data/chat/days/first.json');
  await began;
  const second = request('/data/chat/days/first.json');
  // Allow the second HTTP request to join the pending upstream operation.
  await new Promise(resolve => setTimeout(resolve, 30)); release();
  assert.equal((await first).status, 502);
  assert.equal((await second).status, 502);
  assert.equal(calls, 1);
  assert.equal((await request('/data/chat/days/first.json')).status, 200);
  assert.equal(calls, 2);
});

test('oversized, invalid and failed upstream bodies produce sanitized errors', async t => {
  const cases = [
    () => new Response('tiny', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } }),
    () => new Response(Buffer.alloc(2 * 1024 * 1024 + 1, 32)),
    () => new Response('<Error>private object key</Error>', { status: 403 }),
    () => new Response('{"private":"incomplete'),
    () => new Response(new Uint8Array([123, 34, 255, 34, 58, 48, 125])),
    () => { throw new Error('https://secret.test/private?Signature=secret'); }
  ];
  let current = 0;
  const { request, events } = await start(t, { fetchImpl: async () => cases[current]() });
  for (; current < cases.length; current++) {
    const response = await request('/data/chat/days/first.json');
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(response.body), { error: 'temporarily_unavailable' });
    assert.equal(response.headers.location, undefined);
  }
  assert.deepEqual(events, Array(cases.length).fill('upstream_request_failed'));
});

test('upstream timeout aborts the request without exposing its URL', async t => {
  let aborted = false;
  const { request } = await start(t, { requestTimeoutMs: 30, fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => { aborted = true; reject(new Error('sensitive upstream timeout')); }, { once: true });
  }) });
  assert.equal((await request('/data/chat/index.json')).status, 502);
  assert.equal(aborted, true);
});

test('cache limit counts raw and gzip bytes and evicts least recently used data', async t => {
  const fixture = original();
  fixture.chatPaths = Array.from({ length: 9 }, (_, i) => `days/page-${i}.json`);
  const payload = JSON.stringify({ text: crypto.randomBytes(900 * 1024).toString('base64') });
  const counts = new Map();
  const { request } = await start(t, { config: fixture, fetchImpl: async url => {
    const name = new URL(url).pathname;
    counts.set(name, (counts.get(name) || 0) + 1);
    return new Response(payload);
  } });
  for (let i = 0; i < 7; i++) assert.equal((await request(`/data/chat/days/page-${i}.json`, { method: 'HEAD' })).status, 200);
  await request('/data/chat/days/page-0.json', { method: 'HEAD' });
  await request('/data/chat/days/page-7.json', { method: 'HEAD' });
  await request('/data/chat/days/page-0.json', { method: 'HEAD' });
  assert.equal(counts.get('/chatData/releases/v1/days/page-0.json'), 1);
  await request('/data/chat/days/page-1.json', { method: 'HEAD' });
  assert.equal(counts.get('/chatData/releases/v1/days/page-1.json'), 2);
});

test('configuration reload is atomic, clears cache, and retains a working config on failure', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'album-gateway-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(original()));
  const calls = [];
  const { server, request, events } = await start(t, { config: undefined, configPath, fetchImpl: async url => {
    const key = new URL(url).pathname; calls.push(key); return new Response(JSON.stringify({ generation: key.includes('/v1/') ? 1 : 2 }));
  } });
  assert.deepEqual(JSON.parse((await request('/data/chat/days/first.json')).body), { generation: 1 });
  const next = { ...original(), chatPrefix: 'chatData/releases/v2/' };
  await fs.writeFile(configPath, JSON.stringify(next));
  assert.equal(await server.reloadConfig(), true);
  assert.deepEqual(JSON.parse((await request('/data/chat/days/first.json')).body), { generation: 2 });
  await fs.writeFile(configPath, 'malformed synthetic config');
  assert.equal(await server.reloadConfig(), false);
  assert.deepEqual(JSON.parse((await request('/data/chat/days/second.json')).body), { generation: 2 });
  await fs.writeFile(configPath, JSON.stringify({ ...next, accessKeySecret: '' }));
  assert.equal(await server.reloadConfig(), false);
  assert.deepEqual(JSON.parse((await request('/data/chat/days/first.json')).body), { generation: 2 });
  assert.equal(calls.length, 3);
  assert.deepEqual(events, ['configuration_reloaded', 'configuration_reload_failed', 'configuration_reload_failed']);
});

test('a read started before reload cannot populate the new generation cache', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'album-gateway-race-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, 'config.json');
  await fs.writeFile(configPath, JSON.stringify(original()));
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { server, request } = await start(t, { config: undefined, configPath, fetchImpl: async url => {
    const old = new URL(url).pathname.includes('/v1/');
    if (old) { started(); await gate; }
    return new Response(JSON.stringify({ generation: old ? 1 : 2 }));
  } });
  const oldRequest = request('/data/chat/days/first.json');
  await began;
  await fs.writeFile(configPath, JSON.stringify({ ...original(), chatPrefix: 'chatData/releases/v2/' }));
  assert.equal(await server.reloadConfig(), true);
  assert.deepEqual(JSON.parse((await request('/data/chat/days/first.json')).body), { generation: 2 });
  release();
  assert.deepEqual(JSON.parse((await oldRequest).body), { generation: 1 });
  assert.deepEqual(JSON.parse((await request('/data/chat/days/first.json')).body), { generation: 2 });
});

test('CLI SIGHUP reload serves retained old day URLs and the new release index', { timeout: 20000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'album-gateway-sighup-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, 'config.json');
  const preload = path.join(dir, 'fake-oss.cjs');
  const oldDay = 'days/oldhash/first.json', newDay = 'days/newhash/first.json';
  await fs.writeFile(configPath, JSON.stringify({ ...original(), chatPaths: ['index.json', oldDay] }));
  // Execute the actual CLI and its installed SIGHUP handler, with all OSS traffic
  // replaced in the child process. Windows has no POSIX kill(SIGHUP); IPC emits
  // the equivalent Node signal event there. POSIX hosts send the real OS signal.
  await fs.writeFile(preload, `globalThis.fetch = async url => new Response(JSON.stringify({ key: new URL(url).pathname }));\nprocess.on('message', message => { if (message === 'fixture-sighup') process.emit('SIGHUP'); });\n`);
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['--require', preload, path.join(__dirname, 'server.cjs')], {
    env: { ...process.env, ALBUM_CONFIG: configPath, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'ignore', 'ipc'], windowsHide: true
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill(); await exited;
    }
  });
  let output = '';
  const waiters = [];
  child.stdout.on('data', chunk => {
    output += chunk.toString();
    for (const waiter of waiters) if (output.includes(waiter.text)) waiter.resolve();
  });
  const waitForOutput = text => output.includes(text) ? Promise.resolve() : new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Fixture child did not become ready')), 8000);
    waiters.push({ text, resolve: () => { clearTimeout(timeout); resolve(); } });
  });
  async function get(relative) {
    const response = await fetch(`http://127.0.0.1:${port}/data/chat/${relative}`);
    assert.equal(response.status, 200);
    return response.json();
  }
  await waitForOutput('gateway_ready');
  assert.deepEqual(await get(oldDay), { key: '/chatData/releases/v1/' + oldDay });
  await fs.writeFile(configPath, JSON.stringify({ ...original(), chatPrefix: 'chatData/releases/v2/',
    chatPaths: ['index.json', newDay, oldDay],
    chatObjects: { [oldDay]: 'chatData/releases/v1/' + oldDay } }));
  if (process.platform === 'win32') child.send('fixture-sighup');
  else child.kill('SIGHUP');
  await waitForOutput('configuration_reloaded');
  assert.deepEqual(await get('index.json'), { key: '/chatData/releases/v2/index.json' });
  assert.deepEqual(await get(newDay), { key: '/chatData/releases/v2/' + newDay });
  assert.deepEqual(await get(oldDay), { key: '/chatData/releases/v1/' + oldDay });
});
