"""Synthetic Moect archives exercise the export -> watcher -> published index boundary."""
import json
from pathlib import Path
import tempfile
import unittest

from build_chats import build, ImportFailure
from chat_import_config import validate_settings
from watch_chats import Watcher


def row(n, **extra):
    return dict(session='contact-demo', sender='昵称', sender_wxid='contact-demo',
                is_sender=False, create_time=1741426200+n, type=1, type_name='文本',
                text='在门口等你', shard=0, local_id=n, server_id=str(10000+n), **extra)


class MoectWatchTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='fictional-moect-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'exports'
        self.source.mkdir()
        self.file = self.source / 'contact_12345678.json'
        self.output, self.cache = self.root / 'site/data/chat', self.root / 'cache'
        self.rules = validate_settings({'format': 'moect', 'expectedChatId': 'contact-demo', 'filePatterns': ['*.json']})

    def write(self, rows):
        self.file.write_text(json.dumps({'metadata': {'session': 'contact-demo'}, 'messages': rows, 'count': len(rows)}, ensure_ascii=False), encoding='utf-8')

    def run_build(self):
        return build(self.source, self.output, self.cache, import_settings=self.rules)

    def test_append_deduplicates_self_and_reply_survive(self):
        first = row(1)
        self.write([first]); self.assertEqual(self.run_build()['count'], 1)
        own = row(2); own.update(is_sender=True, sender_wxid='self-demo', kind='quote', quote={'server_id': '10001', 'sender_wxid': 'contact-demo', 'text': '在门口等你'})
        self.write([first, own]); self.assertEqual(self.run_build()['count'], 2)
        index = json.loads((self.output/'index.json').read_text())
        day = json.loads((self.output/index['days']['2025-03-08']['url']).read_text())
        rows = json.loads((self.output/day['chunks'][0]['url']).read_text())['messages']
        self.assertEqual(rows[1]['sender'], 'me')
        self.assertEqual(rows[1]['quote']['target']['id'], rows[0]['id'])
        self.assertIn(rows[0]['id'], day['messageChunks'])
        self.assertEqual(self.run_build()['inserted'], 0)

    def test_shards_disambiguate_missing_server_ids(self):
        first = row(1); first['server_id'] = ''
        second = {**first, 'shard': 1}
        self.write([first, second]); self.assertEqual(self.run_build()['count'], 2)

    def test_wrong_contact_and_partial_do_not_replace_index(self):
        self.write([row(1)]); self.run_build()
        before = (self.output/'index.json').read_bytes()
        self.file.write_text('{"messages":[', encoding='utf-8')
        with self.assertRaises(ImportFailure): self.run_build()
        self.write([{**row(2), 'session': 'other-demo'}])
        with self.assertRaises(ImportFailure): self.run_build()
        self.assertEqual(before, (self.output/'index.json').read_bytes())

    def test_waits_for_stability_ignores_partial_and_retries(self):
        partial = self.source / '.partial_export'; partial.mkdir()
        (partial/'broken.json').write_text('{', encoding='utf-8')
        self.write([row(1)])
        w = Watcher(self.source, self.output, self.cache, self.rules, settle=5)
        self.assertIsNone(w.tick(0)); self.assertIsNone(w.tick(4))
        self.assertEqual(w.tick(5)['count'], 1)
        self.assertIsNone(w.tick(10))
        self.file.write_text('{', encoding='utf-8')
        self.assertIsNone(w.tick(11))
        with self.assertRaises(ImportFailure): w.tick(16)
        self.write([row(1), row(2)])
        self.assertIsNone(w.tick(17)); self.assertEqual(w.tick(22)['count'], 2)

    def test_system_message_is_not_misattributed_to_contact(self):
        system = row(1); system.update(type=10000, sender='系统', text='撤回了一条消息')
        self.write([system]); self.assertEqual(self.run_build()['count'], 1)
        index = json.loads((self.output/'index.json').read_text())
        day = json.loads((self.output/index['days']['2025-03-08']['url']).read_text())
        messages = json.loads((self.output/day['chunks'][0]['url']).read_text())['messages']
        self.assertEqual(messages[0]['sender'], 'system')

    def test_jsonl_metadata_not_imported_as_message(self):
        self.file.unlink(missing_ok=True)
        path = self.source/'full.jsonl'
        path.write_text(json.dumps({'metadata': {'session': 'contact-demo'}})+'\n'+json.dumps(row(1))+'\n', encoding='utf-8')
        self.assertEqual(build(path, self.output, self.cache, import_settings=self.rules)['count'], 1)


if __name__ == '__main__':
    unittest.main()
