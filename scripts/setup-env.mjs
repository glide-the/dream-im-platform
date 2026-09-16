#!/usr/bin/env node
// [Input] Existing ignored Admin env files and secure random material.
// [Output] Mode-0600 local/Compose config preserving unified auth/data policy and Provider overrides.
// [Pos] Base configuration generator for the Admin workspace.
// [Sync] 2026-09-16: use localhost as the single local Admin OAuth origin so the Google callback matches the registered web client.
// [Sync] 2026-09-17: preserve and validate the independent Admin management-session TTL.
// [Sync] 2026-09-16: emit dotenv-compatible lossless quoting for structured Better Auth/Dream DTO configuration.
// [Sync] 2026-09-16: preserve, render and validate the complete Better Auth/Dream DTO service configuration.
// [Sync] 2026-09-16: validate embedded PostgreSQL connection capacity as a positive safe integer, independent of TCP port bounds.
// [Sync] 2026-09-04: leave product overrides empty so built-in cc-switch-compatible defaults remain active.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = resolve(scriptDirectory, "..");

const MANAGED_PROVIDER_KEYS = [
  "INK_PROVIDER_CODEX_CLIENT_ID",
  "INK_PROVIDER_CODEX_SCOPES",
  "INK_PROVIDER_CODEX_USER_AGENT",
  "INK_PROVIDER_CODEX_INTEGRATION_ID",
  "INK_PROVIDER_CODEX_INTEGRATION_VERSION",
  "INK_PROVIDER_CODEX_MODEL_CATALOG_CLIENT_VERSION",
  "INK_PROVIDER_CODEX_MODELS_ENDPOINT",
  "INK_PROVIDER_XAI_CLIENT_ID",
  "INK_PROVIDER_XAI_SCOPES",
  "INK_PROVIDER_XAI_USER_AGENT",
  "INK_PROVIDER_XAI_ISSUER",
  "INK_PROVIDER_XAI_MODELS_ENDPOINT",
  "INK_PROVIDER_GITHUB_COPILOT_CLIENT_ID",
  "INK_PROVIDER_GITHUB_COPILOT_CLIENT_SECRET",
  "INK_PROVIDER_GITHUB_COPILOT_SCOPES",
  "INK_PROVIDER_GITHUB_COPILOT_USER_AGENT",
  "INK_PROVIDER_GITHUB_COPILOT_INTEGRATION_ID",
  "INK_PROVIDER_GITHUB_COPILOT_EDITOR_VERSION",
  "INK_PROVIDER_GITHUB_COPILOT_EDITOR_PLUGIN_VERSION",
  "INK_PROVIDER_GITHUB_COPILOT_API_VERSION",
  "INK_PROVIDER_GITHUB_COPILOT_MODELS_ENDPOINT",
];

