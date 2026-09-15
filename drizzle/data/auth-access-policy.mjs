// [Input] Private 0600 coordinator config naming an owned disposable PG and pre-created limited roles.
// [Output] Default dry-run or transactional explicit least-privilege grants and redacted evidence.
// [Pos] Explicit isolated ACL validation runner; never invoked by application startup or migration.
// [Sync] 2026-09-15: include Reflections section and encrypted task-authority persistence after forward expand.
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import pg from "pg";
const quote = name => `"${name.replaceAll('"', '""')}"`;
const identifier = value => typeof value === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(value);
const privateJson = text => { try { return JSON.parse(text); } catch { throw new Error("Invalid private configuration JSON"); } };
const args = process.argv.slice(2);
if (args.some(arg => arg !== "--apply")) throw new Error("Only --apply is supported; provide private AUTH_ACCESS_POLICY_CONFIG");
const path = process.env.AUTH_ACCESS_POLICY_CONFIG;
if (!path) throw new Error("Private explicit ACL target configuration required");
const info = await stat(path);
if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error("Private owner-only ACL configuration required");
const config = privateJson(await readFile(path, "utf8"));
let dsn;
try { dsn = new URL(config.migration_database_url); } catch { throw new Error("Explicit PostgreSQL migration credential required"); }
if (!["postgres:", "postgresql:"].includes(dsn.protocol) || !dsn.username || decodeURIComponent(dsn.pathname.slice(1)) !== config.database) throw new Error("Explicit matching PostgreSQL migration credential required");
const roles = config.roles;
if (!config.database?.startsWith("ink_auth_data_codex_test_") || !Number.isSafeInteger(config.port) || !config.data_directory?.startsWith("/private/tmp/ink-auth-data-") || !roles || Object.keys(roles).sort().join(",") !== "auth,control,data,dream" || !Object.values(roles).every(identifier) || new Set(Object.values(roles)).size !== 4) throw new Error("Named disposable target and four distinct limited roles required");
const client = new pg.Client({ connectionString: config.migration_database_url });
await client.connect();
try {
  const target = (await client.query("SELECT current_database() AS name, current_setting('port')::int AS port, current_setting('data_directory') AS root")).rows[0];
  if (target.name !== config.database || target.port !== config.port || target.root !== config.data_directory) throw new Error("ACL target ownership proof mismatch");
  const actualRoles = (await client.query("SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = ANY($1::text[])", [Object.values(roles)])).rows;
  if (actualRoles.length !== 4 || actualRoles.some(role => role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls)) throw new Error("Pre-created roles must have no elevated attributes");
  const membership = await client.query("SELECT 1 FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1::text[])) LIMIT 1", [Object.values(roles)]);
  if (membership.rows.length) throw new Error("Limited roles may not inherit other role memberships");
  const ownership = await client.query("SELECT 1 FROM pg_class WHERE relowner IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1::text[])) UNION ALL SELECT 1 FROM pg_namespace WHERE nspowner IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1::text[])) LIMIT 1", [Object.values(roles)]);
  if (ownership.rows.length) throw new Error("Limited roles may not own database objects");
  const statements = [];
  const allRoles = Object.values(roles).map(quote).join(", ");
  for (const schema of ["public", "identity", "dream", "drizzle"]) {
    statements.push(`REVOKE ALL ON ALL TABLES IN SCHEMA ${quote(schema)} FROM ${allRoles}`, `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${quote(schema)} FROM ${allRoles}`, `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${quote(schema)} FROM ${allRoles}`, `REVOKE ALL ON SCHEMA ${quote(schema)} FROM ${allRoles}`);
  }
  statements.push(`REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE ${quote(target.name)} FROM PUBLIC, ${allRoles}`, "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public, identity, dream, drizzle FROM PUBLIC");
  const grant = (role, privilege, relation) => statements.push(`GRANT ${privilege} ON ${relation} TO ${quote(role)}`);
  for (const role of [roles.auth, roles.data, roles.control]) {
    grant(role, "CONNECT", `DATABASE ${quote(target.name)}`);
    grant(role, "USAGE", "SCHEMA public, identity, drizzle");
    grant(role, "SELECT", "TABLE drizzle.schema_capabilities");
  }
  const protocol = ["user", "session", "account", "verification", "jwks", "oauthClient", "oauthResource", "oauthClientResource", "oauthRefreshToken", "oauthAccessToken", "oauthConsent", "oauthClientAssertion", "deviceCode"];
  for (const table of protocol) for (const role of [roles.auth, roles.control]) grant(role, "SELECT, INSERT, UPDATE, DELETE", `TABLE identity.${quote(table)}`);
  grant(roles.auth, "SELECT, INSERT, UPDATE, DELETE", "TABLE identity.browser_sessions");
  for (const role of [roles.auth, roles.data, roles.control]) {
    grant(role, "SELECT", "TABLE identity.subject_links");
    grant(role, "SELECT (id, source, external_user_id, status, tier)", "TABLE public.platform_users");
  }
  grant(roles.auth, "SELECT (id, email, status)", "TABLE public.users");
  grant(roles.data, "SELECT (id, email, display_name, avatar_url, role, status, created_at, updated_at)", "TABLE public.users");
  grant(roles.control, "SELECT (id, email, status)", "TABLE public.users");
  for (const role of [roles.auth, roles.control]) {
    grant(role, "SELECT", "TABLE identity.admin_subject_links, public.admin_user_roles, public.admin_roles, public.admin_role_permissions, public.admin_permissions");
    grant(role, "SELECT (id, email, display_name, status)", "TABLE public.admin_users");
    grant(role, "UPDATE (last_login_at, updated_at)", "TABLE public.admin_users");
    grant(role, "INSERT", "TABLE public.admin_audit_logs");
  }
  grant(roles.auth, "EXECUTE", "FUNCTION identity.register_canonical_user(text, text, text)");
  grant(roles.control, "SELECT, INSERT, UPDATE, DELETE", "TABLE public.admin_users, public.admin_user_roles, public.admin_roles, public.admin_role_permissions, public.admin_permissions, identity.admin_subject_links, identity.subject_links");
  grant(roles.data, 'SELECT (id, "publicKey", alg)', 'TABLE identity.jwks');
  grant(roles.data, 'SELECT ("userId", "providerId")', 'TABLE identity.account');
  grant(roles.data, "SELECT, INSERT, UPDATE, DELETE", "TABLE identity.runtime_delegations, dream.operation_receipts");
  grant(roles.data, "SELECT, INSERT, UPDATE, DELETE", "TABLE dream.reflection_task_authorities");
  grant(roles.data, "SELECT, INSERT", "TABLE dream.workflow_preflight_requests");
  grant(roles.data, "USAGE", "SCHEMA dream");
  grant(roles.data, "INSERT", "TABLE public.admin_audit_logs");
  grant(roles.data, "SELECT", "TABLE public.system_settings");
  grant(roles.data, "SELECT, INSERT, UPDATE, DELETE", "TABLE public.claude_agent_resource_snapshots");
  const snapshot = JSON.parse(await readFile(new URL("../meta/0056_snapshot.json", import.meta.url), "utf8"));
  const domainTables = Object.entries(snapshot.tables).filter(([key]) => key.startsWith("public.") && !["public.users", "public.user_model_permissions", "public.auth_sessions", "public.oauth_accounts", "public.refresh_tokens", "public.device_authorizations"].includes(key)).map(([key]) => key).filter(key => !/^public\.(admin_|ai_|billing_|gateway_|payment_|platform_|subscription_|system_|claude_agent_resource_)/.test(key));
  for (const key of domainTables) grant(roles.data, "SELECT, INSERT, UPDATE, DELETE", `TABLE public.${quote(key.slice(7))}`);
  grant(roles.data, "SELECT, INSERT, UPDATE, DELETE", "TABLE public.reflection_task_section");
  // Identity sequences belonging to writable Dream-domain tables only.
  const sequences = await client.query("SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_depend d ON d.objid=c.oid JOIN pg_class t ON t.oid=d.refobjid WHERE c.relkind='S' AND d.deptype IN ('a','i') AND t.relname=ANY($1::text[]) AND n.nspname='public'", [domainTables.map(key => key.slice(7))]);
  for (const row of sequences.rows) grant(roles.data, "USAGE, SELECT", `SEQUENCE ${quote(row.nspname)}.${quote(row.relname)}`);
  grant(roles.data, "SELECT (id, service_client_id, subject_mode, status, revoked_at, expires_at, scopes)", "TABLE public.gateway_api_keys");
  const digest = createHash("sha256").update(JSON.stringify(statements)).digest("hex");
  if (args.includes("--apply")) {
    await client.query("BEGIN");
    try { await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [digest]); for (const statement of statements) await client.query(statement); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
  }
  console.log(JSON.stringify({ mode: args.includes("--apply") ? "applied" : "dry-run", database: target.name, policy_sha256: digest, statements: statements.length, limited_roles: 4, dream_database_access: "denied after apply", auth_canonical_writes: "controlled registration function only", data_identity_secrets: "not granted", redacted: true }));
} catch { throw new Error("ACL validation failed; no credentials or database error text exposed"); }
finally { await client.end(); }
