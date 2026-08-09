import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), query: vi.fn() }));

vi.mock("./auth", () => ({ authenticateGatewayRequest: mocks.authenticate }));
vi.mock("../platform-db", () => ({
  withPlatformClient: async (operation: (client: { query: typeof mocks.query }) => unknown) =>
    await operation({ query: mocks.query }),
}));

import {
  evaluateModelAvailability,
  handleGatewayModels,
  type ModelCatalogRow,
} from "./models";

const now = new Date("2030-01-15T00:00:00.000Z");
const baseRow: ModelCatalogRow = {
  code: "dream-balanced",
  display_name: "Dream Balanced",
  protocol: "anthropic",
  context_window: 200000,
  max_output_tokens: 8192,
  capabilities: { tools: true },
  provider_ready: true,
  pricing_ready: true,
  subscription_id: "sub_1",
  subscription_status: "active",
  current_period_start: new Date("2030-01-01T00:00:00.000Z"),
  current_period_end: new Date("2030-02-01T00:00:00.000Z"),
  trial_ends_at: null,
  grace_ends_at: null,
  version_ready: true,
  entitlement_id: "ent_1",
  entitlement_is_default: true,
  permission_enabled: null,
  allowance_id: "allow_1",
  remaining_tokens: "1000",
  required_plan_code: "free",
};

describe("public Gateway model catalog", () => {
  beforeEach(() => {
    mocks.authenticate.mockReset();
    mocks.query.mockReset();
    mocks.authenticate.mockResolvedValue({
      platformUserId: "platform-user-1",
      tier: "member",
    });
  });

  it("returns every enabled model with safe callability metadata", async () => {
    mocks.query.mockResolvedValue({
      rows: [
        baseRow,
        {
          ...baseRow,
          code: "dream-premium",
          display_name: "Dream Premium",
          entitlement_id: null,
          required_plan_code: "dream",
        },
      ],
    });

    vi.setSystemTime(now);
    const response = await handleGatewayModels(
      new Request("https://gateway.example.test/v1/models"),
    );
    vi.useRealTimers();
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual([
      expect.objectContaining({
        id: "dream-balanced",
        callable: true,
        availability: "included",
        required_plan_code: "free",
      }),
      expect.objectContaining({
        id: "dream-premium",
        callable: false,
        availability: "upgrade_required",
        required_plan_code: "dream",
      }),
    ]);
    expect(JSON.stringify(payload)).not.toMatch(
      /ciphertext|api_key|secret|upstream_model|provider_id|key_prefix/i,
    );
    expect(payload.data[0]).not.toHaveProperty("gateway_scopes");
    expect(payload.default_model_alias).toBe("dream-balanced");
    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).toContain("FROM ai_models AS model");
    expect(sql).toContain("WHERE model.enabled = TRUE");
    expect(sql).toContain("LEFT JOIN LATERAL");
  });

  it.each([
    [{ subscription_id: null }, "subscription_inactive"],
    [{ provider_ready: false }, "maintenance"],
    [{ pricing_ready: false }, "maintenance"],
    [{ entitlement_id: null, required_plan_code: "dream" }, "upgrade_required"],
    [{ entitlement_id: null, required_plan_code: null }, "maintenance"],
    [{ permission_enabled: false }, "permission_denied"],
    [{ allowance_id: null }, "subscription_inactive"],
    [{ remaining_tokens: "0" }, "allowance_exhausted"],
  ])("evaluates %j as %s", (patch, availability) => {
    expect(evaluateModelAvailability({ ...baseRow, ...patch }, now)).toEqual({
      callable: false,
      availability,
    });
  });
});
