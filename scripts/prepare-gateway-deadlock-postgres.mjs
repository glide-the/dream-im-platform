// [Input] The unchanged Drizzle migration entry and a fresh, named, disposable PostgreSQL cluster.
// [Output] Private core/UI fixture manifest; stdin or SIGTERM stops and removes only the owned cluster.
// [Pos] Primary-owned technical setup; never reads or targets normal DATABASE_URL or real model credentials.
// [Sync] 2026-10-02: isolate real-lock regression and public Subscription E2E before normal Gateway acceptance.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { startEmbeddedPostgres } from "../packages/db/src/embedded-postgres.ts";

if (process.argv.length !== 2) throw new Error("Run with node --import tsx scripts/prepare-gateway-deadlock-postgres.mjs");
const suffix = randomBytes(6).toString("hex");
const databaseName = `ink_gateway_deadlock_test_${suffix}`;
const uiDatabaseName = `${databaseName}_ui`;
const ownedRoot = await mkdtemp(join(tmpdir(), "ink-gateway-deadlock-test-"));
const dataDir = join(ownedRoot, "postgres");
const manifestPath = join(ownedRoot, "fixture.json");
let database;

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function migrate(connectionString) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/migrate-provider-managed-accounts.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, MIGRATION_DATABASE_URL: connectionString, INK_MIGRATIONS_DIR: join(process.cwd(), "drizzle"), AI_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex") },
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Owned migration exited ${code}`)));
  });
}

try {
  database = await startEmbeddedPostgres({
    mode: "embedded-postgres", dataDir, port: await availablePort(),
    user: "postgres", password: randomBytes(24).toString("base64url"),
    database: databaseName, sharedBuffers: "32MB", maxConnections: 30,
  }, { listenAddresses: "127.0.0.1" });
  const client = new pg.Client({ connectionString: database.connectionString });
  await client.connect();
  try {
    const topology = await client.query("SELECT current_database() AS name, current_setting('data_directory') AS dir, current_setting('listen_addresses') AS listen");
    assert.equal(topology.rows[0].name, databaseName);
    assert.equal(topology.rows[0].dir, dataDir);
    assert.equal(topology.rows[0].listen, "127.0.0.1");
    await client.query(`ALTER DATABASE "${databaseName}" SET timezone TO 'UTC'`);
    await client.query(`CREATE DATABASE "${uiDatabaseName}"`);
    await client.query(`ALTER DATABASE "${uiDatabaseName}" SET timezone TO 'UTC'`);
  } finally { await client.end(); }
  const uiUrl = new URL(database.connectionString);
  uiUrl.pathname = `/${uiDatabaseName}`;
  await migrate(database.connectionString);
  await migrate(uiUrl.toString());
  const ui = new pg.Client({ connectionString: uiUrl.toString() });
  await ui.connect();
  try {
    await ui.query(`INSERT INTO users (id, email, password_hash, display_name, role)
      VALUES (101, 'creator@example.test', 'isolated-fixture', 'Creator E2E', 'user'),
             (102, 'other@example.test', 'isolated-fixture', 'Other E2E', 'user')`);
  } finally { await ui.end(); }
  const appPort = await availablePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const fixture = {
    databaseName, uiDatabaseName, connectionString: database.connectionString,
    uiConnectionString: uiUrl.toString(), dataDir,
    uiEnv: {
      NODE_ENV: "development", TEST_DATABASE_URL: uiUrl.toString(), INK_USE_TEST_DATABASE_URL: "1",
      DATABASE_URL: uiUrl.toString(), MIGRATION_DATABASE_URL: uiUrl.toString(),
      AUTH_DATABASE_URL: uiUrl.toString(), ADMIN_CONTROL_DATABASE_URL: uiUrl.toString(),
      DREAM_DATA_DATABASE_URL: uiUrl.toString(),
      BETTER_AUTH_URL: `${baseUrl}/api/auth`, BETTER_AUTH_SECRET: randomBytes(48).toString("base64url"),
      AUTH_TRUSTED_ORIGINS: baseUrl, DREAM_API_RESOURCE: `${baseUrl}/api/internal/dream`,
      GOOGLE_CLIENT_ID: "isolated-google-client", GOOGLE_CLIENT_SECRET: "isolated-google-secret",
      ADMIN_CONSOLE_ENABLED: "true", ADMIN_SESSION_SECRET: randomBytes(48).toString("base64url"),
      ADMIN_BOOTSTRAP_E2E_TOKEN: randomBytes(32).toString("base64url"),
      ADMIN_ORIGIN_ALLOWLIST: baseUrl, GATEWAY_API_KEY_PEPPER: randomBytes(32).toString("base64url"),
      AI_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
      AI_PROVIDER_ALLOW_INSECURE_LOCALHOST: "true", AI_PROVIDER_HOST_ALLOWLIST: "127.0.0.1,localhost",
      PLAYWRIGHT_BASE_URL: baseUrl, PLAYWRIGHT_BROWSER_CHANNEL: "chrome",
      INK_ADMIN_E2E_DIST_DIR: `.next-e2e-deadlock-${suffix}`, PORT: String(appPort),
    },
  };
  fixture.uiEnv.ADMIN_BOOTSTRAP_TOKEN = fixture.uiEnv.ADMIN_BOOTSTRAP_E2E_TOKEN;
  await writeFile(manifestPath, JSON.stringify(fixture), { mode: 0o600 });
  console.log(JSON.stringify({ ready: true, databaseName, uiDatabaseName, manifestPath }));
  await new Promise(resolve => {
    process.stdin.once("data", resolve);
    process.once("SIGTERM", resolve);
    process.once("SIGINT", resolve);
    process.stdin.resume();
  });
} finally {
  process.stdin.pause();
  if (database) await database.stop();
  await rm(ownedRoot, { recursive: true, force: true });
  console.log(JSON.stringify({ cleanup: "owned PostgreSQL cluster and private fixture removed" }));
}
