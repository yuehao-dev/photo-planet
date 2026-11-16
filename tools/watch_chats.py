#!/usr/bin/env python3
"""Watch completed third-party exports and rebuild the private album's chat index."""
import argparse
import json
from pathlib import Path
import sqlite3
import sys
import time

from build_chats import ROOT, ImportFailure, build, discover, exclusive_lock
from chat_import_config import load_config


class Watcher:
    def __init__(self, source, output, state, settings, settle=5):
        self.source, self.output, self.state = map(Path, (source, output, state))
        self.settings, self.settle = settings, settle
        self.candidate = self.accepted = None
        self.since = 0

    def snapshot(self):
        # Stat only; unchanged exports are not hashed/read on every poll.
        if not self.source.exists():
            raise ImportFailure('源路径暂不可用；保留上次发布的记录。')
        result = []
        for path in discover(self.source, self.settings['filePatterns']):
            stat = path.stat()
            result.append((str(path), stat.st_size, stat.st_mtime_ns))
        return tuple(result)

    def tick(self, now=None):
        now = time.monotonic() if now is None else now
        current = self.snapshot()
        if current != self.candidate:
            self.candidate, self.since = current, now
            return None
        if not current or current == self.accepted or now - self.since < self.settle:
            return None
        try:
            result = build(self.source, self.output, self.state, import_settings=self.settings)
            if self.snapshot() != current:
                self.candidate = None
                return None
            self.accepted = current
            return result
        finally:
            # Retry incomplete files after another settle interval, without log floods.
            self.since = now


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--poll', type=float, default=2, help='Stat interval in seconds (>=1)')
    parser.add_argument('--settle', type=float, default=5, help='Wait for unchanged files (>=2 seconds)')
    parser.add_argument('--once', action='store_true', help='Import once immediately after an export has completed')
    args = parser.parse_args()
    if not (ROOT / '.private-mode').exists():
        parser.error('先在独立私人副本运行 python tools/prepare_private.py --confirm。')
    if not 1 <= args.poll <= 3600 or not 2 <= args.settle <= 3600:
        parser.error('poll 范围为 1–3600，settle 范围为 2–3600 秒。')
    paths, settings = load_config(args.config)
    if set(paths) != {'source', 'output', 'stateDir'}:
        parser.error('监听配置必须填写 source、output、stateDir 三个路径。')
    watch = Watcher(paths['source'], paths['output'], paths['stateDir'], settings, args.settle)
    if args.once:
        print(json.dumps(build(watch.source, watch.output, watch.state, import_settings=settings), ensure_ascii=False))
        return
    # An independent lock prevents competing watchers but permits build's own lock.
    with exclusive_lock(watch.state / 'watcher'):
        print('正在等待导出更新。日志仅包含统计，不包含聊天正文。', flush=True)
        while True:
            try:
                result = watch.tick()
                if result is not None:
                    print(json.dumps(result, ensure_ascii=False), flush=True)
            except (ImportFailure, OSError, ValueError, sqlite3.Error):
                print('导入暂未完成，保留上一版；等待源文件稳定后重试。', file=sys.stderr, flush=True)
            time.sleep(args.poll)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('已停止监听，已发布的记录仍可阅读。')
    except (ImportFailure, OSError, ValueError, sqlite3.Error) as error:
        print(f'监听未启动或导入失败：{error}', file=sys.stderr)
        sys.exit(1)
