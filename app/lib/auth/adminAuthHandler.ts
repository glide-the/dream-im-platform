// [Input] Public Admin compatibility auth requests with Origin and strict credentials.
// [Output] Existing Admin response envelope using the independent Admin Session service.
// [Pos] Thin ingress; validation/UOW/audit stay in auth domain modules.
// [Sync] 2026-09-17: issue and revoke independent Admin sessions without Dream identity adoption.
import { z } from "zod";
import { AdminError, adminErrorResponse } from "../admin/errors";
import { adminRequestId, assertAdminMutationOrigin } from "../admin/guard";
import { verifyBootstrapToken } from "../admin/session";
import { ADMIN_PASSWORD_MIN_LENGTH } from "../admin/password";
import { bootstrapFirstAdmin, isAdminBootstrapRequired } from "../admin/bootstrap";
import { withAuthTransaction } from "./database";
import { parseAuthDto } from "./internalHandler";
import { AuthBoundaryError } from "./config";
import { signInAdminOnTransaction, signOutAdminOnTransaction } from "./adminAuthService";
const credentials = z.strictObject({ email: z.email().max(320), password: z.string().min(1).max(256) });
const bootstrap = z.strictObject({ email: z.email().max(320), displayName: z.string().trim().min(1).max(120).optional(), password: z.string().min(ADMIN_PASSWORD_MIN_LENGTH).max(256) });
async function handleAdminAuth(request: Request, action: (requestId: string) => Promise<Response>) {
  const requestId = adminRequestId(request);
  try { assertAdminMutationOrigin(request); return await action(requestId); }
  catch (error) { return adminErrorResponse(error instanceof AuthBoundaryError ? new AdminError(error.status < 500 ? "ADMIN_AUTH_INPUT_INVALID" : "ADMIN_AUTH_UNAVAILABLE", "Admin authentication could not be completed", error.status) : error, requestId); }
}
export function handleAdminSignIn(request: Request) { return handleAdminAuth(request, async requestId => { const input = await parseAuthDto(request, credentials); return withAuthTransaction(tx => signInAdminOnTransaction(tx, request, requestId, input)); }); }
export function handleAdminSignOut(request: Request) { return handleAdminAuth(request, requestId => withAuthTransaction(tx => signOutAdminOnTransaction(tx, request, requestId))); }
export function handleAdminBootstrap(request: Request) { return handleAdminAuth(request, async requestId => {
  if (!verifyBootstrapToken(request.headers.get("x-admin-bootstrap-token"))) throw new AdminError("ADMIN_BOOTSTRAP_DENIED", "Admin bootstrap is not available", 403);
  const input = await parseAuthDto(request, bootstrap);
  return bootstrapFirstAdmin({ ...input, request, requestId });
}); }
export async function handleAdminBootstrapStatus(request: Request) {
  const requestId = adminRequestId(request);
  try { return Response.json({ data: { required: await isAdminBootstrapRequired() } }, { headers: { "cache-control": "no-store", "x-request-id": requestId } }); }
  catch { return adminErrorResponse(new AdminError("ADMIN_BOOTSTRAP_STATUS_UNAVAILABLE", "Admin setup status is unavailable", 503), requestId); }
}
