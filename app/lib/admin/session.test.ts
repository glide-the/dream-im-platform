// [Input] Independent Admin cookie and live Admin session/RBAC repository via production functions.
// [Output] Admin Session lookup, Dream-cookie rejection and per-request permission enforcement.
// [Pos] Provider-free Admin session/guard tests.
// [Sync] 2026-09-17: prove Better Auth cookies and Dream identities cannot authorize Admin routes.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ current: vi.fn() }));
vi.mock("../auth/database", () => ({ withAuthTransaction: (callback: (tx: unknown) => unknown) => callback({}) }));
vi.mock("../auth/adminSessionRepository", () => ({ AdminSessionRepository: class { current = mocks.current; } }));

import { getAdminIdentity } from "./session";
import { requireAdminRequest } from "./guard";

const identity = {
  id: "admin",
  email: "admin@example.test",
  roles: ["auditor"],
  permissions: ["system.read"],
  sessionId: "admin-session",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_SESSION_SECRET", "fixture-admin-session-secret-longer-than-32-bytes");
  mocks.current.mockResolvedValue(identity);
});

describe("independent Admin Session authority", () => {
  it("hashes the opaque Admin cookie and resolves live RBAC", async () => {
    const headers = new Headers({ cookie: "ink_admin_session=adm_fixture" });
    expect(await getAdminIdentity(headers)).toEqual(identity);
    expect(mocks.current).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it("rejects a Better Auth/Dream cookie without querying Admin sessions", async () => {
    await expect(requireAdminRequest(new Request("https://admin.example/api/admin/auth/me", {
      headers: { cookie: "better-auth.session_token=dream-session" },
    }))).rejects.toMatchObject({ status: 401, code: "ADMIN_AUTH_REQUIRED" });
    expect(mocks.current).not.toHaveBeenCalled();
  });

  it("treats an unknown or expired Admin session as unauthenticated", async () => {
    mocks.current.mockResolvedValue(null);
    await expect(requireAdminRequest(new Request("https://admin.example/api/admin/auth/me", {
      headers: { cookie: "ink_admin_session=adm_unknown" },
    }))).rejects.toMatchObject({ status: 401, code: "ADMIN_AUTH_REQUIRED" });
  });

  it("enforces current named permission on every API request", async () => {
    const request = new Request("https://admin.example/api/admin/system", {
      headers: { cookie: "ink_admin_session=adm_fixture" },
    });
    expect(await requireAdminRequest(request, "system.read")).toEqual(identity);
    await expect(requireAdminRequest(request, "system.write")).rejects.toMatchObject({ status: 403 });
    expect(mocks.current).toHaveBeenCalledTimes(2);
  });
});
