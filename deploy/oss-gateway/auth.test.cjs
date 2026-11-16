'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateAuthConfig, createAuthGuard } = require('./auth.cjs');
const salt = '11'.repeat(24);
const config = { username: 'example-user', passwordSalt: salt, passwordHash: crypto.scryptSync('example-password', salt, 32).toString('hex') };
const basic = (username = config.username, password = 'example-password') => 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
const call = async (guard, header, ip = '192.0.2.1') => {
  const result = {};
  const response = { writeHead(status, headers) { result.status = status; result.headers = headers; }, end() { result.ended = true; } };
  await guard.handle({ headers: { ...(header === undefined ? {} : { authorization: header }), 'x-album-client-ip': ip } }, response);
  assert.equal(result.ended, true);
  return result;
};

test('validates and freezes bounded configuration', () => {
  assert.equal(Object.isFrozen(validateAuthConfig(config)), true);
  assert.equal(validateAuthConfig(config).maxFailures, 5);
  for (const patch of [{ username: '' }, { passwordSalt: 'short' }, { passwordHash: 'x'.repeat(64) }, { maxFailures: 0 }, { lockSeconds: 86401 }, { windowSeconds: NaN }]) assert.throws(() => validateAuthConfig({ ...config, ...patch }));
});

test('missing credentials challenge without consuming attempts', async () => {
  const guard = createAuthGuard(config);
  for (let i = 0; i < 20; i++) assert.equal((await call(guard)).status, 401);
  assert.equal(guard.snapshot().states, 0);
  assert.match((await call(guard)).headers['WWW-Authenticate'], /^Basic /);
  assert.equal((await call(guard, basic())).status, 200);
});

test('username-only login ignores case and password but retains IP lockout', async () => {
  let clock = 100000;
  const guard = createAuthGuard({ username: 'demo', usernameOnly: true, caseInsensitive: true }, { now: () => clock });
  assert.equal((await call(guard)).status, 401);
  for (const name of ['demo', 'demo', 'demo', 'demo']) {
    assert.equal((await call(guard, basic(name, ''))).status, 200);
  }
  assert.equal((await call(guard, basic('demo', 'ignored'))).status, 200);
  assert.equal(guard.snapshot().verifications, 0);
  for (let i = 0; i < 4; i++) assert.equal((await call(guard, basic('wrong', ''))).status, 401);
  assert.equal((await call(guard, basic('wrong', ''))).status, 403);
  assert.equal((await call(guard, basic('demo', ''))).status, 403);
  clock += 900001;
  assert.equal((await call(guard, basic('demo', ''))).status, 200);
});

test('signed browser sessions expire and reject tampering without a password challenge', async () => {
  let clock = 1700000000000;
  const guard = createAuthGuard({ username: 'demo', usernameOnly: true, caseInsensitive: true, sessionSecret: 'ab'.repeat(32) }, { now: () => clock });
  assert.equal((await call(guard)).headers['WWW-Authenticate'], undefined);
  const cookie = guard.sessionCookie().split(';')[0];
  assert.match(guard.sessionCookie(), /HttpOnly; Secure; SameSite=Strict/);
  async function session(value) {
    let status;
    await guard.handle({ headers: { cookie: value, 'x-album-client-ip': '192.0.2.1' } }, { writeHead(code) { status = code; }, end() {} });
    return status;
  }
  assert.equal(await session(cookie), 200);
  assert.equal(await session(cookie.slice(0, -1) + (cookie.endsWith('0') ? '1' : '0')), 401);
  assert.equal(await session('planet_session=malformed'), 401);
  clock += 30 * 86400000 + 1;
  assert.equal(await session(cookie), 401);
  assert.match(guard.sessionCookie(true), /Max-Age=0/);
});

