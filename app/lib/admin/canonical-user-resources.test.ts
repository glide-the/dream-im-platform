import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  requireAdminRequest: vi.fn(),
  assertAdminMutationOrigin: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("../platform-db", () => ({
  withPlatformClient: async (
    callback: (client: { query: typeof mocks.query }) => unknown,
  ) => await callback({ query: mocks.query }),
  withPlatformTransaction: mocks.transaction,
}));

vi.mock("./guard", () => ({
  adminRequestId: () => "admin_canonical_users_test",
  requireAdminRequest: mocks.requireAdminRequest,
  assertAdminMutationOrigin: mocks.assertAdminMutationOrigin,
}));

vi.mock("./audit", () => ({
  recordAdminAuditOnClient: mocks.audit,
}));

import { handleAdminResourceUpdate } from "./mutations";
import { handleAdminResourceList } from "./resources";

describe("canonical user Admin resource projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue({ id: "admin_test" });
  });

  it("lists every canonical user even when platform and billing projections are missing", async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "usr_fallback",
            source: "ink-dream",
            external_user_id: "205",
            email: "canonical@example.com",
            display_name: "Canonical User",
            tier: null,
            status: null,
            daily_token_limit: null,
            monthly_token_limit: null,
            billing_account_id: null,
            projection_ready: false,
            billing_account_ready: false,
            created_at: "2026-08-09T00:00:00.000Z",
            updated_at: "2026-08-09T00:00:00.000Z",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ total: "205" }] });

    const response = await handleAdminResourceList(
      new Request(
        "https://admin.test/api/admin/platform-users?page=1&pageSize=50",
      ),
      "platform-users",
    );

    expect(response.status).toBe(200);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "users.read",
    );

    const body = await response.json();
    expect(body.meta).toEqual({
      page: 1,
      pageSize: 50,
      total: 205,
      totalPages: 5,
    });
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "usr_fallback",
      external_user_id: "205",
      email: "canonical@example.com",
      tier: null,
      billing_account_id: null,
      projection_ready: false,
      billing_account_ready: false,
    });

    const listStatement = String(mocks.query.mock.calls[0]?.[0]);
    expect(listStatement).toContain(
      "COALESCE(u.id, 'usr_' || md5('ink-dream:' || su.id::text)) AS id",
    );
    expect(listStatement).toContain("(u.id IS NOT NULL) AS projection_ready");
    expect(listStatement).toContain(
      "(a.id IS NOT NULL) AS billing_account_ready",
    );
    expect(listStatement).toMatch(
      /FROM users AS su\s+LEFT JOIN platform_users AS u/,
    );
    expect(listStatement).toMatch(
      /LEFT JOIN billing_accounts AS a ON a\.platform_user_id = u\.id/,
    );

    const countStatement = String(mocks.query.mock.calls[1]?.[0]);
    expect(countStatement).toMatch(
      /SELECT COUNT\(\*\)::text AS total\s+FROM users AS su/,
    );
    expect(countStatement).toMatch(
      /LEFT JOIN platform_users AS u[\s\S]+LEFT JOIN billing_accounts AS a/,
    );
  });

  it.each([
    ["email", { tier: "default", email: "changed@example.com" }],
    ["displayName", { tier: "default", displayName: "Changed Name" }],
  ])("rejects canonical-owned %s updates", async (field, input) => {
    const response = await handleAdminResourceUpdate(
      new Request("https://admin.test/api/admin/platform-users/usr_projection", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
      "platform-users",
      "usr_projection",
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("ADMIN_INPUT_INVALID");
    expect(JSON.stringify(body.error.details)).toContain(field);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(
      expect.any(Request),
      "users.write",
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
