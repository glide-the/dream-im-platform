#!/usr/bin/env node

// [Input] Repository embedded PostgreSQL, OpenSSL, Node env-proxy support, local Chrome, and production entry points.
// [Output] Disposable migration, post-connect catalog failure/retry/idempotent reuse, two owned Copilot accounts, Gateway routing, and Provider deletion proof.
// [Pos] Owned configured managed-auth E2E runner; no production module receives a test-only branch or transport override.
// [Sync] 2026-09-04: route all managed product model endpoints through the strict TLS fake and prove Copilot auto-sync recovery.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";

import { startProviderManagedAuthHarness } from "../tests/e2e/provider-managed-auth-harness.mjs";

const MAX_APP_LOG_BYTES = 2 * 1024 * 1024;
const MAX_MANUAL_REVIEW_HOLD_SECONDS = 300;

function manualReviewHoldSeconds() {
  const raw = process.env.INK_MANAGED_AUTH_E2E_HOLD_SECONDS?.trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > MAX_MANUAL_REVIEW_HOLD_SECONDS) {
    throw new Error(
      `INK_MANAGED_AUTH_E2E_HOLD_SECONDS must be an integer from 1 to ${MAX_MANUAL_REVIEW_HOLD_SECONDS}`,
    );
  }
  return seconds;
}

function run(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

function capture(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise(stdout.trim());
      else reject(Object.assign(
        new Error(`${command} exited with ${code ?? signal}: ${stderr.trim()}`),
        { stdout, stderr, exitCode: code },
      ));
    });
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Failed to allocate an E2E port");
  await new Promise((resolvePromise) => server.close(resolvePromise));
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
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
  }
  throw new Error("Disposable PostgreSQL did not become ready within 60 seconds");
}

async function waitForApplication(baseUrl, child) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Managed-auth application process exited before becoming ready");
    }
    try {
      const response = await fetch(`${baseUrl}/admin`, {
        redirect: "manual",
        signal: AbortSignal.timeout(1_500),
      });
      if (response.status >= 200 && response.status < 500) return;
    } catch {
      // The owned application is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error("Managed-auth application did not become ready within 120 seconds");
}

function appendBounded(current, chunk) {
  const next = current + String(chunk);
  return next.length <= MAX_APP_LOG_BYTES ? next : next.slice(-MAX_APP_LOG_BYTES);
}

function redact(value, sentinels) {
  return sentinels.reduce(
    (current, secret) => secret ? current.split(secret).join("[REDACTED]") : current,
    value,
  );
}

async function stopOwnedProcess(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000)),
  ]);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

function cleanInheritedEnvironment() {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith("INK_PROVIDER_")
      || ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS"].includes(key)
    ) {
      delete environment[key];
    }
  }
  return environment;
}

async function createCertificates(directory) {
  const caKeyPath = join(directory, "ca-key.pem");
  const caPath = join(directory, "ca.pem");
  const serverKeyPath = join(directory, "server-key.pem");
  const requestPath = join(directory, "server.csr");
  const certPath = join(directory, "server.pem");
  const extensionsPath = join(directory, "server.ext");
  await writeFile(extensionsPath, [
    "basicConstraints=CA:FALSE",
    "keyUsage=digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth",
    "subjectAltName=DNS:chatgpt.com,DNS:api.x.ai,DNS:github.com,DNS:api.github.com,DNS:api.githubcopilot.com,DNS:managed-auth-proxy-probe.invalid",
    "",
  ].join("\n"), { mode: 0o600 });
  await capture("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "1",
    "-subj", "/CN=Ink Managed Auth E2E CA",
    "-keyout", caKeyPath,
    "-out", caPath,
  ]);
  await capture("openssl", [
    "req", "-newkey", "rsa:2048", "-sha256", "-nodes",
    "-subj", "/CN=github.com",
    "-keyout", serverKeyPath,
    "-out", requestPath,
  ]);
  await capture("openssl", [
    "x509", "-req", "-sha256", "-days", "1",
    "-in", requestPath,
    "-CA", caPath,
    "-CAkey", caKeyPath,
    "-CAcreateserial",
    "-extfile", extensionsPath,
    "-out", certPath,
  ]);
  await Promise.all([chmod(caKeyPath, 0o600), chmod(serverKeyPath, 0o600)]);
  return { caPath, certPath, keyPath: serverKeyPath };
}

