// [Input] Runner-owned loopback PostgreSQL, Registry107 service and restricted SELECT-only DATA role.
// [Output] Owner/Run/Thread/workspace scope, capability denial and unchanged-row evidence.
// [Pos] Provider-free managed MCP scope contract; MCP loading and Runtime remain outside this harness.
// [Sync] 2026-09-15: prove one typed Drizzle read UOW without physical selectors or writes.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { AuthBoundaryError } from "../../app/lib/auth/config";
import { withDataTransaction } from "../../app/lib/dream/database";
import { workflowManagedMcpScopeOperationContracts } from "../../app/lib/dream/workflowManagedMcpScopeDto";
import { runWorkflowManagedMcpScopeOperation, workflowManagedMcpScopeSchemaRequirements } from "../../app/lib/dream/workflowManagedMcpScopeService";
import { startEmbeddedPostgres, type RunningEmbeddedPostgres } from "../../packages/db/src/embedded-postgres";

async function availablePort() {
  const server = createServer(); await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Unable to reserve isolated port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); return address.port;
}
async function expectFailure(action: () => Promise<unknown>, code: string, status: number) {
  let caught: unknown; try { await action(); } catch (error) { caught = error; }
  assert(caught instanceof AuthBoundaryError); assert.equal(caught.code, code); assert.equal(caught.status, status);
}

