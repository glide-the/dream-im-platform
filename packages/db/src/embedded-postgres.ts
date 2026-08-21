// [Input] Validated embedded database config and packaged PostgreSQL native binaries.
// [Output] A persistent PostgreSQL cluster lifecycle with private-network access.
// [Pos] Infrastructure runtime owned by @ink-memory/db; it never applies business DDL.
// [Sync] 2026-08-21: add Paperclip-style embedded PostgreSQL initialization and supervision.
import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { prepareEmbeddedPostgresNativeRuntime } from "./embedded-postgres-native.js";
import {
  postgresConnectionString,
  type EmbeddedPostgresConfig,
} from "./runtime-config.js";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresConstructor = new (options: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  authMethod: string;
  persistent: boolean;
  initdbFlags: string[];
  postgresFlags: string[];
  onLog: (message: unknown) => void;
  onError: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

async function pathExists(value: string): Promise<boolean> {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}

async function removeStalePostmasterPid(dataDir: string): Promise<void> {
  const pidFile = path.join(dataDir, "postmaster.pid");
  if (!(await pathExists(pidFile))) return;
  const pid = Number((await readFile(pidFile, "utf8")).split("\n")[0]?.trim());
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      throw new Error(`Embedded PostgreSQL data directory is already owned by running PID ${pid}.`);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH")) {
        throw error;
      }
    }
  }
  await rm(pidFile, { force: true });
}

async function ensurePrivateNetworkHba(dataDir: string): Promise<void> {
  const hbaPath = path.join(dataDir, "pg_hba.conf");
  const marker = "# ink-memory-private-network";
  const current = await readFile(hbaPath, "utf8");
  if (current.includes(marker)) return;
  await appendFile(
    hbaPath,
    `\n${marker}\nhost all all all scram-sha-256\n`,
    "utf8",
  );
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function ensureDatabase(config: EmbeddedPostgresConfig): Promise<void> {
  const client = new pg.Client({
    connectionString: postgresConnectionString(config, "postgres"),
  });
  await client.connect();
  try {
    const result = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [config.database]);
    if (result.rowCount === 0) {
      await client.query(`CREATE DATABASE ${quoteIdentifier(config.database)}`);
    }
  } finally {
    await client.end();
  }
}

export type RunningEmbeddedPostgres = {
  connectionString: string;
  stop(): Promise<void>;
};

export async function startEmbeddedPostgres(
  config: EmbeddedPostgresConfig,
): Promise<RunningEmbeddedPostgres> {
  if (config.mode !== "embedded-postgres") {
    throw new Error("Embedded PostgreSQL startup requires INK_DATABASE_MODE=embedded-postgres.");
  }
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    throw new Error("Embedded PostgreSQL must run as a non-root user.");
  }
  await mkdir(config.dataDir, { recursive: true });
  await prepareEmbeddedPostgresNativeRuntime();
  const embeddedPostgresModule = await import("embedded-postgres");
  const EmbeddedPostgres = embeddedPostgresModule.default as EmbeddedPostgresConstructor;
  const instance = new EmbeddedPostgres({
    databaseDir: config.dataDir,
    user: config.user,
    password: config.password,
    port: config.port,
    authMethod: "scram-sha-256",
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
    postgresFlags: [
      "-c", "listen_addresses=0.0.0.0",
      "-c", `shared_buffers=${config.sharedBuffers}`,
      "-c", `max_connections=${config.maxConnections}`,
    ],
    onLog: (message) => process.stdout.write(`[embedded-postgres] ${String(message)}`),
    onError: (message) => process.stderr.write(`[embedded-postgres] ${String(message)}\n`),
  });
  const versionFile = path.join(config.dataDir, "PG_VERSION");
  if (!(await pathExists(versionFile))) await instance.initialise();
  await ensurePrivateNetworkHba(config.dataDir);
  await removeStalePostmasterPid(config.dataDir);
  await instance.start();
  try {
    await ensureDatabase(config);
  } catch (error) {
    await instance.stop().catch(() => undefined);
    throw error;
  }
  return {
    connectionString: postgresConnectionString(config),
    stop: () => instance.stop(),
  };
}
