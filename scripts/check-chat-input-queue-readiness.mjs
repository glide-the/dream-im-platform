#!/usr/bin/env node
// [Input] Explicit Dream data PostgreSQL URL, expected database name, and Admin queue/task capability contracts.
// [Output] Read-only readiness receipt; exits 2 when schema or current data-role privileges are missing.
// [Pos] Release preflight for the Chat input queue and task-session feature.
// [Sync] 2026-09-27: catch missing migration or queue ACL before calling the Dream UI ready.
import { readFile } from "node:fs/promises";
import pg from "pg";

const databaseUrl = process.env.DREAM_DATA_DATABASE_URL;
const expectedDatabase = process.env.EXPECTED_DATABASE_NAME;
if (!databaseUrl || !expectedDatabase || !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(expectedDatabase)) {
  process.stderr.write("DREAM_DATA_DATABASE_URL and EXPECTED_DATABASE_NAME are required\n");
  process.exit(1);
}

const contracts = await Promise.all([
  "dream-chat-input-queue-v1.json",
  "dream-chat-task-session-v2.json",
].map(async name => JSON.parse(await readFile(new URL(`../drizzle/contracts/${name}`, import.meta.url), "utf8"))));

const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
try {
  await client.connect();
  const identity = (await client.query("SELECT current_database() AS name")).rows[0]?.name;
  if (identity !== expectedDatabase) throw new Error("DATABASE_IDENTITY_MISMATCH");
  const relations = (await client.query(
    "SELECT to_regclass('drizzle.schema_capabilities') AS registry, to_regclass('public.chat_input_queue') AS queue, to_regclass('public.chat_task_session') AS task",
  )).rows[0];
  const published = relations.registry
    ? (await client.query(
      "SELECT capability, version, contract_sha256 FROM drizzle.schema_capabilities WHERE capability = ANY($1::text[])",
      [contracts.map(contract => contract.capability)],
    )).rows
    : [];
  const capabilities = new Map(published.map(row => [row.capability, row]));
  const missing = contracts.flatMap((contract, index) => {
    const relation = index === 0 ? relations.queue : relations.task;
    const capability = capabilities.get(contract.capability);
    const expectedVersion = index === 0 ? 1 : 2;
    return relation && capability?.version === expectedVersion
      && capability.contract_sha256 === contract.contract_sha256 ? [] : [contract.capability];
  });
  if (missing.length === 0) {
    const access = (await client.query(`SELECT
      has_table_privilege(current_user, 'public.chat_input_queue', 'SELECT')
        AND has_table_privilege(current_user, 'public.chat_input_queue', 'INSERT')
        AND has_table_privilege(current_user, 'public.chat_input_queue', 'UPDATE')
        AND has_table_privilege(current_user, 'public.chat_input_queue', 'DELETE') AS queue_dml,
      has_table_privilege(current_user, 'public.chat_task_session', 'SELECT')
        AND has_table_privilege(current_user, 'public.chat_task_session', 'INSERT')
        AND has_table_privilege(current_user, 'public.chat_task_session', 'UPDATE')
        AND has_table_privilege(current_user, 'public.chat_task_session', 'DELETE') AS task_dml,
      has_sequence_privilege(current_user, 'public.chat_input_queue_queue_sequence_seq', 'USAGE')
        AND has_sequence_privilege(current_user, 'public.chat_input_queue_queue_sequence_seq', 'SELECT') AS queue_sequence`)).rows[0];
    if (!access.queue_dml) missing.push("public.chat_input_queue:access");
    if (!access.task_dml) missing.push("public.chat_task_session:access");
    if (!access.queue_sequence) missing.push("public.chat_input_queue_queue_sequence_seq:access");
  }
  process.stdout.write(`${JSON.stringify({ status: missing.length ? "not_ready" : "ready", database: identity, missing })}\n`);
  if (missing.length) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${error instanceof Error && error.message === "DATABASE_IDENTITY_MISMATCH" ? error.message : "READINESS_CHECK_FAILED"}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