const suffix = randomBytes(6).toString("hex"), database = `ink_auth_data_codex_test_mcp_scope_${suffix}`;
const ownedRoot = await mkdtemp(join(tmpdir(), "ink-auth-data-mcp-scope-"));
let embedded: RunningEmbeddedPostgres | undefined, pool: pg.Pool | undefined, evidence: Record<string, unknown> | undefined;
try {
  embedded = await startEmbeddedPostgres({ mode: "embedded-postgres", dataDir: join(ownedRoot, "postgres"), port: await availablePort(), user: "postgres",
    password: `pg_${randomBytes(24).toString("base64url")}`, database, sharedBuffers: "24MB", maxConnections: 10 }, { listenAddresses: "127.0.0.1" });
  const setup = new pg.Client({ connectionString: embedded.connectionString }); await setup.connect();
  try {
    await setup.query(`
      REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE SCHEMA drizzle; REVOKE ALL ON SCHEMA drizzle FROM PUBLIC;
      CREATE TABLE drizzle.schema_capabilities (capability text PRIMARY KEY, version integer NOT NULL, contract_sha256 text NOT NULL);
      CREATE TABLE story_workspace_workspaces (id text PRIMARY KEY, owner_id bigint NOT NULL);
      CREATE TABLE workflow_runs (id text PRIMARY KEY, workspace_id text NOT NULL, source_voice_thread_id text, created_by text NOT NULL);
      REVOKE ALL ON story_workspace_workspaces, workflow_runs, drizzle.schema_capabilities FROM PUBLIC;
    `);
    const topology = (await setup.query("SELECT current_database() AS database, host(inet_server_addr()) AS address, current_setting('listen_addresses') AS listen")).rows[0];
    assert.deepEqual(topology, { database, address: "127.0.0.1", listen: "127.0.0.1" });
    const actorId = "9007199254740993", run = `run_${"a".repeat(32)}`;
    await setup.query("INSERT INTO story_workspace_workspaces VALUES ('workspace-owned',$1),('workspace-foreign',7)", [actorId]);
    await setup.query("INSERT INTO workflow_runs VALUES ($1,'workspace-owned','thread-owned',$2),($3,'workspace-foreign','thread-foreign','7'),($4,'workspace-foreign','thread-bad-workspace',$2)", [run, actorId, `run_${"b".repeat(32)}`, `run_${"c".repeat(32)}`]);
    const role = `mcp_scope_data_${suffix}`, password = `rp_${randomBytes(24).toString("base64url")}`;
    await setup.query("CREATE ROLE " + role + " LOGIN PASSWORD '" + password + "'");
    await setup.query("GRANT USAGE ON SCHEMA public, drizzle TO " + role);
    await setup.query("GRANT SELECT ON story_workspace_workspaces, workflow_runs, drizzle.schema_capabilities TO " + role);
    const privilege = (await setup.query(`SELECT has_schema_privilege($1,'public','CREATE') AS public_create,
      has_table_privilege($1,'public.workflow_runs','SELECT') AS run_select,
      has_table_privilege($1,'public.workflow_runs','INSERT') AS run_insert,
      has_table_privilege($1,'public.story_workspace_workspaces','UPDATE') AS workspace_update`, [role])).rows[0];
    assert.deepEqual(privilege, { public_create: false, run_select: true, run_insert: false, workspace_update: false });
    const limitedUrl = new URL(embedded.connectionString); limitedUrl.username = role; limitedUrl.password = password;
    pool = new pg.Pool({ connectionString: limitedUrl.toString(), max: 3 }); const db = drizzle(pool);
    const actor = (id = actorId, threadScope: string | null = null, runScope: string | null = null, scopes = ["dream:read"]) => ({
      principal: { subject: "scope-subject", canonical_user_id: id, client_id: "dream", scopes, status: "active" as const }, threadScope, runScope,
    });
    const execute = (input: unknown, current = actor()) => withDataTransaction(workflowManagedMcpScopeSchemaRequirements,
      tx => runWorkflowManagedMcpScopeOperation("workflow-managed-mcp-scope.resolve", input, current, tx), db);
    const input = { thread_id: "thread-owned", workflow_run_id: run };
    await expectFailure(() => execute(input), "DREAM_DATA_SCHEMA_NOT_READY", 503);
    for (const requirement of workflowManagedMcpScopeSchemaRequirements) await setup.query(
      "INSERT INTO drizzle.schema_capabilities VALUES ($1,$2,$3)", [requirement.capability, requirement.version, requirement.contractSha256]);
    const before = (await setup.query("SELECT (SELECT count(*)::int FROM workflow_runs) AS runs, (SELECT count(*)::int FROM story_workspace_workspaces) AS workspaces")).rows;
    assert.deepEqual(await execute(input), { ...input, workspace_id: "workspace-owned" });
    await expectFailure(() => execute(input, actor("7")), "WORKFLOW_RUN_NOT_FOUND", 404);
    await expectFailure(() => execute({ thread_id: "thread-foreign", workflow_run_id: `run_${"b".repeat(32)}` }), "WORKFLOW_RUN_NOT_FOUND", 404);
    await expectFailure(() => execute({ thread_id: "thread-bad-workspace", workflow_run_id: `run_${"c".repeat(32)}` }), "WORKFLOW_RUN_NOT_FOUND", 404);
    await expectFailure(() => execute(input, actor(actorId, "other", run)), "DREAM_DELEGATION_ENTITY_DENIED", 403);
    await expectFailure(() => execute(input, actor(actorId, "thread-owned", `run_${"d".repeat(32)}`)), "DREAM_DELEGATION_ENTITY_DENIED", 403);
    await expectFailure(() => execute(input, actor(actorId, null, null, [])), "DREAM_SCOPE_REQUIRED", 403);
    for (const key of ["actor_id", "user_id", "workspace_id", "table", "column", "sql", "path", "runtime_node_id"])
      assert.equal(workflowManagedMcpScopeOperationContracts["workflow-managed-mcp-scope.resolve"].input.safeParse({ ...input, [key]: "external" }).success, false, `rejects ${key}`);
    assert.deepEqual((await setup.query("SELECT (SELECT count(*)::int FROM workflow_runs) AS runs, (SELECT count(*)::int FROM story_workspace_workspaces) AS workspaces")).rows, before);
    evidence = { result: "PASS", target: "runner-owned-named-disposable-postgresql", database_prefix: "ink_auth_data_codex_test_mcp_scope_",
      listen_addresses: topology.listen, server_address: topology.address, restricted_select_role: true, owner_run_thread_workspace_filter: true,
      capability_scope_entity_denials: true, closed_selectors: true, no_receipt_or_write: true, unchanged_row_counts: true };
  } finally { await pool?.end(); await setup.end(); }
} finally { await embedded?.stop().catch(() => undefined); await rm(ownedRoot, { recursive: true, force: true }); }
if (!evidence) throw new Error("Managed MCP scope evidence was not produced");
console.log(JSON.stringify({ ...evidence, owned_cluster_removed: true }));
