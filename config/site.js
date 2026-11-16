/* 网站公开配置：改完保存并刷新。这里的所有内容都会被访客看到。
 * 不要填 OSS AccessKey、服务器密码或真实聊天导出。
 * 配置全解：docs/CONFIGURATION.md；上手图解：docs/GETTING-STARTED.md。
 */
window.SITE_CONFIG = {
  demo: true,
  people: { her: '小夏', me: '阿屿', system: '那天的小记号' },
  site: {
    title: '照片星球', nameSuffix: '的',
    description: '把重要的照片与那天说过的话，一起好好收着。',
    eyebrow: 'PRIVATE SPACE', badge: '虚构数据演示',
    note: '', heroLead: '一共', heroAfterCount: '张照片，全都收在这颗小星球上。',
    heroSecondLine: '不着急，慢慢翻。', albumButton: '翻开四季相册',
    chatTitle: '那天的话', chatEyebrow: 'OUR LITTLE DAYS',
    photoChatTitle: '那天，我们还说了这些', photoChatButton: '再翻翻那天的聊天 ↗',
    photoChatReaderTitle: '那天，我们说过的话', photoChatMappedTitle: '配给这张的，那天的话',
    galleryEyebrow: 'FOUR SEASONS, LITTLE JOYS',
    galleryTitles: { all: '这一整颗小星球', fav: '悄悄收藏的喜欢', undated: '那些忘了日期的日子' },
    footerLines: ['照片会一直加，', '开心也是。'], footerEyebrow: 'OUR LITTLE DAYS',
    icon: 'assets/icons/planet.svg', touchIcon: 'assets/icons/apple-touch-icon.png',
    themeColor: '#faf6ee', robots: 'noindex, nofollow'
  },
  // 默认值只作用于没有自行改过的设置。网页“恢复默认”会回到这里。
  preferences: {
    enabled: true, theme: 'cream', accent: '#ff5533',
    columns: 'auto', spacing: 'cozy', width: 'cozy', fit: 'cover',
    hero: 'favorites', motion: 'light', preload: 2, saver: false, cacheMB: 48,
    chatFont: 15, chatSpacing: 'cozy', chatAlign: 'bubbles', chatMedia: 'auto', resumeChat: true
  },
  features: { addPhotos: true }, // 网页添加只存当前浏览器，不自动同步 OSS。
  together: { enabled: true, since: '2025-01-01T00:00:00+08:00', prefix: '在一起第', suffix: '天', confetti: true },
  chat: {
    enabled: true, baseUrl: 'data/chat/', localAssetBaseUrl: 'demo-media/',
    initialDate: '', // 留空打开最近一天；URL ?date= 和阅读书签优先。
    photoDateFallback: true, // 没有独立聊天日期时，按照片的完整年月日匹配。
    photoDateOverrides: {}, // 例如 'demo-spring-6': '2025-03-23'；优先级最高。
    previewLines: 6, maxVisibleChunks: 3, searchLimit: 100,
    preloadPx: 900, requestTimeoutMs: 20000, indexRefreshMs: 60000,
    dayCacheEntries: 16, chunkCacheEntries: 32,
    senderAliases: { me: ['我', '自己'], her: ['对方'], system: ['系统'] },
    // 仅在浏览器显示时按字面替换；不修改原始导出、OSS 或消息 ID。
    // 例：[{ from: '旧称呼', to: '新称呼' }]。空数组保持正文原样。
    textReplacements: []
  },
  media: { signedUrls: false, signedHost: '', photoBaseUrl: '', musicBaseUrl: 'assets/audio/stems/' },
  loading: { photoConcurrency: 4, cacheDays: 7, maxImageMB: 8 },
  music: {
    enabled: true, autoplay: false, volume: 0.55, fadeSeconds: 7, chatDuckVolume: 0.18,
    sets: [{ id: 'paper-v42', title: '纸页之间', baseUrl: '', duration: 120, format: 'stems',
      titles: { spring: '春 · 今天也想见你', summer: '夏 · 分你一口冰淇淋', autumn: '秋 · 踩着落叶去约会', winter: '冬 · 把手放进我口袋' } }]
  },
  seasons: {
    enabled: true, initial: 'autumn', effects: true,
    labels: { all: '四季', spring: '春', summer: '夏', autumn: '秋', winter: '冬' },
    names: { spring: '春天', summer: '夏天', autumn: '秋天', winter: '冬天' },
    // 必须完整覆盖 1—12 月且不重复；适合改为南半球季节。
    months: { spring: [3, 4, 5], summer: [6, 7, 8], autumn: [9, 10, 11], winter: [12, 1, 2] }
  },
  photoSource: { mode: 'local' }, places: {},
  gallery: { minRatio: 0.72, maxRatio: 1.55, tallRatio: 0.56 },
  storage: { favKey: 'photo-planet.favs.v1', preferencesKey: 'photo-planet.preferences.v2' }
};
