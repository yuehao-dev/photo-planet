#!/usr/bin/env python3
"""Build the album's date-indexed chat archive. Sources are read-only; SQLite is an offline cache.

Rewritten/truncated source files are re-read and merged, never treated as deletion instructions.
Copy completed incremental exports into the source tree; an incomplete file fails the whole run.
"""
from __future__ import annotations
import argparse
from chat_import_config import load_config, validate_settings, adapt_row
import codecs
import hashlib
import ipaddress
import json
import os
import re
import sqlite3
import sys
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit, parse_qsl, unquote

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = None
DEFAULT_OUTPUT = ROOT / 'data/chat'
DEFAULT_STATE = ROOT.parent / '.photo-planet-chat-cache'
TZ = timezone(timedelta(hours=8))
CHUNK_SIZE = 80
MAX_RECORD = 8 * 1024 * 1024
SCHEMA_VERSION = 1
NORMALIZER_VERSION = 2


class ImportFailure(ValueError):
    pass


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True).encode('utf-8')


def fingerprint(path, size, previous_size=0):
    """Hash the entire committed prefix, not just its first/last block."""
    digest = hashlib.sha256()
    prefix = digest.hexdigest() if previous_size == 0 else None
    read = 0
    with path.open('rb') as stream:
        while read < size:
            take = min(1024 * 1024, size - read)
            if read < previous_size < read + take:
                take = previous_size - read
            block = stream.read(take)
            if not block:
                raise ImportFailure('输入文件正在变短，请等导出完成后重试。')
            digest.update(block)
            read += len(block)
            if read == previous_size:
                prefix = digest.hexdigest()
    return digest.hexdigest(), prefix


class JsonStream:
    """Bounded streaming parser for {metadata:..., messages:[...]} and plain arrays."""
    def __init__(self, path, size):
        self.stream = path.open('rb')
        self.remaining = size
        self.decoder = codecs.getincrementaldecoder('utf-8-sig')()
        self.json = json.JSONDecoder()
        self.buffer = ''
        self.position = 0
        self.finished = False

    def fill(self):
        if self.finished:
            return False
        if self.position:
            self.buffer = self.buffer[self.position:]
            self.position = 0
        block = self.stream.read(min(65536, self.remaining)) if self.remaining else b''
        if not block and self.remaining:
            raise ImportFailure('输入文件在读取时被截断。')
        self.remaining -= len(block)
        self.finished = not self.remaining
        self.buffer += self.decoder.decode(block, final=self.finished)
        if len(self.buffer) > MAX_RECORD:
            raise ImportFailure('单条记录过大，请检查导出格式。')
        return bool(block)

    def peek(self):
        while True:
            while self.position < len(self.buffer) and self.buffer[self.position].isspace():
                self.position += 1
            if self.position < len(self.buffer):
                return self.buffer[self.position]
            if self.finished:
                return ''
            self.fill()

    def expect(self, token):
        if self.peek() != token:
            raise ImportFailure('JSON 结构不完整或格式不正确。')
        self.position += 1

    def value(self):
        self.peek()
        while True:
            try:
                value, end = self.json.raw_decode(self.buffer, self.position)
                self.position = end
                return value
            except json.JSONDecodeError:
                if self.finished:
                    raise ImportFailure('JSON 记录未写完或已损坏。') from None
                self.fill()

    def array(self):
        self.expect('[')
        if self.peek() == ']':
            self.position += 1
            return
        while True:
            yield self.value()
            if self.peek() == ']':
                self.position += 1
                return
            self.expect(',')

    def messages(self):
        try:
            found = False
            if self.peek() == '[':
                found = True
                yield from self.array()
            else:
                self.expect('{')
                if self.peek() != '}':
                    while True:
                        key = self.value()
                        if not isinstance(key, str):
                            raise ImportFailure('JSON 对象键不正确。')
                        self.expect(':')
                        if key == 'messages':
                            if found:
                                raise ImportFailure('同一导出包含多个 messages 字段。')
                            found = True
                            yield from self.array()
                        else:
                            self.value()
                        if self.peek() == '}':
                            break
                        self.expect(',')
                self.expect('}')
            if not found or self.peek():
                raise ImportFailure('不是受支持的聊天导出文件。')
        finally:
            self.stream.close()


