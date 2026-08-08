import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bootstrapFirstAdmin: vi.fn(),
  isAdminBootstrapRequired: vi.fn(),
  assertAdminMutationOrigin: vi.fn(),
  verifyBootstrapToken: vi.fn(),
  createAdminSession: vi.fn(),
}));

vi.mock("../../../../lib/admin/bootstrap", () => ({
  bootstrapFirstAdmin: mocks.bootstrapFirstAdmin,
  isAdminBootstrapRequired: mocks.isAdminBootstrapRequired,
}));

vi.mock("../../../../lib/admin/guard", () => ({
  adminRequestId: () => "admin_request_test",
  assertAdminMutationOrigin: mocks.assertAdminMutationOrigin,
}));

vi.mock("../../../../lib/admin/session", () => ({
  adminSessionCookie: () => "ink_admin_session=test; Path=/; HttpOnly",
  createAdminSession: mocks.createAdminSession,
  verifyBootstrapToken: mocks.verifyBootstrapToken,
}));

import { GET, POST } from "./route";

describe("/api/admin/auth/bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAdminBootstrapRequired.mockResolvedValue(true);
    mocks.verifyBootstrapToken.mockReturnValue(true);
    mocks.bootstrapFirstAdmin.mockResolvedValue({ adminUserId: "admin_1" });
    mocks.createAdminSession.mockResolvedValue({
      token: "session_token",
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });
  });

  it("reports whether first-run setup is required without caching", async () => {
    const response = await GET(
      new Request("http://localhost/api/admin/auth/bootstrap"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: { required: true },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts a password at the fourteen-character first-run minimum", async () => {
    const request = new Request("http://localhost/api/admin/auth/bootstrap", {
      method: "POST",
      headers: {
        origin: "http://localhost",
        "content-type": "application/json",
        "x-admin-bootstrap-token": "bootstrap_test_token",
      },
      body: JSON.stringify({
        email: "dmeck@suoxya.com",
        displayName: "Dmeck",
        password: "test1234567890",
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(mocks.verifyBootstrapToken).toHaveBeenCalledWith(
      "bootstrap_test_token",
    );
    expect(mocks.bootstrapFirstAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "dmeck@suoxya.com",
        displayName: "Dmeck",
        password: "test1234567890",
        requestId: "admin_request_test",
      }),
    );
    expect(response.headers.get("set-cookie")).toContain("ink_admin_session=");
  });

  it("rejects passwords shorter than the first-run minimum", async () => {
    const response = await POST(
      new Request("http://localhost/api/admin/auth/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "dmeck@suoxya.com",
          password: "short",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.bootstrapFirstAdmin).not.toHaveBeenCalled();
  });

  it("keeps the one-time bootstrap token boundary", async () => {
    mocks.verifyBootstrapToken.mockReturnValue(false);

    const response = await POST(
      new Request("http://localhost/api/admin/auth/bootstrap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "dmeck@suoxya.com",
          password: "test1234567890",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(mocks.bootstrapFirstAdmin).not.toHaveBeenCalled();
  });
});
