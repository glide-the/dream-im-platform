// [Input] Public usage dashboard requests and controlled authenticated PostgreSQL query results.
// [Output] Regression proof for operation/date filtering, authorization and invalid-filter rejection.
// [Pos] Provider-free billing read tests; no business records or credentials are accessed.
// [Sync] 2026-10-10: keep Image usage in the existing billing dashboard.
// [Sync] 2026-10-10: require timezone-independent UTC date boundaries and trend buckets.

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), requireAdminRequest: vi.fn() }));
vi.mock("../platform-db", () => ({ withPlatformClient: async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query }) }));
vi.mock("./guard", () => ({ adminRequestId: () => "usage_dashboard_test", requireAdminRequest: mocks.requireAdminRequest }));

import { AdminError } from "./errors";
import { handleAdminUsageDashboard } from "./usage-dashboard";

describe("shared usage dashboard operation filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReset();
    mocks.requireAdminRequest.mockResolvedValue({ id: "admin_test" });
    mocks.query.mockResolvedValue({ rows: [] });
  });

  it.each(["text", "images.generations", "images.edits"])("filters all aggregates by %s with parameterized SQL", async (operation) => {
    const response = await handleAdminUsageDashboard(new Request(`https://admin.test/api/admin/usage-dashboard?from=2026-10-01&to=2026-10-10&operation=${operation}&providerId=provider_test`));
    expect(response.status).toBe(200);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(expect.any(Request), "billing.read");
    expect(mocks.query).toHaveBeenCalledTimes(4);
    for (const [statement, values] of mocks.query.mock.calls) {
      expect(statement).toContain("r.operation = $3");
      expect(statement).toContain("r.provider_id = $4");
      expect(statement).toContain("r.created_at >= ($1::date::timestamp AT TIME ZONE 'UTC')");
      expect(statement).toContain("r.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')");
      expect(values.slice(0, 4)).toEqual(["2026-10-01", "2026-10-10", operation, "provider_test"]);
    }
    expect((await response.json()).data.meta.operation).toBe(operation);
  });

  it("uses explicit UTC trend buckets rather than the PostgreSQL session timezone", async () => {
    const response = await handleAdminUsageDashboard(new Request("https://admin.test/api/admin/usage-dashboard?from=2026-10-01&to=2026-10-01"));
    expect(response.status).toBe(200);
    const trend = mocks.query.mock.calls.find(([statement]) => statement.includes("date_trunc"));
    expect(trend).toEqual([expect.stringContaining("date_trunc($3, r.created_at, 'UTC') AS bucket"), ["2026-10-01", "2026-10-01", "hour"]]);
    expect((await response.json()).data.meta).toMatchObject({ bucket: "hour", timezone: "UTC" });
  });

  it("keeps the unfiltered text/Image dashboard contract", async () => {
    const response = await handleAdminUsageDashboard(new Request("https://admin.test/api/admin/usage-dashboard"));
    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledTimes(4);
    for (const [statement] of mocks.query.mock.calls) expect(statement).not.toContain("r.operation =");
  });

  it("rejects an unsupported operation without querying accounting facts", async () => {
    const response = await handleAdminUsageDashboard(new Request("https://admin.test/api/admin/usage-dashboard?operation=images.unknown"));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("USAGE_DASHBOARD_QUERY_INVALID");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("requires billing.read before parsing or querying", async () => {
    mocks.requireAdminRequest.mockRejectedValue(new AdminError("ADMIN_PERMISSION_DENIED", "Forbidden", 403));
    const response = await handleAdminUsageDashboard(new Request("https://admin.test/api/admin/usage-dashboard?operation=images.edits"));
    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});

// [Sync] 2026-10-11: all four aggregates use the server-owned inclusive Responses subtotal.
it("projects processed tokens consistently for summary, trend, Provider and Model", async () => {
  mocks.requireAdminRequest.mockResolvedValue({ id: "admin_test" });
  mocks.query.mockReset(); mocks.query.mockResolvedValue({ rows: [{ tokens: "120", input_tokens: "100", output_tokens: "20", cache_read_tokens: "40", cache_write_tokens: "0" }] });
  const response = await handleAdminUsageDashboard(new Request("https://admin.test/api/admin/usage-dashboard?from=2026-10-11&to=2026-10-11"));
  expect(response.status).toBe(200);
  for (const [statement] of mocks.query.mock.calls) {
    expect(statement).toContain("CASE WHEN r.response_summary ->> 'billingScope' = 'responses_reported_tokens'");
    expect(statement).toContain("THEN COALESCE(r.input_tokens, 0) + COALESCE(r.output_tokens, 0)");
    expect(statement).toContain("ELSE COALESCE(r.input_tokens, 0) + COALESCE(r.output_tokens, 0) + COALESCE(r.cache_read_tokens, 0) + COALESCE(r.cache_write_tokens, 0) END");
    expect(statement).toContain("::text AS tokens");
  }
  const data = (await response.json()).data;
  expect([data.summary, data.trend[0], data.providerStats[0], data.modelStats[0]].map(row => row.tokens)).toEqual(["120", "120", "120", "120"]);
});