def records(path, size, offset=0):
    if path.suffix.lower() != '.jsonl':
        yield from JsonStream(path, size).messages()
        return
    with path.open('rb') as stream:
        stream.seek(offset)
        remaining = size - offset
        while remaining:
            line = stream.readline(min(remaining, MAX_RECORD + 1))
            if not line:
                raise ImportFailure('总记录读取中被截断。')
            if len(line) > MAX_RECORD:
                raise ImportFailure('总记录单行过大。')
            remaining -= len(line)
            if offset == 0:
                line = line.removeprefix(codecs.BOM_UTF8)
            offset += len(line)
            if line.strip():
                try:
                    yield json.loads(line)
                except (ValueError, UnicodeDecodeError):
                    raise ImportFailure('总记录含未写完或损坏的 JSON 行；旧版本已保留。') from None


def sender_name(value, her_id, me_id=None):
    value = str(value or '').strip()
    if value == '我' or value == me_id:
        return '我'
    if value == her_id or value == '对方':
        return '对方'
    if value == '系统':
        return '系统'
    return '联系人' if value.startswith('wxid_') else value[:80]


def primary_share_url(kind, content):
    """Only plain exported link/video shares have an unambiguous primary URL.

    xsec_token is a public Xiaohongshu share parameter; login/session tokens are
    explicitly rejected. Do not interpret payment, miniapp or XML internal URLs.
    """
    if kind not in ('链接分享', '视频分享') or content.lstrip().startswith('<'):
        return None
    matches = list(re.finditer(r'https?://', content, re.I))
    if len(matches) != 1:
        return None
    candidate = content[matches[0].start():].strip()
    if len(candidate) > 4096 or re.search(r'[\s<>"\x00-\x20\\]', candidate):
        return None
    try:
        parsed = urlsplit(candidate)
        host = (parsed.hostname or '').lower().rstrip('.')
        if parsed.scheme.lower() not in ('http', 'https') or parsed.username is not None or parsed.password is not None:
            return None
        if parsed.port not in (None, 80, 443) or not host or not host.isascii():
            return None
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', host) or '.' not in host or '..' in host:
                return None
            if host.endswith(('.localhost', '.local', '.internal', '.lan', '.home', '.test', '.invalid')):
                return None
            # Browsers accept noncanonical integer/short/hex IPs; do not.
            if re.fullmatch(r'[0-9.]+', host) or host.startswith('0x') or re.fullmatch(r'(?:[0-9]+|0x[0-9a-f]+)', host.rsplit('.', 1)[-1]):
                return None
        else:
            if not address.is_global:
                return None
        internal_hosts = ('support.weixin.qq.com', 'open.weixin.qq.com', 'login.weixin.qq.com',
                          'long.weixin.qq.com', 'tenpay.com', 'weixinbridge.com', 'npay.meituan.com')
        if any(host == blocked or host.endswith('.' + blocked) for blocked in internal_hosts):
            return None
        decoded_path = unquote(parsed.path).lower()
        if host == 'mp.weixin.qq.com' and not (decoded_path == '/s' or decoded_path.startswith('/s/')):
            return None
        if re.search(r'(?:^|/)(?:oauth|oauth2|authorize|login|payment|pay|checkout)(?:/|$)', decoded_path):
            return None
        if re.search(r'[\x00-\x1f\x7f]', unquote(candidate)):
            return None
        forbidden = {'access_token', 'auth', 'authorization', 'session', 'sessionid', 'session_id',
                     'sid', 'token', 'ticket', 'key', 'skey', 'pass_ticket', 'uin', 'wxuin',
                     'passkey', 'password', 'passwd', 'secret', 'credential', 'cookie', 'cookies',
                     'redirect_uri', 'redirect_url'}
        parameters = parse_qsl(parsed.query, keep_blank_values=True)
        parameters += parse_qsl(parsed.fragment, keep_blank_values=True)
        if any(key.lower() in forbidden for key, _ in parameters):
            return None
        return candidate
    except (ValueError, UnicodeError):
        return None


