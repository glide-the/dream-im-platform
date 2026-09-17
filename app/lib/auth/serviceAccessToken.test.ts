// [Input] Injected production token-verifier/subject boundary and explicit browser/device or opaque worker bearers.
// [Output] Service OAuth client binding succeeds or fails before any domain repository access.
// [Pos] Provider-free grant boundary checks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const principal = vi.hoisted(() => vi.fn());
vi.mock("./browserSessionService", () => ({ principalForAccessToken: principal }));
import { principalForServiceToken } from "./serviceAccessToken";
import type { DreamServiceClient } from "./config";
const service: DreamServiceClient = { id: "dream", secret: "s".repeat(32), origin: "https://dream.example", oauthClientId: "browser", redirectUri: "https://dream.example/callback", backgroundScopes: [] };
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => principal.mockReset());
describe("service-bound OAuth user grant", () => {
  it("denies an entity grant at an OAuth-only boundary before JWT or subject lookup", async () => {
    await expect(principalForServiceToken({} as Parameters<typeof principalForServiceToken>[0], `idg_${"x".repeat(43)}`, service, "dream:read")).rejects.toMatchObject({ code: "DELEGATION_PURPOSE_DENIED", status: 403 });
    expect(principal).not.toHaveBeenCalled();
  });
  it("denies a Reflections authority at an OAuth-only boundary before JWT or subject lookup", async () => {
    await expect(principalForServiceToken({} as Parameters<typeof principalForServiceToken>[0], `rta_${"x".repeat(43)}`, service, "dream:read")).rejects.toMatchObject({ code: "REFLECTION_AUTHORITY_OPERATION_DENIED", status: 403 });
    expect(principal).not.toHaveBeenCalled();
  });
  it.each(["browser", "device"])("accepts the configured %s client", async client => {
    vi.stubEnv("AUTH_DEVICE_CLIENT_ID", "device"); principal.mockResolvedValue({ client_id: client });
    expect(await principalForServiceToken({} as Parameters<typeof principalForServiceToken>[0], "token", service, "dream:read")).toEqual({ client_id: client });
  });
  it("rejects a valid resource grant for another service client", async () => {
    vi.stubEnv("AUTH_DEVICE_CLIENT_ID", "device"); principal.mockResolvedValue({ client_id: "another-browser" });
    await expect(principalForServiceToken({} as Parameters<typeof principalForServiceToken>[0], "token", service, "dream:read")).rejects.toMatchObject({ code: "ACCESS_CLIENT_DENIED", status: 403 });
  });
});
