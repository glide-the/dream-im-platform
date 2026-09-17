// [Input] First-admin bootstrap request plus the canonical permission/role policy.
// [Output] Transactional initial Admin, roles, permissions, and audit receipt.
// [Pos] One-time Admin bootstrap service; normal requests use existing session/RBAC checks.
// [Sync] 2026-09-17: seed only the independent Admin operator/session domain; Dream identities are never created or linked.

import { sql } from "drizzle-orm";
import { adminUsers, adminPermissions, adminRoles, adminRolePermissions, adminUserRoles, adminAuditLogs } from "@ink-memory/db/schema";
import { withAdminAuthControlTransaction } from "../auth/database";
import { signInAdminOnTransaction } from "../auth/adminAuthService";
import { createPlatformId } from "../platform-ids";
import { AdminError } from "./errors";
import { hashAdminPassword } from "./password";

const PERMISSIONS = [
  "dashboard.read",
  "story.read",
  "story.write",
  "users.read",
  "users.write",
  "storage.read",
  "storage.write",
  "storage.delete",
  "claude_plugin_marketplaces.manage",
  "providers.read",
  "providers.write",
  "models.read",
  "models.write",
  "pricing.read",
  "pricing.write",
  "billing.read",
  "billing.adjust",
  "subscriptions.read",
  "subscriptions.write",
  "subscriptions.grant",
  "gateway.read",
  "gateway.payloads.read",
  "gateway.keys.write",
  "access.read",
  "access.write",
  "audit.read",
  "system.read",
  "system.write",
] as const;

const ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  super_admin: PERMISSIONS,
  operator: PERMISSIONS.filter(
    (permission) =>
      ![
        "billing.adjust",
        "subscriptions.grant",
        "access.write",
        "gateway.payloads.read",
      ].includes(permission),
  ),
  auditor: PERMISSIONS.filter(
    (permission) => permission.endsWith(".read"),
  ),
};

export async function isAdminBootstrapRequired() {
  return withAdminAuthControlTransaction(async tx => !(await tx.select({ id: adminUsers.id }).from(adminUsers).limit(1)).length);
}
export async function bootstrapFirstAdmin(input: { email: string; displayName?: string; password: string; request: Request; requestId: string }) {
  const passwordHash = await hashAdminPassword(input.password);
  return withAdminAuthControlTransaction(async tx => {
    await tx.execute(sql`LOCK TABLE public.admin_users IN EXCLUSIVE MODE`);
    if ((await tx.select({ id: adminUsers.id }).from(adminUsers).limit(1)).length) throw new AdminError("ADMIN_ALREADY_BOOTSTRAPPED", "The first admin has already been created", 409);
    const email = input.email.trim().toLowerCase();
    const permissionIds = new Map<string, string>();
    for (const code of PERMISSIONS) {
      const rows = await tx.insert(adminPermissions).values({ id: createPlatformId("perm"), code, name: code }).onConflictDoUpdate({ target: adminPermissions.code, set: { name: code } }).returning({ id: adminPermissions.id });
      permissionIds.set(code, rows[0].id);
    }
    const roleIds = new Map<string, string>();
    for (const [code, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      const rows = await tx.insert(adminRoles).values({ id: createPlatformId("role"), code, name: code }).onConflictDoUpdate({ target: adminRoles.code, set: { name: code } }).returning({ id: adminRoles.id });
      roleIds.set(code, rows[0].id);
      for (const permission of permissions) await tx.insert(adminRolePermissions).values({ role_id: rows[0].id, permission_id: permissionIds.get(permission)! }).onConflictDoNothing();
    }
    const adminUserId = createPlatformId("admin");
    await tx.insert(adminUsers).values({ id: adminUserId, email, display_name: input.displayName?.trim() || null, password_hash: passwordHash, status: "active" });
    await tx.insert(adminUserRoles).values({ admin_user_id: adminUserId, role_id: roleIds.get("super_admin")! });
    await tx.insert(adminAuditLogs).values({ id: createPlatformId("audit"), actor_type: "system", action: "bootstrap", resource_type: "admin_user", resource_id: adminUserId, request_id: input.requestId, after: { email, role: "super_admin" } });
    return signInAdminOnTransaction(tx, input.request, input.requestId, { email, password: input.password }, 201);
  });
}
