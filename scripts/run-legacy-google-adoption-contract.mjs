#!/usr/bin/env node

// [Input] Admin Drizzle history and the release-only legacy Google adoption DTO/Service/ORM command.
// [Output] Disposable inspect/dry-run/apply/replay PostgreSQL receipt plus verified cleanup.
// [Pos] Technical contract harness; never targets the configured normal business database.
// [Sync] 2026-09-16: verify invalid CLI modes emit only the fixed redacted JSON error boundary.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

if (process.argv.length !== 2) throw new Error("Usage: node scripts/run-legacy-google-adoption-contract.mjs");
const root = process.cwd();
const temporaryRoot = await mkdtemp(join(tmpdir(), "ink-legacy-google-adoption-contract-"));
const suffix = randomBytes(5).toString("hex");
const databaseName = `ink_auth_data_codex_test_google_${suffix}`;
const postgresPassword = randomBytes(24).toString("base64url");

function capture(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(command, args, { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", value => stdout.push(value));
    child.stderr.on("data", value => stderr.push(value));
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0
      ? resolve(Buffer.concat(stdout).toString("utf8").trim())
      : reject(new Error(`${command} exited with ${code ?? signal}: ${Buffer.concat(stderr).toString("utf8").trim()}`)));
  });
}

function captureFailure(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    const child = spawn(command, args, { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", value => stdout.push(value));
    child.stderr.on("data", value => stderr.push(value));
    child.once("error", reject);
    child.once("exit", (code, signal) => code && !signal
      ? resolve({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") })
      : reject(new Error(`${command} unexpectedly succeeded or terminated by ${signal}`)));
  });
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Unable to reserve PostgreSQL port"));
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

function parseReceipt(output) {
  const start = output.lastIndexOf("{\n");
  if (start < 0) throw new Error("Adoption command did not return JSON");
  return JSON.parse(output.slice(start));
}

let database;
let receipt;
try {
  const invalidMode = await captureFailure("pnpm", ["auth:adopt-legacy-google", "--invalid-mode"], {
    ...process.env,
    AUTH_LEGACY_GOOGLE_ADOPTION_CONFIG: "",
    MIGRATION_DATABASE_URL: "",
  });
  const invalidLine = invalidMode.stderr.trim().split(/\r?\n/).at(-1);
  const invalidReceipt = JSON.parse(invalidLine ?? "null");
  if (JSON.stringify(invalidReceipt) !== JSON.stringify({ ok: false, error: "LEGACY_GOOGLE_ARGUMENTS_INVALID", redacted: true })
    || invalidMode.stderr.includes("    at ") || invalidMode.stdout.includes("LEGACY_GOOGLE_ARGUMENTS_INVALID")) {
    throw new Error("Legacy Google invalid-mode redaction contract failed");
  }
  await capture("pnpm", ["--filter", "@ink-memory/db", "build"]);
  const { startEmbeddedPostgres } = await import("../packages/db/dist/embedded-postgres.js");
  const port = await availablePort();
  database = await startEmbeddedPostgres({
    mode: "embedded-postgres",
    dataDir: join(temporaryRoot, "postgres"),
    port,
    user: "postgres",
    password: postgresPassword,
    database: databaseName,
    sharedBuffers: "32MB",
    maxConnections: 20,
  }, { listenAddresses: "127.0.0.1" });
  const databaseUrl = database.connectionString;
  const environment = {
    ...process.env,
    MIGRATION_DATABASE_URL: databaseUrl,
    AI_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    AI_CREDENTIAL_ENCRYPTION_KEY_ID: `legacy-google-test-${suffix}`,
    AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER: randomBytes(32).toString("base64url"),
  };
  await capture("node", ["scripts/migrate-provider-managed-accounts.mjs"], environment);
  await capture("pnpm", ["--filter", "@ink-memory/db", "migrate"], environment);

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let dataDirectory;
  try {
    const target = (await client.query("SELECT current_database() AS database, current_setting('data_directory') AS data_directory")).rows[0];
    if (target?.database !== databaseName) throw new Error("Isolated adoption database identity mismatch");
    dataDirectory = target.data_directory;
    await client.query(`INSERT INTO public.users
      (id,email,password_hash,display_name,avatar_url,role,status,created_at,updated_at)
      VALUES (7,'person@example.test','$2b$12$preserved','Person',NULL,'user','active',
              '2026-01-01T00:00:00.123456Z','2026-01-02T00:00:00.456789Z')`);
    await client.query(`INSERT INTO public.oauth_accounts
      (id,user_id,provider,provider_sub,email,created_at,updated_at)
      VALUES (1,7,'google','provider-subject-contract-fixture','PERSON@example.test',
              '2026-01-03T00:00:00.111222Z','2026-01-04T00:00:00.333444Z')`);
  } finally {
    await client.end();
  }

  const configPath = join(temporaryRoot, "adoption.json");
  const baseConfig = {
    version: 1,
    target: { database: databaseName, port, data_directory: dataDirectory },
    entry: { canonical_user_id: "7", legacy_google_account_id: "1", evidence: "isolated-provider-sub-contract" },
  };
  await writeFile(configPath, JSON.stringify(baseConfig, null, 2), { mode: 0o600 });
  const commandEnvironment = { ...environment, AUTH_LEGACY_GOOGLE_ADOPTION_CONFIG: configPath };
  const inspection = parseReceipt(await capture("pnpm", ["auth:adopt-legacy-google", "--inspect"], commandEnvironment));
  const reviewedConfig = {
    ...baseConfig,
    entry: {
      ...baseConfig.entry,
      expected_canonical_sha256: inspection.canonical_source_sha256,
      expected_google_sha256: inspection.google_source_sha256,
    },
  };
  await writeFile(configPath, JSON.stringify(reviewedConfig, null, 2), { mode: 0o600 });
  const dryRun = parseReceipt(await capture("pnpm", ["auth:adopt-legacy-google"], commandEnvironment));
  if (dryRun.mode !== "dry-run" || dryRun.action !== "create" || dryRun.dream_subject_created !== false) {
    throw new Error("Legacy Google dry-run contract failed");
  }
  const applied = parseReceipt(await capture("pnpm", ["auth:adopt-legacy-google", "--apply", "--production-approval"], commandEnvironment));
  const replay = parseReceipt(await capture("pnpm", ["auth:adopt-legacy-google", "--apply", "--production-approval"], commandEnvironment));
  if (applied.action !== "create" || !applied.dream_subject_created || replay.action !== "already-complete" || replay.dream_subject_created) {
    throw new Error("Legacy Google apply/replay contract failed");
  }

  const verify = new pg.Client({ connectionString: databaseUrl });
  await verify.connect();
  try {
    const counts = (await verify.query(`SELECT
      (SELECT count(*)::int FROM identity."user") AS users,
      (SELECT count(*)::int FROM identity.account WHERE "providerId"='google') AS google_accounts,
      (SELECT count(*)::int FROM identity.subject_links WHERE canonical_user_id=7) AS dream_links,
      (SELECT count(*)::int FROM identity.admin_subject_links) AS admin_links,
      (SELECT count(*)::int FROM public.admin_audit_logs WHERE action='auth.legacy-google-subject-adopted') AS audits`)).rows[0];
    const mapping = (await verify.query(`SELECT a."accountId" AS provider_subject, s.canonical_user_id::text AS canonical_user_id
      FROM identity.account a JOIN identity.subject_links s ON s.auth_user_id=a."userId"
      WHERE a."providerId"='google'`)).rows[0];
    const legacy = (await verify.query("SELECT count(*)::int AS rows, min(user_id)::text AS canonical_user_id FROM public.oauth_accounts")).rows[0];
    if (JSON.stringify(counts) !== JSON.stringify({ users: 1, google_accounts: 1, dream_links: 1, admin_links: 0, audits: 1 })
      || mapping?.provider_subject !== "provider-subject-contract-fixture" || mapping?.canonical_user_id !== "7"
      || legacy?.rows !== 1 || legacy?.canonical_user_id !== "7") {
      throw new Error("Legacy Google persisted mapping contract failed");
    }
  } finally {
    await verify.end();
  }
  receipt = {
    status: "passed",
    database: databaseName,
    migrations: "Admin Drizzle",
    inspect: "passed",
    dry_run: "passed",
    apply: "passed",
    replay: "already-complete",
    admin_membership_created: false,
    legacy_rows_modified: 0,
    redacted: true,
  };
} finally {
  await database?.stop().catch(() => undefined);
  await rm(temporaryRoot, { recursive: true, force: true });
}
if (receipt) console.log(JSON.stringify({ ...receipt, cleaned: true }));
