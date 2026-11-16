"""Validate explicit export-field mappings; no guessing across unrelated conversations."""
from pathlib import Path
from datetime import datetime, timedelta, timezone
import json
import math

FIELDS = {'chat_username', 'sender_username', 'sender', 'timestamp', 'time', 'type', 'server_id', 'local_id', 'source_database', 'content'}
DEFAULTS = {'format': 'standard', 'filePatterns': ['*.jsonl', '聊天记录.json', '*本机全部历史.json', 'full.json', 'increment*.json'], 'fields': {}, 'expectedChatId': '', 'selfIds': [], 'selfLabels': ['我'],
            'otherLabels': [], 'systemLabels': ['系统'], 'timestampUnit': 'seconds', 'deriveTime': False}


def validate_settings(value):
    if not isinstance(value, dict) or set(value) - set(DEFAULTS):
        raise ValueError('聊天导入配置含未知字段；请参照 config/import.example.json。')
    settings = {**DEFAULTS, **value}
    if not isinstance(settings['filePatterns'], list) or not settings['filePatterns'] or any(not isinstance(v, str) or not v or '/' in v or '\\' in v or '..' in v for v in settings['filePatterns']):
        raise ValueError('filePatterns 需要文件名匹配模式，不允许目录或父路径。')
    if settings['format'] not in ('standard', 'moect'):
        raise ValueError('format 仅支持 standard 或 moect。')
    if settings['format'] == 'moect' and (not settings['expectedChatId'] or settings['fields']):
        raise ValueError('Moect 模式需指定 expectedChatId，fields 保持为空。')
    fields = settings['fields']
    if not isinstance(fields, dict) or set(fields) - FIELDS or any(not isinstance(v, str) or not v or len(v) > 100 for v in fields.values()):
        raise ValueError('fields 仅支持受说明的顶层字段映射。')
    for key in ['selfIds', 'selfLabels', 'otherLabels', 'systemLabels']:
        if not isinstance(settings[key], list) or any(not isinstance(v, str) or not v or len(v) > 200 for v in settings[key]):
            raise ValueError('发送者规则必须是非空字符串组成的数组。')
    if not isinstance(settings['expectedChatId'], str) or len(settings['expectedChatId']) > 200:
        raise ValueError('expectedChatId 不正确。')
    if settings['timestampUnit'] not in ['seconds', 'milliseconds'] or not isinstance(settings['deriveTime'], bool):
        raise ValueError('时间规则不正确。')
    groups = [set(settings[k]) for k in ['selfLabels', 'otherLabels', 'systemLabels']]
    if any(groups[a] & groups[b] for a, b in [(0, 1), (0, 2), (1, 2)]):
        raise ValueError('双方与系统的标签不能重叠。')
    return settings


def load_config(path):
    path = Path(path).resolve()
    value = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(value, dict) or value.get('version') != 1 or set(value) - {'version', 'paths', 'import'}:
        raise ValueError('配置需要 version: 1、paths 和 import。')
    paths = value.get('paths', {})
    if not isinstance(paths, dict) or set(paths) - {'source', 'output', 'stateDir'} or any(not isinstance(v, str) or not v for v in paths.values()):
        raise ValueError('paths 仅支持 source、output、stateDir。')
    return {key: (path.parent / item).resolve() for key, item in paths.items()}, validate_settings(value.get('import', {}))


def adapt_row(row, settings):
    if not isinstance(row, dict):
        return row
    if settings['format'] == 'moect':
        from moect_adapter import adapt
        row = adapt(row, settings['expectedChatId'])
    result = dict(row)
    for canonical, source in settings['fields'].items():
        if source in row:
            result[canonical] = row[source]
        else:
            result.pop(canonical, None)
    if not result.get('chat_username') and settings['expectedChatId']:
        result['chat_username'] = settings['expectedChatId']
    sender, identity = result.get('sender'), result.get('sender_username')
    mine = sender in settings['selfLabels'] or identity in settings['selfIds']
    other = sender in settings['otherLabels'] or (identity is not None and identity == result.get('chat_username'))
    system = sender in settings['systemLabels']
    if sum([mine, other, system]) > 1:
        raise ValueError('发送者规则互相冲突，已停止导入。')
    if mine:
        result['sender'] = '我'
    elif system:
        result['sender'] = '系统'
    elif other:
        result['sender_username'] = result.get('chat_username')
    stamp = result.get('timestamp')
    if settings['timestampUnit'] == 'milliseconds':
        if isinstance(stamp, bool) or not isinstance(stamp, (int, float)) or not math.isfinite(stamp):
            raise ValueError('毫秒时间戳不是有效数值。')
        result['timestamp'] = math.floor(stamp / 1000)
    if settings['deriveTime'] and not result.get('time'):
        stamp = result.get('timestamp')
        if isinstance(stamp, bool) or not isinstance(stamp, (int, float)):
            raise ValueError('无法从无效时间戳生成日期。')
        result['time'] = datetime.fromtimestamp(stamp, timezone(timedelta(hours=8))).isoformat(timespec='seconds')
    return result
