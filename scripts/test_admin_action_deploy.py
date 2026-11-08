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



class ActivationContract(unittest.TestCase):
    def scenario(self, fail):
        import contextlib
        import io
        import json
        import os
        import types
        from unittest.mock import patch
        with tempfile.TemporaryDirectory(prefix='ink-admin-activation-contract-') as tmp:
            root = Path(tmp).resolve()
            releases = root / 'releases'
            old = releases / 'old'
            (old / '.next').mkdir(parents=True)
            (old / '.next/BUILD_ID').write_text('old-build')
            (old / '.env.local').write_text('SYNTHETIC=fixture-only')
            (old / '.env.local').chmod(0o600)
            data = root / 'postgres'
            data.mkdir(mode=0o700)
            data_inode = data.stat().st_ino
            dropin = root / 'service.conf'
            prior = b'[Service]\nWorkingDirectory=original-fixture\n'
            dropin.write_bytes(prior)
            source = root / 'source'
            (source / '.next').mkdir(parents=True)
            (source / '.next/BUILD_ID').write_text('new-build')
            receipt = {'sourceCommit': 'a'*40, 'runId': '123', 'platform': 'linux', 'arch': 'x64', 'nodeVersion': 'v22.23.4', 'buildId': 'new-build', 'files': [{'path': '.next/BUILD_ID', 'sha256': receiver.digest(source / '.next/BUILD_ID')}]}
            (source / 'release-output').mkdir()
            (source / 'release-output/receipt.json').write_text(json.dumps(receipt))
            packed = io.BytesIO()
            with receiver.tarfile.open(fileobj=packed, mode='w:gz') as output:
                output.add(source, arcname='.')
            archive = packed.getvalue()
            config = root / 'config.json'
            config.write_text(json.dumps({'hostname': 'fixture-host', 'node': 'fixture-node', 'pnpm': 'fixture-pnpm', 'service': 'fixture.service', 'user': 'fixture-user', 'releases': str(releases), 'data_dir': str(data), 'dropin': str(dropin), 'health_url': 'http://fixture.invalid', 'public_health_url': 'https://public.fixture.invalid/admin/login', 'lock': str(root/'lock'), 'min_mem_available_bytes': 1, 'max_archive_bytes': 1000000, 'unpack_disk_factor': 1, 'health_timeout_seconds': 3}))
            config.chmod(0o600)
            commands = []
            def execute(args, **kwargs):
                commands.append(args)
                if args == ['fixture-node', '--version']:
                    return 'v22.23.4'
                if 'WorkingDirectory' in args:
                    return str(old)
                if 'User' in args:
                    return 'fixture-user'
                return ''
            original_stat, original_read = Path.stat, Path.read_text
            def metadata(path, *args, **kwargs):
                value = original_stat(path, *args, **kwargs)
                if path == config:
                    values = list(value);values[4] = 0
                    return os.stat_result(values)
                return value
            def read(path, *args, **kwargs):
                if str(path) == '/proc/meminfo':
                    return 'MemAvailable: 999999 kB'
                if str(path) == '/sys/module/zswap/parameters/enabled':
                    return 'N'
                if str(path) == '/proc/swaps':
                    return 'Filename Type Size Used Priority\n'
                return original_read(path, *args, **kwargs)
            identity = types.SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid())
            ticks = iter(range(100))
            responses = iter([True, False, True] if fail == 'public' else [False, False, True] if fail else [True, True])
            stdout = io.StringIO()
            with patch.object(receiver.sys, 'argv', ['receiver', str(config)]), patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': 'deploy '+ 'a'*40+' '+hashlib.sha256(archive).hexdigest()+' 123'}), patch.object(receiver.os, 'geteuid', return_value=0), patch.object(receiver.os, 'chown'), patch.object(receiver.socket, 'gethostname', return_value='fixture-host'), patch.object(receiver.pwd, 'getpwnam', return_value=identity), patch.object(receiver, 'run', side_effect=execute), patch.object(receiver, 'healthy', side_effect=lambda _: next(responses)), patch.object(receiver.time, 'monotonic', side_effect=lambda: next(ticks)), patch.object(receiver.time, 'sleep'), patch.object(receiver.signal, 'signal'), patch.object(receiver.sys, 'stdin', types.SimpleNamespace(buffer=io.BytesIO(archive))), patch.object(Path, 'stat', metadata), patch.object(Path, 'read_text', read), contextlib.redirect_stdout(stdout):
                if fail:
                    with self.assertRaisesRegex(ValueError, 'Published route' if fail == 'public' else 'health deadline'):
                        receiver.main()
                else:
                    receiver.main()
            self.assertEqual(data.stat().st_ino, data_inode)
            self.assertEqual((old / '.env.local').read_text(), 'SYNTHETIC=fixture-only')
            self.assertTrue(any(receiver.MIGRATION_CHECK_SCRIPT in args for args in commands))
            if fail:
                self.assertEqual(dropin.read_bytes(), prior)
                self.assertIn('rolled_back', stdout.getvalue())
                self.assertIn(['systemctl', 'stop', 'fixture.service'], commands)
            else:
                self.assertIn('deployed', stdout.getvalue())
                self.assertIn('actions-123-', dropin.read_text())

    def test_success_preserves_private_config_and_original_data(self):
        self.scenario(False)

    def test_failed_health_restores_previous_dropin_and_data(self):
        self.scenario(True)

    def test_failed_published_route_restores_previous_release(self):
        self.scenario('public')


class PreflightContract(unittest.TestCase):
    def test_public_probe_is_bound_to_server_configuration(self):
        from unittest.mock import patch
        cfg = {'node': 'fixture-node', 'service': 'fixture.service', 'public_health_url': 'https://public.fixture.invalid/admin/login'}
        with patch.object(receiver, 'run', side_effect=['v22.23.4', 'x86_64', 'active']), patch.object(receiver, 'healthy', return_value=True) as probe:
            self.assertEqual(receiver.preflight(cfg)['publicHttp'], 200)
            probe.assert_called_once_with(cfg['public_health_url'])

    def test_failed_public_probe_blocks_preflight(self):
        from unittest.mock import patch
        cfg = {'node': 'fixture-node', 'service': 'fixture.service', 'public_health_url': 'https://public.fixture.invalid/admin/login'}
        with patch.object(receiver, 'run', side_effect=['v22.23.4', 'x86_64', 'active']), patch.object(receiver, 'healthy', return_value=False):
            with self.assertRaisesRegex(ValueError, 'Published route'):
                receiver.preflight(cfg)


if __name__ == '__main__':
    unittest.main()
