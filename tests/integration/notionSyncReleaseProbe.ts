// [Input] Primary-prepared private fault rendezvous and synthetic OAuth/service fixture.
// [Output] Public production-route gate/drift/receipt/actor-lock assertions and read-only readiness receipts.
// [Pos] Luna-only deterministic verifier; no SQL mutations, migrations, credentials issuance or service lifecycle.
// [Sync] 2026-10-07: confirm lease checks occur after actor lock and faults cannot authorize any execution.
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const channel = process.env.NOTION_SYNC_BOUNDARY_CHANNEL;
if (!channel) throw Error("Explicit primary-prepared channel required");
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function wait(path: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) { try { await stat(path); return JSON.parse(await readFile(path, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } await pause(50); }
  throw Error("Primary fixture timeout");
}
const fixture = await wait(join(channel, "fixture-verifier.json"));
if (!/^ink_notion_sync_ownership_test_[a-f0-9]+$/.test(fixture.databaseName)) throw Error("Isolation mismatch");
const open = `http://127.0.0.1:${fixture.port}`, closed = `http://127.0.0.1:${fixture.closedPort}`;
let id: string, receiptId: string;
async function post(base: string, operation: string, input: unknown, user = false, requestId: string = randomUUID()) {
  const response = await fetch(`${base}/api/internal/dream/v1/operations/${operation}`, { method: "POST", headers: {
    "content-type": "application/json", authorization: `Bearer ${user ? fixture.tokens.user : fixture.tokens.service}`,
    ...(user ? { "x-ink-dream-service-authorization": `Bearer ${fixture.tokens.service}` } : {}),
  }, body: JSON.stringify({ request_id: requestId, input }) });
  return { status: response.status, body: await response.json() };
}
function accepted(value: Awaited<ReturnType<typeof post>>) { assert.equal(value.status, 200, value.body.error?.code); return value.body.data; }
async function create() {
  const value = accepted(await post(open, "notion.connector.create", { authority: null, name: "Owned release probe", platform: "notion", config: {} }, true));
  const connectorId = value.connector.id;
  accepted(await post(open, "notion.auth-state.save", { authority: null, connector_id: connectorId, auth_status: "authenticated", config_patch: {} }, true));
  accepted(await post(open, "notion.resources.replace", { authority: null, connector_id: connectorId, databases: [{ external_id: "database-A", title: "A", metadata: {} }], pages: [] }, true));
  return connectorId;
}
function readiness(code?: string, gate = true) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/check-notion-sync-readiness.ts"], { encoding: "utf8", env: { ...process.env, ...fixture.env, EXPECTED_DATABASE_NAME: fixture.databaseName, NOTION_SYNC_OWNERSHIP_CLAIMS_ENABLED: String(gate) } });
  assert.equal(result.status, code ? 2 : 0); const receipt = JSON.parse(result.stdout.trim());
  if (code) assert.equal(receipt.code, code); else assert.equal(receipt.actor_lock, "ready");
}
for (let index = 0; index < 13; index++) {
  const step = await wait(join(channel, `ready-${index}.json`));
  try {
    let extra = {};
    if (index === 0) {
      readiness(); readiness("NOTION_SYNC_CLAIMS_DISABLED", false);
      id = await create(); const input = { connector_id: id, worker_id: randomUUID() }; const claimId = randomUUID();
      const claimed = accepted(await post(open, "notion.sync-run.claim", input, false, claimId));
      const rejected = await post(closed, "notion.sync-run.claim", input); assert.equal(rejected.status, 503); assert.equal(rejected.body.error.code, "NOTION_SYNC_CLAIMS_DISABLED");
      assert.deepEqual(accepted(await post(closed, "notion.sync-run.claim", input, false, claimId)), claimed);
      const key = { connector_id: id, worker_id: claimed.run.worker_id, run_id: claimed.run.run_id, fence_epoch: claimed.run.fence_epoch };
      accepted(await post(closed, "notion.sync-run.renew", key));
      receiptId = randomUUID(); const finish = { ...key, outcome: { status: "cancelled", error_code: "NOTION_SYNC_CANCELLED" } };
      const result = accepted(await post(closed, "notion.sync-run.finish", finish, false, receiptId));
      assert.deepEqual(accepted(await post(closed, "notion.sync-run.finish", finish, false, receiptId)), result);
    } else if (index === 1) {
      const connectorId = await create(); const claimed = accepted(await post(open, "notion.sync-run.claim", { connector_id: connectorId, worker_id: randomUUID() }));
      extra = { key: { connector_id: connectorId, worker_id: claimed.run.worker_id, run_id: claimed.run.run_id, fence_epoch: claimed.run.fence_epoch }, lease_expires_at: claimed.run.lease_expires_at };
    } else if (index === 2) {
      const result = await post(open, "notion.sync-run.renew", step.key); assert.equal(result.status, 409); assert.equal(result.body.error.code, "NOTION_SYNC_LEASE_EXPIRED");
    } else if (index < 12) {
      readiness(step.code);
      const result = await post(open, "notion.sync-run.claim", { connector_id: id!, worker_id: randomUUID() }); assert.equal(result.status, 503); assert.equal(result.body.error.code, step.code);
      const recovered = await fetch(`${open}/api/internal/dream/v1/receipts/${receiptId!}?operation=notion.sync-run.finish&connector_id=${id!}`, { headers: { authorization: `Bearer ${fixture.tokens.service}` } });
      assert.equal(recovered.status, 503); assert.equal((await recovered.json()).error.code, step.code);
    } else {
      readiness(); const response = await fetch(`${open}/api/internal/dream/v1/receipts/${receiptId!}?operation=notion.sync-run.finish&connector_id=${id!}`, { headers: { authorization: `Bearer ${fixture.tokens.service}` } });
      assert.equal(response.status, 200); assert.equal((await response.json()).data.status, "committed");
    }
    await writeFile(join(channel, `result-${index}.json`), JSON.stringify({ name: step.name, ok: true, ...extra }), { mode: 0o600 });
    console.log(JSON.stringify({ boundary: step.name, passed: true }));
  } catch (error) { await writeFile(join(channel, `result-${index}.json`), JSON.stringify({ name: step.name, ok: false }), { mode: 0o600 }); throw error; }
}
console.log(JSON.stringify({ boundaries: 13, passed: true, database: fixture.databaseName, technical_only: true }));
