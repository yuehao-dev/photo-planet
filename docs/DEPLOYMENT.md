# 两种部署方式

首次配置 OSS、登录账号和上传计划，先看 [OSS 图文步骤](OSS-SETUP.md)。集中公开配置是 `config/site.js`。

## 公开演示

仓库中的数据都是虚构的，可使用默认 Docker，也可以把运行文件放到任意静态托管。GitHub Pages 适合演示，**不适合承载私人聊天**。

运行文件包括 `index.html`、`chat.html`、`assets/`、`data/`、`public/`、`demo-media/`、`config/site.js`，以及随包分发的 `LICENSE`、`ASSETS.md` 和 `LICENSES/`。生成站点包：

```sh
python tools/package_site.py --out ../photo-planet-site.zip
```

站点包不包含源码工具、服务器配置或凭据，但包含当前相册与聊天内容。私人模式必须额外传 `--include-private`，生成的包仅用于自己的受保护服务器，不能放公开 Release。

## 私人 OSS 网站

前提：HTTPS、私有 OSS Bucket、自己的 RAM 最小权限凭据、受保护的页面入口。`deploy/compose.private.example.yaml` 和 `deploy/nginx.private.conf.example` 是需要修改的示例，不会自动创建域名、证书、Bucket 或上传资源。

1. 在独立私人副本导入自己的照片和文字聊天，见 [私人数据说明](PRIVATE-DATA.md)。
2. 把 `.env.example` 复制到仓库外的 `../photo-planet-private/.env`，填写自己的值。`ALBUM_PASSWORD` 至少 12 个字符，`ALBUM_PUBLIC_ORIGIN` 必须是无路径的 HTTPS origin。不要把文件放进网页根目录。
3. 使用 Node.js 22+ 生成带随机盐和会话密钥的服务器配置：

   ```sh
   node --env-file=../photo-planet-private/.env tools/configure_gateway.cjs ../photo-planet-private/gateway-empty.json
   python tools/map_gateway.py --config ../photo-planet-private/gateway-empty.json --out ../photo-planet-private/gateway.json --plan ../photo-planet-private/upload-plan.json
   ```

   第二条命令读取当前照片／聊天清单，生成精确资源白名单和本地路径到 OSS Key 的上传计划，不上传任何内容，也不输出密钥。该通用工具处理照片、音乐及文字聊天分段，不自动处理不同工具导出的富媒体附件。

4. 用 OSS 控制台、官方 ossutil 或自己使用的上传工具，按 `upload-plan.json` 的 `objects` 映射上传。对象保持私有。先上传媒体和聊天分段，最后上传 `data/chat/index.json` 对应的对象。可用 `Content-Type`：WebP `image/webp`、Ogg `audio/ogg`、FLAC `audio/flac`、M4A `audio/mp4`、JSON `application/json`。资源数量多时推荐使用 SDK 批量上传，而不是人工逐项操作。
5. RAM 只需读取这些对象。上传可使用另外的临时凭据，不需要给运行中的网关删除、跨桶读写或桶管理权限。Bucket CORS 放行自己的 HTTPS origin 的 GET／HEAD，媒体由浏览器读取短时签名地址，浏览器不会获得 AccessKeySecret。
6. 私人前端配置改为：

   ```js
   // config/site.js：保留其余设置，只修改对应项。
   demo: false,
   chat: { enabled: true, baseUrl: 'data/chat/' },
   media: {
     signedUrls: true,
     signedHost: 'YOUR-BUCKET.oss-YOUR-REGION.aliyuncs.com',
     photoBaseUrl: 'media/',
     musicBaseUrl: 'media/assets/audio/stems/'
   }
   ```

   `signedHost` 必须与自己的真实 Bucket 域名完全一致。删除演示的 `chat.localAssetBaseUrl`。不要把云凭据写入这个前端文件。
7. 修改 Nginx 示例中的域名、证书、挂载目录。默认示例子路径是 `/album/`；修改它时，同步调整 Nginx 全部 location、挂载目录和服务端 `auth.basePath`。`auth.publicOrigin` 必须与访问域名相符。Cookie 会固定到该子路径。
8. 用 `package_site.py --include-private` 生成运行包，解压到 `../photo-planet-private/runtime/`，不要把整个源码仓库作为 web root。证书放 `../photo-planet-private/tls/`，私有服务器配置放外部挂载目录。Linux 上为凭据文件设置仅部署账户可读权限；Windows 上按 NTFS ACL 限制访问。
9. 确认占用端口后启动自己调整过的 Compose。网关只用 `expose`，不映射公网端口。Nginx 把经过校验的客户端地址写入 `X-Album-Client-IP`，不要信任公网请求自行带来的该头。

上线后验证：未登录打不开页面、聊天 JSON 和媒体解析接口；账号密码可正常登录；连续输错会锁定；图片／音乐的跨域和过期续签正常；其他网站配置未被覆盖。

## 增量发布

重新导入并生成白名单及上传计划，上传新对象，再部署新的服务器配置。网关支持 SIGHUP 原子重读配置，失败时保留旧配置。若需保持旧页面可读，发布新代际时保留旧分段对象及其白名单；本通用映射工具只列出当前快照，不自动合并历史白名单。

## 说明

- 本地演示不要求 Node、OSS 或数据库服务；网关只在选择私有 OSS 模式时运行。
- 当前限错计数在单进程内存中，重启会清空；多实例部署需要另做共享限流。
- 部署示例已做静态检查，未在你的云账户中自动部署；你自己的证书、网络和 OSS 权限需要实际验收。
