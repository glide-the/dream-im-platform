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
  adminRequestId: () => "admin_token_ledger_test",
  requireAdminRequest: mocks.requireAdminRequest,
}));

import { handleAdminResourceList } from "./resources";

describe("Admin Token ledger resource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ id: "admin_test" });
  });

  it("is a controlled, Token-unit-only read projection", async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "tokenledger_1",
            platform_user_id: "usr_1",
            email: "user@example.test",
            subscription_id: "sub_1",
            plan_version_id: "planv_1",
            subscription_allowance_id: "allow_1",
            gateway_request_id: "req_1",
            request_sequence: 2,
            entry_type: "capture",
            unit: "tokens",
            amount_tokens: "12",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });

    const response = await handleAdminResourceList(
      new Request(
        "https://admin.test/api/admin/token-ledger?page=1&pageSize=20&filter[gateway_request_id][eq]=req_1",
      ),
      "token-ledger",
    );

    expect(response.status).toBe(200);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "subscriptions.read",
    );
    const statement = String(mocks.query.mock.calls[0]?.[0]);
    expect(statement).toContain("subscription_token_ledger_entries");
    expect(statement).toContain("amount_tokens");
    expect(statement).not.toMatch(/microusd|payment|secret/i);
    expect(await response.json()).toMatchObject({
      data: [{ request_sequence: 2, entry_type: "capture", unit: "tokens", amount_tokens: "12" }],
      meta: { total: 1 },
    });
  });
});