const UNIFIED_AUTH_DATA_KEYS = [
  "BETTER_AUTH_URL",
  "BETTER_AUTH_SECRET",
  "AUTH_DATABASE_URL",
  "ADMIN_CONTROL_DATABASE_URL",
  "DREAM_DATA_DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "AUTH_TRUSTED_ORIGINS",
  "DREAM_API_RESOURCE",
  "AUTH_TOKEN_ENCRYPTION_KEY",
  "AUTH_DEVICE_CLIENT_ID",
  "DREAM_DATA_SERVICE_CLIENTS",
  "DREAM_GATEWAY_CLIENT_BINDINGS",
  "AUTH_BROWSER_SESSION_TTL_SECONDS",
  "AUTH_REFRESH_SKEW_SECONDS",
  "AUTH_RUNTIME_DELEGATION_TTL_SECONDS",
  "AUTH_RUNTIME_DELEGATION_MAX_TTL_SECONDS",
  "AUTH_REFLECTIONS_AUTHORITY_TTL_SECONDS",
  "AUTH_REFLECTIONS_AUTHORITY_MAX_TTL_SECONDS",
  "AUTH_BCRYPT_COST",
  "AUTH_MAX_BODY_BYTES",
  "AUTH_PGPOOL_MAX",
  "DREAM_DATA_PGPOOL_MAX",
  "DREAM_DATA_MAX_BODY_BYTES",
  "DREAM_DOMAIN_CANONICAL_TIMEOUT_MS",
  "DREAM_WORKSPACE_PLUGIN_POLICY_JSON",
  "DREAM_RUNTIME_ACTIVATION_POLICY_JSON",
  "DREAM_DECK_POLICY_JSON",
  "DREAM_REFLECTION_REPORT_LIST_MAX_ROWS",
  "DREAM_REFLECTIONS_LAUNCH_SNAPSHOT_MAX_BYTES",
  "DREAM_REFLECTIONS_WORKSPACE_ROOT",
  "DREAM_FRIENDSHIP_POLICY_JSON",
  "DREAM_CONFIRMATION_DISPATCH_LEASE_SECONDS",
  "INK_WORKFLOW_TOKEN_SECRET",
  "DREAM_PREFLIGHT_TOKEN_TTL_SECONDS",
  "DREAM_PREFLIGHT_MAX_INPUT_BYTES",
  "INK_DECK_HOST_COMPATIBLE",
  "INK_CLAUDE_AGENT_CONTRACT_COMPATIBLE",
  "INK_STORY_SCHEMA_COMPATIBLE",
  "INK_DECK_RUNTIME_CONFIG_COMPATIBLE",
  "DREAM_WORKFLOW_CONTEXT_MAX_ATTEMPTS",
  "DREAM_CHAT_AUTO_TITLE_MAX_CHARACTERS",
  "GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE",
];

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
  "ADMIN_SESSION_TTL_SECONDS",
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
  "AI_CREDENTIAL_ENCRYPTION_KEY_ID",
  "AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER",
  ...MANAGED_PROVIDER_KEYS,
  "AI_PROVIDER_HOST_ALLOWLIST",
  "AI_PROVIDER_ALLOW_INSECURE_LOCALHOST",
  "GATEWAY_MIN_RESERVE_MICROUSD",
  "GATEWAY_MAX_BODY_BYTES",
  "ARTIFACT_WORKSPACE_ROOT",
  "ARTIFACT_PREVIEW_MAX_FILE_BYTES",
  "FILE_STORAGE_TYPE",
  "FILE_STORAGE_PREFIX",
  ...UNIFIED_AUTH_DATA_KEYS,
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
  "ADMIN_SESSION_TTL_SECONDS",
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
  "AI_CREDENTIAL_ENCRYPTION_KEY_ID",
  "AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER",
  ...MANAGED_PROVIDER_KEYS,
  "AI_PROVIDER_HOST_ALLOWLIST",
  "AI_PROVIDER_ALLOW_INSECURE_LOCALHOST",
  "GATEWAY_MIN_RESERVE_MICROUSD",
  "GATEWAY_MAX_BODY_BYTES",
  "RUN_DB_MIGRATIONS",
  "ARTIFACT_WORKSPACE_ROOT",
  "ARTIFACT_PREVIEW_MAX_FILE_BYTES",
  "FILE_STORAGE_TYPE",
  "FILE_STORAGE_PREFIX",
  ...UNIFIED_AUTH_DATA_KEYS,
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

function optionalConfiguration(existing, keys) {
  return keys.map((key) => [
    key,
    configuredValue(existing, key, (value) => !/[\r\n]/.test(value), ""),
  ]);
}

