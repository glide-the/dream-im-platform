#!/usr/bin/env node
// [Input] Existing ignored Admin env files and secure random material.
// [Output] Mode-0600 local/Compose config for embedded PostgreSQL and disabled storage.
// [Pos] Base configuration generator for the Admin workspace.
// [Sync] 2026-08-27: generate the dedicated server-only Dream diagnostics credential.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = resolve(scriptDirectory, "..");

const ROOT_KEYS = new Set([
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "INK_DATABASE_MODE",
  "EMBEDDED_POSTGRES_DATA_DIR",
  "EMBEDDED_POSTGRES_PORT",
  "EMBEDDED_POSTGRES_SHARED_BUFFERS",
  "EMBEDDED_POSTGRES_MAX_CONNECTIONS",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "PGPOOL_MAX",
  "PG_IDLE_TIMEOUT_MS",
  "PG_CONNECTION_TIMEOUT_MS",
  "ADMIN_CONSOLE_ENABLED",
  "ADMIN_SESSION_SECRET",
  "ADMIN_BOOTSTRAP_TOKEN",
  "ADMIN_ORIGIN_ALLOWLIST",
  "DREAM_DIAGNOSTICS_BASE_URL",
  "DREAM_DIAGNOSTICS_TOKEN",
  "GATEWAY_API_KEY_PEPPER",
  "GATEWAY_SUBJECT_JWT_ISSUER",
  "GATEWAY_SUBJECT_JWT_AUDIENCE",
  "PRODUCT_API_JWT_SECRET",
  "PRODUCT_API_JWT_ISSUER",
  "PRODUCT_API_JWT_AUDIENCE",
  "PRODUCT_API_ORIGIN_ALLOWLIST",
  "AI_CREDENTIAL_ENCRYPTION_KEY",
  "AI_PROVIDER_HOST_ALLOWLIST",
  "AI_PROVIDER_ALLOW_INSECURE_LOCALHOST",
  "GATEWAY_MIN_RESERVE_MICROUSD",
  "GATEWAY_MAX_BODY_BYTES",
  "ARTIFACT_WORKSPACE_ROOT",
  "ARTIFACT_PREVIEW_MAX_FILE_BYTES",
  "FILE_STORAGE_TYPE",
  "FILE_STORAGE_PREFIX",
]);

const DOCKER_KEYS = new Set([
  "APP_PORT",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "EMBEDDED_POSTGRES_SHARED_BUFFERS",
  "EMBEDDED_POSTGRES_MAX_CONNECTIONS",
  "ADMIN_CONSOLE_ENABLED",
  "ADMIN_SESSION_SECRET",
  "ADMIN_BOOTSTRAP_TOKEN",
  "ADMIN_ORIGIN_ALLOWLIST",
  "GATEWAY_API_KEY_PEPPER",
  "GATEWAY_SUBJECT_JWT_ISSUER",
  "GATEWAY_SUBJECT_JWT_AUDIENCE",
  "PRODUCT_API_JWT_SECRET",
  "PRODUCT_API_JWT_ISSUER",
  "PRODUCT_API_JWT_AUDIENCE",
  "PRODUCT_API_ORIGIN_ALLOWLIST",
  "AI_CREDENTIAL_ENCRYPTION_KEY",
  "AI_PROVIDER_HOST_ALLOWLIST",
  "AI_PROVIDER_ALLOW_INSECURE_LOCALHOST",
  "GATEWAY_MIN_RESERVE_MICROUSD",
  "GATEWAY_MAX_BODY_BYTES",
  "RUN_DB_MIGRATIONS",
  "ARTIFACT_WORKSPACE_ROOT",
  "ARTIFACT_PREVIEW_MAX_FILE_BYTES",
  "FILE_STORAGE_TYPE",
  "FILE_STORAGE_PREFIX",
]);

function parseArguments(argv) {
  let projectRoot = defaultProjectRoot;
  let checkOnly = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      checkOnly = true;
      continue;
    }
    if (argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--root requires a directory path");
      projectRoot = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return { projectRoot, checkOnly };
}

function decodeValue(rawValue) {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function parseEnv(text) {
  const values = new Map();
  const invalidLines = [];

  text.split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator <= 0) {
      invalidLines.push(lineIndex + 1);
      return;
    }
    const key = normalized.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      invalidLines.push(lineIndex + 1);
      return;
    }
    values.set(key, decodeValue(normalized.slice(separator + 1)));
  });

  return { values, invalidLines };
}

async function readEnv(path) {
  try {
    return parseEnv(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { values: new Map(), invalidLines: [] };
    }
    throw error;
  }
}

