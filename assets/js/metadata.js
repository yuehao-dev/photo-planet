/* 标签与日期补记：原始清单不动；可导出备份或合并进下一次发布。 */
(() => {
  'use strict';
  const key = 'photo-planet.photo-tags.v1';
  const dates = window.PLANET_DATES;
  const reserved = new Set([...Object.values(dates.names), '本机']);
  const originals = new Map();
  const registered = new Map();
  let overrides = {}, memories = {}, chatLinks = {};
  try {
    const data = validate(JSON.parse(localStorage.getItem(key) || '{}'));
    overrides = data.photos; memories = data.memories; chatLinks = data.chatLinks;
  } catch (_) {}

  function clean(tags) {
    if (!Array.isArray(tags) || tags.length > 12) throw new Error('每张照片最多留 12 个标签。');
    return [...new Set(tags.map(tag => {
      if (typeof tag !== 'string' || tag.trim().length > 20) throw new Error('标签请用 1 到 20 个字。');
      return tag.trim();
    }).filter(tag => tag && !reserved.has(tag)))];
  }
  function cleanMemory(value) {
    if (!value || !Object.hasOwn(value, 'takenAt') || !dates.valid(value.takenAt)) throw new Error('日期请记成有效的年份、月份或日子，也可以留空。');
    if (value.season != null && !Object.hasOwn(dates.names, value.season)) throw new Error('请选春、夏、秋、冬，或暂时留空。');
    return { takenAt: value.takenAt, season: dates.seasonOf(value) };
  }
  function validate(value) {
    if (![1, 2, 3].includes(value?.version) || !value.photos || typeof value.photos !== 'object' || Array.isArray(value.photos)) throw new Error('这份回忆备份暂时读不了。');
    const photos = Object.create(null), parsedMemories = Object.create(null), parsedLinks = Object.create(null);
    const idCheck = id => { if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('备份里的照片编号不正确。'); };
    for (const [id, tags] of Object.entries(value.photos)) { idCheck(id); photos[id] = clean(tags); }
    if (value.version >= 2) {
      if (!value.memories || typeof value.memories !== 'object' || Array.isArray(value.memories)) throw new Error('日期补记的格式不正确。');
      for (const [id, memory] of Object.entries(value.memories)) { idCheck(id); parsedMemories[id] = cleanMemory(memory); }
    }
    if (value.version >= 3) {
      if (!value.chatLinks || typeof value.chatLinks !== 'object' || Array.isArray(value.chatLinks)) throw new Error('聊天日期的格式不正确。');
      for (const [id, date] of Object.entries(value.chatLinks)) { idCheck(id); parsedLinks[id] = cleanChatDate(date); }
    }
    return { version: 3, photos, memories: parsedMemories, chatLinks: parsedLinks };
  }
  function cleanChatDate(date) {
    if (date !== null && (typeof date !== 'string' || date.length !== 10 || !dates.valid(date))) throw new Error('请选一个完整的聊天日期，也可以跟随照片日期。');
    return date;
  }
  function custom(photo) { return [...(Object.hasOwn(overrides, photo.id) ? overrides[photo.id] : originals.get(photo.id)?.tags || [])]; }
  function apply(photo) {
    if (!originals.has(photo.id)) originals.set(photo.id, {
      tags: clean((photo.tags || []).filter(t => !reserved.has(t))),
      takenAt: dates.valid(photo.takenAt) ? photo.takenAt : null,
      season: dates.seasonOf(photo), dateSource: photo.dateSource || 'unknown',
      chatDate: typeof photo.chatDate === 'string' && photo.chatDate.length === 10 && dates.valid(photo.chatDate) ? photo.chatDate : null
    });
    registered.set(photo.id, photo);
    const base = originals.get(photo.id);
    const memory = Object.hasOwn(memories, photo.id) ? memories[photo.id] : base;
    photo.takenAt = memory.takenAt;
    photo.season = dates.seasonOf(memory);
    photo.datePrecision = dates.precision(photo.takenAt);
    photo.dateSource = Object.hasOwn(memories, photo.id) ? 'manual' : base.dateSource;
    photo.chatDate = Object.hasOwn(chatLinks, photo.id) ? chatLinks[photo.id] : base.chatDate;
    photo.tags = [...(photo.season ? [dates.names[photo.season]] : []), ...custom(photo), ...(photo.local ? ['本机'] : [])];
    return photo;
  }
  function commit(next, nextMemories = memories, nextLinks = chatLinks) {
    const value = validate({ version: 3, photos: next, memories: nextMemories, chatLinks: nextLinks });
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) { throw new Error('这次没能存下来，请检查浏览器的存储空间。'); }
    overrides = value.photos; memories = value.memories; chatLinks = value.chatLinks;
    registered.forEach(apply);
    document.dispatchEvent(new CustomEvent('metadata:change'));
  }
  function save(photo, tags, memory, chatDate) {
    commit({ ...overrides, [photo.id]: clean(tags) }, memory === undefined ? memories : { ...memories, [photo.id]: cleanMemory(memory) }, chatDate === undefined ? chatLinks : { ...chatLinks, [photo.id]: cleanChatDate(chatDate) });
  }
  function restoreDate(photo) { const next = { ...memories }; delete next[photo.id]; commit(overrides, next); }
  function rename(from, to) {
    const label = clean([to])[0];
    if (!label) throw new Error('换个自定义名字吧，四季会单独记好。');
    const next = { ...overrides };
    registered.forEach(photo => { const tags = custom(photo); if (tags.includes(from)) next[photo.id] = clean(tags.map(t => t === from ? label : t)); });
    commit(next);
  }
  function remove(tag) {
    const next = { ...overrides };
    registered.forEach(photo => { const tags = custom(photo); if (tags.includes(tag)) next[photo.id] = tags.filter(t => t !== tag); });
    commit(next);
  }
  function list() {
    const counts = new Map();
    const photos = window.PLANET_APP?.photos || [...registered.values()];
    photos.forEach(photo => custom(photo).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
    return [...counts].sort((a, b) => b[1] - a[1]);
  }
  function exportData() { return { version: 3, photos: { ...overrides }, memories: structuredClone(memories), chatLinks: { ...chatLinks } }; }
  function importData(value) { const data = validate(value); commit({ ...overrides, ...data.photos }, { ...memories, ...data.memories }, { ...chatLinks, ...data.chatLinks }); }
  window.PLANET_META = { apply, custom, save, restoreDate, rename, remove, list, exportData, importData };
})();