def normalize_content(row, her_id, self_id=None):
    kind = str(row['type'])
    content = row.get('content', '')
    if not isinstance(content, str):
        raise ImportFailure('消息内容应为字符串。')
    me_id = self_id or (row.get('sender_username') if row.get('sender') == '我' else None)
    def clean(text):
        return re.sub(r'wxid_[A-Za-z0-9_]+', lambda m: sender_name(m.group(), her_id, me_id), str(text)).replace('\x00', '')
    result = {'type': kind, 'text': ''}
    media = {'图片': '一张图片', '语音': '一条语音', '视频': '一段视频', '表情': '一个表情包', '表情分享': '一个表情包', '文件': '一个文件'}
    if kind in media:
        result.update(text=media[kind] + '（附件尚未收录）', attachment=True)
        return result
    if kind == '引用消息':
        match = re.search(r'\[↩\s*([^:\n]+):\s*(.*)\]\s*$', content, re.S)
        if match:
            result['text'] = clean(content[:match.start()].rstrip())
            result['quote'] = {'sender': sender_name(match.group(1), her_id, me_id), 'text': clean(match.group(2))}
            return result
    if content.lstrip().startswith('<') and kind not in ('文本', '引用消息'):
        # Never render raw export XML; reject DTD/entity expansions before parsing.
        if '<!DOCTYPE' in content.upper() or '<!ENTITY' in content.upper():
            result['text'] = kind + '（详情暂未收录）'
            return result
        try:
            node = ET.fromstring(content)
            if kind == '通话':
                label = node.findtext('.//msg')
                result['text'] = clean(label or '一次通话')
            elif kind == '位置':
                location = node.find('.//location')
                label = location.get('label', '') if location is not None else ''
                result['text'] = clean('分享了位置' + ('：' + label if label else ''))
            elif kind == '名片':
                result['text'] = '分享了一张名片'
            else:
                label = node.findtext('.//title') or node.findtext('.//des')
                result['text'] = clean(label or kind + '（详情暂未收录）')
        except ET.ParseError:
            result['text'] = kind + '（详情暂未收录）'
        return result
    share_url = primary_share_url(kind, content)
    if kind not in ('文本', '引用消息', '撤回', '系统消息'):
        # Exported cards concatenate internal/share URLs with their title.
        content = re.sub(r'(?:https?://|weixin://|wxpay://)\S+', '', content)
    result['text'] = clean(content.strip()) or kind + '（详情暂未收录）'
    if share_url:
        result['link'] = {'url': share_url, 'title': result['text'].rstrip(' |')[:120] or '打开分享'}
    return result


def normalize(row, expected_chat=None, self_id=None):
    if not isinstance(row, dict):
        raise ImportFailure('消息记录必须是对象。')
    chat = row.get('chat_username')
    if not isinstance(chat, str) or not chat or len(chat) > 200:
        raise ImportFailure('聊天记录缺少会话编号。')
    if expected_chat and chat != expected_chat:
        raise ImportFailure('检测到其他会话；请为不同会话使用独立输入目录与缓存。')
    timestamp = row.get('timestamp')
    if isinstance(timestamp, bool) or not isinstance(timestamp, (int, float)) or int(timestamp) != timestamp:
        raise ImportFailure('消息缺少有效秒级时间戳。')
    try:
        when = datetime.fromtimestamp(timestamp, TZ)
        if not 2000 <= when.year <= 2100:
            raise ValueError()
        declared = datetime.fromisoformat(row['time'])
        if declared.utcoffset() is None or abs(declared.timestamp() - timestamp) > 1:
            raise ValueError()
    except (ValueError, TypeError, KeyError, OSError, OverflowError):
        raise ImportFailure('消息时间不完整或时间戳与带时区日期不一致。') from None
    server = row.get('server_id')
    if server not in (None, '', '0', 0):
        identity = [chat, 'server', str(server)]
    else:
        database, local = row.get('source_database'), row.get('local_id')
        if not isinstance(database, str) or not database or local in (None, '', 0, '0'):
            raise ImportFailure('消息缺少可稳定去重的编号。')
        identity = [chat, 'local', database, str(local)]
    sender = row.get('sender')
    if sender == '系统':
        who = 'system'
    elif sender == '我':
        who = 'me'
    elif row.get('sender_username') == chat:
        who = 'her'
    else:
        raise ImportFailure('发送者无法归属双方或系统，已停止导入。')
    if not isinstance(row.get('type'), str) or not row['type']:
        raise ImportFailure('消息类型缺失。')
    message = {'id': 'm_' + hashlib.sha256(compact(identity)).hexdigest()[:32],
               'timestamp': int(timestamp), 'time': when.strftime('%H:%M:%S'), 'sender': who,
               **normalize_content(row, chat, self_id)}
    return chat, when.strftime('%Y-%m-%d'), message


