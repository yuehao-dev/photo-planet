/* ============================================================

   灯箱 —— 首次点开照片时才加载（动态 <script>）

   只做：大图查看 / 左右切换 / Esc 关闭 / 收藏 / 触屏滑动

   全部动效只用 transform + opacity，避免布局抖动

   ============================================================ */

window.PLANET_LIGHTBOX = (() => {

  'use strict';



  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const EASE = 'cubic-bezier(.22,1,.36,1)';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const prettyDate = window.PLANET_DATES.pretty;



  let root = null;

  let frame = null;

  let blurEl = null;

  let imgEl = null;

  let dateEl = null;

  let tagWrap = null;

  let favBtn = null;

  let countEl = null;

  let ctx = null;

  let lockedPadding = '';

  let previousFocus = null;



  function build() {

    if (root) return;



    root = document.createElement('div');

    root.className = 'lb';

    root.setAttribute('role', 'dialog');

    root.setAttribute('aria-modal', 'true');

    root.setAttribute('aria-label', '照片大图');

    root.setAttribute('aria-hidden', 'true');

    root.inert = true;

    root.innerHTML = `

      <div class="lb-backdrop"></div>

      <div class="lb-bar">

        <span class="lb-count"><b>01</b> / 01</span>

        <button class="lb-edit" type="button" aria-label="编辑这张照片的日期、季节和标签">记一笔 ···</button>

        <button class="lb-close" type="button" aria-label="关闭（Esc）">

          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>

        </button>

      </div>

      <div class="lb-stage">

        <figure class="lb-frame"><div class="lb-blur"></div><img alt=""></figure>

        <figcaption class="lb-cap">

          <span class="lb-date"></span>

          <span class="lb-tags"></span>

          <button class="lb-fav" type="button" aria-pressed="false">

            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .9-4.35 4.3 1.03 6.05L12 17.1l-5.28 2.85 1.03-6.05L3.4 9.6l6-.9L12 3.2Z"/></svg>

            <span>收藏</span>

          </button>

        </figcaption>

        <button class="lb-nav lb-prev" type="button" aria-label="上一张">

          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5L7.5 12l7 7"/></svg>

        </button>

        <button class="lb-nav lb-next" type="button" aria-label="下一张">

          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 5l7 7-7 7"/></svg>

        </button>

      </div>`;



    document.body.appendChild(root);



    frame = root.querySelector('.lb-frame');

    blurEl = root.querySelector('.lb-blur');

    imgEl = root.querySelector('.lb-frame img');

    imgEl.fetchPriority = 'high';

    dateEl = root.querySelector('.lb-date');

    tagWrap = root.querySelector('.lb-tags');

    favBtn = root.querySelector('.lb-fav');

    countEl = root.querySelector('.lb-count');



    imgEl.addEventListener('load', () => {

      imgEl.classList.add('is-loaded');

      frame.classList.add('is-loaded');

    });



    root.querySelector('.lb-close').addEventListener('click', close);

    root.querySelector('.lb-edit').addEventListener('click', () => window.PLANET_CONTROLS.editPhoto(ctx.photos[ctx.index]));

    root.querySelector('.lb-prev').addEventListener('click', () => go(-1));

    root.querySelector('.lb-next').addEventListener('click', () => go(1));

    root.querySelector('.lb-backdrop').addEventListener('click', close);

    favBtn.addEventListener('click', () => {

      if (!ctx) return;

      const p = ctx.photos[ctx.index];

      ctx.onToggleFav(p.id, favBtn);

    });



    document.addEventListener('keydown', onKey);



    // 触屏滑动

    let sx = 0, sy = 0, tracking = false;

    root.addEventListener('pointerdown', e => {

      tracking = false;

      if (e.target.closest('button, input, select, textarea, .chat-preview, .chat-panel, .chat-toggle')) return;

      tracking = true; sx = e.clientX; sy = e.clientY;

    }, { passive: true });

    root.addEventListener('pointerup', e => {

      if (!tracking) return;

      tracking = false;

      const dx = e.clientX - sx;

      const dy = e.clientY - sy;

      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);

    }, { passive: true });

    root.addEventListener('pointercancel', () => { tracking = false; });



    window.addEventListener('resize', () => { if (root.classList.contains('is-open')) sizeTo(ctx.photos[ctx.index]); });

    root.addEventListener('chat:layout', () => { if (ctx) sizeTo(ctx.photos[ctx.index]); });

    window.PLANET_CHAT?.mount(root);

  }



  function sizeTo(p) {

    const withChat = root.classList.contains('has-chat') && !root.classList.contains('chat-collapsed');

    const wide = window.innerWidth >= 1000;

    const maxW = withChat && wide ? Math.min(window.innerWidth - 510, 1100) : Math.min(window.innerWidth * (window.innerWidth < 640 ? 0.94 : 0.86), 1180);

    const maxH = withChat ? (wide ? Math.min(window.innerHeight * .76, window.innerHeight - 180) : Math.max(100, Math.min(window.innerHeight * .46, window.innerHeight - 360))) : window.innerHeight * (window.innerWidth < 640 ? 0.66 : 0.76);

    let w = maxW;

    let h = w / p.ratio;

    if (h > maxH) { h = maxH; w = h * p.ratio; }

    frame.style.width = `${Math.round(w)}px`;

    frame.style.height = `${Math.round(h)}px`;

    return { w, h };

  }



  function render(index, opts = {}) {

    const p = ctx.photos[index];

    if (!p) return;

    ctx.index = index;

    if (ctx.onChange) ctx.onChange(p);

    window.PLANET_CHAT?.show(p);



    sizeTo(p);



    frame.classList.remove('is-loaded');

    imgEl.classList.remove('is-loaded');

    imgEl.alt = `${prettyDate(p.takenAt)} 的照片`;

    const thumb = document.querySelector(`.card[data-id="${CSS.escape(p.id)}"] img`);

    // Blob URLs are revoked after decoding; capture the already visible thumbnail instead of fetching it again.

    blurEl.style.backgroundImage = '';

    if (thumb?.complete && thumb.naturalWidth) {

      try {

        const canvas = document.createElement('canvas');

        canvas.width = Math.min(160, thumb.naturalWidth);

        canvas.height = Math.max(1, Math.round(canvas.width * thumb.naturalHeight / thumb.naturalWidth));

        canvas.getContext('2d').drawImage(thumb, 0, 0, canvas.width, canvas.height);

        blurEl.style.backgroundImage = `url("${canvas.toDataURL('image/jpeg', .65)}")`;

      } catch { /* A cross-origin local preview can safely remain blank. */ }

    }

    if (window.PLANET_MEDIA) window.PLANET_MEDIA.loadImage(imgEl, p.fullUrl, { priority: 'high' });

    else imgEl.src = p.fullUrl;



    dateEl.textContent = prettyDate(p.takenAt) + (p.dateSource === 'moments' ? ' · 朋友圈发布' : '');


    dateEl.title = p.dateSource === 'moments' ? '按朋友圈发布日期收录，并非原始拍摄时间' : '';

    tagWrap.innerHTML = '';

    (p.tags || []).forEach(t => {

      const s = document.createElement('span');

      s.className = 'tag';

      s.textContent = t;

      tagWrap.appendChild(s);

    });



    favBtn.dataset.fav = p.id;

    favBtn.setAttribute('aria-pressed', String(ctx.isFav(p.id)));

    countEl.innerHTML = `<b>${String(index + 1).padStart(2, '0')}</b> / ${String(ctx.photos.length).padStart(2, '0')}`;



    // 当前照片先显示，再低优先级预载下一张，避免三张大图同时抢带宽。

    imgEl.addEventListener('load', () => {

      if (!ctx || ctx.index !== index) return;

      const next = ctx.photos[(index + 1) % ctx.photos.length];

      if (next && !window.PLANET_PREFS?.get('saver')) window.PLANET_MEDIA?.prefetchPhoto(next.fullUrl);

    }, { once: true });



    if (opts.sourceEl && !REDUCED) flipFrom(opts.sourceEl);

    else if (opts.dir) slideIn(opts.dir);

  }



  function flipFrom(sourceEl) {

    const r0 = sourceEl.getBoundingClientRect();

    const r1 = frame.getBoundingClientRect();

    if (!r0.width || !r1.width) return;

    const sx = r0.width / r1.width;

    const sy = r0.height / r1.height;

    const dx = r0.left + r0.width / 2 - (r1.left + r1.width / 2);

    const dy = r0.top + r0.height / 2 - (r1.top + r1.height / 2);

    frame.animate([

      { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: .55 },

      { transform: 'none', opacity: 1 }

    ], { duration: 540, easing: EASE });

  }



  function slideIn(dir) {

    if (REDUCED) return;

    frame.animate([

      { transform: `translateX(${dir * 26}px)`, opacity: 0 },

      { transform: 'none', opacity: 1 }

    ], { duration: 380, easing: EASE });

  }



  function go(dir) {

    if (!ctx) return;

    const n = ctx.photos.length;

    const next = (ctx.index + dir + n) % n;

    render(next, { dir });

  }



  function onKey(e) {

    if (!root || !root.classList.contains('is-open') || document.querySelector('dialog[open]') || e.defaultPrevented) return;

    if (e.key !== 'Tab' && e.target.closest('input, select, textarea, .chat-panel, .chat-preview')) return;

    if (e.key === 'Tab') {

      const focusable = [...root.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex="0"]')].filter(el => !el.disabled && !el.closest('[inert]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

      const first = focusable[0], last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }

      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }

      return;

    }

    if (e.key === 'Escape') { e.preventDefault(); close(); }

    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }

    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }

    else if (e.key === 'f' || e.key === 'F') {

      if (document.activeElement === favBtn) return;

      e.preventDefault();

      const p = ctx.photos[ctx.index];

      ctx.onToggleFav(p.id, favBtn);

    }

  }



  function lockScroll() {

    const gap = window.innerWidth - document.documentElement.clientWidth;

    lockedPadding = document.body.style.paddingRight;

    if (gap > 0) document.body.style.paddingRight = `${gap}px`;

    document.body.classList.add('is-locked');

  }

  function unlockScroll() {

    document.body.classList.remove('is-locked');

    document.body.style.paddingRight = lockedPadding;

  }



  function open(options) {

    build();

    previousFocus = document.activeElement;

    ctx = options;

    root.inert = false;

    root.setAttribute('aria-hidden', 'false');

    lockScroll();

    render(options.index, { sourceEl: options.sourceEl });

    root.classList.add('is-open');

    root.querySelector('.lb-close').focus({ preventScroll: true });

  }



  function close() {

    if (!root || !root.classList.contains('is-open')) return;

    window.PLANET_CHAT?.close();

    root.classList.remove('is-open');

    unlockScroll();

    if (ctx.onClose) ctx.onClose();

    if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });

    root.inert = true;

    root.setAttribute('aria-hidden', 'true');

    setTimeout(() => {

      if (!root.classList.contains('is-open')) {

        imgEl.removeAttribute('src');

        imgEl.classList.remove('is-loaded');

        frame.classList.remove('is-loaded');

      }

    }, 360);

  }



  return { open, close, refresh: () => { if (ctx && root?.classList.contains('is-open')) render(ctx.index); } };

})();

