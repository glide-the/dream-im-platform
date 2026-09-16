// [Input] A verified PostgreSQL connection, database name and four distinct limited role names.
// [Output] One deterministic least-privilege statement plan and redacted policy digest.
// [Pos] Shared ACL planner used by isolated validation and explicit normal-database activation.
// [Sync] 2026-09-16: extract the reviewed auth/control/data/Dream policy without changing grants.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export const roleKeys = ["auth", "control", "data", "dream"];

export function quoteIdentifier(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

export function isRoleIdentifier(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,62}$/.test(value);
}

export function validateRoleNames(roles) {
  return !!roles
    && Object.keys(roles).sort().join(",") === [...roleKeys].sort().join(",")
    && Object.values(roles).every(isRoleIdentifier)
    && new Set(Object.values(roles)).size === roleKeys.length;
}

export async function assertLimitedRoles(
  client,
  roles,
  { dreamCanLogin = true, requireNoInherit = false } = {},
) {
  const actualRoles = (await client.query(
    `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication,
            rolbypassrls, rolinherit, rolcanlogin
       FROM pg_roles
      WHERE rolname = ANY($1::text[])
      ORDER BY rolname`,
    [Object.values(roles)],
  )).rows;
  if (actualRoles.length !== roleKeys.length
    || actualRoles.some((role) => role.rolsuper || role.rolcreatedb || role.rolcreaterole
      || role.rolreplication || role.rolbypassrls || (requireNoInherit && role.rolinherit))
    || actualRoles.some((role) => role.rolname === roles.dream
      ? role.rolcanlogin !== dreamCanLogin
      : !role.rolcanlogin)) {
    throw new Error("Limited roles do not match the required attributes");
  }
  const membership = await client.query(
    `SELECT 1
       FROM pg_auth_members
      WHERE member IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1::text[]))
      LIMIT 1`,
    [Object.values(roles)],
  );
  if (membership.rows.length) throw new Error("Limited roles may not inherit role memberships");
  const ownership = await client.query(
    `SELECT 1 FROM pg_class
      WHERE relowner IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1::text[]))
     UNION ALL
     SELECT 1 FROM pg_namespace
      WHERE nspowner IN (SELECT oid FROM pg_roles WHERE rolname = ANY($1::text[]))
     LIMIT 1`,
    [Object.values(roles)],
  );
  if (ownership.rows.length) throw new Error("Limited roles may not own database objects");
  return actualRoles;
}

export async function buildAuthAccessPolicy(client, database, roles) {
  if (!validateRoleNames(roles)) throw new Error("Four distinct limited role names are required");
  const statements = [];
  const allRoles = Object.values(roles).map(quoteIdentifier).join(", ");
  for (const schema of ["public", "identity", "dream", "drizzle"]) {
    statements.push(
      `REVOKE ALL ON ALL TABLES IN SCHEMA ${quoteIdentifier(schema)} FROM ${allRoles}`,
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${quoteIdentifier(schema)} FROM ${allRoles}`,
      `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${quoteIdentifier(schema)} FROM ${allRoles}`,
      `REVOKE ALL ON SCHEMA ${quoteIdentifier(schema)} FROM ${allRoles}`,
    );
  }
  statements.push(
    `REVOKE CONNECT, CREATE, TEMPORARY ON DATABASE ${quoteIdentifier(database)} FROM PUBLIC, ${allRoles}`,
    "REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public, identity, dream, drizzle FROM PUBLIC",
  );
  const grant = (role, privilege, relation) => statements.push(
    `GRANT ${privilege} ON ${relation} TO ${quoteIdentifier(role)}`,
  );
  for (const role of [roles.auth, roles.data, roles.control]) {
    grant(role, "CONNECT", `DATABASE ${quoteIdentifier(database)}`);
    grant(role, "USAGE", "SCHEMA public, identity, drizzle");
    grant(role, "SELECT", "TABLE drizzle.schema_capabilities");
  }
  const protocol = [
    "user", "session", "account", "verification", "jwks", "oauthClient",
    "oauthResource", "oauthClientResource", "oauthRefreshToken", "oauthAccessToken",
    "oauthConsent", "oauthClientAssertion", "deviceCode",
  ];
  for (const table of protocol) {
    for (const role of [roles.auth, roles.control]) {
      grant(role, "SELECT, INSERT, UPDATE, DELETE", `TABLE identity.${quoteIdentifier(table)}`);
    }
  }
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
  grant(roles.data, "SELECT (id, \"publicKey\", alg)", "TABLE identity.jwks");
  grant(roles.data, "SELECT (\"userId\", \"providerId\")", "TABLE identity.account");
  grant(roles.data, "SELECT, INSERT, UPDATE, DELETE", "TABLE identity.runtime_delegations, dream.operation_receipts");
  grant(roles.data, "SELECT, INSERT, UPDATE, DELETE", "TABLE dream.reflection_task_authorities");
  grant(roles.data, "SELECT, INSERT", "TABLE dream.workflow_preflight_requests");
  grant(roles.data, "USAGE", "SCHEMA dream");
  grant(roles.data, "INSERT", "TABLE public.admin_audit_logs");
  grant(roles.data, "SELECT", "TABLE public.system_settings");
  grant(roles.data, "SELECT, INSERT, UPDATE, DELETE", "TABLE public.claude_agent_resource_snapshots");
  const snapshot = JSON.parse(await readFile(new URL("../meta/0056_snapshot.json", import.meta.url), "utf8"));
  const excluded = new Set([
    "public.users", "public.user_model_permissions", "public.auth_sessions",
    "public.oauth_accounts", "public.refresh_tokens", "public.device_authorizations",
  ]);
  const domainTables = Object.keys(snapshot.tables)
    .filter((key) => key.startsWith("public.") && !excluded.has(key))
    .filter((key) => !/^public\.(admin_|ai_|billing_|gateway_|payment_|platform_|subscription_|system_|claude_agent_resource_)/.test(key));
  for (const key of domainTables) {
    grant(roles.data, "SELECT, INSERT, UPDATE, DELETE", `TABLE public.${quoteIdentifier(key.slice(7))}`);
  }
  grant(roles.data, "SELECT, INSERT, UPDATE, DELETE", "TABLE public.reflection_task_section");
  const sequences = await client.query(
    `SELECT n.nspname, c.relname
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_depend d ON d.objid = c.oid
       JOIN pg_class t ON t.oid = d.refobjid
      WHERE c.relkind = 'S'
        AND d.deptype IN ('a', 'i')
        AND t.relname = ANY($1::text[])
        AND n.nspname = 'public'
      ORDER BY n.nspname, c.relname`,
    [domainTables.map((key) => key.slice(7))],
  );
  for (const row of sequences.rows) {
    grant(roles.data, "USAGE, SELECT", `SEQUENCE ${quoteIdentifier(row.nspname)}.${quoteIdentifier(row.relname)}`);
  }
  grant(roles.data, "SELECT (id, service_client_id, subject_mode, status, revoked_at, expires_at, scopes)", "TABLE public.gateway_api_keys");
  return {
    statements,
    digest: createHash("sha256").update(JSON.stringify(statements)).digest("hex"),
    domainTableCount: domainTables.length,
  };
}
