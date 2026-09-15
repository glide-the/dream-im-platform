// [Input] Installed Session identity and explicit live Admin repository via production functions.
// [Output] Unauthenticated versus ordinary-user refusal, live RBAC and no legacy-session authority.
// [Pos] Provider-free Admin session/guard tests.
import { describe, expect, it, beforeEach, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), current: vi.fn() }));
vi.mock("../auth/server", () => ({ createAdminAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("../auth/database", () => ({ withAuthTransaction: (callback: (tx: unknown) => unknown) => callback({}) }));
vi.mock("../auth/adminIdentityRepository", () => ({ AdminIdentityRepository: class { current = mocks.current; } }));
import { getAdminIdentity } from "./session";
import { requireAdminRequest } from "./guard";
const identity = { id: "admin", email: "admin@example.test", roles: ["auditor"], permissions: ["system.read"], sessionId: "auth-session" };
beforeEach(() => { vi.clearAllMocks(); mocks.getSession.mockResolvedValue({ user: { id: "auth-subject" }, session: { id: "auth-session" } }); mocks.current.mockResolvedValue(identity); });
describe("sole Admin Session authority", () => {
  it("reads actual Session with cache and renewal disabled and resolves live RBAC", async () => {
    const headers = new Headers({ cookie: "better-auth.session_token=opaque" });
    expect(await getAdminIdentity(headers)).toEqual(identity);
    expect(mocks.getSession).toHaveBeenCalledWith({ headers, query: { disableCookieCache: true, disableRefresh: true } });
    expect(mocks.current).toHaveBeenCalledWith("auth-subject", "auth-session");
  });
  it("treats retired adm cookie without a Better Auth Session as unauthenticated", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(requireAdminRequest(new Request("https://admin.example/api/admin/auth/me", { headers: { cookie: "ink_admin_session=adm_old" } }))).rejects.toMatchObject({ status: 401, code: "ADMIN_AUTH_REQUIRED" });
    expect(mocks.current).not.toHaveBeenCalled();
  });
  it("refuses normal authenticated users without active explicit Admin membership", async () => {
    mocks.current.mockResolvedValue(null);
    await expect(requireAdminRequest(new Request("https://admin.example/api/admin/auth/me"))).rejects.toMatchObject({ status: 403 });
  });
  it("enforces current named permission on every API request", async () => {
    const request = new Request("https://admin.example/api/admin/system");
    expect(await requireAdminRequest(request, "system.read")).toEqual(identity);
    await expect(requireAdminRequest(request, "system.write")).rejects.toMatchObject({ status: 403 });
    expect(mocks.current).toHaveBeenCalledTimes(2);
  });
});
