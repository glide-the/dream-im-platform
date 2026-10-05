// [Input] Production stdio preload and process supervisor with synthetic owned Node commands.
// [Output] Database/provider-free regressions for healthy output, failed logging and whole-tree shutdown.
// [Pos] Isolated process lifecycle tests included by the normal test:config command.
// [Sync] 2026-10-05: exercise terminal-loss boundaries, signal propagation and forced descendant cleanup.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('./next-stdio-guard.mjs', import.meta.url));
const supervisor = new URL('../packages/db/src/supervised-command.ts', import.meta.url).href;
const runtimeConfig = new URL('../packages/db/src/runtime-config.ts', import.meta.url).href;
const root = fileURLToPath(new URL('../', import.meta.url));

function probe(source, { preload = false } = {}) {
  const child = spawn(process.execPath, [
    '--import', preload ? guard : 'tsx', '--input-type=module', '-e', source,
  ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  const ownedGroups = new Set();
  child.stdout.on('data', (chunk) => {
    stdout += String(chunk);
    for (const match of stdout.matchAll(/GROUP_PID=(\d+)/g)) ownedGroups.add(Number(match[1]));
  });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  const timer = setTimeout(() => {
    for (const pid of ownedGroups) {
      try { process.kill(-pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    child.kill('SIGKILL');
  }, 10_000);
  completion.finally(() => clearTimeout(timer));
  return {
    child, completion,
    async waitFor(marker) {
      const deadline = performance.now() + 5_000;
      while (!stdout.includes(marker)) {
        assert.equal(child.exitCode, null, `Probe exited before ${marker}: ${stdout} ${stderr}`);
        assert.ok(performance.now() < deadline, `Probe did not emit ${marker}: ${stdout} ${stderr}`);
        await delay(10);
      }
    },
  };
}

function commandProbe(commandSource, extra = '') {
  return probe(`
    import { superviseCommand } from ${JSON.stringify(supervisor)};
    const result = await superviseCommand({
      command: [process.execPath, '-e', ${JSON.stringify(commandSource)}],
      env: process.env, shutdownTimeoutMs: 200,
    });
    console.log('OUTCOME=' + JSON.stringify(result));
    ${extra}
  `);
}

async function assertGone(pid) {
  for (let index = 0; index < 100; index += 1) {
    try { process.kill(pid, 0); } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(10);
  }
  assert.fail(`Owned process ${pid} survived shutdown`);
}

test('stdio preload preserves normal console output', async () => {
  const result = await probe("console.log('healthy stdout'); console.error('healthy stderr');", { preload: true }).completion;
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'healthy stdout\n');
  assert.equal(result.stderr, 'healthy stderr\n');
});

for (const stream of ['stdout', 'stderr']) {
  test(`failed ${stream} exits before a framework logger can recurse`, async () => {
    const result = await probe(`
      process.on('uncaughtException', () => console.error('recursive logger invoked'));
      process.${stream}._write = (_chunk, _encoding, callback) => callback(Object.assign(new Error('lost output'), { code: 'EIO', syscall: 'write' }));
      console.${stream === 'stdout' ? 'log' : 'error'}('synthetic marker');
    `, { preload: true }).completion;
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout + result.stderr, '');
  });
}

for (const [kind, expression] of [
  ['Error', "new Error('ordinary application failure')"],
  ['null', 'null'],
  ['string', "'ordinary application failure'"],
]) {
  test(`stdio preload leaves ordinary ${kind} exceptions with the framework handler`, async () => {
    const result = await probe(`
      process.on('uncaughtException', () => console.log('application handler ran'));
      setImmediate(() => { throw ${expression}; });
    `, { preload: true }).completion;
    assert.equal(result.code, 0);
    assert.equal(result.stdout, 'application handler ran\n');
  });
}

test('supervisor forwards output and preserves command exit status', async () => {
  const result = await commandProbe("console.log('command stdout'); console.error('command stderr'); process.exitCode = 7;").completion;
  assert.equal(result.code, 0);
  assert.match(result.stdout, /command stdout\nOUTCOME={"code":7,"signal":null}/);
  assert.equal(result.stderr, 'command stderr\n');
});

test('command spawn failure releases supervisor listeners and rejects', async () => {
  const result = await probe(`
    import { superviseCommand } from ${JSON.stringify(supervisor)};
    const before = process.listenerCount('SIGHUP');
    try {
      await superviseCommand({ command: ['/ink-owned-missing-command'], env: process.env, shutdownTimeoutMs: 200,
        cleanup: async () => console.log('owned resource stopped'),
      });
      throw new Error('missing command unexpectedly started');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (process.listenerCount('SIGHUP') !== before) throw new Error('signal listener leaked');
    console.log('spawn failure cleaned');
  `).completion;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'owned resource stopped\nspawn failure cleaned\n');
});

const descendant = `
  process.on('SIGTERM', () => {});
  process.on('SIGINT', () => {});
  process.on('SIGHUP', () => {});
  console.log('DESCENDANT_PID=' + process.pid);
  process.send?.('ready');
  setInterval(() => {}, 1000);
`;
const parentWithDescendant = `
  const { spawn } = require('node:child_process');
  console.log('GROUP_PID=' + process.pid);
  spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'inherit' });
  setInterval(() => {}, 1000);
`;

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
  test(`${signal} closes a wrapper and its signal-resistant descendant`, { skip: process.platform === 'win32' }, async () => {
    const running = commandProbe(parentWithDescendant, "process.kill(process.pid, result.signal);");
    await running.waitFor('DESCENDANT_PID=');
    running.child.kill(signal);
    const result = await running.completion;
    assert.equal(result.signal, signal, result.stderr);
    assert.match(result.stdout, new RegExp(`OUTCOME={"code":null,"signal":"${signal}"}`));
    for (const match of result.stdout.matchAll(/(?:GROUP|DESCENDANT)_PID=(\d+)/g)) await assertGone(Number(match[1]));
  });
}

test('parent exit still cleans a surviving descendant', { skip: process.platform === 'win32' }, async () => {
  const result = await commandProbe(`
    const { spawn } = require('node:child_process');
    console.log('GROUP_PID=' + process.pid);
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.once('message', () => process.exit(0));
  `).completion;
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /OUTCOME={"code":0,"signal":null}/);
  const descendants = [...result.stdout.matchAll(/DESCENDANT_PID=(\d+)/g)];
  assert.equal(descendants.length, 1);
  await assertGone(Number(descendants[0][1]));
});

