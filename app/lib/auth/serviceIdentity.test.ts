// [Sync] 2026-10-11: enforce same-client exact callbacks and reject incompatible DPoP without changing token protocol.
// [Input] OAuth service bearer, registered clients and background scopes.
// [Output] client_credentials binding, scope enforcement and user-override rejection evidence.
// [Pos] Provider-free confidential service identity boundary tests.
// [Sync] 2026-09-28: accept task-return scope only from a matching registered service token.
import { describe, expect, it, vi } from "vitest";
import { requireBackgroundScope, requireDreamService } from "./serviceIdentity";
import type { DreamServiceClient } from "./config";

const clients: DreamServiceClient[] = [{
  id: "bff-a",
  secret: "fixture-service-secret-longer-than-32",
  origin: "https://dream.example.test",
  oauthClientId: "browser-a",
  redirectUri: "https://dream.example.test/auth/callback",
  backgroundScopes: ["capabilities:read", "task-return:dispatch"],
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
    expect(() => requireBackgroundScope(service, "task-return:dispatch")).toThrow("DREAM_SERVICE_SCOPE_REQUIRED");
    const returnService = await requireDreamService(request(), clients,
      verified({ scopes: ["task-return:dispatch"] }));
    expect(() => requireBackgroundScope(returnService, "task-return:dispatch")).not.toThrow();
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


describe("same-client published browser address", () => {
  const local = { ...clients[0], id: "local-bff", origin: "http://localhost:5173",
    oauthClientId: "local-browser", redirectUri: "http://localhost:5173/auth/callback" };
  const both = [clients[0], local];
  const localToken = verified({ subject: local.id, clientId: local.id });
  it("keeps the verified service/client and scopes when selecting a published public callback", async () => {
    const check = vi.fn().mockResolvedValue(true);
    const result = await requireDreamService(request({ origin: clients[0].origin }), both, localToken, check);
    expect(result).toMatchObject({ id: local.id, oauthClientId: local.oauthClientId, secret: local.secret,
      origin: clients[0].origin, redirectUri: clients[0].redirectUri, backgroundScopes: ["capabilities:read"] });
    expect(check).toHaveBeenCalledWith(local, clients[0].redirectUri);
    expect(local.origin).toBe("http://localhost:5173");
  });
  it("rejects unpublished addresses, origin ambiguity and a different registered pathname", async () => {
    const check = vi.fn().mockResolvedValue(false);
    await expect(requireDreamService(request({ origin: clients[0].origin }), both, localToken, check)).rejects.toThrow("DREAM_ORIGIN_DENIED");
    check.mockResolvedValue(true);
    await expect(requireDreamService(request({ origin: clients[0].origin }), [...both, { ...clients[0], id: "another" }], localToken, check)).rejects.toThrow("DREAM_ORIGIN_DENIED");
    await expect(requireDreamService(request({ origin: clients[0].origin }), [{ ...clients[0], redirectUri: clients[0].origin + "/another-callback" }, local], localToken, check)).rejects.toThrow("DREAM_ORIGIN_DENIED");
  });
  it("denies present empty/multivalue Origin instead of treating it as a background request", async () => {
    const check = vi.fn();
    for (const origin of ["", clients[0].origin + ",http://localhost:5173", clients[0].origin + "/", "null"]) {
      await expect(requireDreamService(request({ origin }), both, localToken, check)).rejects.toThrow("DREAM_ORIGIN_DENIED");
    }
    expect(check).not.toHaveBeenCalled();
    const legacy = await requireDreamService(request(), both, localToken, check);
    expect(legacy.origin).toBe(local.origin);
    expect(legacy.oauthClientId).toBe(local.oauthClientId);
  });
});
