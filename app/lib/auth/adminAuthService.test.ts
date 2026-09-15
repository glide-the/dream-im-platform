// [Input] Actual sign-in/out service with installed protocol and ORM identity boundaries injected.
// [Output] Membership failure aborts UOW; Session tokens stay in cookies and safe audit only.
// [Pos] Provider-free Admin auth integration tests.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ protocol: vi.fn(), session: vi.fn(), current: vi.fn(), audit: vi.fn() }));
vi.mock("./server", () => ({ handleAuthOnTransaction: mocks.protocol, createAdminAuth: () => ({ api: { getSession: mocks.session } }) }));
vi.mock("./config", () => ({ authConfiguration: () => ({ issuer: "https://admin.example/api/auth" }) }));
vi.mock("./adminIdentityRepository", () => ({ AdminIdentityRepository: class { current = mocks.current; loginAudit = mocks.audit; } }));
import { signInAdminOnTransaction, signOutAdminOnTransaction } from "./adminAuthService";
import type { AuthTransaction } from "./database";
const tx = {} as AuthTransaction, request = new Request("https://admin.example/api/admin/auth/login", { method: "POST", headers: { origin: "https://admin.example" } });
beforeEach(() => { vi.clearAllMocks(); mocks.protocol.mockImplementation(async () => Response.json({ user: { id: "auth-user" }, token: "never-response-body" }, { headers: { "set-cookie": "better-auth.session_token=opaque; HttpOnly; Path=/" } })); mocks.session.mockResolvedValue({ user: { id: "auth-user" }, session: { id: "session" } }); mocks.current.mockResolvedValue({ id: "admin", email: "admin@example.test", permissions: [], sessionId: "session" }); });
describe("Admin protocol service", () => {
  it("returns safe existing user DTO and installed HttpOnly cookie, audits in the same UOW", async () => {
    const response = await signInAdminOnTransaction(tx, request, "request1", { email: "admin@example.test", password: "supplied" });
    expect(await response.json()).toEqual({ data: { id: "admin", email: "admin@example.test" } });
    expect(response.headers.get("set-cookie")).toContain("HttpOnly"); expect(mocks.audit).toHaveBeenCalledTimes(1);
  });
  it("throws for ordinary Session membership and never records successful Admin login", async () => {
    mocks.current.mockResolvedValue(null);
    await expect(signInAdminOnTransaction(tx, request, "request1", { email: "user@example.test", password: "supplied" })).rejects.toMatchObject({ status: 403 });
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("refuses failed protocol sign-in without looking up or issuing an Admin session", async () => {
    mocks.protocol.mockResolvedValue(Response.json({ code: "INVALID" }, { status: 401 }));
    await expect(signInAdminOnTransaction(tx, request, "request1", { email: "user@example.test", password: "wrong" })).rejects.toMatchObject({ status: 401 });
    expect(mocks.current).not.toHaveBeenCalled();
  });
  it("delegates logout to actual protocol and forwards its cookie clearing", async () => {
    mocks.protocol.mockResolvedValue(Response.json({ success: true }, { headers: { "set-cookie": "better-auth.session_token=; Max-Age=0; HttpOnly" } }));
    const response = await signOutAdminOnTransaction(tx, request, "request1"); expect(await response.json()).toEqual({ data: { loggedOut: true } }); expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
