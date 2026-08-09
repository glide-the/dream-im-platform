import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  plansQuerySchema,
  subscriptionCommandSchema,
  usageQuerySchema,
} from "./contracts";
import { assertProductDtoSafe } from "./dto";
import type {
  ProductSubscriptionRow,
  ProductTargetVersionRow,
} from "./repository";
import {
  executeProductSubscriptionCommand,
  getProductModelCatalog,
  getProductPlans,
  getProductSubscriptionContext,
  getProductUsage,
  previewProductSubscriptionCommand,
  type ProductServiceDependencies,
} from "./service";
import type { ProductAction, ProductPrincipal } from "./types";

const principal: ProductPrincipal = {
  canonicalUserId: "7",
  platformUserId: "usr_projection",
  clientId: "dream-bff",
  tokenId: "jti_1",
  scopes: ["product:read", "product:write"],
  tier: "creator",
};

const current: ProductSubscriptionRow = {
  subscription_id: "sub_1",
  status: "active",
  subscription_version: 7,
  current_plan_version_id: "planv_current",
  current_plan_code: "creator",
  current_plan_name: "Creator",
  current_plan_version_number: 4,
  current_allowance_tokens: "1000000",
  current_base_price_microusd: "9000000",
  current_currency: "USD",
  current_version_token_only: true,
  pending_plan_version_id: null,
  pending_plan_code: null,
  pending_plan_name: null,
  pending_plan_version_number: null,
  pending_allowance_tokens: null,
  pending_base_price_microusd: null,
  pending_currency: null,
  pending_version_token_only: null,
  cycle_anchor_at: new Date("2030-01-01T00:00:00.000Z"),
  current_period_number: 0,
  current_period_start: new Date("2030-01-01T00:00:00.000Z"),
  current_period_end: new Date("2030-02-01T00:00:00.000Z"),
  renewal_enabled: true,
  trial_ends_at: null,
  created_at: new Date("2030-01-01T00:00:00.000Z"),
};

const entitlement = {
  plan_version_id: "planv_current",
  model_alias: "dream-balanced",
  gateway_scopes: ["messages:create"],
  requests_per_minute: 30,
  daily_token_limit: "100000",
  storage_bytes_limit: "10737418240",
};

function readUnitOfWork<T>(handler: (client: PoolClient) => Promise<T>) {
  return handler({} as PoolClient);
}

function baseDependencies(
  overrides: ProductServiceDependencies = {},
): ProductServiceDependencies {
  return {
    readUnitOfWork,
    clock: () => new Date("2030-01-15T00:00:00.000Z"),
    transactionTime: vi
      .fn()
      .mockResolvedValue(new Date("2030-01-15T00:00:00.000Z")),
    ...overrides,
  };
}

