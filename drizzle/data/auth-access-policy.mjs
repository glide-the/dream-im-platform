// [Input] Private 0600 coordinator config naming an owned disposable PG and pre-created limited roles.
// [Output] Default dry-run or transactional explicit least-privilege grants and redacted evidence.
// [Pos] Explicit isolated ACL validation runner; never invoked by application startup or migration.
// [Sync] 2026-09-16: reuse the shared reviewed ACL planner while retaining isolated-target guards.
import { readFile, stat } from "node:fs/promises";
import pg from "pg";
import {
  assertLimitedRoles,
  buildAuthAccessPolicy,
  validateRoleNames,
} from "./auth-access-policy-plan.mjs";

const privateJson = (text) => {
  try { return JSON.parse(text); } catch { throw new Error("Invalid private configuration JSON"); }
};
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--apply")) {
  throw new Error("Only --apply is supported; provide private AUTH_ACCESS_POLICY_CONFIG");
}
const path = process.env.AUTH_ACCESS_POLICY_CONFIG;
if (!path) throw new Error("Private explicit ACL target configuration required");
const info = await stat(path);
if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) {
  throw new Error("Private owner-only ACL configuration required");
}
const config = privateJson(await readFile(path, "utf8"));
let dsn;
try { dsn = new URL(config.migration_database_url); } catch {
  throw new Error("Explicit PostgreSQL migration credential required");
}
if (!["postgres:", "postgresql:"].includes(dsn.protocol)
  || !dsn.username
  || decodeURIComponent(dsn.pathname.slice(1)) !== config.database) {
  throw new Error("Explicit matching PostgreSQL migration credential required");
}
const roles = config.roles;
if (!config.database?.startsWith("ink_auth_data_codex_test_")
  || !Number.isSafeInteger(config.port)
  || !config.data_directory?.startsWith("/private/tmp/ink-auth-data-")
  || !validateRoleNames(roles)) {
  throw new Error("Named disposable target and four distinct limited roles required");
}
const client = new pg.Client({ connectionString: config.migration_database_url });
await client.connect();
try {
  const target = (await client.query(
    "SELECT current_database() AS name, current_setting('port')::int AS port, current_setting('data_directory') AS root",
  )).rows[0];
  if (target.name !== config.database || target.port !== config.port || target.root !== config.data_directory) {
    throw new Error("ACL target ownership proof mismatch");
  }
  await assertLimitedRoles(client, roles);
  const policy = await buildAuthAccessPolicy(client, target.name, roles);
  if (args.includes("--apply")) {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [policy.digest]);
      for (const statement of policy.statements) await client.query(statement);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
  console.log(JSON.stringify({
    mode: args.includes("--apply") ? "applied" : "dry-run",
    database: target.name,
    policy_sha256: policy.digest,
    statements: policy.statements.length,
    limited_roles: 4,
    dream_database_access: "denied after apply",
    auth_canonical_writes: "controlled registration function only",
    data_identity_secrets: "not granted",
    redacted: true,
  }));
} catch {
  throw new Error("ACL validation failed; no credentials or database error text exposed");
} finally {
  await client.end();
}
