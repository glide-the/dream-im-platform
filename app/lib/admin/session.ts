// [Input] Admin-host Better Auth cookie and explicit active Admin membership/RBAC.
// [Output] Live Admin identity and bootstrap-secret proof; legacy HMAC sessions are retired.
// [Pos] Admin authorization boundary; Better Auth is the only Session authority.
// [Sync] 2026-09-14: read installed Session with cache/refresh disabled and repeat RBAC per request.
import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminAuth } from "../auth/server";
import { withAuthTransaction } from "../auth/database";
import { AdminIdentityRepository } from "../auth/adminIdentityRepository";
import { AdminError } from "./errors";
export type AdminIdentity = { id: string; email: string; displayName?: string; roles: string[]; permissions: string[]; sessionId: string };
export async function getAdminIdentity(headers: Headers): Promise<AdminIdentity | null> {
  return withAuthTransaction(async tx => {
    const session = await createAdminAuth(tx).api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
    if (!session) return null;
    const identity = await new AdminIdentityRepository(tx).current(session.user.id, session.session.id);
    if (!identity) throw new AdminError("ADMIN_PERMISSION_DENIED", "An active Admin membership is required", 403);
    return identity;
  });
}
export function hasAdminPermission(identity: AdminIdentity, permission: string) { return identity.permissions.includes(permission); }
export function verifyBootstrapToken(candidate: string | null) {
  const configured = process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!configured || Buffer.byteLength(configured) < 32 || !candidate) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(candidate), digest(configured));
}
