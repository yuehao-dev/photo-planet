/* 自动播放会尊重浏览器限制与上次暂停；四季配套旋律按组切换。 */
(() => {
  'use strict';
  const dock = document.getElementById('musicDock');
  const toggle = document.getElementById('musicToggle');
  const title = document.getElementById('musicTitle');
  const status = document.getElementById('musicStatus');
  const volume = document.getElementById('musicVolume');
  const output = document.getElementById('volumeValue');
  const volumeToggle = document.getElementById('volumeToggle');
  const panel = document.getElementById('volumePanel');
  const next = document.getElementById('musicNext');
  const config = window.SITE_CONFIG || {};
  const names = { spring: '春 · 今天也想见你', summer: '夏 · 分你一口冰淇淋', autumn: '秋 · 踩着落叶去约会', winter: '冬 · 把手放进我口袋' };
  const catalog = (config.music?.sets || []).filter(set => set.id && (set.format !== 'tracks' || ['spring', 'summer', 'autumn', 'winter'].every(s => !!set.tracks?.[s])));
  if (!catalog.length) catalog.push({ id: 'paper-v42', title: '纸页之间', duration: 120, format: 'stems' });
  if (config.music?.enabled === false) { dock.hidden = true; return; }
  const bounded = window.PLANET_CONFIG.number;
  const duck = bounded(config.music?.chatDuckVolume, .18, 0, 1);
  let manuallyPaused = false;
  let needsGesture = false;
  let resumeOnVisible = false;
  let seasonTimer;
  let savedVolume = bounded(config.music?.volume, .55, 0, 1);
  let savedCollection;
  try {
    const value = localStorage.getItem('photo-planet.music-volume.v1');
    if (value !== null && Number.isFinite(Number(value))) savedVolume = Math.max(0, Math.min(1, Number(value)));
    manuallyPaused = localStorage.getItem('photo-planet.music-paused.v1') === 'true';
    savedCollection = localStorage.getItem('photo-planet.music-set.v1');
  } catch (_) {}
  const engine = new window.PLANET_SeasonalBGM({
    fadeSeconds: bounded(config.music?.fadeSeconds, 7, 1, 20),
    sets: catalog, baseUrl: config.media?.musicBaseUrl || 'assets/audio/stems/', volume: savedVolume,
    onStateChange: ({ state, season, collection }) => {
      const active = engine.wantsPlayback && state !== 'blocked';
      needsGesture = state === 'blocked';
      dock.dataset.state = state;
      dock.dataset.playing = String(active);
      dock.dataset.season = season;
      const currentSet = catalog.find(set => set.id === collection);
      const piece = currentSet?.titles?.[season] || (collection === 'paper-v42' ? names[season] : `${names[season].slice(0, 1)} · ${currentSet?.title || '四季的小旋律'}`);
      title.textContent = piece;
      toggle.title = `${piece} · ${active ? '暂停' : '轻触播放'}`;
      toggle.setAttribute('aria-pressed', String(active));
      toggle.setAttribute('aria-label', state === 'error' ? '重试加载音乐' : `${active ? '暂停' : '播放'}音乐：${piece}`);
      const labels = { idle: '轻触，听听这个季节', paused: '已暂停 · 轻触继续', blocked: '碰一下，旋律就来', loading: '旋律在路上…', transitioning: '旋律轻轻换季中', playing: '正在陪你翻照片', error: '暂未载入 · 轻触重试' };
      status.textContent = labels[state] || labels.idle;
      document.getElementById('musicSetName').textContent = catalog.find(set => set.id === collection)?.title || '四季的小旋律';
    }
  });
  let chatMediaPlaying = false;
  document.addEventListener('chat:media-play', () => {
    chatMediaPlaying = true; engine.setVolume(Number(volume.value) / 100 * duck);
  });
  document.addEventListener('chat:media-stop', () => {
    chatMediaPlaying = false; engine.setVolume(Number(volume.value) / 100);
  });
  if (catalog.some(set => set.id === savedCollection)) engine.collection = savedCollection;
  engine.selected = window.PLANET_APP.state.season;
  engine.switchTo(engine.selected);
  volume.value = Math.round(savedVolume * 100); output.value = `${volume.value}%`;
  next.disabled = catalog.length < 2;
  document.getElementById('musicSetHint').textContent = catalog.length < 2 ? '现在有一组。下一组四季旋律，等你带来。' : `有 ${catalog.length} 组旋律，换组以后也会陪着四季一起走。`;

  function savePause() { try { localStorage.setItem('photo-planet.music-paused.v1', String(manuallyPaused)); } catch (_) {} }
  function activateSelection(season) {
    clearTimeout(seasonTimer);
    if (manuallyPaused) { engine.switchTo(season); return; }
    engine.play(season);
  }
  function randomCollection() {
    const choices = catalog.filter(set => set.id !== engine.collection);
    if (!choices.length) return false;
    const chosen = choices[Math.floor(Math.random() * choices.length)];
    engine.setCollection(chosen.id);
    try { localStorage.setItem('photo-planet.music-set.v1', chosen.id); } catch (_) {}
    return true;
  }
  next.addEventListener('click', randomCollection);
  toggle.addEventListener('click', () => {
    clearTimeout(seasonTimer);
    if (engine.wantsPlayback && engine.state !== 'error' && engine.context?.state === 'running') {
      manuallyPaused = true; needsGesture = false; resumeOnVisible = false;
      engine.pause();
    } else {
      manuallyPaused = false;
      engine.play(window.PLANET_APP.state.season);
    }
    savePause();
  });
  document.addEventListener('season:change', ({ detail }) => {
    clearTimeout(seasonTimer);
    seasonTimer = setTimeout(() => engine.switchTo(detail.season), detail.source === 'gallery' ? 180 : 0);
  });
  volume.addEventListener('input', () => {
    engine.setVolume(Number(volume.value) / 100 * (chatMediaPlaying ? duck : 1)); output.value = `${volume.value}%`;
    try { localStorage.setItem('photo-planet.music-volume.v1', Number(volume.value) / 100); } catch (_) {}
  });
  function closeVolume() { panel.hidden = true; volumeToggle.setAttribute('aria-expanded', 'false'); }
  volumeToggle.addEventListener('click', () => { panel.hidden = !panel.hidden; volumeToggle.setAttribute('aria-expanded', String(!panel.hidden)); });
  document.addEventListener('pointerdown', e => { if (!dock.contains(e.target)) closeVolume(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { closeVolume(); volumeToggle.focus(); } });
  function unlock(event) {
    if (!event.isTrusted || manuallyPaused || document.hidden || event.target.closest('#musicDock, [data-season-choice]')) return;
    if (needsGesture || (engine.wantsPlayback && engine.context?.state === 'suspended')) {
      clearTimeout(seasonTimer); needsGesture = false;
      engine.play(window.PLANET_APP.state.season);
    }
  }
  // touchend 保留 Safari 的手势调用栈；不靠定时器反复尝试强制播放。
  document.addEventListener('touchend', unlock, { passive: true });
  document.addEventListener('pointerup', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
  document.addEventListener('visibilitychange', () => {
    clearTimeout(seasonTimer);
    if (document.hidden) {
      resumeOnVisible = engine.wantsPlayback && !manuallyPaused;
      if (engine.wantsPlayback) engine.pause();
    } else if (resumeOnVisible && !manuallyPaused) {
      resumeOnVisible = false; engine.play(window.PLANET_APP.state.season);
    }
  });
  window.addEventListener('pagehide', () => { resumeOnVisible = engine.wantsPlayback && !manuallyPaused; engine.pause(); });
  window.addEventListener('pageshow', event => { if (event.persisted && resumeOnVisible && !manuallyPaused) engine.play(window.PLANET_APP.state.season); });
  window.PLANET_MUSIC = { engine, activateSelection, randomCollection, catalog };
  if (manuallyPaused) engine.pause();
  else if (config.music?.autoplay !== false) engine.play(engine.selected);
})();
