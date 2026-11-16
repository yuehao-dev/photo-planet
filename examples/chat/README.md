# 虚构的微信导出样例

- `full.json`：8 条完整消息。
- `increment-2025-03-09.json`：3 条增量，其中 1 条与全量重复；合并后 10 条、2 天。
- 引用、双方 ID、时间戳和消息编号均为合成演示，不来自真实聊天。

无需填私人路径，在仓库根目录运行：

```sh
python tools/demo_chat_import.py --out ../photo-planet-lab
python -m http.server 5181 --bind 127.0.0.1 --directory ../photo-planet-lab/site
```

打开本机 5181 端口，春天第一张插画对应第一天，第二张通过配置配给第二天。详细说明见 [照片与微信聊天联动](../../docs/WECHAT-LINK.md)。
