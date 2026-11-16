'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function load(overrides = {}, saved = new Map()) {
  const document = { addEventListener() {}, querySelectorAll: () => [], documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} } }, body: { dataset: {} }, dispatchEvent() {} };
  const window = { addEventListener() {} };
  const context = vm.createContext({ window, document, location: new URL('https://album.example/album/'), URL, localStorage: { getItem: k => saved.get(k) || null, setItem: (k, v) => saved.set(k, v) }, CustomEvent: class {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'config/site.js'), 'utf8'), context);
  Object.assign(window.SITE_CONFIG, overrides);
  for (const file of ['site-config.js', 'preferences.js', 'photo-dates.js']) vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', file), 'utf8'), context);
  return { window, document, saved };
}
test('site defaults change while only explicit browser choices persist', () => {
  const first = load({ people: { her: '桃桃', me: '树树' }, site: { title: '回忆小屋', nameSuffix: '的' } });
  assert.equal(first.document.title, '桃桃的回忆小屋');
  first.window.PLANET_PREFS.patch({ theme: 'sage' });
  const second = load({ people: { her: '星星', me: '月亮' } }, first.saved);
  assert.equal(second.window.PLANET_PREFS.get('herName'), '星星');
  assert.equal(second.window.PLANET_PREFS.get('theme'), 'sage');
  second.window.PLANET_PREFS.reset();
  assert.equal(second.window.PLANET_PREFS.get('theme'), 'cream');
});
test('literal replacements are non-cascading, nested and leave identifiers and URLs intact', () => {
  const { window } = load({ chat: { textReplacements: [{ from: 'A.*', to: 'B' }, { from: 'B', to: 'C' }], senderAliases: { her: ['旧昵称'] } } });
  const original = { id: 'A.*', text: 'A.* B Ax', quote: { sender: '旧昵称', text: 'A.*' }, link: { url: 'https://example.com/A.*', title: 'A.*' } };
  const out = window.PLANET_CONFIG.transformMessage(original);
  assert.equal(out.text, 'B C Ax'); assert.equal(out.id, original.id);
  assert.equal(out.quote.sender, 'her'); assert.equal(out.link.title, 'B');
  assert.equal(out.link.url, original.link.url); assert.equal(original.text, 'A.* B Ax');
});
test('photo linkage respects explicit override, manual chat date and full-day fallback', () => {
  const { window } = load({ chat: { photoDateOverrides: { p: '2025-06-08' } } });
  const choose = window.PLANET_CONFIG.photoChatDate;
  assert.equal(choose({ id: 'p', chatDate: '2025-03-08', takenAt: '2025-09-08' }), '2025-06-08');
  assert.equal(choose({ id: 'q', chatDate: '2025-03-08', takenAt: '2025-09-08' }), '2025-03-08');
  assert.equal(choose({ id: 'q', takenAt: '2025-09-08T12:00:00' }), '2025-09-08');
  assert.equal(choose({ id: 'q', takenAt: '2025-09' }), null);
  window.SITE_CONFIG.chat.photoDateFallback = false;
  assert.equal(choose({ id: 'q', takenAt: '2025-09-08' }), null);
});
test('custom seasons cover all months and invalid numeric tuning uses safe bounds', () => {
  const { window } = load({ seasons: { months: { spring: [9,10,11], summer: [12,1,2], autumn: [3,4,5], winter: [6,7,8] } } });
  assert.equal(window.PLANET_DATES.fromMonth(1), 'summer');
  assert.equal(window.PLANET_DATES.fromMonth(0), null);
  assert.equal(window.PLANET_CONFIG.number(Infinity, 4, 1, 6), 4);
  assert.equal(window.PLANET_CONFIG.number(100, 4, 1, 6), 6);
});
