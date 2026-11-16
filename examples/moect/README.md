# Moect 结构的虚构导出

这两份文件用 Moect 1.2.8 的字段组织，内容独立虚构，不是从任何真实聊天删改而来。`full.json` 8 条，`increment.json` 3 条（含 1 条重复），导入后得到 10 条／2 天，包含一条引用。

在仓库根目录运行：

```sh
python tools/demo_chat_import.py --format moect --out ../photo-planet-moect-lab
python -m http.server 5181 --bind 127.0.0.1 --directory ../photo-planet-moect-lab/site
```

打开 <http://127.0.0.1:5181/chat.html?date=2025-03-08>。这条实验实际经过 Moect 适配与去重，不需要提供私人导出、微信登录或云密钥。实验目录必须是新的。

实际文件可能包含更多字段，适配器只消费已支持的部分。原始资源路径保留在第三方归档中，本实验不复制附件。