test('lost supervisor output closes its command instead of writing more errors', async () => {
  const result = await probe(`
    import { superviseCommand } from ${JSON.stringify(supervisor)};
    const promise = superviseCommand({
      command: [process.execPath, '-e', 'setInterval(() => {}, 1000);'], env: process.env, shutdownTimeoutMs: 200,
    });
    process.stdout.emit('error', Object.assign(new Error('lost terminal'), { code: 'EIO', syscall: 'write' }));
    console.log('OUTCOME=' + JSON.stringify(await promise));
  `).completion;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'OUTCOME={"code":1,"signal":null}\n');
});

test('output failure during resource cleanup is handled before lifecycle listeners leave', async () => {
  const result = await probe(`
    import { superviseCommand } from ${JSON.stringify(supervisor)};
    const outcome = await superviseCommand({
      command: [process.execPath, '-e', 'process.exit(0);'], env: process.env, shutdownTimeoutMs: 200,
      cleanup: async () => { process.stderr.emit('error', new Error('lost cleanup output')); },
    });
    console.log('OUTCOME=' + JSON.stringify(outcome));
  `).completion;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'OUTCOME={"code":1,"signal":null}\n');
});

test('supervisor shutdown deadline accepts explicit capacity and rejects invalid values', async () => {
  const result = await probe(`
    import { resolveSupervisorShutdownTimeoutMs } from ${JSON.stringify(runtimeConfig)};
    process.env.INK_SUPERVISOR_SHUTDOWN_TIMEOUT_MS = '250';
    if (resolveSupervisorShutdownTimeoutMs() !== 250) throw new Error('configured deadline lost');
    for (const value of ['0', '-1', '1.5', 'invalid', '2147483648']) {
      process.env.INK_SUPERVISOR_SHUTDOWN_TIMEOUT_MS = value;
      try { resolveSupervisorShutdownTimeoutMs(); throw new Error('invalid deadline accepted'); }
      catch (error) { if (!error.message.includes('positive Node timer duration')) throw error; }
    }
    console.log('deadline configuration valid');
  `).completion;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'deadline configuration valid\n');
});
