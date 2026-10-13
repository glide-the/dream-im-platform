// [Input] Existing Gateway log and billing usage list requests with bounded operation/date filters.
// [Output] Public read-boundary proof for safe SQL, permission separation and invalid-input rejection.
// [Pos] Provider-free Admin resource regression; no separate Image resources or records.
// [Sync] 2026-10-10: place Image request inspection in logs and billing.

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), requireAdminRequest: vi.fn() }));
vi.mock("../platform-db", () => ({ withPlatformClient: async (callback: (client: { query: typeof mocks.query }) => unknown) => callback({ query: mocks.query }) }));
vi.mock("./guard", () => ({ adminRequestId: () => "request_resource_test", requireAdminRequest: mocks.requireAdminRequest }));

import { AdminError } from "./errors";
import { handleAdminResourceList } from "./resources";

describe("shared request resource operation and date filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReset();
    mocks.requireAdminRequest.mockResolvedValue({ id: "admin_test" });
    mocks.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ total: "0" }] });
  });

  it.each([["gateway-requests", "gateway.read"], ["usage", "billing.read"]])("filters %s through its existing permission", async (resource, permission) => {
    const params = new URLSearchParams({ "filter[operation][eq]": "images.edits", "filter[created_at][gte]": "2026-10-01T00:00:00.000Z", "filter[created_at][lte]": "2026-10-10T23:59:59.999999Z" });
    const response = await handleAdminResourceList(new Request(`https://admin.test/api/admin/${resource}?${params}`), resource);
    expect(response.status).toBe(200);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(expect.any(Request), permission);
    for (const [statement, values] of mocks.query.mock.calls) {
      expect(statement).toContain("r.operation = $1 AND r.created_at >= $2 AND r.created_at <= $3");
      expect(values.slice(0, 3)).toEqual(["images.edits", "2026-10-01T00:00:00.000Z", "2026-10-10T23:59:59.999999Z"]);
    }
  });

  it.each(["gateway-requests", "usage"])("rejects an invalid date for %s", async (resource) => {
    const response = await handleAdminResourceList(new Request(`https://admin.test/api/admin/${resource}?filter[created_at][gte]=not-a-date`), resource);
    expect(response.status).toBe(400);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each(["gateway-requests", "usage"])("enforces permission for %s", async (resource) => {
    mocks.requireAdminRequest.mockRejectedValue(new AdminError("ADMIN_PERMISSION_DENIED", "Forbidden", 403));
    const response = await handleAdminResourceList(new Request(`https://admin.test/api/admin/${resource}?filter[operation][eq]=images.generations`), resource);
    expect(response.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
