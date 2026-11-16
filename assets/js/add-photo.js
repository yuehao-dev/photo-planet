/* 本机加照片模块（纯前端，无依赖，IndexedDB 持久化）
   对外只挂一个全局：window.PLANET_ADD
     ready            Promise，本地库打开 + 历史记录读完
     open()           弹系统选图
     all()            当前所有本机照片（结构与站点清单一致，多一个 local: true）
     onChange(cb)     新增/删除/首次加载完成后回调 cb(list)
     remove(id)       删除一张（内存 + IndexedDB + revoke blob url）
     isLocal(id)      是否本机新增
   另有 dev.* 只读调试钩子（测试页用，接入主站可以完全不管）：
     dev.addFiles(files)  直接把 File 数组喂进来（测试页造图用）
     dev.stats(id)        取 { size, origSize } 体积
     dev.takenAt(file)    单独跑一次 EXIF 解析
     dev.compress(file)   单独跑一次压缩
*/
(function () {
  'use strict';

  var DB_NAME = 'photo-planet';
  var DB_VERSION = 1;
  var STORE = 'photos';
  var MAX_SIDE = 1600;        // 压缩后最长边
  var Q_WEBP = 0.82;
  var Q_JPEG = 0.86;
  var EXIF_LIMIT = 256 * 1024; // 只在文件前 256KB 里找 EXIF

  var db = null;              // IDBDatabase，失败时为 null
  var items = [];             // 组装好的清单（按拍摄时间倒序）
  var urls = new Map();       // id -> objectURL，删除时要 revoke
  var meta = new Map();       // id -> { size, origSize }
  var listeners = [];
  var inputEl = null;
  var loaded = false;

  /* ───────────── 小工具 ───────────── */

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  // 本地时间 → 2026-10-27T16:31:08（不带 Z，跟站点清单一致）
  function fmtLocal(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function makeId() {
    var id;
    do {
      id = 'u_' + Math.random().toString(36).slice(2, 8);
    } while (urls.has(id) || items.some(function (p) { return p.id === id; }));
    return id;
  }

  // 无痕模式、隐私设置、磁盘满……统一给肉眼可见的提示，绝不静默失败
  function warn(msg) {
    try { window.alert(msg); } catch (e) { /* 弹窗被拦就只剩控制台 */ }
    try { console.warn('[PLANET_ADD]', msg); } catch (e) { /* 忽略 */ }
  }

  function pickOrientation(w, h) {
    if (w > h * 1.05) return 'landscape';
    if (h > w * 1.05) return 'portrait';
    return 'square';
  }

  /* ───────────── IndexedDB ───────────── */

  function openDb() {
    return new Promise(function (resolve) {
      var req;
      try {
        if (!window.indexedDB) throw new Error('NO_IDB');
        req = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        // Safari 无痕模式这里直接抛 SecurityError / InvalidStateError
        warn('这个浏览器不让存照片（可能是无痕模式）。换成普通窗口再试一次。');
        resolve(null);
        return;
      }
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () {
        warn('打开本地照片库失败：' + ((req.error && req.error.name) || '未知错误'));
        resolve(null);
      };
      req.onblocked = function () {
        warn('本地照片库被别的标签页占着，关掉其他页面再刷新。');
        resolve(null);
      };
    });
  }

  // 统一事务封装：fn 里同步操作 store，事务结束才 resolve
  function tx(mode, fn) {
    return new Promise(function (resolve, reject) {
      if (!db) { reject(new Error('本地照片库不可用')); return; }
      var t;
      try {
        t = db.transaction(STORE, mode);
      } catch (e) { reject(e); return; }
      var holder;
      try {
        holder = fn(t.objectStore(STORE));
      } catch (e) { reject(e); return; }
      t.oncomplete = function () { resolve(holder); };
      t.onerror = function () { reject(t.error || new Error('写入失败')); };
      t.onabort = function () { reject(t.error || new Error('写入被中断')); };
    });
  }

  /* ───────────── EXIF 拍摄时间 ───────────── */

  function sliceBuffer(file, len) {
    return new Promise(function (resolve) {
      var blob = file.slice(0, Math.min(len, file.size));
      if (blob.arrayBuffer) {
        blob.arrayBuffer().then(resolve, function () { resolve(null); });
        return;
      }
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { resolve(null); };
      fr.readAsArrayBuffer(blob);
    });
  }

  // 在缓冲里找 TIFF 头：'Exif\0\0' 后面紧跟 II/MM + 42
  function findTiff(view, len) {
    for (var i = 0; i + 10 <= len; i++) {
      if (view.getUint8(i) !== 0x45) continue;            // E
      if (view.getUint8(i + 1) !== 0x78) continue;        // x
      if (view.getUint8(i + 2) !== 0x69) continue;        // i
      if (view.getUint8(i + 3) !== 0x66) continue;        // f
      if (view.getUint8(i + 4) !== 0x00) continue;
      if (view.getUint8(i + 5) !== 0x00) continue;
      var t = i + 6;
      var b0 = view.getUint8(t);
      var b1 = view.getUint8(t + 1);
      var order = null;
      if (b0 === 0x49 && b1 === 0x49) order = true;        // II 小端
      else if (b0 === 0x4D && b1 === 0x4D) order = false;  // MM 大端
      if (order === null) continue;
      if (view.getUint16(t + 2, order) !== 42) continue;
      return { base: t, le: order };
    }
    return null;
  }

  // 返回 'YYYY-MM-DDTHH:mm:ss'，解析不出来返回 null
  function parseExif(buf) {
    if (!buf) return null;
    var view = new DataView(buf);
    var len = buf.byteLength;
    var tiff = findTiff(view, len);
    if (!tiff) return null;

    var base = tiff.base;
    var le = tiff.le;
    var avail = len - base;
    if (avail < 8) return null;

    function u16(rel) {
      if (rel < 0 || rel + 2 > avail) return -1;
      return view.getUint16(base + rel, le);
    }
    function u32(rel) {
      if (rel < 0 || rel + 4 > avail) return -1;
      return view.getUint32(base + rel, le);
    }

    // 读一个 IFD，返回 [{tag, type, count, value}]
    function readIfd(rel) {
      var n = u16(rel);
      if (n < 0 || n > 512) return null;
      var out = [];
      for (var i = 0; i < n; i++) {
        var e = rel + 2 + i * 12;
        if (e + 12 > avail) break;
        out.push({
          tag: u16(e),
          type: u16(e + 2),
          count: u32(e + 4),
          value: u32(e + 8)   // count 超过 4 字节时，这里就是偏移量
        });
      }
      return out;
    }

    var ifd0 = readIfd(u32(4));
    if (!ifd0) return null;

    var exifRel = 0;
    for (var i = 0; i < ifd0.length; i++) {
      if (ifd0[i].tag === 0x8769) { exifRel = ifd0[i].value; break; }
    }
    if (!exifRel) return null;

    var exifIfd = readIfd(exifRel);
    if (!exifIfd) return null;

    var str = null;
    for (var j = 0; j < exifIfd.length; j++) {
      var en = exifIfd[j];
      if (en.tag !== 0x9003 || en.type !== 2 || en.count <= 4) continue;
      // ASCII 且 count > 4 → 值是相对 TIFF 头的偏移
      var chars = [];
      for (var k = 0; k < en.count; k++) {
        var pos = base + en.value + k;
        if (pos >= len) break;
        var b = view.getUint8(pos);
        if (b === 0) break;
        chars.push(String.fromCharCode(b));
      }
      str = chars.join('').trim();
      break;
    }
    if (!str) return null;

    // 'YYYY:MM:DD HH:MM:SS'
    var m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(str);
    if (!m) return null;
    var y = +m[1];
    if (y < 1900 || y > 2200) return null;
    return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6];
  }

  async function readExifTime(file) {
    try {
      var buf = await sliceBuffer(file, EXIF_LIMIT);
      var value = parseExif(buf);
      return window.PLANET_DATES.valid(value) ? value : null;
    } catch (e) {
      return null;
    }
  }

  /* ───────────── 解码 + 压缩 ───────────── */

  function loadViaImg(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('decode')); };
      img.src = url;
    });
  }

  // 优先 createImageBitmap；Safari 对 HEIC 支持有限，必须有 <img> 兜底
  async function decode(file) {
    if (typeof window.createImageBitmap === 'function') {
      try {
        var bmp = await window.createImageBitmap(file);
        return {
          source: bmp,
          width: bmp.width,
          height: bmp.height,
          release: function () { if (bmp.close) bmp.close(); }
        };
      } catch (e) {
        // 继续走 <img>，Safari 能解 HEIC 就是靠这一步
      }
    }
    var url = URL.createObjectURL(file);
    try {
      var img = await loadViaImg(url);
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (!w || !h) throw new Error('decode');
      return {
        source: img,
        width: w,
        height: h,
        release: function () { URL.revokeObjectURL(url); }
      };
    } catch (e) {
      URL.revokeObjectURL(url);
      throw new Error('这个格式解不开（HEIC 在安卓 Chrome 上不行，用 Safari 或先转成 JPG）');
    }
  }

  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      try {
        canvas.toBlob(function (blob) { resolve(blob || null); }, type, quality);
      } catch (e) {
        resolve(null);
      }
    });
  }

  // 等比缩到最长边 ≤1600（原图更小就不放大），输出 webp，不支持就 jpeg
  async function compress(file) {
    var dec = await decode(file);
    try {
      var scale = Math.min(1, MAX_SIDE / Math.max(dec.width, dec.height));
      var w = Math.max(1, Math.round(dec.width * scale));
      var h = Math.max(1, Math.round(dec.height * scale));

      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(dec.source, 0, 0, w, h);

      var blob = await toBlob(canvas, 'image/webp', Q_WEBP);
      // 有的浏览器不支持 webp 编码，toBlob 会回 null 或给出 png
      if (!blob || blob.type !== 'image/webp') {
        blob = await toBlob(canvas, 'image/jpeg', Q_JPEG);
      }
      if (!blob) throw new Error('压缩失败');

      return { blob: blob, width: w, height: h };
    } finally {
      dec.release();
    }
  }

  /* ───────────── 组装 / 增删 ───────────── */

  function toItem(rec) {
    var url = URL.createObjectURL(rec.blob);
    urls.set(rec.id, url);
    meta.set(rec.id, { size: rec.size || rec.blob.size, origSize: rec.origSize || 0 });
    return {
      id: rec.id,
      file: rec.name,
      thumbUrl: url,
      fullUrl: url,
      width: rec.width,
      height: rec.height,
      ratio: rec.ratio,
      orientation: rec.orientation,
      takenAt: rec.takenAt || null,
      dateSource: rec.dateSource || 'legacy',
      tags: ['本机'],
      local: true
    };
  }

  function sortItems() {
    items.sort(window.PLANET_DATES.compare);
  }

  function emit() {
    sortItems();
    var snapshot = api.all();
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](snapshot); } catch (e) { console.warn('[PLANET_ADD] 回调报错', e); }
    }
  }

  function snapshotList() {
    return items.map(function (p) {
      return {
        id: p.id,
        file: p.file,
        thumbUrl: p.thumbUrl,
        fullUrl: p.fullUrl,
        width: p.width,
        height: p.height,
        ratio: p.ratio,
        orientation: p.orientation,
        takenAt: p.takenAt,
        dateSource: p.dateSource,
        tags: p.tags.slice(),
        local: true
      };
    });
  }

  async function buildEntry(file) {
    // 只认 EXIF 原始拍摄时间；没有就留空，稍后可在「记一笔」补记。
    var takenAt = await readExifTime(file);
    if (!window.PLANET_DATES.valid(takenAt)) takenAt = null;

    // 2. 压缩
    var out = await compress(file);

    var ratio = Math.round((out.width / out.height) * 10000) / 10000;
    var id = makeId();
    var record = {
      id: id,
      name: file.name || 'photo',
      blob: out.blob,
      takenAt: takenAt,
      dateSource: takenAt ? 'exif' : 'unknown',
      width: out.width,
      height: out.height,
      ratio: ratio,
      orientation: pickOrientation(out.width, out.height),
      createdAt: Date.now(),
      size: out.blob.size,        // 压缩后体积（调试用）
      origSize: file.size || 0    // 原始体积（调试用）
    };
    return record;
  }

  async function addFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    if (!db) {
      warn('本地照片库不可用，照片存不下来（无痕模式 / 浏览器设置）。');
      return;
    }

    var errors = [];
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var name = file.name || '照片';
      if (file.type && !/^image\//.test(file.type)) {
        errors.push(name + '：不是图片');
        continue;
      }
      try {
        var record = await buildEntry(file);
        try {
          await tx('readwrite', function (store) { return store.put(record); });
        } catch (e) {
          // 写入失败：把已经建好的 url 撤掉，别泄漏
          var pending = urls.get(record.id);
          if (pending) { URL.revokeObjectURL(pending); urls.delete(record.id); }
          throw new Error('存不进本地库（可能是空间满了 / 无痕模式）');
        }
        items.push(toItem(record));
        emit();
      } catch (e) {
        errors.push(name + '：' + (e && e.message ? e.message : e));
      }
    }

    if (errors.length) {
      warn('有 ' + errors.length + ' 张没加上：\n' + errors.join('\n'));
    }
  }

  async function loadAll() {
    var recs = [];
    try {
      await tx('readonly', function (store) {
        var out = [];
        var req = store.openCursor();
        req.onsuccess = function () {
          var cur = req.result;
          if (cur) { out.push(cur.value); cur.continue(); }
        };
        recs = out;
        return out;
      });
    } catch (e) {
      warn('读取本地照片失败：' + (e && e.message ? e.message : e));
      return;
    }

    items = [];
    for (var i = 0; i < recs.length; i++) {
      var rec = recs[i];
      if (!rec || !rec.blob) continue;
      try {
        items.push(toItem(rec));
      } catch (e) { /* 坏记录跳过 */ }
    }
    loaded = true;
  }

  /* ───────────── 对外接口 ───────────── */

  function open() {
    if (!inputEl) {
      inputEl = document.createElement('input');
      inputEl.type = 'file';
      inputEl.accept = 'image/*';
      inputEl.multiple = true;
      inputEl.setAttribute('aria-hidden', 'true');
      inputEl.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
      inputEl.addEventListener('change', function () {
        // 先把 FileList 拷成数组：紧接着清空 value 会连带清空 FileList
        var files = Array.prototype.slice.call(inputEl.files || []);
        inputEl.value = '';   // 允许重选同一张
        addFiles(files);
      });
      document.body.appendChild(inputEl);
    }
    inputEl.value = '';
    inputEl.click();
  }

  function all() {
    return snapshotList();
  }

  function onChange(cb) {
    if (typeof cb !== 'function') return function () {};
    listeners.push(cb);
    // 已经加载完了就立刻补一次，避免接入方注册晚了错过首帧
    if (loaded) {
      try { cb(snapshotList()); } catch (e) { console.warn('[PLANET_ADD] 回调报错', e); }
    }
    return function () {
      var i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function remove(id) {
    var idx = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) { idx = i; break; }
    }
    if (idx < 0) return Promise.resolve(false);

    function forget() {
      var url = urls.get(id);
      if (url) { URL.revokeObjectURL(url); urls.delete(id); }
      meta.delete(id);
      items.splice(idx, 1);
      emit();
      return true;
    }

    if (!db) return Promise.resolve(forget());
    return tx('readwrite', function (store) { return store.delete(id); }).then(forget, function () {
      forget();  // 库里删失败也要从界面拿掉，下次刷新会自己回来
      return false;
    });
  }

  function isLocal(id) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === id) return items[i].local === true;
    }
    return false;
  }

  var api = {
    ready: null,
    open: open,
    all: all,
    onChange: onChange,
    remove: remove,
    isLocal: isLocal,
    // 只给测试页 / 未来拖拽上传用，主站可以不理会
    dev: {
      addFiles: function (files) { return addFiles(files); },
      stats: function (id) { return meta.get(id) || null; },
      takenAt: function (file) { return readExifTime(file); },
      compress: function (file) { return compress(file); }
    }
  };

  api.ready = (async function () {
    db = await openDb();
    if (db) await loadAll();
    loaded = true;
    emit();      // ready 之后统一通知一次
    return api;
  })();

  window.PLANET_ADD = api;
})();
