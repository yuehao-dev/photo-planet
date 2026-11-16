/* Personal preferences stay on this device; exports contain settings only. */
(() => {
  'use strict';
  const KEY = window.SITE_CONFIG?.storage?.preferencesKey || 'photo-planet.preferences.v2';
  const config = window.SITE_CONFIG || {};
  const suffix = config.site?.nameSuffix ?? '的';
  const baseDefaults = Object.freeze({ theme: 'cream', accent: '#ff5533', herName: '小夏', meName: '阿屿', title: '照片星球', note: '',
    columns: 'auto', spacing: 'cozy', width: 'cozy', fit: 'cover', hero: 'favorites', motion: 'light', preload: 2,
    saver: false, cacheMB: 48, chatFont: 15, chatSpacing: 'cozy', chatAlign: 'bubbles', chatMedia: 'auto', resumeChat: true });
  const choices = { theme: ['cream', 'rose', 'sage', 'night'], columns: ['auto', '1', '2', '3', '4'], spacing: ['compact', 'cozy', 'airy'],
    width: ['narrow', 'cozy', 'wide'], fit: ['cover', 'contain'], hero: ['favorites', 'latest', 'shuffle'], motion: ['light', 'off'],
    chatSpacing: ['compact', 'cozy', 'airy'], chatAlign: ['bubbles', 'left'], chatMedia: ['auto', 'tap'] };
  const limits = { herName: 12, meName: 12, title: 20, note: 100 };
  let defaults = baseDefaults;
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('这份设置暂时读不了。');
    const value = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (!Object.hasOwn(input, key)) continue;
      const v = input[key];
      if (choices[key]) { if (!choices[key].includes(v)) throw Error('有一个选项不在可用范围内。'); }
      else if (limits[key]) { if (typeof v !== 'string' || v.length > limits[key] || (key !== 'note' && !v.trim())) throw Error('名字或文案有点长，改短一点吧。'); }
      else if (key === 'accent') { if (typeof v !== 'string' || !/^#[a-f0-9]{6}$/i.test(v)) throw Error('请选择有效的颜色。'); }
      else if (key === 'preload') { if (![1, 2, 3].includes(v)) throw Error('预加载距离暂不支持这个值。'); }
      else if (key === 'cacheMB') { if (![16, 48, 96].includes(v)) throw Error('请选择一个缓存容量。'); }
      else if (key === 'chatFont') { if (!Number.isInteger(v) || v < 13 || v > 22) throw Error('聊天字号请选 13 到 22。'); }
      else if (typeof v !== 'boolean') throw Error('设置格式不正确。');
      value[key] = typeof v === 'string' && limits[key] ? v.trim() : v;
    }
    return value;
  }
  try { defaults = Object.freeze(validate({ ...baseDefaults, ...config.preferences,
    herName: config.people?.her || baseDefaults.herName, meName: config.people?.me || baseDefaults.meName,
    title: config.site?.title || baseDefaults.title, note: config.site?.note || '' })); } catch { defaults = baseDefaults; }
  function readStored(text) { const record = JSON.parse(text || '{}'); return validate(record.version === 2 ? { ...defaults, ...record.overrides } : record); }
  let values = { ...defaults }, panel, status;
  try { if (config.preferences?.enabled !== false) values = readStored(localStorage.getItem(KEY)); } catch { /* Keep safe defaults. */ }
  function apply() {
    const root = document.documentElement;
    for (const key of ['theme', 'fit', 'motion', 'chatAlign', 'chatSpacing']) root.dataset[key] = values[key];
    root.style.setProperty('--coral', values.accent);
    root.style.setProperty('--personal-accent', values.accent);
    root.style.setProperty('--chat-font-size', values.chatFont + 'px');
    root.style.setProperty('--maxw', { narrow: '1000px', cozy: '1264px', wide: '1560px' }[values.width]);
    if (values.spacing === 'cozy') root.style.removeProperty('--gap');
    else root.style.setProperty('--gap', values.spacing === 'compact' ? '10px' : '26px');
    document.querySelectorAll('[data-personal-name]').forEach(el => { el.textContent = values.herName + suffix; });
    document.querySelectorAll('[data-personal-title]').forEach(el => { el.textContent = values.title; });
    document.querySelectorAll('[data-personal-brand]').forEach(el => { el.textContent = values.herName + suffix + values.title; });
    document.querySelectorAll('[data-personal-note]').forEach(el => { el.textContent = values.note; el.hidden = !values.note; });
    if (document.body) document.title = document.body.dataset.page === 'chat' ? (config.site?.chatTitle || '那天的话') + ' · ' + values.herName + suffix + values.title : values.herName + suffix + values.title;
  }
  function update(input) {
    const next = validate(input);
    const changed = Object.keys(defaults).filter(key => values[key] !== next[key]);
    try { localStorage.setItem(KEY, JSON.stringify({ version: 2, overrides: Object.fromEntries(Object.keys(defaults).filter(k => next[k] !== defaults[k]).map(k => [k, next[k]])) })); } catch { throw Error('这次设置没能存下，请检查浏览器存储空间。'); }
    values = next; apply();
    document.dispatchEvent(new CustomEvent('preferences:change', { detail: { values: { ...values }, changed } }));
    return changed;
  }
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  function select(key, label, options, hint) { return { key, label, options, hint, type: 'select' }; }
  const sections = [
    { title: '这颗星球的模样', hint: '可以即时预览，挑一个今天喜欢的样子。', fields: [
      select('theme', '纸张与夜色', [['cream', '奶油纸'], ['rose', '浅浅的玫瑰'], ['sage', '鼠尾草绿'], ['night', '夜里慢慢看']]),
      { key: 'accent', label: '喜欢的点缀色', type: 'color' },
      { key: 'herName', label: '她的昵称', type: 'text', max: 12 }, { key: 'meName', label: '我的昵称', type: 'text', max: 12 },
      { key: 'title', label: '星球叫什么', type: 'text', max: 20 }, { key: 'note', label: '首页想留的一句话', type: 'text', max: 100, hint: '也可以留空，让照片自己说话。' }
    ] },
    { title: '照片怎么铺开', fields: [
      select('columns', '一行放几张', [['auto', '跟着屏幕自动安排'], ['1', '一张 · 大大地看'], ['2', '两张'], ['3', '三张'], ['4', '四张 · 多看一些']]),
      select('spacing', '照片之间的留白', [['compact', '紧凑一点'], ['cozy', '刚刚好'], ['airy', '多留一点空气']]),
      select('width', '平板上的相册宽度', [['narrow', '收窄一点'], ['cozy', '刚刚好'], ['wide', '展开一点']]),
      select('fit', '照片怎么放进格子', [['cover', '铺满格子'], ['contain', '完整看见，允许留白']]),
      select('hero', '首页三张怎么选', [['favorites', '星标优先，不足时补齐'], ['latest', '最近收下的三张'], ['shuffle', '每次打开换三张']]),
      select('motion', '页面的小动效', [['light', '轻一点，保持流畅'], ['off', '安静地看，关闭装饰动效']])
    ] },
    { title: '那天的话，怎么读', fields: [
      { key: 'chatFont', label: '聊天字号', type: 'range', min: 13, max: 22 },
      select('chatSpacing', '气泡与行距', [['compact', '紧凑'], ['cozy', '舒适'], ['airy', '宽松']]),
      select('chatAlign', '聊天排版', [['bubbles', '两边对话'], ['left', '都靠左，像一本小日记']]),
      select('chatMedia', '聊天里的图片', [['auto', '快看到时再加载'], ['tap', '点一下才加载，更省流量']]),
      { key: 'resumeChat', label: '下次接着上次读到的地方', type: 'checkbox' }
    ] },
    { title: '轻一点，也快一点', hint: '设置只保存在当前浏览器。图片缓存可以随时清理。', fields: [
      select('preload', '提前准备多少照片', [[1, '前面一屏 · 省流量'], [2, '前面两屏 · 推荐'], [3, '前面三屏 · 适合快翻']]),
      { key: 'saver', label: '省流模式：大图点开再准备', type: 'checkbox', hint: '关闭相邻高清图预载；音乐和语音仍由你控制。' },
      select('cacheMB', '照片缓存空间', [[16, '16 MB · 轻装'], [48, '48 MB · 推荐'], [96, '96 MB · 多留一些']])
    ] }
  ];
  function populate() {
    panel.querySelectorAll('[data-pref]').forEach(input => {
      const value = values[input.dataset.pref];
      if (input.type === 'checkbox') input.checked = value;
      else input.value = String(value);
      if (input.type === 'range') input.nextElementSibling.value = String(value);
    });
  }
  function mount() {
    if (panel) return;
    panel = node('dialog', undefined, 'preferences-panel'); panel.id = 'preferencesPanel'; panel.setAttribute('aria-labelledby', 'preferencesTitle');
    const head = node('header', undefined, 'preferences-head');
    const title = node('h2', '按你的习惯'); title.id = 'preferencesTitle';
    const close = node('button', '收好 ×'); close.type = 'button'; close.setAttribute('aria-label', '关闭个性化设置'); close.addEventListener('click', () => panel.close());
    head.append(node('p', 'OUR LITTLE SPACE', 'preferences-eyebrow'), title, close); panel.append(head);
    const form = node('form', undefined, 'preferences-form'); form.addEventListener('submit', event => event.preventDefault());
    sections.forEach((section, i) => {
      const group = node('details', undefined, 'preferences-group'); group.open = i === 0;
      group.append(node('summary', section.title));
      if (section.hint) group.append(node('p', section.hint, 'preferences-hint'));
      section.fields.forEach(field => {
        const row = node('label', undefined, 'preferences-field');
        const label = node('span', field.label); row.append(label);
        const input = node(field.type === 'select' ? 'select' : 'input');
        input.id = 'pref-' + field.key; input.dataset.pref = field.key; row.htmlFor = input.id;
        if (field.type === 'select') field.options.forEach(([value, text]) => { const option = node('option', text); option.value = value; input.append(option); });
        else { input.type = field.type; if (field.max) input.maxLength = field.max; if (field.type === 'range') { input.min = field.min; input.max = field.max; input.step = 1; } }
        row.append(input);
        if (field.type === 'range') { const output = node('output'); output.htmlFor = input.id; row.append(output); input.addEventListener('input', () => { output.value = input.value; }); }
        if (field.hint) row.append(node('small', field.hint));
        group.append(row);
      });
      form.append(group);
    });
    form.addEventListener('change', event => {
      const input = event.target.closest('[data-pref]'); if (!input) return;
      const key = input.dataset.pref;
      const value = input.type === 'checkbox' ? input.checked : typeof defaults[key] === 'number' ? Number(input.value) : input.value;
      try { update({ ...values, [key]: value }); status.textContent = '记好了，下次打开还会这样。'; }
      catch (error) { status.textContent = error.message; populate(); }
    });
    panel.append(form);
    const actions = node('div', undefined, 'preferences-actions');
    const exportButton = node('button', '带走这份设置'); exportButton.type = 'button';
    exportButton.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ version: 1, settings: values }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = node('a'); a.href = url; a.download = '小星球的习惯.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const importLabel = node('label', '带回一份设置', 'preferences-import');
    const file = node('input'); file.type = 'file'; file.accept = '.json,application/json'; file.setAttribute('aria-label', '导入个性化设置'); importLabel.append(file);
    file.addEventListener('change', async () => {
      try {
        const source = file.files[0]; if (!source) return;
        if (source.size > 32768) throw Error('这份文件有点大，请选择导出的设置文件。');
        const value = JSON.parse(await source.text()); if (value.version !== 1) throw Error('这份设置版本暂时读不了。');
        update(value.settings); populate(); status.textContent = '习惯带回来了。';
      } catch (error) { status.textContent = error instanceof SyntaxError ? '这份文件不是可用的设置。' : error.message; }
      finally { file.value = ''; }
    });
    const reset = node('button', '恢复默认'); reset.type = 'button'; reset.addEventListener('click', () => { update(defaults); populate(); status.textContent = '恢复成最初的样子了，星标和照片记号都还在。'; });
    const cache = node('button', '清理照片缓存'); cache.type = 'button'; cache.addEventListener('click', async () => {
      cache.disabled = true;
      try { await window.PLANET_MEDIA?.clearPhotoCache({ logout: false }); status.textContent = '照片缓存清理好了。需要时会重新加载。'; }
      catch { status.textContent = '这次没清理成功，稍后再试试。'; }
      finally { cache.disabled = false; }
    });
    actions.append(exportButton, importLabel, cache, reset); panel.append(actions);
    status = node('p', '设置会自动记在当前浏览器里。', 'preferences-status'); status.setAttribute('role', 'status'); panel.append(status);
    panel.addEventListener('close', () => { if (!document.querySelector('dialog[open]')) document.body.classList.remove('sheet-open'); });
    panel.addEventListener('click', event => { if (event.target !== panel) return; const r = panel.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) panel.close(); });
    document.body.append(panel); populate();
  }
  function open() {
    if (config.preferences?.enabled === false) return;
    document.querySelectorAll('dialog[open]').forEach(el => { if (el.id !== 'preferencesPanel') el.close(); });
    mount(); populate(); if (!panel.open) panel.showModal(); document.body.classList.add('sheet-open');
  }
  window.addEventListener('storage', event => { if (event.key !== KEY) return; try { const next = readStored(event.newValue); const changed = Object.keys(defaults).filter(k => next[k] !== values[k]); values = next; apply(); if (panel) populate(); document.dispatchEvent(new CustomEvent('preferences:change', { detail: { values: { ...values }, changed } })); } catch {} });
  document.addEventListener('click', event => { if (event.target.closest('[data-open-preferences]')) open(); });
  apply(); document.addEventListener('DOMContentLoaded', apply);
  window.PLANET_PREFS = Object.freeze({ get: key => values[key], snapshot: () => ({ ...values }), patch: patch => update({ ...values, ...patch }), reset: () => update(defaults), defaults: () => ({ ...defaults }), open });
})();
