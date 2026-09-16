#!/usr/bin/env node
// [Input] Exact clean Admin/Dream release worktrees, explicit migration DSN and a private cutover manifest containing backup proof and limited-role secrets.
// [Output] Redacted dry-run evidence or one transactionally activated auth/control/data/Dream-no-DB ACL boundary.
// [Pos] Human-approved normal-database release step; never invoked by migration, application startup or tests implicitly.
// [Sync] 2026-09-16: bind v2 activation to exact clean Admin/Dream commits before backup or database access.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  assertLimitedRoles,
  buildAuthAccessPolicy,
  quoteIdentifier,
  validateRoleNames,
} from "../drizzle/data/auth-access-policy-plan.mjs";
import { verifyGitReleaseBinding } from "./unified-auth-data-release-binding.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const requiredCapabilities = new Map([
  ["identity.better-auth.v1", 1],
  ["identity.runtime-delegation.v1", 1],
  ["identity.registration-integrity.v1", 1],
  ["identity.runtime-purpose.v1", 1],
  ["dream.deck-content-canonical-storage.v1", 1],
  ["dream.workflow-preflight-request.v1", 1],
  ["dream.reflection-task-persistence.v1", 1],
  ["identity.runtime-confirmation-claim.v1", 1],
]);

function fail(code) {
  throw new Error(code);
}

function exactKeys(value, expected) {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function minimumSecret(value) {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") >= 32;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function sha256(path) {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function privateRegularFile(path, code) {
  if (typeof path !== "string" || !isAbsolute(path)) fail(code);
  const info = await lstat(path).catch(() => fail(code));
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0
    || (typeof process.getuid === "function" && info.uid !== process.getuid())) fail(code);
  return info;
}

function parseManifest(text) {
  let config;
  try { config = JSON.parse(text); } catch { fail("AUTH_DATA_CUTOVER_CONFIG_INVALID"); }
  if (!exactKeys(config, [
    "schema", "admin_commit", "dream_commit", "database", "backup", "roles", "gateway_client_id", "activation_state",
  ]) || config.schema !== "admin-auth-data-cutover/v2"
    || !/^[0-9a-f]{40}$/.test(config.admin_commit)
    || !/^[0-9a-f]{40}$/.test(config.dream_commit)
    || config.activation_state !== "prepared-not-applied"
    || typeof config.gateway_client_id !== "string" || !config.gateway_client_id) {
    fail("AUTH_DATA_CUTOVER_CONFIG_INVALID");
  }
  if (!exactKeys(config.database, ["name", "port", "data_directory", "migrations_before", "migrations_target"])
    || config.database.name !== "ink-memory"
    || !Number.isSafeInteger(config.database.port) || config.database.port < 1 || config.database.port > 65_535
    || typeof config.database.data_directory !== "string" || !isAbsolute(config.database.data_directory)
    || !Number.isSafeInteger(config.database.migrations_before) || config.database.migrations_before < 1
    || !Number.isSafeInteger(config.database.migrations_target)
    || config.database.migrations_target <= config.database.migrations_before) {
    fail("AUTH_DATA_CUTOVER_TARGET_INVALID");
  }
  if (!exactKeys(config.backup, ["path", "sha256"])
    || typeof config.backup.path !== "string" || !isAbsolute(config.backup.path)
    || typeof config.backup.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(config.backup.sha256)) {
    fail("AUTH_DATA_CUTOVER_BACKUP_INVALID");
  }
  if (!exactKeys(config.roles, ["auth", "control", "data", "dream"])
    || !exactKeys(config.roles.auth, ["name", "password"])
    || !exactKeys(config.roles.control, ["name", "password"])
    || !exactKeys(config.roles.data, ["name", "password"])
    || !exactKeys(config.roles.dream, ["name", "login"])
    || config.roles.dream.login !== false
    || !minimumSecret(config.roles.auth.password)
    || !minimumSecret(config.roles.control.password)
    || !minimumSecret(config.roles.data.password)) {
    fail("AUTH_DATA_CUTOVER_ROLES_INVALID");
  }
  const roles = Object.fromEntries(
    Object.entries(config.roles).map(([key, role]) => [key, role.name]),
  );
  if (!validateRoleNames(roles)) fail("AUTH_DATA_CUTOVER_ROLES_INVALID");
  return { config, roles };
}

