// [Input] Repository Next.js config, launch working directory and existing build options.
// [Output] Provider-free Node tests for stable project-root resolution and config validation.
// [Pos] Startup configuration regression tests; no server or database lifecycle.
// [Sync] 2026-09-13: prevent ancestor lockfiles or launch cwd from selecting another project root.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const configUrl = new URL('../next.config.js', import.meta.url);
const projectRoot = dirname(fileURLToPath(configUrl));

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
