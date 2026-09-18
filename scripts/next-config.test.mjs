// [Input] Repository Next.js config, package launch scripts, working directory and existing build options.
// [Output] Provider-free Node tests for stable project-root resolution, integration launch and config validation.
// [Pos] Startup configuration regression tests; no server or database lifecycle.
// [Sync] 2026-09-18: pin the prebuilt embedded launch used by Dream integration.
// [Sync] 2026-09-15: pin NodeNext workspace extension aliases and all four fixed Dream codec traces.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const configUrl = new URL('../next.config.js', import.meta.url);
const projectRoot = dirname(fileURLToPath(configUrl));
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function readConfig(cwd = projectRoot, overrides = {}) {
  const env = { ...process.env };
  for (const key of ['INK_ADMIN_E2E_DIST_DIR', 'NEXT_BUILD_CPUS', 'NEXT_STANDALONE_OUTPUT']) delete env[key];
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import config from ${JSON.stringify(configUrl.href)};
    console.log(JSON.stringify({
      root: config.turbopack?.root,
      reactStrictMode: config.reactStrictMode,
      distDir: config.distDir,
      cpus: config.experimental?.cpus,
      output: config.output,
    }));
  `], { cwd, env: { ...env, ...overrides }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

function readTracing() {
  const env = { ...process.env };
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import config from ${JSON.stringify(configUrl.href)};
    console.log(JSON.stringify(config.outputFileTracingIncludes));
  `], { cwd: projectRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

function readWebpackExtensionAlias() {
  const env = { ...process.env };
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import config from ${JSON.stringify(configUrl.href)};
    const result = config.webpack({ resolve: { extensionAlias: { '.jsx': ['.jsx'] } } });
    console.log(JSON.stringify(result.resolve.extensionAlias));
  `], { cwd: projectRoot, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

test('Turbopack uses the configuration file directory as its absolute root', () => {
  assert.deepEqual(readConfig(), { root: projectRoot, reactStrictMode: true });
});

test('launching from an ancestor directory does not change the project root', () => {
  assert.equal(readConfig(dirname(projectRoot)).root, projectRoot);
});

test('existing isolated dist, build CPU and standalone options remain intact', () => {
  assert.deepEqual(readConfig(projectRoot, {
    INK_ADMIN_E2E_DIST_DIR: '.next-e2e-admin-config-contract',
    NEXT_BUILD_CPUS: '2',
    NEXT_STANDALONE_OUTPUT: 'true',
  }), {
    root: projectRoot,
    reactStrictMode: true,
    distDir: '.next-e2e-admin-config-contract',
    cpus: 2,
    output: 'standalone',
  });
});

test('invalid existing dist and CPU options are still rejected', () => {
  assert.throws(() => readConfig(projectRoot, { INK_ADMIN_E2E_DIST_DIR: '../outside' }), /repository-local/);
  for (const value of ['0', '65', '1.5', 'invalid']) {
    assert.throws(() => readConfig(projectRoot, { NEXT_BUILD_CPUS: value }), /integer between 1 and 64/);
  }
});

test('internal Dream operations trace every fixed Python codec from the repository', () => {
  assert.deepEqual(readTracing(), {
    '/api/internal/dream/v1/operations/*': [
      './app/lib/dream/deckContentCanonical.py',
      './app/lib/dream/dreamLaunchEnvelope.py',
      './app/lib/dream/dreamLaunchFailureEnvelope.py',
      './app/lib/dream/userSystemConfigCodec.py',
    ],
  });
});

test('Webpack resolves NodeNext JavaScript specifiers to workspace TypeScript sources', () => {
  assert.deepEqual(readWebpackExtensionAlias(), {
    '.jsx': ['.jsx'],
    '.js': ['.ts', '.tsx', '.js'],
    '.mjs': ['.mts', '.mjs'],
    '.cjs': ['.cts', '.cjs'],
  });
});

test('stable local integration builds once and starts under the embedded PostgreSQL supervisor', () => {
  assert.equal(packageJson.scripts['start:embedded'], 'tsx packages/db/src/supervise.ts pnpm start');
  assert.equal(packageJson.scripts['local:stable'], 'pnpm build && pnpm run start:embedded');
  assert.equal(packageJson.scripts['dev:app'], 'next dev --webpack -H 0.0.0.0');
});
