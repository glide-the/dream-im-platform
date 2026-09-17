// [Input] Strict local recovery DTO, one Admin control Drizzle transaction and a hidden new password.
// [Output] Redacted plan/apply receipts after active-member validation, scrypt replacement, Session revocation and audit.
// [Pos] Admin-only lockout recovery service; Dream users, Better Auth credentials and OAuth subjects are outside this boundary.
// [Sync] 2026-09-17: add a fail-closed recovery path for an existing independent Admin operator.
import { z } from "zod";
import type { AuthTransaction } from "./database";
import { AdminSessionRepository } from "./adminSessionRepository";
import { ADMIN_PASSWORD_MIN_LENGTH, hashAdminPassword } from "../admin/password";

const recoveryTarget = {
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  requestId: z.string().trim().min(1).max(160),
};

export const adminPasswordRecoveryPlanDto = z.strictObject(recoveryTarget);
export const adminPasswordRecoveryApplyDto = z.strictObject({
  ...recoveryTarget,
  password: z.string().min(ADMIN_PASSWORD_MIN_LENGTH).max(256),
});

export type AdminPasswordRecoveryPlan = z.infer<typeof adminPasswordRecoveryPlanDto>;
export type AdminPasswordRecoveryApply = z.infer<typeof adminPasswordRecoveryApplyDto>;

function requireActiveMember(member: Awaited<ReturnType<AdminSessionRepository["findByNormalizedEmail"]>>) {
  if (!member) throw new Error("ADMIN_PASSWORD_RECOVERY_TARGET_NOT_FOUND");
  if (member.status !== "active") throw new Error("ADMIN_PASSWORD_RECOVERY_TARGET_INACTIVE");
  return member;
}

export async function planAdminPasswordRecovery(tx: AuthTransaction, raw: AdminPasswordRecoveryPlan) {
  const input = adminPasswordRecoveryPlanDto.parse(raw);
  const member = requireActiveMember(
    await new AdminSessionRepository(tx).findByNormalizedEmail(input.email),
  );
  return {
    mode: "dry-run" as const,
    email: member.email,
    status: member.status,
    willRevokeAdminSessions: true,
    dreamIdentityChanged: false,
  };
}

export async function applyAdminPasswordRecovery(tx: AuthTransaction, raw: AdminPasswordRecoveryApply) {
  const input = adminPasswordRecoveryApplyDto.parse(raw);
  const repository = new AdminSessionRepository(tx);
  const member = requireActiveMember(await repository.lockActiveByNormalizedEmail(input.email));
  const passwordHash = await hashAdminPassword(input.password);
  const sessionsRevoked = await repository.replacePasswordAndRevokeSessions({
    adminUserId: member.id,
    passwordHash,
    requestId: input.requestId,
  });
  return {
    mode: "apply" as const,
    email: member.email,
    passwordChanged: true,
    sessionsRevoked,
    dreamIdentityChanged: false,
  };
}
