# 聊天导入与增量

详细图文教程已集中到 [微信聊天与照片联动](WECHAT-LINK.md)，包含完整可运行的消息格式、字段映射、全量与增量、照片日期补记、OSS 发布顺序和故障排查。

![照片旁的聊天](images/photo-chat.png)

不接触真实数据的实验：

```sh
python tools/demo_chat_import.py --out ../photo-planet-lab
python -m http.server 5181 --bind 127.0.0.1 --directory ../photo-planet-lab/site
```

在独立私人副本中首次执行 `python tools/prepare_private.py --confirm`，将 `config/import.example.json` 复制到仓库外、修改后执行：

```sh
python tools/build_chats.py --config ../photo-planet-private/import.json
```

普通文字导入器不自动解密图片或转码所有附件；这里展示的是离线导出后的已发布数据，不是微信实时在线同步。
