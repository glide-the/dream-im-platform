// [Input] Public entitlement create requests with mocked Admin identity and PostgreSQL I/O.
// [Output] Enabled-model success and fail-closed disabled/missing/stale model evidence.
// [Pos] Subscription service regression; validates the production request handler.
// [Sync] 2026-09-15: restrict new plan entitlements to enabled models.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), audit: vi.fn(), item: vi.fn() }));
vi.mock("../admin/guard", () => ({
  adminRequestId: () => "request-entitlement",
  assertAdminMutationOrigin: vi.fn(),
  requireAdminRequest: vi.fn().mockResolvedValue({ id: "admin-entitlement" }),
}));
vi.mock("../admin/audit", () => ({ recordAdminAuditOnClient: mocks.audit }));
vi.mock("../platform-db", () => ({
  withPlatformTransaction: async (operation: (client: { query: typeof mocks.query }) => unknown) =>
    await operation({ query: mocks.query }),
  withPlatformClient: vi.fn(),
}));
vi.mock("./repository", () => ({
  querySubscriptionItem: mocks.item,
  querySubscriptionList: vi.fn(),
}));

import { handleSubscriptionCreate } from "./service";

const input = {
  planVersionId: "planv-draft",
  modelId: "model-selected",
  gatewayScopes: ["messages:create", "models:list"],
  enabled: true,
};

function request(body = input) {
  return new Request("https://admin.example.test/api/admin/subscription-entitlements", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.item.mockResolvedValue({ id: "ent-created", model_id: input.modelId });
});

describe("entitlement creation model eligibility", () => {
  it("creates and audits an entitlement for an enabled model in a draft version", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ status: "draft" }] })
      .mockResolvedValueOnce({ rows: [{ enabled: true }] });
    const response = await handleSubscriptionCreate(request(), "subscription-entitlements");
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { model_id: input.modelId } });
    expect(mocks.query).toHaveBeenNthCalledWith(2,
      "SELECT enabled FROM ai_models WHERE id = $1 FOR SHARE", [input.modelId]);
    expect(mocks.query.mock.calls[2][0]).toContain("INSERT INTO subscription_plan_entitlements");
    expect(mocks.audit).toHaveBeenCalledOnce();
  });

  it.each([
    ["disabled, including a model stopped after selection", [{ enabled: false }]],
    ["missing", []],
  ])("rejects a %s model before inserting an entitlement", async (_state, rows) => {
    mocks.query.mockResolvedValueOnce({ rows: [{ status: "draft" }] })
      .mockResolvedValueOnce({ rows });
    const response = await handleSubscriptionCreate(request(), "subscription-entitlements");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "SUBSCRIPTION_ENTITLEMENT_MODEL_DISABLED" },
    });
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.item).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("preserves published-version immutability before checking the selected model", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ status: "published" }] });
    const response = await handleSubscriptionCreate(request(), "subscription-entitlements");
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "SUBSCRIPTION_ENTITLEMENT_IMMUTABLE" },
    });
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
