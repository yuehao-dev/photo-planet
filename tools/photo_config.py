"""Photo derivation settings; original files remain read-only."""
import json
from pathlib import Path


def validate_settings(value):
    if not isinstance(value, dict) or value.get('version') != 1 or set(value) - {'version', 'source', 'thumbWidth', 'fullWidth', 'quality', 'workers'}:
        raise ValueError('照片配置需要 version: 1，且不能含未知字段。')
    result = {'thumbWidth': 880, 'fullWidth': 1500, 'quality': 80, 'workers': 4, **value}
    for key, lo, hi in [('thumbWidth', 320, 1600), ('fullWidth', 640, 4096), ('quality', 40, 95), ('workers', 1, 8)]:
        if type(result[key]) is not int or not lo <= result[key] <= hi:
            raise ValueError(f'{key} 需要 {lo}—{hi} 的整数。')
    if result['fullWidth'] < result['thumbWidth']:
        raise ValueError('fullWidth 不能小于 thumbWidth。')
    if 'source' in result and (not isinstance(result['source'], str) or not result['source']):
        raise ValueError('source 需要有效目录路径。')
    return result


def load_config(path):
    path = Path(path).resolve()
    value = validate_settings(json.loads(path.read_text(encoding='utf-8-sig')))
    if value.get('source'):
        value['source'] = str((path.parent / value['source']).resolve())
    return value
