// [Input] Private fixture path produced by prepare-gateway-deadlock-postgres.mjs.
// [Output] Focused Image model-center Playwright exit status with fixture secrets kept in child env.
// [Pos] Mechanical isolated E2E runner; fixture creation/cleanup remains owned by the caller.
// [Sync] 2026-10-09: run the provider-free Images public-route and responsive UI acceptance lane.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

const [file] = process.argv.slice(2);
assert(file, "Expected private fixture path");
assert.equal((await stat(file)).mode & 0o777, 0o600);
const fixture = JSON.parse(await readFile(file, "utf8"));
const url = new URL(fixture.uiConnectionString);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, `/${fixture.uiDatabaseName}`);
assert.match(fixture.uiDatabaseName, /^ink_gateway_deadlock_test_[a-f0-9]+_ui$/);

const result = await new Promise((resolve, reject) => {
  const child = spawn("pnpm", [
    "exec", "playwright", "test",
    "--config=tests/e2e/image-model-center.config.ts",
    "--project=chromium", "--reporter=line", "--workers=1",
  ], {
    env: { ...process.env, ...fixture.uiEnv },
    cwd: process.cwd(),
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code) => resolve(code ?? 1));
});
process.exitCode = result;
