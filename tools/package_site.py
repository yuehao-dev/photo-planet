#!/usr/bin/env python3
"""Package runtime files only. The package can contain conversations; review before sharing."""
import argparse
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', required=True, type=Path)
parser.add_argument('--include-private', action='store_true', help='Explicitly allow packaging an existing personal-data checkout')
args = parser.parse_args()
if (ROOT / '.private-mode').exists() and not args.include_private:
    parser.error('Personal-data checkout detected. This archive includes private photos/chat; use --include-private only for your own protected deployment.')
target = args.out.resolve()
if target == ROOT or ROOT in target.parents:
    parser.error('Output must be outside the repository.')
target.parent.mkdir(parents=True, exist_ok=True)
files = [ROOT / name for name in ['index.html', 'chat.html', 'LICENSE', 'ASSETS.md', 'config/site.js']]
for folder in ['assets', 'data', 'public', 'demo-media', 'LICENSES']:
    files += [p for p in (ROOT / folder).rglob('*') if p.is_file()]
with zipfile.ZipFile(target, 'x', zipfile.ZIP_DEFLATED) as archive:
    for p in sorted(files):
        if p.is_symlink() or not p.resolve().is_relative_to(ROOT):
            raise ValueError('Runtime file is outside the repository.')
        archive.write(p, p.relative_to(ROOT).as_posix())
print(f'Created runtime archive containing {len(files)} files; no upload performed.')
