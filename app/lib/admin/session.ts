// [Input] Admin-only cookie, server session policy and independent Admin member/RBAC tables.
// [Output] Opaque management Session primitives, live Admin identity and bootstrap-secret proof.
// [Pos] Admin authorization boundary; Dream Better Auth Session and OAuth tokens are never accepted here.
// [Sync] 2026-09-17: restore admin_sessions as the independent Admin operator Session authority.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { withAuthTransaction } from "../auth/database";
import { AdminSessionRepository } from "../auth/adminSessionRepository";
import { exactAuthUrl, requiredAuthValue, AuthBoundaryError } from "../auth/config";
export const ADMIN_SESSION_COOKIE = "ink_admin_session";
export type AdminIdentity = { id: string; email: string; displayName?: string; roles: string[]; permissions: string[]; sessionId: string };

function sessionSecret() {
  const value = requiredAuthValue("ADMIN_SESSION_SECRET");
  if (Buffer.byteLength(value, "utf8") < 32) throw new AuthBoundaryError("ADMIN_AUTH_NOT_CONFIGURED");
  return value;
}

function sessionTtlSeconds() {
  const value = Number(requiredAuthValue("ADMIN_SESSION_TTL_SECONDS"));
  if (!Number.isSafeInteger(value) || value < 1) throw new AuthBoundaryError("ADMIN_AUTH_NOT_CONFIGURED");
  return value;
}

function secureCookie() {
  return new URL(exactAuthUrl(requiredAuthValue("BETTER_AUTH_URL"))).protocol === "https:";
}

export function adminSessionToken() { return `adm_${randomBytes(32).toString("base64url")}`; }
export function adminSessionExpiry(now = Date.now()) { return new Date(now + sessionTtlSeconds() * 1_000); }
export function hashAdminSessionToken(token: string) { return createHmac("sha256", sessionSecret()).update(token).digest("hex"); }

export function parseAdminSessionCookie(headers: Headers) {
  const cookies = headers.get("cookie") ?? "";
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0 || item.slice(0, separator).trim() !== ADMIN_SESSION_COOKIE) continue;
    try { return decodeURIComponent(item.slice(separator + 1).trim()); } catch { return undefined; }
  }
  return undefined;
}

export function adminSessionCookie(token: string, expiresAt: Date) {
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secureCookie() ? "; Secure" : ""}`;
}

export function clearedAdminSessionCookie() {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie() ? "; Secure" : ""}`;
}

export async function getAdminIdentity(headers: Headers): Promise<AdminIdentity | null> {
  const token = parseAdminSessionCookie(headers);
  if (!token || !token.startsWith("adm_")) return null;
  return withAuthTransaction(async tx => {
    return new AdminSessionRepository(tx).current(hashAdminSessionToken(token));
  });
}
export function hasAdminPermission(identity: AdminIdentity, permission: string) { return identity.permissions.includes(permission); }
export function verifyBootstrapToken(candidate: string | null) {
  const configured = process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!configured || Buffer.byteLength(configured) < 32 || !candidate) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(candidate), digest(configured));
}
