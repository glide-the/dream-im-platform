// [Input] Shared Admin grant verifier and explicit active subject/repository boundaries.
// [Output] Product canonical mapping, scope/outage refusal and existing entitlement projection checks.
// [Pos] Provider-free Product authentication integration of the sole Admin authority.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), active: vi.fn() }));
vi.mock("../auth/accessToken", () => ({ verifyAdminAccessToken: mocks.verify }));
vi.mock("../auth/database", () => ({ withAuthTransaction: (callback: (tx: unknown) => unknown) => callback({}) }));
vi.mock("../auth/subjectRepository", () => ({ SubjectRepository: class { findActive = mocks.active; } }));
import { AuthBoundaryError } from "../auth/config";
import { requireProductPrincipal, verifyProductJwt } from "./auth";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockResolvedValue({ subject: "auth-independent-sub", clientId: "browser", tokenId: "jti", scopes: ["product:read"] });
  mocks.active.mockResolvedValue({ canonicalUserId: 9007199254740993n });
});
describe("Product Admin OAuth authentication", () => {
  it("maps opaque auth subject to exact canonical bigint through the explicit link", async () => {
    const headers = new Headers({ authorization: "Bearer admin-grant" });
    expect(await verifyProductJwt(headers, "product:read")).toEqual({ canonicalUserId: "9007199254740993", clientId: "browser", tokenId: "jti", scopes: ["product:read"] });
    expect(mocks.verify).toHaveBeenCalledWith(headers, "product:read");
    expect(mocks.active).toHaveBeenCalledWith("auth-independent-sub");
  });
  it.each([[401, "PRODUCT_AUTH_REQUIRED"], [403, "PRODUCT_SCOPE_REQUIRED"], [503, "PRODUCT_AUTH_NOT_CONFIGURED"]] as const)("preserves grant boundary status %s", async (status, code) => {
    mocks.verify.mockRejectedValue(new AuthBoundaryError("BOUNDARY", status));
    await expect(verifyProductJwt(new Headers(), "product:read")).rejects.toMatchObject({ status, code });
    expect(mocks.active).not.toHaveBeenCalled();
  });
  it("rejects disabled/unlinked canonical identities even with a valid grant", async () => {
    mocks.active.mockResolvedValue(null);
    await expect(verifyProductJwt(new Headers(), "product:read")).rejects.toMatchObject({ status: 403, code: "CANONICAL_USER_REQUIRED" });
  });
  it("retains platform entitlement projection and refuses inactive projection", async () => {
    const dependencies = { verifyToken: vi.fn().mockResolvedValue({ canonicalUserId: "9007199254740993", clientId: "browser", tokenId: "jti", scopes: ["product:read"] }), readUnitOfWork: async <T,>(handler: (client: PoolClient) => Promise<T>) => handler({} as PoolClient), findIdentity: vi.fn().mockResolvedValue({ canonical_user_id: "9007199254740993", platform_user_id: "usr_projection", platform_status: "active", tier: "creator" }) };
    const request = new Request("https://admin.example/api/product/v1/plans");
    expect(await requireProductPrincipal(request, "product:read", dependencies)).toMatchObject({ platformUserId: "usr_projection", tier: "creator" });
    dependencies.findIdentity.mockResolvedValue({ canonical_user_id: "9007199254740993", platform_user_id: "usr_projection", platform_status: "disabled", tier: "creator" });
    await expect(requireProductPrincipal(request, "product:read", dependencies)).rejects.toMatchObject({ status: 403, code: "CANONICAL_USER_REQUIRED" });
  });
});
