#!/usr/bin/env python3
"""Run a wholly fictional full + incremental import in a separate new local lab."""
from pathlib import Path
import argparse
import json
import shutil
from build_chats import build

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    target = args.out.resolve()
    if target == ROOT or target.is_relative_to(ROOT) or target.exists():
        parser.error('Choose a NEW directory outside the repository. Existing data is never replaced.')
    if (ROOT / '.private-mode').exists():
        parser.error('Use the public fictional demo checkout for this lab.')
    # Check the copied album before creating anything; never clone arbitrary imported photos.
    photos = json.loads((ROOT / 'data/photos.json').read_text(encoding='utf-8'))
    if len(photos['photos']) != 24 or any(p.get('sourceType') != 'demo' for p in photos['photos']):
        parser.error('The source album is not the fictional demo.')
    source = target / 'exports'; source.mkdir(parents=True)
    site = target / 'site'; site.mkdir()
    for name in ['index.html', 'chat.html', 'LICENSE', 'ASSETS.md']:
        shutil.copyfile(ROOT / name, site / name)
    for name in ['assets', 'public', 'data', 'demo-media', 'LICENSES']:
        shutil.copytree(ROOT / name, site / name)
    (site / 'config').mkdir()
    shutil.copyfile(ROOT / 'config/site.js', site / 'config/site.js')
    # Drop the copied fictional snapshot, then publish only the imported example rows.
    shutil.rmtree(site / 'data/chat')
    shutil.copyfile(ROOT / 'examples/chat/full.json', source / 'full.json')
    first = build(source, site / 'data/chat', target / 'cache')
    shutil.copyfile(ROOT / 'examples/chat/increment-2025-03-09.json', source / 'increment.json')
    second = build(source, site / 'data/chat', target / 'cache')
    assert first['count'] == 8 and second['count'] == 10 and second['duplicates'] == 1
    with (site / 'config/site.js').open('a', encoding='utf-8') as output:
        output.write("\nwindow.SITE_CONFIG.chat.initialDate = '2025-03-08';\nwindow.SITE_CONFIG.chat.photoDateOverrides = { 'demo-spring-2': '2025-03-09' };\n")
    print(json.dumps({'full': first['count'], 'afterIncrement': second['count'], 'deduplicated': second['duplicates'], 'days': second['days'], 'privateDataRead': False}))
    print('Serve the new lab/site directory with python -m http.server, then open the first spring illustration to read its imported messages.')


if __name__ == '__main__':
    main()