function unifiedAuthDataConfiguration(existing, options) {
  const stringValue = (key, fallback = "") => configuredValue(
    existing,
    key,
    (value) => !/[\r\n]/.test(value),
    fallback,
  );
  const integerValue = (key, fallback, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) => configuredValue(
    existing,
    key,
    (value) => isInteger(value, minimum, maximum),
    fallback,
  );
  const defaultServiceClients = JSON.stringify([{
    id: "ink-dream-service",
    secret: options.serviceSecret,
    origin: options.dreamOrigin,
    oauthClientId: "ink-dream-browser",
    redirectUri: `${options.dreamOrigin}/auth/callback`,
    backgroundScopes: [
      "capabilities:read",
      "resource-policy:read",
      "resource-observer:write",
      "connectors:sync",
      "plugins:catalog",
      "reflections:execute",
      "story-confirmation:dispatch",
    ],
  }]);
  return [
    ["BETTER_AUTH_URL", stringValue("BETTER_AUTH_URL", options.betterAuthUrl)],
    ["BETTER_AUTH_SECRET", options.betterAuthSecret],
    ["AUTH_DATABASE_URL", stringValue("AUTH_DATABASE_URL")],
    ["ADMIN_CONTROL_DATABASE_URL", stringValue("ADMIN_CONTROL_DATABASE_URL")],
    ["DREAM_DATA_DATABASE_URL", stringValue("DREAM_DATA_DATABASE_URL")],
    ["GOOGLE_CLIENT_ID", stringValue("GOOGLE_CLIENT_ID")],
    ["GOOGLE_CLIENT_SECRET", stringValue("GOOGLE_CLIENT_SECRET")],
    ["AUTH_TRUSTED_ORIGINS", stringValue("AUTH_TRUSTED_ORIGINS", `${options.adminOrigin},${options.dreamOrigin}`)],
    ["DREAM_API_RESOURCE", stringValue("DREAM_API_RESOURCE", `${options.dreamOrigin}/api`)],
    ["AUTH_TOKEN_ENCRYPTION_KEY", options.authTokenEncryptionKey],
    ["AUTH_DEVICE_CLIENT_ID", stringValue("AUTH_DEVICE_CLIENT_ID", "ink-dream-device")],
    ["DREAM_DATA_SERVICE_CLIENTS", stringValue("DREAM_DATA_SERVICE_CLIENTS", defaultServiceClients)],
    ["DREAM_GATEWAY_CLIENT_BINDINGS", stringValue("DREAM_GATEWAY_CLIENT_BINDINGS")],
    ["AUTH_BROWSER_SESSION_TTL_SECONDS", integerValue("AUTH_BROWSER_SESSION_TTL_SECONDS", "2592000")],
    ["AUTH_REFRESH_SKEW_SECONDS", integerValue("AUTH_REFRESH_SKEW_SECONDS", "30", 0, 299)],
    ["AUTH_RUNTIME_DELEGATION_TTL_SECONDS", integerValue("AUTH_RUNTIME_DELEGATION_TTL_SECONDS", "300")],
    ["AUTH_RUNTIME_DELEGATION_MAX_TTL_SECONDS", integerValue("AUTH_RUNTIME_DELEGATION_MAX_TTL_SECONDS", "3600")],
    ["AUTH_REFLECTIONS_AUTHORITY_TTL_SECONDS", integerValue("AUTH_REFLECTIONS_AUTHORITY_TTL_SECONDS", "300")],
    ["AUTH_REFLECTIONS_AUTHORITY_MAX_TTL_SECONDS", integerValue("AUTH_REFLECTIONS_AUTHORITY_MAX_TTL_SECONDS", "3600")],
    ["AUTH_BCRYPT_COST", integerValue("AUTH_BCRYPT_COST", "12", 10, 16)],
    ["AUTH_MAX_BODY_BYTES", integerValue("AUTH_MAX_BODY_BYTES", "16384")],
    ["AUTH_PGPOOL_MAX", integerValue("AUTH_PGPOOL_MAX", "10", 1, 100)],
    ["DREAM_DATA_PGPOOL_MAX", integerValue("DREAM_DATA_PGPOOL_MAX", "10", 1, 100)],
    ["DREAM_DATA_MAX_BODY_BYTES", integerValue("DREAM_DATA_MAX_BODY_BYTES", "1048576")],
    ["DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", integerValue("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000")],
    ["DREAM_WORKSPACE_PLUGIN_POLICY_JSON", stringValue("DREAM_WORKSPACE_PLUGIN_POLICY_JSON")],
    ["DREAM_RUNTIME_ACTIVATION_POLICY_JSON", stringValue("DREAM_RUNTIME_ACTIVATION_POLICY_JSON")],
    ["DREAM_DECK_POLICY_JSON", stringValue("DREAM_DECK_POLICY_JSON")],
    ["DREAM_REFLECTION_REPORT_LIST_MAX_ROWS", integerValue("DREAM_REFLECTION_REPORT_LIST_MAX_ROWS", "100")],
    ["DREAM_REFLECTIONS_LAUNCH_SNAPSHOT_MAX_BYTES", integerValue("DREAM_REFLECTIONS_LAUNCH_SNAPSHOT_MAX_BYTES", "1048576")],
    ["DREAM_REFLECTIONS_WORKSPACE_ROOT", stringValue("DREAM_REFLECTIONS_WORKSPACE_ROOT", options.reflectionsRoot)],
    ["DREAM_FRIENDSHIP_POLICY_JSON", stringValue("DREAM_FRIENDSHIP_POLICY_JSON", '{"code_length":6,"lifetime_seconds":604800,"generation_attempts":64}')],
    ["DREAM_CONFIRMATION_DISPATCH_LEASE_SECONDS", integerValue("DREAM_CONFIRMATION_DISPATCH_LEASE_SECONDS", "120")],
    ["INK_WORKFLOW_TOKEN_SECRET", options.workflowTokenSecret],
    ["DREAM_PREFLIGHT_TOKEN_TTL_SECONDS", integerValue("DREAM_PREFLIGHT_TOKEN_TTL_SECONDS", "300")],
    ["DREAM_PREFLIGHT_MAX_INPUT_BYTES", integerValue("DREAM_PREFLIGHT_MAX_INPUT_BYTES", "65536")],
    ["INK_DECK_HOST_COMPATIBLE", stringValue("INK_DECK_HOST_COMPATIBLE", "true")],
    ["INK_CLAUDE_AGENT_CONTRACT_COMPATIBLE", stringValue("INK_CLAUDE_AGENT_CONTRACT_COMPATIBLE", "true")],
    ["INK_STORY_SCHEMA_COMPATIBLE", stringValue("INK_STORY_SCHEMA_COMPATIBLE", "true")],
    ["INK_DECK_RUNTIME_CONFIG_COMPATIBLE", stringValue("INK_DECK_RUNTIME_CONFIG_COMPATIBLE", "true")],
    ["DREAM_WORKFLOW_CONTEXT_MAX_ATTEMPTS", integerValue("DREAM_WORKFLOW_CONTEXT_MAX_ATTEMPTS", "256")],
    ["DREAM_CHAT_AUTO_TITLE_MAX_CHARACTERS", integerValue("DREAM_CHAT_AUTO_TITLE_MAX_CHARACTERS", "50")],
    ["GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE", integerValue("GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE", "4784")],
  ];
}

