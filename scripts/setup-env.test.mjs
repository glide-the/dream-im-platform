// [Input] Admin environment generator executed against disposable directories.
// [Output] Provider-free tests for mode, preservation, complete validation and fail-closed role/origin checks.
// [Pos] Deterministic configuration contract for unified auth and Admin-owned Dream DTO/ORM data access.
// [Sync] 2026-09-16: cover generated secrets and explicit external configuration without touching a real env file.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const scriptPath = join(repositoryRoot, 'scripts/setup-env.mjs');
let fixtureRoot;

function run(...arguments_) {
  return execFileSync(process.execPath, [scriptPath, '--root', fixtureRoot, ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function failure(...arguments_) {
  try {
    run(...arguments_);
  } catch (error) {
    return `${error.stderr ?? ''}${error.stdout ?? ''}${error.message ?? ''}`;
  }
  assert.fail('command unexpectedly succeeded');
}

function decode(raw) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

async function readEnv(path) {
  const values = new Map();
  for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    values.set(line.slice(0, separator), decode(line.slice(separator + 1)));
  }
  return values;
}

async function patchEnv(path, patch) {
  const contents = await readFile(path, 'utf8');
  const seen = new Set();
  const lines = contents.split(/\r?\n/).map((line) => {
    const separator = line.indexOf('=');
    const key = separator > 0 ? line.slice(0, separator) : '';
    if (!Object.hasOwn(patch, key)) return line;
    seen.add(key);
    return `${key}=${patch[key]}`;
  });
  for (const [key, value] of Object.entries(patch)) if (!seen.has(key)) lines.push(`${key}=${value}`);
  await writeFile(path, lines.join('\n'), { mode: 0o600 });
  await chmod(path, 0o600);
}

before(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'admin-setup-env.'));
  await mkdir(join(fixtureRoot, 'docker'));
});

after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

test('generated files are private and incomplete external configuration fails closed', async () => {
  run();
  assert.equal((await stat(join(fixtureRoot, '.env.local'))).mode & 0o777, 0o600);
  assert.equal((await stat(join(fixtureRoot, 'docker/.env'))).mode & 0o777, 0o600);
  const output = failure('--check');
  assert.match(output, /AUTH_DATABASE_URL/);
  assert.match(output, /GOOGLE_CLIENT_ID/);
  assert.match(output, /DREAM_GATEWAY_CLIENT_BINDINGS/);
});

test('a complete role, OAuth, Gateway and policy configuration validates and preserves the service secret', async () => {
  const paths = [join(fixtureRoot, '.env.local'), join(fixtureRoot, 'docker/.env')];
  const common = {
    AUTH_DATABASE_URL: 'postgres://ink_auth:test@127.0.0.1:54329/ink-memory',
    ADMIN_CONTROL_DATABASE_URL: 'postgres://ink_admin_control:test@127.0.0.1:54329/ink-memory',
    DREAM_DATA_DATABASE_URL: 'postgres://ink_dream_data:test@127.0.0.1:54329/ink-memory',
    GOOGLE_CLIENT_ID: 'test-google-client',
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
    DREAM_GATEWAY_CLIENT_BINDINGS: '[{"service_client_id":"ink-dream-service","gateway_client_id":"test-gateway","oauth_client_ids":["ink-dream-browser","ink-dream-device"]}]',
    DREAM_WORKSPACE_PLUGIN_POLICY_JSON: '{"version":1}',
    DREAM_RUNTIME_ACTIVATION_POLICY_JSON: '{"version":1}',
    DREAM_DECK_POLICY_JSON: '{"version":1}',
  };
  for (const path of paths) await patchEnv(path, common);
  assert.match(run('--check'), /Environment configuration is valid/);
  const beforeSecret = JSON.parse((await readEnv(paths[0])).get('DREAM_DATA_SERVICE_CLIENTS'))[0].secret;
  run();
  const afterSecret = JSON.parse((await readEnv(paths[0])).get('DREAM_DATA_SERVICE_CLIENTS'))[0].secret;
  assert.equal(afterSecret, beforeSecret);
});

test('duplicate database roles and cross-origin service registration are rejected', async () => {
  const rootPath = join(fixtureRoot, '.env.local');
  const original = await readFile(rootPath, 'utf8');
  await patchEnv(rootPath, { ADMIN_CONTROL_DATABASE_URL: 'postgres://ink_auth:test@127.0.0.1:54329/ink-memory' });
  assert.match(failure('--check'), /three distinct named roles/);
  await writeFile(rootPath, original, { mode: 0o600 });

  const values = await readEnv(rootPath);
  const clients = JSON.parse(values.get('DREAM_DATA_SERVICE_CLIENTS'));
  clients[0].origin = 'https://other.example.test';
  clients[0].redirectUri = 'https://other.example.test/auth/callback';
  await patchEnv(rootPath, { DREAM_DATA_SERVICE_CLIENTS: JSON.stringify(clients) });
  assert.match(failure('--check'), /strict non-empty registered client array/);
});
