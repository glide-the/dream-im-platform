#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local", quiet: true });

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

const suffix = randomBytes(6).toString("hex");
const databaseName = `ink_memory_codex_artifact_${suffix}`;
const containerName = `ink-admin-artifact-e2e-${suffix}`;
const postgresPassword = `pg_${randomBytes(24).toString("base64url")}`;
const artifactRoot = await mkdtemp(join(tmpdir(), "ink-admin-artifact-e2e-"));
const bootstrapToken = `artifact_bootstrap_${randomBytes(32).toString("base64url")}`;
let containerStarted = false;

try {
  console.log("Starting one disposable PostgreSQL 16 container...");
  await capture("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "--env",
    "POSTGRES_USER=postgres",
    "--env",
    `POSTGRES_PASSWORD=${postgresPassword}`,
    "--env",
    `POSTGRES_DB=${databaseName}`,
    "--publish",
    "127.0.0.1::5432",
    "postgres:16-alpine",
  ]);
  containerStarted = true;
  const portOutput = await capture("docker", ["port", containerName, "5432/tcp"]);
  const match = portOutput.match(/127\.0\.0\.1:(\d+)/);
  if (!match) throw new Error("Docker did not publish a loopback PostgreSQL port");
  const testUrl = `postgresql://postgres:${encodeURIComponent(postgresPassword)}@127.0.0.1:${match[1]}/${databaseName}`;
  await waitForPostgres(testUrl);

  const env = {
    ...process.env,
    NODE_ENV: "development",
    DATABASE_URL: testUrl,
    INK_USE_TEST_DATABASE_URL: "1",
    TEST_DATABASE_URL: testUrl,
    ADMIN_CONSOLE_ENABLED: "true",
    ADMIN_BOOTSTRAP_TOKEN: bootstrapToken,
    ADMIN_BOOTSTRAP_E2E_TOKEN: bootstrapToken,
    ADMIN_ORIGIN_ALLOWLIST: "http://127.0.0.1:3011",
    ARTIFACT_WORKSPACE_ROOT: artifactRoot,
    ARTIFACT_PREVIEW_MAX_FILE_BYTES: "8388608",
    PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3011",
    PORT: "3011",
  };
  console.log("Applying migrations to the disposable database...");
  await run("pnpm", ["db:migrate"], env);
  console.log("Running the focused Story Artifact Playwright spec...");
  await run(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "tests/e2e/story-artifact-shared-root.spec.ts",
      "--reporter=line",
      "--workers=1",
    ],
    env,
  );
} finally {
  if (containerStarted) {
    console.log("Stopping and removing the disposable PostgreSQL container...");
    await capture("docker", ["stop", "--time", "2", containerName]).catch(() => undefined);
  }
  await rm(artifactRoot, { recursive: true, force: true });
}