test('fifth failed attempt locks IP even when changing username; valid password cannot bypass', async () => {
  let clock = 100000;
  const guard = createAuthGuard(config, { now: () => clock });
  for (let i = 0; i < 4; i++) assert.equal((await call(guard, basic('different-' + i, 'wrong'))).status, 401);
  const fifth = await call(guard, basic('different-final', 'wrong'));
  assert.equal(fifth.status, 403);
  assert.equal(fifth.headers['Retry-After'], '900');
  clock += 1500;
  const locked = await call(guard, basic());
  assert.equal(locked.status, 403);
  assert.equal(locked.headers['Retry-After'], '899');
  assert.equal((await call(guard, basic(), '192.0.2.2')).status, 200);
  clock += 900000;
  assert.equal((await call(guard, basic())).status, 200);
});

test('failures expire outside the window and successful access resets counts', async () => {
  let clock = 100000;
  const guard = createAuthGuard(config, { now: () => clock });
  for (let i = 0; i < 4; i++) await call(guard, basic('user', 'wrong'));
  clock += 900001;
  assert.equal((await call(guard, basic('user', 'wrong'))).status, 401);
  assert.equal((await call(guard, basic())).status, 200);
  for (let i = 0; i < 4; i++) assert.equal((await call(guard, basic('user', 'wrong'))).status, 401);
});

test('concurrent failed requests serialize counters without threshold bypass', async () => {
  const guard = createAuthGuard(config);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => call(guard, basic('user-' + i, 'wrong'))));
  assert.deepEqual(results.map(r => r.status), [401, 401, 401, 401, 403, 403, 403, 403, 403, 403]);
  assert.equal(guard.snapshot().verifications, 5);
});

test('concurrent valid resources share a successful credential cache', async () => {
  let clock = 100000;
  const guard = createAuthGuard(config, { now: () => clock });
  const results = await Promise.all(Array.from({ length: 12 }, () => call(guard, basic())));
  assert.equal(results.every(r => r.status === 200), true);
  assert.equal(guard.snapshot().verifications, 1);
  clock += 60001;
  assert.equal((await call(guard, basic())).status, 200);
  assert.equal(guard.snapshot().verifications, 2);
});

test('malformed Basic consumes failed attempts but absent or invalid trusted IP cannot allocate state', async () => {
  const guard = createAuthGuard(config);
  for (const value of ['Bearer opaque', 'Basic ====','Basic '+Buffer.from('no-colon').toString('base64'), 'Basic '+Buffer.from('u:\u0000').toString('base64')]) assert.equal((await call(guard, value)).status, 401);
  assert.equal((await call(guard, 'not-basic')).status, 403);
  assert.equal((await call(guard, basic(), 'spoofed, 192.0.2.1')).status, 503);
  assert.equal((await call(guard, basic(), '')).status, 503);
  assert.equal(guard.snapshot().states, 1);
});

test('scrypt pool and queues stay bounded during parallel distinct IP traffic', async () => {
  const guard = createAuthGuard(config);
  const pending = Array.from({ length: 80 }, (_, i) => call(guard, basic('other', 'wrong'), '198.51.100.' + (i + 1)));
  const during = guard.snapshot();
  assert.ok(during.activeKdfs <= 2 && during.queuedKdfs <= 64);
  const results = await Promise.all(pending);
  assert.equal(results.some(r => r.status === 503), true);
  assert.equal(results.every(r => [401, 503].includes(r.status)), true);
  assert.ok(guard.snapshot().peakKdfs <= 2);
});

test('IP request queues are bounded and idle state is pruned', async () => {
  let clock = 100000;
  const guard = createAuthGuard(config, { now: () => clock });
  const results = await Promise.all(Array.from({ length: 270 }, () => call(guard, basic())));
  assert.equal(results.filter(r => r.status === 503).length, 14);
  assert.equal(guard.snapshot().states, 1);
  clock += 1000000;
  await call(guard, basic(), '192.0.2.2');
  assert.equal(guard.snapshot().states, 1);
});