function roleConnectionString(ownerUrl, database, role, password) {
  const url = new URL(ownerUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${database}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function verifyRoleCredential(ownerUrl, database, name, password) {
  const client = new pg.Client({ connectionString: roleConnectionString(ownerUrl, database, name, password) });
  await client.connect();
  try {
    const row = (await client.query("SELECT current_database() AS database, current_user AS role")).rows[0];
    if (row.database !== database || row.role !== name) fail("AUTH_DATA_ROLE_CREDENTIAL_MISMATCH");
  } finally {
    await client.end();
  }
}

async function verifyRoleProbes(ownerUrl, config, roles) {
  const credentials = {
    auth: config.roles.auth.password,
    control: config.roles.control.password,
    data: config.roles.data.password,
  };
  for (const key of Object.keys(credentials)) {
    await verifyRoleCredential(ownerUrl, config.database.name, roles[key], credentials[key]);
  }
  const allowedProbes = [
    ["auth", "SELECT id FROM identity.\"user\" LIMIT 0"],
    ["control", "SELECT id FROM public.admin_users LIMIT 0"],
    ["data", "SELECT id FROM public.chat_thread LIMIT 0"],
    ["data", "SELECT \"publicKey\" FROM identity.jwks LIMIT 0"],
  ];
  for (const [key, sql] of allowedProbes) {
    const client = new pg.Client({
      connectionString: roleConnectionString(
        ownerUrl,
        config.database.name,
        roles[key],
        credentials[key],
      ),
    });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  }
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    const denied = (await owner.query(
      `SELECT
         has_table_privilege($1, 'public.chat_thread', 'SELECT') AS auth_thread,
         has_table_privilege($2, 'public.chat_thread', 'SELECT') AS control_thread,
         has_column_privilege($3, 'identity.jwks', 'privateKey', 'SELECT') AS data_private_jwk,
         has_database_privilege($4, current_database(), 'CONNECT') AS dream_connect`,
      [roles.auth, roles.control, roles.data, roles.dream],
    )).rows[0];
    if (denied.auth_thread || denied.control_thread || denied.data_private_jwk || denied.dream_connect) {
      fail("AUTH_DATA_ROLE_PROBE_FAILED");
    }
  } finally {
    await owner.end();
  }
}

async function run() {
  const args = new Set(process.argv.slice(2));
  if ([...args].some((arg) => !["--apply", "--production-approval"].includes(arg))) {
    fail("AUTH_DATA_CUTOVER_ARGUMENT_INVALID");
  }
  const apply = args.has("--apply");
  if (apply && !args.has("--production-approval")) fail("AUTH_DATA_PRODUCTION_APPROVAL_REQUIRED");
  const manifestPath = process.env.AUTH_DATA_CUTOVER_CONFIG;
  if (!manifestPath) fail("AUTH_DATA_CUTOVER_CONFIG_REQUIRED");
  await privateRegularFile(manifestPath, "AUTH_DATA_CUTOVER_CONFIG_PRIVATE_REQUIRED");
  const { config, roles } = parseManifest(await readFile(manifestPath, "utf8"));
  await verifyGitReleaseBinding({
    directory: projectRoot,
    expectedCommit: config.admin_commit,
    codePrefix: "AUTH_DATA_ADMIN_RELEASE",
  });
  await verifyGitReleaseBinding({
    directory: process.env.AUTH_DATA_DREAM_RELEASE_DIR,
    expectedCommit: config.dream_commit,
    codePrefix: "AUTH_DATA_DREAM_RELEASE",
  });
  const backupInfo = await privateRegularFile(
    config.backup.path,
    "AUTH_DATA_CUTOVER_BACKUP_PRIVATE_REQUIRED",
  );
  if (!config.backup.path.endsWith(".tar.gz") || backupInfo.size < 1) {
    fail("AUTH_DATA_CUTOVER_BACKUP_INVALID");
  }
  if (await sha256(config.backup.path) !== config.backup.sha256) fail("AUTH_DATA_CUTOVER_BACKUP_DIGEST_MISMATCH");
  const ownerUrl = process.env.MIGRATION_DATABASE_URL;
  let parsedOwner;
  try { parsedOwner = new URL(ownerUrl); } catch { fail("MIGRATION_DATABASE_URL_REQUIRED"); }
  if (!["postgres:", "postgresql:"].includes(parsedOwner.protocol)
    || !parsedOwner.username
    || decodeURIComponent(parsedOwner.pathname.slice(1)) !== config.database.name) {
    fail("MIGRATION_DATABASE_URL_INVALID");
  }
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const target = (await client.query(
      `SELECT current_database() AS name, current_user AS role,
              current_setting('port')::int AS port,
              current_setting('data_directory') AS root`,
    )).rows[0];
    if (target.name !== config.database.name || target.port !== config.database.port
      || target.root !== config.database.data_directory) fail("AUTH_DATA_CUTOVER_TARGET_MISMATCH");
    const migration = (await client.query(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    )).rows[0];
    if (migration.count !== config.database.migrations_target) fail("AUTH_DATA_CUTOVER_MIGRATIONS_INCOMPLETE");
    const capabilityRows = (await client.query(
      `SELECT capability, version
         FROM drizzle.schema_capabilities
        WHERE capability = ANY($1::text[])`,
      [[...requiredCapabilities.keys()]],
    )).rows;
    const actualCapabilities = new Map(
      capabilityRows.map((row) => [row.capability, Number(row.version)]),
    );
    for (const [capability, version] of requiredCapabilities) {
      if (actualCapabilities.get(capability) !== version) fail("AUTH_DATA_CUTOVER_CAPABILITY_MISSING");
    }
    const gateway = (await client.query(
      `SELECT 1
         FROM public.gateway_api_keys
        WHERE service_client_id = $1
          AND subject_mode = 'canonical_subject'
          AND status = 'active'
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
          AND scopes @> ARRAY['models:list', 'messages:create']::text[]
        LIMIT 1`,
      [config.gateway_client_id],
    )).rows[0];
    if (!gateway) fail("AUTH_DATA_CUTOVER_GATEWAY_BINDING_MISSING");
    const existing = (await client.query(
      "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname",
      [Object.values(roles)],
    )).rows;
    if (existing.length !== 0 && existing.length !== 4) fail("AUTH_DATA_CUTOVER_PARTIAL_ROLES");
    if (existing.length === 4) {
      await assertLimitedRoles(client, roles, { dreamCanLogin: false, requireNoInherit: true });
      for (const key of ["auth", "control", "data"]) {
        await verifyRoleCredential(ownerUrl, config.database.name, roles[key], config.roles[key].password);
      }
    }
    const owner = (await client.query(
      "SELECT rolsuper, rolcreaterole FROM pg_roles WHERE rolname = current_user",
    )).rows[0];
    if (existing.length === 0 && !owner?.rolsuper && !owner?.rolcreaterole) {
      fail("AUTH_DATA_CUTOVER_ROLE_CREATION_DENIED");
    }
    const policy = await buildAuthAccessPolicy(client, target.name, roles);
    if (apply) {
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [policy.digest]);
        if (existing.length === 0) {
          for (const key of ["auth", "control", "data"]) {
            await client.query(
              `CREATE ROLE ${quoteIdentifier(roles[key])} WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD ${quoteLiteral(config.roles[key].password)}`,
            );
          }
          await client.query(
            `CREATE ROLE ${quoteIdentifier(roles.dream)} WITH NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
          );
        }
        await assertLimitedRoles(client, roles, { dreamCanLogin: false, requireNoInherit: true });
        for (const statement of policy.statements) await client.query(statement);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      await assertLimitedRoles(client, roles, { dreamCanLogin: false, requireNoInherit: true });
      await verifyRoleProbes(ownerUrl, config, roles);
    }
    console.log(JSON.stringify({
      mode: apply ? "applied" : "dry-run",
      database: target.name,
      migrations: migration.count,
      capabilities: requiredCapabilities.size,
      gateway_binding: "verified",
      roles_state: apply || existing.length === 4 ? "verified" : "create-on-apply",
      policy_sha256: policy.digest,
      statements: policy.statements.length,
      backup_sha256: config.backup.sha256,
      dream_database_access: "no-login-and-no-connect-after-apply",
      credential_probes: apply ? "passed" : existing.length === 4 ? "passed" : "pending-apply",
      release_binding: "verified",
      redacted: true,
    }));
  } finally {
    await client.end();
  }
}

try {
  await run();
} catch (error) {
  const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : "AUTH_DATA_ACTIVATION_FAILED";
  console.error(code);
  process.exitCode = 1;
}