describe("Product read projections", () => {
  it("returns only Token plan fields with user-bound eligibility and pagination", async () => {
    const result = await getProductPlans(
      principal,
      plansQuerySchema.parse({ page: "1", pageSize: "20" }),
      baseDependencies({
        listPlans: vi.fn().mockResolvedValue({
          rows: [
            {
              plan_code: "pro",
              plan_name: "Pro",
              description: "More model access",
              plan_version_id: "planv_pro",
              version_number: 2,
              allowance_tokens: "2000000",
              base_price_microusd: "19000000",
              currency: "USD",
            },
          ],
          entitlements: [
            { ...entitlement, plan_version_id: "planv_pro" },
          ],
          total: 1,
        }),
        findSubscription: vi.fn().mockResolvedValue(current),
      }),
    );
    expect(result).toMatchObject({
      data: [
        {
          planCode: "pro",
          billingCycle: "monthly",
          monthlyAllowanceTokens: 2_000_000,
          availableActions: ["upgrade"],
          entitlements: [
            {
              gatewayScopes: ["messages:create"],
              modelAliases: ["dream-balanced"],
            },
          ],
        },
      ],
      meta: { total: 1, page: 1, pageSize: 20 },
    });
    expect(() => assertProductDtoSafe(result)).not.toThrow();
  });

  it("fails closed before projecting an unsafe database identifier", async () => {
    await expect(
      getProductPlans(
        principal,
        plansQuerySchema.parse({}),
        baseDependencies({
          listPlans: vi.fn().mockResolvedValue({
            rows: [
              {
                plan_code: "unsafe plan code",
                plan_name: "Unsafe",
                description: null,
                plan_version_id: "planv_unsafe",
                version_number: 1,
                allowance_tokens: "1000",
                base_price_microusd: "1000000",
                currency: "USD",
              },
            ],
            entitlements: [],
            total: 1,
          }),
          findSubscription: vi.fn().mockResolvedValue(null),
        }),
      ),
    ).rejects.toMatchObject({ code: "PRODUCT_DATA_INVALID", status: 503 });
  });

  it("projects canonical context and enforces Token conservation", async () => {
    const result = await getProductSubscriptionContext(
      principal,
      baseDependencies({
        findSubscription: vi.fn().mockResolvedValue(current),
        findAllowance: vi.fn().mockResolvedValue({
          granted_tokens: "1000000",
          reserved_tokens: "1000",
          consumed_tokens: "240000",
        }),
        listEntitlements: vi.fn().mockResolvedValue([entitlement]),
      }),
    );
    expect(result).toMatchObject({
      canonicalUser: { id: "7" },
      subscription: {
        id: "sub_1",
        status: "active",
        version: 7,
        allowedActions: ["upgrade", "downgrade", "pause", "cancel"],
      },
      allowance: {
        unit: "tokens",
        granted: 1_000_000,
        reserved: 1_000,
        consumed: 240_000,
        remaining: 759_000,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/platformUser|cash|ledger|provider|secret/i);
  });

  it("projects a due paid subscription as past_due with only the renewal action", async () => {
    const result = await getProductSubscriptionContext(
      principal,
      baseDependencies({
        transactionTime: vi
          .fn()
          .mockResolvedValue(new Date("2030-02-01T00:00:01.000Z")),
        findSubscription: vi.fn().mockResolvedValue({
          ...current,
          status: "past_due",
        }),
        findAllowance: vi.fn().mockResolvedValue({
          granted_tokens: "1000000",
          reserved_tokens: "0",
          consumed_tokens: "1000000",
        }),
        listEntitlements: vi.fn().mockResolvedValue([entitlement]),
      }),
    );

    expect(result.subscription).toMatchObject({
      status: "past_due",
      allowedActions: ["renew"],
    });
  });

  it("returns an atomic, paginated Token usage projection", async () => {
    const query = usageQuerySchema.parse({ page: "1", pageSize: "25" });
    const result = await getProductUsage(
      principal,
      query,
      baseDependencies({
        findSubscription: vi.fn().mockResolvedValue(current),
        findAllowance: vi.fn().mockResolvedValue({
          granted_tokens: "1000000",
          reserved_tokens: "1000",
          consumed_tokens: "240000",
        }),
        listUsage: vi.fn().mockResolvedValue({
          summary: {
            request_count: "1",
            input_tokens: "100",
            output_tokens: "20",
            cache_read_tokens: "5",
            cache_write_tokens: "3",
            total_tokens: "128",
            unknown_usage_count: "0",
          },
          total: 1,
          rows: [
            {
              gateway_request_id: "req_1",
              model_alias: "dream-balanced",
              protocol: "anthropic",
              status: "settled",
              outcome: "succeeded",
              http_status: 200,
              error_code: null,
              input_tokens: "100",
              output_tokens: "20",
              cache_read_tokens: "5",
              cache_write_tokens: "3",
              total_tokens: "128",
              allowance_reserved_tokens: "150",
              allowance_charged_tokens: "128",
              occurred_at: new Date("2030-01-10T12:00:00.000Z"),
            },
          ],
        }),
      }),
    );
    expect(result).toMatchObject({
      data: {
        period: { timezone: "UTC" },
        allowance: { unit: "tokens", remaining: 759_000 },
        summary: { requestCount: 1, totalTokens: 128 },
        items: [
          {
            gatewayRequestId: "req_1",
            gatewayScope: "messages:create",
            outcome: "completed",
            totalTokens: 128,
            allowanceReleasedTokens: 22,
            occurredAt: "2030-01-10T12:00:00.000Z",
          },
        ],
      },
      meta: { total: 1, page: 1, pageSize: 25 },
    });
  });

  it("returns only actually entitled, routable model aliases", async () => {
    const result = await getProductModelCatalog(
      principal,
      baseDependencies({
        listModels: vi.fn().mockResolvedValue([
          {
            model_alias: "dream-balanced",
            display_name: "Balanced",
            capabilities: {
              text: true,
              stream: true,
              provider_debug: true,
            },
            context_window: 200000,
            max_output_tokens: 8192,
            gateway_scopes: ["messages:create"],
            entitlement_rpm: 30,
            entitlement_daily_tokens: "100000",
            entitlement_storage_bytes: "1000",
            user_rpm: 20,
            user_daily_tokens: null,
            subscription_status: "active",
            current_period_end: new Date("2030-02-01T00:00:00.000Z"),
            granted_tokens: "1000000",
            reserved_tokens: "1000",
            consumed_tokens: "240000",
          },
        ]),
      }),
    );
    expect(result.items[0]).toMatchObject({
      modelAlias: "dream-balanced",
      capabilities: ["stream", "text"],
      eligibility: {
        allowed: true,
        rpmLimit: 20,
        monthlyTokenRemaining: 759_000,
      },
      availability: "available",
    });
    expect(() => assertProductDtoSafe(result)).not.toThrow();
  });
});

describe("Product subscription commands", () => {
  const receipt = {
    previewId: `preview_${"a".repeat(22)}`,
    digest: `sha256:${"b".repeat(43)}`,
    expiresAt: "2030-01-15T00:05:00.000Z",
  };

  it("previews all eight lifecycle actions without writing a database", async () => {
    const cases: Array<{
      action: ProductAction;
      row: ProductSubscriptionRow | null;
      target?: ProductTargetVersionRow;
    }> = [
      {
        action: "create",
        row: null,
        target: {
          plan_code: "creator",
          plan_name: "Creator",
          plan_version_id: "planv_create",
          version_number: 1,
          allowance_tokens: "1000000",
          base_price_microusd: "9000000",
          currency: "USD",
        },
      },
      {
        action: "renew",
        row: {
          ...current,
          current_period_end: new Date("2030-01-14T00:00:00.000Z"),
        },
      },
      {
        action: "upgrade",
        row: current,
        target: {
          plan_code: "pro",
          plan_name: "Pro",
          plan_version_id: "planv_upgrade",
          version_number: 2,
          allowance_tokens: "2000000",
          base_price_microusd: "19000000",
          currency: "USD",
        },
      },
      {
        action: "downgrade",
        row: current,
        target: {
          plan_code: "starter",
          plan_name: "Starter",
          plan_version_id: "planv_downgrade",
          version_number: 2,
          allowance_tokens: "500000",
          base_price_microusd: "5000000",
          currency: "USD",
        },
      },
      { action: "pause", row: current },
      { action: "resume", row: { ...current, status: "paused" } },
      { action: "cancel", row: current },
      {
        action: "revoke_cancel",
        row: { ...current, status: "cancel_at_period_end" },
      },
    ];

    for (const testCase of cases) {
      const needsTarget = ["create", "upgrade", "downgrade"].includes(
        testCase.action,
      );
      const command = subscriptionCommandSchema.parse({
        action: testCase.action,
        phase: "preview",
        ...(needsTarget
          ? { targetPlanVersionId: testCase.target!.plan_version_id }
          : {}),
        expectedVersion: testCase.action === "create" ? null : 7,
      });
      if (command.phase !== "preview") throw new Error("unexpected phase");
      const result = await previewProductSubscriptionCommand(
        principal,
        command,
        baseDependencies({
          findSubscription: vi.fn().mockResolvedValue(testCase.row),
          findTargetVersion: vi.fn().mockResolvedValue(testCase.target ?? null),
          listEntitlements: vi.fn().mockResolvedValue([]),
          issueReceipt: vi.fn().mockReturnValue(receipt),
        }),
      );
      expect(result.action).toBe(testCase.action);
      expect(result.allowed).toBe(true);
      expect(result).toMatchObject(receipt);
    }
  });

  it("verifies receipt and returns the original idempotent snapshot", async () => {
    const command = subscriptionCommandSchema.parse({
      action: "upgrade",
      phase: "execute",
      targetPlanVersionId: "planv_upgrade",
      expectedVersion: 7,
      ...receipt,
      reason: "User confirmed the next-period upgrade",
    });
    if (command.phase !== "execute") throw new Error("unexpected phase");
    const verifyReceipt = vi.fn();
    const execute = vi.fn().mockResolvedValue({
      subscriptionId: "sub_1",
      idempotentReplay: true,
      originalSnapshot: {
        id: "sub_1",
        platform_user_id: "must-not-leak",
        status: "active",
        version: 8,
        plan_version_id: "planv_current",
        pending_plan_version_id: "planv_upgrade",
        current_period_start: "2030-01-01T00:00:00.000Z",
        current_period_end: "2030-02-01T00:00:00.000Z",
        granted_tokens: "1000000",
        reserved_tokens: "1000",
        consumed_tokens: "240000",
      },
    });
    const result = await executeProductSubscriptionCommand(
      principal,
      command,
      "command.retry-1",
      "product_request_1",
      baseDependencies({
        findSubscription: vi.fn().mockResolvedValue(current),
        findTargetVersion: vi.fn().mockResolvedValue({
          plan_code: "pro",
          plan_name: "Pro",
          plan_version_id: "planv_upgrade",
          version_number: 2,
          allowance_tokens: "2000000",
          base_price_microusd: "19000000",
          currency: "USD",
        }),
        listEntitlements: vi.fn().mockResolvedValue([]),
        verifyReceipt,
        commandPort: { execute },
      }),
    );
    expect(verifyReceipt).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalUserId: "7",
        platformUserId: "usr_projection",
        expectedVersion: 7,
        idempotencyKey: "command.retry-1",
      }),
    );
    expect(result).toMatchObject({
      outcome: "scheduled",
      subscription: {
        id: "sub_1",
        version: 8,
        pendingPlanVersionId: "planv_upgrade",
      },
      actualImpact: {
        unit: "tokens",
        appliesAt: "2030-02-01T00:00:00.000Z",
        remainingTokens: 759000,
      },
      idempotentReplay: true,
    });
    expect(JSON.stringify(result)).not.toContain("must-not-leak");
    expect(() => assertProductDtoSafe(result)).not.toThrow();
  });
});