function configuredDreamServiceSecret(existing) {
  try {
    const clients = JSON.parse(existing.get("DREAM_DATA_SERVICE_CLIENTS") ?? "");
    const secret = Array.isArray(clients) ? clients[0]?.secret : undefined;
    return typeof secret === "string" && hasMinimumBytes(secret) ? secret : undefined;
  } catch {
    return undefined;
  }
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
  const accountIdentityPepper = pairedSecret(
    rootExisting,
    dockerExisting,
    "AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER",
    hasMinimumBytes,
    () => randomSecret("provider_identity_"),
  );
  const betterAuthSecret = pairedSecret(
    rootExisting,
    dockerExisting,
    "BETTER_AUTH_SECRET",
    hasMinimumBytes,
    () => randomSecret("better_auth_"),
  );
  const authTokenEncryptionKey = pairedSecret(
    rootExisting,
    dockerExisting,
    "AUTH_TOKEN_ENCRYPTION_KEY",
    isEncryptionKey,
    () => randomBytes(32).toString("base64"),
  );
  const workflowTokenSecret = pairedSecret(
    rootExisting,
    dockerExisting,
    "INK_WORKFLOW_TOKEN_SECRET",
    hasMinimumBytes,
    () => randomSecret("workflow_"),
  );
  const sharedDreamServiceSecret = configuredDreamServiceSecret(rootExisting)
    ?? configuredDreamServiceSecret(dockerExisting)
    ?? randomSecret("dream_service_");
  const dreamServiceSecret = {
    root: configuredDreamServiceSecret(rootExisting) ?? sharedDreamServiceSecret,
    docker: configuredDreamServiceSecret(dockerExisting) ?? sharedDreamServiceSecret,
  };
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
    ["ADMIN_SESSION_TTL_SECONDS", configuredValue(rootExisting, "ADMIN_SESSION_TTL_SECONDS", (value) => isInteger(value, 1), "28800")],
    ["ADMIN_BOOTSTRAP_TOKEN", adminBootstrapToken.root],
    ["ADMIN_ORIGIN_ALLOWLIST", rootOriginAllowlist],
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
    ["AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER", accountIdentityPepper.root],
    ...optionalConfiguration(rootExisting, [
      "AI_CREDENTIAL_ENCRYPTION_KEY_ID",
      ...MANAGED_PROVIDER_KEYS,
    ]),
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
    ...unifiedAuthDataConfiguration(rootExisting, {
      betterAuthSecret: betterAuthSecret.root,
      authTokenEncryptionKey: authTokenEncryptionKey.root,
      workflowTokenSecret: workflowTokenSecret.root,
      serviceSecret: dreamServiceSecret.root,
      adminOrigin: "http://localhost:3000",
      dreamOrigin: "http://localhost:5173",
      betterAuthUrl: "http://localhost:3000/api/auth",
      reflectionsRoot: resolve(projectRoot, "../ink-dream-memory/backend/data/agent-workspace/reflections"),
    }),
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
    ["ADMIN_SESSION_TTL_SECONDS", configuredValue(dockerExisting, "ADMIN_SESSION_TTL_SECONDS", (value) => isInteger(value, 1), "28800")],
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
    ["AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER", accountIdentityPepper.docker],
    ...optionalConfiguration(dockerExisting, [
      "AI_CREDENTIAL_ENCRYPTION_KEY_ID",
      ...MANAGED_PROVIDER_KEYS,
    ]),
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
    ...unifiedAuthDataConfiguration(dockerExisting, {
      betterAuthSecret: betterAuthSecret.docker,
      authTokenEncryptionKey: authTokenEncryptionKey.docker,
      workflowTokenSecret: workflowTokenSecret.docker,
      serviceSecret: dreamServiceSecret.docker,
      adminOrigin: "http://localhost:3000",
      dreamOrigin: "http://localhost:5173",
      betterAuthUrl: "http://localhost:3000/api/auth",
      reflectionsRoot: "/artifacts/reflections",
    }),
  ]);

  return { root, docker };
}

