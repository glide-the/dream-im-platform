#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = resolve(scriptDirectory, "..");

const ROOT_KEYS = new Set([
  "DATABASE_URL",
  "STORY_DATABASE_URL",
  "PGPOOL_MAX",
  "PG_IDLE_TIMEOUT_MS",
  "PG_CONNECTION_TIMEOUT_MS",
  "ADMIN_CONSOLE_ENABLED",
  "ADMIN_SESSION_SECRET",
  "ADMIN_BOOTSTRAP_TOKEN",
  "ADMIN_ORIGIN_ALLOWLIST",
  "GATEWAY_API_KEY_PEPPER",
  "AI_CREDENTIAL_ENCRYPTION_KEY",
  "AI_PROVIDER_HOST_ALLOWLIST",
  "AI_PROVIDER_ALLOW_INSECURE_LOCALHOST",
  "GATEWAY_MIN_RESERVE_MICROUSD",
  "GATEWAY_MAX_BODY_BYTES",
  "FILE_STORAGE_TYPE",
  "FILE_STORAGE_PREFIX",
  "BLOB_READ_WRITE_TOKEN",
  "FILE_STORAGE_S3_BUCKET",
  "FILE_STORAGE_S3_REGION",
  "FILE_STORAGE_S3_ENDPOINT",
  "FILE_STORAGE_S3_FORCE_PATH_STYLE",
  "FILE_STORAGE_S3_PUBLIC_BASE_URL",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "MINIO_USER",
  "MINIO_PASSWORD",
  "MINIO_API_PORT",
  "MINIO_CONSOLE_PORT",
]);

