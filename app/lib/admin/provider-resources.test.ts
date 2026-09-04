// [Input] Provider list/detail rows containing compatible historical secret-like config keys.
// [Output] Safe Provider reads that hide tombstones and include direct dependency counts.
// [Pos] Regression coverage for Provider Admin read-boundary sanitization.
// [Sync] 2026-09-04: cover secret sanitization and direct Provider-owned account resolution.
// [Sync] 2026-09-04: cover deleted Provider exclusion and Pricing dependency projection.

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
  adminRequestId: () => "admin_provider_resource_test",
  requireAdminRequest: mocks.requireAdminRequest,
}));

import {
  handleAdminResourceGetOne,
  handleAdminResourceList,
} from "./resources";

const historicalSecret = "historical-secret-never-return";
const provider = {
  id: "provider_1",
  code: "provider-one",
  name: "Provider One",
  protocol: "anthropic",
  status: "disabled",
  config: {
    authMode: "x-api-key",
    nested: { access_token: historicalSecret, safe: "visible" },
  },
  auth_revision: 1,
  credential_validation_status: "unverified",
  credential_validated_at: null,
};

describe("Provider resource config sanitization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockReset();
    mocks.requireAdminRequest.mockResolvedValue({ id: "admin_1" });
  });

  it("sanitizes Provider list rows", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [provider] })
      .mockResolvedValueOnce({ rows: [{ total: "1" }] });

    const response = await handleAdminResourceList(
      new Request("https://admin.test/api/admin/providers?page=1&pageSize=20"),
      "providers",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].config).toEqual({
      authMode: "x-api-key",
      nested: { safe: "visible" },
    });
    expect(JSON.stringify(body)).not.toContain(historicalSecret);
    const listSql = String(mocks.query.mock.calls[0]?.[0]);
    expect(listSql).not.toContain("ai_provider_managed_account_defaults");
    expect(listSql).toContain("managed.id = p.managed_credential_id");
    expect(listSql).toContain("managed.provider_id = p.id");
    expect(listSql).toContain("pricing_rule_count");
    expect(listSql).toContain("delete_revision");
    expect(listSql).toContain("p.status <> 'deleted'");
  });

  it("sanitizes a Provider detail row", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [provider] });

    const response = await handleAdminResourceGetOne(
      new Request("https://admin.test/api/admin/providers/provider_1"),
      "providers",
      "provider_1",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.config.nested).toEqual({ safe: "visible" });
    expect(JSON.stringify(body)).not.toContain(historicalSecret);
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain("p.status <> 'deleted'");
  });

  it("computes model Provider readiness from the Provider-owned account", async () => {
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          version: 1,
          contract_sha256: "7b4d46bad9cfb340336a05aa9c9a2b70f5518622e5e2e94d47aac2ca76d63c1d",
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ total: "0" }] });

    const response = await handleAdminResourceList(
      new Request("https://admin.test/api/admin/models?page=1&pageSize=20"),
      "models",
    );

    expect(response.status).toBe(200);
    const listSql = String(mocks.query.mock.calls[1]?.[0]);
    expect(listSql).toContain("managed.id = p.managed_credential_id");
    expect(listSql).not.toContain("ai_provider_managed_account_defaults");
    expect(listSql).toContain("managed.provider_id = p.id");
  });

  it("sanitizes historical Provider snapshots returned through audit resources", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        id: "audit_1",
        resource_type: "providers",
        before: provider,
        after: { ...provider, name: "Renamed" },
      }],
    });

    const response = await handleAdminResourceGetOne(
      new Request("https://admin.test/api/admin/audit-logs/audit_1"),
      "audit-logs",
      "audit_1",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.before.config.nested).toEqual({ safe: "visible" });
    expect(body.data.after.config.nested).toEqual({ safe: "visible" });
    expect(JSON.stringify(body)).not.toContain(historicalSecret);
  });
});
