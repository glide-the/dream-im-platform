#!/usr/bin/env python3
# [Input] Root-owned target config, forced SSH command and SHA-bound Linux archive on stdin.
# [Output] Verified candidate activation or restored previous release against the configured PostgreSQL topology.
# [Pos] Narrow Admin Actions receiver; no shell, DDL, key replacement or database restore.
# [Sync] 2026-11-08: public health uses an explicit deadline and reports fixed failure classes without URL or response data.
# [Sync] 2026-11-14: external PostgreSQL binds all role URLs and cluster identity; release rollback retains that database.
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shlex
import signal
import shutil
import socket
import stat
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request


MIGRATION_CHECK_SCRIPT = "if(!process.env.MIGRATION_DATABASE_URL)throw Error('Explicit migration target required');process.argv=['node','migrate','--check'];await import('./packages/db/dist/migrate.js')"
DATABASE_STATE_SCRIPT = r"""
import pg from 'pg';
let client;
try {
    const expected = JSON.parse(process.argv[1]);
    if (process.env.INK_DATABASE_MODE !== 'postgres') throw Error();
    for (const key of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'AUTH_DATABASE_URL', 'ADMIN_CONTROL_DATABASE_URL', 'DREAM_DATA_DATABASE_URL']) {
        const url = new URL(process.env[key]);
        if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== expected.host || Number(url.port || 5432) !== expected.port || decodeURIComponent(url.pathname.slice(1)) !== expected.name) throw Error();
    }
    client = new pg.Client({connectionString: process.env.MIGRATION_DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000});
    await client.connect();
    await client.query('SET default_transaction_read_only = on');
    const {rows: [row]} = await client.query("SELECT system_identifier::text AS cluster, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database FROM pg_control_system()");
    console.log(JSON.stringify({...expected, systemIdentifier: row.cluster, databaseOid: row.database}));
} catch {
    console.error('EXTERNAL_DATABASE_CHECK_FAILED');
    process.exitCode = 1;
} finally {
    await client?.end().catch(() => {});
}
"""


def database_mode(cfg):
    mode = cfg.get('database_mode', 'embedded-postgres')
    if mode not in ('embedded-postgres', 'postgres'):
        raise ValueError('Explicit supported database topology required')
    return mode


def database_state(cfg, release, owner):
    if database_mode(cfg) == 'embedded-postgres':
        data = Path(cfg['data_dir'])
        metadata = data.stat()
        if data.is_symlink() or metadata.st_uid != owner.pw_uid or stat.S_IMODE(metadata.st_mode) != 0o700:
            raise ValueError('Original PostgreSQL directory required')
        return {'mode': 'embedded-postgres', 'device': metadata.st_dev, 'dataInode': metadata.st_ino}
    expected = cfg.get('database_target')
    if not isinstance(expected, dict) or set(expected) != {'host', 'port', 'name', 'systemIdentifier', 'databaseOid'}:
        raise ValueError('Explicit external PostgreSQL identity required')
    if any(not isinstance(expected[key], str) or not expected[key] for key in ('host', 'name', 'systemIdentifier', 'databaseOid')) or type(expected['port']) is not int or not 1 <= expected['port'] <= 65535:
        raise ValueError('Invalid external PostgreSQL identity')
    actual = json.loads(run(['runuser', '-u', cfg['user'], '--', cfg['node'], '--env-file=.env.local', '--input-type=module', '-e', DATABASE_STATE_SCRIPT, json.dumps(expected)], cwd=release, timeout=30))
    if actual != expected:
        raise ValueError('External PostgreSQL identity mismatch')
    return {'mode': 'postgres', **actual}

def run(args, **kwargs):
    return subprocess.run(args, check=True, timeout=kwargs.pop('timeout', 30), capture_output=True, text=True, **kwargs).stdout.strip()


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def verify_files(root, receipt):
    seen = set()
    for item in receipt['files']:
        name = item['path']
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts or name in seen or any(p.startswith('.env') for p in relative.parts):
            raise ValueError('Invalid manifest path')
        seen.add(name)
        target = root / relative
        if not target.resolve().is_relative_to(root.resolve()):
            raise ValueError('Release path escapes candidate')
        if 'link' in item:
            if not target.is_symlink() or os.readlink(target) != item['link']:
                raise ValueError('Release link mismatch')
        elif target.is_symlink() or not target.is_file() or digest(target) != item['sha256']:
            raise ValueError('Release file mismatch')
    actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() or p.is_symlink()}
    if actual != seen | {'release-output/receipt.json'}:
        raise ValueError('Unregistered release files')


