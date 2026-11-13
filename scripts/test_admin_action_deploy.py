# [Input] Disposable files and a mocked command runner; no normal services or data.
# [Output] Receiver manifest and check-only migration protection evidence.
# [Pos] Isolated release receiver contract.
# [Sync] 2026-11-08: verify public deadlines, sanitized failure classes, manifest integrity and activation rollback.
# [Sync] 2026-11-14: verify external role URL/cluster binding and release rollback without a local database directory.
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
    def scenario(self, fail, mode='embedded-postgres'):
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
            config.write_text(json.dumps({'hostname': 'fixture-host', 'node': 'fixture-node', 'pnpm': 'fixture-pnpm', 'service': 'fixture.service', 'user': 'fixture-user', 'releases': str(releases), 'data_dir': str(data), 'dropin': str(dropin), 'health_url': 'http://fixture.invalid', 'public_health_url': 'https://public.fixture.invalid/admin/login', 'public_health_timeout_seconds': 20, 'lock': str(root/'lock'), 'min_mem_available_bytes': 1, 'max_archive_bytes': 1000000, 'unpack_disk_factor': 1, 'health_timeout_seconds': 3}))
            if mode == 'postgres':
                cfg = json.loads(config.read_text())
                cfg.pop('data_dir')
                cfg.update(database_mode=mode, database_target=ExternalDatabaseContract.target)
                config.write_text(json.dumps(cfg))
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
                if receiver.DATABASE_STATE_SCRIPT in args:
                    return json.dumps(ExternalDatabaseContract.target)
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
            with patch.object(receiver.sys, 'argv', ['receiver', str(config)]), patch.dict(os.environ, {'SSH_ORIGINAL_COMMAND': 'deploy '+ 'a'*40+' '+hashlib.sha256(archive).hexdigest()+' 123'}), patch.object(receiver.os, 'geteuid', return_value=0), patch.object(receiver.os, 'chown'), patch.object(receiver.socket, 'gethostname', return_value='fixture-host'), patch.object(receiver.pwd, 'getpwnam', return_value=identity), patch.object(receiver, 'run', side_effect=execute), patch.object(receiver, 'healthy', side_effect=lambda _, **options: next(responses)), patch.object(receiver.time, 'monotonic', side_effect=lambda: next(ticks)), patch.object(receiver.time, 'sleep'), patch.object(receiver.signal, 'signal'), patch.object(receiver.sys, 'stdin', types.SimpleNamespace(buffer=io.BytesIO(archive))), patch.object(Path, 'stat', metadata), patch.object(Path, 'read_text', read), contextlib.redirect_stdout(stdout):
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
                self.assertIn('run start\n' if mode == 'postgres' else 'run start:embedded\n', dropin.read_text())

    def test_success_preserves_private_config_and_original_data(self):
        self.scenario(False)

    def test_failed_health_restores_previous_dropin_and_data(self):
        self.scenario(True)

    def test_failed_published_route_restores_previous_release(self):
        self.scenario('public')

    def test_external_success_keeps_all_checks_without_local_data_directory(self):
        self.scenario(False, mode='postgres')

    def test_external_failed_health_restores_previous_release(self):
        self.scenario(True, mode='postgres')

    def test_external_failed_public_route_restores_previous_release(self):
        self.scenario('public', mode='postgres')


