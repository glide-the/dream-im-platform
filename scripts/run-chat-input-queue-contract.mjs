#!/usr/bin/env node
// [Input] Candidate Admin Drizzle migrations 0064-0068 and a runner-owned embedded PostgreSQL cluster.
// [Output] Isolated pre-0068 compatibility, then queue/task/result schema and authenticated Route Handler receipts with owned-resource cleanup.
// [Pos] Technical schema validation; never uses normal business database credentials.
// [Sync] 2026-09-28: execute legacy task operations on 0067 before applying 0068 in the same isolated database.
// [Sync] 2026-09-28: verify read-only task-result readiness and authenticated claim/settle through the production Route Handler.
// [Sync] 2026-09-27: verify migration, limited-role ACL upgrade, fresh ACL plan and task-session contracts.
// [Sync] 2026-09-26: verify durable Chat input queue migration identity and structural guards.
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";
import { buildAuthAccessPolicy } from "../drizzle/data/auth-access-policy-plan.mjs";

if (process.argv.length !== 2) throw new Error("Usage: node scripts/run-chat-input-queue-contract.mjs");
const temporaryRoot = await mkdtemp(join(tmpdir(), "ink-chat-input-queue-contract-"));
const suffix = randomBytes(5).toString("hex");
const databaseName = `ink_chat_input_queue_test_${suffix}`;
const password = randomBytes(24).toString("base64url");
const root = process.cwd();

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? signal}`)));
  });
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer(); server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Unable to reserve PostgreSQL port"));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

let database;
try {
  await run("pnpm", ["--filter", "@ink-memory/db", "build"]);
  const { startEmbeddedPostgres } = await import("../packages/db/dist/embedded-postgres.js");
  database = await startEmbeddedPostgres({
    mode: "embedded-postgres", dataDir: join(temporaryRoot, "postgres"), port: await availablePort(),
    user: "postgres", password, database: databaseName, sharedBuffers: "32MB", maxConnections: 24,
  }, { listenAddresses: "127.0.0.1" });
  const url = database.connectionString;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const identity = (await client.query("SELECT current_database() AS db, current_user AS actor")).rows[0];
    if (identity?.db !== databaseName || identity?.actor !== "postgres") throw new Error("Isolated database identity mismatch");
  } finally { await client.end(); }
  try {
    await run("node", ["scripts/check-chat-input-queue-readiness.mjs"], {
      ...process.env, DREAM_DATA_DATABASE_URL: url, EXPECTED_DATABASE_NAME: databaseName,
    });
    throw new Error("Unmigrated database was reported ready");
  } catch (error) {
    if (error?.message !== "node exited with 2") throw error;
  }
  const resultReadinessEnv = {
    ...process.env, DREAM_DATA_DATABASE_URL: url, EXPECTED_DATABASE_NAME: databaseName,
    INK_ADMIN_DREAM_SERVICE_CLIENT_ID: `ink-queue-test-${suffix}`,
    DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([{ id: `ink-queue-test-${suffix}`, backgroundScopes: ["task-return:dispatch"] }]),
  };
  try {
    await run("node", ["scripts/check-chat-task-result-readiness.mjs"], resultReadinessEnv);
    throw new Error("Unmigrated task result database was reported ready");
  } catch (error) {
    if (error?.message !== "node exited with 2") throw error;
  }
  const preResultMigrations = join(temporaryRoot, "migrations-through-0067");
  await mkdir(join(preResultMigrations, "meta"), { recursive: true });
  const journal = JSON.parse(await readFile(join(root, "drizzle/meta/_journal.json"), "utf8"));
  const legacyEntries = journal.entries.slice(0, 68);
  if (legacyEntries.at(-1)?.tag !== "0067_chat_input_queue_acl"
    || journal.entries[68]?.tag !== "0068_cool_psylocke") {
    throw new Error("Task-result migration boundary changed");
  }
  await writeFile(join(preResultMigrations, "meta/_journal.json"),
    JSON.stringify({ ...journal, entries: legacyEntries }));
  for (const entry of legacyEntries) {
    await symlink(join(root, "drizzle", `${entry.tag}.sql`), join(preResultMigrations, `${entry.tag}.sql`));
  }
  await run("node", ["scripts/migrate-provider-managed-accounts.mjs"], {
    ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url, MIGRATION_DATABASE_URL: url,
    INK_MIGRATIONS_DIR: preResultMigrations,
    AI_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    AI_CREDENTIAL_ENCRYPTION_KEY_ID: `chat-queue-test-${suffix}`,
    AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER: randomBytes(32).toString("base64url"),
  });
  await run("pnpm", ["exec", "tsx", "scripts/probe-task-session-pre-result.ts"], {
    ...process.env, DREAM_DATA_DATABASE_URL: url, DREAM_DOMAIN_CANONICAL_TIMEOUT_MS: "5000",
  });
  await run("node", ["packages/db/dist/migrate.js"], {
    ...process.env, MIGRATION_DATABASE_URL: url, INK_MIGRATIONS_DIR: join(root, "drizzle"),
  });
  await run("node", ["scripts/check-chat-input-queue-readiness.mjs"], {
    ...process.env, DREAM_DATA_DATABASE_URL: url, EXPECTED_DATABASE_NAME: databaseName,
  });
  await run("node", ["scripts/check-chat-task-result-readiness.mjs"], resultReadinessEnv);
  try {
    await run("node", ["scripts/check-chat-task-result-readiness.mjs"], {
      ...resultReadinessEnv, DREAM_DATA_SERVICE_CLIENTS: JSON.stringify([{
        id: resultReadinessEnv.INK_ADMIN_DREAM_SERVICE_CLIENT_ID, backgroundScopes: ["capabilities:read"],
      }]),
    });
    throw new Error("Missing task-return scope was reported ready");
  } catch (error) {
    if (error?.message !== "node exited with 2") throw error;
  }
  const aclRole = `ink_queue_data_${suffix}`;
  const aclPassword = randomBytes(24).toString("base64url");
  const aclClient = new pg.Client({ connectionString: url });
  await aclClient.connect();
  try {
    const plan = await buildAuthAccessPolicy(aclClient, databaseName, {
      auth: `ink_auth_${suffix}`, control: `ink_control_${suffix}`,
      data: aclRole, dream: `ink_dream_${suffix}`,
    });
    if (!["chat_input_queue", "chat_task_session", "chat_task_result"].every(table =>
      plan.statements.includes(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.\"${table}\" TO \"${aclRole}\"`))
      || !plan.statements.includes(`GRANT USAGE, SELECT ON SEQUENCE \"public\".\"chat_input_queue_queue_sequence_seq\" TO \"${aclRole}\"`)) {
      throw new Error("Fresh Dream data ACL plan omits the queue contract");
    }
    await aclClient.query(`CREATE ROLE "${aclRole}" LOGIN PASSWORD '${aclPassword}' NOINHERIT`);
    await aclClient.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO "${aclRole}"`);
    await aclClient.query(`GRANT USAGE ON SCHEMA public, drizzle TO "${aclRole}"`);
    await aclClient.query(`GRANT SELECT ON TABLE drizzle.schema_capabilities TO "${aclRole}"`);
    await aclClient.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_thread, public.chat_message TO "${aclRole}"`);
    const limitedUrl = new URL(url);
    limitedUrl.username = aclRole;
    limitedUrl.password = aclPassword;
    const limitedEnv = { ...process.env, DREAM_DATA_DATABASE_URL: limitedUrl.toString(), EXPECTED_DATABASE_NAME: databaseName };
    const limitedResultEnv = { ...resultReadinessEnv, DREAM_DATA_DATABASE_URL: limitedUrl.toString() };
    try {
      await run("node", ["scripts/check-chat-input-queue-readiness.mjs"], limitedEnv);
      throw new Error("Limited role was reported ready before ACL repair");
    } catch (error) {
      if (error?.message !== "node exited with 2") throw error;
    }
    await aclClient.query(await readFile(join(root, "drizzle/0067_chat_input_queue_acl.sql"), "utf8"));
    await run("node", ["scripts/check-chat-input-queue-readiness.mjs"], limitedEnv);
    try {
      await run("node", ["scripts/check-chat-task-result-readiness.mjs"], limitedResultEnv);
      throw new Error("Missing task-result ACL was reported ready");
    } catch (error) {
      if (error?.message !== "node exited with 2") throw error;
    }
    await aclClient.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_task_result TO "${aclRole}"`);
    await run("node", ["scripts/check-chat-task-result-readiness.mjs"], limitedResultEnv);
  } finally { await aclClient.end(); }
  await run("pnpm", ["exec", "tsx", "scripts/probe-chat-input-queue.ts"], {
    ...process.env, DREAM_DATA_DATABASE_URL: url, DREAM_DOMAIN_CANONICAL_TIMEOUT_MS: "5000",
  });
  await run("pnpm", ["exec", "tsx", "scripts/probe-task-result-route.ts"], {
    ...process.env, DREAM_DATA_DATABASE_URL: url, DREAM_DOMAIN_CANONICAL_TIMEOUT_MS: "5000",
  });
  const verified = new pg.Client({ connectionString: url });
  await verified.connect();
  try {
    const identity = (await verified.query("SELECT current_database() AS db")).rows[0]?.db;
    if (identity !== databaseName) throw new Error("Migration target changed unexpectedly");
    const table = (await verified.query("SELECT to_regclass('public.chat_input_queue') AS relation")).rows[0]?.relation;
    const capability = (await verified.query("SELECT version, contract_sha256 FROM drizzle.schema_capabilities WHERE capability = 'dream.chat-input-queue.v1'")).rows[0];
    const taskCapability = (await verified.query("SELECT version, contract_sha256 FROM drizzle.schema_capabilities WHERE capability = 'dream.chat-task-session.v2'")).rows[0];
    const taskTable = (await verified.query("SELECT to_regclass('public.chat_task_session') AS relation")).rows[0]?.relation;
    const resultTable = (await verified.query("SELECT to_regclass('public.chat_task_result') AS relation")).rows[0]?.relation;
    const resultCapability = (await verified.query("SELECT version, contract_sha256 FROM drizzle.schema_capabilities WHERE capability = 'dream.chat-task-result.v1'")).rows[0];
    const resultGuards = (await verified.query("SELECT conname FROM pg_constraint WHERE conrelid = 'public.chat_task_result'::regclass")).rows.map(row => row.conname);
    const dispatchIndex = (await verified.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'chat_task_result' AND indexname = 'uq_chat_task_result_source_dispatching'")).rows[0]?.indexname;
    const guards = (await verified.query("SELECT conname FROM pg_constraint WHERE conrelid = 'public.chat_input_queue'::regclass")).rows.map(row => row.conname);
    if (table !== "chat_input_queue" || capability?.version !== 1
      || capability.contract_sha256 !== "2bb2490d6c8220e9f14a5dd41732d0c60c10d08db5de2bc997aeceeca544a2e1"
      || !["ck_chat_input_queue_status", "ck_chat_input_queue_revision", "fk_chat_input_queue_message", "fk_chat_input_queue_thread", "uq_chat_input_queue_sequence"].every(name => guards.includes(name))
      || taskTable !== "chat_task_session" || taskCapability?.version !== 2
      || taskCapability.contract_sha256 !== "adfe898a136f97293cf80c984d1ad21a69848ab0644489d1a59ac1d3b92f5afe"
      || resultTable !== "chat_task_result" || resultCapability?.version !== 1
      || resultCapability.contract_sha256 !== "9534e484926e69f2f284a4d785b770a5f347d044063a71ab29d08d59d8fa320c"
      || dispatchIndex !== "uq_chat_task_result_source_dispatching"
      || !["uq_chat_task_result_task_turn", "uq_chat_task_result_source_turn", "uq_chat_task_result_claim_request", "ck_chat_task_result_status",
        "ck_chat_task_result_revision", "ck_chat_task_result_claim", "ck_chat_task_result_delivery",
        "fk_chat_task_result_source_input"].every(name => resultGuards.includes(name)))
      throw new Error("Chat input queue migration proof failed");
    process.stdout.write(JSON.stringify({ status: "passed", database: databaseName, table,
      capability: capability.version, task_capability: taskCapability.version,
      result_capability: resultCapability.version, guards: guards.length, result_guards: resultGuards.length }) + "\n");
  } finally { await verified.end(); }
} finally {
  await database?.stop().catch(() => undefined);
  await rm(temporaryRoot, { recursive: true, force: true });
}
