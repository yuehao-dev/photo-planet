/* 季节转场粒子：独立 WAAPI 层，播完即销毁
   春花瓣 / 夏光斑 / 秋落叶 / 冬八角晶体雪花

   2026-10-27 重做。起因：切换季节时粒子「太快、太稀、太淡、不转」。
   - 路径不再靠 CSS 缓动，改成按 13 个采样点烘出来：竖向加速度（gravity）、
     横向摆动（sway / waves）、自转（spin）、翻面（flip）各调各的，四季气质才拉得开。
   - 一颗粒子只挂一条 animation，位移 / 旋转 / 缩放 / 透明度同轴走，避免多次 animate 叠加。
   - 时长放慢到 2.8–6.8s，并给每颗 0–1.5s 的随机延迟：落下来的是一「阵」，不是一「砸」。
   - 密度 22–36 颗，按 depth 分远近：远的更小更淡更慢，近的更大更实。
   - 提亮：配色整体加饱和，加落影 / 光晕，奶油底上也能看见；冬雪描边加深 + 外发光。
   纪律：只动 transform / opacity（外加静止的 filter），不碰 width / height / top / left。 */
(() => {
  'use strict';

  if (window.SITE_CONFIG?.seasons?.effects === false) { window.PLANET_FX = { burst() {} }; return; }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // 采样点：前疏后密，末端淡出与减速更连续
  const STOPS = [0, 0.07, 0.15, 0.24, 0.34, 0.45, 0.56, 0.66, 0.75, 0.83, 0.9, 0.96, 1];

  // 每个季节的手感参数（时长 ms，距离 vh / px）
  const SEASON = {
    // 春：花瓣，左右摇得最明显，翻面（scaleY）像被风托着
    spring: {
      count: [28, 34], size: [10, 20], duration: [3200, 4400], delay: 1100,
      sway: [22, 46], waves: [1.1, 1.9], spin: [60, 150], continuous: false,
      flip: [0.68, 1], fadeEnd: 0.7, peak: 0.96, gravity: 1.1
    },
    // 夏：光斑，从底部往上浮，靠光晕提亮
    summer: {
      count: [24, 29], size: [7, 20], duration: [2800, 3800], delay: 900,
      sway: [12, 32], waves: [0.7, 1.3], spin: [45, 110], continuous: false,
      flip: [1, 1], fadeEnd: 0.66, peak: 0.92, gravity: 0.9, up: true
    },
    // 秋：落叶，边转边晃，翻面（scaleX）模拟叶面朝你 / 朝侧
    autumn: {
      count: [28, 34], size: [12, 24], duration: [4000, 5400], delay: 1300,
      sway: [18, 42], waves: [0.85, 1.5], spin: [200, 520], continuous: true,
      flip: [0.4, 1], fadeEnd: 0.74, peak: 1, gravity: 1.16
    },
    // 冬：细雪，落得最慢最久，整程自转一圈半到两圈半
    winter: {
      count: [34, 40], size: [16, 34], duration: [4800, 6800], delay: 1500,
      sway: [5, 16], waves: [0.8, 1.4], spin: [180, 460], continuous: true,
      flip: [1, 1], fadeEnd: 0.76, peak: 0.98, gravity: 1.04
    }
  };

  const PALETTE = {
    spring: ['#EF6A9B', '#F485AC', '#F5A3BD', '#D94F7E'],
    summer: ['#FFC230', '#FFD24F', '#FFA916', '#6FD3B2'],
    autumn: ['#F09A2E', '#DE6C22', '#F3BE4C', '#B4501C'],
    winter: ['#FFFFFF']
  };

  // 八角晶体雪花：蓝底描边加粗（viewBox 是 100，细描边缩到 16px 会糊成点）
  // + 白色主枝 + 两级雪枝 + 枝端晶点 + 实心白核
  const SNOW_SVG = (() => {
    let spokes = '';
    for (let k = 0; k < 8; k += 1) {
      spokes += `<g transform="rotate(${k * 45} 50 50)">
        <line x1="50" y1="50" x2="50" y2="5" stroke="#6BA2D8" stroke-width="9.6"/>
        <line x1="50" y1="50" x2="50" y2="7" stroke="#FFFFFF" stroke-width="4"/>
        <path d="M50 27 L40.8 17.8 M50 27 L59.2 17.8" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>
        <path d="M50 44 L42.6 36.2 M50 44 L57.4 36.2" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round"/>
        <circle cx="50" cy="10" r="3.2" fill="#F7FBFF"/>
      </g>`;
    }
    return `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      <g fill="none" stroke-linecap="round">${spokes}
        <circle cx="50" cy="50" r="6" fill="#FFFFFF" stroke="#6BA2D8" stroke-width="1.6"/>
        <circle cx="50" cy="50" r="10" fill="none" stroke="#CBDFF2" stroke-width="1.8"/>
      </g></svg>`;
  })();

  // 秋叶：一片叶子 + 中脉 + 三对侧脉（白色低透明，落在任何底色上都有结构）
  const leafSvg = (color) => `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    <path d="M50 4C68 22 84 44 80 64C76 84 62 94 50 96C38 94 24 84 20 64C16 44 32 22 50 4Z" fill="${color}"/>
    <path d="M50 10V94" stroke="#FFFFFF" stroke-opacity=".38" stroke-width="2.6" stroke-linecap="round" fill="none"/>
    <path d="M50 36L30 24M50 36L70 24M50 58L27 47M50 58L73 47M50 78L33 68M50 78L67 68"
      stroke="#FFFFFF" stroke-opacity=".3" stroke-width="2.2" stroke-linecap="round" fill="none"/>
  </svg>`;

  let state = null;

  const random = (min, max) => min + Math.random() * (max - min);
  const randomInt = (min, max) => Math.floor(random(min, max + 1));

  // '#RRGGBB' → 'rgba(r,g,b,a)'，给光晕 / 落影用
  function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function makeParticle(season, conf, depth, rich) {
    const el = document.createElement('span');
    const size = random(conf.size[0], conf.size[1]) * (0.7 + depth * 0.55);
    const palette = PALETTE[season];
    const color = season === 'spring' && Math.random() > 0.82
      ? palette[3]
      : palette[randomInt(0, palette.length - 1)];

    Object.assign(el.style, {
      position: 'absolute',
      display: 'block',
      width: `${size.toFixed(1)}px`,
      height: `${size.toFixed(1)}px`,
      pointerEvents: 'none',
      opacity: '0',
      transform: 'translate3d(0,0,0)',
      willChange: rich ? 'transform, opacity' : 'auto'
    });

    if (season === 'spring') {
      el.style.borderRadius = '58% 42% 40% 60% / 64% 66% 34% 36%';
      el.style.background = `radial-gradient(circle at 32% 28%, rgba(255,255,255,.8) 0%, ${color} 58%)`;
      el.style.boxShadow = rich ? `0 1px 2px ${alpha('#6E3247', 0.26)}` : 'none';
    } else if (season === 'summer') {
      el.style.borderRadius = '50%';
      el.style.background = `radial-gradient(circle at 36% 34%, #FFFFFF 0%, ${color} 54%, ${alpha(color, 0.14)} 82%, ${alpha(color, 0)} 100%)`;
      el.style.boxShadow = rich
        ? `0 0 ${(size * 1.1).toFixed(0)}px ${(size * 0.32).toFixed(0)}px ${alpha(color, 0.5)}`
        : 'none';
      el.style.filter = 'blur(.4px)';
    } else if (season === 'autumn') {
      el.innerHTML = leafSvg(color);
      el.style.filter = rich ? `drop-shadow(0 1px 2px ${alpha('#5C2F12', 0.32)})` : 'none';
    } else {
      el.innerHTML = SNOW_SVG;
      // 奶油底上纯白会糊掉，靠蓝调落影把它「托」出来
      el.style.filter = rich ? 'drop-shadow(0 1px 2px rgba(84,126,176,.55))' : 'none';
    }
    return el;
  }

  // 把一条「下落 + 摆动 + 自转 + 翻面」的曲线采样成关键帧
  function framesFor(plan) {
    const {
      travel, drift, amp, waves, phase, spin, wobble,
      flipAmp, flipWaves, flipPhase, axis, peak, fadeEnd, gravity
    } = plan;

    return STOPS.map((p) => {
      const y = travel * Math.pow(p, gravity);
      // 摆动两端归零（sin(πp)），起落都不会横跳
      const x = drift * p + amp * Math.sin(Math.PI * 2 * waves * p + phase) * Math.sin(Math.PI * p);
      const rot = spin * p + wobble * Math.sin(Math.PI * 2 * waves * 1.7 * p + phase);
      const f = 1 - flipAmp * (0.5 + 0.5 * Math.sin(Math.PI * 2 * flipWaves * p + flipPhase));
      const sx = axis === 'x' ? f : 1;
      const sy = axis === 'y' ? f : 1;

      let opacity = peak;
      if (p === 0) opacity = 0;
      else if (p < 0.09) opacity = peak * (p / 0.09);
      else if (p > fadeEnd) opacity = peak * Math.max(0, 1 - (p - fadeEnd) / (1 - fadeEnd));

      return {
        offset: p,
        opacity: Number(opacity.toFixed(3)),
        transform: `translate3d(${x.toFixed(1)}px,${y.toFixed(2)}vh,0) rotate(${rot.toFixed(1)}deg) scale(${sx.toFixed(3)},${sy.toFixed(3)})`
      };
    });
  }

  function finishRun(run) {
    if (run.timer) {
      window.clearTimeout(run.timer);
      run.timer = 0;
    }
    if (run.layer) {
      run.layer.remove();
      run.layer = null;
    }
    if (state === run) state = null;
  }

  // 上一阵还没落完时先淡出 260ms 再让位，不要「啪」地掐断
  function retire() {
    const run = state;
    if (!run) return;
    state = null;
    if (run.timer) {
      window.clearTimeout(run.timer);
      run.timer = 0;
    }
    const layer = run.layer;
    run.layer = null;
    if (!layer) return;
    const fade = layer.animate(
      [{ opacity: '1' }, { opacity: '0' }],
      { duration: 260, easing: 'ease-out', fill: 'forwards' }
    );
    fade.onfinish = () => layer.remove();
    window.setTimeout(() => layer.remove(), 460);
  }

  function burst(season) {
    const conf = SEASON[season];
    if (!api.enabled || !conf || reducedMotion.matches) return false;
    if (typeof Element.prototype.animate !== 'function') return false;
    if (document.visibilityState === 'hidden') return false;

    const now = performance.now();
    if (state && now - state.startedAt < 320) return false;   // 连续切章 / 连点防抖
    if (state) retire();

    const lowPower = (navigator.hardwareConcurrency || 8) <= 2 || (navigator.deviceMemory || 8) <= 2;
    const rich = !lowPower;
    // 手机上可视面积只有桌面 1/4，颗数要跟着收，否则挤成一团
    const viewScale = 0.62 + 0.38 * Math.min(1, window.innerWidth / 1100);
    const base = randomInt(conf.count[0], conf.count[1]);
    const count = Math.round(base * viewScale * (lowPower ? 0.55 : 1));

    const layer = document.createElement('div');
    layer.dataset.fx = season;
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(layer.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '210',
      overflow: 'hidden',       // 冲出屏幕的粒子在这里被裁掉
      pointerEvents: 'none',
      contain: 'layout paint'
    });

    const frag = document.createDocumentFragment();
    const list = [];
    let maxEnd = 0;

    for (let i = 0; i < count; i += 1) {
      const depth = Math.random();                    // 0 远 → 1 近
      const el = makeParticle(season, conf, depth, rich);

      // 起始高度与总行程（vh）：夏向上、其余一路落到屏幕底部再出画。
      // preRoll：约四成粒子「已经在空中」，切季节那一秒整屏就有东西，而不是先空半屏再落下来
      const preRoll = Math.random() < 0.42;
      const topVh = conf.up
        ? (preRoll ? random(24, 92) : random(64, 92))
        : (preRoll ? random(-8, 58) : random(-16, 10));
      const travel = conf.up
        ? -(topVh + random(10, 24))
        : 100 - topVh + random(4, 12);

      const raw = random(conf.duration[0], conf.duration[1]) * (0.86 + depth * 0.28);
      // 行程短的要同比缩时长，否则靠近底部的粒子会慢得像悬停
      const duration = raw * Math.max(0.34, Math.abs(travel) / 112);
      // 延迟前密后疏（1.8 次方偏置）：切季节那一瞬间就该看见一片，而不是等一秒才聚起来
      const delay = conf.delay * (0.55 + depth * 0.45) * Math.pow(Math.random(), 1.8);
      const dir = Math.random() < 0.5 ? -1 : 1;

      el.style.top = `${topVh.toFixed(2)}vh`;
      el.style.left = `${random(2, 96).toFixed(2)}vw`;

      const frames = framesFor({
        travel,
        drift: random(-52, 52),
        amp: random(conf.sway[0], conf.sway[1]) * (0.6 + depth * 0.8),
        waves: random(conf.waves[0], conf.waves[1]),
        phase: random(0, Math.PI * 2),
        spin: conf.continuous ? dir * random(conf.spin[0], conf.spin[1]) : 0,
        wobble: conf.continuous ? random(-14, 14) : dir * random(conf.spin[0], conf.spin[1]),
        flipAmp: 1 - random(conf.flip[0], conf.flip[1]),
        flipWaves: random(1.6, 3.2),
        flipPhase: random(0, Math.PI * 2),
        axis: season === 'autumn' ? 'x' : season === 'spring' ? 'y' : 'none',
        peak: conf.peak * (0.62 + depth * 0.38),
        fadeEnd: conf.fadeEnd,
        gravity: conf.gravity
      });

      frag.appendChild(el);
      list.push({ el, frames, duration, delay });
      if (duration + delay > maxEnd) maxEnd = duration + delay;
    }

    layer.appendChild(frag);
    document.body.appendChild(layer);

    const run = { layer, timer: 0, startedAt: now, left: list.length };
    state = run;

    list.forEach(({ el, frames, duration, delay }) => {
      const anim = el.animate(frames, { duration, delay, easing: 'linear', fill: 'both' });
      anim.onfinish = () => {
        el.remove();
        run.left -= 1;
        if (run.left === 0) finishRun(run);
      };
    });

    // 兜底清理：后台标签页不跑动画也能收干净
    run.timer = window.setTimeout(() => finishRun(run), maxEnd + 500);
    return true;
  }

  const api = { burst, enabled: true };
  Object.defineProperty(api, 'count', {
    get: () => (state && state.layer ? state.layer.children.length : 0)
  });
  Object.defineProperty(api, 'busy', { get: () => !!state });

  window.PLANET_FX = api;
})();
