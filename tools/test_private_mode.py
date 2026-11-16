"""Personal-data safeguards use temporary synthetic repositories only."""
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class PrivateModeTests(unittest.TestCase):
    def test_prepare_untracks_files_without_deleting_them(self):
        if not shutil.which('git'):
            self.skipTest('Git is not installed')
        with tempfile.TemporaryDirectory(prefix='planet-private-test-') as tmp:
            root = Path(tmp)
            (root / 'tools').mkdir()
            shutil.copyfile(ROOT / 'tools/prepare_private.py', root / 'tools/prepare_private.py')
            for name in ['data/demo.json', 'public/demo.webp', 'demo-media/demo.wav', 'config/site.js']:
                p = root / name; p.parent.mkdir(parents=True, exist_ok=True); p.write_text('fictional fixture', encoding='utf-8')
            (root / '.gitignore').write_text('', encoding='utf-8')
            subprocess.run(['git', 'init', '--quiet', str(root)], check=True)
            subprocess.run(['git', '-C', str(root), 'add', '.'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            run = subprocess.run([sys.executable, str(root / 'tools/prepare_private.py'), '--confirm'], capture_output=True)
            self.assertEqual(run.returncode, 0)
            self.assertEqual((root / 'data/demo.json').read_text(), 'fictional fixture')
            tracked = subprocess.check_output(['git', '-C', str(root), 'ls-files'], text=True)
            self.assertNotIn('data/demo.json', tracked)
            ignored = subprocess.run(['git', '-C', str(root), 'check-ignore', 'data/demo.json', 'config/site.js'], capture_output=True)
            self.assertEqual(ignored.returncode, 0)
            self.assertTrue((root / '.private-mode').exists())

    def test_package_rejects_personal_data_without_explicit_flag(self):
        with tempfile.TemporaryDirectory(prefix='planet-package-test-') as tmp:
            root = Path(tmp) / 'site'; (root / 'tools').mkdir(parents=True)
            shutil.copyfile(ROOT / 'tools/package_site.py', root / 'tools/package_site.py')
            (root / '.private-mode').write_text('private', encoding='utf-8')
            out = Path(tmp) / 'site.zip'
            run = subprocess.run([sys.executable, str(root / 'tools/package_site.py'), '--out', str(out)], capture_output=True)
            self.assertNotEqual(run.returncode, 0)
            self.assertFalse(out.exists())

    def test_generator_rejects_personal_checkout(self):
        with tempfile.TemporaryDirectory(prefix='planet-generator-test-') as tmp:
            root = Path(tmp); (root / 'tools').mkdir()
            shutil.copyfile(ROOT / 'tools/generate_demo.py', root / 'tools/generate_demo.py')
            (root / '.private-mode').write_text('private', encoding='utf-8')
            run = subprocess.run([sys.executable, str(root / 'tools/generate_demo.py'), '--confirm'], capture_output=True)
            self.assertNotEqual(run.returncode, 0)
            self.assertFalse((root / 'data').exists())


if __name__ == '__main__':
    unittest.main()
