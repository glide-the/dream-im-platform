#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${command} exited with ${code ?? signal}: ${stderr.trim()}`));
    });
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to allocate an E2E port");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForPostgres(connectionString) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 1_000 });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch {
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Disposable PostgreSQL did not become ready within 60 seconds");
}

async function provisionCanonicalUsers(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (id, email, password_hash, display_name, role)
       VALUES
         (101, 'creator@example.test', 'fixture-password-hash-not-a-credential', 'Creator E2E', 'user'),
         (102, 'other@example.test', 'fixture-password-hash-not-a-credential', 'Other E2E', 'user')`,
    );
    const projection = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM users) AS users,
         (SELECT count(*)::integer FROM platform_users) AS platform_users,
         (SELECT count(*)::integer FROM billing_accounts) AS billing_accounts`,
    );
    const row = projection.rows[0];
    if (row.users !== 2 || row.platform_users !== 2 || row.billing_accounts !== 2) {
      throw new Error("Canonical Billing identity projection was not one-to-one");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function verifyTokenSettlement(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT
         (SELECT count(*)::integer FROM gateway_requests) AS gateway_requests,
         (SELECT count(*)::integer FROM gateway_requests WHERE outcome = 'succeeded') AS succeeded,
         (SELECT count(*)::integer FROM gateway_requests WHERE outcome = 'failed') AS failed,
         (SELECT count(*)::integer FROM subscription_token_ledger_entries) AS ledger_entries,
         (SELECT count(*)::integer FROM (
            SELECT gateway_request_id
              FROM subscription_token_ledger_entries
             GROUP BY gateway_request_id
            HAVING COALESCE(sum(amount_tokens) FILTER (WHERE entry_type = 'reserve'), 0)
                 <> COALESCE(sum(amount_tokens) FILTER (WHERE entry_type = 'capture'), 0)
                  + COALESCE(sum(amount_tokens) FILTER (WHERE entry_type = 'release'), 0)
          ) AS mismatch) AS conservation_mismatches,
         (SELECT COALESCE(sum(reserved_tokens), 0)::bigint FROM subscription_usage_allowances) AS reserved_tokens`,
    );
    const row = result.rows[0];
    if (
      row.gateway_requests !== 4
      || row.succeeded !== 2
      || row.failed !== 2
      || row.ledger_entries !== 6
      || row.conservation_mismatches !== 0
      || BigInt(row.reserved_tokens) !== 0n
    ) {
      throw new Error("Subscription Token settlement evidence is incomplete");
    }
    console.log(JSON.stringify({
      gatewayRequests: row.gateway_requests,
      succeeded: row.succeeded,
      failed: row.failed,
      ledgerEntries: row.ledger_entries,
      conservationMismatches: row.conservation_mismatches,
      reservedTokens: String(row.reserved_tokens),
    }));
  } finally {
    await client.end();
  }
}

const suffix = randomBytes(6).toString("hex");
const databaseName = `ink_memory_codex_subscription_${suffix}_test`;
const containerName = `ink-admin-subscription-e2e-${suffix}`;
const postgresPassword = `pg_${randomBytes(24).toString("base64url")}`;
const bootstrapToken = `bootstrap_${randomBytes(32).toString("base64url")}`;
const distDir = `.next-e2e-subscription-${suffix}`;
const outputRoot = await mkdtemp(join(tmpdir(), "ink-admin-subscription-e2e-"));
let containerStarted = false;

try {
  await capture("docker", [
    "run", "--detach", "--rm", "--name", containerName,
    "--env", "POSTGRES_USER=postgres",
    "--env", `POSTGRES_PASSWORD=${postgresPassword}`,
    "--env", `POSTGRES_DB=${databaseName}`,
    "--publish", "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);
  containerStarted = true;
  const portOutput = await capture("docker", ["port", containerName, "5432/tcp"]);
  const match = portOutput.match(/127\.0\.0\.1:(\d+)/);
  if (!match) throw new Error("Docker did not publish a loopback PostgreSQL port");
  const databaseUrl = `postgresql://postgres:${encodeURIComponent(postgresPassword)}@127.0.0.1:${match[1]}/${databaseName}`;
  await waitForPostgres(databaseUrl);
  const appPort = await availablePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const env = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    INK_USE_TEST_DATABASE_URL: "1",
    ADMIN_CONSOLE_ENABLED: "true",
    ADMIN_SESSION_SECRET: `session_${randomBytes(48).toString("base64url")}`,
    ADMIN_BOOTSTRAP_TOKEN: bootstrapToken,
    ADMIN_BOOTSTRAP_E2E_TOKEN: bootstrapToken,
    ADMIN_ORIGIN_ALLOWLIST: baseUrl,
    GATEWAY_API_KEY_PEPPER: `pepper_${randomBytes(48).toString("base64url")}`,
    AI_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    AI_PROVIDER_ALLOW_INSECURE_LOCALHOST: "true",
    AI_PROVIDER_HOST_ALLOWLIST: "127.0.0.1,localhost",
    PLAYWRIGHT_BASE_URL: baseUrl,
    PORT: String(appPort),
    INK_ADMIN_E2E_DIST_DIR: distDir,
  };

  console.log("Applying Admin migrations to a disposable PostgreSQL database...");
  await run("pnpm", ["db:migrate"], env);
  await provisionCanonicalUsers(databaseUrl);
  console.log("Running the isolated Subscription/Token Chromium E2E...");
  await run("pnpm", [
    "exec", "playwright", "test",
    "tests/e2e/subscription-billing-postgres.spec.ts",
    "--project=chromium", "--reporter=line", "--workers=1",
    `--output=${outputRoot}`,
  ], env);
  await verifyTokenSettlement(databaseUrl);
} finally {
  if (containerStarted) {
    await capture("docker", ["stop", "--time", "2", containerName]).catch(() => undefined);
  }
  await rm(distDir, { recursive: true, force: true });
  await rm(outputRoot, { recursive: true, force: true });
}
