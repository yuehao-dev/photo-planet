/* Configured copy is always plain text. No HTML or executable template injection. */
(() => {
  'use strict';
  const config = window.SITE_CONFIG || {};
  function number(value, fallback, min, max) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; }
  function labels() { return { me: window.PLANET_PREFS?.get('meName') || config.people?.me || '阿屿', her: window.PLANET_PREFS?.get('herName') || config.people?.her || '小夏', system: config.people?.system || '那天的小记号' }; }
  const replacements = (Array.isArray(config.chat?.textReplacements) ? config.chat.textReplacements : []).filter(p => p && typeof p.from === 'string' && p.from.length && p.from.length <= 80 && typeof p.to === 'string' && p.to.length <= 160).slice(0, 100);
  const replaceMap = new Map(replacements.map(p => [p.from, p.to]));
  const pattern = replaceMap.size ? new RegExp([...replaceMap.keys()].sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null;
  const displayText = value => typeof value === 'string' && pattern ? value.replace(pattern, word => replaceMap.get(word)) : value;
  function senderRole(value) {
    if (['me', 'her', 'system'].includes(value)) return value;
    for (const role of ['me', 'her', 'system']) if (value === config.people?.[role] || config.chat?.senderAliases?.[role]?.includes(value)) return role;
    return value;
  }
  function transformMessage(value) {
    if (Array.isArray(value)) return value.map(transformMessage);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      key === 'sender' ? senderRole(item) : ['text', 'title', 'description', 'senderName'].includes(key) && typeof item === 'string' ? displayText(item) : item && typeof item === 'object' ? transformMessage(item) : item]));
  }
  const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && window.PLANET_DATES?.valid(value);
  function photoChatDate(photo) {
    const override = config.chat?.photoDateOverrides?.[photo.id];
    if (validDay(override)) return override;
    if (validDay(photo.chatDate)) return photo.chatDate;
    const date = photo.takenAt?.slice(0, 10);
    return config.chat?.photoDateFallback !== false && validDay(date) ? date : null;
  }
  function apply() {
    const site = config.site || {}, copy = (selector, value) => { if (typeof value === 'string') document.querySelectorAll(selector).forEach(el => { el.textContent = value; }); };
    for (const [key, value] of Object.entries(site)) copy('[data-site-copy="' + key + '"]', value);
    if (Array.isArray(site.footerLines)) { const el = document.querySelector('.footer-big'); if (el) el.replaceChildren(...site.footerLines.flatMap((line, i) => [ ...(i ? [document.createElement('br')] : []), document.createTextNode(String(line)) ])); }
    if (typeof site.description === 'string') document.querySelector('meta[name="description"]')?.setAttribute('content', site.description);
    if (typeof site.robots === 'string') document.querySelector('meta[name="robots"]')?.setAttribute('content', site.robots);
    if (/^#[a-f0-9]{6}$/i.test(site.themeColor || '')) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', site.themeColor);
    for (const [key, selector] of [['icon', 'link[rel="icon"]'], ['touchIcon', 'link[rel="apple-touch-icon"]']]) {
      try { const url = new URL(site[key], document.baseURI); if (site[key] && url.origin === location.origin && ['http:', 'https:'].includes(url.protocol)) document.querySelectorAll(selector).forEach(el => { el.href = url.href; if (key === 'icon') { el.removeAttribute('type'); el.removeAttribute('sizes'); } }); } catch {}
    }
    document.querySelectorAll('[data-season-choice]').forEach(el => { const label = config.seasons?.labels?.[el.dataset.seasonChoice]; if (typeof label === 'string') { const text = [...el.childNodes].find(n => n.nodeType === 3); if (text) text.textContent = label; } });
    document.querySelectorAll('.top-chat-link').forEach(el => { el.hidden = config.chat?.enabled === false; });
    if (config.features?.addPhotos === false) document.querySelectorAll('#addBtn').forEach(el => { el.hidden = true; });
    if (config.preferences?.enabled === false) document.querySelectorAll('[data-open-preferences]').forEach(el => { el.hidden = true; });
    if (config.seasons?.enabled === false) document.querySelector('#seasonRail')?.setAttribute('hidden', '');
    copy('.face-days em:first-child', config.together?.prefix); copy('.face-days em:last-child', config.together?.suffix);
  }
  window.PLANET_CONFIG = Object.freeze({ labels, number, displayText, transformMessage, photoChatDate, apply });
  document.addEventListener('DOMContentLoaded', apply);
})();
