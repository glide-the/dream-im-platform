#!/usr/bin/env node
// [Input] Primary-owned named disposable PostgreSQL fixture and an explicit private rendezvous directory.
// [Output] Serial gate/catalog/identity-lock faults for the separate read-only/API validation runner.
// [Pos] Primary-only destructive fixture controller; reuses the existing cluster and production HTTP harness.
// [Sync] 2026-10-07: restore every catalog fault and stop only this controller's closed-gate transport.
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { importJWK, SignJWT } from "jose";
import pg from "pg";
const [fixturePath, channel] = process.argv.slice(2);
if (!fixturePath || !channel || process.argv.length !== 4) throw Error("Explicit fixture and private channel required");
await mkdir(channel, { mode: 0o700 });
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const pool = new pg.Pool({ connectionString: fixture.adminUrl, max: 3 });
const signature = "identity.lock_active_notion_sync_actor(bigint,text)";
const capability = "dream.notion-sync-ownership.v1";
const ident = value => { if (!/^[a-zA-Z0-9_]+$/.test(value)) throw Error("Unsafe fixture role"); return `"${value}"`; };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, original, owner, cap, lock, stopped = false;
async function restore() {
  if (lock) { await lock.query("ROLLBACK"); lock.release(); lock = undefined; }
  if (!original) return;
  await pool.query(original);
  await pool.query(`ALTER FUNCTION ${signature} OWNER TO ${ident(owner)}`);
  await pool.query(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, ${Object.values(fixture.roles).map(ident).join(",")}`);
  await pool.query(`GRANT EXECUTE ON FUNCTION ${signature} TO ${ident(fixture.roles.data)}`);
  await pool.query("INSERT INTO drizzle.schema_capabilities(capability,version,contract_sha256,adopted_from,applied_at,metadata) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(capability) DO UPDATE SET version=excluded.version,contract_sha256=excluded.contract_sha256,adopted_from=excluded.adopted_from,applied_at=excluded.applied_at,metadata=excluded.metadata", [capability, cap.version, cap.contract_sha256, cap.adopted_from, cap.applied_at, cap.metadata]);
}
async function cleanup() {
  await restore();
  if (child && child.exitCode === null) { child.kill("SIGTERM"); await new Promise(resolve => child.once("exit", resolve)); }
  await pool.end();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  if (stopped) return; stopped = true; await cleanup(); process.exit(1);
});
async function step(index, name, extra = {}, during) {
  await writeFile(join(channel, `ready-${index}.json`), JSON.stringify({ name, ...extra }), { mode: 0o600 });
  await during?.();
  const resultPath = join(channel, `result-${index}.json`);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { await stat(resultPath); const result = JSON.parse(await readFile(resultPath, "utf8"));
      if (result.name !== name || !result.ok) throw Error(`Verifier failed ${name}`);
      console.log(JSON.stringify({ boundary: name, verified: true })); return result;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await pause(50);
  }
  throw Error(`Verifier timeout ${name}`);
}
try {
  const identity = (await pool.query("SELECT current_database() AS name,host(inet_server_addr()) AS address")).rows[0];
  if (identity.name !== fixture.databaseName || !/^ink_notion_sync_ownership_test_[a-f0-9]+$/.test(identity.name) || identity.address !== "127.0.0.1") throw Error("Isolation mismatch");
  const fn = (await pool.query("SELECT pg_get_functiondef($1::regprocedure) AS ddl,proowner::regrole::text AS owner FROM pg_proc WHERE oid=$1::regprocedure", [signature])).rows[0];
  original = fn.ddl; owner = fn.owner;
  cap = (await pool.query("SELECT * FROM drizzle.schema_capabilities WHERE capability=$1", [capability])).rows[0];
  const jwk = (await pool.query('SELECT id,"privateKey" FROM identity.jwks ORDER BY "createdAt" DESC LIMIT 1')).rows[0];
  const key = await importJWK(JSON.parse(jwk.privateKey), "ES256");
  const services = JSON.parse(fixture.env.DREAM_DATA_SERVICE_CLIENTS);
  const sign = (subject, client, scope) => new SignJWT({ client_id: client, scope }).setProtectedHeader({ alg: "ES256", kid: jwk.id, typ: "at+jwt" }).setSubject(subject).setJti(randomUUID()).setIssuer(fixture.env.BETTER_AUTH_URL).setAudience(fixture.env.DREAM_API_RESOURCE).setIssuedAt().setExpirationTime("5m").sign(key);
  fixture.tokens.service = await sign(services[0].id, services[0].id, "connectors:sync capabilities:read");
  fixture.tokens.user = await sign("notion-subject-101", services[0].oauthClientId, "dream:read dream:write");
  const port = await new Promise(resolve => { const server = createServer(); server.listen(0, "127.0.0.1", () => { const value = server.address().port; server.close(() => resolve(value)); }); });
  const closed = { ...fixture, port, env: { ...fixture.env, NOTION_SYNC_OWNERSHIP_CLAIMS_ENABLED: "false" } };
  const closedPath = join(channel, "fixture-closed.json");
  await writeFile(closedPath, JSON.stringify(closed), { mode: 0o600 });
  await writeFile(join(channel, "fixture-verifier.json"), JSON.stringify({ ...fixture, closedPort: port }), { mode: 0o600 });
  child = spawn(process.execPath, ["--import", "tsx", "tests/integration/notionSyncHttpHarness.ts"], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, NOTION_SYNC_VALIDATION_FIXTURE: closedPath } });
  await new Promise((resolve, reject) => { child.stdout.once("data", resolve); child.once("exit", () => reject(Error("Closed-gate harness failed"))); });
  await step(0, "gate-closed-recovery");
  const prepared = await step(1, "lease-prepare");
  lock = await pool.connect(); await lock.query("BEGIN"); await lock.query("SELECT id FROM users WHERE id=101 FOR UPDATE");
  await step(2, "lease-after-actor-lock", { key: prepared.key }, async () => {
    let waiting = false;
    for (let i = 0; i < 40 && !waiting; i++) {
      waiting = (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%lock_active_notion_sync_actor%' AND usename=$1) AS waiting", [fixture.roles.data])).rows[0].waiting;
      if (!waiting) await pause(50);
    }
    if (!waiting) throw Error("Expected actor lock wait was not observed");
    const remaining = (await pool.query("SELECT greatest(0, extract(epoch FROM ($1::timestamptz-clock_timestamp()))*1000)::float AS ms", [prepared.lease_expires_at])).rows[0].ms;
    await pause(remaining + 100); await lock.query("COMMIT"); lock.release(); lock = undefined;
    console.log(JSON.stringify({ actor_lock_wait_observed: true, database_lease_expired_before_release: true }));
  });
  const cases = [
    ["capability-missing", "DELETE FROM drizzle.schema_capabilities WHERE capability=$1", [capability], "DREAM_DATA_SCHEMA_NOT_READY"],
    ["capability-wrong-hash", "UPDATE drizzle.schema_capabilities SET contract_sha256=repeat('0',64) WHERE capability=$1", [capability], "DREAM_DATA_SCHEMA_NOT_READY"],
    ["function-missing", `DROP FUNCTION ${signature}`, [], "NOTION_SYNC_CAPABILITY_UNAVAILABLE"],
    ["function-body-drift", `CREATE OR REPLACE FUNCTION identity.lock_active_notion_sync_actor(canonical_id bigint, subject_id text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$ BEGIN RETURN false; END $$`, [], "NOTION_SYNC_CAPABILITY_UNAVAILABLE"],
    ["function-owner-drift", `ALTER FUNCTION ${signature} OWNER TO ${ident(fixture.roles.data)}`, [], "NOTION_SYNC_CAPABILITY_UNAVAILABLE"],
    ["function-public-execute", `GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC`, [], "NOTION_SYNC_CAPABILITY_UNAVAILABLE"],
    ["function-extra-role-execute", `GRANT EXECUTE ON FUNCTION ${signature} TO ${ident(fixture.roles.auth)}`, [], "NOTION_SYNC_CAPABILITY_UNAVAILABLE"],
    ["function-data-execute-missing", `REVOKE EXECUTE ON FUNCTION ${signature} FROM ${ident(fixture.roles.data)}`, [], "NOTION_SYNC_CAPABILITY_UNAVAILABLE"],
    ["function-data-grant-option", `GRANT EXECUTE ON FUNCTION ${signature} TO ${ident(fixture.roles.data)} WITH GRANT OPTION`, [], "NOTION_SYNC_CAPABILITY_UNAVAILABLE"],
  ];
  for (const [offset, [name, query, parameters, code]] of cases.entries()) {
    await pool.query(query, parameters); await step(offset + 3, name, { code }); await restore();
  }
  await step(12, "restored-readiness");
  console.log(JSON.stringify({ database: fixture.databaseName, boundaries: 13, technical_only: true, restored: true }));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { stopped = true; await cleanup(); }
