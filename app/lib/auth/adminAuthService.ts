// [Input] Strict Admin credentials and the installed Better Auth protocol in one ORM UOW.
// [Output] Active mapped Admin login/logout response with only HttpOnly Session cookies.
// [Pos] Sole Admin login authority; membership and audit are checked before commit.
import { z } from "zod";
import { AdminError } from "../admin/errors";
import type { AuthTransaction } from "./database";
import { AdminIdentityRepository } from "./adminIdentityRepository";
import { authConfiguration } from "./config";
import { handleAuthOnTransaction } from "./server";
const signInResult = z.object({ user: z.object({ id: z.string().min(1) }) });
function responseHeaders(protocol: Response, requestId: string) {
  const headers = new Headers({ "cache-control": "no-store", "x-request-id": requestId });
  for (const cookie of protocol.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return headers;
}
export async function signInAdminOnTransaction(tx: AuthTransaction, request: Request, requestId: string, input: { email: string; password: string }, status = 200) {
  const protocol = await handleAuthOnTransaction(new Request(`${authConfiguration().issuer}/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", origin: request.headers.get("origin") ?? "" }, body: JSON.stringify(input) }), tx);
  if (!protocol.ok) throw new AdminError(protocol.status >= 500 ? "ADMIN_AUTH_UNAVAILABLE" : "ADMIN_CREDENTIALS_INVALID", "The email or password is invalid or authentication is unavailable", protocol.status >= 500 ? 503 : 401);
  const result = signInResult.safeParse(await protocol.json());
  if (!result.success) throw new AdminError("ADMIN_AUTH_UNAVAILABLE", "Admin authentication is unavailable", 503);
  const cookies = protocol.headers.getSetCookie();
  const headers = new Headers({ cookie: cookies.map(cookie => cookie.split(";", 1)[0]).join("; ") });
  // Resolve the actual persisted Session instead of returning sign-in's token.
  const { createAdminAuth } = await import("./server");
  const session = await createAdminAuth(tx).api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } });
  if (!session || session.user.id !== result.data.user.id) throw new AdminError("ADMIN_AUTH_UNAVAILABLE", "Admin authentication is unavailable", 503);
  const repository = new AdminIdentityRepository(tx);
  const identity = await repository.current(session.user.id, session.session.id);
  if (!identity) throw new AdminError("ADMIN_PERMISSION_DENIED", "An active Admin membership is required", 403);
  await repository.loginAudit(identity, requestId);
  return Response.json({ data: { id: identity.id, email: identity.email, displayName: identity.displayName } }, { status, headers: responseHeaders(protocol, requestId) });
}
export async function signOutAdminOnTransaction(tx: AuthTransaction, request: Request, requestId: string) {
  const protocol = await handleAuthOnTransaction(new Request(`${authConfiguration().issuer}/sign-out`, { method: "POST", headers: { "content-type": "application/json", cookie: request.headers.get("cookie") ?? "", origin: request.headers.get("origin") ?? "" }, body: "{}" }), tx);
  if (!protocol.ok) throw new AdminError("ADMIN_AUTH_UNAVAILABLE", "Admin logout is unavailable", 503);
  return Response.json({ data: { loggedOut: true } }, { headers: responseHeaders(protocol, requestId) });
}
