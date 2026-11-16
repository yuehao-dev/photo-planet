/* 共享聊天索引与分页读取；所有地址受同源登录保护，内存缓存有上限。 */
(() => {
  'use strict';
  const CFG = window.SITE_CONFIG?.chat || {};
  const bounded = window.PLANET_CONFIG.number;
  const base = new URL((CFG.baseUrl || 'data/chat/').replace(/\/?$/, '/'), document.baseURI);
  const daysCache = new Map(), chunksCache = new Map();
  let indexValue = null, indexTask = null, indexAt = 0;
  function trimCache(cache, limit) { while (cache.size > limit) cache.delete(cache.keys().next().value); }
  function resource(path) {
    if (typeof path !== 'string' || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.json$/.test(path)) throw new Error('这页聊天的地址暂时读不了。');
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.search || url.hash) throw new Error('这页聊天的地址暂时读不了。');
    return url.href;
  }
  async function fetchJSON(url, fresh = false) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), bounded(CFG.requestTimeoutMs, 20000, 3000, 60000));
    try {
      const response = await fetch(url, { cache: fresh ? 'no-cache' : 'default', credentials: 'same-origin', signal: controller.signal });
      if (response.status === 401 || response.status === 403) throw new Error('先进入我们的小星球，再翻这页聊天。');
      if (!response.ok) throw new Error('这页聊天暂时没打开，稍后再试一次。');
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('这页来得有点慢，再试一次吧。');
      if (error instanceof TypeError) throw new Error('连接好像断了一下，连上后再试试。');
      throw error;
    } finally { clearTimeout(timer); }
  }
  function cached(cache, path, limit, validate) {
    if (cache.has(path)) { const value = cache.get(path); cache.delete(path); cache.set(path, value); return value; }
    const task = fetchJSON(resource(path)).then(value => { validate(value); return value; }).catch(error => { cache.delete(path); throw error; });
    cache.set(path, task); trimCache(cache, limit); return task;
  }
  async function getIndex(force = false) {
    if (!force && indexValue && Date.now() - indexAt < bounded(CFG.indexRefreshMs, 60000, 5000, 300000)) return indexValue;
    if (indexTask) return indexTask;
    indexTask = fetchJSON(resource('index.json'), true).then(value => {
      if (value.version !== 1 || !value.days || typeof value.days !== 'object' || Array.isArray(value.days)) throw new Error('聊天目录还没准备好，稍后再来翻翻。');
      for (const [date, day] of Object.entries(value.days)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !window.PLANET_DATES.valid(date) || !day || !Number.isInteger(day.count) || day.count < 1) throw new Error('聊天日期目录暂时读不了。');
        resource(day.url);
      }
      indexValue = value; indexAt = Date.now(); return value;
    }).finally(() => { indexTask = null; });
    return indexTask;
  }
  function getDay(path, date) {
    return cached(daysCache, path, bounded(CFG.dayCacheEntries, 16, 1, 64), value => {
      if (value.version !== 1 || value.date !== date || !Array.isArray(value.chunks) || !value.chunks.length || !Number.isInteger(value.count)) throw new Error('这一天的聊天还没整理好。');
      if (value.chunks.some(c => !c || !Number.isInteger(c.count) || c.count < 1 || c.count > 80 || !Number.isInteger(c.startIndex) || !Number.isFinite(c.startTime) || !Number.isFinite(c.endTime))) throw new Error('这一天的聊天页码暂时读不了。');
      value.chunks.forEach(c => resource(c.url));
    });
  }
  function getChunk(day, index) {
    const chunk = day.chunks[index];
    if (!chunk) return Promise.reject(new Error('这一页已经翻到头啦。'));
    return cached(chunksCache, chunk.url, bounded(CFG.chunkCacheEntries, 32, 2, 128), value => {
      if (value.date !== day.date || value.startIndex !== chunk.startIndex || !Array.isArray(value.messages) || value.messages.length !== chunk.count) throw new Error('这段聊天暂时没有完整打开。');
      if (value.messages.some(m => typeof m.id !== 'string' || typeof m.text !== 'string' || !['me', 'her', 'system'].includes(m.sender) || !Number.isFinite(m.timestamp))) throw new Error('这段聊天里有一条暂时读不了。');
      value.messages = value.messages.map(window.PLANET_CONFIG.transformMessage);
    });
  }
  window.PLANET_CHAT_DATA = Object.freeze({ getIndex, getDay, getChunk });
})();
