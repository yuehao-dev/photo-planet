/* 照片旁的聊天纸条。按天、按段取数据；与音乐播放器互不干扰。 */
(() => {
  'use strict';
  const copy = window.SITE_CONFIG?.site || {};
  const CFG = window.SITE_CONFIG?.chat || {};
  const enabled = CFG.enabled !== false;
  const previewCount = Math.round(window.PLANET_CONFIG.number(CFG.previewLines, 6, 1, 12));
  const base = new URL((CFG.baseUrl || 'data/chat/').replace(/\/?$/, '/'), document.baseURI);
  const wide = matchMedia('(min-width: 1000px)');
  const positions = new Map();
  const labels = { me: '阿屿', her: '小夏', system: window.SITE_CONFIG?.people?.system || '那天的小记号' };
  function syncLabels() { labels.me = window.PLANET_PREFS?.get('meName') || '阿屿'; labels.her = window.PLANET_PREFS?.get('herName') || '小夏'; }
  syncLabels();
  document.addEventListener('preferences:change', syncLabels);
  let root, preview, previewDate, previewLines, previewHint, previewOpen, previewEdit;
  let panel, panelDate, panelThumb, panelTitle, panelBody, panelRange, previous, next, jumpNear, toggleButton, panelClose;
  let photo = null, currentDate = null, currentDay = null, currentDayUrl = '', currentChunk = -1, nearestChunk = 0, nearTime = null;
  let active = false, serial = 0, readerSerial = 0, readerWanted = false, focusBeforeReader = null, scrollTimer;
  const node = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  const button = (text, cls, click) => { const el = node('button', text, cls); el.type = 'button'; if (click) el.addEventListener('click', click); return el; };
  function trimCache(cache, limit) { while (cache.size > limit) cache.delete(cache.keys().next().value); }
  function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && window.PLANET_DATES?.valid(value); }
  function chooseDate(p) {
    return window.PLANET_CONFIG.photoChatDate(p);
  }
  function shotTime(p, date) {
    if (p.dateSource !== 'exif' || p.takenAt?.slice(0, 10) !== date || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(p.takenAt)) return null;
    const value = Date.parse(p.takenAt + '+08:00') / 1000;
    return Number.isFinite(value) ? value : null;
  }
  const { getIndex, getDay, getChunk } = window.PLANET_CHAT_DATA;
  function closest(messages, time) {
    if (time == null) return 0;
    let result = 0, distance = Infinity;
    messages.forEach((m, i) => { const d = Math.abs(m.timestamp - time); if (d < distance) { distance = d; result = i; } });
    return result;
  }
  function layout() { root?.dispatchEvent(new CustomEvent('chat:layout', { bubbles: true })); }
  function remember() {
    clearTimeout(scrollTimer);
    if (!currentDayUrl || currentChunk < 0 || !root?.classList.contains('chat-reading')) return;
    positions.delete(currentDayUrl);
    positions.set(currentDayUrl, { chunk: currentChunk, top: panelBody.scrollTop });
    trimCache(positions, 100);
  }
  function setCollapsed(value) {
    if (!root) return;
    if (value) closeReader(false);
    root.classList.toggle('chat-collapsed', value);
    toggleButton.setAttribute('aria-expanded', String(!value));
    toggleButton.textContent = value ? '那天的话' : '收起纸条';
    if (value) { preview.hidden = true; } else { preview.hidden = root.classList.contains('chat-reading'); }
    layout();
  }
  function editDate() {
    if (!photo) return;
    window.PLANET_CONTROLS?.editPhoto(photo);
  }
  function renderEmpty(title, description) {
    previewLines.replaceChildren(node('p', title, 'chat-empty-title'));
    previewHint.textContent = description;
    previewOpen.hidden = true; previewEdit.hidden = false;
    if (root.classList.contains('chat-reading')) {
      panelBody.replaceChildren(node('p', title, 'chat-reader-empty'), node('p', description, 'chat-reader-note'), button('给这张，记一笔', 'chat-inline-button', editDate));
      previous.disabled = next.disabled = true; panelRange.textContent = ''; jumpNear.hidden = true;
      panel.querySelectorAll('[data-chat-jump]').forEach(el => { el.disabled = true; });
    }
  }
  function renderLoading() {
    previewLines.replaceChildren(node('p', '把那天的话，慢慢翻出来…', 'chat-empty-title'));
    previewHint.textContent = '';
    previewOpen.hidden = true; previewEdit.hidden = true;
    preview.setAttribute('aria-busy', 'true');
    if (root.classList.contains('chat-reading')) { panelBody.replaceChildren(node('p', '正在翻到这一天…', 'chat-reader-empty')); panelRange.textContent = ''; previous.disabled = next.disabled = true; }
  }
  function renderError(error) {
    previewLines.replaceChildren(node('p', error.message || '这页暂时没打开。', 'chat-empty-title'), button('再试一次', 'chat-inline-button', () => show(photo, true)));
    previewHint.textContent = '照片和旋律会继续陪着你。'; previewOpen.hidden = true; previewEdit.hidden = true;
    if (root.classList.contains('chat-reading')) {
      panelBody.replaceChildren(node('p', error.message || '这页暂时没打开。', 'chat-reader-empty'), button('再试一次', 'chat-inline-button', () => show(photo, true)));
      previous.disabled = next.disabled = true; panelRange.textContent = '';
    }
  }
  async function show(p, force = false) {
    if (!enabled || !root || !p) return;
    window.PLANET_CHAT_MEDIA?.pause();
    quoteReturn = null; if (quoteBack) quoteBack.hidden = true;
    remember(); active = true; photo = p;
    const token = ++serial; ++readerSerial;
    currentDate = chooseDate(p); nearTime = shotTime(p, currentDate);
    currentDay = null; currentDayUrl = ''; currentChunk = -1;
    const dateText = currentDate ? currentDate.replaceAll('-', '.') : '日期还没记下';
    previewDate.textContent = dateText; panelDate.textContent = dateText;
    panelThumb.src = p.thumbUrl; panelThumb.alt = '正在看的这张照片';
    panelTitle.textContent = validDate(p.chatDate) && p.chatDate !== p.takenAt?.slice(0, 10) ? (copy.photoChatMappedTitle || '配给这张的，那天的话') : (copy.photoChatReaderTitle || '那天，我们说过的话');
    if (!currentDate) {
      preview.removeAttribute('aria-busy');
      renderEmpty('还差一个日子，就能翻到那天的话。', '补记日期，或选一天想配给这张照片的聊天。');
      return;
    }
    renderLoading();
    try {
      const index = await getIndex(force);
      if (!active || token !== serial) return;
      const entry = index.days[currentDate];
      if (!entry) {
        renderEmpty('这一天的聊天，暂时还没收进来。', '可以先留着，也可以给这张照片配上另一天的话。');
        return;
      }
      const date = currentDate;
      const day = await getDay(entry.url, date);
      if (!active || token !== serial) return;
      currentDay = day; currentDayUrl = entry.url;
      nearestChunk = nearTime == null ? 0 : day.chunks.findIndex(c => c.endTime >= nearTime);
      if (nearestChunk < 0) nearestChunk = day.chunks.length - 1;
      const chunk = await getChunk(day, nearestChunk);
      if (!active || token !== serial) return;
      let sample = chunk.messages.slice();
      let near = closest(sample, nearTime);
      if (near < 2 && nearestChunk > 0) {
        const prev = await getChunk(day, nearestChunk - 1);
        if (!active || token !== serial) return;
        sample = prev.messages.slice(-3).concat(sample); near += Math.min(3, prev.messages.length);
      }
      if (near + previewCount > sample.length && nearestChunk + 1 < day.chunks.length) {
        const after = await getChunk(day, nearestChunk + 1);
        if (!active || token !== serial) return;
        sample = sample.concat(after.messages.slice(0, previewCount));
      }
      if (nearTime != null) near = closest(sample, nearTime);
      const from = Math.max(0, Math.min(near - (nearTime == null ? 0 : 2), sample.length - previewCount));
      const fragment = document.createDocumentFragment();
      sample.slice(from, from + previewCount).forEach(message => {
        const line = node('div', undefined, 'chat-preview-line');
        const senderLabel = node('b', labels[message.sender]); senderLabel.dataset.senderLabel = message.sender;
        line.append(senderLabel, node('span', message.text || '一个小记号'));
        fragment.append(line);
      });
      previewLines.replaceChildren(fragment);
      previewDate.textContent = `${dateText} · ${day.count.toLocaleString('zh-CN')} 条消息`;
      previewHint.textContent = nearTime == null ? '从这一天的开头，轻轻翻几句。' : '按拍摄时间，翻到附近的几句话。';
      previewOpen.hidden = false; previewEdit.hidden = true;
      panelDate.textContent = `${dateText} · ${day.count.toLocaleString('zh-CN')} 条`;
      jumpNear.hidden = nearTime == null;
      panel.querySelectorAll('[data-chat-jump]').forEach(el => { el.disabled = false; });
      if (readerWanted || root.classList.contains('chat-reading')) {
        const remembered = positions.get(currentDayUrl);
        await loadReader(remembered?.chunk ?? nearestChunk, remembered ? { top: remembered.top } : { near: nearTime });
      }
    } catch (error) { if (active && token === serial) renderError(error); }
    finally { if (active && token === serial) preview.removeAttribute('aria-busy'); }
  }
  const messageNode = message => window.PLANET_CHAT_RENDER.messageNode(message, { jump: jumpToQuote });
  async function loadReader(index, position = {}) {
    if (!currentDay || !active) return;
    window.PLANET_CHAT_MEDIA?.pause();
    const day = currentDay, dayUrl = currentDayUrl, token = ++readerSerial;
    const requested = Math.max(0, Math.min(day.chunks.length - 1, index));
    panelBody.setAttribute('aria-busy', 'true'); previous.disabled = next.disabled = true;
    panelBody.replaceChildren(node('p', '这几句马上就来…', 'chat-reader-empty'));
    panelBody.scrollTop = 0;
    try {
      const chunk = await getChunk(day, requested);
      if (!active || token !== readerSerial || currentDayUrl !== dayUrl) return;
      currentChunk = requested;
      const fragment = document.createDocumentFragment(); chunk.messages.forEach(m => fragment.append(messageNode(m)));
      panelBody.replaceChildren(fragment);
      const start = chunk.startIndex + 1, end = chunk.startIndex + chunk.messages.length;
      panelRange.textContent = `${start}—${end} / ${day.count.toLocaleString('zh-CN')} 条`;
      previous.disabled = requested === 0; next.disabled = requested >= day.chunks.length - 1;
      if (position.top !== undefined) panelBody.scrollTop = position.top;
      else if (position.targetId) {
        const target = panelBody.querySelector(`[data-message-id="${CSS.escape(position.targetId)}"]`);
        if (target) { target.classList.add('is-quote-target'); panelBody.scrollTop = Math.max(0, target.offsetTop - panelBody.offsetTop - 18); }
      }
      else if (position.end) panelBody.scrollTop = panelBody.scrollHeight;
      else if (position.near != null) {
        const target = panelBody.children[closest(chunk.messages, position.near)];
        if (target) panelBody.scrollTop = Math.max(0, target.offsetTop - panelBody.offsetTop - 14);
      }
      remember();
    } catch (error) {
      if (active && token === readerSerial) {
        panelBody.replaceChildren(node('p', error.message, 'chat-reader-empty'), button('重新翻这一段', 'chat-inline-button', () => loadReader(requested, position)));
        panelRange.textContent = '这一段暂时没打开';
        previous.disabled = requested === 0; next.disabled = requested >= day.chunks.length - 1;
        currentChunk = requested;
      }
    } finally { if (token === readerSerial) panelBody.removeAttribute('aria-busy'); }
  }
  let quoteReturn = null, quoteBack;
  async function jumpToQuote(target) {
    if (!target || !validDate(target.date) || !Number.isInteger(target.chunk) || target.chunk < 0 || !/^m_[a-f0-9]{32}$/.test(target.id)) return;
    const token = ++readerSerial;
    const previousPlace = { date: currentDate, day: currentDay, url: currentDayUrl, chunk: currentChunk, top: panelBody.scrollTop, label: panelDate.textContent };
    try {
      const index = await getIndex();
      const entry = index.days[target.date]; if (!entry) throw new Error('原来那天的记录暂未收录');
      const day = await getDay(entry.url, target.date);
      if (!active || token !== readerSerial) return;
      const targetChunk = Object.hasOwn(day.messageChunks || {}, target.id) ? day.messageChunks[target.id] : target.chunk;
      if (!Number.isInteger(targetChunk) || !day.chunks[targetChunk]) throw new Error('原消息的位置更新了，重新打开这张照片再试试');
      quoteReturn = previousPlace;
      currentDate = target.date; currentDay = day; currentDayUrl = entry.url;
      panelDate.textContent = `${target.date.replaceAll('-', '.')} · ${day.count.toLocaleString('zh-CN')} 条`;
      if (!quoteBack) {
        quoteBack = button('← 回到刚才那句', 'chat-inline-button chat-jump-back', async () => {
          if (!quoteReturn) return;
          const back = quoteReturn; quoteReturn = null;
          currentDate = back.date; currentDay = back.day; currentDayUrl = back.url; panelDate.textContent = back.label;
          quoteBack.hidden = true; await loadReader(back.chunk, { top: back.top });
        }); panel.querySelector('.chat-jumps').append(quoteBack);
      }
      quoteBack.hidden = false;
      await loadReader(targetChunk, { targetId: target.id });
    } catch (error) { panelRange.textContent = error.message || '原来那句暂时没找到，当前聊天还在'; }
  }
  function openReader() {
    if (!active || !photo) return;
    readerWanted = true;
    focusBeforeReader = document.activeElement;
    root.classList.remove('chat-collapsed'); root.classList.add('chat-reading');
    preview.hidden = true; panel.hidden = false;
    toggleButton.setAttribute('aria-expanded', 'true'); toggleButton.textContent = '收起纸条';
    if (!wide.matches) { panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); }
    else { panel.setAttribute('role', 'region'); panel.removeAttribute('aria-modal'); }
    layout(); panelClose.focus({ preventScroll: true });
    const remembered = positions.get(currentDayUrl);
    if (currentDay) loadReader(remembered?.chunk ?? nearestChunk, remembered ? { top: remembered.top } : { near: nearTime });
    else show(photo);
  }
  function closeReader(restoreFocus = true) {
    window.PLANET_CHAT_MEDIA?.pause();
    if (!root?.classList.contains('chat-reading')) { readerWanted = false; return; }
    remember(); ++readerSerial; readerWanted = false;
    root.classList.remove('chat-reading'); panel.hidden = true;
    preview.hidden = root.classList.contains('chat-collapsed');
    layout();
    if (restoreFocus) (focusBeforeReader?.isConnected && focusBeforeReader.getClientRects().length ? focusBeforeReader : toggleButton).focus({ preventScroll: true });
  }
  function close() {
    window.PLANET_CHAT_MEDIA?.pause();
    remember(); active = false; ++serial; ++readerSerial;
    closeReader(false); photo = null; currentDay = null; currentDayUrl = ''; currentChunk = -1;
    panelThumb?.removeAttribute('src');
  }
  function mount(lightbox) {
    if (root || !enabled) return;
    root = lightbox; root.classList.add('has-chat');
    preview = node('section', undefined, 'chat-preview'); preview.setAttribute('aria-label', '那天的聊天预览');
    const head = node('div', undefined, 'chat-preview-head');
    head.append(node('h2', copy.photoChatTitle || '那天，我们还说了这些'));
    previewDate = node('p', '', 'chat-preview-date');
    previewLines = node('div', undefined, 'chat-preview-lines');
    previewHint = node('p', '', 'chat-preview-hint');
    previewOpen = button(copy.photoChatButton || '再翻翻那天的聊天 ↗', 'chat-preview-open', openReader); previewOpen.dataset.chatAction = 'open';
    previewEdit = button('给这张，记一笔 ↗', 'chat-preview-open', editDate); previewEdit.dataset.chatAction = 'edit'; previewEdit.hidden = true;
    preview.append(head, previewDate, previewLines, previewHint, previewOpen, previewEdit);
    root.querySelector('.lb-stage').append(preview);
    toggleButton = button('收起纸条', 'chat-toggle', () => setCollapsed(!root.classList.contains('chat-collapsed')));
    toggleButton.dataset.chatAction = 'toggle'; toggleButton.setAttribute('aria-expanded', 'true'); toggleButton.setAttribute('aria-label', '展开或收起那天的聊天');
    root.querySelector('.lb-bar').insertBefore(toggleButton, root.querySelector('.lb-edit'));

    panel = node('section', undefined, 'chat-panel'); panel.hidden = true; panel.setAttribute('aria-labelledby', 'chatPanelTitle');
    const panelHead = node('header', undefined, 'chat-panel-head');
    panelThumb = node('img', undefined, 'chat-panel-thumb');
    const heading = node('div', undefined, 'chat-panel-heading');
    panelTitle = node('h2', copy.photoChatReaderTitle || '那天，我们说过的话'); panelTitle.id = 'chatPanelTitle';
    panelDate = node('p', '', 'chat-panel-date'); heading.append(panelTitle, panelDate);
    panelClose = button('×', 'chat-panel-close', () => closeReader()); panelClose.dataset.chatAction = 'close'; panelClose.setAttribute('aria-label', '收起聊天，回到照片');
    panelHead.append(panelThumb, heading, panelClose);
    const jumps = node('nav', undefined, 'chat-jumps'); jumps.setAttribute('aria-label', '翻到当天的某个时候');
    const first = button('第一句', '', () => { remember(); loadReader(0); }); first.dataset.chatJump = 'first';
    jumpNear = button('照片这个时候', '', () => { remember(); loadReader(nearestChunk, { near: nearTime }); }); jumpNear.dataset.chatJump = 'near';
    const last = button('最后几句', '', () => { remember(); if (currentDay) loadReader(currentDay.chunks.length - 1, { end: true }); }); last.dataset.chatJump = 'last';
    jumps.append(first, jumpNear, last);
    panelBody = node('div', undefined, 'chat-reader-body'); panelBody.tabIndex = 0; panelBody.setAttribute('aria-label', '这一天的聊天内容');
    panelBody.addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(remember, 120); }, { passive: true });
    const pager = node('footer', undefined, 'chat-pager');
    previous = button('← 往前翻', '', () => { remember(); loadReader(currentChunk - 1, { end: true }); }); previous.dataset.chatAction = 'previous';
    next = button('接着翻 →', '', () => { remember(); loadReader(currentChunk + 1); }); next.dataset.chatAction = 'next';
    panelRange = node('span', '', 'chat-page-range'); panelRange.setAttribute('role', 'status'); panelRange.setAttribute('aria-live', 'polite');
    pager.append(previous, panelRange, next); panel.append(panelHead, jumps, panelBody, pager); root.append(panel);
    for (const surface of [preview, panel]) {
      for (const name of ['pointerdown', 'pointerup', 'pointercancel']) surface.addEventListener(name, event => event.stopPropagation());
    }
    root.addEventListener('keydown', event => {
      if (document.querySelector('dialog[open]') || !root.classList.contains('chat-reading')) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closeReader(); return; }
      if (event.key === 'Tab' && !wide.matches) {
        const focusable = [...panel.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"],summary')].filter(el => el.getClientRects().length);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
      if (panel.contains(event.target) && !(wide.matches && event.key === 'Tab')) event.stopPropagation();
    }, true);
    wide.addEventListener('change', () => {
      if (root.classList.contains('chat-reading')) {
        panel.setAttribute('role', wide.matches ? 'region' : 'dialog');
        if (wide.matches) panel.removeAttribute('aria-modal'); else panel.setAttribute('aria-modal', 'true');
      }
      layout();
    });
  }
  window.PLANET_CHAT = { mount, show, close, toggle: () => setCollapsed(!root?.classList.contains('chat-collapsed')), openReader, closeReader, isReading: () => !!root?.classList.contains('chat-reading') };
})();
