// [Input] Better Auth subject/session, explicit Admin mapping and canonical RBAC schema.
// [Output] Active Admin identity with live roles/permissions; safe login audit in the same UOW.
// [Pos] ORM authorization repository; email/provider membership never grants Admin authority.
import { and, eq, sql } from "drizzle-orm";
import { adminAuditLogs, adminUsers, adminUserRoles, adminRoles, adminRolePermissions, adminPermissions } from "@ink-memory/db/schema";
import { adminSubjectLinks } from "@ink-memory/db/schema/auth";
import { randomUUID } from "node:crypto";
import type { AuthRepositoryDatabase } from "./database";
import type { AdminIdentity } from "../admin/session";
export class AdminIdentityRepository {
  constructor(private readonly database: AuthRepositoryDatabase) {}
  async current(authUserId: string, sessionId: string): Promise<AdminIdentity | null> {
    const rows = await this.database.select({ id: adminUsers.id, email: adminUsers.email, displayName: adminUsers.display_name }).from(adminSubjectLinks)
      .innerJoin(adminUsers, eq(adminUsers.id, adminSubjectLinks.adminUserId)).where(and(eq(adminSubjectLinks.authUserId, authUserId), eq(adminUsers.status, "active"))).limit(1);
    const admin = rows[0]; if (!admin) return null;
    const roles = await this.database.selectDistinct({ code: adminRoles.code }).from(adminUserRoles).innerJoin(adminRoles, eq(adminRoles.id, adminUserRoles.role_id)).where(eq(adminUserRoles.admin_user_id, admin.id)).orderBy(adminRoles.code);
    const permissions = await this.database.selectDistinct({ code: adminPermissions.code }).from(adminUserRoles).innerJoin(adminRolePermissions, eq(adminRolePermissions.role_id, adminUserRoles.role_id)).innerJoin(adminPermissions, eq(adminPermissions.id, adminRolePermissions.permission_id)).where(eq(adminUserRoles.admin_user_id, admin.id)).orderBy(adminPermissions.code);
    return { id: admin.id, email: admin.email, displayName: admin.displayName ?? undefined, roles: roles.map(row => row.code), permissions: permissions.map(row => row.code), sessionId };
  }
  async loginAudit(identity: AdminIdentity, requestId: string) {
    await this.database.update(adminUsers).set({ last_login_at: sql`CURRENT_TIMESTAMP`, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(adminUsers.id, identity.id));
    await this.database.insert(adminAuditLogs).values({ id: randomUUID(), actor_type: "admin", actor_id: identity.id, action: "login", resource_type: "admin_session", resource_id: identity.sessionId, request_id: requestId, after: { authenticated: true } });
  }
}
