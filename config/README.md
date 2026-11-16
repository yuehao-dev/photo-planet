# 改这里，让星球变成你的

| 文件 | 作用 |
| --- | --- |
| [site.js](site.js) | 唯一生效的公开站点配置：名字、首页、主题、聊天关联、音乐、性能 |
| [photos.example.json](photos.example.json) | 照片导入尺寸、质量和并发模板；复制到仓库外使用 |
| [import.example.json](import.example.json) | 本机聊天导入模板；复制到仓库外再填私人 ID 和路径 |
| [music-tracks.example.js](music-tracks.example.js) | 四季整曲套组参考，默认不加载，复制对象到 site.js 使用 |
| [../.env.example](../.env.example) | 服务器环境模板；复制到仓库外再填 OSS Key、登录账号密码 |

先看 [图文上手](../docs/GETTING-STARTED.md)，所有字段详见 [配置全解](../docs/CONFIGURATION.md)。

`site.js` 所有内容都会被访客下载；不要把 AccessKey、密码或聊天原始导出写进这里。
