#!/usr/bin/env python3
"""Behavioral importer tests using synthetic conversation records only."""
import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
from contextlib import closing
from datetime import datetime
import build_chats as chats


def message(identity, when='2026-01-01T12:00:00+08:00', text='合成测试消息', **extra):
    result = {'timestamp': int(datetime.fromisoformat(when).timestamp()), 'time': when,
              'sender': '我', 'sender_username': 'wxid_me', 'chat_username': 'wxid_her',
              'type': '文本', 'server_id': str(identity), 'local_id': identity,
              'source_database': 'message_0.db', 'content': text}
    result.update(extra)
    return result


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='album-chat-test-')
        self.root = Path(self.temp.name)
        self.src = self.root / 'sources'; self.src.mkdir()
        self.out = self.root / 'public/chat'; self.state = self.root / 'private/cache'
        self.total = self.src / 'total.jsonl'

    def tearDown(self):
        self.temp.cleanup()

    def write(self, rows, append=False):
        with self.total.open('a' if append else 'w', encoding='utf-8') as f:
            for row in rows: f.write(json.dumps(row, ensure_ascii=False) + '\n')

    def delta(self, folder, rows):
        path = self.src / folder / '聊天记录.json';path.parent.mkdir(parents=True)
        path.write_text(json.dumps({'metadata': {'message_count': len(rows)}, 'messages': rows}, ensure_ascii=False), encoding='utf-8')
        return path

    def run_build(self, **kwargs):
        return chats.build(self.src,self.out,self.state,**kwargs)

    def index(self):
        return json.loads((self.out/'index.json').read_text(encoding='utf-8'))

    def messages(self, date):
        manifest=json.loads((self.out/self.index()['days'][date]['url']).read_text(encoding='utf-8'))
        return [m for chunk in manifest['chunks'] for m in json.loads((self.out/chunk['url']).read_text(encoding='utf-8'))['messages']]

    def test_overlap_append_noop_and_affected_days(self):
        day1=message(1);day2=message(2,'2026-01-02T00:00:00+08:00')
        self.write([day1,day2]);self.delta('2026-01-02',[day2,message(3,'2026-01-02T12:00:00+08:00')])
        first=self.run_build();self.assertEqual(first['count'],3);self.assertEqual(first['duplicates'],1)
        index_bytes=(self.out/'index.json').read_bytes();old=self.index()['days']['2026-01-01']['url'];mtime=(self.out/old).stat().st_mtime_ns
        result=self.run_build();self.assertEqual(result['recordsRead'],0);self.assertEqual(result['daysPublished'],0);self.assertEqual(index_bytes,(self.out/'index.json').read_bytes())
        self.write([message(4,'2026-01-02T15:00:00+08:00')],append=True)
        result=self.run_build();self.assertEqual(result['recordsRead'],1);self.assertEqual(result['daysPublished'],1)
        self.assertEqual(self.index()['days']['2026-01-01']['url'],old);self.assertEqual((self.out/old).stat().st_mtime_ns,mtime)

    def test_rewrite_and_truncate_merge_without_deleting_history(self):
        self.write([message(1),message(2)]);self.run_build()
        self.write([message(1,text='修正后的合成消息')]);result=self.run_build()
        self.assertEqual(result['updated'],1);self.assertEqual(result['count'],2)
        self.assertIn('修正后的合成消息',[r['text'] for r in self.messages('2026-01-01')])
        self.write([message(1,text='再次修正'),message(3)]);result=self.run_build();self.assertEqual(result['count'],3)

    def test_changed_prefix_same_size_is_not_mistaken_for_append(self):
        self.write([message(1,text='111'),message(2,text='222')]);self.run_build()
        before=self.total.stat().st_size;self.write([message(1,text='333'),message(2,text='222')]);self.assertEqual(before,self.total.stat().st_size)
        result=self.run_build();self.assertEqual(result['updated'],1)
        self.assertIn('333',[r['text'] for r in self.messages('2026-01-01')])

    def test_bad_increment_rolls_back_cache_and_keeps_published(self):
        self.write([message(1)]);self.run_build();before=(self.out/'index.json').read_bytes()
        self.write([message(2)],append=True);path=self.delta('new',[message(3)]);path.write_text('{"messages":[',encoding='utf-8')
        with self.assertRaises(chats.ImportFailure):self.run_build()
        self.assertEqual(before,(self.out/'index.json').read_bytes())
        with closing(sqlite3.connect(self.state/'archive.sqlite3')) as db:self.assertEqual(db.execute('SELECT count(*) FROM messages').fetchone()[0],1)
        path.write_text(json.dumps({'messages':[message(3)]}),encoding='utf-8');result=self.run_build();self.assertEqual(result['count'],3)

    def test_partial_total_line_and_timezone_midnight(self):
        self.write([message(1,'2026-01-01T16:00:00+00:00')]);self.run_build();self.assertIn('2026-01-02',self.index()['days']);self.assertEqual(self.messages('2026-01-02')[0]['time'],'00:00:00')
        with self.total.open('ab') as f:f.write(b'{"broken":')
        with self.assertRaises(chats.ImportFailure):self.run_build()
        self.assertEqual(self.index()['count'],1)

    def test_output_recovery_after_publish_failure(self):
        self.write([message(1)]);self.run_build();before=(self.out/'index.json').read_bytes();self.write([message(2)],append=True)
        original=chats.atomic_write
        def fail_index(path,data):
            if path==self.out/'index.json':raise OSError('simulated publication failure')
            return original(path,data)
        with patch.object(chats,'atomic_write',side_effect=fail_index):
            with self.assertRaises(OSError):self.run_build()
        self.assertEqual(before,(self.out/'index.json').read_bytes())
        result=self.run_build();self.assertEqual(result['recordsRead'],0);self.assertEqual(self.index()['count'],2)
        day=json.loads((self.out/self.index()['days']['2026-01-01']['url']).read_text(encoding='utf-8'));chunk=self.out/day['chunks'][0]['url'];chunk.write_text('broken')
        self.run_build(verify_output=True);self.assertEqual(json.loads(chunk.read_text(encoding='utf-8'))['messages'][0]['type'],'文本')

    def test_verify_repairs_corrupt_index_with_unchanged_generation(self):
        self.write([message(1)]);self.run_build();correct=self.index()
        for bad in [dict(correct,count=999),dict(correct,days={}),[],{'broken':True}]:
            (self.out/'index.json').write_text(json.dumps(bad),encoding='utf-8')
            self.run_build(verify_output=True)
            self.assertEqual(self.index()['count'],1)
            self.assertEqual(self.index()['days'],correct['days'])

    def test_concurrent_append_is_deferred_to_next_snapshot(self):
        self.write([message(1)])
        original=chats.records
        appended=False
        def append_while_reading(path,size,offset=0):
            nonlocal appended
            for row in original(path,size,offset):
                yield row
                if not appended:
                    self.write([message(2)],append=True);appended=True
        with patch.object(chats,'records',side_effect=append_while_reading):
            self.assertEqual(self.run_build()['count'],1)
        result=self.run_build();self.assertEqual(result['recordsRead'],1);self.assertEqual(result['count'],2)

    def test_concurrent_rewrite_rolls_back_and_is_retryable(self):
        self.write([message(1)]);self.run_build();before=(self.out/'index.json').read_bytes()
        self.write([message(2)],append=True);original=chats.records
        def rewrite_while_reading(path,size,offset=0):
            yield from original(path,size,offset)
            self.write([message(1,text='changed'),message(2)])
        with patch.object(chats,'records',side_effect=rewrite_while_reading):
            with self.assertRaises(chats.ImportFailure):self.run_build()
        self.assertEqual(before,(self.out/'index.json').read_bytes())
        self.assertEqual(self.run_build()['count'],2)

    def test_interruption_after_index_swap_can_resume(self):
        self.write([message(1)]);self.run_build();self.write([message(2)],append=True)
        original=chats.atomic_write
        def fail_after_swap(path,data):
            original(path,data)
            if path==self.out/'index.json':raise OSError('simulated after index swap')
        with patch.object(chats,'atomic_write',side_effect=fail_after_swap):
            with self.assertRaises(OSError):self.run_build()
        self.assertEqual(self.index()['count'],2)
        published=(self.out/'index.json').read_bytes();result=self.run_build()
        self.assertEqual(result['recordsRead'],0);self.assertEqual(published,(self.out/'index.json').read_bytes())

    def test_normalizer_version_change_requires_clean_cache(self):
        self.write([message(1)]);self.run_build();before=(self.out/'index.json').read_bytes()
        with closing(sqlite3.connect(self.state/'archive.sqlite3')) as db:
            db.execute("UPDATE meta SET value='99' WHERE key='normalizer_version'");db.commit()
        with self.assertRaises(chats.ImportFailure):self.run_build()
        self.assertEqual(before,(self.out/'index.json').read_bytes())
        self.assertEqual(chats.build(self.src,self.out,self.root/'new-cache')['count'],1)

    def test_quotes_media_and_xml_are_readable(self):
        self.write([message(1),message(2,text='正文 [↩ wxid_me:引用原文]',sender='小夏',sender_username='wxid_her',type='引用消息'),message(3,text='<voipmsg><VoIPBubbleMsg><msg>通话时长 01:20</msg><roomkey>SECRET</roomkey></VoIPBubbleMsg></voipmsg>',type='通话'),message(4,text='[语音]',type='语音'),message(5,text='<msg><location label="公园" x="12" y="34"/></msg>',type='位置')]);self.run_build()
        rows=self.messages('2026-01-01');quote=next(r for r in rows if r['type']=='引用消息')
        self.assertEqual(quote['quote'],{'sender':'我','text':'引用原文'});self.assertEqual(quote['text'],'正文')
        self.assertTrue(next(r for r in rows if r['type']=='语音')['attachment'])
        self.assertNotIn('SECRET',json.dumps(rows));self.assertNotIn('wxid_',json.dumps(rows));self.assertIn('分享了位置：公园',[r['text'] for r in rows])

    def test_primary_share_link_preserves_normal_public_parameters(self):
        url='https://www.xiaohongshu.com/explore/abc?xsec_token=public-share-check&xsec_source=app_share'
        for kind in ['链接分享','视频分享']:
            row=chats.normalize(message(1,text='分享标题 | '+url,type=kind))[2]
            self.assertEqual(row['link'],{'url':url,'title':'分享标题'})
            self.assertNotIn(url,row['text'])
        official='https://mp.weixin.qq.com/s?__biz=demo&mid=123&idx=1&sn=public-article-signature'
        self.assertEqual(chats.primary_share_url('链接分享','文章 '+official),official)
        self.assertEqual(chats.primary_share_url('视频分享','视频 http://b23.tv/example'),'http://b23.tv/example')

    def test_share_links_reject_ambiguous_or_internal_sources(self):
        for content in [
            '两个 https://example.com/a https://example.com/b',
            '内部 https://support.weixin.qq.com/error',
            '小程序 https://mp.weixin.qq.com/mp/waerrpage?appid=demo',
            '支付 https://wxapp.tenpay.com/pay?sign=secret',
            '跳转 https://open.weixin.qq.com/connect/oauth2/authorize',
            '登录 https://example.com/oauth/authorize',
            '登录 https://example.com/a?access_token=secret',
            '登录 https://example.com/a?%61ccess_token=secret',
            '登录 https://example.com/a#session_id=secret',
            '转跳 https://example.com/a?redirect_uri=https%3A%2F%2Fexample.org',
            '身份 https://name:secret@example.com/a',
            '内网 http://127.0.0.1/a', '内网 http://127.1/a', '内网 http://127.0x1/a',
            '内网 http://2130706433/a', '内网 http://[::1]/a', '内网 http://192.168.1.2/a',
            '本地 http://machine.local/a', '本地 http://localhost/a',
            '控制 https://example.com/a%0d%0aheader',
            '非网页 javascript:alert(1)', '微信 weixin://abc', '支付 wxpay://abc',
        ]:
            with self.subTest(content=content):self.assertIsNone(chats.primary_share_url('链接分享',content))
        for kind in ['小程序','转账/收款','红包','视频号','分享卡片','聊天记录','文本']:
            self.assertIsNone(chats.primary_share_url(kind,'https://example.com/a'))

    def test_xml_share_does_not_expose_private_attributes(self):
        row=chats.normalize(message(1,type='链接分享',text='<msg secret="PRIVATE"><appmsg><title>标题</title><url>https://example.com/a?access_token=PRIVATE</url></appmsg></msg>'))[2]
        self.assertEqual(row['text'],'标题');self.assertNotIn('link',row);self.assertNotIn('PRIVATE',json.dumps(row))

    def test_normalizer_upgrade_adds_links_and_preserves_orphan_archive(self):
        share=message(1,type='链接分享',text='标题 https://example.com/a')
        self.write([share,message(2,text='source later absent')])
        with patch.object(chats,'NORMALIZER_VERSION',1),patch.object(chats,'primary_share_url',return_value=None):self.run_build()
        self.assertNotIn('link',self.messages('2026-01-01')[0])
        self.write([share])
        result=self.run_build();self.assertEqual(result['count'],2);self.assertEqual(result['recordsRead'],1)
        rows=self.messages('2026-01-01');self.assertEqual(rows[0]['link']['url'],'https://example.com/a');self.assertEqual(rows[1]['text'],'source later absent')
        self.assertEqual(self.run_build()['recordsRead'],0)
        with closing(sqlite3.connect(self.state/'archive.sqlite3')) as db:
            self.assertEqual(db.execute("SELECT value FROM meta WHERE key='normalizer_version'").fetchone()[0],'2')

    def test_normalizer_upgrade_failure_rolls_back_checkpoints_and_version(self):
        self.write([message(1,type='链接分享',text='标题 https://example.com/a')])
        with patch.object(chats,'NORMALIZER_VERSION',1),patch.object(chats,'primary_share_url',return_value=None):self.run_build()
        before=(self.out/'index.json').read_bytes()
        path=self.delta('incomplete',[]);path.write_text('{"messages":[',encoding='utf-8')
        with self.assertRaises(chats.ImportFailure):self.run_build()
        self.assertEqual(before,(self.out/'index.json').read_bytes())
        with closing(sqlite3.connect(self.state/'archive.sqlite3')) as db:
            self.assertEqual(db.execute("SELECT value FROM meta WHERE key='normalizer_version'").fetchone()[0],'1')
            self.assertEqual(db.execute('SELECT count(*) FROM inputs').fetchone()[0],1)
        path.write_text('{"messages":[]}',encoding='utf-8');self.run_build()
        self.assertIn('link',self.messages('2026-01-01')[0])

    def test_chunking_and_stable_order(self):
        self.write([message(i) for i in range(200,0,-1)]);self.run_build()
        manifest=json.loads((self.out/self.index()['days']['2026-01-01']['url']).read_text(encoding='utf-8'))
        self.assertEqual([c['count'] for c in manifest['chunks']],[80,80,40]);self.assertEqual([c['startIndex'] for c in manifest['chunks']],[0,80,160])
        rows=self.messages('2026-01-01');self.assertEqual([r['id'] for r in rows],[chats.normalize(message(i))[2]['id'] for i in range(1,201)])

    def test_same_second_backfill_and_correction_keep_export_order(self):
        self.write([message(10,text='first'),message(30,text='third')]);self.run_build()
        self.delta('late',[message(20,text='second')]);self.run_build()
        self.assertEqual([r['text'] for r in self.messages('2026-01-01')],['first','second','third'])
        self.write([message(10,text='first corrected'),message(30,text='third')]);self.run_build()
        self.assertEqual([r['text'] for r in self.messages('2026-01-01')],['first corrected','second','third'])

    def test_existing_cache_order_schema_migrates_and_backfills(self):
        self.write([message(3,text='third'),message(1,text='first'),message(2,text='second')]);self.run_build()
        with closing(sqlite3.connect(self.state/'archive.sqlite3')) as db:
            db.execute('DROP INDEX messages_day_source_order')
            db.execute('ALTER TABLE messages DROP COLUMN source_db')
            db.execute('ALTER TABLE messages DROP COLUMN local_sort');db.commit()
        result=self.run_build();self.assertEqual(result['recordsRead'],3)
        self.assertEqual([r['text'] for r in self.messages('2026-01-01')],['first','second','third'])
        self.assertEqual(self.run_build()['recordsRead'],0)

    def test_streaming_large_json_and_plain_array(self):
        rows=[message(i,text='合成文字'*1000) for i in range(1,120)];self.delta('batch',rows);result=self.run_build();self.assertEqual(result['count'],119)
        path=self.src/'new'/'聊天记录.json';path.parent.mkdir();path.write_text(json.dumps([message(120)]),encoding='utf-8');self.assertEqual(self.run_build()['count'],120)

    def test_mixed_conversation_invalid_times_and_lock(self):
        self.write([message(1)]);self.run_build()
        self.write([message(2,chat_username='other')],append=True)
        with self.assertRaises(chats.ImportFailure):self.run_build()
        self.write([message(1)]);self.delta('bad',[message(3,time='2026-01-01T12:00:00')])
        with self.assertRaises(chats.ImportFailure):self.run_build()
        with chats.exclusive_lock(self.state):
            with self.assertRaises(chats.ImportFailure):self.run_build()

    def test_source_output_guard(self):
        self.write([message(1)])
        with self.assertRaises(chats.ImportFailure):chats.build(self.src,self.src/'out',self.state)
        with self.assertRaises(chats.ImportFailure):chats.build(self.src,self.out,self.src/'cache')

    def test_fallback_identity_without_server_id(self):
        self.write([message(1,server_id='0'),message(2,server_id='0'),message(1,server_id='0')]);self.assertEqual(self.run_build()['count'],2)


if __name__=='__main__':unittest.main()
