'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createAuthGuard } = require('./auth.cjs');
const { login } = require('./login.cjs');
const crypto = require('node:crypto');

test('private login requires a password and respects the configured origin, cookie path and CSRF checks', async t => {
  const password = 'fixture-password-not-real', salt = '12'.repeat(32);
  const guard = createAuthGuard({ username: 'reader', usernameOnly: false, caseInsensitive: true,
    passwordSalt: salt, passwordHash: crypto.scryptSync(password, salt, 32).toString('hex'),
    loginTitle: '<朋友> & \"小屋\"', loginNote: '一起记录。',
    sessionSecret: '34'.repeat(32), publicOrigin: 'https://photos.example.org', basePath: '/memories/' });
  const server = http.createServer((req, res) => {
    req.headers['x-album-client-ip'] = '192.0.2.10';
    login(req, res, guard).catch(() => { res.writeHead(500); res.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const form = await (await fetch(base)).text();
  assert.match(form, /type="password"/);
  assert.ok(form.includes('&lt;朋友&gt; &amp; &quot;小屋&quot;'));
  assert.ok(!form.includes('<朋友>'));
  assert.match(form, /action="\/memories\/login"/);
  const post = (body, origin = 'https://photos.example.org') => fetch(base, { method: 'POST', redirect: 'manual',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  assert.equal((await post('account=reader')).status, 400);
  assert.equal((await post('account=reader&password=wrong')).status, 401);
  assert.equal((await post('account=reader&password=' + password, 'https://elsewhere.invalid')).status, 403);
  const response = await post('account=READER&password=' + password);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/memories/');
  assert.match(response.headers.get('set-cookie'), /Path=\/memories\/; HttpOnly; Secure/);
  assert.doesNotMatch(await response.text(), /fixture-password/);
});

test('unsafe deployment origins and path injection are rejected', () => {
  for (const patch of [{ publicOrigin: 'http://album.example.com' }, { publicOrigin: 'https://user:pass@album.example.com' },
    { publicOrigin: 'https://album.example.com/path' }, { basePath: '/album/; injected' }, { basePath: '//evil.example/' }]) {
    assert.throws(() => createAuthGuard({ username: 'demo', usernameOnly: true, ...patch }));
  }
});

test('account form has no password field; login sets session, rejects CSRF and retains lockout', async t => {
  const guard = createAuthGuard({ username: 'demo', usernameOnly: true, caseInsensitive: true, sessionSecret: 'a1'.repeat(32) });
  const server = http.createServer((req, res) => {
    req.headers['x-album-client-ip'] = '192.0.2.1';
    login(req, res, guard, req.url === '/logout').catch(() => { res.writeHead(500); res.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = await fetch(base);
  const html = await get.text();
  assert.equal(get.status, 200);
  assert.match(html, /name="account"/);
  assert.doesNotMatch(html, /type="password"|name="password"/);
  const post = (body, origin = 'https://album.example.com', path = '/') => fetch(base + path, {
    method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  assert.equal((await post('account=demo', 'https://elsewhere.invalid')).status, 403);
  const success = await post('account=demo');
  assert.equal(success.status, 303);
  assert.equal(success.headers.get('location'), '/album/');
  assert.match(success.headers.get('set-cookie'), /planet_session=.*HttpOnly; Secure; SameSite=Strict/);
  assert.equal(success.headers.get('www-authenticate'), null);
  const logout = await post('', 'https://album.example.com', '/logout');
  assert.equal(logout.status, 303);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  for (let i = 0; i < 4; i++) assert.equal((await post('account=wrong')).status, 401);
  const locked = await post('account=wrong');
  assert.equal(locked.status, 429);
  assert.equal(locked.headers.get('retry-after'), '900');
  assert.equal((await post('account=demo')).status, 429);
});