const DOCKER_KEYS = new Set([
  "APP_PORT",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_DB",
  "ADMIN_CONSOLE_ENABLED",
  "ADMIN_SESSION_SECRET",
  "ADMIN_BOOTSTRAP_TOKEN",
  "ADMIN_ORIGIN_ALLOWLIST",
  "GATEWAY_API_KEY_PEPPER",
  "AI_CREDENTIAL_ENCRYPTION_KEY",
  "AI_PROVIDER_HOST_ALLOWLIST",
  "AI_PROVIDER_ALLOW_INSECURE_LOCALHOST",
  "GATEWAY_MIN_RESERVE_MICROUSD",
  "GATEWAY_MAX_BODY_BYTES",
  "RUN_DB_MIGRATIONS",
  "FILE_STORAGE_TYPE",
  "FILE_STORAGE_PREFIX",
  "BLOB_READ_WRITE_TOKEN",
  "FILE_STORAGE_S3_BUCKET",
  "FILE_STORAGE_S3_REGION",
  "FILE_STORAGE_S3_ENDPOINT",
  "FILE_STORAGE_S3_FORCE_PATH_STYLE",
  "FILE_STORAGE_S3_PUBLIC_BASE_URL",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "MINIO_USER",
  "MINIO_PASSWORD",
  "MINIO_API_PORT",
  "MINIO_CONSOLE_PORT",
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

function isBooleanFlag(value) {
  return isBoolean(value) || value === "1" || value === "0";
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

function storageConfiguration(existing, defaults) {
  const optionalValue = (key, fallback = "") =>
    configuredValue(
      existing,
      key,
      (value) =>
        !/[\r\n]/.test(value) &&
        (fallback === "" || value.trim().length > 0),
      fallback,
    );
  const hasOperatorConfiguration = [
    "BLOB_READ_WRITE_TOKEN",
    "FILE_STORAGE_S3_BUCKET",
    "FILE_STORAGE_S3_REGION",
    "FILE_STORAGE_S3_ENDPOINT",
    "FILE_STORAGE_S3_PUBLIC_BASE_URL",
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_SESSION_TOKEN",
  ].some((key) => (existing.get(key) ?? "").trim().length > 0);
  const useLocalMinio = !hasOperatorConfiguration;
  const minioUser = configuredValue(
    existing,
    "MINIO_USER",
    (value) => /^[A-Za-z0-9_-]{3,}$/.test(value),
    "ink_memory",
  );

  return [
    [
      "FILE_STORAGE_TYPE",
      useLocalMinio
        ? "s3"
        : configuredValue(
            existing,
            "FILE_STORAGE_TYPE",
            (value) => value === "vercel-blob" || value === "s3",
            "vercel-blob",
          ),
    ],
    ["FILE_STORAGE_PREFIX", optionalValue("FILE_STORAGE_PREFIX", "uploads")],
    ["BLOB_READ_WRITE_TOKEN", optionalValue("BLOB_READ_WRITE_TOKEN")],
    [
      "FILE_STORAGE_S3_BUCKET",
      optionalValue("FILE_STORAGE_S3_BUCKET", useLocalMinio ? "ink-memory" : ""),
    ],
    [
      "FILE_STORAGE_S3_REGION",
      optionalValue("FILE_STORAGE_S3_REGION", useLocalMinio ? "us-east-1" : ""),
    ],
    [
      "FILE_STORAGE_S3_ENDPOINT",
      optionalValue(
        "FILE_STORAGE_S3_ENDPOINT",
        useLocalMinio ? defaults.endpoint : "",
      ),
    ],
    [
      "FILE_STORAGE_S3_FORCE_PATH_STYLE",
      useLocalMinio
        ? "true"
        : configuredValue(
            existing,
            "FILE_STORAGE_S3_FORCE_PATH_STYLE",
            isBooleanFlag,
            "false",
          ),
    ],
    [
      "FILE_STORAGE_S3_PUBLIC_BASE_URL",
      optionalValue("FILE_STORAGE_S3_PUBLIC_BASE_URL"),
    ],
    [
      "AWS_REGION",
      optionalValue("AWS_REGION", useLocalMinio ? "us-east-1" : ""),
    ],
    [
      "AWS_ACCESS_KEY_ID",
      optionalValue("AWS_ACCESS_KEY_ID", useLocalMinio ? minioUser : ""),
    ],
    [
      "AWS_SECRET_ACCESS_KEY",
      optionalValue(
        "AWS_SECRET_ACCESS_KEY",
        useLocalMinio ? defaults.minioPassword : "",
      ),
    ],
    ["AWS_SESSION_TOKEN", optionalValue("AWS_SESSION_TOKEN")],
    ["MINIO_USER", minioUser],
    ["MINIO_PASSWORD", defaults.minioPassword],
    [
      "MINIO_API_PORT",
      configuredValue(
        existing,
        "MINIO_API_PORT",
        (value) => isInteger(value, 1, 65_535),
        "9000",
      ),
    ],
    [
      "MINIO_CONSOLE_PORT",
      configuredValue(
        existing,
        "MINIO_CONSOLE_PORT",
        (value) => isInteger(value, 1, 65_535),
        "9001",
      ),
    ],
  ];
}

function buildConfiguration(rootExisting, dockerExisting) {
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
  const gatewayPepper = pairedSecret(
    rootExisting,
    dockerExisting,
    "GATEWAY_API_KEY_PEPPER",
    hasMinimumBytes,
    () => randomSecret("pepper_"),
  );
  const encryptionKey = pairedSecret(
    rootExisting,
    dockerExisting,
    "AI_CREDENTIAL_ENCRYPTION_KEY",
    isEncryptionKey,
    () => randomBytes(32).toString("base64"),
  );
  const minioPassword = pairedSecret(
    rootExisting,
    dockerExisting,
    "MINIO_PASSWORD",
    isDockerPostgresPassword,
    () => randomSecret("minio_"),
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
      firstValid(
        [rootExisting],
        "DATABASE_URL",
        isInkMemoryDatabaseUrl,
      ) ?? "postgres://ink_memory:ink_memory@localhost:5433/ink-memory",
    ],
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
    ["GATEWAY_API_KEY_PEPPER", gatewayPepper.root],
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
    ...storageConfiguration(rootExisting, {
      endpoint: "http://localhost:9000",
      minioPassword: minioPassword.root,
    }),
  ]);
  root.set(
    "STORY_DATABASE_URL",
    firstValid(
      [rootExisting],
      "STORY_DATABASE_URL",
      isInkMemoryDatabaseUrl,
    ) ?? root.get("DATABASE_URL"),
  );

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
      ) ?? randomSecret("pg_"),
    ],
    ["POSTGRES_DB", "ink-memory"],
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
      firstValid([dockerExisting], "RUN_DB_MIGRATIONS", isBoolean) ?? "true",
    ],
    ...storageConfiguration(dockerExisting, {
      endpoint: "http://minio:9000",
      minioPassword: minioPassword.docker,
    }),
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
# PostgreSQL: local docker-compose.yml exposes ink-memory on port 5433.
DATABASE_URL=${encodeValue(values.get("DATABASE_URL"))}
STORY_DATABASE_URL=${encodeValue(values.get("STORY_DATABASE_URL"))}
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
AI_CREDENTIAL_ENCRYPTION_KEY=${encodeValue(values.get("AI_CREDENTIAL_ENCRYPTION_KEY"))}
AI_PROVIDER_HOST_ALLOWLIST=${encodeValue(values.get("AI_PROVIDER_HOST_ALLOWLIST"))}
AI_PROVIDER_ALLOW_INSECURE_LOCALHOST=${values.get("AI_PROVIDER_ALLOW_INSECURE_LOCALHOST")}
GATEWAY_MIN_RESERVE_MICROUSD=${values.get("GATEWAY_MIN_RESERVE_MICROUSD")}
GATEWAY_MAX_BODY_BYTES=${values.get("GATEWAY_MAX_BODY_BYTES")}

