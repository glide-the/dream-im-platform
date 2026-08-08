import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";

export const ADMIN_SESSION_COOKIE = "ink_admin_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1_000;

export type AdminIdentity = {
  id: string;
  email: string;
  displayName?: string;
  roles: string[];
  permissions: string[];
  sessionId: string;
};

function sessionSecret() {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (!value || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error("ADMIN_SESSION_SECRET_NOT_CONFIGURED");
  }
  return value;
}

function hashSessionToken(token: string) {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

export function parseCookie(headers: Headers, name: string) {
  const cookies = headers.get("cookie") ?? "";
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return decodeURIComponent(item.slice(separator + 1).trim());
    }
  }
  return undefined;
}

export function adminSessionCookie(token: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearedAdminSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export async function createAdminSession(adminUserId: string) {
  const token = `adm_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const sessionId = createPlatformId("asess");
  await withPlatformClient(async (client) => {
    await client.query(
      `INSERT INTO admin_sessions (
         id, admin_user_id, token_hash, expires_at
       ) VALUES ($1, $2, $3, $4)`,
      [sessionId, adminUserId, hashSessionToken(token), expiresAt],
    );
  });
  return { token, expiresAt, sessionId };
}

export async function revokeAdminSession(token: string | undefined) {
  if (!token) return;
  await withPlatformClient(async (client) => {
    await client.query(
      `UPDATE admin_sessions
       SET revoked_at = COALESCE(revoked_at, NOW())
       WHERE token_hash = $1`,
      [hashSessionToken(token)],
    );
  });
}

export async function getAdminIdentityFromToken(
  token: string | undefined,
): Promise<AdminIdentity | null> {
  if (!token || !token.startsWith("adm_")) return null;
  return await withPlatformTransaction(async (client) => {
    const { rows } = await client.query<{
      session_id: string;
      user_id: string;
      email: string;
      display_name: string | null;
    }>(
      `SELECT s.id AS session_id, u.id AS user_id, u.email, u.display_name
       FROM admin_sessions AS s
       JOIN admin_users AS u ON u.id = s.admin_user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL
         AND s.expires_at > NOW() AND u.status = 'active'
       LIMIT 1
       FOR UPDATE OF s`,
      [hashSessionToken(token)],
    );
    const user = rows[0];
    if (!user) return null;
    const roles = await client.query<{ code: string }>(
      `SELECT DISTINCT r.code
       FROM admin_user_roles AS ur
       JOIN admin_roles AS r ON r.id = ur.role_id
       WHERE ur.admin_user_id = $1
       ORDER BY r.code`,
      [user.user_id],
    );
    const permissions = await client.query<{ code: string }>(
      `SELECT DISTINCT p.code
       FROM admin_user_roles AS ur
       JOIN admin_role_permissions AS rp ON rp.role_id = ur.role_id
       JOIN admin_permissions AS p ON p.id = rp.permission_id
       WHERE ur.admin_user_id = $1
       ORDER BY p.code`,
      [user.user_id],
    );
    await client.query(
      `UPDATE admin_sessions SET last_seen_at = NOW() WHERE id = $1`,
      [user.session_id],
    );
    return {
      id: user.user_id,
      email: user.email,
      displayName: user.display_name ?? undefined,
      roles: roles.rows.map((role) => role.code),
      permissions: permissions.rows.map((permission) => permission.code),
      sessionId: user.session_id,
    };
  });
}

export function hasAdminPermission(
  identity: AdminIdentity,
  permission: string,
) {
  return identity.permissions.includes(permission);
}

export function verifyBootstrapToken(candidate: string | null) {
  const configured = process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!configured || Buffer.byteLength(configured) < 32 || !candidate) return false;
  const expected = createHmac("sha256", sessionSecret())
    .update(configured)
    .digest();
  const actual = createHmac("sha256", sessionSecret()).update(candidate).digest();
  return timingSafeEqual(actual, expected);
}
