#!/usr/bin/env node
// [Input] Exact Admin data DSN/database identity and the Dream confidential client registration.
// [Output] Read-only task-result release readiness; exit 2 lists missing capability, ACL or service scope.
// [Pos] Release gate for an independent task to notify its source Thread after completion.
// [Sync] 2026-09-28: verify 0068 and task-return:dispatch without changing normal database or service config.
import { readFile } from "node:fs/promises";
import pg from "pg";

const databaseUrl = process.env.DREAM_DATA_DATABASE_URL;
const expectedDatabase = process.env.EXPECTED_DATABASE_NAME;
const serviceClientId = process.env.INK_ADMIN_DREAM_SERVICE_CLIENT_ID;
if (!databaseUrl || !expectedDatabase || !serviceClientId ||
  !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(expectedDatabase)) {
  process.stderr.write("DREAM_DATA_DATABASE_URL, EXPECTED_DATABASE_NAME and INK_ADMIN_DREAM_SERVICE_CLIENT_ID are required\n");
  process.exit(1);
}

const contract = JSON.parse(await readFile(new URL("../drizzle/contracts/dream-chat-task-result-v1.json", import.meta.url), "utf8"));
const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  const identity = (await client.query("SELECT current_database() AS name")).rows[0]?.name;
  if (identity !== expectedDatabase) throw new Error("DATABASE_IDENTITY_MISMATCH");
  const missing = [];
  const relationRows = (await client.query(`SELECT n.nspname AS schema, c.relname AS name
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE (n.nspname, c.relname) IN
      (('drizzle', 'schema_capabilities'), ('public', 'chat_task_session'),
       ('public', 'chat_task_result'), ('identity', 'runtime_delegations'))`)).rows;
  const relations = new Set(relationRows.map(row => `${row.schema}.${row.name}`));
  const capability = relations.has("drizzle.schema_capabilities") ? (await client.query(
    "SELECT version, contract_sha256 FROM drizzle.schema_capabilities WHERE capability = $1",
    [contract.capability],
  )).rows[0] : undefined;
  if (capability?.version !== 1 || capability.contract_sha256 !== contract.contract_sha256)
    missing.push(contract.capability);
  if (!["public.chat_task_session", "public.chat_task_result", "identity.runtime_delegations"]
    .every(relation => relations.has(relation))) {
    missing.push("task-result:relations");
  } else {
    const columns = (await client.query(`SELECT n.nspname AS schema, c.relname AS relation, a.attname AS name
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE a.attnum > 0 AND NOT a.attisdropped
        AND ((n.nspname = 'public' AND c.relname = 'chat_task_session' AND a.attname = 'return_result')
          OR (n.nspname = 'identity' AND c.relname = 'runtime_delegations'
            AND a.attname IN ('source_task_result_id', 'source_task_result_claim_id')))`)).rows;
    if (columns.length !== 3) missing.push("task-result:columns");
    const index = (await client.query(`SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
      AND tablename = 'chat_task_result' AND indexname = 'uq_chat_task_result_source_dispatching'`)).rowCount;
    if (index !== 1) missing.push("task-result:single-dispatch-index");
    const access = (await client.query(`SELECT
      has_table_privilege(current_user, 'public.chat_task_result', 'SELECT')
      AND has_table_privilege(current_user, 'public.chat_task_result', 'INSERT')
      AND has_table_privilege(current_user, 'public.chat_task_result', 'UPDATE')
      AND has_table_privilege(current_user, 'public.chat_task_result', 'DELETE') AS result_dml`)).rows[0];
    if (!access.result_dml) missing.push("task-result:data-role-access");
  }
  let configuredClients;
  try { configuredClients = JSON.parse(process.env.DREAM_DATA_SERVICE_CLIENTS ?? ""); }
  catch { configuredClients = null; }
  const registration = Array.isArray(configuredClients)
    ? configuredClients.find(entry => entry && entry.id === serviceClientId) : undefined;
  if (!registration || !Array.isArray(registration.backgroundScopes)
    || !registration.backgroundScopes.includes("task-return:dispatch"))
    missing.push("task-return:dispatch:service-registration");
  await client.query("COMMIT");
  process.stdout.write(`${JSON.stringify({ status: missing.length ? "not_ready" : "ready", database: identity, missing })}\n`);
  if (missing.length) process.exitCode = 2;
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  process.stderr.write(`${error instanceof Error && error.message === "DATABASE_IDENTITY_MISMATCH" ? error.message : "READINESS_CHECK_FAILED"}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
