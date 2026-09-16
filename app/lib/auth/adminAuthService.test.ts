// [Input] Strict Admin credentials/cookies with repository and cryptographic primitives injected.
// [Output] Independent Admin login/logout behavior without Better Auth, Dream user or subject-link access.
// [Pos] Provider-free Admin management authentication service tests.
// [Sync] 2026-09-17: cover admin_users/admin_sessions separation and fail-closed credentials.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  find: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("./adminSessionRepository", () => ({
  AdminSessionRepository: class {
    findByNormalizedEmail = mocks.find;
    createSession = mocks.create;
    revoke = mocks.revoke;
  },
}));
vi.mock("../admin/password", () => ({
  hashAdminPassword: async () => "dummy-admin-hash",
  verifyAdminPassword: mocks.verify,
}));
vi.mock("../admin/session", () => ({
  adminSessionToken: () => "adm_fixture",
  adminSessionExpiry: () => new Date("2026-09-18T00:00:00.000Z"),
  hashAdminSessionToken: () => "session-hash",
  adminSessionCookie: () => "ink_admin_session=adm_fixture; HttpOnly; Path=/",
  clearedAdminSessionCookie: () => "ink_admin_session=; Max-Age=0; HttpOnly; Path=/",
  parseAdminSessionCookie: () => "adm_fixture",
}));

import { signInAdminOnTransaction, signOutAdminOnTransaction } from "./adminAuthService";
import type { AuthTransaction } from "./database";

const tx = {} as AuthTransaction;
const request = new Request("https://admin.example/api/admin/auth/login", {
  method: "POST",
  headers: { origin: "https://admin.example", "user-agent": "test-agent" },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue({
    id: "admin-1",
    email: "admin@example.test",
    displayName: "Operator",
    passwordHash: "admin-scrypt-hash",
    status: "active",
  });
  mocks.verify.mockResolvedValue(true);
  mocks.create.mockResolvedValue(undefined);
  mocks.revoke.mockResolvedValue(undefined);
});

describe("independent Admin management authentication", () => {
  it("validates only the Admin member hash and creates an Admin Session with safe DTO output", async () => {
    const response = await signInAdminOnTransaction(tx, request, "request1", {
      email: " ADMIN@example.test ",
      password: "admin-password",
    });
    expect(mocks.find).toHaveBeenCalledWith("admin@example.test");
    expect(mocks.verify).toHaveBeenCalledWith("admin-password", "admin-scrypt-hash");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: "admin-1",
      tokenHash: "session-hash",
      requestId: "request1",
    }));
    expect(await response.json()).toEqual({ data: { id: "admin-1", email: "admin@example.test", displayName: "Operator" } });
    expect(response.headers.get("set-cookie")).toContain("ink_admin_session=adm_fixture");
  });

  it("uses a dummy hash for an unknown email and never creates a Session", async () => {
    mocks.find.mockResolvedValue(null);
    await expect(signInAdminOnTransaction(tx, request, "request1", {
      email: "dream@example.test",
      password: "dream-password",
    })).rejects.toMatchObject({ status: 401, code: "ADMIN_CREDENTIALS_INVALID" });
    expect(mocks.verify).toHaveBeenCalledWith("dream-password", "dummy-admin-hash");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "active" }, false],
    [{ status: "disabled" }, true],
  ])("refuses invalid credentials or inactive Admin members", async (change, valid) => {
    mocks.find.mockResolvedValue({
      id: "admin-1", email: "admin@example.test", displayName: null,
      passwordHash: "admin-scrypt-hash", status: change.status,
    });
    mocks.verify.mockResolvedValue(valid);
    await expect(signInAdminOnTransaction(tx, request, "request1", {
      email: "admin@example.test",
      password: "supplied",
    })).rejects.toMatchObject({ status: 401 });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("revokes only the Admin Session cookie on logout", async () => {
    const response = await signOutAdminOnTransaction(tx, request, "request1");
    expect(mocks.revoke).toHaveBeenCalledWith("session-hash");
    expect(await response.json()).toEqual({ data: { loggedOut: true } });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
