// [Input] Public billing report requests, authorized sessions and controlled PostgreSQL report rows.
// [Output] UTC date/grouping and permission/range regression evidence without real billing writes.
// [Pos] Provider-free read-only report tests; production accounting and ledger are unchanged.
// [Sync] 2026-10-10: align existing daily billing reports with UTC usage dashboard/list queries.

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), requireAdminRequest: vi.fn() }));
vi.mock("../platform-db", () => ({ withPlatformClient: async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query }) }));
vi.mock("./guard", () => ({ adminRequestId: () => "billing_report_test", requireAdminRequest: mocks.requireAdminRequest }));

import { AdminError } from "./errors";
import { handleAdminBillingReport } from "./billing-report";

describe("existing billing report UTC range", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReset();
    mocks.requireAdminRequest.mockResolvedValue({ id: "admin_test" });
    mocks.query.mockResolvedValue({ rows: [{ day: "2026-10-01", requests: "1", provider_cost_microusd: "37" }] });
  });

  it("uses explicit UTC filtering and day grouping independent of the session timezone", async () => {
    const response = await handleAdminBillingReport(new Request("https://admin.test/api/admin/billing-report?from=2026-10-01&to=2026-10-01"));
    expect(response.status).toBe(200);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(expect.any(Request), "billing.read");
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [statement, values] = mocks.query.mock.calls[0];
    expect(values).toEqual(["2026-10-01", "2026-10-01"]);
    expect(statement).toContain("created_at >= ($1::date::timestamp AT TIME ZONE 'UTC')");
    expect(statement).toContain("created_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')");
    expect(statement).toContain("GROUP BY (created_at AT TIME ZONE 'UTC')::date");
    expect(statement).toContain("ORDER BY (created_at AT TIME ZONE 'UTC')::date DESC");
    expect(await response.json()).toMatchObject({ data: [{ day: "2026-10-01", requests: "1", provider_cost_microusd: "37" }], meta: { timezone: "UTC", days: 1, amounts: "micro-USD", totals: "known_usage_subtotal" } });
  });

  it.each(["from=invalid", "from=2026-10-02&to=2026-10-01", "from=2020-01-01&to=2026-10-01"])("rejects invalid or unsupported dates: %s", async (query) => {
    const response = await handleAdminBillingReport(new Request(`https://admin.test/api/admin/billing-report?${query}`));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("BILLING_REPORT_RANGE_INVALID");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires billing.read before querying", async () => {
    mocks.requireAdminRequest.mockRejectedValue(new AdminError("ADMIN_PERMISSION_DENIED", "Forbidden", 403));
    const response = await handleAdminBillingReport(new Request("https://admin.test/api/admin/billing-report"));
    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
