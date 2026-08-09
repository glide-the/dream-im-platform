import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  query: vi.fn(),
}));

vi.mock("./auth", () => ({
  authenticateGatewayRequest: mocks.authenticate,
}));

vi.mock("../platform-db", () => ({
  withPlatformClient: async (operation: (client: { query: typeof mocks.query }) => unknown) =>
    await operation({ query: mocks.query }),
}));

import { handleGatewayModels } from "./models";

describe("public Gateway model catalog", () => {
  beforeEach(() => {
    mocks.authenticate.mockReset();
    mocks.query.mockReset();
    mocks.authenticate.mockResolvedValue({
      platformUserId: "platform-user-1",
      tier: "member",
    });
  });

  it("returns only subscription-entitled callable models without provider secrets", async () => {
    mocks.query.mockResolvedValue({
      rows: [
        {
          code: "dream-balanced",
          display_name: "Dream Balanced",
          protocol: "anthropic",
          context_window: 200000,
          max_output_tokens: 8192,
          capabilities: { tools: true },
          gateway_scopes: ["messages:create", "models:list"],
          created_at: new Date("2026-08-09T00:00:00.000Z"),
        },
      ],
    });

    const response = await handleGatewayModels(
      new Request("https://gateway.example.test/v1/models"),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual([
      expect.objectContaining({
        id: "dream-balanced",
        display_name: "Dream Balanced",
        owned_by: "ink-memory",
        gateway_scopes: ["messages:create", "models:list"],
      }),
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/ciphertext|api_key|secret/i);
    const sql = mocks.query.mock.calls[0][0] as string;
    expect(sql).toContain("FROM subscriptions AS subscription");
    expect(sql).toContain("subscription_plan_entitlements AS entitlement");
    expect(sql).toContain("subscription_usage_allowances AS allowance");
    expect(sql).toContain("COALESCE(ump.enabled, TRUE) = TRUE");
  });
});
