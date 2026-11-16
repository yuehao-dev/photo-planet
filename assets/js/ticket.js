/* Anniversary clock uses Beijing calendar time; particles exist only during a tap. */
(() => {
  'use strict';
  const DAY = 86400000, ZONE = 8 * 3600000;
  const pad = n => String(n).padStart(2, '0');
  function elapsed(start, now) {
    const total = Math.max(0, now - start), from = new Date(start + ZONE), to = new Date(Math.max(start, now) + ZONE);
    let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
    const anchor = count => {
      const year = from.getUTCFullYear(), month = from.getUTCMonth() + count;
      const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      return Date.UTC(year, month, Math.min(from.getUTCDate(), last), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds());
    };
    if (anchor(months) > to.getTime()) months--;
    const remainder = Math.max(0, to.getTime() - anchor(months));
    return { days: Math.floor(total / DAY) + 1, y: Math.floor(months / 12), m: months % 12,
      d: Math.floor(remainder / DAY), clock: [Math.floor(remainder / 3600000) % 24, Math.floor(remainder / 60000) % 60, Math.floor(remainder / 1000) % 60].map(pad).join(':') };
  }
  function init(config) {
    const el = document.getElementById('sticker');
    if (!el || el.dataset.ticketReady) return;
    el.dataset.ticketReady = 'true';
    const input = typeof config.since === 'string' ? config.since : '';
    const start = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(input) ? input + 'T00:00:00+08:00' : input);
    if (config.enabled === false || !Number.isFinite(start)) { el.hidden = true; return; }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let alt = false, timer = 0, visible = true, layer, cleanupTimer, bounce, lastBurst = -Infinity;
    const text = (id, value) => { const node = document.getElementById(id); if (node && node.textContent !== value) node.textContent = value; };
    function render() {
      const d = elapsed(start, Date.now());
      text('daysNum', String(d.days));
      text('ymdText', d.y ? `${d.y} 年 ${d.m} 个月 ${d.d} 天` : d.m ? `${d.m} 个月 ${d.d} 天` : `${d.d} 天`);
      text('clockText', d.clock);
    }
    function clearBurst() {
      clearTimeout(cleanupTimer); layer?.remove(); layer = null; bounce?.cancel(); bounce = null;
    }
    function burst() {
      if (config.confetti === false || reduced.matches || window.PLANET_PREFS?.get('motion') === 'off' || !el.animate || performance.now() - lastBurst < 180) return;
      lastBurst = performance.now(); clearBurst();
      const rect = el.getBoundingClientRect(), base = getComputedStyle(el).transform;
      bounce = el.animate([{ transform: base }, { transform: base + ' scale(1.09)', offset: .35 }, { transform: base + ' scale(.98)', offset: .72 }, { transform: base }], { duration: 420, easing: 'ease-out' });
      layer = document.createElement('div'); layer.className = 'ticket-confetti'; layer.setAttribute('aria-hidden', 'true');
      Object.assign(layer.style, { position: 'fixed', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '90', contain: 'strict' });
      const palette = ['#ff684c', '#ffd84e', '#72bfa3', '#ed9cbb', '#9d9cdb'];
      const x = Math.max(12, Math.min(innerWidth - 12, rect.left + rect.width / 2)), y = rect.top + rect.height * .3;
      for (let i = 0; i < 28; i++) {
        const piece = document.createElement('i'), angle = -Math.PI + (i / 27) * Math.PI;
        const reach = 70 + Math.random() * 95, dx = Math.cos(angle) * reach, dy = Math.sin(angle) * reach;
        const turn = (Math.random() - .5) * 700;
        Object.assign(piece.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: (4 + Math.random() * 3) + 'px', height: (7 + Math.random() * 5) + 'px', background: palette[i % palette.length], borderRadius: i % 5 ? '1px' : '50%' });
        layer.append(piece);
        piece.animate([{ transform: 'translate3d(0,0,0) scale(.35)', opacity: 0 },
          { transform: `translate3d(${dx * .55}px,${dy * .8}px,0) rotate(${turn * .3}deg)`, opacity: 1, offset: .25 },
          { transform: `translate3d(${dx}px,${dy + 100}px,0) rotate(${turn}deg) scale(.8)`, opacity: 1, offset: .75 },
          { transform: `translate3d(${dx * 1.12}px,${dy + 165}px,0) rotate(${turn * 1.25}deg) scale(.6)`, opacity: 0 }],
        { duration: 1000 + Math.random() * 250, easing: 'cubic-bezier(.18,.6,.4,1)', fill: 'both' });
      }
      document.body.append(layer); cleanupTimer = setTimeout(clearBurst, 1350);
    }
    function sync() {
      clearInterval(timer); timer = 0;
      if (document.visibilityState === 'visible' && visible) { render(); timer = setInterval(render, alt ? 1000 : 30000); }
      else clearBurst();
    }
    const origin = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(start);
    el.title = `从北京时间 ${origin} 开始，点一下换个看法`;
    el.setAttribute('aria-pressed', 'false');
    el.addEventListener('click', () => {
      alt = !alt; el.classList.toggle('is-alt', alt); el.setAttribute('aria-pressed', String(alt));
      el.setAttribute('aria-label', alt ? '已显示相伴时长，点按切回天数' : '已显示在一起的天数，点按查看完整时长');
      render(); sync(); burst();
    });
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pagehide', () => { clearInterval(timer); clearBurst(); });
    window.addEventListener('pageshow', sync);
    reduced.addEventListener('change', () => { if (reduced.matches) clearBurst(); });
    document.addEventListener('preferences:change', () => { if (window.PLANET_PREFS?.get('motion') === 'off') clearBurst(); });
    if ('IntersectionObserver' in window) new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }).observe(el);
    sync();
  }
  window.PLANET_TICKET = Object.freeze({ init });
})();
