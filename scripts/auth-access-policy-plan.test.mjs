// [Input] Owner-side PostgreSQL privilege projection for configured auth and control roles.
// [Output] Deterministic acceptance of the independent Admin login boundary and rejection of drift/legacy-link access.
// [Pos] Provider-free ACL release gate; no database, credential, user or session is read or changed.
// [Sync] 2026-09-17: cover the exact Admin credential/session/RBAC probe added after normal-login drift was found.
import assert from "node:assert/strict";
import test from "node:test";
import { assertAdminAuthPrivileges } from "../drizzle/data/auth-access-policy-plan.mjs";

const roles = { auth: "ink_auth", control: "ink_admin_control", data: "ink_dream_data", dream: "ink_dream_no_db" };

function database(row) {
  const calls = [];
  return {
    calls,
    async query(sql, parameters) {
      calls.push({ sql, parameters });
      return { rows: [row] };
    },
  };
}

test("accepts exact Admin credential, session and RBAC grants without legacy subject-link access", async () => {
  const client = database({
    auth_ready: true,
    control_ready: true,
    auth_legacy_link_select: false,
    control_legacy_link_select: false,
  });
  await assert.doesNotReject(assertAdminAuthPrivileges(client, roles));
  assert.deepEqual(client.calls[0].parameters, [roles.auth, roles.control]);
  assert.match(client.calls[0].sql, /password_hash/);
  assert.match(client.calls[0].sql, /admin_sessions/);
  assert.match(client.calls[0].sql, /admin_role_permissions/);
  assert.match(client.calls[0].sql, /identity\.admin_subject_links/);
});

test("rejects a role missing any independent Admin auth grant", async () => {
  const client = database({
    auth_ready: false,
    control_ready: true,
    auth_legacy_link_select: false,
    control_legacy_link_select: false,
  });
  await assert.rejects(
    assertAdminAuthPrivileges(client, roles),
    /Independent Admin auth privileges do not match/,
  );
});

test("rejects either Admin role retaining the legacy cross-domain subject-link read", async () => {
  for (const changed of [
    { auth_legacy_link_select: true, control_legacy_link_select: false },
    { auth_legacy_link_select: false, control_legacy_link_select: true },
  ]) {
    const client = database({ auth_ready: true, control_ready: true, ...changed });
    await assert.rejects(
      assertAdminAuthPrivileges(client, roles),
      /Independent Admin auth privileges do not match/,
    );
  }
});
