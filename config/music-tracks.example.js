/* 参考片段，默认不加载。把需要的这一项复制进 site.js 的 music.sets 数组。
 * 下面文件是占位路径，不随包附带。放入自己的四季文件后使用。
 * baseUrl 相对于网页根目录；每一季既可写字符串，也可写格式回退数组。
 */
const exampleMusicSet = {
  id: 'my-four-seasons', title: '另一年的四季', format: 'tracks',
  baseUrl: 'assets/audio/my-four-seasons/', duration: 0,
  tracks: {
    spring: ['spring.m4a', 'spring.mp3'], summer: ['summer.m4a', 'summer.mp3'],
    autumn: ['autumn.m4a', 'autumn.mp3'], winter: ['winter.m4a', 'winter.mp3']
  },
  titles: { spring: '春 · 出门走走', summer: '夏 · 一口汽水', autumn: '秋 · 路边落叶', winter: '冬 · 暖暖的灯' }
};
