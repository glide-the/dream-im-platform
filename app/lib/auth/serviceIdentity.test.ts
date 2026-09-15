// [Input] Independent service/Origin fixtures with explicit background scope subsets.
// [Output] Service success and credential/client/actor/origin/scope denial evidence.
// [Pos] Internal authentication boundary tests, no database or provider.
// [Sync] 2026-09-14: assert service auth cannot select another user's actor identity.
import { describe, expect, it } from "vitest";
import { requireBackgroundScope, requireDreamService } from "./serviceIdentity";
import type { DreamServiceClient } from "./config";
const clients: DreamServiceClient[] = [{ id: "bff-a", secret: "fixture-service-secret-longer-than-32", origin: "https://dream.example.test", oauthClientId: "browser-a", redirectUri: "https://dream.example.test/auth/callback", backgroundScopes: ["capabilities:read"] }];
function request(extra: Record<string, string> = {}) { return new Request("https://admin.example.test/api/internal/dream/v1/principal", { headers: { "x-ink-dream-service": clients[0].id, "x-ink-dream-credential": clients[0].secret, ...extra } }); }
describe("separate service identity", () => {
  it("authenticates the selected client and its allowed background scope", () => {
    expect(requireDreamService(request(), clients).oauthClientId).toBe("browser-a");
    expect(() => requireBackgroundScope(clients[0], "capabilities:read")).not.toThrow();
    expect(() => requireBackgroundScope(clients[0], "resource-observer:write")).toThrow("DREAM_SERVICE_SCOPE_REQUIRED");
  });
  it.each([{ "x-ink-dream-service": "bff-b" }, { "x-ink-dream-credential": "different" }, { "origin": "https://other.example.test" }, { "x-user-id": "100" }])("denies mismatched service/credential/origin or actor override %o", headers => {
    expect(() => requireDreamService(request(headers), clients)).toThrow();
  });
});
