"""Read Moect 1.2.8 JSON exports; never access WeChat databases or media keys."""
from datetime import datetime, timedelta, timezone


def adapt(row, expected):
    if row.get('session') != expected or expected.endswith('@chatroom'):
        raise ValueError('Moect 会话与配置不一致，或不是一对一聊天。')
    mine = row.get('is_sender')
    identity = row.get('sender_wxid')
    system = row.get('type') in (10000, 10002)
    if not system and (not isinstance(mine, bool) or not identity or (not mine and identity != expected) or (mine and identity == expected)):
        raise ValueError('Moect 发送者身份不完整或冲突。')
    stamp = row.get('create_time')
    if isinstance(stamp, bool) or not isinstance(stamp, int):
        raise ValueError('Moect create_time 必须是秒级整数。')
    shard = row.get('shard')
    if isinstance(shard, bool) or not isinstance(shard, int) or shard < 0:
        raise ValueError('Moect 分库编号缺失，不能安全去重。')
    text = row.get('text', '')
    if not isinstance(text, str):
        raise ValueError('Moect text 必须是字符串。')
    result = {
        'chat_username': expected, 'sender_username': None if system else identity,
        'sender': '系统' if system else '我' if mine else '对方',
        'timestamp': stamp,
        'time': datetime.fromtimestamp(stamp, timezone(timedelta(hours=8))).isoformat(),
        'type': '系统消息' if system else '引用消息' if row.get('kind') == 'quote' else row.get('type_name'),
        'server_id': row.get('server_id'), 'local_id': row.get('local_id'),
        'source_database': 'moect:shard:' + str(shard), 'content': text,
    }
    if isinstance(row.get('quote'), dict):
        result['_moect_quote'] = row['quote']
    elif isinstance(row.get('extra'), dict) and isinstance(row['extra'].get('reply'), dict):
        result['_moect_quote'] = row['extra']['reply']
    return result
