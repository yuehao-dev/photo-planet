#!/usr/bin/env python3
"""Conservative public-demo checks; not a guarantee that arbitrary user data is anonymous."""
from pathlib import Path
from demo_dialogues import DIALOGUES
import json
import re
import sys

ROOT = Path(__file__).resolve().parent.parent
EXCLUDE = {'.git', 'node_modules', '.venv', '__pycache__', 'test-results', 'playwright-report'}
TEXT = {'.js', '.cjs', '.json', '.html', '.css', '.md', '.py', '.yaml', '.yml', '.txt', '.example', '.cmd', '.conf', '.svg'}
PATTERNS = {
    'cloud-access-key': re.compile(r'\bLTAI[A-Za-z0-9]{12,}\b'),
    'private-key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'personal-windows-path': re.compile(r'[A-Za-z]:[/\\]+(?:Users|All_Import)[/\\]+[^\s"\']+'),
    'non-demo-chat-id': re.compile(r'\bwxid_[a-z0-9]{10,}\b'),
}


def main():
    problems = []
    files = 0
    if (ROOT / '.private-mode').exists():
        problems.append({'path': '.private-mode', 'reason': 'personal-data-checkout'})
    for p in ROOT.rglob('*'):
        rel = p.relative_to(ROOT)
        if any(part in EXCLUDE for part in rel.parts) or not p.is_file():
            continue
        files += 1
        if p.is_symlink():
            problems.append({'path': rel.as_posix(), 'reason': 'symlink'})
        if p.name in {'.env', 'oss.json', 'gateway.json', 'auth.json'} or p.suffix.lower() in {'.pem', '.key', '.sqlite', '.db'}:
            problems.append({'path': rel.as_posix(), 'reason': 'private-file-type'})
        if p.suffix.lower() in TEXT or p.name in {'LICENSE', '.env.example', '.gitignore', 'Dockerfile'}:
            text = p.read_text(encoding='utf-8-sig', errors='replace')
            for name, pattern in PATTERNS.items():
                if pattern.search(text):
                    problems.append({'path': rel.as_posix(), 'reason': name})
    try:
        photos = json.loads((ROOT / 'data/photos.json').read_text(encoding='utf-8'))
        if len(photos['photos']) != 24 or 'sourceDir' in photos or any(p.get('sourceType') != 'demo' or not p['id'].startswith('demo-') or 'file' in p for p in photos['photos']):
            problems.append({'path': 'data/photos.json', 'reason': 'unexpected-non-demo-photos'})
        chat = json.loads((ROOT / 'data/chat/index.json').read_text(encoding='utf-8'))
        if chat.get('generation') != 'fictional-demo-v2' or chat['count'] != sum(len(block.splitlines()) for block in DIALOGUES) or len(chat['days']) != 24:
            problems.append({'path': 'data/chat/index.json', 'reason': 'unexpected-non-demo-chat'})
    except (KeyError, OSError, ValueError):
        problems.append({'path': 'data', 'reason': 'invalid-demo-manifest'})
    print(json.dumps({'passed': not problems, 'checkedFiles': files, 'issues': problems}, ensure_ascii=False))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(main())
