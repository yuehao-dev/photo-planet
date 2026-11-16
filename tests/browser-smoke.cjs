'use strict';
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const report = { passed: false, checks: [], errors: [], externalRequests: [], skipped: [] };
function check(name, condition) { assert.ok(condition, name); report.checks.push(name); console.log('PASS ' + name); }
const types = { '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.html': 'text/html', '.webp': 'image/webp', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.wav': 'audio/wav' };
const server = http.createServer((req, res) => {
  let name; try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); res.end(); return; }
  name = name.replace(/^\/demo-site\//, '/');
  const file = path.resolve(root, '.' + (name.endsWith('/') ? name + 'index.html' : name));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
let browser;
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const engine = process.env.TEST_BROWSER === 'webkit' ? webkit : chromium;
    browser = await engine.launch({ headless: true, ...(process.env.TEST_BROWSER_EXECUTABLE ? { executablePath: process.env.TEST_BROWSER_EXECUTABLE } : {}) });
    for (const [name, width, height, prefix] of [['phone', 390, 844, '/'], ['tablet-subpath', 820, 1180, '/demo-site/']]) {
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
      if (process.env.FORCE_AAC === '1') await context.addInitScript(() => {
        const native = HTMLMediaElement.prototype.canPlayType;
        HTMLMediaElement.prototype.canPlayType = function(type) { return type.includes('audio/ogg') ? '' : native.call(this, type); };
      });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      const pending = new Set();
      page.on('pageerror', e => report.errors.push(e.name));
      page.on('request', req => { pending.add(req); if (!req.url().startsWith(origin) && !/^(?:blob:|data:)/.test(req.url())) report.externalRequests.push(new URL(req.url()).hostname); });
      page.on('requestfinished', req => pending.delete(req)); page.on('requestfailed', req => pending.delete(req));
      await page.goto(origin + prefix); await page.waitForFunction(() => window.PLANET_APP?.photos.length === 24);
      check(name + ': demo album loads 24 fictional illustrations', await page.locator('.card').count() === 24);
      await page.waitForFunction(() => document.querySelector('#heroA').naturalWidth > 0);
      check(name + ': hero art renders locally', true);
      check(name + ': no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.locator('#sticker').click();
      check(name + ': ticket confetti works', await page.locator('.ticket-confetti i').count() === 28);
      await page.evaluate(() => PLANET_APP.toggleFav(PLANET_APP.photos[3].id));
      check(name + ': favorite hero prioritizes starred art', await page.evaluate(() => document.querySelector('#heroA').dataset.photoId === PLANET_APP.photos[3].id));
      await page.evaluate(() => PLANET_PREFS.patch({ theme: 'sage', columns: '3', fit: 'contain' }));
      check(name + ': personal settings apply', await page.locator('html').getAttribute('data-theme') === 'sage');
      await page.evaluate(() => PLANET_APP.openPhoto(PLANET_APP.photos[0].id));
      await page.waitForSelector('.lb.is-open'); await page.waitForFunction(() => document.querySelector('.lb-frame img')?.naturalWidth > 0);
      check(name + ': large photo opens', true);
      await page.waitForSelector('.chat-preview-open[data-chat-action="open"]:not([hidden])');
      await page.locator('.chat-preview-open[data-chat-action="open"]').click(); await page.waitForSelector('.chat-panel .chat-message');
      check(name + ': per-photo chat still works', true);
      await page.locator('.chat-panel-close').click(); await page.locator('.lb-close').click();
      const webAudioAvailable = await page.evaluate(() => !!(window.AudioContext || window.webkitAudioContext));
      await page.locator('#musicToggle').click();
      if (webAudioAvailable) {
        await page.waitForFunction(() => document.querySelector('#musicDock').dataset.state === 'playing', null, { timeout: 45000 });
        check(name + ': bundled AI music decodes and plays', true);
        await page.evaluate(() => document.dispatchEvent(new CustomEvent('season:change', { detail: { season: 'summer', source: 'test' } })));
        await page.waitForTimeout(1000);
        await page.locator('#musicToggle').click();
      } else {
        check(name + ': missing Web Audio leaves album usable', await page.locator('#musicDock').getAttribute('data-state') === 'error');
        report.skipped.push(name + ': actual music playback (test engine has no Web Audio API)');
      }
      // Avoid navigating while image/audio fetches are still being canceled in WebKit.
      for (let i = 0; i < 100 && pending.size; i++) await page.waitForTimeout(100);
      await page.goto(origin + prefix + 'chat.html?date=2025-03-08');
      await page.waitForSelector('.archive-messages .chat-message');
      check(name + ': independent chat loads no album or music', await page.evaluate(() => !window.PLANET_APP && !document.querySelector('script[src*="photos.js"],script[src*="music.js"]')));
      check(name + ': chat settings survive navigation', await page.locator('html').getAttribute('data-theme') === 'sage');
      await page.waitForFunction(() => document.querySelector('.chat-image img')?.naturalWidth > 0);
      check(name + ': fictional chat image renders', true);
      const nativeAudioAvailable = await page.evaluate(() => !!document.createElement('audio').canPlayType('audio/wav'));
      if (nativeAudioAvailable) {
        const audioButton = page.locator('.chat-player button').first();
        await audioButton.scrollIntoViewIfNeeded();
        await page.waitForTimeout(350); await audioButton.click();
        await page.waitForFunction(() => { const b = document.querySelector('.chat-player button'); return b && !b.disabled; });
        if (!(await audioButton.isHidden())) await audioButton.click();
        await page.waitForFunction(() => { const a = document.querySelector('.chat-player audio'); return a?.currentTime > 0 || a?.ended; });
        check(name + ': synthetic audio attachment plays', true);
      } else {
        check(name + ': audio attachment remains on-demand', await page.locator('.chat-player audio').getAttribute('preload') === 'none');
        report.skipped.push(name + ': native audio playback (test engine has no WAV codec)');
      }
      await page.locator('#searchText').fill('柠檬汽水'); await page.locator('#searchSubmit').click();
      await page.waitForSelector('.reader-result');
      check(name + ': selected-day search returns results', true);
      await page.locator('.reader-result').first().click(); await page.waitForSelector('.is-quote-target');
      check(name + ': result opens original context', true);
      await page.locator('#lastMessage').click(); await page.waitForTimeout(200);
      check(name + ': chat DOM stays bounded', await page.locator('.archive-messages .chat-message').count() <= 240);
      await page.locator('#firstMessage').click(); await page.waitForTimeout(250);
      await page.evaluate(() => PLANET_PREFS.patch({ theme: 'cream', columns: 'auto' }));
      if (name === 'phone') {
        fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
        await page.locator('#searchText').fill('');
        await page.screenshot({ path: path.join(root, 'docs/chat-demo.png'), animations: 'disabled' });
        for (let i = 0; i < 100 && pending.size; i++) await page.waitForTimeout(100);
        await page.goto(origin + prefix); await page.waitForFunction(() => window.PLANET_APP?.photos.length === 24 && document.querySelector('#heroA').naturalWidth > 0);
        await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(root, 'docs/album-demo.png'), animations: 'disabled' });
      }
      for (let i = 0; i < 100 && pending.size; i++) await page.waitForTimeout(100);
      await context.close();
    }
    check('no private cloud or external requests', report.externalRequests.length === 0);
    check('no browser script errors', report.errors.length === 0);
    report.passed = true;
  } catch (error) { report.error = error.message.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 200); process.exitCode = 1; }
  finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
    const folder = path.join(root, 'test-results'); fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `browser-${process.env.TEST_BROWSER || 'chromium'}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, errors: report.errors, error: report.error }));
  }
})();
