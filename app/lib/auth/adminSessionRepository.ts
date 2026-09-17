// [Input] Admin-only normalized credentials/session hashes and one explicit Drizzle authentication UOW.
// [Output] Active Admin member/session/RBAC projections plus atomic session, revocation and login audit writes.
// [Pos] Typed Admin management repository; it never reads Dream users, Better Auth subjects or subject links.
// [Sync] 2026-09-17: add the control-only password recovery transaction with active-member locking, Session revocation and redacted audit.
// [Sync] 2026-09-17: restore the independent Admin operator domain with DTO/Service/Repository/Drizzle ownership.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import {
  adminAuditLogs,
  adminPermissions,
  adminRolePermissions,
  adminRoles,
  adminSessions,
  adminUserRoles,
  adminUsers,
} from "@ink-memory/db/schema";
import type { AuthRepositoryDatabase } from "./database";
import type { AdminIdentity } from "../admin/session";
import { randomUUID } from "node:crypto";

export type AdminLoginRecord = {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  status: string;
};

export class AdminSessionRepository {
  constructor(private readonly database: AuthRepositoryDatabase) {}

  async findByNormalizedEmail(email: string): Promise<AdminLoginRecord | null> {
    const rows = await this.database
      .select({
        id: adminUsers.id,
        email: adminUsers.email,
        displayName: adminUsers.display_name,
        passwordHash: adminUsers.password_hash,
        status: adminUsers.status,
      })
      .from(adminUsers)
      .where(sql`lower(${adminUsers.email}) = ${email}`)
      .limit(1);
    return rows[0] ?? null;
  }

  async lockActiveByNormalizedEmail(email: string): Promise<AdminLoginRecord | null> {
    const rows = await this.database
      .select({
        id: adminUsers.id,
        email: adminUsers.email,
        displayName: adminUsers.display_name,
        passwordHash: adminUsers.password_hash,
        status: adminUsers.status,
      })
      .from(adminUsers)
      .where(sql`lower(${adminUsers.email}) = ${email}`)
      .limit(1)
      .for("update");
    return rows[0] ?? null;
  }

  async replacePasswordAndRevokeSessions(input: {
    adminUserId: string;
    passwordHash: string;
    requestId: string;
  }): Promise<number> {
    const updated = await this.database
      .update(adminUsers)
      .set({
        password_hash: input.passwordHash,
        updated_at: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(adminUsers.id, input.adminUserId), eq(adminUsers.status, "active")))
      .returning({ id: adminUsers.id });
    if (updated.length !== 1) throw new Error("ADMIN_PASSWORD_RECOVERY_TARGET_CHANGED");
    const revoked = await this.database
      .update(adminSessions)
      .set({ revoked_at: sql`CURRENT_TIMESTAMP` })
      .where(and(
        eq(adminSessions.admin_user_id, input.adminUserId),
        isNull(adminSessions.revoked_at),
      ))
      .returning({ id: adminSessions.id });
    await this.database.insert(adminAuditLogs).values({
      id: `audit_${randomUUID().replaceAll("-", "")}`,
      actor_type: "system",
      action: "admin.password.recovery",
      resource_type: "admin_user",
      resource_id: input.adminUserId,
      request_id: input.requestId,
      after: { password_reset: true, sessions_revoked: revoked.length },
      metadata: { source: "local-control-cli" },
    });
    return revoked.length;
  }

  async createSession(input: {
    sessionId: string;
    adminUserId: string;
    tokenHash: string;
    expiresAt: Date;
    requestId: string;
    ipAddress: string | null;
    userAgent: string | null;
  }): Promise<void> {
    await this.database.insert(adminSessions).values({
      id: input.sessionId,
      admin_user_id: input.adminUserId,
      token_hash: input.tokenHash,
      expires_at: input.expiresAt,
    });
    await this.database
      .update(adminUsers)
      .set({ last_login_at: sql`CURRENT_TIMESTAMP`, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(adminUsers.id, input.adminUserId));
    await this.database.insert(adminAuditLogs).values({
      id: `audit_${randomUUID().replaceAll("-", "")}`,
      actor_type: "admin",
      actor_id: input.adminUserId,
      action: "login",
      resource_type: "admin_session",
      resource_id: input.sessionId,
      request_id: input.requestId,
      ip_address: input.ipAddress,
      user_agent: input.userAgent,
      after: { authenticated: true },
      metadata: {},
    });
  }

  async current(tokenHash: string): Promise<AdminIdentity | null> {
    const rows = await this.database
      .select({
        sessionId: adminSessions.id,
        id: adminUsers.id,
        email: adminUsers.email,
        displayName: adminUsers.display_name,
      })
      .from(adminSessions)
      .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.admin_user_id))
      .where(and(
        eq(adminSessions.token_hash, tokenHash),
        isNull(adminSessions.revoked_at),
        gt(adminSessions.expires_at, sql`CURRENT_TIMESTAMP`),
        eq(adminUsers.status, "active"),
      ))
      .limit(1);
    const member = rows[0];
    if (!member) return null;
    const roles = await this.database
      .selectDistinct({ code: adminRoles.code })
      .from(adminUserRoles)
      .innerJoin(adminRoles, eq(adminRoles.id, adminUserRoles.role_id))
      .where(eq(adminUserRoles.admin_user_id, member.id))
      .orderBy(adminRoles.code);
    const permissions = await this.database
      .selectDistinct({ code: adminPermissions.code })
      .from(adminUserRoles)
      .innerJoin(adminRolePermissions, eq(adminRolePermissions.role_id, adminUserRoles.role_id))
      .innerJoin(adminPermissions, eq(adminPermissions.id, adminRolePermissions.permission_id))
      .where(eq(adminUserRoles.admin_user_id, member.id))
      .orderBy(adminPermissions.code);
    await this.database
      .update(adminSessions)
      .set({ last_seen_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(adminSessions.id, member.sessionId));
    return {
      id: member.id,
      email: member.email,
      displayName: member.displayName ?? undefined,
      roles: roles.map((row) => row.code),
      permissions: permissions.map((row) => row.code),
      sessionId: member.sessionId,
    };
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.database
      .update(adminSessions)
      .set({ revoked_at: sql`COALESCE(${adminSessions.revoked_at}, CURRENT_TIMESTAMP)` })
      .where(eq(adminSessions.token_hash, tokenHash));
  }
}
