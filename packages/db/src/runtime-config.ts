// [Input] Explicit database topology variables and optional local migration env.
// [Output] Validated embedded PostgreSQL settings and connection strings.
// [Pos] Configuration boundary for the @ink-memory/db runtime package.
// [Sync] 2026-08-21: add explicit embedded-postgres topology without environment-name branching.
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type DatabaseMode = "embedded-postgres" | "postgres";

export type EmbeddedPostgresConfig = {
  mode: DatabaseMode;
  dataDir: string;
  port: number;
  user: string;
  password: string;
  database: string;
  sharedBuffers: string;
  maxConnections: number;
};

function requiredValue(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback?.trim();
  if (!value) throw new Error(`${name} is required for embedded PostgreSQL.`);
  return value;
}

function positiveInteger(name: string, fallback: number, configured?: string): number {
  const raw = process.env[name]?.trim() || configured?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`${name} must be a positive integer no greater than 65535.`);
  }
  return value;
}

function databaseName(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("POSTGRES_DB must contain only letters, digits, underscores, or hyphens.");
  }
  return value;
}

export function resolveEmbeddedPostgresConfig(): EmbeddedPostgresConfig {
  let local: Record<string, string> = {};
  try {
    local = parseEnvFile(readFileSync(fileURLToPath(new URL("../../../.env.local", import.meta.url)), "utf8"));
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  const configured = (name: string) => process.env[name]?.trim() || local[name]?.trim();
  const mode = (configured("INK_DATABASE_MODE") || "postgres") as DatabaseMode;
  if (mode !== "embedded-postgres" && mode !== "postgres") {
    throw new Error("INK_DATABASE_MODE must be embedded-postgres or postgres.");
  }
  return {
    mode,
    dataDir: path.resolve(
      configured("EMBEDDED_POSTGRES_DATA_DIR") || ".ink-memory/postgres",
    ),
    port: positiveInteger("EMBEDDED_POSTGRES_PORT", 54329, local.EMBEDDED_POSTGRES_PORT),
    user: requiredValue("POSTGRES_USER", local.POSTGRES_USER),
    password: requiredValue("POSTGRES_PASSWORD", local.POSTGRES_PASSWORD),
    database: databaseName(configured("POSTGRES_DB") || "ink-memory"),
    sharedBuffers: configured("EMBEDDED_POSTGRES_SHARED_BUFFERS") || "96MB",
    maxConnections: positiveInteger("EMBEDDED_POSTGRES_MAX_CONNECTIONS", 50, local.EMBEDDED_POSTGRES_MAX_CONNECTIONS),
  };
}

export function postgresConnectionString(
  config: EmbeddedPostgresConfig,
  database = config.database,
  host = "127.0.0.1",
): string {
  const user = encodeURIComponent(config.user);
  const password = encodeURIComponent(config.password);
  const name = encodeURIComponent(database);
  return `postgres://${user}:${password}@${host}:${config.port}/${name}`;
}

function parseEnvFile(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator <= 0) continue;
    const name = normalized.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
    const rawValue = normalized.slice(separator + 1).trim();
    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      result[name] = rawValue.slice(1, -1);
      continue;
    }
    result[name] = rawValue;
  }
  return result;
}

export async function resolveExplicitMigrationDatabaseUrl(): Promise<string | undefined> {
  if (process.env.MIGRATION_DATABASE_URL?.trim()) {
    return process.env.MIGRATION_DATABASE_URL.trim();
  }
  try {
    const localEnv = await readFile(
      fileURLToPath(new URL("../../../.env.local", import.meta.url)),
      "utf8",
    );
    return parseEnvFile(localEnv).MIGRATION_DATABASE_URL?.trim() || undefined;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