def healthy(url, timeout=5, diagnostic=False):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            if response.status == 200:
                return True
            if diagnostic:
                print(json.dumps({'event': 'public_health_failed', 'httpStatus': response.status}), file=sys.stderr)
            return False
    except Exception as error:
        if diagnostic:
            detail = {'event': 'public_health_failed', 'errorClass': type(error).__name__}
            if isinstance(error, urllib.error.HTTPError):
                detail['httpStatus'] = error.code
            print(json.dumps(detail), file=sys.stderr)
        return False


def preflight(cfg):
    result = {'hostname': socket.gethostname(), 'nodeVersion': run([cfg['node'], '--version']), 'arch': run(['uname', '-m']), 'state': run(['systemctl', 'is-active', cfg['service']])}
    if not healthy(cfg['public_health_url'], timeout=cfg['public_health_timeout_seconds'], diagnostic=True):
        raise ValueError('Published route check failed')
    return {**result, 'publicHttp': 200}


def main():
    config_path = Path(sys.argv[1])
    if os.geteuid() != 0 or config_path.is_symlink() or config_path.stat().st_uid != 0 or config_path.stat().st_mode & 0o022:
        raise ValueError('Root-owned receiver configuration required')
    def interrupted(_signal, _frame):
        raise InterruptedError("Release connection interrupted")
    for event in (signal.SIGHUP, signal.SIGTERM, signal.SIGINT):
        signal.signal(event, interrupted)
    cfg = json.loads(config_path.read_text())
    if socket.gethostname() != cfg['hostname']:
        raise ValueError('Host identity mismatch')
    command = shlex.split(os.environ.get('SSH_ORIGINAL_COMMAND', ''))
    if command == ['preflight']:
        print(json.dumps(preflight(cfg)))
        return
    if len(command) != 4 or command[0] != 'deploy' or not re.fullmatch('[a-f0-9]{40}', command[1]) or not re.fullmatch('[a-f0-9]{64}', command[2]) or not re.fullmatch('[0-9]+', command[3]):
        raise ValueError('Only preflight or exact deploy command is permitted')
    sha, expected_hash, run_id = command[1:]
    os.umask(0o077)
    with open(cfg['lock'], 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        previous = Path(run(['systemctl', 'show', cfg['service'], '-p', 'WorkingDirectory', '--value'])).resolve()
        releases = Path(cfg['releases']).resolve()
        if not previous.is_relative_to(releases) or not (previous / '.next/BUILD_ID').is_file():
            raise ValueError('Previous complete release required')
        owner = pwd.getpwnam(cfg['user'])
        if run(['systemctl', 'show', cfg['service'], '-p', 'User', '--value']) != cfg['user']:
            raise ValueError('Runtime user mismatch')
        env = previous / '.env.local'
        if env.is_symlink() or env.stat().st_uid != owner.pw_uid or stat.S_IMODE(env.stat().st_mode) != 0o600:
            raise ValueError('Original private configuration required')
        before = database_state(cfg, previous, owner)
        mem = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
        if int(mem['MemAvailable'].split()[0]) * 1024 < cfg['min_mem_available_bytes']:
            raise ValueError('Insufficient runtime headroom')
        if len(Path('/proc/swaps').read_text().splitlines()) != 1:
            raise ValueError('Disabled swap policy required')
        zswap = Path('/sys/module/zswap/parameters/enabled')
        if zswap.exists() and zswap.read_text().strip() != 'N':
            raise ValueError('Disabled zswap policy required')
        directory = releases / ('actions-' + run_id + '-' + sha[:12])
        directory.mkdir(mode=0o700)
        archive = directory / 'incoming.tgz'
        count = 0
        with archive.open('xb') as output:
            for chunk in iter(lambda: sys.stdin.buffer.read(1024 * 1024), b''):
                count += len(chunk)
                if count > cfg['max_archive_bytes']:
                    raise ValueError('Archive exceeds configured disk budget')
                output.write(chunk)
        if digest(archive) != expected_hash or shutil.disk_usage(releases).free < count * cfg['unpack_disk_factor']:
            raise ValueError('Archive digest or free disk mismatch')
        candidate = directory / 'app'
        candidate.mkdir(mode=0o700)
        with tarfile.open(archive) as source:
            source.extractall(candidate, filter='data')
        receipt = json.loads((candidate / 'release-output/receipt.json').read_text())
        if receipt['sourceCommit'] != sha or receipt['runId'] != run_id or receipt['platform'] != 'linux' or receipt['arch'] != 'x64' or receipt['nodeVersion'] != run([cfg['node'], '--version']):
            raise ValueError('Build identity mismatch')
        verify_files(candidate, receipt)
        if (candidate / '.next/BUILD_ID').read_text().strip() != receipt['buildId']:
            raise ValueError('Build ID mismatch')
        shutil.copyfile(env, candidate / '.env.local')
        os.chmod(candidate / '.env.local', 0o600)
        for root, dirs, files in os.walk(directory, followlinks=False):
            os.chown(root, owner.pw_uid, owner.pw_gid)
            for name in dirs + files:
                os.chown(Path(root) / name, owner.pw_uid, owner.pw_gid, follow_symlinks=False)
        if database_state(cfg, candidate, owner) != before:
            raise ValueError('Candidate database identity changed')
        # Check-only uses the existing explicit migration credential; it never starts another PostgreSQL.
        run(['runuser', '-u', cfg['user'], '--', cfg['node'], '--env-file=.env.local', '--input-type=module', '-e', MIGRATION_CHECK_SCRIPT], cwd=candidate, timeout=90)
        dropin = Path(cfg['dropin'])
        prior = dropin.read_bytes() if dropin.exists() else None
        if prior is not None:
            (directory / 'previous-dropin.conf').write_bytes(prior)
        def activate(location, content=None):
            if content is None:
                script = 'start:embedded' if database_mode(cfg) == 'embedded-postgres' else 'start'
                content = ('[Service]\nWorkingDirectory=' + str(location) + '\nExecStart=\nExecStart=' + cfg['pnpm'] + ' run ' + script + '\n').encode()
            temporary = dropin.with_suffix('.tmp')
            temporary.write_bytes(content)
            os.chmod(temporary, 0o644)
            temporary.replace(dropin)
            run(['systemctl', 'daemon-reload'])
            run(['systemctl', 'restart', cfg['service']], timeout=120)
        try:
            activate(candidate)
            deadline = time.monotonic() + cfg['health_timeout_seconds']
            while time.monotonic() < deadline:
                if healthy(cfg['health_url']):
                    break
                time.sleep(2)
            else:
                raise ValueError('Candidate health deadline exceeded')
            if not healthy(cfg['public_health_url'], timeout=cfg['public_health_timeout_seconds'], diagnostic=True):
                raise ValueError('Published route check failed')
            if before != database_state(cfg, candidate, owner) or digest(env) != digest(candidate / '.env.local'):
                raise ValueError('Persistent state identity changed')
            print(json.dumps({'state': 'deployed', 'sourceCommit': sha, 'buildId': receipt['buildId'], 'previousRelease': str(previous), 'release': str(candidate), 'database': before, 'dataInode': before.get('dataInode'), 'publicHttp': 200}))
        except Exception:
            run(['systemctl', 'stop', cfg['service']], timeout=120)
            if prior is None:
                if dropin.exists():
                    dropin.unlink()
                run(['systemctl', 'daemon-reload'])
                run(['systemctl', 'start', cfg['service']], timeout=120)
            else:
                activate(previous, prior)
            deadline = time.monotonic() + cfg['health_timeout_seconds']
            while time.monotonic() < deadline:
                if healthy(cfg['health_url']):
                    break
                time.sleep(2)
            else:
                raise RuntimeError('Previous release health deadline exceeded')
            print(json.dumps({'state': 'rolled_back', 'previousRelease': str(previous)}))
            raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Fixed classifications protect private config, DB URLs and child stderr.
        print('ADMIN_RELEASE_FAILED: ' + (str(error) if isinstance(error, ValueError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