function firstValid(sources, key, validator) {
  for (const source of sources) {
    const value = source.get(key);
    if (value !== undefined && validator(value)) return value;
  }
  return undefined;
}

function configuredValue(source, key, validator, fallback) {
  return firstValid([source], key, validator) ?? fallback;
}

function pairedSecret(rootExisting, dockerExisting, key, validator, factory) {
  const rootValue = firstValid([rootExisting], key, validator);
  const dockerValue = firstValid([dockerExisting], key, validator);
  const fallback = rootValue ?? dockerValue ?? factory();
  return {
    root: rootValue ?? fallback,
    docker: dockerValue ?? fallback,
  };
}

function hasMinimumBytes(value, minimum = 32) {
  return Buffer.byteLength(value, "utf8") >= minimum;
}

function isEncryptionKey(value) {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return true;
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 && decoded.toString("base64") === value;
}

function isBoolean(value) {
  return value === "true" || value === "false";
}

function isInteger(value, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum;
}

function isInkMemoryDatabaseUrl(value) {
  try {
    const url = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      decodeURIComponent(url.pathname.replace(/^\//, "")) === "ink-memory"
    );
  } catch {
    return false;
  }
}

function isDockerPostgresPassword(value) {
  return /^[A-Za-z0-9_-]{16,}$/.test(value);
}

function randomSecret(prefix = "") {
  return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function storageConfiguration(existing) {
  return [
    ["FILE_STORAGE_TYPE", "disabled"],
    [
      "FILE_STORAGE_PREFIX",
      configuredValue(existing, "FILE_STORAGE_PREFIX", (value) => !/[\r\n]/.test(value), "uploads"),
    ],
  ];
}

function buildConfiguration(rootExisting, dockerExisting, projectRoot) {
  const adminSessionSecret = pairedSecret(
    rootExisting,
    dockerExisting,
    "ADMIN_SESSION_SECRET",
    hasMinimumBytes,
    () => randomSecret("session_"),
  );
  const adminBootstrapToken = pairedSecret(
    rootExisting,
    dockerExisting,
    "ADMIN_BOOTSTRAP_TOKEN",
    hasMinimumBytes,
    () => randomSecret("bootstrap_"),
  );
  const dreamDiagnosticsToken =
    firstValid([rootExisting], "DREAM_DIAGNOSTICS_TOKEN", hasMinimumBytes) ??
    randomSecret("dream_diag_");
  const gatewayPepper = pairedSecret(
    rootExisting,
    dockerExisting,
    "GATEWAY_API_KEY_PEPPER",
    hasMinimumBytes,
    () => randomSecret("pepper_"),
  );
  const productApiSecret = pairedSecret(
    rootExisting,
    dockerExisting,
    "PRODUCT_API_JWT_SECRET",
    hasMinimumBytes,
    () => randomSecret("product_"),
  );
  const encryptionKey = pairedSecret(
    rootExisting,
    dockerExisting,
    "AI_CREDENTIAL_ENCRYPTION_KEY",
    isEncryptionKey,
    () => randomBytes(32).toString("base64"),
  );
  const postgresPassword = firstValid(
    [rootExisting, dockerExisting],
    "POSTGRES_PASSWORD",
    isDockerPostgresPassword,
  ) ?? randomSecret("pg_");
  const embeddedPort = configuredValue(
    rootExisting,
    "EMBEDDED_POSTGRES_PORT",
    (value) => isInteger(value, 1, 65_535),
    "54329",
  );
  const rootOriginAllowlist = configuredValue(
    rootExisting,
    "ADMIN_ORIGIN_ALLOWLIST",
    (value) => value.length > 0,
    "http://localhost:3000",
  );
  const dockerOriginAllowlist = configuredValue(
    dockerExisting,
    "ADMIN_ORIGIN_ALLOWLIST",
    (value) => value.length > 0,
    "http://localhost:3000",
  );
  const rootProductOriginAllowlist = configuredValue(
    rootExisting,
    "PRODUCT_API_ORIGIN_ALLOWLIST",
    (value) => value.length > 0 && !/[\r\n]/.test(value),
    "http://127.0.0.1:5173",
  );
  const dockerProductOriginAllowlist = configuredValue(
    dockerExisting,
    "PRODUCT_API_ORIGIN_ALLOWLIST",
    (value) => value.length > 0 && !/[\r\n]/.test(value),
    "http://127.0.0.1:5173",
  );
  const rootProviderAllowlist = configuredValue(
    rootExisting,
    "AI_PROVIDER_HOST_ALLOWLIST",
    (value) => !/[\r\n]/.test(value),
    "",
  );
  const dockerProviderAllowlist = configuredValue(
    dockerExisting,
    "AI_PROVIDER_HOST_ALLOWLIST",
    (value) => !/[\r\n]/.test(value),
    "",
  );

  const root = new Map([
    [
      "DATABASE_URL",
      `postgres://ink_memory:${postgresPassword}@127.0.0.1:${embeddedPort}/ink-memory`,
    ],
    ["INK_DATABASE_MODE", "embedded-postgres"],
    ["EMBEDDED_POSTGRES_DATA_DIR", resolve(projectRoot, ".ink-memory/postgres")],
    ["EMBEDDED_POSTGRES_PORT", embeddedPort],
    ["EMBEDDED_POSTGRES_SHARED_BUFFERS", "96MB"],
    ["EMBEDDED_POSTGRES_MAX_CONNECTIONS", "50"],
    ["POSTGRES_USER", "ink_memory"],
    ["POSTGRES_PASSWORD", postgresPassword],
    ["POSTGRES_DB", "ink-memory"],
    [
      "PGPOOL_MAX",
      firstValid([rootExisting], "PGPOOL_MAX", (value) =>
        isInteger(value, 1, 100),
      ) ?? "10",
    ],
    [
      "PG_IDLE_TIMEOUT_MS",
      firstValid([rootExisting], "PG_IDLE_TIMEOUT_MS", (value) =>
        isInteger(value, 1),
      ) ?? "30000",
    ],
    [
      "PG_CONNECTION_TIMEOUT_MS",
      firstValid([rootExisting], "PG_CONNECTION_TIMEOUT_MS", (value) =>
        isInteger(value, 1),
      ) ?? "10000",
    ],
    [
      "ADMIN_CONSOLE_ENABLED",
      configuredValue(rootExisting, "ADMIN_CONSOLE_ENABLED", isBoolean, "true"),
    ],
    ["ADMIN_SESSION_SECRET", adminSessionSecret.root],
    ["ADMIN_BOOTSTRAP_TOKEN", adminBootstrapToken.root],
    ["ADMIN_ORIGIN_ALLOWLIST", rootOriginAllowlist],
    [
      "DREAM_DIAGNOSTICS_BASE_URL",
      configuredValue(
        rootExisting,
        "DREAM_DIAGNOSTICS_BASE_URL",
        (value) => /^https:\/\//.test(value) || /^http:\/\/(127\.0\.0\.1|localhost)(:[0-9]+)?$/.test(value),
        "http://127.0.0.1:8765",
      ),
    ],
    ["DREAM_DIAGNOSTICS_TOKEN", dreamDiagnosticsToken],
    ["GATEWAY_API_KEY_PEPPER", gatewayPepper.root],
    [
      "GATEWAY_SUBJECT_JWT_ISSUER",
      configuredValue(
        rootExisting,
        "GATEWAY_SUBJECT_JWT_ISSUER",
        (value) => value.trim().length > 0 && !/[\r\n]/.test(value),
        "ink-dream-memory",
      ),
    ],
    [
      "GATEWAY_SUBJECT_JWT_AUDIENCE",
      configuredValue(
        rootExisting,
        "GATEWAY_SUBJECT_JWT_AUDIENCE",
        (value) => value.trim().length > 0 && !/[\r\n]/.test(value),
        "ink-memory-admin-gateway",
      ),
    ],
    ["PRODUCT_API_JWT_SECRET", productApiSecret.root],
    [
      "PRODUCT_API_JWT_ISSUER",
      configuredValue(
        rootExisting,
        "PRODUCT_API_JWT_ISSUER",
        (value) => value.trim().length > 0 && !/[\r\n]/.test(value),
        "ink-dream-memory",
      ),
    ],
    [
      "PRODUCT_API_JWT_AUDIENCE",
      configuredValue(
        rootExisting,
        "PRODUCT_API_JWT_AUDIENCE",
        (value) => value.trim().length > 0 && !/[\r\n]/.test(value),
        "ink-memory-product-api",
      ),
    ],
    ["PRODUCT_API_ORIGIN_ALLOWLIST", rootProductOriginAllowlist],
    ["AI_CREDENTIAL_ENCRYPTION_KEY", encryptionKey.root],
    ["AI_PROVIDER_HOST_ALLOWLIST", rootProviderAllowlist],
    [
      "AI_PROVIDER_ALLOW_INSECURE_LOCALHOST",
      configuredValue(
        rootExisting,
        "AI_PROVIDER_ALLOW_INSECURE_LOCALHOST",
        isBoolean,
        "false",
      ),
    ],
    [
      "GATEWAY_MIN_RESERVE_MICROUSD",
      configuredValue(
        rootExisting,
        "GATEWAY_MIN_RESERVE_MICROUSD",
        (value) => isInteger(value, 0),
        "0",
      ),
    ],
    [
      "GATEWAY_MAX_BODY_BYTES",
      configuredValue(
        rootExisting,
        "GATEWAY_MAX_BODY_BYTES",
        (value) => isInteger(value, 1_024),
        "20971520",
      ),
    ],
    [
      "ARTIFACT_WORKSPACE_ROOT",
      configuredValue(
        rootExisting,
        "ARTIFACT_WORKSPACE_ROOT",
        (value) => isAbsolute(value) && !/[\r\n]/.test(value),
        resolve(defaultProjectRoot, "../ink-dream-memory/backend/data/agent-workspace"),
      ),
    ],
    [
      "ARTIFACT_PREVIEW_MAX_FILE_BYTES",
      configuredValue(
        rootExisting,
        "ARTIFACT_PREVIEW_MAX_FILE_BYTES",
        (value) => isInteger(value, 1, 33_554_432),
        "8388608",
      ),
    ],
    ...storageConfiguration(rootExisting),
  ]);
  const docker = new Map([
    [
      "APP_PORT",
      firstValid([dockerExisting], "APP_PORT", (value) =>
        isInteger(value, 1, 65_535),
      ) ?? "3000",
    ],
    [
      "POSTGRES_PORT",
      firstValid([dockerExisting], "POSTGRES_PORT", (value) =>
        isInteger(value, 1, 65_535),
      ) ?? "5433",
    ],
    ["POSTGRES_USER", "ink_memory"],
    [
      "POSTGRES_PASSWORD",
      firstValid(
        [dockerExisting],
        "POSTGRES_PASSWORD",
        isDockerPostgresPassword,
      ) ?? postgresPassword,
    ],
    ["POSTGRES_DB", "ink-memory"],
    ["EMBEDDED_POSTGRES_SHARED_BUFFERS", "96MB"],
    ["EMBEDDED_POSTGRES_MAX_CONNECTIONS", "50"],
    [
      "ADMIN_CONSOLE_ENABLED",
      configuredValue(
        dockerExisting,
        "ADMIN_CONSOLE_ENABLED",
        isBoolean,
        "true",
      ),
    ],
    ["ADMIN_SESSION_SECRET", adminSessionSecret.docker],
    ["ADMIN_BOOTSTRAP_TOKEN", adminBootstrapToken.docker],
    ["ADMIN_ORIGIN_ALLOWLIST", dockerOriginAllowlist],
    ["GATEWAY_API_KEY_PEPPER", gatewayPepper.docker],
    [
      "GATEWAY_SUBJECT_JWT_ISSUER",
      configuredValue(
        dockerExisting,
        "GATEWAY_SUBJECT_JWT_ISSUER",
        (value) => value.trim().length > 0 && !/[\r\n]/.test(value),
        "ink-dream-memory",
      ),
    ],
    [
      "GATEWAY_SUBJECT_JWT_AUDIENCE",
      configuredValue(
        dockerExisting,
        "GATEWAY_SUBJECT_JWT_AUDIENCE",
        (value) => value.trim().length > 0 && !/[\r\n]/.test(value),
        "ink-memory-admin-gateway",
      ),
    ],
    ["PRODUCT_API_JWT_SECRET", productApiSecret.docker],
    [
      "PRODUCT_API_JWT_ISSUER",
      configuredValue(
        dockerExisting,
        "PRODUCT_API_JWT_ISSUER",
        (value) => value.trim().length > 0 && !/[\r\n]/.test(value),
        "ink-dream-memory",
      ),
    ],
    [
      "PRODUCT_API_JWT_AUDIENCE",
      configuredValue(
        dockerExisting,
        "PRODUCT_API_JWT_AUDIENCE",
        (value) => value.trim().length > 0 && !/[\r\n]/.test(value),
        "ink-memory-product-api",
      ),
    ],
    ["PRODUCT_API_ORIGIN_ALLOWLIST", dockerProductOriginAllowlist],
    ["AI_CREDENTIAL_ENCRYPTION_KEY", encryptionKey.docker],
    ["AI_PROVIDER_HOST_ALLOWLIST", dockerProviderAllowlist],
    [
      "AI_PROVIDER_ALLOW_INSECURE_LOCALHOST",
      configuredValue(
        dockerExisting,
        "AI_PROVIDER_ALLOW_INSECURE_LOCALHOST",
        isBoolean,
        "false",
      ),
    ],
    [
      "GATEWAY_MIN_RESERVE_MICROUSD",
      configuredValue(
        dockerExisting,
        "GATEWAY_MIN_RESERVE_MICROUSD",
        (value) => isInteger(value, 0),
        "0",
      ),
    ],
    [
      "GATEWAY_MAX_BODY_BYTES",
      configuredValue(
        dockerExisting,
        "GATEWAY_MAX_BODY_BYTES",
        (value) => isInteger(value, 1_024),
        "20971520",
      ),
    ],
    [
      "RUN_DB_MIGRATIONS",
      "false",
    ],
    [
      "ARTIFACT_WORKSPACE_ROOT",
      configuredValue(
        dockerExisting,
        "ARTIFACT_WORKSPACE_ROOT",
        (value) => isAbsolute(value) && !/[\r\n]/.test(value),
        "/artifacts",
      ),
    ],
    [
      "ARTIFACT_PREVIEW_MAX_FILE_BYTES",
      configuredValue(
        dockerExisting,
        "ARTIFACT_PREVIEW_MAX_FILE_BYTES",
        (value) => isInteger(value, 1, 33_554_432),
        "8388608",
      ),
    ],
    ...storageConfiguration(dockerExisting),
  ]);

  return { root, docker };
}

function encodeValue(value) {
  if (/[\r\n]/.test(value)) {
    throw new Error("Environment values must not contain newlines");
  }
  if (/^[A-Za-z0-9_./:@%+,=\-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

function renderRootEnv(values) {
  return `# Generated by pnpm env:setup. Do not commit this file.
# PostgreSQL: pnpm dev supervises the embedded cluster on the configured port.
DATABASE_URL=${encodeValue(values.get("DATABASE_URL"))}
INK_DATABASE_MODE=${values.get("INK_DATABASE_MODE")}
EMBEDDED_POSTGRES_DATA_DIR=${encodeValue(values.get("EMBEDDED_POSTGRES_DATA_DIR"))}
EMBEDDED_POSTGRES_PORT=${values.get("EMBEDDED_POSTGRES_PORT")}
EMBEDDED_POSTGRES_SHARED_BUFFERS=${values.get("EMBEDDED_POSTGRES_SHARED_BUFFERS")}
EMBEDDED_POSTGRES_MAX_CONNECTIONS=${values.get("EMBEDDED_POSTGRES_MAX_CONNECTIONS")}
POSTGRES_USER=${values.get("POSTGRES_USER")}
POSTGRES_PASSWORD=${encodeValue(values.get("POSTGRES_PASSWORD"))}
POSTGRES_DB=${values.get("POSTGRES_DB")}
PGPOOL_MAX=${values.get("PGPOOL_MAX")}
PG_IDLE_TIMEOUT_MS=${values.get("PG_IDLE_TIMEOUT_MS")}
PG_CONNECTION_TIMEOUT_MS=${values.get("PG_CONNECTION_TIMEOUT_MS")}

# Refine Admin authentication and same-origin protection.
ADMIN_CONSOLE_ENABLED=${values.get("ADMIN_CONSOLE_ENABLED")}
ADMIN_SESSION_SECRET=${encodeValue(values.get("ADMIN_SESSION_SECRET"))}
ADMIN_BOOTSTRAP_TOKEN=${encodeValue(values.get("ADMIN_BOOTSTRAP_TOKEN"))}
ADMIN_ORIGIN_ALLOWLIST=${encodeValue(values.get("ADMIN_ORIGIN_ALLOWLIST"))}

# Gateway key hashing and encrypted Provider credentials.
GATEWAY_API_KEY_PEPPER=${encodeValue(values.get("GATEWAY_API_KEY_PEPPER"))}
GATEWAY_SUBJECT_JWT_ISSUER=${encodeValue(values.get("GATEWAY_SUBJECT_JWT_ISSUER"))}
GATEWAY_SUBJECT_JWT_AUDIENCE=${encodeValue(values.get("GATEWAY_SUBJECT_JWT_AUDIENCE"))}
AI_CREDENTIAL_ENCRYPTION_KEY=${encodeValue(values.get("AI_CREDENTIAL_ENCRYPTION_KEY"))}
AI_PROVIDER_HOST_ALLOWLIST=${encodeValue(values.get("AI_PROVIDER_HOST_ALLOWLIST"))}
AI_PROVIDER_ALLOW_INSECURE_LOCALHOST=${values.get("AI_PROVIDER_ALLOW_INSECURE_LOCALHOST")}
GATEWAY_MIN_RESERVE_MICROUSD=${values.get("GATEWAY_MIN_RESERVE_MICROUSD")}
GATEWAY_MAX_BODY_BYTES=${values.get("GATEWAY_MAX_BODY_BYTES")}

# Shared Dream Artifact workspace. Admin must receive this mount read-only.
ARTIFACT_WORKSPACE_ROOT=${encodeValue(values.get("ARTIFACT_WORKSPACE_ROOT"))}
ARTIFACT_PREVIEW_MAX_FILE_BYTES=${values.get("ARTIFACT_PREVIEW_MAX_FILE_BYTES")}

# Dream server-to-server Product API identity. Never expose the JWT secret to browsers.
PRODUCT_API_JWT_SECRET=${encodeValue(values.get("PRODUCT_API_JWT_SECRET"))}
PRODUCT_API_JWT_ISSUER=${encodeValue(values.get("PRODUCT_API_JWT_ISSUER"))}
PRODUCT_API_JWT_AUDIENCE=${encodeValue(values.get("PRODUCT_API_JWT_AUDIENCE"))}
PRODUCT_API_ORIGIN_ALLOWLIST=${encodeValue(values.get("PRODUCT_API_ORIGIN_ALLOWLIST"))}

# File storage is intentionally disabled while MinIO is paused.
FILE_STORAGE_TYPE=${values.get("FILE_STORAGE_TYPE")}
FILE_STORAGE_PREFIX=${encodeValue(values.get("FILE_STORAGE_PREFIX"))}
`;
}

function renderDockerEnv(values) {
  return `# Generated by pnpm env:setup. Do not commit this file.
APP_PORT=${values.get("APP_PORT")}
POSTGRES_PORT=${values.get("POSTGRES_PORT")}
POSTGRES_USER=${values.get("POSTGRES_USER")}
POSTGRES_PASSWORD=${encodeValue(values.get("POSTGRES_PASSWORD"))}
POSTGRES_DB=${values.get("POSTGRES_DB")}
EMBEDDED_POSTGRES_SHARED_BUFFERS=${values.get("EMBEDDED_POSTGRES_SHARED_BUFFERS")}
EMBEDDED_POSTGRES_MAX_CONNECTIONS=${values.get("EMBEDDED_POSTGRES_MAX_CONNECTIONS")}

ADMIN_CONSOLE_ENABLED=${values.get("ADMIN_CONSOLE_ENABLED")}
ADMIN_SESSION_SECRET=${encodeValue(values.get("ADMIN_SESSION_SECRET"))}
ADMIN_BOOTSTRAP_TOKEN=${encodeValue(values.get("ADMIN_BOOTSTRAP_TOKEN"))}
ADMIN_ORIGIN_ALLOWLIST=${encodeValue(values.get("ADMIN_ORIGIN_ALLOWLIST"))}

GATEWAY_API_KEY_PEPPER=${encodeValue(values.get("GATEWAY_API_KEY_PEPPER"))}
GATEWAY_SUBJECT_JWT_ISSUER=${encodeValue(values.get("GATEWAY_SUBJECT_JWT_ISSUER"))}
GATEWAY_SUBJECT_JWT_AUDIENCE=${encodeValue(values.get("GATEWAY_SUBJECT_JWT_AUDIENCE"))}
AI_CREDENTIAL_ENCRYPTION_KEY=${encodeValue(values.get("AI_CREDENTIAL_ENCRYPTION_KEY"))}
AI_PROVIDER_HOST_ALLOWLIST=${encodeValue(values.get("AI_PROVIDER_HOST_ALLOWLIST"))}
AI_PROVIDER_ALLOW_INSECURE_LOCALHOST=${values.get("AI_PROVIDER_ALLOW_INSECURE_LOCALHOST")}
GATEWAY_MIN_RESERVE_MICROUSD=${values.get("GATEWAY_MIN_RESERVE_MICROUSD")}
GATEWAY_MAX_BODY_BYTES=${values.get("GATEWAY_MAX_BODY_BYTES")}
RUN_DB_MIGRATIONS=${values.get("RUN_DB_MIGRATIONS")}
ARTIFACT_WORKSPACE_ROOT=${encodeValue(values.get("ARTIFACT_WORKSPACE_ROOT"))}
ARTIFACT_PREVIEW_MAX_FILE_BYTES=${values.get("ARTIFACT_PREVIEW_MAX_FILE_BYTES")}

PRODUCT_API_JWT_SECRET=${encodeValue(values.get("PRODUCT_API_JWT_SECRET"))}
PRODUCT_API_JWT_ISSUER=${encodeValue(values.get("PRODUCT_API_JWT_ISSUER"))}
PRODUCT_API_JWT_AUDIENCE=${encodeValue(values.get("PRODUCT_API_JWT_AUDIENCE"))}
PRODUCT_API_ORIGIN_ALLOWLIST=${encodeValue(values.get("PRODUCT_API_ORIGIN_ALLOWLIST"))}

FILE_STORAGE_TYPE=${values.get("FILE_STORAGE_TYPE")}
FILE_STORAGE_PREFIX=${encodeValue(values.get("FILE_STORAGE_PREFIX"))}
`;
}

async function writePrivateFile(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, contents, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}

function unknownKeys(values, allowedKeys) {
  return [...values.keys()].filter((key) => !allowedKeys.has(key)).sort();
}

function validateConfiguration(root, docker, rootParsed, dockerParsed) {
  const errors = [];
  if (rootParsed.invalidLines.length > 0) {
    errors.push(`.env.local has invalid lines: ${rootParsed.invalidLines.join(", ")}`);
  }
  if (dockerParsed.invalidLines.length > 0) {
    errors.push(`docker/.env has invalid lines: ${dockerParsed.invalidLines.join(", ")}`);
  }
  const rootUnknown = unknownKeys(root, ROOT_KEYS);
  const dockerUnknown = unknownKeys(docker, DOCKER_KEYS);
  if (rootUnknown.length > 0) {
    errors.push(`.env.local has unsupported keys: ${rootUnknown.join(", ")}`);
  }
  if (dockerUnknown.length > 0) {
    errors.push(`docker/.env has unsupported keys: ${dockerUnknown.join(", ")}`);
  }
  if (!isInkMemoryDatabaseUrl(root.get("DATABASE_URL") ?? "")) {
    errors.push("DATABASE_URL must use the ink-memory PostgreSQL database");
  }
  if (root.get("MIGRATION_DATABASE_URL") && !isInkMemoryDatabaseUrl(root.get("MIGRATION_DATABASE_URL") ?? "")) {
    errors.push("MIGRATION_DATABASE_URL must use the ink-memory PostgreSQL database when configured");
  }
  if (root.get("INK_DATABASE_MODE") !== "embedded-postgres") {
    errors.push(".env.local: INK_DATABASE_MODE must be embedded-postgres");
  }
  for (const fileValues of [root, docker]) {
    if (!isDockerPostgresPassword(fileValues.get("POSTGRES_PASSWORD") ?? "")) {
      errors.push("POSTGRES_PASSWORD must contain at least 16 URL-safe characters");
    }
  }
  if (docker.get("POSTGRES_DB") !== "ink-memory") {
    errors.push("POSTGRES_DB must be ink-memory");
  }
  if (docker.get("POSTGRES_USER") !== "ink_memory") {
    errors.push("POSTGRES_USER must be ink_memory");
  }
  for (const key of [
    "ADMIN_SESSION_SECRET",
    "ADMIN_BOOTSTRAP_TOKEN",
    "GATEWAY_API_KEY_PEPPER",
  ]) {
    for (const [file, values] of [
      [".env.local", root],
      ["docker/.env", docker],
    ]) {
      if (!hasMinimumBytes(values.get(key) ?? "")) {
        errors.push(`${file}: ${key} must contain at least 32 bytes`);
      }
    }
  }
  if (!hasMinimumBytes(root.get("DREAM_DIAGNOSTICS_TOKEN") ?? "")) {
    errors.push(".env.local: DREAM_DIAGNOSTICS_TOKEN must contain at least 32 bytes");
  }
  const productKeys = [
    "PRODUCT_API_JWT_SECRET",
    "PRODUCT_API_JWT_ISSUER",
    "PRODUCT_API_JWT_AUDIENCE",
    "PRODUCT_API_ORIGIN_ALLOWLIST",
  ];
  for (const [file, values] of [
    [".env.local", root],
    ["docker/.env", docker],
  ]) {
    if (productKeys.some((key) => values.has(key))) {
      if (!hasMinimumBytes(values.get("PRODUCT_API_JWT_SECRET") ?? "")) {
        errors.push(`${file}: PRODUCT_API_JWT_SECRET must contain at least 32 bytes`);
      }
      for (const key of productKeys.slice(1)) {
        if (!(values.get(key) ?? "").trim()) {
          errors.push(`${file}: ${key} must not be empty when Product API identity is configured`);
        }
      }
    }
  }
  for (const [file, values] of [
    [".env.local", root],
    ["docker/.env", docker],
  ]) {
    if (!isEncryptionKey(values.get("AI_CREDENTIAL_ENCRYPTION_KEY") ?? "")) {
      errors.push(
        `${file}: AI_CREDENTIAL_ENCRYPTION_KEY must encode exactly 32 bytes`,
      );
    }
  }
  for (const [file, values] of [
    [".env.local", root],
    ["docker/.env", docker],
  ]) {
    for (const key of [
      "ADMIN_CONSOLE_ENABLED",
      "AI_PROVIDER_ALLOW_INSECURE_LOCALHOST",
    ]) {
      if (!isBoolean(values.get(key) ?? "")) {
        errors.push(`${file}: ${key} must be true or false`);
      }
    }
    if (!isInteger(values.get("GATEWAY_MIN_RESERVE_MICROUSD") ?? "", 0)) {
      errors.push(
        `${file}: GATEWAY_MIN_RESERVE_MICROUSD must be a non-negative integer`,
      );
    }
    if (!isInteger(values.get("GATEWAY_MAX_BODY_BYTES") ?? "", 1_024)) {
      errors.push(`${file}: GATEWAY_MAX_BODY_BYTES must be at least 1024`);
    }
    if (!(values.get("ADMIN_ORIGIN_ALLOWLIST") ?? "").trim()) {
      errors.push(`${file}: ADMIN_ORIGIN_ALLOWLIST must not be empty`);
    }
    for (const key of [
      "GATEWAY_SUBJECT_JWT_ISSUER",
      "GATEWAY_SUBJECT_JWT_AUDIENCE",
    ]) {
      if (!(values.get(key) ?? "").trim()) {
        errors.push(`${file}: ${key} must not be empty`);
      }
    }
    if (values.get("FILE_STORAGE_TYPE") !== "disabled") {
      errors.push(`${file}: FILE_STORAGE_TYPE must be disabled while MinIO is paused`);
    }
  }
  if (!isInteger(root.get("PGPOOL_MAX") ?? "", 1, 100)) {
    errors.push(".env.local: PGPOOL_MAX must be between 1 and 100");
  }
  for (const key of ["PG_IDLE_TIMEOUT_MS", "PG_CONNECTION_TIMEOUT_MS"]) {
    if (!isInteger(root.get(key) ?? "", 1)) {
      errors.push(`.env.local: ${key} must be a positive integer`);
    }
  }
  for (const key of ["APP_PORT", "POSTGRES_PORT", "EMBEDDED_POSTGRES_MAX_CONNECTIONS"]) {
    if (!isInteger(docker.get(key) ?? "", 1, 65_535)) {
      errors.push(`docker/.env: ${key} must be a valid TCP port`);
    }
  }
  if (!isInteger(root.get("EMBEDDED_POSTGRES_PORT") ?? "", 1, 65_535)) {
    errors.push(".env.local: EMBEDDED_POSTGRES_PORT must be a valid TCP port");
  }
  if (docker.get("RUN_DB_MIGRATIONS") !== "false") {
    errors.push("docker/.env: RUN_DB_MIGRATIONS must remain false");
  }
  return errors;
}

async function run() {
  const { projectRoot, checkOnly } = parseArguments(process.argv.slice(2));
  const rootPath = resolve(projectRoot, ".env.local");
  const dockerPath = resolve(projectRoot, "docker/.env");
  const [rootParsed, dockerParsed] = await Promise.all([
    readEnv(rootPath),
    readEnv(dockerPath),
  ]);

  if (checkOnly) {
    const missingFiles = [];
    if (rootParsed.values.size === 0) missingFiles.push(".env.local");
    if (dockerParsed.values.size === 0) missingFiles.push("docker/.env");
    const errors = [
      ...(missingFiles.length > 0
        ? [`Missing environment files: ${missingFiles.join(", ")}`]
        : []),
      ...validateConfiguration(
        rootParsed.values,
        dockerParsed.values,
        rootParsed,
        dockerParsed,
      ),
    ];
    if (errors.length > 0) {
      throw new Error(`Environment validation failed:\n- ${errors.join("\n- ")}`);
    }
    console.log(
      "Environment structure is valid for ink-memory-admin; embedded PostgreSQL is explicit and file storage is disabled.",
    );
    return;
  }

  const rootRemoved = unknownKeys(rootParsed.values, ROOT_KEYS);
  const dockerRemoved = unknownKeys(dockerParsed.values, DOCKER_KEYS);
  const configuration = buildConfiguration(
    rootParsed.values,
    dockerParsed.values,
    projectRoot,
  );
  await Promise.all([
    writePrivateFile(rootPath, renderRootEnv(configuration.root)),
    writePrivateFile(dockerPath, renderDockerEnv(configuration.docker)),
  ]);

  console.log("Configured .env.local and docker/.env with mode 0600.");
  if (rootRemoved.length > 0) {
    console.log(`Removed unsupported .env.local keys: ${rootRemoved.join(", ")}`);
  }
  if (dockerRemoved.length > 0) {
    console.log(`Removed unsupported docker/.env keys: ${dockerRemoved.join(", ")}`);
  }
  console.log(
    "Existing control-plane and PostgreSQL secrets were preserved; unsupported storage credentials were removed.",
  );
}

await run();