# File storage. External credentials are never generated automatically.
FILE_STORAGE_TYPE=${values.get("FILE_STORAGE_TYPE")}
FILE_STORAGE_PREFIX=${encodeValue(values.get("FILE_STORAGE_PREFIX"))}
BLOB_READ_WRITE_TOKEN=${encodeValue(values.get("BLOB_READ_WRITE_TOKEN"))}
FILE_STORAGE_S3_BUCKET=${encodeValue(values.get("FILE_STORAGE_S3_BUCKET"))}
FILE_STORAGE_S3_REGION=${encodeValue(values.get("FILE_STORAGE_S3_REGION"))}
FILE_STORAGE_S3_ENDPOINT=${encodeValue(values.get("FILE_STORAGE_S3_ENDPOINT"))}
FILE_STORAGE_S3_FORCE_PATH_STYLE=${values.get("FILE_STORAGE_S3_FORCE_PATH_STYLE")}
FILE_STORAGE_S3_PUBLIC_BASE_URL=${encodeValue(values.get("FILE_STORAGE_S3_PUBLIC_BASE_URL"))}
AWS_REGION=${encodeValue(values.get("AWS_REGION"))}
AWS_ACCESS_KEY_ID=${encodeValue(values.get("AWS_ACCESS_KEY_ID"))}
AWS_SECRET_ACCESS_KEY=${encodeValue(values.get("AWS_SECRET_ACCESS_KEY"))}
AWS_SESSION_TOKEN=${encodeValue(values.get("AWS_SESSION_TOKEN"))}
MINIO_USER=${encodeValue(values.get("MINIO_USER"))}
MINIO_PASSWORD=${encodeValue(values.get("MINIO_PASSWORD"))}
MINIO_API_PORT=${values.get("MINIO_API_PORT")}
MINIO_CONSOLE_PORT=${values.get("MINIO_CONSOLE_PORT")}
`;
}

function renderDockerEnv(values) {
  return `# Generated by pnpm env:setup. Do not commit this file.
APP_PORT=${values.get("APP_PORT")}
POSTGRES_PORT=${values.get("POSTGRES_PORT")}
POSTGRES_USER=${values.get("POSTGRES_USER")}
POSTGRES_PASSWORD=${encodeValue(values.get("POSTGRES_PASSWORD"))}
POSTGRES_DB=${values.get("POSTGRES_DB")}

ADMIN_CONSOLE_ENABLED=${values.get("ADMIN_CONSOLE_ENABLED")}
ADMIN_SESSION_SECRET=${encodeValue(values.get("ADMIN_SESSION_SECRET"))}
ADMIN_BOOTSTRAP_TOKEN=${encodeValue(values.get("ADMIN_BOOTSTRAP_TOKEN"))}
ADMIN_ORIGIN_ALLOWLIST=${encodeValue(values.get("ADMIN_ORIGIN_ALLOWLIST"))}

GATEWAY_API_KEY_PEPPER=${encodeValue(values.get("GATEWAY_API_KEY_PEPPER"))}
AI_CREDENTIAL_ENCRYPTION_KEY=${encodeValue(values.get("AI_CREDENTIAL_ENCRYPTION_KEY"))}
AI_PROVIDER_HOST_ALLOWLIST=${encodeValue(values.get("AI_PROVIDER_HOST_ALLOWLIST"))}
AI_PROVIDER_ALLOW_INSECURE_LOCALHOST=${values.get("AI_PROVIDER_ALLOW_INSECURE_LOCALHOST")}
GATEWAY_MIN_RESERVE_MICROUSD=${values.get("GATEWAY_MIN_RESERVE_MICROUSD")}
GATEWAY_MAX_BODY_BYTES=${values.get("GATEWAY_MAX_BODY_BYTES")}
RUN_DB_MIGRATIONS=${values.get("RUN_DB_MIGRATIONS")}