async function assertProxyInjection({ caPath, proxyUrl, probeUrl }) {
  if (!process.allowedNodeEnvironmentFlags.has("--use-env-proxy")) {
    throw new Error("Configured managed-auth E2E requires Node env-proxy support; use the repository Node 24 lane");
  }
  const environment = cleanInheritedEnvironment();
  environment.NODE_OPTIONS = `${environment.NODE_OPTIONS ?? ""} --use-env-proxy`.trim();
  environment.HTTPS_PROXY = proxyUrl;
  environment.NO_PROXY = "127.0.0.1,localhost";
  environment.NODE_EXTRA_CA_CERTS = caPath;
  const script = [
    `const response = await fetch(${JSON.stringify(probeUrl)}, { signal: AbortSignal.timeout(5000) });`,
    `if (response.status !== 204) throw new Error("proxy probe status " + response.status);`,
  ].join("\n");
  await capture(process.execPath, ["--input-type=module", "-e", script], environment);
}

async function scanDatabaseForSecrets(connectionString, sentinels) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const tables = await client.query(
      `SELECT tablename
         FROM pg_catalog.pg_tables
        WHERE schemaname = 'public'
        ORDER BY tablename`,
    );
    for (const { tablename } of tables.rows) {
      if (!/^[a-z0-9_]+$/.test(tablename)) throw new Error("Unsafe table name returned by PostgreSQL");
      const rows = await client.query(`SELECT row_to_json(candidate)::text AS value FROM ${tablename} AS candidate`);
      for (const row of rows.rows) {
        for (const secret of sentinels) {
          if (String(row.value).includes(secret)) {
            throw new Error(`Managed-auth Secret appeared in plaintext in ${tablename}`);
          }
        }
      }
    }
  } finally {
    await client.end();
  }
}

function validateFakeState(state) {
  if (state.errors.length > 0) {
    throw new Error(`Fake upstream contract failures: ${state.errors.join("; ")}`);
  }
  if (state.accounts.length !== 2) {
    throw new Error(`Expected two Copilot Device grants, observed ${state.accounts.length}`);
  }
  for (const account of state.accounts) {
    if (account.pollCount < 2 || account.identityCount !== 1 || account.copilotExchangeCount !== 1) {
      throw new Error(`Incomplete protocol lifecycle for ${account.key}`);
    }
  }
  const resourceAccounts = new Set(state.resourceCalls.map((call) => call.accountKey));
  if (!resourceAccounts.has("account-1") || !resourceAccounts.has("account-2")) {
    throw new Error("Gateway did not prove both Provider-owned Copilot account resolutions");
  }
  const expectedResolution = new Map([
    ["copilot-account-one-upstream", "account-1"],
    ["copilot-account-two-upstream", "account-2"],
  ]);
  if (state.resourceCalls.length !== expectedResolution.size) {
    throw new Error(`Expected two Gateway resource calls, observed ${state.resourceCalls.length}`);
  }
  for (const call of state.resourceCalls) {
    if (call.stream || expectedResolution.get(call.model) !== call.accountKey) {
      throw new Error(`Unexpected Gateway account resolution for ${call.model ?? "missing-model"}`);
    }
  }
  const catalogCalls = state.modelCalls.filter((call) => call.product === "github_copilot");
  const catalogAccounts = catalogCalls.map((call) => call.accountKey);
  if (
    catalogCalls.length !== 6
    || catalogAccounts.filter((account) => account === "account-1").length !== 4
    || catalogAccounts.filter((account) => account === "account-2").length !== 2
    || (state.catalogFailuresRemaining.get("account-1") ?? 0) !== 0
  ) {
    throw new Error(`Unexpected Copilot catalog lifecycle: ${JSON.stringify(catalogCalls)}`);
  }
}

const suffix = randomBytes(6).toString("hex");
const databaseName = `ink_memory_managed_auth_${suffix}_test`;
const postgresPassword = `pg_${randomBytes(24).toString("base64url")}`;
const bootstrapToken = `bootstrap_${randomBytes(32).toString("base64url")}`;
const sessionSecret = `session_${randomBytes(48).toString("base64url")}`;
const gatewayPepper = `gateway_${randomBytes(48).toString("base64url")}`;
const encryptionKey = randomBytes(32).toString("hex");
const identityPepper = randomBytes(32).toString("hex");
const clientId = "Iv1.b507a08c87ecfe98";
const distDir = `.next-e2e-managed-auth-${suffix}`;
const temporaryRoot = await mkdtemp(join(tmpdir(), "ink-managed-auth-e2e-"));
const outputRoot = join(temporaryRoot, "playwright-output");
const holdSeconds = manualReviewHoldSeconds();

let database;
let harness;
let application;
let applicationStdout = "";
let applicationStderr = "";

