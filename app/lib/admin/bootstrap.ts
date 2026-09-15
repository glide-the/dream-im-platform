// [Input] First-admin bootstrap request plus the canonical permission/role policy.
// [Output] Transactional initial Admin, roles, permissions, and audit receipt.
// [Pos] One-time Admin bootstrap service; normal requests use existing session/RBAC checks.
// [Sync] 2026-09-14: preserve first-run policy while seeding sole Better Auth identity atomically.

import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { adminUsers, adminPermissions, adminRoles, adminRolePermissions, adminUserRoles, adminAuditLogs, users } from "@ink-memory/db/schema";
import { user, account } from "@ink-memory/db/schema/auth-generated";
import { adminSubjectLinks } from "@ink-memory/db/schema/auth";
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
    const existing = await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    const canonical = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing.length || canonical.length) throw new AdminError("ADMIN_IDENTITY_LINK_REQUIRED", "An existing identity requires explicit adoption before Admin setup", 409);
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
    const adminUserId = createPlatformId("admin"), authUserId = randomUUID();
    await tx.insert(adminUsers).values({ id: adminUserId, email, display_name: input.displayName?.trim() || null, password_hash: passwordHash, status: "active" });
    await tx.insert(user).values({ id: authUserId, email, name: input.displayName?.trim() || email, emailVerified: false, createdAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` });
    await tx.insert(account).values({ id: randomUUID(), userId: authUserId, providerId: "credential", accountId: authUserId, password: passwordHash, createdAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` });
    await tx.insert(adminSubjectLinks).values({ authUserId, adminUserId });
    await tx.insert(adminUserRoles).values({ admin_user_id: adminUserId, role_id: roleIds.get("super_admin")! });
    await tx.insert(adminAuditLogs).values({ id: createPlatformId("audit"), actor_type: "system", action: "bootstrap", resource_type: "admin_user", resource_id: adminUserId, request_id: input.requestId, after: { email, role: "super_admin" } });
    return signInAdminOnTransaction(tx, input.request, input.requestId, { email, password: input.password }, 201);
  });
}
