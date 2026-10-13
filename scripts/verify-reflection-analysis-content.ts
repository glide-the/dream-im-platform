// [Input] Generated migration history and installed embedded PostgreSQL binaries.
// [Output] Disposable replay/adoption/drift/repeat/concurrency receipts and an optional private integration fixture.
// [Pos] Explicit technical verification harness; never reads normal database settings or real business data.
// [Sync] 2026-10-13: verify the additive Reflections content capability through the sole production migrator.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import pg from "pg";
import { startEmbeddedPostgres } from "../packages/db/src/embedded-postgres";

const execute = promisify(execFile);
const root = await mkdtemp("/private/tmp/ink-reflection-content-db-");
const suffix = randomBytes(5).toString("hex");
const server = createServer();
const port = await new Promise<number>(resolve => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
await new Promise<void>(resolve => server.close(() => resolve()));
const database = `ink_codex_reflection_content_${suffix}`;
const cluster = await startEmbeddedPostgres({ mode: "embedded-postgres", dataDir: path.join(root, "postgres"), port,
  user: "postgres", password: randomBytes(32).toString("base64url"), database, sharedBuffers: "16MB", maxConnections: 12 }, { listenAddresses: "127.0.0.1" });
const connection = new URL(cluster.connectionString);
const receipts: unknown[] = [];
const dsn = (name: string) => { const url = new URL(connection); url.pathname = `/${name}`; return url.toString(); };
async function clientFor(name: string) { const client = new pg.Client({ connectionString: dsn(name) }); await client.connect(); return client; }
async function identity(name: string) {
  const client = await clientFor(name);
  try {
    const row = (await client.query("SELECT current_database() AS database, current_setting('port') AS port, current_setting('data_directory') AS directory, host(inet_server_addr()) AS host")).rows[0];
    assert.equal(row.database, name); assert.equal(Number(row.port), port); assert.equal(row.directory, path.join(root, "postgres")); assert.equal(row.host, "127.0.0.1");
    receipts.push({ case: "target_identity", ...row });
  } finally { await client.end(); }
}
async function migrate(name: string, args: string[] = [], failure = false) {
  await identity(name);
  const commandArgs = ["pnpm", "exec", "tsx", "packages/db/src/migrate.ts", ...args];
  let code = 0, output = "";
  try { const result = await execute("corepack", commandArgs, { cwd: process.cwd(), env: { ...process.env, MIGRATION_DATABASE_URL: dsn(name) }, maxBuffer: 8 * 1024 * 1024 }); output = result.stdout + result.stderr; }
  catch (error) { const result = error as { code?: number; stdout?: string; stderr?: string }; code = Number(result.code ?? 1); output = (result.stdout ?? "") + (result.stderr ?? ""); }
  // Persist only known contract receipts, never a raw stack, DSN or business body.
  const applied = output.split("\n").filter(line => line.startsWith("Applied migration "));
  receipts.push({ case: "migration", database: name, args, exit_code: code, applied,
    expected_failure: failure, duplicate_column: output.includes('column "analysis_content_json" of relation "reflection_task" already exists') });
  if (failure) { assert.notEqual(code, 0); assert.ok(output.includes('column "analysis_content_json" of relation "reflection_task" already exists')); }
  else assert.equal(code, 0, "Migration failed; raw output intentionally withheld from secret-free receipts.");
  return applied;
}
async function bootstrapProviderHistory(name: string) {
  // Existing historical data gates use their real source CLIs even for an empty cluster.
  for (const [tag, cli] of [
    ["0047_provider_managed_accounts_expand", "provider-managed-accounts-data-cli"],
    ["0049_provider_owned_credentials_expand", "provider-owned-credentials-data-cli"],
    ["0051_provider_deleted_credential_orphans_expand", "provider-deleted-credential-orphans-data-cli"],
  ]) {
    await migrate(name, ["--through", tag]);
    await identity(name);
    const result = await execute("corepack", ["pnpm", "exec", "tsx", `packages/db/src/${cli}.ts`, "--apply"], {
      cwd: process.cwd(), env: { ...process.env, MIGRATION_DATABASE_URL: dsn(name),
        AI_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"), AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER: randomBytes(32).toString("hex") },
    });
    assert.ok(result.stdout.includes('"committed"'));
    receipts.push({ case: "historical_data_gate", database: name, cli, exit_code: 0 });
  }
}
async function createDatabase(name: string) { const client = await clientFor(database); try { await client.query(`CREATE DATABASE "${name}"`); } finally { await client.end(); } }
try {
  await bootstrapProviderHistory(database);
  await migrate(database);
  const verify = await clientFor(database);
  try {
    const column = (await verify.query("SELECT data_type,is_nullable FROM information_schema.columns WHERE table_name='reflection_task' AND column_name='analysis_content_json'")).rows;
    assert.deepEqual(column, [{ data_type: "text", is_nullable: "YES" }]);
    const capability = (await verify.query("SELECT capability,version,contract_sha256 FROM drizzle.schema_capabilities WHERE capability='dream.reflection-analysis-content.v1'")).rows;
    assert.equal(capability.length, 1);
    receipts.push({ case: "physical_capability", column, capability });
  } finally { await verify.end(); }
  assert.equal((await migrate(database)).length, 0);
  const adoption = `${database}_adopt`; await createDatabase(adoption);
  await bootstrapProviderHistory(adoption);
  await migrate(adoption, ["--through", "0080_image_turn_capability"]);
  assert.deepEqual(await migrate(adoption), ["Applied migration 0081_polite_landau"]);
  const concurrent = `${database}_concurrent`; await createDatabase(concurrent);
  await bootstrapProviderHistory(concurrent);
  await migrate(concurrent, ["--through", "0080_image_turn_capability"]);
  const concurrentReceipts = await Promise.all([migrate(concurrent), migrate(concurrent)]);
  assert.equal(concurrentReceipts.flat().length, 1);
  const drift = `${database}_drift`; await createDatabase(drift);
  await bootstrapProviderHistory(drift);
  await migrate(drift, ["--through", "0080_image_turn_capability"]);
  const driftClient = await clientFor(drift);
  let oldCount: number;
  try { oldCount = (await driftClient.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count; await driftClient.query("ALTER TABLE reflection_task ADD COLUMN analysis_content_json integer"); }
  finally { await driftClient.end(); }
  await migrate(drift, [], true);
  const driftCheck = await clientFor(drift);
  try { assert.equal((await driftCheck.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count, oldCount!);
    assert.equal((await driftCheck.query("SELECT count(*)::int AS count FROM drizzle.schema_capabilities WHERE capability='dream.reflection-analysis-content.v1'")).rows[0].count, 0); }
  finally { await driftCheck.end(); }
  receipts.push({ case: "migration_matrix", status: "passed", replay: true, repeat: true, adoption: true, concurrent: true, partial_drift_rollback: true });
  await writeFile(path.resolve("output/reflection-content-migration-receipt.json"), JSON.stringify(receipts, null, 2) + "\n");
  if (process.argv.includes("--integration-fixture")) {
    const seed = await clientFor(database);
    try {
      await seed.query("INSERT INTO users(id,email,password_hash) VALUES (7001,'reflection-fixture@example.test','disabled-fixture'), (7002,'other-fixture@example.test','disabled-fixture')");
      await seed.query(`INSERT INTO identity."user"(id,name,email,"createdAt","updatedAt") VALUES ('fixture-analysis-subject','Fixture user','identity-fixture@example.test',NOW(),NOW())`);
      await seed.query("INSERT INTO identity.subject_links(auth_user_id,canonical_user_id,evidence) VALUES ('fixture-analysis-subject',7001,'isolated-reflection-analysis-fixture')");
      await seed.query("INSERT INTO decks(id,name,owner_id,enabled) VALUES ('fixture-analysis-deck','Reflection perspective',7001,true)");
      await seed.query("INSERT INTO voices(id,deck_id,name,system_prompt,owner_id,enabled) VALUES ('fixture-analysis-agent','fixture-analysis-deck','Pattern observer','Use the selected observer perspective.',7001,true)");
      await seed.query("INSERT INTO user_sessions(id,user_id,name,editor_state_json) VALUES ('fixture-analysis-diary',7001,'Journal','{\"text\":\"I noticed the same worry twice.\"}')");
      const snapshot = { metadata: { workspace_id: 'fixture-workspace', resource_connector_id: '11111111-1111-4111-8111-111111111111', snapshot_version: 'fixture-v1', source_revision: 'fixture-r1', sync_cursor: 'fixture-c1', fetched_at: new Date().toISOString(), state: 'snapshot_ready' }, connector: { selected_pages: ['fixture-analysis-page'], selected_databases: [] }, index: [{ page_id: 'fixture-analysis-page', title: 'Linked journal', url: 'https://www.notion.so/fixture-analysis-page' }], pages: [], databases: [], database_pages: [] };
      await seed.query("INSERT INTO resource_connectors(id,user_id,name,platform,auth_status,current_snapshot_version) VALUES ('11111111-1111-4111-8111-111111111111',7001,'Linked journal','notion','authenticated','fixture-v1')");
      await seed.query("INSERT INTO connector_resources(id,connector_id,resource_type,external_id,title) VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','notion_page','fixture-analysis-page','Linked journal')");
      await seed.query("INSERT INTO connector_snapshots(id,connector_id,snapshot_version,source_revision,sync_cursor,fetched_at,snapshot_json) VALUES ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','fixture-v1','fixture-r1','fixture-c1',NOW(),$1)", [JSON.stringify(snapshot)]);
    } finally { await seed.end(); }
    await writeFile(path.join(root, "integration-private.json"), JSON.stringify({ database_url: dsn(database), database, port, data_directory: path.join(root, "postgres"), workspace_root: path.join(root, "workspaces") }), { mode: 0o600 });
    console.log(JSON.stringify({ status: "integration_fixture_ready", private_manifest: path.join(root, "integration-private.json"), completion_file: path.join(root, "done"), database, port }));
    while (true) { try { await access(path.join(root, "done")); break; } catch { await new Promise(resolve => setTimeout(resolve, 1000)); } }
  }
} finally {
  await cluster.stop(); await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ status: "owned_cluster_cleaned", root }));
}
