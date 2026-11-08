# [Input] Disposable files and a mocked command runner; no normal services or data.
# [Output] Receiver manifest and check-only migration protection evidence.
# [Pos] Isolated release receiver contract.
# [Sync] 2026-11-08: reject altered, extra, escaped or private release files.
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('receiver', Path(__file__).with_name('admin-action-deploy.py'))
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)


class ManifestContract(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ink-admin-receiver-contract-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'release-output').mkdir()
        (self.root / 'release-output/receipt.json').write_text('{}')
        (self.root / 'app.js').write_text('synthetic')
        self.receipt = {'files': [{'path': 'app.js', 'sha256': hashlib.sha256(b'synthetic').hexdigest()}]}

    def test_exact(self):
        receiver.verify_files(self.root, self.receipt)

    def test_changed(self):
        (self.root / 'app.js').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'mismatch'):
            receiver.verify_files(self.root, self.receipt)

    def test_extra(self):
        (self.root / 'extra').write_text('extra')
        with self.assertRaisesRegex(ValueError, 'Unregistered'):
            receiver.verify_files(self.root, self.receipt)

    def test_private_path(self):
        self.receipt['files'][0]['path'] = '.env.local'
        with self.assertRaisesRegex(ValueError, 'Invalid'):
            receiver.verify_files(self.root, self.receipt)

    def test_escape(self):
        (self.root / 'escape').symlink_to('/etc/hosts')
        self.receipt['files'].append({'path': 'escape', 'link': '/etc/hosts'})
        with self.assertRaisesRegex(ValueError, 'escapes'):
            receiver.verify_files(self.root, self.receipt)

    def test_duplicate(self):
        self.receipt['files'] *= 2
        with self.assertRaisesRegex(ValueError, 'Invalid'):
            receiver.verify_files(self.root, self.receipt)

    def test_migration_argv_is_explicit_check_only(self):
        import os
        import subprocess
        target = self.root / 'packages/db/dist'
        target.mkdir(parents=True)
        (target / 'migrate.js').write_text("if(JSON.stringify(process.argv.slice(2))!=='[\"--check\"]')process.exit(9);console.log('check-only')")
        env = dict(os.environ, MIGRATION_DATABASE_URL='postgresql://synthetic.invalid/fixture')
        result = subprocess.run(['node', '--input-type=module', '-e', receiver.MIGRATION_CHECK_SCRIPT], cwd=self.root, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'check-only')
        env.pop('MIGRATION_DATABASE_URL')
        result = subprocess.run(['node', '--input-type=module', '-e', receiver.MIGRATION_CHECK_SCRIPT], cwd=self.root, env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('check-only', result.stdout)



if __name__ == '__main__':
    unittest.main()
