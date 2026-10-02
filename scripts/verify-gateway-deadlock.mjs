// [Input] An explicit private fixture created by the primary-owned PostgreSQL setup and core/ui stage.
// [Output] Bounded production-function regression or existing public-route Playwright evidence.
// [Pos] Mechanical validation runner; migrations, real-user/model acceptance and cluster cleanup belong to the primary.
// [Sync] 2026-10-02: keep fixture credentials in child environment and never print connection strings.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";

const [file, stage] = process.argv.slice(2);
assert(file && ["core", "ui"].includes(stage), "Expected private fixture path and core/ui stage");
assert.equal((await stat(file)).mode & 0o777, 0o600);
const fixture = JSON.parse(await readFile(file, "utf8"));
for (const [value, name] of [[fixture.connectionString, fixture.databaseName], [fixture.uiConnectionString, fixture.uiDatabaseName]]) {
  const url = new URL(value);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.pathname, `/${name}`);
  assert.match(name, /^ink_gateway_deadlock_test_[a-f0-9]+(?:_ui)?$/);
}
const args = stage === "core"
  ? ["exec", "vitest", "run", "app/lib/gateway/deadlock.integration.test.ts"]
  : ["exec", "playwright", "test", "--config=tests/e2e/gateway-deadlock.config.ts", "--project=chromium", "--reporter=line", "--workers=1"];
const env = stage === "core"
  ? { ...process.env, NODE_ENV: "test", INK_GATEWAY_DEADLOCK_FIXTURE: file }
  : { ...process.env, ...fixture.uiEnv };
const result = await new Promise((resolve, reject) => {
  const child = spawn("pnpm", args, { env, cwd: process.cwd(), stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", code => resolve(code ?? 1));
});
process.exitCode = result;
