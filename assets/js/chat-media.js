/* 聊天附件按需读取；媒体地址只由本站登录接口签发。 */
(() => {
  'use strict';
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const button = (text, action) => { const b = node('button', text, 'chat-inline-button'); b.type = 'button'; b.addEventListener('click', action); return b; };
  const labels = { me: '阿屿', her: '小夏', system: window.SITE_CONFIG?.people?.system || '那天的小记号', other: '分享里的人' };
  function syncLabels() { labels.me = window.PLANET_PREFS?.get('meName') || '阿屿'; labels.her = window.PLANET_PREFS?.get('herName') || '小夏'; }
  syncLabels(); document.addEventListener('preferences:change', syncLabels);
  let activePlayer = null, lazyGeneration = 0;
  const observers = new Map();
  const observed = new WeakMap();
  const signedTasks = new Map();
  function mediaURL(path) {
    if (typeof path !== 'string' || !/^chat-assets\/[a-f0-9]{64}\.[a-z0-9]{1,15}$/.test(path)) throw new Error('附件地址暂时不可用');
    return new URL('media/' + path, document.baseURI);
  }
  async function resolve(path, refresh = false) {
    mediaURL(path); // Validate even in local demo mode.
    const localBase = window.SITE_CONFIG?.chat?.localAssetBaseUrl;
    if (localBase) {
      const base = new URL(localBase.replace(/\/?$/, '/'), document.baseURI);
      const local = new URL(path, base);
      if (base.origin !== location.origin || local.origin !== location.origin || !local.pathname.startsWith(base.pathname)) throw new Error('附件地址暂时不可用');
      return local.href;
    }
    const source = mediaURL(path), saved = signedTasks.get(path);
    if (!refresh && saved && saved.expiresAt > Date.now() / 1000 + 30) return saved.url;
    source.search = '?resolve=1';
    const response = await fetch(source, { credentials: 'same-origin', cache: 'no-store', redirect: 'error' });
    if (!response.ok) throw new Error('这份附件暂时没打开，点一下重试');
    const value = await response.json(), url = new URL(value.url);
    const host = window.SITE_CONFIG?.media?.signedHost || '';
    if (url.protocol !== 'https:' || url.hostname !== host || url.port || url.username || url.password || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= Date.now() / 1000) throw new Error('附件地址暂时不可用');
    if (signedTasks.size >= 256) signedTasks.delete(signedTasks.keys().next().value);
    signedTasks.set(path, value); return url.href;
  }
  function lazy(el, action) {
    const generation = lazyGeneration;
    requestAnimationFrame(() => {
      if (!el.isConnected || generation !== lazyGeneration) return;
      if (!('IntersectionObserver' in window)) { action(); return; }
      const root = el.closest('.archive-scroll, .chat-reader-body');
      if (!observers.has(root)) observers.set(root, new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) { observers.get(root)?.unobserve(entry.target); const run = observed.get(entry.target); observed.delete(entry.target); run?.(); }
      }), { root, rootMargin: '450px 0px' }));
      observed.set(el, action); observers.get(root).observe(el);
    });
  }
  function pausePlayers(clearObservers = true) {
    if (activePlayer) activePlayer.pause();
    if (clearObservers) { lazyGeneration++; observers.forEach(io => io.disconnect()); observers.clear(); }
    document.dispatchEvent(new CustomEvent('chat:media-stop'));
  }
  function image(asset, compact = false) {
    const wrap = node('figure', undefined, 'chat-image');
    const img = node('img'); img.alt = asset.previewOnly ? '聊天里的预览图' : asset.animated ? '聊天里的动态表情' : '聊天里的图片';
    img.loading = 'lazy'; img.decoding = 'async'; img.crossOrigin = 'anonymous'; img.referrerPolicy = 'no-referrer';
    if (asset.width && asset.height) { img.width = asset.width; img.height = asset.height; }
    wrap.append(img);
    const load = async (path, refresh = false) => {
      wrap.classList.add('is-loading');
      try { img.src = await resolve(path, refresh); }
      catch (_) { wrap.classList.remove('is-loading'); if (!wrap.querySelector('button')) wrap.append(button('图片没打开，重试', () => load(path, true))); }
    };
    img.addEventListener('load', () => { wrap.classList.remove('is-loading'); wrap.querySelector('button')?.remove(); });
    img.addEventListener('error', () => { wrap.classList.remove('is-loading'); if (!wrap.querySelector('button')) wrap.append(button('图片没打开，重试', () => load(asset.thumb || asset.url, true))); });
    const openImage = () => load(asset.animated ? asset.url : asset.thumb || asset.url);
    if (window.PLANET_PREFS?.get('chatMedia') === 'tap' || window.PLANET_PREFS?.get('saver')) wrap.append(button('点一下，看看这张图', openImage));
    else lazy(wrap, openImage);
    img.addEventListener('click', () => {
      if (compact) return;
      const dialog = node('dialog', undefined, 'chat-image-dialog');
      const large = node('img'); large.alt = img.alt; large.crossOrigin = 'anonymous'; large.referrerPolicy = 'no-referrer';
      const close = button('收好这张 ×', () => dialog.close()); dialog.append(close, large);
      const note = node('p', asset.previewOnly ? '导出时只有这张预览图，放大可能有些模糊。' : '聊天里的一张照片'); dialog.append(note);
      document.body.append(dialog); dialog.addEventListener('close', () => dialog.remove(), { once: true }); dialog.showModal();
      resolve(asset.url).then(url => { large.src = url; }).catch(() => { note.textContent = '这张大图暂时没打开，关掉再试一次。'; });
    });
    if (asset.previewOnly) wrap.append(node('figcaption', '预览图'));
    return wrap;
  }
  function player(asset) {
    const video = asset.kind === 'video';
    const wrap = node('div', undefined, 'chat-player');
    const el = node(video ? 'video' : 'audio'); el.controls = true; el.preload = 'none'; el.crossOrigin = 'anonymous';
    if (video) { el.playsInline = true; el.setAttribute('playsinline', ''); }
    let preparedURL = null, preparedUntil = 0;
    async function prepare() { preparedURL = await resolve(asset.url, true); preparedUntil = Date.now() + 240000; }
    const start = button(video ? '播放这段视频 ▷' : '听听这条语音 ▷', async () => {
      start.disabled = true;
      try {
        if (!preparedURL || preparedUntil <= Date.now()) {
          await prepare(); start.textContent = video ? '准备好了，点一下播放视频 ▷' : '准备好了，点一下听语音 ▷'; return;
        }
        // Call play in the click gesture for iPhone/iPad; resolve only the address in advance.
        el.src = preparedURL; await el.play(); start.hidden = true;
      }
      catch (_) { start.textContent = '没能播放，点一下重试'; }
      finally { start.disabled = false; }
    });
    lazy(wrap, () => {
      prepare().catch(() => {});
      if (video && asset.thumb) resolve(asset.thumb).then(url => { el.poster = url; }).catch(() => {});
    });
    el.addEventListener('play', () => { if (activePlayer && activePlayer !== el) activePlayer.pause(); activePlayer = el; document.dispatchEvent(new CustomEvent('chat:media-play')); });
    const stopped = () => { if (activePlayer === el) { activePlayer = null; document.dispatchEvent(new CustomEvent('chat:media-stop')); } };
    el.addEventListener('pause', stopped); el.addEventListener('ended', stopped);
    el.addEventListener('error', () => { stopped(); preparedURL = null; start.hidden = false; start.textContent = '播放中断，点一下重新加载'; });
    wrap.append(el, start); return wrap;
  }
  function mediaList(message, container, options = {}) {
    for (const asset of (message.media || []).slice(0, 30)) {
      try {
        mediaURL(asset.url);
        if (asset.kind === 'image') container.append(image(asset, options.compact));
        else if (asset.kind === 'audio' || asset.kind === 'video') container.append(player(asset));
        else if (asset.kind === 'file') {
          const download = button(`下载 · ${asset.name || '这份文件'}`, async () => {
            download.disabled = true;
            try {
              const response = await fetch(await resolve(asset.url, true), { mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
              if (!response.ok) throw new Error();
              const blob = await response.blob(), url = URL.createObjectURL(blob), a = node('a'); a.href = url; a.download = asset.name || '附件'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
            } catch (_) { download.textContent = '下载没完成，点一下重试'; }
            finally { download.disabled = false; }
          }); container.append(download);
        }
      } catch (_) { container.append(node('small', '这条附件暂时无法读取', 'chat-attachment-note')); }
    }
    if (message.mediaNotice) container.append(node('small', message.mediaNotice, 'chat-attachment-note'));
  }
  async function jsonResource(path) {
    if (!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/.test(path)) throw new Error('Invalid path');
    const base = new URL((window.SITE_CONFIG?.chat?.baseUrl || 'data/chat/').replace(/\/?$/, '/'), document.baseURI);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(new URL(path, base), { credentials: 'same-origin', cache: 'default', signal: controller.signal });
      if (!response.ok) throw new Error('记录还没打开'); return await response.json();
    } finally { clearTimeout(timeout); }
  }
  function forwardNode(value, jump) {
    const details = node('details', undefined, 'chat-forward'); details.append(node('summary', `${value.title || '转来的聊天'} · ${value.count} 条`));
    const body = node('div'); details.append(body); let index, page = 0, busy = false;
    const more = button('接着翻转发的聊天', load);
    async function load() {
      if (busy) return; busy = true; more.disabled = true;
      try {
        index ||= await jsonResource(value.url);
        if (!Array.isArray(index.chunks) || index.chunks.length > 1000) throw new Error();
        const chunk = await jsonResource(index.chunks[page].url);
        if (!Array.isArray(chunk.messages) || chunk.messages.length > 40) throw new Error();
        more.remove();
        for (const message of chunk.messages) {
          const item = node('article', undefined, 'chat-forward-item'); item.append(node('b', message.sender === 'other' ? message.senderLabel || labels.other : labels[message.sender] || '分享里的人'), node('p', message.text || '一条记录'));
          render(message, item, { jump, compact: true }); body.append(item);
        }
        page++; if (page < index.chunks.length) body.append(more);
        if (value.truncated && page === index.chunks.length) body.append(node('small', '这份导出中的转发记录只保存了其中一部分'));
      } catch (_) { more.textContent = '这段没打开，点一下重试'; if (!more.isConnected) body.append(more); }
      finally { busy = false; more.disabled = false; }
    }
    details.addEventListener('toggle', () => { if (details.open && !index && !busy) load(); }); return details;
  }
  function render(message, container, { jump, compact = false } = {}) {
    mediaList(message, container, { compact });
    if (message.quote) {
      const q = message.quote, quote = node('blockquote', undefined, 'chat-quote');
      const sender = node('b', q.sender === 'other' ? q.senderLabel || labels.other : labels[q.sender] || '引用');
      if (['me', 'her'].includes(q.sender)) sender.dataset.senderLabel = q.sender;
      quote.append(sender, node('p', q.text || '引用了一条消息'));
      mediaList(q, quote, { compact: true });
      if (q.target && jump) quote.append(button('翻到原来那句 ↗', () => jump(q.target)));
      else if (q.targetMissing) quote.append(node('small', '原来那条暂未收录，这里保留了引用'));
      if (q.forward) quote.append(forwardNode(q.forward, jump));
      container.prepend(quote);
    }
    if (message.forward) container.append(forwardNode(message.forward, jump));
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) pausePlayers(false); });
  window.addEventListener('pagehide', () => pausePlayers(false));
  window.PLANET_CHAT_MEDIA = { render, pause: pausePlayers, resolve };
})();
