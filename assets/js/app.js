/* ============================================================

   小夏的快乐星球 —— 页面逻辑

   依赖：data/photos.js（清单）、config/site.js（配置）

   分工：app.js 负责「内容与状态」，views.js 负责「三种查看方式」

   ============================================================ */

(() => {

  'use strict';



  const CFG = window.SITE_CONFIG || {};

  const DATES = window.PLANET_DATES;

  const seasonOf = DATES.seasonOf;

  const groupKey = DATES.groupKey;

  const MANIFEST = window.PLANET_PHOTOS || {};

  const PHOTOS = Array.isArray(MANIFEST.photos) ? MANIFEST.photos.map(p => {

    const copy = { ...p };

    const base = CFG.media?.photoBaseUrl;

    if (base) for (const key of ['thumbUrl', 'fullUrl']) {

      if (!/^(https?:|blob:|data:)/i.test(copy[key])) copy[key] = new URL(copy[key], new URL(base.replace(/\/?$/, '/'), document.baseURI)).href;

    }

    return copy;

  }) : [];

  if (window.PLANET_META) PHOTOS.forEach(p => window.PLANET_META.apply(p));

  PHOTOS.sort(DATES.compare);

  const G = CFG.gallery || {};

  const MIN_R = G.minRatio || 0.72;

  const MAX_R = G.maxRatio || 1.55;

  const FAV_KEY = (CFG.storage && CFG.storage.favKey) || 'photo-planet.favs.v1';

  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const FINE_POINTER = matchMedia('(hover: hover) and (pointer: fine)').matches;



  const SEASONS_ON = !(CFG.seasons && CFG.seasons.enabled === false);

  const SEASON_OF = DATES.fromMonth;

  const SEASON_NAME = DATES.names;



  const $ = (sel, root = document) => root.querySelector(sel);

  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .9-4.35 4.3 1.03 6.05L12 17.1l-5.28 2.85 1.03-6.05L3.4 9.6l6-.9L12 3.2Z"/></svg>';



  const chaptersEl = $('#chapters');

  const chipsEl = $('#chips');

  const emptyEl = $('#empty');

  const nowMonthEl = $('#nowMonth');

  const titleEl = $('#titleText');

  const totalEl = $('#totalNum');

  const favTop = $('#favCountTop');

  const favHero = $('#favCountHero');

  const topfavBtn = $('#favFilterTop');



  const byId = new Map(PHOTOS.map(p => [p.id, p]));



  const state = {

    filter: 'all',

    seasonFilter: 'all',

    season: ['spring', 'summer', 'autumn', 'winter'].includes(CFG.seasons?.initial) ? CFG.seasons.initial : 'autumn',

    favs: new Set(readFavs()),

    visible: PHOTOS.slice(),

    visibleIds: new Set(PHOTOS.map(p => p.id)),

    activeId: PHOTOS[0] ? PHOTOS[0].id : null

  };



  /* ---------------------------------------------------------- 工具 */

  function readFavs() {

    try {

      const raw = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');

      return Array.isArray(raw) ? raw : [];

    } catch (e) { return []; }

  }

  function writeFavs() {

    try { localStorage.setItem(FAV_KEY, JSON.stringify([...state.favs])); } catch (e) { /* 隐私模式忽略 */ }

  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const pad2 = n => String(n).padStart(2, '0');

  const prettyDate = DATES.pretty;

  const fmt = n => String(n);



  function hash(str) {

    let h = 0;

    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;

    return Math.abs(h);

  }

  const ROTS = [-1.1, -0.6, 0.2, 0.7, 1.2, -0.3];

  const rotOf = id => ROTS[hash(id) % ROTS.length];



  // 版式格子：横图扁一点、普通竖图 3:4、一部分竖图拉成细长条

  function ratioOf(p, portIdx) {

    if (p.orientation === 'portrait' && portIdx % 3 === 1) return G.tallRatio || 0.56;

    return clamp(p.ratio, MIN_R, MAX_R);

  }

  // 圆角跟着尺寸走：细长条 18、常规 14、横图 12

  const radiusOf = r => (r < 0.66 ? 18 : r > 1.15 ? 12 : 14);



  /* ---------------------------------------------------------- 首屏 */

  function initHero() {

    const heroCount = $('#heroCount');

    if (heroCount) heroCount.textContent = String(PHOTOS.length);



    const months = [...new Set(PHOTOS.filter(p => p.takenAt?.length >= 7).map(p => p.takenAt.slice(0, 7)))].sort();

    const range = $('#heroRange');

    if (range && months.length) {

      const a = months[0].replace('-', '.');

      const b = months[months.length - 1].replace('-', '.');

      range.textContent = a === b ? a : `${a} — ${b}`;

    } else if (range) range.textContent = PHOTOS.length ? '日期慢慢补' : '';

    const span = $('#heroSpan');

    if (span) span.textContent = months.length ? `${months.length} 个月的照片` : PHOTOS.length ? '日子慢慢记，开心先收好' : '还没有照片';



    updateHeroPhotos();



    const yearNow = $('#yearNow');

    if (yearNow) yearNow.textContent = new Date().getFullYear();

  }



  const heroSeed = String(Math.random());

  function updateHeroPhotos() {

    // Prefer real favorites; keep three different photos when fewer than three are starred.

    const selection = window.PLANET_PREFS?.get('hero') || 'favorites';

    const favorites = selection === 'favorites' ? PHOTOS.filter(p => state.favs.has(p.id)) : [];

    let pool = selection === 'favorites' ? [...favorites, ...PHOTOS.filter(p => !state.favs.has(p.id))] : PHOTOS;

    if (selection === 'shuffle') {

      const order = [...PHOTOS].sort((a, b) => hash(a.id + heroSeed) - hash(b.id + heroSeed));

      pool = order;

    }

    const picks = pool.slice(0, 3);

    ['#heroA', '#heroB', '#heroC'].forEach((sel, index) => {

      const img = $(sel);

      const p = picks[index];

      if (!img) return;

      img.closest('figure').hidden = !p;

      if (!p) { img.removeAttribute('src'); delete img.dataset.photoId; return; }

      img.alt = `${prettyDate(p.takenAt)} 的照片`;

      if (img.dataset.photoId === p.id) return;

      img.dataset.photoId = p.id;

      img.fetchPriority = index === 0 ? 'high' : 'auto';

      img.width = p.width;

      img.height = p.height;

      if (window.PLANET_MEDIA) window.PLANET_MEDIA.loadImage(img, p.thumbUrl, { priority: img.fetchPriority });

      else img.src = p.thumbUrl;

    });

  }



  /* ---------------------------------------------------------- 时间票根 */

  function initTicket() { window.PLANET_TICKET?.init(CFG.together || {}); }



  /* ---------------------------------------------------------- 章节 + 卡片 */

  let portIdx = 0;



  function makeCard(p) {

    // 本机新加的照片不参与「细长条」节奏，按原始比例展示，避免随手拍被裁得奇怪

    const ratio = p.local ? clamp(p.ratio, MIN_R, MAX_R) : ratioOf(p, portIdx++);

    const month = groupKey(p);

    const season = seasonOf(p);



    const card = document.createElement('article');

    card.className = 'card';

    card.dataset.id = p.id;

    card.dataset.ratio = String(ratio);

    card.dataset.month = month;

    card.dataset.season = season || '';

    card.style.setProperty('--rot', `${rotOf(p.id)}deg`);

    card.style.setProperty('--radius', `${radiusOf(ratio)}px`);

    card.style.setProperty('--nr', String(p.ratio));



    const media = document.createElement('div');

    media.className = 'card-media';



    const img = document.createElement('img');

    img.dataset.thumb = p.thumbUrl;

    img.dataset.full = p.fullUrl;

    img.alt = `${prettyDate(p.takenAt)} 的照片`;

    img.width = p.width;

    img.height = p.height;

    img.decoding = 'async';

    img.loading = 'lazy';

    img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });

    media.appendChild(img);



    const info = document.createElement('span');

    info.className = 'card-info';

    const dateEl = document.createElement('b');

    dateEl.textContent = prettyDate(p.takenAt);

    const tagEl = document.createElement('span');

    tagEl.textContent = (p.tags && p.tags[0]) || '';

    info.append(dateEl, tagEl);

    media.appendChild(info);



    const cap = document.createElement('div');

    cap.className = 'reel-cap';

    const capDate = document.createElement('span');

    capDate.textContent = prettyDate(p.takenAt);

    cap.appendChild(capDate);

    (p.tags || []).forEach(t => {

      const s = document.createElement('span');

      s.className = 'tag';

      s.textContent = t;

      cap.appendChild(s);

    });



    const hit = document.createElement('button');

    hit.type = 'button';

    hit.className = 'card-btn';

    hit.setAttribute('aria-label', `看大图：${prettyDate(p.takenAt)}`);

    hit.addEventListener('click', () => openPhoto(p.id, img));



    const fav = document.createElement('button');

    fav.type = 'button';

    fav.className = 'fav';

    fav.dataset.fav = p.id;

    fav.setAttribute('aria-pressed', state.favs.has(p.id) ? 'true' : 'false');

    fav.setAttribute('aria-label', '收藏这张照片');

    fav.innerHTML = STAR;

    fav.addEventListener('click', e => {

      e.stopPropagation();

      toggleFav(p.id, fav);

    });



    if (p.local) {

      const badge = document.createElement('span');

      badge.className = 'local-badge';

      badge.textContent = '本机';

      badge.title = '本机新增，长按可删除';

      card.appendChild(badge);

      bindLocalDelete(card, p.id);

    }



    card.append(media, cap, hit, fav);

    return card;

  }



  // 本机新增的照片：长按（或右键）删除，只删这台设备上的副本

  function bindLocalDelete(card, id) {

    let timer = 0;

    let sx = 0;

    let sy = 0;

    let asked = false;



    const ask = () => {

      if (asked) return;

      asked = true;

      if (window.confirm('删除这张本机新增的照片吗？只删除这台设备上的副本。')) {

        if (window.PLANET_LIGHTBOX) window.PLANET_LIGHTBOX.close();

        if (window.PLANET_ADD) window.PLANET_ADD.remove(id);

      }

      setTimeout(() => { asked = false; }, 800);

    };

    const cancel = () => {

      clearTimeout(timer);

      timer = 0;

    };



    card.addEventListener('pointerdown', e => {

      sx = e.clientX;

      sy = e.clientY;

      cancel();

      timer = setTimeout(ask, 700);

    });

    card.addEventListener('pointermove', e => {

      if (Math.abs(e.clientX - sx) > 9 || Math.abs(e.clientY - sy) > 9) cancel();

    }, { passive: true });

    card.addEventListener('pointerup', cancel);

    card.addEventListener('pointercancel', cancel);

    card.addEventListener('contextmenu', e => {

      e.preventDefault();

      ask();

    });

    card.addEventListener('click', e => {

      if (asked) {

        e.preventDefault();

        e.stopPropagation();

      }

    }, true);

  }



  function refreshChapterMeta(chapter, list) {

    const month = chapter.dataset.month;

    const season = SEASON_OF(Number(month.slice(5, 7)));

    const mm = month.slice(5, 7);

    if (month === 'unknown' || month.length === 4) {

      $('.ch-meta', chapter).textContent = `${list.length} 张 · ${month === 'unknown' ? '忘了哪天，也记得开心' : '只记得这一年'}`;

      return;

    }

    const days = list.filter(p => p.takenAt?.length >= 10).map(p => p.takenAt.slice(8, 10)).sort();

    const range = !days.length ? '具体日子待补' : days[0] === days[days.length - 1]

      ? `${mm}.${days[0]}`

      : `${mm}.${days[0]} – ${mm}.${days[days.length - 1]}`;

    const place = CFG.places && CFG.places[month];

    const dot = document.createElement('i');

    dot.className = 'season-dot';

    const text = `${list.length} 张 · ${range} · ${SEASON_NAME[season]}${place ? ` · ${place}` : ''}`;

    $('.ch-meta', chapter).replaceChildren(dot, document.createTextNode(text));

  }



  function makeChapter(month, list, number) {

    const chapter = document.createElement('section');

    chapter.className = 'chapter';

    chapter.dataset.month = month;

    chapter.dataset.season = SEASON_OF(Number(month.slice(5, 7))) || '';



    const head = document.createElement('header');

    head.className = 'chapter-head';

    const num = document.createElement('span');

    num.className = 'ch-num';

    num.textContent = pad2(number);

    const h = document.createElement('h3');

    h.className = 'ch-title';

    h.textContent = DATES.groupTitle(month);

    const meta = document.createElement('span');

    meta.className = 'ch-meta';

    head.append(num, h, meta);



    const grid = document.createElement('div');

    grid.className = 'chapter-grid';

    list.forEach(p => grid.appendChild(makeCard(p)));

    chapter.append(head, grid);

    refreshChapterMeta(chapter, list);

    return chapter;

  }



  function buildChapters() {

    const groups = new Map();

    PHOTOS.forEach(p => {

      const key = groupKey(p);

      if (!groups.has(key)) groups.set(key, []);

      groups.get(key).push(p);

    });



    const frag = document.createDocumentFragment();

    let n = 0;

    groups.forEach((list, month) => {

      n += 1;

      frag.appendChild(makeChapter(month, list, n));

    });

    chaptersEl.appendChild(frag);

  }



  /* ---------------------------------------------------------- 排布（每章独立瀑布流） */

  let lastWidth = 0;



  function getCols() {

    const w = window.innerWidth;

    const preferred = window.PLANET_PREFS?.get('columns');

    if (['1', '2', '3', '4'].includes(preferred)) return Number(preferred);

    if (w < 600) return 2;

    if (w < 1080) return 3;

    return 4;

  }



  function layoutGrid(grid, cols) {

    const cs = getComputedStyle(grid);

    const gap = parseFloat(cs.columnGap) || 16;

    const unit = 8;

    const pitch = unit + gap;

    const colW = (grid.clientWidth - gap * (cols - 1)) / cols;

    if (colW <= 0) return;



    const colY = new Array(cols).fill(0);

    const cards = [...grid.children].filter(c => !c.classList.contains('is-out'));



    cards.forEach((card, i) => {

      let best = 0;

      for (let c = 1; c < cols; c++) {

        if (colY[c] < colY[best] - 0.5) best = c;

      }

      const ratio = Number(card.dataset.ratio) || 1;

      const h = colW / ratio;

      const rows = Math.max(1, Math.ceil((h + gap) / pitch));

      const startRow = Math.round(colY[best] / pitch) + 1;



      card.style.gridColumn = `${best + 1}`;

      card.style.gridRow = `${startRow} / span ${rows}`;

      card.style.setProperty('--delay', `${Math.min(i % cols, 5) * 55}ms`);



      colY[best] = (startRow - 1) * pitch + rows * pitch;

    });

  }



  function layoutAll() {

    if ((document.body.dataset.mode || 'flow') !== 'flow') {

      lastWidth = chaptersEl.clientWidth;

      return;

    }

    const cols = getCols();

    chaptersEl.style.setProperty('--cols', cols);

    $$('.chapter', chaptersEl).forEach(ch => {

      if (ch.hidden) return;

      const grid = $('.chapter-grid', ch);

      if (grid) layoutGrid(grid, cols);

    });

    lastWidth = chaptersEl.clientWidth;

  }



  /* ---------------------------------------------------------- 筛选 */

  function matches(p, key) {

    if (key === 'all') return true;

    if (key === 'fav') return state.favs.has(p.id);

    if (key === 'undated') return !p.takenAt;

    if (key.startsWith('year:')) return !!p.takenAt?.startsWith(key.slice(5));

    if (key.startsWith('tag:')) return (p.tags || []).includes(key.slice(4));

    return true;

  }



  const TITLES = { all: '这一整颗小星球', fav: '悄悄收藏的喜欢', undated: '那些忘了日期的日子', ...CFG.site?.galleryTitles };



  function initFilters() {

    const scope = PHOTOS.filter(p => state.seasonFilter === 'all' || seasonOf(p) === state.seasonFilter);

    const yearCount = new Map();

    const tagCount = new Map();

    scope.forEach(p => {

      const y = p.takenAt?.slice(0, 4);

      if (y) yearCount.set(y, (yearCount.get(y) || 0) + 1);

      (p.tags || []).forEach(t => {

        if (t === '本机' || Object.values(SEASON_NAME).includes(t)) return;   // 本机标记不进筛选条

        tagCount.set(t, (tagCount.get(t) || 0) + 1);

      });

    });



    const frag = document.createDocumentFragment();

    frag.appendChild(makeChip('all', '全部', scope.length));

    frag.appendChild(makeChip('fav', '收藏', scope.filter(p => state.favs.has(p.id)).length, true));



    if (yearCount.size && (yearCount.size > 1 || !yearCount.has(String(new Date().getFullYear())))) {

      frag.appendChild(sep());

      frag.appendChild(label('年份'));

      [...yearCount.keys()].sort().reverse().forEach(y => {

        frag.appendChild(makeChip(`year:${y}`, `${y} 年`, yearCount.get(y)));

      });

    }



    const undated = scope.filter(p => !p.takenAt).length;

    if (undated) frag.appendChild(makeChip('undated', '日期还没记下', undated));



    const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

    if (tags.length) {

      frag.appendChild(sep());

      frag.appendChild(label('标签'));

      tags.forEach(([t, n]) => frag.appendChild(makeChip(`tag:${t}`, t, n)));

    }



    chipsEl.appendChild(frag);

  }



  function makeChip(key, text, count, star) {

    const b = document.createElement('button');

    b.type = 'button';

    b.className = 'chip' + (star ? ' chip-fav' : '');

    b.dataset.filter = key;

    b.setAttribute('aria-pressed', 'false');

    if (star) b.innerHTML = STAR;

    const s = document.createElement('span');

    s.textContent = text;

    const i = document.createElement('i');

    i.textContent = fmt(count);

    b.append(s, i);

    return b;

  }

  function sep() { const d = document.createElement('span'); d.className = 'filter-sep'; return d; }

  function label(t) { const d = document.createElement('span'); d.className = 'filter-label'; d.textContent = t; return d; }



  function applyFilter(key) {

    state.filter = key;

    state.visible = PHOTOS.filter(p => matches(p, key) && (state.seasonFilter === 'all' || seasonOf(p) === state.seasonFilter));

    state.visibleIds = new Set(state.visible.map(p => p.id));



    $$('.card', chaptersEl).forEach(card => {

      card.classList.toggle('is-out', !state.visibleIds.has(card.dataset.id));

    });

    $$('.chapter', chaptersEl).forEach(ch => {

      const any = !!$('.card:not(.is-out)', ch);

      ch.hidden = !any;

      if (any) refreshChapterMeta(ch, [...ch.querySelectorAll('.card:not(.is-out)')].map(card => byId.get(card.dataset.id)));

    });



    chipsEl.querySelectorAll('.chip').forEach(c => {

      c.setAttribute('aria-pressed', String(c.dataset.filter === state.filter));

    });

    if (topfavBtn) {

      topfavBtn.setAttribute('aria-pressed', String(key === 'fav'));

      const inner = topfavBtn.querySelector('b');

      if (inner) inner.textContent = fmt(state.favs.size);

    }



    const filterTitle = TITLES[key] || (key.startsWith('year:') ? `${key.slice(5)} 年` : key.slice(4));

    titleEl.textContent = state.seasonFilter === 'all' ? filterTitle : `${SEASON_NAME[state.seasonFilter]} · ${key === 'all' ? '小小的日子' : filterTitle}`;

    document.querySelectorAll('[data-season-choice]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.seasonChoice === state.seasonFilter)));

    document.querySelectorAll('[data-season-count]').forEach(el => {

      const count = PHOTOS.filter(p => seasonOf(p) === el.dataset.seasonCount).length;

      el.textContent = count ? `${count} 张` : '待收藏';

    });

    totalEl.textContent = fmt(state.visible.length);



    const undatedCount = PHOTOS.filter(p => !p.takenAt).length;

    const undatedEntry = $('#undatedEntry');

    undatedEntry.hidden = !undatedCount;

    undatedEntry.setAttribute('aria-pressed', String(state.filter === 'undated'));

    $('#undatedCount').textContent = `${undatedCount} 张`;



    const isEmpty = state.visible.length === 0;

    emptyEl.hidden = !isEmpty;

    chaptersEl.hidden = isEmpty;

    $('#filters').hidden = isEmpty && key === 'all';

    const emptySeason = state.seasonFilter !== 'all';

    emptyEl.querySelector('.empty-title').textContent = key === 'fav' ? '把喜欢的日子，留在这里' : emptySeason ? `这一页${SEASON_NAME[state.seasonFilter]}，留给下一次开心` : '等一张新的回忆';

    emptyEl.querySelector('.empty-sub').textContent = key === 'fav' ? '点一下照片上的小星星，就能把它收藏起来。' : emptySeason ? '照片还没来到，旋律已经准备好了。下次一起把这一页填满。' : '添一张照片，小星球就又多了一点快乐。';

    if (key === 'undated' && isEmpty) {

      emptyEl.querySelector('.empty-title').textContent = '这些日子，都记好啦';

      emptyEl.querySelector('.empty-sub').textContent = '这一页没有还没记下日期的照片，去四季里接着翻吧。';

    }

    $('#emptyAddBtn').hidden = key === 'fav' || key === 'undated';

    if (isEmpty) {

      state.activeId = null;

      if (emptySeason) setSeason(state.seasonFilter, 'filter');

      if (nowMonthEl) nowMonthEl.textContent = emptySeason ? SEASON_NAME[state.seasonFilter] : '等你收藏';

    }



    if (!isEmpty) {

      layoutAll();

      const first = $('.card:not(.is-out)', chaptersEl);

      if (first) setActive(first);

      requestAnimationFrame(() => recomputeActive());

    }

    document.dispatchEvent(new CustomEvent('gallery:filter', { detail: { key, count: state.visible.length } }));

  }



  /* ---------------------------------------------------------- 当前位置（季节 + 月份） */

  let recomputeActive = () => {};

  let observeCard = () => {};

  let fxArmed = false;



  function setSeason(season, source = 'gallery') {

    if (!Object.hasOwn(SEASON_NAME, season)) return;

    const changed = state.season !== season;

    state.season = season;

    if (SEASONS_ON && document.documentElement.dataset.season !== season) {

      document.documentElement.dataset.season = season;

      if (fxArmed && window.PLANET_PREFS?.get('motion') !== 'off' && window.PLANET_FX) window.PLANET_FX.burst(season);

    }

    if (changed) document.dispatchEvent(new CustomEvent('season:change', { detail: { season, source, id: state.activeId } }));

  }



  function setActive(card, source = 'gallery') {

    if (!card || !card.isConnected) return false;

    if (source !== 'lightbox' && document.querySelector('.lb.is-open')) return false;

    if (source !== 'lightbox' && card.classList.contains('is-out')) return false;

    const changed = state.activeId !== card.dataset.id;

    const monthLabel = card.dataset.month === 'unknown' ? '日期还没记下' : (card.dataset.month || '').replace('-', '.');

    if (!changed && (!card.dataset.season || card.dataset.season === state.season) && (!nowMonthEl || nowMonthEl.textContent === monthLabel)) return true;

    state.activeId = card.dataset.id;

    // 没有季节依据时保留正在播放的音乐，不为照片猜一个季节。

    if (card.dataset.season) setSeason(card.dataset.season, source);

    if (nowMonthEl && nowMonthEl.textContent !== monthLabel) nowMonthEl.textContent = monthLabel;

    if (changed) document.dispatchEvent(new CustomEvent('photo:active', { detail: { id: state.activeId, season: state.season, source } }));

    return true;

  }



  function selectSeason(season) {

    if (season !== 'all' && !Object.hasOwn(SEASON_NAME, season)) return;

    state.seasonFilter = season;

    chipsEl.replaceChildren();

    initFilters();

    applyFilter('all');

    if (season !== 'all') setSeason(season, 'selection');

    if (window.PLANET_MUSIC) window.PLANET_MUSIC.activateSelection(state.season);

    if (document.body.dataset.mode !== 'reel') {

      $('#seasonPicker').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });

    }

    if (!REDUCED && !chaptersEl.hidden) chaptersEl.animate([{ opacity: .35, transform: 'translateY(9px)' }, { opacity: 1, transform: 'none' }], { duration: 400, easing: 'ease-out' });

  }



  // 排布完成后再给 <img> 赋 src，浏览器才知道真实位置，懒加载才生效

  // （否则所有图片会在「还没排版、全挤在顶部」时被一次性请求）

  let imageObserver;

  let imageObserverRoot;

  let imageObserverMargin;

  const imageRetries = new WeakMap();

  function loadCardImage(img) {

    if (!img || img.dataset.requested || img.dataset.hires || !img.dataset.thumb || img.closest('.is-out,[hidden]')) return;

    img.dataset.requested = '1';

    img.loading = 'eager';

    imageObserver?.unobserve(img.closest('.card'));

    const loaded = () => {

      img.removeEventListener('error', failed);

      imageRetries.delete(img);

    };

    const failed = () => {

      img.removeEventListener('load', loaded);

      const attempts = (imageRetries.get(img) || 0) + 1;

      imageRetries.set(img, attempts);

      if (attempts > 2) return;

      setTimeout(() => {

        if (!img.isConnected || img.dataset.hires) return;

        delete img.dataset.requested;

        if (imageObserver) imageObserver.observe(img.closest('.card'));

        else loadCardImage(img);

      }, attempts * 1500);

    };

    img.addEventListener('load', loaded, { once: true });

    img.addEventListener('error', failed, { once: true });

    if (window.PLANET_MEDIA) window.PLANET_MEDIA.loadImage(img, img.dataset.thumb);

    else img.src = img.dataset.thumb;

  }

  function hydrateImages() {

    // The reel has its own scrollport: a viewport observer cannot see beyond its clip.

    const root = document.body.dataset.mode === 'reel' ? chaptersEl : null;

    const height = root ? root.clientHeight : window.innerHeight;

    const screens = window.PLANET_PREFS?.get('preload') || 2;

    const ahead = Math.round(Math.max(600, Math.min(3200, height * screens)));

    const margin = `${Math.round(ahead / 2)}px 0px ${ahead}px 0px`;

    if ('IntersectionObserver' in window && (!imageObserver || imageObserverRoot !== root || imageObserverMargin !== margin)) {

      imageObserver?.disconnect();

      imageObserverRoot = root;

      imageObserverMargin = margin;

      imageObserver = new IntersectionObserver(entries => {

        // Start visible images first, then the nearest upcoming row.

        entries.filter(e => e.isIntersecting).sort((a, b) => {

          const distance = e => Math.max(0, e.boundingClientRect.top - height, -e.boundingClientRect.bottom);

          return distance(a) - distance(b);

        }).forEach(entry => loadCardImage(entry.target.querySelector('img')));

      }, { root, rootMargin: margin, threshold: 0 });

    }

    // Observe the outer card: the unopened reveal clip on .card-media would hide an img from IntersectionObserver.

    $$('.card img', chaptersEl).forEach(img => {

      if (img.dataset.requested || img.dataset.hires) return;

      if (imageObserver) imageObserver.observe(img.closest('.card'));

      else loadCardImage(img);

    });

  }

  document.addEventListener('mode:change', hydrateImages);

  document.addEventListener('gallery:filter', () => requestAnimationFrame(hydrateImages));



  /* ---------------------------------------------------------- 本机新增照片 */

  function updateHeroStats() {

    const heroCount = $('#heroCount');

    if (heroCount) heroCount.textContent = String(PHOTOS.length);

    const months = [...new Set(PHOTOS.filter(p => p.takenAt?.length >= 7).map(p => p.takenAt.slice(0, 7)))].sort();

    const span = $('#heroSpan');

    if (span) span.textContent = months.length ? `${months.length} 个月的照片` : PHOTOS.length ? '日子慢慢记，开心先收好' : '还没有照片';

    const range = $('#heroRange');

    if (range && months.length) {

      const a = months[0].replace('-', '.');

      const b = months[months.length - 1].replace('-', '.');

      range.textContent = a === b ? a : `${a} — ${b}`;

    } else if (range) range.textContent = PHOTOS.length ? '日期慢慢补' : '';

  }



  function syncChapterNumbers() {

    $$('.chapter', chaptersEl).forEach((ch, i) => {

      const num = $('.ch-num', ch);

      if (num) num.textContent = pad2(i + 1);

    });

  }



  // 找到（或建出）某个月份的章节；章节按月份倒序排列

  function ensureChapter(month) {

    const exist = $(`.chapter[data-month="${month}"]`, chaptersEl);

    if (exist) return exist;



    const chapter = makeChapter(month, [], 0);

    let anchor = null;

    $$('.chapter', chaptersEl).forEach(ch => {

      if (!anchor && DATES.compareGroups(month, ch.dataset.month) < 0) anchor = ch;

    });

    if (anchor) chaptersEl.insertBefore(chapter, anchor);

    else chaptersEl.appendChild(chapter);

    syncChapterNumbers();

    return chapter;

  }



  function insertLocalCard(p) {

    const month = groupKey(p);

    const chapter = ensureChapter(month);

    const grid = $('.chapter-grid', chapter);

    const card = makeCard(p);



    // 插到第一张比它更早的照片前面，保持章内时间倒序

    const later = [...grid.children].find(c => {

      const other = byId.get(c.dataset.id);

      return other && DATES.compare(p, other) < 0;

    });

    if (later) grid.insertBefore(card, later);

    else grid.appendChild(card);



    card.classList.add('is-in', 'is-new');

    observeCard(card);

    return card;

  }



  function removeLocalCard(p) {

    const card = chaptersEl.querySelector(`.card[data-id="${p.id}"]`);

    if (card) card.remove();

    const chapter = $(`.chapter[data-month="${groupKey(p)}"]`, chaptersEl);

    if (chapter && !$('.card', chapter)) {

      chapter.remove();

      syncChapterNumbers();

    }

  }



  // onChange 回的是「本机照片全量列表」：比对后增删，再刷新计数与筛选

  function integrateLocal(list, opts = {}) {

    const wanted = new Set((list || []).map(p => p.id));

    let changed = false;



    // 删除

    for (let i = PHOTOS.length - 1; i >= 0; i--) {

      const p = PHOTOS[i];

      if (p.local && !wanted.has(p.id)) {

        removeLocalCard(p);

        byId.delete(p.id);

        PHOTOS.splice(i, 1);

        changed = true;

      }

    }

    // 清掉悬空的收藏

    let favsChanged = false;

    [...state.favs].forEach(id => {

      if (!byId.has(id)) { state.favs.delete(id); favsChanged = true; }

    });

    if (favsChanged) { writeFavs(); syncFavUI(''); }



    // 新增

    const added = [];

    (list || []).forEach(p => {

      if (byId.has(p.id)) return;

      byId.set(p.id, p);

      if (window.PLANET_META) window.PLANET_META.apply(p);

      PHOTOS.push(p);

      added.push(p);

      changed = true;

    });

    if (added.length) {

      PHOTOS.sort(DATES.compare);

      added.forEach(p => insertLocalCard(p));

    }

    if (!changed) return;



    updateHeroStats();

    updateHeroPhotos();

    $$('.chapter', chaptersEl).forEach(ch => {

      const list = [...ch.querySelectorAll('.card')].map(c => byId.get(c.dataset.id)).filter(Boolean);

      if (list.length) refreshChapterMeta(ch, list);

    });

    chipsEl.replaceChildren();

    initFilters();

    applyFilter(state.filter);

    hydrateImages();



    if (opts.scroll && added.length) {

      const first = added.find(p => state.visibleIds.has(p.id));

      if (!first) return;

      const card = chaptersEl.querySelector(`.card[data-id="${first.id}"]`);

      if (card) {

        setTimeout(() => {

          card.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });

        }, 80);

        setTimeout(() => card.classList.remove('is-new'), 2600);

      }

    }

  }



  /* ---------------------------------------------------------- 收藏 */

  function syncFavUI(id) {

    const on = state.favs.has(id);

    document.querySelectorAll(`[data-fav="${id}"]`).forEach(btn => {

      btn.setAttribute('aria-pressed', String(on));

    });

    if (favTop) favTop.textContent = fmt(state.favs.size);

    if (favHero) favHero.textContent = fmt(state.favs.size);

    const chipFav = chipsEl.querySelector('[data-filter="fav"] i');

    if (chipFav) chipFav.textContent = fmt(PHOTOS.filter(p => state.favs.has(p.id) && (state.seasonFilter === 'all' || seasonOf(p) === state.seasonFilter)).length);

  }



  function toggleFav(id, btn) {

    if (state.favs.has(id)) state.favs.delete(id);

    else state.favs.add(id);

    writeFavs();

    syncFavUI(id);

    updateHeroPhotos();



    if (btn && !REDUCED) {

      btn.classList.remove('is-pop');

      void btn.offsetWidth;

      btn.classList.add('is-pop');

    }

    if (state.filter === 'fav') applyFilter('fav');

  }



  /* ---------------------------------------------------------- 灯箱（按需加载） */

  let lightboxPromise = null;



  function loadLightbox() {

    if (lightboxPromise) return lightboxPromise;

    lightboxPromise = new Promise((resolve, reject) => {

      const s = document.createElement('script');

      s.src = 'assets/js/lightbox.js?v=16';

      s.async = true;

      s.fetchPriority = 'high';

      s.onload = () => resolve(window.PLANET_LIGHTBOX);

      s.onerror = () => reject(new Error('lightbox load failed'));

      document.head.appendChild(s);

    });

    return lightboxPromise;

  }



  function openPhoto(id, sourceImg) {

    const list = state.visibleIds.has(id) ? state.visible : PHOTOS;

    const index = list.findIndex(p => p.id === id);

    if (index < 0) return;

    const previousId = state.activeId;

    loadLightbox().then(lb => {

      if (!lb) return;

      lb.open({

        photos: list,

        index,

        sourceEl: sourceImg,

        isFav: pid => state.favs.has(pid),

        onToggleFav: pid => toggleFav(pid),

        onChange: p => setActive(chaptersEl.querySelector(`.card[data-id="${p.id}"]`), 'lightbox'),

        onClose: () => {

          if (!recomputeActive()) setActive(chaptersEl.querySelector(`.card[data-id="${previousId}"]`));

        }

      });

    }).catch(err => console.warn('[lightbox]', err));

  }



  /* ---------------------------------------------------------- 滚动：顶栏 / 视差 / 呼吸 */

  function initMotion() {

    const topbar = $('#topbar');

    const heroPhotos = $$('.hphoto');

    const factors = [-0.05, 0.035, 0.075];

    const inView = new Set();

    let ticking = false;

    let lastY = window.scrollY;

    let lastT = performance.now();



    const viewIO = new IntersectionObserver(entries => {

      entries.forEach(e => {

        if (e.isIntersecting) inView.add(e.target);

        else inView.delete(e.target);

      });

      recomputeActive();

    }, { rootMargin: '80px 0px 80px 0px' });

    $$('.card', chaptersEl).forEach(c => viewIO.observe(c));

    observeCard = c => { viewIO.observe(c); inView.add(c); };



    recomputeActive = () => {

      if (document.querySelector('.lb.is-open')) return false;

      const mid = window.innerHeight * 0.45;

      let best = null;

      let bestD = Infinity;

      inView.forEach(el => {

        if (el.classList.contains('is-out') || el.hidden) return;

        const r = el.getBoundingClientRect();

        if (!r.height || r.bottom < 0 || r.top > window.innerHeight) return;

        const d = Math.abs(r.top + r.height / 2 - mid);

        if (d < bestD) { bestD = d; best = el; }

      });

      return best ? setActive(best) : false;

    };



    const onScroll = () => {

      const y = window.scrollY;

      topbar.classList.toggle('is-stuck', y > 24);



      if (!REDUCED && window.innerWidth > 900) {

        heroPhotos.forEach((el, i) => {

          el.style.translate = `0 ${(y * factors[i]).toFixed(1)}px`;

        });

      }



      // 滚动越快，卡片越「收」一点，停下来回弹

      if (!REDUCED && FINE_POINTER && document.body.dataset.mode === 'flow') {

        const now = performance.now();

        const dt = Math.max(16, now - lastT);

        const v = Math.min(1, Math.abs(y - lastY) / dt / 2.4);

        lastY = y; lastT = now;

        const scale = (1 - v * 0.016).toFixed(4);

        chaptersEl.classList.toggle('is-scrolling', v > 0.05);

        inView.forEach(el => el.style.setProperty('--breathe', scale));

      }

      ticking = false;

    };



    let lastActiveCheck = 0;

    let activeTimer = 0;

    const updateActive = () => {

      activeTimer = 0;

      lastActiveCheck = performance.now();

      recomputeActive();

    };

    const touch = !FINE_POINTER;

    window.addEventListener('scroll', () => {

      if (touch) {

        // Native scrolling remains free of a per-frame JS layout read/write cycle.

        const stuck = window.scrollY > 24;

        if (topbar.classList.contains('is-stuck') !== stuck) topbar.classList.toggle('is-stuck', stuck);

        if (!activeTimer) activeTimer = setTimeout(updateActive, Math.max(0, 120 - (performance.now() - lastActiveCheck)));

        return;

      }

      if (!ticking) {

        ticking = true;

        requestAnimationFrame(() => { recomputeActive(); onScroll(); });

      }

    }, { passive: true });



    if (FINE_POINTER && !REDUCED) {

      let settle = 0;

      window.addEventListener('scroll', () => {

        clearTimeout(settle);

        settle = setTimeout(() => {

          chaptersEl.classList.remove('is-scrolling');

          inView.forEach(el => el.style.setProperty('--breathe', '1'));

        }, 180);

      }, { passive: true });

    }



    onScroll();

  }



  function refreshTags() {

    PHOTOS.forEach(p => window.PLANET_META.apply(p));

    PHOTOS.sort(DATES.compare);

    // 复用卡片、图片和观察器，只调整所属章节与顺序。

    const cards = new Map($$('.card', chaptersEl).map(card => [card.dataset.id, card]));

    const groups = new Map();

    PHOTOS.forEach(p => {

      const key = groupKey(p);

      if (!groups.has(key)) groups.set(key, []);

      groups.get(key).push(p);

      const card = cards.get(p.id);

      if (!card) return;

      card.dataset.month = key;

      card.dataset.season = seasonOf(p) || '';

      card.querySelector('img').alt = `${prettyDate(p.takenAt)} 的照片`;

      card.querySelector('.card-btn').setAttribute('aria-label', `看大图：${prettyDate(p.takenAt)}`);

      card.querySelector('.card-info b').textContent = prettyDate(p.takenAt);

      card.querySelector('.card-info > span').textContent = p.tags[0] || '';

      const cap = card.querySelector('.reel-cap');

      cap.firstElementChild.textContent = prettyDate(p.takenAt);

      cap.querySelectorAll('.tag').forEach(el => el.remove());

      p.tags.forEach(text => { const el = document.createElement('span'); el.className = 'tag'; el.textContent = text; cap.appendChild(el); });

    });

    const fragment = document.createDocumentFragment();

    let number = 0;

    groups.forEach((list, key) => {

      const chapter = makeChapter(key, [], ++number);

      const grid = $('.chapter-grid', chapter);

      list.forEach(p => grid.appendChild(cards.get(p.id)));

      refreshChapterMeta(chapter, list);

      fragment.appendChild(chapter);

    });

    chaptersEl.replaceChildren(fragment);

    if (state.filter.startsWith('tag:') && !PHOTOS.some(p => p.tags.includes(state.filter.slice(4)))) state.filter = 'all';

    updateHeroStats();

    updateHeroPhotos();

    chipsEl.replaceChildren(); initFilters(); applyFilter(state.filter);

    window.PLANET_LIGHTBOX?.refresh();

  }



  function initCursor() {

    if (!FINE_POINTER || REDUCED) return;

    const el = $('#cursor');

    if (!el) return;

    document.body.classList.add('has-cursor');

    let tx = window.innerWidth / 2, ty = window.innerHeight / 2;

    let x = tx, y = ty, shown = false;



    window.addEventListener('mousemove', e => {

      tx = e.clientX; ty = e.clientY;

      if (!shown) { shown = true; el.classList.add('is-visible'); }

    }, { passive: true });



    const loop = () => {

      x += (tx - x) * 0.2;

      y += (ty - y) * 0.2;

      el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;

      requestAnimationFrame(loop);

    };

    requestAnimationFrame(loop);



    document.addEventListener('mouseover', e => {

      const card = e.target.closest('.card');

      const hot = e.target.closest('a, button, .card, .sticker');

      el.classList.toggle('is-hot', !!hot && !card);

      el.classList.toggle('is-card', !!card);

    }, { passive: true });

  }



  /* ---------------------------------------------------------- 启动 */

  function boot() {

    if (!SEASONS_ON) document.documentElement.dataset.season = 'none';

    initHero();

    initTicket();

    initFilters();

    buildChapters();

    applyFilter('all');

    hydrateImages();

    syncFavUI('');

    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('is-ready')));



    const io = new IntersectionObserver(entries => {

      entries.forEach(e => {

        if (e.isIntersecting) {

          e.target.classList.add('is-in');

          io.unobserve(e.target);

        }

      });

    }, { rootMargin: '200px 0px', threshold: 0 });

    $$('.card', chaptersEl).forEach(c => io.observe(c));



    document.addEventListener('click', e => {

      const choice = e.target.closest('[data-season-choice]');

      if (choice) selectSeason(choice.dataset.seasonChoice);

    });

    $('#undatedEntry')?.addEventListener('click', () => {

      state.seasonFilter = 'all';

      chipsEl.replaceChildren(); initFilters(); applyFilter('undated');

      if (document.body.dataset.mode !== 'reel') $('#albumStart').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });

    });

    $('#emptyAddBtn')?.addEventListener('click', () => window.PLANET_ADD?.open());

    chipsEl.addEventListener('click', e => {

      const chip = e.target.closest('.chip');

      if (chip) applyFilter(chip.dataset.filter);

    });

    $('#heroFavBtn')?.addEventListener('click', () => {

      applyFilter('fav');

      document.getElementById('gallery').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });

    });

    topfavBtn?.addEventListener('click', () => {

      applyFilter(state.filter === 'fav' ? 'all' : 'fav');

      document.getElementById('gallery').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });

    });

    emptyEl.addEventListener('click', e => {

      const btn = e.target.closest('[data-filter]');

      if (btn) applyFilter('all');

    });



    $('#shuffleBtn')?.addEventListener('click', () => {

      const pool = state.visible.length ? state.visible : PHOTOS;

      const p = pool[Math.floor(Math.random() * pool.length)];

      if (!p) return;

      const card = chaptersEl.querySelector(`.card[data-id="${p.id}"]`);

      openPhoto(p.id, card ? card.querySelector('img') : null);

    });



    initMotion();

    document.addEventListener('preferences:change', event => {

      const changed = event.detail.changed;

      if (changed.some(key => ['hero', 'herName', 'title'].includes(key))) updateHeroPhotos();

      if (changed.some(key => ['columns', 'spacing', 'width', 'preload'].includes(key))) {

        const anchor = chaptersEl.querySelector(`.card[data-id="${state.activeId}"]`);

        const top = anchor?.getBoundingClientRect().top;

        layoutAll(); hydrateImages();

        if (anchor && Number.isFinite(top) && document.body.dataset.mode !== 'reel' && window.scrollY > 500) {

          window.scrollBy({ top: anchor.getBoundingClientRect().top - top, behavior: 'instant' });

        }

      }

    });

    window.addEventListener('storage', event => {

      if (event.key !== FAV_KEY) return;

      state.favs = new Set(readFavs());

      syncFavUI('');

      document.querySelectorAll('[data-fav]').forEach(button => {

        button.setAttribute('aria-pressed', String(state.favs.has(button.dataset.fav)));

      });

      updateHeroPhotos();

      if (state.filter === 'fav') applyFilter('fav');

    });

    // 触屏优先，保留系统指针，减少持续动画。

    document.addEventListener('metadata:change', refreshTags);



    // 添加照片：本机 IndexedDB 里的照片合并进清单（接 OSS 后这里换成直传回调）

    if (window.PLANET_ADD) {

      $('#addBtn')?.addEventListener('click', () => window.PLANET_ADD.open());

      window.PLANET_ADD.ready.then(() => {

        integrateLocal(window.PLANET_ADD.all(), { scroll: false });

        window.PLANET_ADD.onChange(list => integrateLocal(list, { scroll: true }));

      }).catch(err => console.warn('[add-photo]', err));

    }

    // 首屏定位完成后再武装季节转场，避免一进来就放粒子

    setTimeout(() => { fxArmed = true; }, 1600);



    let raf = 0;

    const onResize = () => {

      cancelAnimationFrame(raf);

      raf = requestAnimationFrame(() => {

        // Safari/Edge iOS resize their visual viewport while hiding the URL bar.

        // A height-only change must not rescan thousands of cards during a swipe.

        if (Math.abs(chaptersEl.clientWidth - lastWidth) < 1) return;

        layoutAll();

        hydrateImages();

      });

    };

    window.addEventListener('resize', onResize, { passive: true });

    window.addEventListener('orientationchange', () => setTimeout(layoutAll, 140));



    if (document.fonts && document.fonts.ready) {

      document.fonts.ready.then(() => layoutAll()).catch(() => {});

    }

  }



  /* ---------------------------------------------------------- 对外接口（views.js 用） */

  window.PLANET_APP = {

    photos: PHOTOS,

    byId,

    state,

    chaptersEl,

    visible: () => state.visible,

    activeId: () => state.activeId,

    activeCard: () => chaptersEl.querySelector(`.card[data-id="${state.activeId}"]`),

    setActive,

    setFilter: applyFilter,

    selectSeason,

    recomputeActive: () => recomputeActive(),

    openPhoto,

    isFav: id => state.favs.has(id),

    toggleFav,

    relayout: layoutAll,

    loadCardImage

  };



  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);

  else boot();

})();

