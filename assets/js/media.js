/* 已验证站点先取临时地址，再直接读取 OSS，避免跨域重定向丢失 Origin。 */
(() => {
  'use strict';
  const CFG = window.SITE_CONFIG?.media || {};
  const PHOTO_CACHE = 'planet.photos.v1';
  const options = window.SITE_CONFIG?.loading || {}, bounded = window.PLANET_CONFIG.number;
  const CACHE_AGE = bounded(options.cacheDays, 7, 1, 30) * 86400000;
  const cacheMB = () => window.PLANET_PREFS?.get('cacheMB') || 48;
  const MAX_IMAGE_BYTES = bounded(options.maxImageMB, 8, 1, 20) * 1024 * 1024;
  const pendingPhotos = new Map();
  const imageRequests = new WeakMap();
  let sessionCheck;
  let cacheGeneration = 0;
  let cacheTask = Promise.resolve();
  let activeLoads = 0;
  let cacheTrimTimer = 0;
  let cacheWrites = 0;
  const loadQueue = [];
  function managed(value) {
    if (!CFG.signedUrls) return null;
    let url;
    try { url = new URL(typeof value === 'string' || value instanceof URL ? value : value.url, document.baseURI); }
    catch { return null; }
    if (url.origin !== location.origin) return null;
    const bases = [CFG.photoBaseUrl, CFG.musicBaseUrl].filter(Boolean);
    return bases.some(value => {
      const base = new URL(value.replace(/\/?$/, '/'), document.baseURI);
      return base.origin === url.origin && url.pathname.startsWith(base.pathname);
    }) ? url : null;
  }
  async function mediaFetch(input, options = {}) {
    const source = managed(input);
    if (!source) return fetch(input, options);
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET') throw new TypeError('媒体读取仅支持 GET');
    source.search = '?resolve=1';
    const resolved = await fetch(source.href, {
      method: 'GET', credentials: 'same-origin', mode: 'same-origin', redirect: 'error',
      cache: 'no-store', headers: { Accept: 'application/json' }, signal: options.signal
    });
    if (!resolved.ok) throw new Error('媒体地址暂时未准备好');
    const data = await resolved.json();
    let target;
    try { target = new URL(data.url); } catch { throw new TypeError('媒体地址不正确'); }
    const host = CFG.signedHost || '';
    if (target.protocol !== 'https:' || target.hostname !== host || target.port || target.username || target.password || target.hash ||
        !Number.isSafeInteger(data.expiresAt) || data.expiresAt <= Math.floor(Date.now() / 1000)) throw new TypeError('媒体地址不正确');
    const headers = new Headers(options.headers);
    for (const name of ['Authorization', 'Cookie', 'Proxy-Authorization']) headers.delete(name);
    return fetch(target.href, { ...options, method: 'GET', headers, mode: 'cors', credentials: 'omit',
      redirect: 'error', referrerPolicy: 'no-referrer' });
  }

  function photoURL(value) {
    const url = managed(value);
    // Content hashes in these filenames make cache entries immutable across updates.
    if (!url || !(/\/public\/photos\/(thumb|full)\/[^/]+-[a-f0-9]{8,}\.webp$/i.test(url.pathname) ||
        /\/public\/photos\/moments-[a-f0-9]{24}-(thumb|full)\.webp$/i.test(url.pathname))) return null;
    url.search = ''; url.hash = '';
    return url;
  }
  async function clearPhotoCache({ logout = true } = {}) {
    cacheGeneration++;
    clearTimeout(cacheTrimTimer); cacheTrimTimer = 0; cacheWrites = 0;
    sessionCheck = logout ? Promise.resolve(false) : undefined;
    await cacheTask;
    if ('caches' in window) await caches.delete(PHOTO_CACHE).catch(() => {});
  }
  async function authenticated() {
    if (!sessionCheck) sessionCheck = fetch(new URL('session', document.baseURI), {
      credentials: 'same-origin', cache: 'no-store', redirect: 'error'
    }).then(response => response.ok).catch(() => false).then(async ok => {
      if (!ok) await clearPhotoCache();
      return ok;
    });
    return sessionCheck;
  }
  // Photo downloads have their own small queue; music and chat are never queued here.
  function requestRank(request) {
    if (request.priority === 'high') return -1e9;
    let rank = Infinity;
    for (const img of request.targets) {
      if (!img.isConnected || img.closest('.is-out,[hidden]')) continue;
      const rect = (img.closest('.card') || img).getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const distance = Math.max(0, rect.top - innerHeight, -rect.bottom);
      // Current viewport and the next row take precedence over old scroll positions.
      rank = Math.min(rank, distance + (rect.bottom < 0 ? innerHeight : 0));
    }
    return Number.isFinite(rank) ? rank : request.priority === 'low' ? 1e8 : 1e7;
  }
  function pumpDownloads() {
    while (activeLoads < Math.round(bounded(options.photoConcurrency, 4, 1, 6)) && loadQueue.length) {
      // Read geometry once per request, rather than on every sort comparison.
      let best = 0;
      let bestRank = Infinity;
      loadQueue.forEach((task, index) => {
        const rank = requestRank(task.request);
        if (rank < bestRank) { best = index; bestRank = rank; }
      });
      const [task] = loadQueue.splice(best, 1);
      activeLoads++;
      Promise.resolve().then(task.action).then(task.resolve, task.reject).finally(() => {
        activeLoads--;
        pumpDownloads();
      });
    }
  }
  function download(action, request) {
    return new Promise((resolve, reject) => {
      loadQueue.push({ action, request, resolve, reject });
      pumpDownloads();
    });
  }
  async function trimCache(cache) {
    const entries = await Promise.all((await cache.keys()).map(async request => {
      const response = await cache.match(request);
      return { request, size: Number(response?.headers.get('x-album-bytes')) || 0,
        created: Number(response?.headers.get('x-album-created')) || 0,
        used: Number(response?.headers.get('x-album-used')) || 0,
        full: /\/full\/|-full\.webp$/.test(request.url) };
    }));
    entries.sort((a, b) => b.used - a.used);
    let bytes = 0, thumbs = 0, full = 0;
    for (const entry of entries) {
      const expires = Date.now() - entry.created > CACHE_AGE;
      const count = entry.full ? ++full : ++thumbs;
      const mb = cacheMB(), limit = entry.full ? (mb === 16 ? 8 : mb === 96 ? 32 : 24) : (mb === 16 ? 60 : mb === 96 ? 240 : 120);
      if (expires || count > limit || bytes + entry.size > mb * 1024 * 1024) await cache.delete(entry.request);
      else bytes += entry.size;
    }
  }
  function scheduleCacheTrim(cache, generation) {
    if (++cacheWrites >= 8) {
      cacheWrites = 0;
      clearTimeout(cacheTrimTimer); cacheTrimTimer = 0;
      return trimCache(cache);
    }
    if (!cacheTrimTimer) cacheTrimTimer = setTimeout(() => {
      cacheTrimTimer = 0; cacheWrites = 0;
      cacheTask = cacheTask.then(() => generation === cacheGeneration ? trimCache(cache) : undefined).catch(() => {});
    }, 750);
  }
  function rememberPhoto(url, blob, created = Date.now(), generation = cacheGeneration) {
    if (!('caches' in window) || blob.size > MAX_IMAGE_BYTES) return;
    // Serialize mutations so simultaneous image loads cannot race past the quota.
    cacheTask = cacheTask.then(async () => {
      if (generation !== cacheGeneration) return;
      const cache = await caches.open(PHOTO_CACHE);
      await cache.put(url.href, new Response(blob, { headers: {
        'Content-Type': blob.type, 'x-album-bytes': String(blob.size),
        'x-album-created': String(created), 'x-album-used': String(Date.now())
      } }));
      await scheduleCacheTrim(cache, generation);
    }).catch(() => { /* Quota/private-mode failures must not prevent viewing. */ });
  }
  async function photoBlob(url, request) {
    const generation = cacheGeneration;
    if (!await authenticated()) throw new Error('请重新登录');
    if ('caches' in window) {
      try {
        const cache = await caches.open(PHOTO_CACHE);
        const hit = await cache.match(url.href);
        const created = Number(hit?.headers.get('x-album-created')) || 0;
        if (hit && Date.now() - created <= CACHE_AGE) {
          const blob = await hit.blob();
          if (generation !== cacheGeneration) throw new Error('请重新登录');
          // Avoid rewriting and rescanning the entire cache for every scroll-back hit.
          const used = Number(hit.headers.get('x-album-used')) || 0;
          if (Date.now() - used > 300000) rememberPhoto(url, blob, created, generation);
          return blob;
        }
        if (hit) await cache.delete(url.href);
      } catch { /* Fall back to a normal authenticated download. */ }
    }
    const blob = await download(async () => {
      const response = await mediaFetch(url.href, { priority: request.priority, cache: 'default' });
      if (!response.ok || !/^image\//i.test(response.headers.get('content-type') || '')) throw new Error('照片暂时没有加载成功');
      return response.blob();
    }, request);
    if (generation !== cacheGeneration) throw new Error('请重新登录');
    rememberPhoto(url, blob, Date.now(), generation);
    return blob;
  }
  function getPhoto(value, priority = 'auto', img) {
    const url = photoURL(value);
    if (!url) return null;
    let request = pendingPhotos.get(url.href);
    if (!request) {
      request = { priority, targets: new Set() };
      if (img) request.targets.add(img);
      request.promise = photoBlob(url, request).finally(() => pendingPhotos.delete(url.href));
      pendingPhotos.set(url.href, request);
    } else {
      if (priority === 'high' || (priority === 'auto' && request.priority === 'low')) request.priority = priority;
      if (img) request.targets.add(img);
    }
    return request.promise;
  }
  function loadImage(img, value, { priority = 'auto' } = {}) {
    const token = {};
    imageRequests.set(img, token);
    const task = getPhoto(value, priority, img);
    if (!task) { img.src = value; return Promise.resolve(); }
    return task.then(blob => {
      if (imageRequests.get(img) !== token) return;
      const objectURL = URL.createObjectURL(blob);
      const release = () => {
        img.removeEventListener('load', release);
        img.removeEventListener('error', release);
        URL.revokeObjectURL(objectURL);
      };
      img.addEventListener('load', release, { once: true });
      img.addEventListener('error', release, { once: true });
      img.src = objectURL;
    }).catch(() => {
      // An expired login must not be bypassed with an old cached photograph.
      if (imageRequests.get(img) === token) img.dispatchEvent(new Event('error'));
    });
  }
  function prefetchPhoto(value) {
    const task = getPhoto(value, 'low');
    if (task) task.catch(() => {});
  }
  document.addEventListener('preferences:change', event => {
    if (event.detail.changed.includes('cacheMB') && 'caches' in window) cacheTask = cacheTask.then(async () => trimCache(await caches.open(PHOTO_CACHE))).catch(() => {});
  });
  window.PLANET_MEDIA = Object.freeze({ fetch: mediaFetch, loadImage, prefetchPhoto, clearPhotoCache });
})();