try {
  await run("python3", [".agents/skills/ink-admin-playwright-qa/scripts/preflight.py"]);
  const certificates = await createCertificates(temporaryRoot);
  harness = await startProviderManagedAuthHarness({
    certPath: certificates.certPath,
    keyPath: certificates.keyPath,
    clientId,
  });
  await assertProxyInjection({
    caPath: certificates.caPath,
    proxyUrl: harness.proxyUrl,
    probeUrl: harness.probeUrl,
  });

  console.log("Building and starting a runner-owned embedded PostgreSQL cluster...");
  await run("pnpm", ["--filter", "@ink-memory/db", "build"], cleanInheritedEnvironment());
  const { startEmbeddedPostgres } = await import(
    "../packages/db/dist/embedded-postgres.js"
  );
  const databasePort = await availablePort();
  database = await startEmbeddedPostgres({
    mode: "embedded-postgres",
    dataDir: join(temporaryRoot, "postgres"),
    port: databasePort,
    user: "postgres",
    password: postgresPassword,
    database: databaseName,
    sharedBuffers: "32MB",
    maxConnections: 24,
  });
  const databaseUrl = database.connectionString;
  await waitForPostgres(databaseUrl);

  const appPort = await availablePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const commonEnvironment = cleanInheritedEnvironment();
  Object.assign(commonEnvironment, {
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    INK_USE_TEST_DATABASE_URL: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    AI_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
    AI_CREDENTIAL_ENCRYPTION_KEY_ID: `e2e-${suffix}`,
    AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER: identityPepper,
  });

  console.log("Preparing a legacy 0046 prefix in the named disposable managed-auth database...");
  await run("pnpm", [
    "--filter", "@ink-memory/db", "migrate",
    "--through", "0046_lovely_hemingway",
  ], commonEnvironment);
  const legacyClient = new pg.Client({ connectionString: databaseUrl });
  await legacyClient.connect();
  try {
    await legacyClient.query(
      `INSERT INTO ai_providers (
         id, code, name, protocol, adapter_kind, active_credential_kind,
         credential_validation_status, status, config
       ) VALUES (
         'provider-managed-cutover-fixture', 'managed-cutover-fixture',
         'Managed Cutover Fixture', 'openai', 'xai', 'none',
         'unverified', 'disabled', '{}'::jsonb
       )`,
    );
  } finally {
    await legacyClient.end();
  }
  const blockedMigration = await capture("pnpm", [
    "--filter", "@ink-memory/db", "migrate",
  ], commonEnvironment)
    .then(() => null, (error) => error);
  const blockedOutput = `${blockedMigration?.stdout ?? ""}\n${blockedMigration?.stderr ?? ""}`;
  if (
    !blockedMigration
    || !blockedOutput.includes("No migration from this invocation was committed")
    || !blockedOutput.includes("Run the Provider migration orchestrator")
    || blockedOutput.includes("pg/lib/client.js")
  ) {
    throw new Error("Full migration did not return the safe Provider account recovery instruction");
  }
  const rollbackClient = new pg.Client({ connectionString: databaseUrl });
  await rollbackClient.connect();
  try {
    const rollbackProof = await rollbackClient.query(
      `SELECT
         count(*)::integer AS migration_count,
         to_regclass('public.ai_provider_managed_account_defaults')::text AS expanded_table
       FROM drizzle.__drizzle_migrations`,
    );
    if (
      rollbackProof.rows[0]?.migration_count !== 47
      || rollbackProof.rows[0]?.expanded_table !== null
    ) {
      throw new Error("Blocked 0048 migration did not roll the 0047 transaction back cleanly");
    }
  } finally {
    await rollbackClient.end();
  }
  console.log("Running the root Provider-aware migration workflow...");
  await run("pnpm", ["db:migrate"], commonEnvironment);

  const applicationEnvironment = {
    ...commonEnvironment,
    ADMIN_CONSOLE_ENABLED: "true",
    ADMIN_SESSION_SECRET: sessionSecret,
    ADMIN_BOOTSTRAP_TOKEN: bootstrapToken,
    ADMIN_ORIGIN_ALLOWLIST: baseUrl,
    GATEWAY_API_KEY_PEPPER: gatewayPepper,
    AI_CREDENTIAL_ENCRYPTION_KEY: encryptionKey,
    AI_CREDENTIAL_ENCRYPTION_KEY_ID: `e2e-${suffix}`,
    AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER: identityPepper,
    PORT: String(appPort),
    INK_ADMIN_E2E_DIST_DIR: distDir,
    NODE_OPTIONS: `${commonEnvironment.NODE_OPTIONS ?? ""} --use-env-proxy`.trim(),
    HTTPS_PROXY: harness.proxyUrl,
    NO_PROXY: "127.0.0.1,localhost",
    NODE_EXTRA_CA_CERTS: certificates.caPath,
    INK_PROVIDER_GITHUB_COPILOT_DEVICE_AUTHORIZATION_ENDPOINT: "https://github.com/__ink_e2e__/login/device/code",
    INK_PROVIDER_GITHUB_COPILOT_TOKEN_ENDPOINT: "https://github.com/__ink_e2e__/login/oauth/access_token",
    INK_PROVIDER_GITHUB_COPILOT_IDENTITY_ENDPOINT: "https://api.github.com/__ink_e2e__/user",
    INK_PROVIDER_GITHUB_COPILOT_COPILOT_TOKEN_ENDPOINT: "https://api.github.com/__ink_e2e__/copilot_internal/v2/token",
    INK_PROVIDER_GITHUB_COPILOT_REVOKE_ENDPOINT: "https://api.github.com/__ink_e2e__/applications",
    INK_PROVIDER_GITHUB_COPILOT_RESOURCE_ENDPOINT: "https://api.githubcopilot.com/__ink_e2e__/chat/completions",
    INK_PROVIDER_CODEX_MODELS_ENDPOINT: "https://chatgpt.com/__ink_e2e__/backend-api/codex/models",
    INK_PROVIDER_XAI_MODELS_ENDPOINT: "https://api.x.ai/__ink_e2e__/v1/models",
    INK_PROVIDER_GITHUB_COPILOT_MODELS_ENDPOINT: "https://api.githubcopilot.com/__ink_e2e__/models",
  };

  application = spawn("pnpm", ["run", "dev:app"], {
    cwd: process.cwd(),
    env: applicationEnvironment,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  application.stdout.on("data", (chunk) => { applicationStdout = appendBounded(applicationStdout, chunk); });
  application.stderr.on("data", (chunk) => { applicationStderr = appendBounded(applicationStderr, chunk); });
  await new Promise((resolvePromise, reject) => {
    application.once("spawn", resolvePromise);
    application.once("error", reject);
  });
  await waitForApplication(baseUrl, application);

  const playwrightEnvironment = cleanInheritedEnvironment();
  Object.assign(playwrightEnvironment, {
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    INK_USE_TEST_DATABASE_URL: "1",
    ADMIN_BOOTSTRAP_E2E_TOKEN: bootstrapToken,
    PLAYWRIGHT_BASE_URL: baseUrl,
    PLAYWRIGHT_BROWSER_CHANNEL: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome",
    INK_MANAGED_AUTH_CONFIGURED_E2E: "github_copilot",
  });
  console.log("Running configured GitHub Copilot managed-auth E2E...");
  await run("pnpm", [
    "exec", "playwright", "test",
    "tests/e2e/provider-managed-auth-configured.spec.ts",
    "--config", "scripts/playwright-provider-managed-auth.config.ts",
    "--project=chromium",
    "--reporter=line",
    "--workers=1",
    `--output=${outputRoot}`,
  ], playwrightEnvironment);
  console.log("Running dependency-gated Provider deletion E2E...");
  await run("pnpm", [
    "exec", "playwright", "test",
    "tests/e2e/provider-delete-dependencies.spec.ts",
    "--config", "scripts/playwright-provider-managed-auth.config.ts",
    "--project=chromium",
    "--reporter=line",
    "--workers=1",
    `--output=${outputRoot}`,
  ], playwrightEnvironment);

  const sentinels = harness.secretSentinels();
  validateFakeState(harness.state);
  await scanDatabaseForSecrets(databaseUrl, sentinels);
  for (const secret of sentinels) {
    if (applicationStdout.includes(secret) || applicationStderr.includes(secret)) {
      throw new Error("Managed-auth Secret appeared in application output");
    }
  }
  console.log(JSON.stringify({
    accountsConnected: harness.state.accounts.length,
    resourceAccounts: [...new Set(harness.state.resourceCalls.map((call) => call.accountKey))],
    catalogCalls: harness.state.modelCalls.length,
    deniedNonOfficialConnects: harness.state.deniedConnects.length,
    database: databaseName,
    secretLeakage: false,
  }));
  if (holdSeconds > 0) {
    console.log(`Manual Chrome review ready at ${baseUrl}/admin for ${holdSeconds} seconds.`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, holdSeconds * 1_000));
  }
} catch (error) {
  const sentinels = harness?.secretSentinels() ?? [];
  const stdoutTail = redact(applicationStdout.slice(-4_000), sentinels);
  const stderrTail = redact(applicationStderr.slice(-4_000), sentinels);
  if (stdoutTail) console.error(`Managed-auth app stdout tail:\n${stdoutTail}`);
  if (stderrTail) console.error(`Managed-auth app stderr tail:\n${stderrTail}`);
  throw error;
} finally {
  await stopOwnedProcess(application);
  if (harness) await harness.close();
  if (database) await database.stop().catch(() => undefined);
  await rm(resolve(process.cwd(), distDir), { recursive: true, force: true });
  await rm(temporaryRoot, { recursive: true, force: true });
}
