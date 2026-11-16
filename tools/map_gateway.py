#!/usr/bin/env python3
"""Create exact photo/music/chat allowlists and an upload plan; never upload or print credentials."""
from pathlib import Path
import argparse
import json
import os

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--config', required=True, type=Path)
parser.add_argument('--out', required=True, type=Path)
parser.add_argument('--plan', required=True, type=Path)
args = parser.parse_args()
for file in [args.config, args.out, args.plan]:
    if file.resolve().is_relative_to(ROOT):
        parser.error('Configuration and upload plan must remain outside the repository/web root.')
if args.out.exists() or args.plan.exists():
    parser.error('Use new output files; existing configuration is never overwritten.')
config = json.loads(args.config.read_text(encoding='utf-8-sig'))
config['resources'] = {}
plan = {}


def mapping(relative, key):
    source = (ROOT / relative).resolve()
    if not source.is_relative_to(ROOT) or not source.is_file() or source.is_symlink():
        raise ValueError('Missing or unsafe resource')
    plan[relative] = key


photos = json.loads((ROOT / 'data/photos.json').read_text(encoding='utf-8'))['photos']
for photo in photos:
    for field in ['thumbUrl', 'fullUrl']:
        route = photo[field]
        if not route.startswith('public/photos/') or not route.endswith('.webp') or '..' in route or '\\' in route:
            raise ValueError('Expected generated local WebP photos')
        key = 'photo/' + route.removeprefix('public/photos/')
        mapping(route, key); config['resources'][route] = dict(key=key)
for audio in (ROOT / 'assets/audio').rglob('*'):
    if audio.is_file() and audio.suffix in {'.ogg', '.flac', '.mp3', '.m4a', '.wav'}:
        route = audio.relative_to(ROOT).as_posix()
        key = 'chatData/site-media/' + route
        mapping(route, key); config['resources'][route] = dict(key=key)
index = json.loads((ROOT / 'data/chat/index.json').read_text(encoding='utf-8'))
paths = {'index.json'}
for day in index['days'].values():
    url = day['url']
    target = (ROOT / 'data/chat' / url).resolve()
    if not target.is_relative_to((ROOT / 'data/chat').resolve()):
        raise ValueError('Unsafe chat path')
    manifest = json.loads(target.read_text(encoding='utf-8'))
    paths.add(url); paths.update(c['url'] for c in manifest['chunks'])
for relative in sorted(paths):
    mapping('data/chat/' + relative, config['chatPrefix'] + relative)
config['chatPaths'] = sorted(paths)
config.pop('chatObjects', None)
config.pop('mediaRegistry', None)
for path, data in [(args.out, config), (args.plan, {'version': 1, 'objects': plan})]:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2); f.write('\n')
print(json.dumps({'resources': len(config['resources']), 'chatFiles': len(paths), 'uploadObjects': len(plan), 'uploaded': False}))