function encodeValue(value) {
  if (/[\r\n]/.test(value)) {
    throw new Error("Environment values must not contain newlines");
  }
  if (/^[A-Za-z0-9_./:@%+,=\-]*$/.test(value)) return value;
  for (const quote of ["'", "`"]) {
    if (!value.includes(quote)) return `${quote}${value}${quote}`;
  }
  try {
    JSON.parse(value);
    return `'${value.replaceAll("'", "\\u0027")}'`;
  } catch {
    throw new Error("Environment values containing both apostrophes and backticks must be valid JSON");
  }
}

function renderUnifiedAuthDataEnv(values) {
  return UNIFIED_AUTH_DATA_KEYS
    .map((key) => `${key}=${encodeValue(values.get(key))}`)
    .join("\n");
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
ADMIN_SESSION_TTL_SECONDS=${values.get("ADMIN_SESSION_TTL_SECONDS")}
ADMIN_BOOTSTRAP_TOKEN=${encodeValue(values.get("ADMIN_BOOTSTRAP_TOKEN"))}
ADMIN_ORIGIN_ALLOWLIST=${encodeValue(values.get("ADMIN_ORIGIN_ALLOWLIST"))}

# Unified Better Auth, OAuth/OIDC, Device Flow and Dream DTO/ORM service boundary.
# Google credentials, limited-role DSNs, Gateway binding and business policies must be reviewed explicitly.
${renderUnifiedAuthDataEnv(values)}

# Gateway key hashing and encrypted Provider credentials.
GATEWAY_API_KEY_PEPPER=${encodeValue(values.get("GATEWAY_API_KEY_PEPPER"))}
GATEWAY_SUBJECT_JWT_ISSUER=${encodeValue(values.get("GATEWAY_SUBJECT_JWT_ISSUER"))}
GATEWAY_SUBJECT_JWT_AUDIENCE=${encodeValue(values.get("GATEWAY_SUBJECT_JWT_AUDIENCE"))}
AI_CREDENTIAL_ENCRYPTION_KEY=${encodeValue(values.get("AI_CREDENTIAL_ENCRYPTION_KEY"))}
AI_CREDENTIAL_ENCRYPTION_KEY_ID=${encodeValue(values.get("AI_CREDENTIAL_ENCRYPTION_KEY_ID"))}
AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER=${encodeValue(values.get("AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER"))}
AI_PROVIDER_HOST_ALLOWLIST=${encodeValue(values.get("AI_PROVIDER_HOST_ALLOWLIST"))}
AI_PROVIDER_ALLOW_INSECURE_LOCALHOST=${values.get("AI_PROVIDER_ALLOW_INSECURE_LOCALHOST")}
GATEWAY_MIN_RESERVE_MICROUSD=${values.get("GATEWAY_MIN_RESERVE_MICROUSD")}
GATEWAY_MAX_BODY_BYTES=${values.get("GATEWAY_MAX_BODY_BYTES")}

# Optional managed-product overrides. Empty values use pinned built-in defaults.
${MANAGED_PROVIDER_KEYS.map((key) => `${key}=${encodeValue(values.get(key))}`).join("\n")}

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
ADMIN_SESSION_TTL_SECONDS=${values.get("ADMIN_SESSION_TTL_SECONDS")}
ADMIN_BOOTSTRAP_TOKEN=${encodeValue(values.get("ADMIN_BOOTSTRAP_TOKEN"))}
ADMIN_ORIGIN_ALLOWLIST=${encodeValue(values.get("ADMIN_ORIGIN_ALLOWLIST"))}

# Unified Better Auth, OAuth/OIDC, Device Flow and Dream DTO/ORM service boundary.
${renderUnifiedAuthDataEnv(values)}

GATEWAY_API_KEY_PEPPER=${encodeValue(values.get("GATEWAY_API_KEY_PEPPER"))}
GATEWAY_SUBJECT_JWT_ISSUER=${encodeValue(values.get("GATEWAY_SUBJECT_JWT_ISSUER"))}
GATEWAY_SUBJECT_JWT_AUDIENCE=${encodeValue(values.get("GATEWAY_SUBJECT_JWT_AUDIENCE"))}
AI_CREDENTIAL_ENCRYPTION_KEY=${encodeValue(values.get("AI_CREDENTIAL_ENCRYPTION_KEY"))}
AI_CREDENTIAL_ENCRYPTION_KEY_ID=${encodeValue(values.get("AI_CREDENTIAL_ENCRYPTION_KEY_ID"))}
AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER=${encodeValue(values.get("AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER"))}
AI_PROVIDER_HOST_ALLOWLIST=${encodeValue(values.get("AI_PROVIDER_HOST_ALLOWLIST"))}
AI_PROVIDER_ALLOW_INSECURE_LOCALHOST=${values.get("AI_PROVIDER_ALLOW_INSECURE_LOCALHOST")}
GATEWAY_MIN_RESERVE_MICROUSD=${values.get("GATEWAY_MIN_RESERVE_MICROUSD")}
GATEWAY_MAX_BODY_BYTES=${values.get("GATEWAY_MAX_BODY_BYTES")}
${MANAGED_PROVIDER_KEYS.map((key) => `${key}=${encodeValue(values.get(key))}`).join("\n")}
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

function isExactServiceUrl(value, originOnly = false) {
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    return !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === "https:" || (url.protocol === "http:" && loopback))
      && (!originOnly || url.pathname === "/");
  } catch {
    return false;
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function validateUnifiedAuthData(values, file, errors) {
  const issuer = values.get("BETTER_AUTH_URL") ?? "";
  if (!isExactServiceUrl(issuer) || new URL(issuer).pathname !== "/api/auth") {
    errors.push(`${file}: BETTER_AUTH_URL must be an exact HTTPS or loopback /api/auth URL`);
  }
  if (!hasMinimumBytes(values.get("BETTER_AUTH_SECRET") ?? "")) {
    errors.push(`${file}: BETTER_AUTH_SECRET must contain at least 32 bytes`);
  }
  const roleKeys = ["AUTH_DATABASE_URL", "ADMIN_CONTROL_DATABASE_URL", "DREAM_DATA_DATABASE_URL"];
  const roleUsers = [];
  for (const key of roleKeys) {
    const value = values.get(key) ?? "";
    if (!isInkMemoryDatabaseUrl(value)) {
      errors.push(`${file}: ${key} must explicitly target the ink-memory PostgreSQL database`);
      continue;
    }
    roleUsers.push(new URL(value).username);
  }
  if (roleUsers.length === roleKeys.length && (roleUsers.some((value) => !value) || new Set(roleUsers).size !== roleUsers.length)) {
    errors.push(`${file}: auth, control and Dream data database URLs must use three distinct named roles`);
  }
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "AUTH_DEVICE_CLIENT_ID"]) {
    if (!(values.get(key) ?? "").trim()) errors.push(`${file}: ${key} must not be empty`);
  }
  const resource = values.get("DREAM_API_RESOURCE") ?? "";
  if (!isExactServiceUrl(resource) || new URL(resource).pathname !== "/api") {
    errors.push(`${file}: DREAM_API_RESOURCE must be an exact HTTPS or loopback /api URL`);
  }
  const trustedOrigins = (values.get("AUTH_TRUSTED_ORIGINS") ?? "").split(",").map(value => value.trim()).filter(Boolean);
  if (!trustedOrigins.length || trustedOrigins.some(value => !isExactServiceUrl(value, true))) {
    errors.push(`${file}: AUTH_TRUSTED_ORIGINS must contain exact HTTPS or loopback origins`);
  } else if (isExactServiceUrl(issuer) && !trustedOrigins.includes(new URL(issuer).origin)) {
    errors.push(`${file}: AUTH_TRUSTED_ORIGINS must include the Better Auth origin`);
  } else if (isExactServiceUrl(resource) && !trustedOrigins.includes(new URL(resource).origin)) {
    errors.push(`${file}: AUTH_TRUSTED_ORIGINS must include the Dream resource origin`);
  }
  if (!isEncryptionKey(values.get("AUTH_TOKEN_ENCRYPTION_KEY") ?? "")) {
    errors.push(`${file}: AUTH_TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes`);
  }
  if (!hasMinimumBytes(values.get("INK_WORKFLOW_TOKEN_SECRET") ?? "")) {
    errors.push(`${file}: INK_WORKFLOW_TOKEN_SECRET must contain at least 32 bytes`);
  }
  let serviceClientIds = new Set();
  let oauthClientIds = new Set();
  try {
    const clients = JSON.parse(values.get("DREAM_DATA_SERVICE_CLIENTS") ?? "");
    const allowedScopes = new Set(["capabilities:read", "resource-policy:read", "resource-observer:write", "connectors:sync", "plugins:catalog", "reflections:execute", "story-confirmation:dispatch"]);
    const resourceOrigin = isExactServiceUrl(resource) ? new URL(resource).origin : "";
    const valid = Array.isArray(clients) && clients.length > 0
      && new Set(clients.map(client => client?.id)).size === clients.length
      && clients.every(client => client && typeof client.id === "string" && client.id
        && typeof client.secret === "string" && hasMinimumBytes(client.secret)
        && isExactServiceUrl(client.origin, true) && isExactServiceUrl(client.redirectUri)
        && new URL(client.origin).origin === new URL(client.redirectUri).origin
        && new URL(client.redirectUri).pathname === "/auth/callback"
        && new URL(client.origin).origin === resourceOrigin
        && trustedOrigins.includes(new URL(client.origin).origin)
        && typeof client.oauthClientId === "string" && client.oauthClientId
        && Array.isArray(client.backgroundScopes)
        && new Set(client.backgroundScopes).size === client.backgroundScopes.length
        && client.backgroundScopes.every(scope => allowedScopes.has(scope)));
    if (!valid) errors.push(`${file}: DREAM_DATA_SERVICE_CLIENTS must be a strict non-empty registered client array`);
    if (valid) {
      serviceClientIds = new Set(clients.map(client => client.id));
      oauthClientIds = new Set(clients.map(client => client.oauthClientId));
      oauthClientIds.add(values.get("AUTH_DEVICE_CLIENT_ID"));
    }
  } catch {
    errors.push(`${file}: DREAM_DATA_SERVICE_CLIENTS must be valid JSON`);
  }
  try {
    const bindings = JSON.parse(values.get("DREAM_GATEWAY_CLIENT_BINDINGS") ?? "");
    const valid = Array.isArray(bindings) && bindings.length > 0
      && new Set(bindings.map(binding => binding?.service_client_id)).size === bindings.length
      && bindings.every(binding => binding && typeof binding.service_client_id === "string" && binding.service_client_id
        && serviceClientIds.has(binding.service_client_id)
        && typeof binding.gateway_client_id === "string" && binding.gateway_client_id
        && Array.isArray(binding.oauth_client_ids) && binding.oauth_client_ids.length > 0
        && new Set(binding.oauth_client_ids).size === binding.oauth_client_ids.length
        && binding.oauth_client_ids.every(value => typeof value === "string" && oauthClientIds.has(value)));
    if (!valid) errors.push(`${file}: DREAM_GATEWAY_CLIENT_BINDINGS must be a strict non-empty binding array`);
  } catch {
    errors.push(`${file}: DREAM_GATEWAY_CLIENT_BINDINGS must be valid JSON`);
  }
  const positiveKeys = [
    "AUTH_BROWSER_SESSION_TTL_SECONDS", "AUTH_RUNTIME_DELEGATION_TTL_SECONDS", "AUTH_RUNTIME_DELEGATION_MAX_TTL_SECONDS",
    "AUTH_REFLECTIONS_AUTHORITY_TTL_SECONDS", "AUTH_REFLECTIONS_AUTHORITY_MAX_TTL_SECONDS", "AUTH_MAX_BODY_BYTES",
    "AUTH_PGPOOL_MAX", "DREAM_DATA_PGPOOL_MAX", "DREAM_DATA_MAX_BODY_BYTES", "DREAM_DOMAIN_CANONICAL_TIMEOUT_MS",
    "DREAM_REFLECTION_REPORT_LIST_MAX_ROWS", "DREAM_REFLECTIONS_LAUNCH_SNAPSHOT_MAX_BYTES", "DREAM_CONFIRMATION_DISPATCH_LEASE_SECONDS",
    "DREAM_PREFLIGHT_TOKEN_TTL_SECONDS", "DREAM_PREFLIGHT_MAX_INPUT_BYTES", "DREAM_WORKFLOW_CONTEXT_MAX_ATTEMPTS",
    "DREAM_CHAT_AUTO_TITLE_MAX_CHARACTERS", "GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE",
  ];
  for (const key of positiveKeys) if (!isInteger(values.get(key) ?? "", 1)) errors.push(`${file}: ${key} must be a positive safe integer`);
  if (!isInteger(values.get("AUTH_REFRESH_SKEW_SECONDS") ?? "", 0, 299)) errors.push(`${file}: AUTH_REFRESH_SKEW_SECONDS must be between 0 and 299`);
  if (!isInteger(values.get("AUTH_BCRYPT_COST") ?? "", 10, 16)) errors.push(`${file}: AUTH_BCRYPT_COST must be between 10 and 16`);
  const delegationTtl = Number(values.get("AUTH_RUNTIME_DELEGATION_TTL_SECONDS"));
  const delegationMax = Number(values.get("AUTH_RUNTIME_DELEGATION_MAX_TTL_SECONDS"));
  if (Number.isSafeInteger(delegationTtl) && Number.isSafeInteger(delegationMax) && delegationTtl > delegationMax) errors.push(`${file}: Runtime delegation TTL must not exceed its maximum TTL`);
  const reflectionsTtl = Number(values.get("AUTH_REFLECTIONS_AUTHORITY_TTL_SECONDS"));
  const reflectionsMax = Number(values.get("AUTH_REFLECTIONS_AUTHORITY_MAX_TTL_SECONDS"));
  if (Number.isSafeInteger(reflectionsTtl) && Number.isSafeInteger(reflectionsMax) && reflectionsTtl > reflectionsMax) errors.push(`${file}: Reflections authority TTL must not exceed its maximum TTL`);
  for (const key of ["DREAM_WORKSPACE_PLUGIN_POLICY_JSON", "DREAM_RUNTIME_ACTIVATION_POLICY_JSON", "DREAM_DECK_POLICY_JSON", "DREAM_FRIENDSHIP_POLICY_JSON"]) {
    if (!parseJsonObject(values.get(key) ?? "")) errors.push(`${file}: ${key} must be a JSON object`);
  }
  if (!isAbsolute(values.get("DREAM_REFLECTIONS_WORKSPACE_ROOT") ?? "")) errors.push(`${file}: DREAM_REFLECTIONS_WORKSPACE_ROOT must be an absolute path`);
  for (const key of ["INK_DECK_HOST_COMPATIBLE", "INK_CLAUDE_AGENT_CONTRACT_COMPATIBLE", "INK_STORY_SCHEMA_COMPATIBLE", "INK_DECK_RUNTIME_CONFIG_COMPATIBLE"]) {
    if (!isBoolean(values.get(key) ?? "")) errors.push(`${file}: ${key} must be true or false`);
  }
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
  for (const [file, values] of [[".env.local", root], ["docker/.env", docker]]) {
    if (!isInteger(values.get("ADMIN_SESSION_TTL_SECONDS") ?? "", 1)) errors.push(`${file}: ADMIN_SESSION_TTL_SECONDS must be a positive safe integer`);
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
    validateUnifiedAuthData(values, file, errors);
    if (!isEncryptionKey(values.get("AI_CREDENTIAL_ENCRYPTION_KEY") ?? "")) {
      errors.push(
        `${file}: AI_CREDENTIAL_ENCRYPTION_KEY must encode exactly 32 bytes`,
      );
    }
    if (!hasMinimumBytes(values.get("AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER") ?? "")) {
      errors.push(
        `${file}: AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER must contain at least 32 bytes`,
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
  for (const key of ["APP_PORT", "POSTGRES_PORT"]) {
    if (!isInteger(docker.get(key) ?? "", 1, 65_535)) {
      errors.push(`docker/.env: ${key} must be a valid TCP port`);
    }
  }
  if (!isInteger(docker.get("EMBEDDED_POSTGRES_MAX_CONNECTIONS") ?? "", 1)) {
    errors.push(
      "docker/.env: EMBEDDED_POSTGRES_MAX_CONNECTIONS must be a positive safe integer",
    );
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
      "Environment configuration is valid for ink-memory-admin; unified auth/data roles are explicit and file storage is disabled.",
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
    "Existing control-plane, unified-auth and PostgreSQL secrets were preserved; configure external Google credentials, limited-role DSNs, Gateway binding and business policy JSON before env:check.",
  );
}

await run();
