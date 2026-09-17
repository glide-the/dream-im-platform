// [Input] Strict Admin credentials/cookie and one Admin-only Drizzle authentication UOW.
// [Output] Active Admin member login/logout responses with an independent HttpOnly management Session.
// [Pos] Admin operator service; Dream Better Auth users, OAuth tokens and subject links are outside this boundary.
// [Sync] 2026-09-17: restore independent admin_users/admin_sessions authentication without Dream identity merging.
import { AdminError } from "../admin/errors";
import type { AuthTransaction } from "./database";
import { AdminSessionRepository } from "./adminSessionRepository";
import { hashAdminPassword, verifyAdminPassword } from "../admin/password";
import { randomUUID } from "node:crypto";
import {
  adminSessionCookie,
  adminSessionExpiry,
  adminSessionToken,
  clearedAdminSessionCookie,
  hashAdminSessionToken,
  parseAdminSessionCookie,
} from "../admin/session";

let dummyHash: Promise<string> | undefined;
function getDummyHash() {
  dummyHash ??= hashAdminPassword("invalid admin password placeholder");
  return dummyHash;
}

function requestIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? null;
}

function responseHeaders(requestId: string, cookie: string) {
  return new Headers({ "cache-control": "no-store", "x-request-id": requestId, "set-cookie": cookie });
}

export async function signInAdminOnTransaction(tx: AuthTransaction, request: Request, requestId: string, input: { email: string; password: string }, status = 200) {
  const repository = new AdminSessionRepository(tx);
  const email = input.email.trim().toLowerCase();
  const member = await repository.findByNormalizedEmail(email);
  const passwordHash = member?.passwordHash ?? await getDummyHash();
  const valid = await verifyAdminPassword(input.password, passwordHash);
  if (!member || !valid || member.status !== "active") {
    throw new AdminError("ADMIN_CREDENTIALS_INVALID", "The email or password is invalid", 401);
  }
  const token = adminSessionToken();
  const expiresAt = adminSessionExpiry();
  const sessionId = `asess_${randomUUID().replaceAll("-", "")}`;
  await repository.createSession({
    sessionId,
    adminUserId: member.id,
    tokenHash: hashAdminSessionToken(token),
    expiresAt,
    requestId,
    ipAddress: requestIp(request),
    userAgent: request.headers.get("user-agent")?.slice(0, 500) ?? null,
  });
  return Response.json(
    { data: { id: member.id, email: member.email, displayName: member.displayName ?? undefined } },
    { status, headers: responseHeaders(requestId, adminSessionCookie(token, expiresAt)) },
  );
}
export async function signOutAdminOnTransaction(tx: AuthTransaction, request: Request, requestId: string) {
  const token = parseAdminSessionCookie(request.headers);
  if (token) await new AdminSessionRepository(tx).revoke(hashAdminSessionToken(token));
  return Response.json(
    { data: { loggedOut: true } },
    { headers: responseHeaders(requestId, clearedAdminSessionCookie()) },
  );
}
