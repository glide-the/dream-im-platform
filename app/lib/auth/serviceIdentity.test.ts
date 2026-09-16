// [Input] OAuth service bearer, registered clients and background scopes.
// [Output] client_credentials binding, scope enforcement and user-override rejection evidence.
// [Pos] Provider-free confidential service identity boundary tests.
// [Sync] 2026-09-17: reject legacy custom headers and require an M2M subject/client match.
import { describe, expect, it } from "vitest";
import { requireBackgroundScope, requireDreamService } from "./serviceIdentity";
import type { DreamServiceClient } from "./config";

const clients: DreamServiceClient[] = [{
  id: "bff-a",
  secret: "fixture-service-secret-longer-than-32",
  origin: "https://dream.example.test",
  oauthClientId: "browser-a",
  redirectUri: "https://dream.example.test/auth/callback",
  backgroundScopes: ["capabilities:read"],
}];
function request(extra: Record<string, string> = {}) {
  return new Request("https://admin.example.test/api/internal/dream/v1/principal", {
    headers: { authorization: "Bearer service-token", ...extra },
  });
}
function verified(change: Partial<{ subject: string; clientId: string; scopes: string[] }> = {}) {
  return async () => ({ subject: "bff-a", clientId: "bff-a", tokenId: "token-1", scopes: ["capabilities:read"], ...change });
}

describe("OAuth service identity", () => {
  it("authenticates the registered confidential client and issued background scope", async () => {
    const service = await requireDreamService(request(), clients, verified());
    expect(service.oauthClientId).toBe("browser-a");
    expect(() => requireBackgroundScope(service, "capabilities:read")).not.toThrow();
    expect(() => requireBackgroundScope(service, "resource-observer:write")).toThrow("DREAM_SERVICE_SCOPE_REQUIRED");
  });

  it("denies a delegated subject, unknown client, wrong Origin or actor override", async () => {
    await expect(requireDreamService(request(), clients, verified({ subject: "dream-user" }))).rejects.toThrow("DREAM_SERVICE_REQUIRED");
    await expect(requireDreamService(request(), clients, verified({ subject: "bff-b", clientId: "bff-b" }))).rejects.toThrow("DREAM_SERVICE_REQUIRED");
    await expect(requireDreamService(request({ origin: "https://other.example.test" }), clients, verified())).rejects.toThrow("DREAM_ORIGIN_DENIED");
    await expect(requireDreamService(request({ "x-user-id": "100" }), clients, verified())).rejects.toThrow("USER_OVERRIDE_FORBIDDEN");
  });

  it("denies out-of-policy scopes and retired static service headers", async () => {
    await expect(requireDreamService(request(), clients, verified({ scopes: ["dream:read"] }))).rejects.toThrow("DREAM_SERVICE_REQUIRED");
    await expect(requireDreamService(request({ "x-ink-dream-service": "bff-a", "x-ink-dream-credential": clients[0].secret }), clients, verified())).rejects.toThrow("DREAM_SERVICE_REQUIRED");
  });
});
