import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lockById: vi.fn(),
  updateRole: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  requireAdminRequest: vi.fn(),
  assertAdminMutationOrigin: vi.fn(),
}));

vi.mock("../platform-db", () => ({
  withPlatformTransaction: mocks.transaction,
}));

vi.mock("./audit", () => ({
  recordAdminAuditOnClient: mocks.audit,
}));

vi.mock("./guard", () => ({
  adminRequestId: () => "admin_dream_role_test",
  assertAdminMutationOrigin: mocks.assertAdminMutationOrigin,
  requireAdminRequest: mocks.requireAdminRequest,
}));

vi.mock("./dream-user-role-repository", () => ({
  DrizzleDreamUserRoleRepository: class {
    lockById = mocks.lockById;
    updateRole = mocks.updateRole;
  },
}));

import { AdminError } from "./errors";
import { handleDreamUserRoleAction } from "./dream-user-role-handler";

function request(body: unknown) {
  return new Request("https://admin.test/api/admin/users/205/set-product-role", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://admin.test",
    },
    body: JSON.stringify(body),
  });
}

describe("handleDreamUserRoleAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ id: "admin_operator" });
    mocks.transaction.mockImplementation(async (handler) => handler({ query: vi.fn() }));
    mocks.lockById.mockResolvedValue({
      id: "205",
      email: "dream-user@example.com",
      display_name: "Dream User",
      role: "user",
      updated_at: "2026-09-17T00:00:00.000Z",
    });
    mocks.updateRole.mockResolvedValue({
      id: "205",
      email: "dream-user@example.com",
      display_name: "Dream User",
      role: "admin",
      updated_at: "2026-09-17T00:01:00.000Z",
    });
  });

  it("requires independent Admin RBAC and audits the Dream-only role change in the transaction", async () => {
    const response = await handleDreamUserRoleAction(
      request({
        expectedRole: "user",
        role: "admin",
        reason: "Enable product workflow administration",
      }),
      "205",
    );

    expect(response.status).toBe(200);
    expect(mocks.assertAdminMutationOrigin).toHaveBeenCalledOnce();
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "users.write",
    );
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.any(Function) }),
      expect.objectContaining({
        identity: { id: "admin_operator" },
        action: "dream-user.product-role.set",
        resourceType: "dream-user",
        resourceId: "205",
        before: { role: "user" },
        after: { role: "admin" },
        metadata: expect.objectContaining({
          expectedRole: "user",
          adminMembershipChanged: false,
          authSubjectChanged: false,
        }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { user: { id: "205", role: "admin" }, idempotent: false },
    });
  });

  it.each([
    { expectedRole: "user", role: "admin", reason: "valid", email: "target@example.com" },
    { expectedRole: "user", role: "admin", reason: "valid", authUserId: "auth_target" },
    { expectedRole: "user", role: "admin", reason: "valid", permissions: ["plugin:admin"] },
    { expectedRole: "user", role: "admin", reason: "valid", table: "users" },
  ])("rejects caller-selected identity, permission, and persistence fields", async (body) => {
    const response = await handleDreamUserRoleAction(request(body), "205");
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("stops before authentication when the mutation Origin is rejected", async () => {
    mocks.assertAdminMutationOrigin.mockImplementationOnce(() => {
      throw new AdminError("ADMIN_ORIGIN_DENIED", "denied", 403);
    });
    const response = await handleDreamUserRoleAction(
      request({ expectedRole: "user", role: "admin", reason: "valid reason" }),
      "205",
    );
    expect(response.status).toBe(403);
    expect(mocks.requireAdminRequest).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
