import unittest
from build_chats import merge_enriched,ImportFailure

class RichMergeTests(unittest.TestCase):
    def test_sparse_export_keeps_media_and_quote(self):
        rich={'richVersion':1,'id':'m1','timestamp':1,'sender':'me','kind':'image','text':'一张图片','media':[{'id':'asset'}],
              'quote':{'text':'引用','media':[{'id':'other'}]}}
        sparse={'id':'m1','timestamp':1,'sender':'me','type':'图片','text':'一张图片（附件尚未收录）','attachment':True}
        self.assertEqual(merge_enriched(rich,sparse),rich)
    def test_plain_text_can_update_without_erasing_rich_fields(self):
        rich={'richVersion':1,'id':'m1','timestamp':1,'sender':'me','kind':'text','text':'旧'}
        sparse={'id':'m1','timestamp':1,'sender':'me','type':'文本','text':'新'}
        self.assertEqual(merge_enriched(rich,sparse)['text'],'新')
    def test_identity_conflict_stops_merge(self):
        rich={'richVersion':1,'id':'m1','timestamp':1,'sender':'me'}
        with self.assertRaises(ImportFailure):merge_enriched(rich,{'id':'m1','timestamp':2,'sender':'me'})

if __name__=='__main__':unittest.main()