def merge_enriched(existing, incoming):
    """Sparse legacy increments must not erase full-export media or quote snapshots."""
    if existing.get('richVersion') != 1:
        return incoming
    if any(existing.get(key) != incoming.get(key) for key in ('id', 'timestamp', 'sender')):
        raise ImportFailure('完整记录与增量的消息身份、时间或发送者不一致，已停止覆盖。')
    merged = dict(existing)
    if existing.get('kind') == 'text' and incoming.get('type') == '文本':
        merged['text'] = incoming['text']
    return merged


def discover(source, patterns=None):
    if source.is_file():
        return [source]
    paths = [p for pattern in (patterns or validate_settings({})['filePatterns']) for p in source.rglob(pattern) if p.is_file()]
    # Old exports first, merged total next, dated incrementals last.
    def priority(path):
        if path.name.endswith('本机全部历史.json'):
            return (0, str(path))
        if path.suffix == '.jsonl':
            return (1, str(path))
        return (2, str(path))
    return sorted(set(paths), key=priority)


@contextmanager
def exclusive_lock(directory):
    directory.mkdir(parents=True, exist_ok=True)
    handle = (directory / 'import.lock').open('a+b')
    try:
        if os.fstat(handle.fileno()).st_size == 0:
            handle.write(b'0'); handle.flush()
        handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        raise ImportFailure('已有聊天导入任务正在运行，请稍后重试。') from None
    try:
        yield
    finally:
        handle.seek(0)
        if os.name == 'nt':
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    with temporary.open('wb') as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())
    os.replace(temporary, path)


def db_open(directory):
    db = sqlite3.connect(directory / 'archive.sqlite3', timeout=1)
    try:
        db.execute('PRAGMA journal_mode=WAL')
        db.execute('PRAGMA cache_size=-16384')
        db.executescript('''
          CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, day TEXT NOT NULL, stamp INTEGER NOT NULL, payload TEXT NOT NULL, source_db TEXT NOT NULL DEFAULT '', local_sort INTEGER NOT NULL DEFAULT 0);
          CREATE INDEX IF NOT EXISTS messages_day_time ON messages(day, stamp, id);
          CREATE TABLE IF NOT EXISTS inputs (path TEXT PRIMARY KEY, size INTEGER NOT NULL, digest TEXT NOT NULL, ends_newline INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS dirty (day TEXT PRIMARY KEY);
          CREATE TABLE IF NOT EXISTS published (day TEXT PRIMARY KEY, count INTEGER NOT NULL, url TEXT NOT NULL);
        ''')
        # Explicit transaction keeps schema changes and checkpoint invalidation together.
        db.execute('BEGIN IMMEDIATE')
        columns = {row[1] for row in db.execute('PRAGMA table_info(messages)')}
        migrating = 'source_db' not in columns or 'local_sort' not in columns
        if 'source_db' not in columns:
            db.execute("ALTER TABLE messages ADD COLUMN source_db TEXT NOT NULL DEFAULT ''")
        if 'local_sort' not in columns:
            db.execute('ALTER TABLE messages ADD COLUMN local_sort INTEGER NOT NULL DEFAULT 0')
        if migrating:
            # Backfill ordering from read-only originals, preserving the old published archive.
            db.execute('DELETE FROM inputs')
            db.execute('INSERT OR IGNORE INTO dirty SELECT DISTINCT day FROM messages')
        db.execute('CREATE INDEX IF NOT EXISTS messages_day_source_order ON messages(day,stamp,source_db,local_sort,id)')
        db.commit()
        return db

    except BaseException:
        try:
            db.rollback()
        finally:
            db.close()
        raise