class ExternalDatabaseContract(unittest.TestCase):
    target = {'host': 'db.fixture.invalid', 'port': 5432, 'name': 'fixture', 'systemIdentifier': '12345', 'databaseOid': '67890'}

    def test_cluster_drift_fails_closed(self):
        import json
        from unittest.mock import patch
        cfg = {'database_mode': 'postgres', 'database_target': self.target, 'user': 'fixture-user', 'node': 'fixture-node'}
        with patch.object(receiver, 'run', return_value=json.dumps({**self.target, 'systemIdentifier': '99999'})):
            with self.assertRaisesRegex(ValueError, 'identity mismatch'):
                receiver.database_state(cfg, Path('/fixture'), None)

    def test_missing_identity_and_unknown_mode_fail_closed(self):
        for cfg in [{'database_mode': 'postgres'}, {'database_mode': 'unknown'}]:
            with self.assertRaises(ValueError):
                receiver.database_state(cfg, Path('/fixture'), None)

    def test_all_role_urls_and_topology_are_required_without_disclosing_credentials(self):
        import json
        import os
        import subprocess
        with tempfile.TemporaryDirectory(prefix='ink-external-database-contract-') as tmp:
            root = Path(tmp)
            (root / 'package.json').write_text('{"type":"module"}')
            module = root / 'node_modules/pg'
            module.mkdir(parents=True)
            (module / 'package.json').write_text('{"type":"module","main":"index.js"}')
            (module / 'index.js').write_text("export default {Client: class {async connect() {} async end() {} async query(sql) {if(sql==='SET default_transaction_read_only = on')return {};if(!sql.startsWith('SELECT system_identifier'))throw Error('Unexpected SQL');return {rows:[{cluster:'12345',database:'67890'}]};}}}")
            keys = ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'AUTH_DATABASE_URL', 'ADMIN_CONTROL_DATABASE_URL', 'DREAM_DATA_DATABASE_URL']
            env = dict(os.environ, INK_DATABASE_MODE='postgres', **{key: 'postgresql://role:private-fixture-password@db.fixture.invalid:5432/fixture' for key in keys})
            command = ['node', '--input-type=module', '-e', receiver.DATABASE_STATE_SCRIPT, json.dumps(self.target)]
            result = subprocess.run(command, cwd=root, env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout), self.target)
            cases = [{**env, key: 'postgresql://role:private-fixture-password@other.invalid/fixture'} for key in keys]
            cases += [{**env, key: ''} for key in keys]
            cases += [{**env, 'INK_DATABASE_MODE': 'embedded-postgres'}]
            for invalid in cases:
                with self.subTest(changed=[key for key in invalid if invalid[key] != env.get(key)]):
                    result = subprocess.run(command, cwd=root, env=invalid, capture_output=True, text=True)
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(result.stdout, '')
                    self.assertEqual(result.stderr.strip(), 'EXTERNAL_DATABASE_CHECK_FAILED')
                    self.assertNotIn('private-fixture-password', result.stderr)


class PreflightContract(unittest.TestCase):
    def test_public_probe_is_bound_to_server_configuration(self):
        from unittest.mock import patch
        cfg = {'node': 'fixture-node', 'service': 'fixture.service', 'public_health_url': 'https://public.fixture.invalid/admin/login', 'public_health_timeout_seconds': 20}
        with patch.object(receiver, 'run', side_effect=['v22.23.4', 'x86_64', 'active']), patch.object(receiver, 'healthy', return_value=True) as probe:
            self.assertEqual(receiver.preflight(cfg)['publicHttp'], 200)
            probe.assert_called_once_with(cfg['public_health_url'], timeout=20, diagnostic=True)

    def test_failed_public_probe_blocks_preflight(self):
        from unittest.mock import patch
        cfg = {'node': 'fixture-node', 'service': 'fixture.service', 'public_health_url': 'https://public.fixture.invalid/admin/login', 'public_health_timeout_seconds': 20}
        with patch.object(receiver, 'run', side_effect=['v22.23.4', 'x86_64', 'active']), patch.object(receiver, 'healthy', return_value=False):
            with self.assertRaisesRegex(ValueError, 'Published route'):
                receiver.preflight(cfg)

    def test_health_probe_forwards_its_explicit_network_deadline(self):
        from unittest.mock import MagicMock, patch
        response = MagicMock()
        response.__enter__.return_value.status = 200
        with patch.object(receiver.urllib.request, 'urlopen', return_value=response) as request:
            self.assertTrue(receiver.healthy('https://fixture.invalid', timeout=20))
            request.assert_called_once_with('https://fixture.invalid', timeout=20)


    def assert_sanitized_probe_failure(self, error, expected):
        import contextlib
        import io
        import json
        from unittest.mock import patch
        output = io.StringIO()
        with patch.object(receiver.urllib.request, 'urlopen', side_effect=error), contextlib.redirect_stderr(output):
            self.assertFalse(receiver.healthy('https://fixture.invalid/?private=synthetic', timeout=20, diagnostic=True))
        self.assertEqual(json.loads(output.getvalue()), {'event': 'public_health_failed', **expected})
        self.assertNotIn('private', output.getvalue())
        self.assertNotIn('synthetic', output.getvalue())

    def test_http_failure_reports_status_without_private_details(self):
        error = receiver.urllib.error.HTTPError('https://fixture.invalid/?private=synthetic', 403, 'synthetic', {}, None)
        self.assert_sanitized_probe_failure(error, {'errorClass': 'HTTPError', 'httpStatus': 403})

    def test_timeout_reports_class_without_private_details(self):
        self.assert_sanitized_probe_failure(TimeoutError('private synthetic'), {'errorClass': 'TimeoutError'})


if __name__ == '__main__':
    unittest.main()
