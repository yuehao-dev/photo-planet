#!/usr/bin/env python3
"""Stop tracking the demo data paths BEFORE importing personal data. Files remain on disk."""
from pathlib import Path
import argparse
import subprocess

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--confirm', action='store_true')
args = parser.parse_args()
if not args.confirm:
    parser.error('Pass --confirm to untrack data/, public/, demo-media/ and local config. No disk files are deleted.')
paths = ['data', 'public', 'demo-media', 'config/site.js']
try:
    inside = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', '--show-toplevel'], stderr=subprocess.DEVNULL, text=True).strip()
except (FileNotFoundError, subprocess.CalledProcessError):
    inside = None
if inside and Path(inside).resolve() != ROOT:
    raise SystemExit('This directory is inside another repository. Create a separate checkout first.')
if inside:
    subprocess.run(['git', '-C', str(ROOT), 'rm', '-r', '--cached', '--ignore-unmatch', '--', *paths], check=True, stdout=subprocess.DEVNULL)
ignore = ROOT / '.gitignore'
with ignore.open('a', encoding='utf-8') as f:
    f.write('\n# Personal deployment data (added before importing)\n/data/\n/public/\n/demo-media/\n/config/site.js\n/.private-mode\n')
(ROOT / '.private-mode').write_text('Personal data mode: do not publish this directory as a demo.\n', encoding='utf-8')
print('Personal paths are now excluded from new commits; all local files were retained. Review git status before committing.')