def publish(db, output, force=False):
    old_bytes = (output / 'index.json').read_bytes() if (output / 'index.json').exists() else None
    if force:
        db.execute('INSERT OR IGNORE INTO dirty SELECT DISTINCT day FROM messages')
        db.commit()
    dirty = [r[0] for r in db.execute('SELECT day FROM dirty ORDER BY day')]
    if not dirty and old_bytes:
        return 0
    current = {r[0]: {'count': r[1], 'url': r[2]} for r in db.execute('SELECT day,count,url FROM published ORDER BY day')}
    updates = []
    for day in dirty:
        messages = [json.loads(r[0]) for r in db.execute('SELECT payload FROM messages WHERE day=? ORDER BY stamp,source_db,local_sort,id', (day,))]
        if not messages:
            current.pop(day, None)
            updates.append((day, None))
            continue
        rich = any(m.get('richVersion') == 1 for m in messages)
        seed = {'version': SCHEMA_VERSION, 'chunkSize': CHUNK_SIZE, 'messages': messages}
        if rich:
            seed['locatorVersion'] = 1
        digest = hashlib.sha256(compact(seed)).hexdigest()[:24]
        prefix = f'days/{day}/{digest}'
        chunks = []
        for start in range(0, len(messages), CHUNK_SIZE):
            batch = messages[start:start + CHUNK_SIZE]
            relative = f'{prefix}/chunk-{start // CHUNK_SIZE:04d}.json'
            data = compact({'date': day, 'startIndex': start, 'messages': batch})
            path = output / relative
            if not path.exists() or path.read_bytes() != data:
                atomic_write(path, data)
            chunks.append({'url': relative, 'startIndex': start, 'count': len(batch), 'startTime': batch[0]['timestamp'], 'endTime': batch[-1]['timestamp']})
        relative = f'{prefix}/index.json'
        day_index = {'version': 1, 'date': day, 'count': len(messages), 'chunks': chunks}
        if rich:
            day_index['messageChunks'] = {m['id']: n // CHUNK_SIZE for n, m in enumerate(messages)}
        data = compact(day_index)
        path = output / relative
        if not path.exists() or path.read_bytes() != data:
            atomic_write(path, data)
        current[day] = {'count': len(messages), 'url': relative}
        updates.append((day, current[day]))
    generation = hashlib.sha256(compact(current)).hexdigest()[:24]
    core = {'version': 1, 'generation': generation, 'timeZone': 'Asia/Shanghai',
            'count': sum(v['count'] for v in current.values()), 'days': dict(sorted(current.items()))}
    new_bytes = None
    if old_bytes:
        try:
            old_index = json.loads(old_bytes)
            if (isinstance(old_index, dict) and set(old_index) == set(core) | {'updatedAt'}
                    and all(old_index.get(key) == value for key, value in core.items())
                    and isinstance(old_index.get('updatedAt'), str)):
                datetime.fromisoformat(old_index['updatedAt'])
                new_bytes = old_bytes
        except (ValueError, TypeError):
            pass
    if new_bytes is None:
        new_bytes = compact({**core, 'updatedAt': datetime.now(TZ).isoformat(timespec='seconds')})
        atomic_write(output / 'index.json', new_bytes)
    # If interrupted before this commit, dirty days remain and are republished safely.
    with db:
        for day, value in updates:
            if value is None:
                db.execute('DELETE FROM published WHERE day=?', (day,))
            else:
                db.execute('INSERT OR REPLACE INTO published VALUES (?,?,?)', (day, value['count'], value['url']))
            db.execute('DELETE FROM dirty WHERE day=?', (day,))
    return len(dirty)


def build(source, output, state_dir, verify_output=False, import_settings=None):
    try:
        settings = validate_settings(import_settings or {})
    except ValueError as error:
        raise ImportFailure(str(error)) from None
    settings_hash = hashlib.sha256(compact(settings)).hexdigest()
    source, output, state_dir = map(lambda p: Path(p).resolve(), (source, output, state_dir))
    if not source.exists():
        raise ImportFailure('聊天源目录不存在。')
    source_root = source if source.is_dir() else source.parent
    if output == source_root or output.is_relative_to(source_root) or state_dir == source_root or state_dir.is_relative_to(source_root):
        raise ImportFailure('输出和缓存必须放在聊天原始目录之外。')
    if state_dir == ROOT or state_dir.is_relative_to(ROOT) or state_dir == output or state_dir.is_relative_to(output):
        raise ImportFailure('聊天缓存必须放在网站根目录及公开输出目录之外。')
    paths = discover(source, settings['filePatterns'])
    if not paths:
        raise ImportFailure('未找到总记录 JSONL 或 messages 格式的聊天 JSON。')
    stats = {'filesChanged': 0, 'recordsRead': 0, 'inserted': 0, 'updated': 0, 'duplicates': 0, 'daysPublished': 0}
    with exclusive_lock(state_dir):
        db = db_open(state_dir)
        try:
            normalizer = db.execute("SELECT value FROM meta WHERE key='normalizer_version'").fetchone()
            if normalizer and normalizer[0] not in ('1', str(NORMALIZER_VERSION)):
                raise ImportFailure('聊天转换规则已升级，请使用新的 --state-dir 从原始导出重建；旧缓存和网页仍保留。')
            saved_rules = db.execute("SELECT value FROM meta WHERE key='import_settings_hash'").fetchone()
            if saved_rules and saved_rules[0] != settings_hash:
                raise ImportFailure('导入配置已改变，请使用新的 --state-dir 从完整导出重建，避免增量规则混用。')
            if not saved_rules and settings != validate_settings({}) and db.execute('SELECT 1 FROM messages LIMIT 1').fetchone():
                raise ImportFailure('旧缓存没有这份映射规则，请换新的 --state-dir 完整重建。')
            identity = db.execute("SELECT value FROM meta WHERE key='chat'").fetchone()
            expected = identity[0] if identity else settings['expectedChatId'] or None
            if settings['expectedChatId'] and expected != settings['expectedChatId']:
                raise ImportFailure('配置中的会话编号与缓存不一致，请为不同会话使用独立缓存。')
            own = db.execute("SELECT value FROM meta WHERE key='self_user'").fetchone()
            self_id = own[0] if own else None
            upgrade = (normalizer is None and db.execute('SELECT 1 FROM messages LIMIT 1').fetchone() is not None) or (normalizer is not None and normalizer[0] == '1')
            with db:
                # Re-read available originals atomically; archived rows with missing sources stay intact.
                if upgrade:
                    db.execute('DELETE FROM inputs')
                for path in paths:
                    size = path.stat().st_size
                    old = db.execute('SELECT size,digest,ends_newline FROM inputs WHERE path=?', (str(path),)).fetchone()
                    digest, prefix = fingerprint(path, size, old[0] if old and old[0] <= size else 0)
                    if old and old[0] == size and old[1] == digest:
                        continue
                    offset = old[0] if old and path.suffix.lower() == '.jsonl' and old[0] <= size and old[1] == prefix and old[2] else 0
                    stats['filesChanged'] += 1
                    for row in records(path, size, offset):
                        try:
                            row = adapt_row(row, settings)
                        except (ValueError, TypeError, OverflowError, OSError) as error:
                            raise ImportFailure(str(error)) from None
                        if isinstance(row, dict) and row.get('sender') == '我' and not self_id:
                            self_id = row.get('sender_username')
                        expected, day, message = normalize(row, expected, self_id)
                        stats['recordsRead'] += 1
                        payload = compact(message).decode('utf-8')
                        database = row.get('source_database', '')
                        if not isinstance(database, str) or len(database) > 200:
                            raise ImportFailure('消息来源数据库标识不正确。')
                        local = row.get('local_id', 0)
                        if isinstance(local, bool) or not re.fullmatch(r'[0-9]{1,18}', str(local)):
                            raise ImportFailure('消息本地顺序编号不正确。')
                        local = int(local)
                        existing = db.execute('SELECT day,payload,source_db,local_sort FROM messages WHERE id=?', (message['id'],)).fetchone()
                        if existing:
                            enriched = json.loads(existing[1])
                            if enriched.get('richVersion') == 1:
                                message = merge_enriched(enriched, message)
                                payload = compact(message).decode('utf-8')
                                database, local = existing[2], existing[3]
                        if existing and existing[1] == payload and existing[2] == database and existing[3] == local:
                            stats['duplicates'] += 1
                            continue
                        db.execute('''INSERT INTO messages(id,day,stamp,payload,source_db,local_sort) VALUES (?,?,?,?,?,?)
                                      ON CONFLICT(id) DO UPDATE SET day=excluded.day,stamp=excluded.stamp,
                                      payload=excluded.payload,source_db=excluded.source_db,local_sort=excluded.local_sort''',
                                   (message['id'], day, message['timestamp'], payload, database, local))
                        db.execute('INSERT OR IGNORE INTO dirty VALUES (?)', (day,))
                        if existing:
                            stats['updated'] += 1
                            db.execute('INSERT OR IGNORE INTO dirty VALUES (?)', (existing[0],))
                        else:
                            stats['inserted'] += 1
                    if fingerprint(path, size)[0] != digest:
                        raise ImportFailure('导入期间源文件被改写，请等导出完成后重试。')
                    with path.open('rb') as stream:
                        if size:
                            stream.seek(size - 1); ends_newline = stream.read(1) == b'\n'
                        else:
                            ends_newline = True
                    db.execute('INSERT OR REPLACE INTO inputs VALUES (?,?,?,?)', (str(path), size, digest, int(ends_newline)))
                db.execute("INSERT OR REPLACE INTO meta VALUES ('import_settings_hash',?)", (settings_hash,))
                db.execute("INSERT OR REPLACE INTO meta VALUES ('normalizer_version',?)", (str(NORMALIZER_VERSION),))
                if expected:
                    db.execute("INSERT OR REPLACE INTO meta VALUES ('chat',?)", (expected,))
                if self_id:
                    db.execute("INSERT OR REPLACE INTO meta VALUES ('self_user',?)", (self_id,))
            # The cache commits first; the old index remains valid if publishing fails.
            output_identity = db.execute("SELECT value FROM meta WHERE key='output'").fetchone()
            force = verify_output or not output_identity or output_identity[0] != str(output) or not (output / 'index.json').exists()
            stats['daysPublished'] = publish(db, output, force)
            with db:
                db.execute("INSERT OR REPLACE INTO meta VALUES ('output',?)", (str(output),))
            stats['count'] = db.execute('SELECT count(*) FROM messages').fetchone()[0]
            stats['days'] = db.execute('SELECT count(DISTINCT day) FROM messages').fetchone()[0]
        finally:
            db.close()
    return stats


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, help='Private import config; paths are relative to that file')
    parser.add_argument('--source', type=Path, help='Read-only completed chat exports')
    parser.add_argument('--output', type=Path)
    parser.add_argument('--state-dir', type=Path)
    parser.add_argument('--verify-output', action='store_true', help='检查并重建缓存中的所有日期，修复被删除或损坏的输出')
    args = parser.parse_args()
    if not (ROOT / '.private-mode').exists():
        parser.error('Run python tools/prepare_private.py --confirm before importing private data.')
    try:
        paths, settings = load_config(args.config) if args.config else ({}, validate_settings({}))
        source = args.source or paths.get('source')
        if not source:
            parser.error('Provide --source or paths.source in --config.')
        stats = build(source, args.output or paths.get('output', DEFAULT_OUTPUT), args.state_dir or paths.get('stateDir', DEFAULT_STATE), args.verify_output, settings)
        print(json.dumps(stats, ensure_ascii=False))
    except (ImportFailure, OSError, sqlite3.Error, UnicodeError, ValueError) as error:
        print(f'聊天导入未完成：{error}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
