#!/usr/bin/env node
// [Input] Current Admin migrations, scheduled Chat integration test, and a runner-owned embedded PostgreSQL cluster.
// [Output] Reproducible task-session separation and scheduled trigger lifecycle evidence with owned-resource cleanup.
// [Pos] Technical contract runner; it never reads or mutates the normal business database.
// [Sync] 2026-09-29: add an identity-checked runner for scheduled TaskSession link separation and lifecycle regression.
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";

if (process.argv.length !== 2) throw new Error("Usage: node scripts/run-chat-scheduled-task-contract.mjs");
const root = process.cwd();
const temporaryRoot = await mkdtemp(join(tmpdir(), "ink-scheduled-chat-contract-"));
const suffix = randomBytes(5).toString("hex");
const databaseName = `ink_scheduled_chat_test_contract_${suffix}`;
const password = randomBytes(24).toString("base64url");

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with ${code ?? signal}`)));
  });
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("PORT_RESERVATION_FAILED"));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

let database;
try {
  await run("pnpm", ["--filter", "@ink-memory/db", "build"]);
  const { startEmbeddedPostgres } = await import("../packages/db/dist/embedded-postgres.js");
  database = await startEmbeddedPostgres({
    mode: "embedded-postgres",
    dataDir: join(temporaryRoot, "postgres"),
    port: await availablePort(),
    user: "postgres",
    password,
    database: databaseName,
    sharedBuffers: "32MB",
    maxConnections: 24,
  }, { listenAddresses: "127.0.0.1" });
  const databaseUrl = database.connectionString;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const identity = (await client.query("SELECT current_database() AS db, current_user AS actor")).rows[0];
    if (identity?.db !== databaseName || identity?.actor !== "postgres") {
      throw new Error("ISOLATED_DATABASE_IDENTITY_MISMATCH");
    }
    process.stdout.write(`isolated_database=${identity.db} actor=${identity.actor}\n`);
  } finally {
    await client.end();
  }
  await run("node", ["scripts/migrate-provider-managed-accounts.mjs"], {
    ...process.env,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: databaseUrl,
    AI_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    AI_CREDENTIAL_ENCRYPTION_KEY_ID: `scheduled-contract-${suffix}`,
    AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER: randomBytes(32).toString("base64url"),
  });
  await run("pnpm", ["exec", "vitest", "run", "app/lib/dream/chatScheduledTaskPostgres.integration.test.ts"], {
    ...process.env,
    SCHEDULED_CHAT_TEST_DATABASE_URL: databaseUrl,
    SCHEDULED_CHAT_TEST_OWNED: "1",
  });
  process.stdout.write(`scheduled_chat_contract=passed database=${databaseName}\n`);
} finally {
  if (database) await database.stop().catch(() => undefined);
  await rm(temporaryRoot, { recursive: true, force: true });
}
