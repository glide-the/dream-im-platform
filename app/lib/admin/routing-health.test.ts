// [Input] Public health GET, injected Session/client boundaries and strict query variants.
// [Output] Provider-free authorization, validation, safe-success and missing-policy evidence.
// [Pos] Route contract regression; actual PostgreSQL aggregation is proved by focused E2E.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminError } from "./errors";
import { GET } from "../../api/admin/routing-policies/[id]/health/route";
import { routingHealthQuerySchema } from "../models/routing-health-contract";

const mocks = vi.hoisted(() => ({ query: vi.fn(), authorize: vi.fn(), connected: vi.fn() }));
vi.mock("./guard", () => ({ adminRequestId: () => "health-fixture", requireAdminRequest: mocks.authorize }));
vi.mock("../platform-db", () => ({
  withPlatformClient: async (handler: (client: { query: typeof mocks.query }) => Promise<unknown>) => {
    mocks.connected(); return handler({ query: mocks.query });
  },
  PlatformSchemaNotReadyError: class extends Error {},
}));
const request = (query = "", id = "model_fixture") => GET(new Request(`http://fixture.invalid/api/admin/routing-policies/${id}/health${query}`), { params: Promise.resolve({ id }) });

describe("routing health public GET", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.query.mockReset(); mocks.authorize.mockReset(); mocks.authorize.mockResolvedValue({ id: "admin_fixture" }); });
  it.each([401, 403])("rejects unauthorized HTTP %s before querying observations", async status => {
    if (status === 403) mocks.authorize.mockResolvedValueOnce({ id: "model_reader" });
    mocks.authorize.mockRejectedValueOnce(new AdminError("ADMIN_PERMISSION_DENIED", "Denied", status));
    expect((await request()).status).toBe(status);
    expect(mocks.connected).not.toHaveBeenCalled();
  });
  it.each(["?window=forever", "?window=3d&window=24h", "?providerPage=0", "?providerPage=1.5", "?providerPage=9007199254740991", "?secret=unexpected"])("strictly rejects %s", async query => {
    expect((await request(query)).status).toBe(400);
    expect(mocks.connected).not.toHaveBeenCalled();
  });
  it("validates model identity and requires both independent read permissions", async () => {
    expect((await request("", "model:invalid")).status).toBe(400);
    expect(mocks.authorize.mock.calls.map(call => call[1])).toEqual(["models.read", "gateway.read"]);
    expect(mocks.connected).not.toHaveBeenCalled();
  });
  it("returns 404 for an absent saved policy", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    expect((await request()).status).toBe(404);
  });
  it("returns bounded safe observations with database-clock range and no secret fields", async () => {
    const time = new Date("2026-10-07T12:00:00Z");
    mocks.query.mockResolvedValueOnce({ rows: [{ id: "model_fixture", code: "public_alias", display_name: "Alias", provider_id: "provider_fixture", upstream_model: "supply", status: "draft", revision: 4, effective: null, observed_at: time }] });
    const performance = { samples: 0, p50Ms: null, p95Ms: null };
    const summary = { requests: 0, succeeded: 0, failed: 0, pending: 0, cancelled: 0, recovered: 0, successRate: null, latency: performance, firstToken: performance, lastObservedAt: null };
    mocks.query.mockResolvedValueOnce({ rows: [{ summary, timeline: [], providers: [], current_targets: [{ providerId: "provider_fixture", upstreamModel: "supply", providerName: "Supply", providerStatus: "disabled" }], provider_total: 1 }] });
    const response = await request("?window=24h&providerPage=2");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.data).toMatchObject({ policy: { status: "draft", effective: null, revision: 4 }, summary,
      meta: { from: "2026-10-06T12:00:00.000Z", to: time.toISOString(), window: "24h", providerPage: 2 } });
    expect(JSON.stringify(body)).not.toMatch(/ciphertext|credential|api_key|platform_user|response_summary/);
    expect(mocks.query.mock.calls[1][1].slice(0, 3)).toEqual(["model_fixture", "2026-10-06T12:00:00.000Z", time.toISOString()]);
  });
  it("defaults to the reviewed three-day window and first page", () => {
    expect(routingHealthQuerySchema.parse({})).toEqual({ window: "3d", providerPage: 1 });
  });
});