FILE_STORAGE_TYPE=${values.get("FILE_STORAGE_TYPE")}
FILE_STORAGE_PREFIX=${encodeValue(values.get("FILE_STORAGE_PREFIX"))}
BLOB_READ_WRITE_TOKEN=${encodeValue(values.get("BLOB_READ_WRITE_TOKEN"))}
FILE_STORAGE_S3_BUCKET=${encodeValue(values.get("FILE_STORAGE_S3_BUCKET"))}
FILE_STORAGE_S3_REGION=${encodeValue(values.get("FILE_STORAGE_S3_REGION"))}
FILE_STORAGE_S3_ENDPOINT=${encodeValue(values.get("FILE_STORAGE_S3_ENDPOINT"))}
FILE_STORAGE_S3_FORCE_PATH_STYLE=${values.get("FILE_STORAGE_S3_FORCE_PATH_STYLE")}
FILE_STORAGE_S3_PUBLIC_BASE_URL=${encodeValue(values.get("FILE_STORAGE_S3_PUBLIC_BASE_URL"))}
AWS_REGION=${encodeValue(values.get("AWS_REGION"))}
AWS_ACCESS_KEY_ID=${encodeValue(values.get("AWS_ACCESS_KEY_ID"))}
AWS_SECRET_ACCESS_KEY=${encodeValue(values.get("AWS_SECRET_ACCESS_KEY"))}
AWS_SESSION_TOKEN=${encodeValue(values.get("AWS_SESSION_TOKEN"))}
MINIO_USER=${encodeValue(values.get("MINIO_USER"))}
MINIO_PASSWORD=${encodeValue(values.get("MINIO_PASSWORD"))}
MINIO_API_PORT=${values.get("MINIO_API_PORT")}
MINIO_CONSOLE_PORT=${values.get("MINIO_CONSOLE_PORT")}
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
  if (
    root.has("STORY_DATABASE_URL") &&
    !isInkMemoryDatabaseUrl(root.get("STORY_DATABASE_URL") ?? "")
  ) {
    errors.push(
      "STORY_DATABASE_URL must use the ink-memory PostgreSQL database",
    );
  }
  if (docker.get("POSTGRES_DB") !== "ink-memory") {
    errors.push("POSTGRES_DB must be ink-memory");
  }
  if (!isDockerPostgresPassword(docker.get("POSTGRES_PASSWORD") ?? "")) {
    errors.push(
      "POSTGRES_PASSWORD must contain at least 16 URL-safe characters",
    );
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
    if (!['vercel-blob', 's3'].includes(values.get("FILE_STORAGE_TYPE") ?? "")) {
      errors.push(`${file}: FILE_STORAGE_TYPE must be vercel-blob or s3`);
    }
    if (!isBooleanFlag(values.get("FILE_STORAGE_S3_FORCE_PATH_STYLE") ?? "")) {
      errors.push(
        `${file}: FILE_STORAGE_S3_FORCE_PATH_STYLE must be true, false, 1, or 0`,
      );
    }
    if (!/^[A-Za-z0-9_-]{3,}$/.test(values.get("MINIO_USER") ?? "")) {
      errors.push(`${file}: MINIO_USER must contain at least 3 URL-safe characters`);
    }
    if (!isDockerPostgresPassword(values.get("MINIO_PASSWORD") ?? "")) {
      errors.push(`${file}: MINIO_PASSWORD must contain at least 16 URL-safe characters`);
    }
    for (const key of ["MINIO_API_PORT", "MINIO_CONSOLE_PORT"]) {
      if (!isInteger(values.get(key) ?? "", 1, 65_535)) {
        errors.push(`${file}: ${key} must be a valid TCP port`);
      }
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
  for (const key of ["APP_PORT", "POSTGRES_PORT"]) {
    if (!isInteger(docker.get(key) ?? "", 1, 65_535)) {
      errors.push(`docker/.env: ${key} must be a valid TCP port`);
    }
  }
  if (!isBoolean(docker.get("RUN_DB_MIGRATIONS") ?? "")) {
    errors.push("docker/.env: RUN_DB_MIGRATIONS must be true or false");
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
      "Environment structure is valid for ink-memory-admin; local MinIO credentials are managed automatically and external cloud credentials remain operator-managed.",
    );
    return;
  }

  const rootRemoved = unknownKeys(rootParsed.values, ROOT_KEYS);
  const dockerRemoved = unknownKeys(dockerParsed.values, DOCKER_KEYS);
  const configuration = buildConfiguration(
    rootParsed.values,
    dockerParsed.values,
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
    "Existing control-plane secrets and storage settings were preserved; missing control-plane secrets were generated.",
  );
}

await run();
