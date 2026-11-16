"""Configured imports keep identities stable and reject rule changes in incremental caches."""
import json
from pathlib import Path
import tempfile
import unittest
from chat_import_config import adapt_row, validate_settings
from build_chats import build, ImportFailure


class ConfigurationImportTests(unittest.TestCase):
    def test_aliases_fields_and_milliseconds(self):
        rules = validate_settings({'fields': {'sender': 'who', 'timestamp': 'at'}, 'expectedChatId': 'demo-contact', 'selfLabels': ['自己'], 'timestampUnit': 'milliseconds', 'deriveTime': True})
        row = adapt_row({'who': '自己', 'at': 1735689600123}, rules)
        self.assertEqual(row['sender'], '我')
        self.assertEqual(row['timestamp'], 1735689600)
        self.assertEqual(row['chat_username'], 'demo-contact')
        self.assertTrue(row['time'].endswith('+08:00'))

    def test_conflicting_sender_rules_stop(self):
        with self.assertRaises(ValueError):
            validate_settings({'selfLabels': ['同一个名字'], 'otherLabels': ['同一个名字']})
        with self.assertRaises(ValueError):
            adapt_row({'sender': '我', 'sender_username': 'demo-contact', 'chat_username': 'demo-contact'}, validate_settings({}))

    def test_increment_deduplicates_and_changed_mapping_requires_new_cache(self):
        with tempfile.TemporaryDirectory(prefix='fictional-config-import-') as directory:
            root = Path(directory); source = root / 'exports'; source.mkdir()
            row = {'who': '自己', 'at': 1735689600000, 'type': '文本', 'server_id': '1', 'local_id': 1, 'source_database': 'demo.db', 'content': '配置导入演示'}
            rules = {'fields': {'sender': 'who', 'timestamp': 'at'}, 'selfLabels': ['自己'], 'expectedChatId': 'demo-contact', 'timestampUnit': 'milliseconds', 'deriveTime': True}
            (source / 'full.json').write_text(json.dumps({'messages': [row]}), encoding='utf-8')
            self.assertEqual(build(source, root / 'site/data/chat', root / 'cache', import_settings=rules)['count'], 1)
            (source / 'increment.json').write_text(json.dumps({'messages': [row, {**row, 'server_id': '2', 'local_id': 2}]}), encoding='utf-8')
            stats = build(source, root / 'site/data/chat', root / 'cache', import_settings=rules)
            self.assertEqual(stats['count'], 2); self.assertEqual(stats['duplicates'], 1)
            before = (root / 'site/data/chat/index.json').read_bytes()
            with self.assertRaises(ImportFailure):
                build(source, root / 'site/data/chat', root / 'cache', import_settings={**rules, 'selfLabels': ['自己', 'me']})
            self.assertEqual((root / 'site/data/chat/index.json').read_bytes(), before)
