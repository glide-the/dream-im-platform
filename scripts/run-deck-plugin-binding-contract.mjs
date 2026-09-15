#!/usr/bin/env node
// [Input] Admin Drizzle history and isolated Registry122-129 binding/Runtime PostgreSQL integration test.
// [Output] Disposable named database, restricted-role ORM/CAS/materialization evidence and cleanup.
// [Pos] Technical verification harness; never targets the configured normal business database.
// [Sync] 2026-09-16: verify evidence-bound Agent-type Runtime preparation transactions.
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";

if (process.argv.length !== 2) throw new Error("Usage: node scripts/run-deck-plugin-binding-contract.mjs");
const root = process.cwd();
const temporaryRoot = await mkdtemp(join(tmpdir(), "ink-deck-plugin-binding-contract-"));
const suffix = randomBytes(5).toString("hex");
const databaseName = `ink_deck_plugin_binding_test_${suffix}`;
const postgresPassword = randomBytes(24).toString("base64url");
const executorPassword = randomBytes(24).toString("base64url");

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
let receipt;
try {
  await run("pnpm", ["--filter", "@ink-memory/db", "build"]);
  const { startEmbeddedPostgres } = await import("../packages/db/dist/embedded-postgres.js");
  const port = await availablePort();
  database = await startEmbeddedPostgres({ mode: "embedded-postgres", dataDir: join(temporaryRoot, "postgres"), port,
    user: "postgres", password: postgresPassword, database: databaseName, sharedBuffers: "32MB", maxConnections: 24 },
    { listenAddresses: "127.0.0.1" });
  const adminUrl = database.connectionString;
  await run("node", ["scripts/migrate-provider-managed-accounts.mjs"], {
    ...process.env, MIGRATION_DATABASE_URL: adminUrl,
    AI_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    AI_CREDENTIAL_ENCRYPTION_KEY_ID: `deck-binding-test-${suffix}`,
    AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER: randomBytes(32).toString("base64url"),
  });
  const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect();
  try {
    const identity = await admin.query("SELECT current_database() AS database, current_user AS actor");
    if (identity.rows[0]?.database !== databaseName || identity.rows[0]?.actor !== "postgres")
      throw new Error("Isolated PostgreSQL identity check failed");
    if (!/^[A-Za-z0-9_-]+$/.test(executorPassword)) throw new Error("Generated executor secret is invalid");
    await admin.query(`CREATE ROLE ink_deck_plugin_binding_executor LOGIN PASSWORD '${executorPassword}'`);
    await admin.query(`GRANT CONNECT ON DATABASE ${databaseName} TO ink_deck_plugin_binding_executor`);
    await admin.query("GRANT USAGE ON SCHEMA public, dream TO ink_deck_plugin_binding_executor");
    await admin.query(`GRANT SELECT ON story_workspace_workspaces, decks, deck_plugin_releases,
      deck_runtime_plugin_locks, deck_plugin_installations, runtime_plugin_materializations,
      claude_plugin_installations, deck_plugin_bindings TO ink_deck_plugin_binding_executor`);
    // PostgreSQL row locks used for a stable selection snapshot require UPDATE
    // privilege even though these compatibility repositories never mutate rows.
    await admin.query(`GRANT UPDATE ON story_workspace_workspaces, deck_plugin_releases,
      deck_runtime_plugin_locks, deck_plugin_installations, runtime_plugin_materializations,
      claude_plugin_installations
      TO ink_deck_plugin_binding_executor`);
    await admin.query("GRANT INSERT, UPDATE ON deck_plugin_bindings TO ink_deck_plugin_binding_executor");
    await admin.query("GRANT INSERT, UPDATE ON deck_plugin_installations, runtime_plugin_materializations TO ink_deck_plugin_binding_executor");
    await admin.query("GRANT UPDATE (draft_revision, updated_at) ON decks TO ink_deck_plugin_binding_executor");
  } finally { await admin.end(); }
  const restricted = new URL(adminUrl);
  restricted.username = "ink_deck_plugin_binding_executor"; restricted.password = executorPassword;
  await run("pnpm", ["exec", "vitest", "run", "app/lib/dream/deckPluginBindingPostgres.integration.test.ts"], {
    ...process.env,
    DECK_PLUGIN_BINDING_TEST_ADMIN_URL: adminUrl,
    DECK_PLUGIN_BINDING_TEST_DATABASE_URL: restricted.toString(),
    DREAM_DOMAIN_CANONICAL_TIMEOUT_MS: "5000",
    INK_DECK_HOST_COMPATIBLE: "true",
    INK_CLAUDE_AGENT_CONTRACT_COMPATIBLE: "true",
    INK_STORY_SCHEMA_COMPATIBLE: "true",
    INK_DECK_RUNTIME_CONFIG_COMPATIBLE: "true",
  });
  receipt = { status: "passed", database: databaseName,
    executor: "ink_deck_plugin_binding_executor", migration_source: "Admin Drizzle" };
} finally {
  await database?.stop().catch(() => undefined);
  await rm(temporaryRoot, { recursive: true, force: true });
}
if (receipt) console.log(JSON.stringify({ ...receipt, cleaned: true }));
