'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../../assets/js/media.js'), 'utf8');
const base = 'https://album.example/album/';
function setup(fetch, media = {}) {
  const window = { SITE_CONFIG: { media: { signedUrls: true, signedHost: 'demo-photo-planet.oss-cn-beijing.aliyuncs.com', photoBaseUrl: 'media/', musicBaseUrl: 'media/music/', ...media } } };
  const context = vm.createContext({ window, location: new URL(base), document: { addEventListener() {}, baseURI: base }, fetch, Headers, URL, Date, TypeError, Error });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../assets/js/site-config.js'), 'utf8'), context);
  vm.runInContext(source, context);
  return window.PLANET_MEDIA.fetch;
}
const temporary = () => ({ url: 'https://demo-photo-planet.oss-cn-beijing.aliyuncs.com/music/test.ogg?Expires=fixture&Signature=fixture', expiresAt: Math.floor(Date.now() / 1000) + 300 });

test('media uses separate authenticated resolution then credential-free direct CORS fetch', async () => {
  const calls = [], controller = new AbortController();
  const response = new Response('audio');
  const read = setup(async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(JSON.stringify(temporary())) : response;
  });
  assert.equal(await read('media/music/test.ogg?old=1', { signal: controller.signal, headers: { Authorization: 'Basic synthetic', Cookie: 'synthetic=1', Range: 'bytes=0-5' } }), response);
  assert.equal(calls[0].url, base + 'media/music/test.ogg?resolve=1');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.mode, 'same-origin');
  assert.equal(calls[1].options.credentials, 'omit');
  assert.equal(calls[1].options.mode, 'cors');
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[1].options.referrerPolicy, 'no-referrer');
  assert.equal(calls[1].options.headers.has('Authorization'), false);
  assert.equal(calls[1].options.headers.has('Cookie'), false);
  assert.equal(calls[1].options.headers.get('Range'), 'bytes=0-5');
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[1].options.signal, controller.signal);
});

test('local, external and unrelated URLs retain original fetch behavior', async () => {
  let calls = [];
  const native = async (...args) => { calls.push(args); return new Response('local'); };
  const options = { signal: new AbortController().signal };
  const local = setup(native, { signedUrls: false });
  await local('media/music/test.ogg', options);
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'media/music/test.ogg'); assert.equal(calls[0][1], options);
  const enabled = setup(native);
  for (const value of ['https://other.example/music.ogg', 'blob:https://album.example/fixture', 'data:audio/wav;base64,fixture', 'assets/local.ogg']) await enabled(value, options);
  assert.equal(calls.length, 5);
  assert.equal(calls[4][0], 'assets/local.ogg');
});

test('untrusted, expired or failed media resolution cannot trigger a second request', async () => {
  for (const data of [{ ...temporary(), url: 'https://evil.example/track' }, { ...temporary(), url: 'https://demo-photo-planet.oss-cn-beijing.aliyuncs.com.evil.example/track' },
    { ...temporary(), url: 'https://user:password@demo-photo-planet.oss-cn-beijing.aliyuncs.com/track' },
    { ...temporary(), url: 'http://demo-photo-planet.oss-cn-beijing.aliyuncs.com/track' }, { ...temporary(), expiresAt: 1 }]) {
    let calls = 0;
    const read = setup(async () => { calls++; return new Response(JSON.stringify(data)); });
    await assert.rejects(read('media/music/test.ogg'));
    assert.equal(calls, 1);
  }
  const read = setup(async () => new Response('unauthorized', { status: 401 }));
  await assert.rejects(read('media/music/test.ogg'));
});
