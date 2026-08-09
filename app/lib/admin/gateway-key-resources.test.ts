import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  requireAdminRequest: vi.fn(),
}));

vi.mock("../platform-db", () => ({
  withPlatformClient: async (
    callback: (client: { query: typeof mocks.query }) => unknown,
  ) => await callback({ query: mocks.query }),
}));

vi.mock("./guard", () => ({
  adminRequestId: () => "admin_gateway_keys_test",
  requireAdminRequest: mocks.requireAdminRequest,
}));

import { handleAdminResourceList } from "./resources";

describe("Gateway key Admin resource projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ id: "admin_test" });
  });

  it("lists fixed and service keys without joining away service keys or exposing secrets", async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "gkey_service",
            platform_user_id: null,
            email: null,
            subject_mode: "canonical_subject",
            service_client_id: "dream-bff",
            name: "Dream Gateway",
            key_prefix: "gw_prefix",
            scopes: ["messages:create"],
            status: "active",
            expires_at: null,
            last_used_at: null,
            revoked_at: null,
            created_at: "2026-08-09T00:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });

    const response = await handleAdminResourceList(
      new Request("https://admin.test/api/admin/gateway-api-keys?page=1&pageSize=50"),
      "gateway-api-keys",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toMatchObject({
      subject_mode: "canonical_subject",
      service_client_id: "dream-bff",
      platform_user_id: null,
    });
    const listStatement = String(mocks.query.mock.calls[0]?.[0]);
    expect(listStatement).toContain("LEFT JOIN platform_users");
    expect(listStatement).toContain("LEFT JOIN users AS canonical_user");
    expect(listStatement).toContain("k.subject_mode");
    expect(listStatement).toContain("k.service_client_id");
    expect(listStatement).not.toContain("key_hash");
    expect(JSON.stringify(body)).not.toContain("plaintextKey");
    expect(JSON.stringify(body)).not.toContain("key_hash");
  });
});
