/* A date-based reader: stream small chunks, retain at most 240 message nodes. */
(() => {
  'use strict';
  const data = window.PLANET_CHAT_DATA, render = window.PLANET_CHAT_RENDER;
  const $ = id => document.getElementById(id);
  const scroll = $('chatScroll'), messages = $('chatMessages'), drawer = $('dateDrawer');
  const cfg = window.SITE_CONFIG?.chat || {};
  const bounded = window.PLANET_CONFIG.number;
  const maxChunks = Math.round(bounded(cfg.maxVisibleChunks, 3, 1, 5));
  const searchLimit = Math.round(bounded(cfg.searchLimit, 100, 10, 500));
  if (cfg.enabled === false) { $('daySummary').textContent = '聊天阅读已在网站配置中关闭。'; $('chatMessages').replaceChildren(); return; }
  const BOOKMARK = 'planet.chat-reading.v1';
  const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && window.PLANET_DATES.valid(date);
  const validId = id => typeof id === 'string' && /^m_[a-f0-9]{32}$/.test(id);
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const format = value => Number(value || 0).toLocaleString('zh-CN');
  const labels = () => ({ me: window.PLANET_PREFS.get('meName'), her: window.PLANET_PREFS.get('herName'), system: window.SITE_CONFIG?.people?.system || '那天的小记号' });
  let index, dates = [], date = null, day = null, chunks = [], loading = false, epoch = 0, searchEpoch = 0;
  let saveTimer, preloadTimer, quotePlaces = [], searching = false, month = '';
  const wide = matchMedia('(min-width: 821px)');
  function bookmark() {
    if (!window.PLANET_PREFS.get('resumeChat')) return null;
    try { const b = JSON.parse(localStorage.getItem(BOOKMARK)); return validDate(b?.date) && Number.isInteger(b.chunk) && b.chunk >= 0 ? b : null; } catch { return null; }
  }
  function place() {
    if (!day || !chunks.length) return null;
    const top = scroll.getBoundingClientRect().top;
    const visible = [...messages.querySelectorAll('.chat-message')].find(el => el.getBoundingClientRect().bottom > top + 8);
    return { date, chunk: Number(visible?.parentElement.dataset.chunk ?? chunks[0].index),
      id: visible?.dataset.messageId, offset: visible ? visible.getBoundingClientRect().top - top : 0 };
  }
  function remember() {
    const b = place(); if (!b || !window.PLANET_PREFS.get('resumeChat')) return;
    try { localStorage.setItem(BOOKMARK, JSON.stringify(b)); } catch { /* Reading works without persistent storage. */ }
  }
  function address(chunk = chunks[0]?.index || 0, targetId) {
    const url = new URL(location.href); url.searchParams.set('date', date); url.searchParams.set('chunk', String(chunk));
    url.hash = validId(targetId) ? targetId : '';
    history.replaceState(null, '', url);
  }
  function position() {
    if (!day || !chunks.length) { $('readerPosition').textContent = ''; return; }
    const first = day.chunks[chunks[0].index].startIndex + 1;
    const last = day.chunks[chunks[chunks.length - 1].index];
    $('readerPosition').textContent = `${format(first)}—${format(last.startIndex + last.count)} / ${format(day.count)} 条`;
    $('loadEarlier').hidden = chunks[0].index === 0;
    $('loadMore').hidden = chunks[chunks.length - 1].index >= day.chunks.length - 1;
    $('loadMore').disabled = loading;
    $('readStatus').textContent = loading ? '后面的几句，马上就来…' : chunks[chunks.length - 1].index >= day.chunks.length - 1 ? '这一天的话，都在这里了。' : '慢慢往下翻，后面的几句会提前准备。';
    $('firstMessage').disabled = $('lastMessage').disabled = loading;
  }
  function dayHeading() {
    $('readerDate').textContent = date ? `${date.replaceAll('-', '.')} · ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(date + 'T12:00:00+08:00').getUTCDay()]}` : '慢慢翻到那一天';
    const entry = index?.days[date];
    $('daySummary').textContent = entry ? `${format(entry.count)} 句话，都慢慢收在这一天。` : '这一天的记录，暂时还没收进来。';
    $('dateJump').value = date || '';
    const previous = dates.filter(d => d < date).at(-1), next = dates.find(d => d > date);
    $('previousDate').disabled = !previous; $('nextDate').disabled = !next;
    $('previousDate').dataset.date = previous || ''; $('nextDate').dataset.date = next || '';
  }
  function renderCalendar(value = month || date?.slice(0, 7) || dates.at(-1)?.slice(0, 7)) {
    if (!/^\d{4}-\d{2}$/.test(value || '') || !window.PLANET_DATES.valid(value)) return;
    month = value; $('calendarMonth').value = value;
    const [year, mm] = value.split('-').map(Number), count = new Date(year, mm, 0).getDate();
    const offset = (new Date(year, mm - 1, 1).getDay() + 6) % 7, fragment = document.createDocumentFragment();
    for (let i = 0; i < offset; i++) fragment.append(node('span'));
    for (let n = 1; n <= count; n++) {
      const d = `${value}-${String(n).padStart(2, '0')}`, entry = index?.days[d];
      const button = node('button', String(n)); button.type = 'button'; button.disabled = !entry;
      button.dataset.date = d; button.setAttribute('aria-pressed', String(d === date));
      button.setAttribute('aria-label', `${d}${entry ? `，${format(entry.count)} 条聊天` : '，暂未收录'}`);
      fragment.append(button);
    }
    $('calendarGrid').replaceChildren(fragment);
    $('monthPrevious').disabled = !dates.length || value <= dates[0].slice(0, 7);
    $('monthNext').disabled = !dates.length || value >= dates.at(-1).slice(0, 7);
  }
  function errorView(title, detail, action, label = '再试一次') {
    const box = node('section', undefined, 'archive-empty'); box.append(node('h3', title), node('p', detail));
    if (action) { const retry = node('button', label); retry.type = 'button'; retry.addEventListener('click', action); box.append(retry); }
    messages.replaceChildren(box); $('readStatus').textContent = ''; $('readerPosition').textContent = '';
    $('firstMessage').disabled = $('lastMessage').disabled = true; $('loadMore').hidden = $('loadEarlier').hidden = true;
  }
  function chunkNode(chunk, chunkIndex) {
    const group = node('div', undefined, 'archive-chunk'); group.dataset.chunk = String(chunkIndex);
    const fragment = document.createDocumentFragment();
    chunk.messages.forEach(message => fragment.append(render.messageNode(message, { jump: jumpToQuote })));
    group.append(fragment); return group;
  }
  function closeSearch() {
    searchEpoch++; searching = false;
    $('searchResults').hidden = true; scroll.hidden = false; $('clearSearch').hidden = true;
    $('searchSubmit').textContent = '找一找'; $('searchResultList').replaceChildren();
  }
  function prefetch() {
    clearTimeout(preloadTimer);
    if (window.PLANET_PREFS.get('saver') || !day || !chunks.length) return;
    const candidate = chunks[chunks.length - 1].index + 1, current = day;
    if (candidate < current.chunks.length) preloadTimer = setTimeout(() => data.getChunk(current, candidate).catch(() => {}), 250);
  }
  async function selectDate(value, options = {}) {
    if (!validDate(value)) return;
    remember(); clearTimeout(saveTimer); clearTimeout(preloadTimer); closeSearch();
    window.PLANET_CHAT_MEDIA?.pause();
    const token = ++epoch;
    loading = true; date = value; day = null; chunks = [];
    messages.replaceChildren(node('p', '正在翻到这一天…', 'chat-reader-empty')); scroll.scrollTop = 0;
    scroll.setAttribute('aria-busy', 'true'); $('loadMore').hidden = $('loadEarlier').hidden = true;
    $('firstMessage').disabled = $('lastMessage').disabled = true;
    dayHeading(); renderCalendar(value.slice(0, 7));
    if (drawer.open) drawer.close();
    try {
      const entry = index.days[value];
      if (!entry) {
        errorView('这天的话，还没收进来。', '照片和日子都可以慢慢补。先翻翻旁边有记录的一天吧。', () => selectDate(dates.find(d => d > value) || dates.at(-1)), '看看最近的一天');
        address(0); return;
      }
      const loaded = await data.getDay(entry.url, value); if (token !== epoch) return;
      let part = Math.max(0, Math.min(loaded.chunks.length - 1, Number.isInteger(options.chunk) ? options.chunk : 0));
      if (validId(options.id) && Number.isInteger(loaded.messageChunks?.[options.id])) part = loaded.messageChunks[options.id];
      if (!loaded.chunks[part]) part = 0;
      const chunk = await data.getChunk(loaded, part); if (token !== epoch) return;
      day = loaded; chunks = [{ index: part, node: chunkNode(chunk, part) }]; messages.replaceChildren(chunks[0].node);
      loading = false; position();
      if (validId(options.id)) {
        const target = messages.querySelector(`[data-message-id="${CSS.escape(options.id)}"]`);
        if (target) { target.classList.add('is-quote-target'); scroll.scrollTop = Math.max(0, target.offsetTop - (Number(options.offset) || 18)); }
      } else if (options.end) scroll.scrollTop = scroll.scrollHeight;
      address(part, options.id); prefetch();
    } catch (error) {
      if (token === epoch) errorView('这一页暂时没打开。', error.message || '连上网络，再翻一次吧。', () => selectDate(value, options));
    } finally { if (token === epoch) { loading = false; scroll.removeAttribute('aria-busy'); } }
  }
  async function loadMore() {
    if (loading || searching || !day || !chunks.length) return;
    const part = chunks[chunks.length - 1].index + 1; if (!day.chunks[part]) return;
    const token = epoch, current = day; loading = true; position();
    try {
      const chunk = await data.getChunk(current, part); if (token !== epoch) return;
      const group = chunkNode(chunk, part); messages.append(group); chunks.push({ index: part, node: group });
      if (chunks.length > maxChunks) {
        const old = chunks.shift(), height = old.node.getBoundingClientRect().height;
        old.node.remove(); scroll.scrollTop = Math.max(0, scroll.scrollTop - height);
      }
      loading = false; position(); prefetch();
    } catch (error) {
      if (token === epoch) { $('readStatus').textContent = error.message; $('loadMore').hidden = false; }
    } finally { if (token === epoch) { loading = false; $('loadMore').disabled = false; } }
  }
  async function jumpToQuote(target) {
    if (!validDate(target?.date) || !Number.isInteger(target.chunk) || target.chunk < 0 || !validId(target.id)) return;
    const previous = place(); if (previous) quotePlaces.push(previous); if (quotePlaces.length > 12) quotePlaces.shift();
    $('quoteReturn').hidden = !quotePlaces.length;
    await selectDate(target.date, { chunk: target.chunk, id: target.id });
  }
  function kindMatch(message, kind) {
    if (kind === 'all') return true;
    if (kind === 'link') return !!message.link;
    if (kind === 'text') return !!message.text && !(message.media || []).length && !message.link;
    return (message.media || []).some(asset => asset.kind === kind);
  }
  async function search(event) {
    event.preventDefault();
    if (searching) { closeSearch(); return; }
    if (!day) return;
    const query = $('searchText').value.trim().toLocaleLowerCase(), sender = $('searchSender').value, kind = $('searchKind').value;
    if (!query && sender === 'all' && kind === 'all') { $('searchText').focus(); $('searchText').placeholder = '写几个字，或选谁说的、找什么'; return; }
    remember(); window.PLANET_CHAT_MEDIA?.pause(false);
    const token = ++searchEpoch, current = day, currentDate = date;
    searching = true; scroll.hidden = true; $('searchResults').hidden = false; $('clearSearch').hidden = false;
    $('searchSubmit').textContent = '停一下'; $('searchResultList').replaceChildren();
    let found = 0;
    try {
      for (let part = 0; part < current.chunks.length && found < searchLimit; part++) {
        if (token !== searchEpoch || currentDate !== date) return;
        $('searchProgress').textContent = `正在翻第 ${part + 1} / ${current.chunks.length} 段，找到 ${found} 句…`;
        const chunk = await data.getChunk(current, part);
        if (token !== searchEpoch || currentDate !== date) return;
        const fragment = document.createDocumentFragment();
        for (const message of chunk.messages) {
          if ((sender !== 'all' && message.sender !== sender) || !kindMatch(message, kind)) continue;
          const text = [message.text, message.link?.title, message.quote?.text].filter(Boolean).join(' ');
          const at = text.toLocaleLowerCase().indexOf(query); if (query && at < 0) continue;
          const start = Math.max(0, at - 28), excerpt = (start ? '…' : '') + (text || '这一条里有附件').slice(start, start + 140);
          const result = node('button', undefined, 'reader-result'); result.type = 'button';
          result.append(node('small', `${labels()[message.sender]} · ${String(message.time || '').slice(0, 5)} · 翻到这句 ↗`), node('span', excerpt));
          result.addEventListener('click', () => selectDate(currentDate, { chunk: part, id: message.id })); fragment.append(result);
          if (++found >= searchLimit) break;
        }
        $('searchResultList').append(fragment);
        // Yield between cached chunks so input and scrolling stay responsive.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (token === searchEpoch) $('searchProgress').textContent = found ? `这一天找到 ${found}${found >= 100 ? ' 句，先显示前 100 句；换个更具体的词还能继续找' : ' 句，点一下就能翻回原来的位置'}。` : '这一天没有找到这几句话，换个词或另一个日子试试。';
    } catch (error) { if (token === searchEpoch) $('searchProgress').textContent = error.message; }
    finally { if (token === searchEpoch) { searching = false; $('searchSubmit').textContent = '再找一次'; } }
  }
  function arrangeDates() {
    if (wide.matches && drawer.open) drawer.close();
    (wide.matches ? $('desktopDates') : $('mobileDates')).append($('calendarSurface'));
  }
  function moveMonth(delta) {
    if (!month) return;
    const [y, m] = month.split('-').map(Number), next = new Date(y, m - 1 + delta, 1);
    renderCalendar(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  }
  $('openDates').addEventListener('click', () => { arrangeDates(); if (!drawer.open) drawer.showModal(); });
  $('closeDates').addEventListener('click', () => drawer.close());
  $('calendarGrid').addEventListener('click', event => { const b = event.target.closest('button[data-date]'); if (b && !b.disabled) selectDate(b.dataset.date); });
  $('calendarMonth').addEventListener('change', event => renderCalendar(event.target.value));
  $('monthPrevious').addEventListener('click', () => moveMonth(-1)); $('monthNext').addEventListener('click', () => moveMonth(1));
  $('dateJump').addEventListener('change', event => selectDate(event.target.value));
  for (const id of ['previousDate', 'nextDate']) $(id).addEventListener('click', () => selectDate($(id).dataset.date));
  $('randomDate').addEventListener('click', () => { if (dates.length) selectDate(dates[Math.floor(Math.random() * dates.length)]); });
  $('refreshRecords').addEventListener('click', async () => {
    const button = $('refreshRecords'); button.disabled = true;
    try {
      index = await data.getIndex(true); dates = Object.keys(index.days).sort();
      $('archiveStats').textContent = `收好了 ${format(dates.length)} 个日子，${format(index.count)} 句话。`;
      if (dates.length) { $('calendarMonth').min = dates[0].slice(0, 7); $('calendarMonth').max = dates.at(-1).slice(0, 7); }
      renderCalendar(); dayHeading(); button.textContent = '日子已经是最新的了 ✓';
    } catch (error) { button.textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('resumeReading').addEventListener('click', () => { const b = bookmark(); if (b) selectDate(b.date, b); });
  $('quoteReturn').addEventListener('click', () => { const b = quotePlaces.pop(); $('quoteReturn').hidden = !quotePlaces.length; if (b) selectDate(b.date, b); });
  $('firstMessage').addEventListener('click', () => selectDate(date));
  $('lastMessage').addEventListener('click', () => { if (day) selectDate(date, { chunk: day.chunks.length - 1, end: true }); });
  $('loadMore').addEventListener('click', loadMore);
  $('loadEarlier').addEventListener('click', () => { if (chunks.length) selectDate(date, { chunk: Math.max(0, chunks[0].index - 1), end: true }); });
  $('daySearch').addEventListener('submit', search); $('clearSearch').addEventListener('click', closeSearch);
  scroll.addEventListener('scroll', () => { clearTimeout(saveTimer); saveTimer = setTimeout(remember, 400); }, { passive: true });
  window.addEventListener('pagehide', remember);
  document.addEventListener('preferences:change', event => { $('resumeReading').hidden = !bookmark(); if (event.detail.changed.includes('saver')) prefetch(); });
  wide.addEventListener('change', arrangeDates); arrangeDates();
  if ('IntersectionObserver' in window) new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) loadMore(); }, { root: scroll, rootMargin: `0px 0px ${Math.round(bounded(cfg.preloadPx, 900, 200, 2400))}px 0px` }).observe($('nextSentinel'));
  window.addEventListener('popstate', () => { const u = new URL(location.href), d = u.searchParams.get('date'); if (validDate(d)) selectDate(d, { chunk: Number(u.searchParams.get('chunk')) || 0, id: u.hash.slice(1) }); });
  async function boot() {
    try {
      index = await data.getIndex(); dates = Object.keys(index.days).sort();
      $('archiveStats').textContent = `收好了 ${format(dates.length)} 个日子，${format(index.count)} 句话。`;
      $('resumeReading').hidden = !bookmark();
      if (!dates.length) { errorView('日子还在慢慢收集。', '聊天记录导入后，就能在这里按天翻阅了。'); return; }
      $('calendarMonth').min = dates[0].slice(0, 7); $('calendarMonth').max = dates.at(-1).slice(0, 7);
      const u = new URL(location.href), requested = u.searchParams.get('date'), b = bookmark();
      const selected = validDate(requested) ? requested : b && index.days[b.date] ? b.date : validDate(cfg.initialDate) && index.days[cfg.initialDate] ? cfg.initialDate : dates.at(-1);
      const options = validDate(requested) ? { chunk: Math.max(0, Number(u.searchParams.get('chunk')) || 0), id: u.hash.slice(1) } : b?.date === selected ? b : {};
      await selectDate(selected, options);
    } catch (error) { $('daySummary').textContent = '目录暂时没打开'; errorView('这些话，晚一点再翻也好。', error.message, boot); }
  }
  boot();
})();
