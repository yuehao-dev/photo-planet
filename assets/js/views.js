/* ============================================================
   三种查看方式：瀑布流 / 一张一张 / 时间轴
   —— 共用同一批 DOM，只切 class；图片不重载
   ============================================================ */
(() => {
  'use strict';

  const APP = window.PLANET_APP;
  if (!APP) return;

  const body = document.body;
  const chapters = APP.chaptersEl;
  const modesEl = document.getElementById('modes');
  const pill = modesEl.querySelector('.modes-pill');
  const btns = [...modesEl.querySelectorAll('button[data-mode]')];
  const reelNow = document.getElementById('reelNow');
  const reelTotal = document.getElementById('reelTotal');
  const reelBar = document.getElementById('reelBar');
  const preview = document.getElementById('hoverPreview');
  const previewImg = preview ? preview.querySelector('img') : null;

  const MODE_KEY = 'photo-planet.mode.v1';
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const ORDER = ['flow', 'reel', 'timeline'];

  let mode = 'flow';
  let reelIO = null;
  let lastReelIndex = 0;
  let savedScroll = 0;

  const cards = () => [...chapters.querySelectorAll('.card')];
  const shownCards = () => [...chapters.querySelectorAll('.card:not(.is-out)')];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------------------------------------------------------- 模式切换 */
  function setMode(next, animate = true) {
    if (!ORDER.includes(next) || next === mode) return;

    const before = captureRects();
    const from = mode;
    if (next === 'reel') savedScroll = window.scrollY;
    mode = next;
    body.dataset.mode = next;
    document.documentElement.dataset.mode = next;

    btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === next)));
    pill.style.setProperty('--i', ORDER.indexOf(next));
    try { localStorage.setItem(MODE_KEY, next); } catch (e) { /* 忽略 */ }

    if (next === 'reel') {
      ensureReelIO();
      upgradeNearby();
      requestAnimationFrame(() => {
        const target = APP.activeCard() || shownCards()[0];
        if (target) {
          const top = target.getBoundingClientRect().top - chapters.getBoundingClientRect().top + chapters.scrollTop;
          chapters.scrollTop = top;
        }
        eagerVisible();
      });
    } else {
      if (from === 'reel') {
        chapters.scrollTop = 0;
        requestAnimationFrame(() => window.scrollTo(0, savedScroll));
      }
      if (next === 'flow') APP.relayout();
      hidePreview();
    }

    requestAnimationFrame(() => {
      if (animate) playFlip(before);
      eagerVisible();
      document.dispatchEvent(new CustomEvent('mode:change', { detail: { mode: next, from } }));
    });
  }

  function captureRects() {
    const vh = window.innerHeight;
    const out = [];
    for (const card of shownCards()) {
      const r = card.getBoundingClientRect();
      if (r.bottom > 0 && r.top < vh && r.width > 0) {
        out.push({ card, r });
        if (out.length >= 12) break;
      }
    }
    return out;
  }

  function playFlip(list) {
    if (REDUCED || !list.length) return;
    list.forEach(({ card, r }) => {
      if (!card.isConnected) return;
      const r2 = card.getBoundingClientRect();
      if (!r2.width || !r2.height) return;
      const dx = r.left + r.width / 2 - (r2.left + r2.width / 2);
      const dy = r.top + r.height / 2 - (r2.top + r2.height / 2);
      const sx = r.width / r2.width;
      const sy = r.height / r2.height;
      try {
        card.animate([
          { translate: `${dx.toFixed(1)}px ${dy.toFixed(1)}px`, scale: `${sx.toFixed(3)} ${sy.toFixed(3)}` },
          { translate: '0px 0px', scale: '1 1' }
        ], { duration: 460, easing: 'cubic-bezier(.22,1,.36,1)' });
      } catch (e) { /* 老浏览器直接跳过 */ }
    });
  }

  // 切模式后，新布局里进入视口的图立刻开始加载（否则会一块一块空着）
  function eagerVisible() {
    const vh = window.innerHeight;
    shownCards().forEach(card => {
      const r = card.getBoundingClientRect();
      if (r.bottom < -400 || r.top > vh + 400) return;
      const img = card.querySelector('img');
      APP.loadCardImage(img);
    });
  }

  document.addEventListener('gallery:filter', () => requestAnimationFrame(eagerVisible));

  /* ---------------------------------------------------------- 一张一张 */
  function ensureReelIO() {
    if (reelIO) return;
    if (reelTotal) reelTotal.textContent = String(APP.visible().length);
    reelIO = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) onSlideIn(e.target);
      });
    }, { root: chapters, threshold: 0.55 });
    shownCards().forEach(c => reelIO.observe(c));
    document.addEventListener('gallery:filter', () => {
      if (!reelIO) return;
      reelIO.disconnect();
      shownCards().forEach(c => reelIO.observe(c));
      if (reelTotal) reelTotal.textContent = String(APP.visible().length);
      if (mode === 'reel') requestAnimationFrame(() => {
        const card = shownCards()[0];
        chapters.scrollTop = 0;
        if (card) onSlideIn(card);
        else { reelNow.textContent = '00'; reelBar.style.setProperty('--p', '0'); }
      });
    });
  }

  function onSlideIn(card) {
    if (mode !== 'reel') return;
    const list = APP.visible();
    const i = list.findIndex(p => p.id === card.dataset.id);
    if (i < 0) return;
    lastReelIndex = i;
    if (reelNow) reelNow.textContent = String(i + 1).padStart(2, '0');
    if (reelTotal) reelTotal.textContent = String(list.length);
    if (reelBar) reelBar.style.setProperty('--p', (list.length > 1 ? i / (list.length - 1) : 1).toFixed(4));
    upgradeNearby(i);
    APP.setActive(card);
  }

  // 只在需要时把缩略图换成大图（880 → 1500），离开也不降级，避免闪烁
  function upgradeNearby(index) {
    if (window.PLANET_PREFS?.get('saver')) return;
    const list = APP.visible();
    const all = cards();
    const start = typeof index === 'number' ? index : Math.max(0, lastReelIndex - 1);
    for (let k = start - 1; k <= start + 2; k++) {
      const p = list[k];
      if (!p) continue;
      const card = all.find(c => c.dataset.id === p.id);
      if (!card) continue;
      const img = card.querySelector('img');
      if (!img || img.dataset.hires || !img.dataset.full) continue;
      img.dataset.hires = '1';
      if (window.PLANET_MEDIA) window.PLANET_MEDIA.loadImage(img, img.dataset.full, { priority: k === start ? 'high' : 'low' });
      else img.src = img.dataset.full;
    }
  }

  function slideTarget(dir) {
    const list = shownCards();
    if (!list.length) return;
    const i = clamp(list.findIndex(c => c.dataset.id === APP.activeId()), 0, list.length - 1);
    const next = list[clamp(i + dir, 0, list.length - 1)];
    if (!next) return;
    const top = next.getBoundingClientRect().top - chapters.getBoundingClientRect().top + chapters.scrollTop;
    chapters.scrollTo({ top, behavior: REDUCED ? 'auto' : 'smooth' });
  }

  /* ---------------------------------------------------------- 时间轴：悬停大图 */
  function showPreview(card, e) {
    if (!preview || !previewImg) return;
    const img = card.querySelector('img');
    if (!img) return;
    const src = img.dataset.full || img.src;
    if (previewImg.dataset.source !== src) {
      previewImg.dataset.source = src;
      if (window.PLANET_MEDIA) window.PLANET_MEDIA.loadImage(previewImg, src, { priority: 'high' });
      else previewImg.src = src;
    }

    const w = 240, h = 300;
    let x = e.clientX + w / 2 + 28;
    if (x + w / 2 > window.innerWidth - 12) x = e.clientX - w / 2 - 28;
    const y = clamp(e.clientY, h / 2 + 12, window.innerHeight - h / 2 - 12);
    preview.style.setProperty('--x', `${Math.round(x)}px`);
    preview.style.setProperty('--y', `${Math.round(y)}px`);
    preview.classList.add('is-on');
  }
  function hidePreview() {
    if (preview) preview.classList.remove('is-on');
  }

  let previewTimer = 0;
  chapters.addEventListener('pointermove', e => {
    if (FINE && body.dataset.mode === 'timeline') {
      const card = e.target.closest('.card');
      if (!card || card.classList.contains('is-out')) { hidePreview(); return; }
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => showPreview(card, e), 90);
    } else if (body.dataset.mode !== 'timeline') {
      hidePreview();
    }
  }, { passive: true });
  chapters.addEventListener('pointerleave', hidePreview);

  /* ---------------------------------------------------------- 交互绑定 */
  modesEl.addEventListener('click', e => {
    const b = e.target.closest('button[data-mode]');
    if (b) setMode(b.dataset.mode);
  });

  // 一张一张模式：键盘翻页 + 拖动后不误触
  document.addEventListener('keydown', e => {
    if (body.dataset.mode !== 'reel') return;
    if (document.querySelector('.lb.is-open, dialog[open]') || e.target.closest('input, select, textarea')) return;
    if (e.key === ' ' && e.target.closest('button')) return;
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault();
      slideTarget(1);
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault();
      slideTarget(-1);
    }
  });

  let downX = 0, downY = 0, dragging = false;
  chapters.addEventListener('pointerdown', e => {
    if (body.dataset.mode !== 'reel') return;
    downX = e.clientX; downY = e.clientY; dragging = false;
  }, { passive: true });
  chapters.addEventListener('pointermove', e => {
    if (body.dataset.mode !== 'reel') return;
    if (Math.abs(e.clientX - downX) > 10 || Math.abs(e.clientY - downY) > 10) dragging = true;
  }, { passive: true });
  chapters.addEventListener('click', e => {
    if (body.dataset.mode === 'reel' && dragging) {
      e.preventDefault();
      e.stopPropagation();
      dragging = false;
    }
  }, true);

  // 滚动时给状态条做点反应（原生 snap 已经在翻页了）
  let reelTick = false;
  chapters.addEventListener('scroll', () => {
    if (mode !== 'reel' || reelTick) return;
    reelTick = true;
    requestAnimationFrame(() => { reelTick = false; });
  }, { passive: true });

  /* ---------------------------------------------------------- 启动 */
  let saved = 'flow';
  try { saved = localStorage.getItem(MODE_KEY) || 'flow'; } catch (e) { /* 忽略 */ }
  if (!ORDER.includes(saved)) saved = 'flow';

  body.dataset.mode = saved;
  document.documentElement.dataset.mode = saved;
  mode = saved;
  btns.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === saved)));
  pill.style.setProperty('--i', ORDER.indexOf(saved));
  if (saved === 'reel') ensureReelIO();
  requestAnimationFrame(() => {
    eagerVisible();
    document.dispatchEvent(new CustomEvent('mode:change', { detail: { mode: saved, from: null } }));
  });

  window.PLANET_VIEWS = { setMode, eagerVisible, getMode: () => mode };
})();
