// [Input] Separate per-client service ID/credential and configured allowed origin/client/background scope.
// [Output] Authenticated service context, never a caller-selected canonical user.
// [Pos] Internal Dream API authentication boundary.
// [Sync] 2026-09-14: separate service authentication from user OAuth and reject identity overrides.
import { createHash, timingSafeEqual } from "node:crypto";
import { AuthBoundaryError, dreamServiceClients, type DreamServiceClient } from "./config";

export function requireDreamService(request: Request, clients = dreamServiceClients()): DreamServiceClient {
  const id = request.headers.get("x-ink-dream-service");
  const credential = request.headers.get("x-ink-dream-credential");
  const configured = clients.find(client => client.id === id);
  const supplied = createHash("sha256").update(credential ?? "").digest();
  const expected = createHash("sha256").update(configured?.secret ?? "").digest();
  if (!configured || !credential || !timingSafeEqual(supplied, expected)) throw new AuthBoundaryError("DREAM_SERVICE_REQUIRED", 401);
  const overrides = ["x-user-id", "x-canonical-user-id", "x-platform-user-id", "x-external-user-id", "x-ink-user-id"];
  if (overrides.some(header => request.headers.has(header)) || ["user_id", "actor_id", "canonical_user_id"].some(key => new URL(request.url).searchParams.has(key))) throw new AuthBoundaryError("USER_OVERRIDE_FORBIDDEN", 400);
  const origin = request.headers.get("origin");
  if (origin && origin !== configured.origin) throw new AuthBoundaryError("DREAM_ORIGIN_DENIED", 403);
  return configured;
}

export function requireBackgroundScope(service: DreamServiceClient, scope: DreamServiceClient["backgroundScopes"][number]) {
  if (!service.backgroundScopes.includes(scope)) throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
}
