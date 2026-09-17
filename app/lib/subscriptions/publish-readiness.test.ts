// [Input] Public publish requests, mocked PostgreSQL dependencies and Admin identity.
// [Output] Publication requires every enabled entitlement's model and Provider to be enabled.
// [Pos] Subscription publication service regression; no Provider or persistent business calls.
// [Sync] 2026-09-15: cover model/Provider failures, combined errors and published retries.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), item: vi.fn(), audit: vi.fn() }));
vi.mock("../admin/guard", () => ({
  adminRequestId: () => "request-publish",
  assertAdminMutationOrigin: vi.fn(),
  requireAdminRequest: vi.fn().mockResolvedValue({ id: "admin-publish" }),
}));
vi.mock("../admin/audit", () => ({ recordAdminAuditOnClient: mocks.audit }));
vi.mock("../platform-db", () => ({
  withPlatformTransaction: async (operation: (client: { query: typeof mocks.query }) => unknown) =>
    await operation({ query: mocks.query }),
  withPlatformClient: vi.fn(),
}));
vi.mock("./repository", () => ({ querySubscriptionItem: mocks.item, querySubscriptionList: vi.fn() }));

import { handleSubscriptionAction } from "./service";

const draft = {
  allowance_tokens: "10000", billing_period: "monthly", base_price_microusd: "0",
  allowance_microusd: "0", overage_policy: "deny", effective_from: null,
};
const ready = { model_code: "model-ready", model_enabled: true, provider_code: "provider-ready", provider_status: "active" };
function publish() {
  return handleSubscriptionAction(new Request("https://admin.example.test/api/admin/subscription-plan-versions/planv-draft/publish", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: "publish-readiness", reason: "Publish ready models" }),
  }), "subscription-plan-versions", "planv-draft", "publish");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.query.mockResolvedValueOnce({ rows: [draft] });
  mocks.item.mockResolvedValueOnce({ status: "draft", plan_id: "plan-draft" })
    .mockResolvedValue({ status: "published", plan_id: "plan-draft" });
});

describe("plan version publication readiness", () => {
  it("publishes and audits only after checking the locked model and Provider states", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [ready] });
    const response = await publish();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: "published" } });
    expect(mocks.query.mock.calls[0][0]).toContain("FOR UPDATE");
    expect(mocks.query.mock.calls[1][0]).toContain("entitlement.enabled = TRUE");
    expect(mocks.query.mock.calls[1][0]).toContain("FOR SHARE OF model, provider");
    expect(mocks.query.mock.calls[2][0]).toContain("status = 'published'");
    expect(mocks.audit).toHaveBeenCalledOnce();
  });

  it.each([
    [{ ...ready, model_enabled: false }, ["model-ready"], []],
    [{ ...ready, provider_status: "disabled" }, [], ["provider-ready"]],
    [{ ...ready, model_enabled: false, provider_status: "disabled" }, ["model-ready"], ["provider-ready"]],
  ])("rejects unavailable dependencies %j without a publication write", async (row, disabledModels, disabledProviders) => {
    mocks.query.mockResolvedValueOnce({ rows: [row] });
    const response = await publish();
    expect(response.status).toBe(409);
    const error = (await response.json()).error;
    expect(error).toMatchObject({
      code: "SUBSCRIPTION_PUBLISH_DEPENDENCY_DISABLED", details: { disabledModels, disabledProviders },
    });
    if (disabledModels.length) expect(error.message).toContain("模型未启用：model-ready");
    if (disabledProviders.length) expect(error.message).toContain("提供商未启用：provider-ready");
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("reports a shared disabled Provider once while checking every model", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [
      { ...ready, provider_status: "disabled" },
      { ...ready, model_code: "second-model", model_enabled: false, provider_status: "disabled" },
    ] });
    const response = await publish();
    expect((await response.json()).error.details).toEqual({
      disabledModels: ["second-model"], disabledProviders: ["provider-ready"],
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("still rejects a version with no enabled entitlements", async () => {
    const response = await publish();
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("SUBSCRIPTION_ENTITLEMENT_REQUIRED");
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("returns an already-published version without rechecking later model shutdowns", async () => {
    mocks.item.mockReset().mockResolvedValue({ status: "published" });
    const response = await publish();
    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
