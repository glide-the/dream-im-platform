import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clientQuery: vi.fn(),
  activate: vi.fn(),
  transition: vi.fn(),
}));

vi.mock("../platform-db", () => ({
  withPlatformTransaction: async (handler: (client: unknown) => Promise<unknown>) =>
    await handler({ query: mocks.clientQuery }),
}));

vi.mock("../subscriptions/service", () => ({
  activateSubscriptionOnClient: mocks.activate,
  transitionSubscriptionOnClient: mocks.transition,
}));

import { ProductError } from "./errors";
import { productCommandPort, type ProductCommandPortInput } from "./command-port";

const input: ProductCommandPortInput = {
  requestId: "product_request_1",
  canonicalUserId: "7",
  platformUserId: "usr_projection",
  clientId: "dream-bff",
  tokenId: "jti_1",
  action: "upgrade",
  targetPlanVersionId: "planv_target",
  expectedVersion: 7,
  idempotencyKey: "command.retry-1",
  reason: "User confirmed the next-period upgrade",
  receipt: {
    previewId: `preview_${"a".repeat(22)}`,
    digest: `sha256:${"b".repeat(43)}`,
    expiresAt: "2030-01-01T00:05:00.000Z",
  },
};

describe("Product command Subscription adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clientQuery
      .mockResolvedValueOnce({
        rows: [
          {
            canonical_user_id: "7",
            platform_user_id: "usr_projection",
            platform_status: "active",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: "sub_1" }] });
    mocks.transition.mockResolvedValue({
      subscriptionId: "sub_1",
      idempotent: true,
      originalAfter: { id: "sub_1", version: 8 },
    });
    mocks.activate.mockResolvedValue({
      id: "sub_created",
      action: "activate",
      originalAfter: { id: "sub_created", version: 1 },
    });
  });

  it("locks canonical projection and delegates non-create CAS transitions", async () => {
    const result = await productCommandPort.execute(input);
    expect(mocks.clientQuery).toHaveBeenCalledTimes(2);
    expect(mocks.transition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "sub_1",
        platformUserId: "usr_projection",
        action: "upgrade",
        expectedVersion: 7,
        planVersionId: "planv_target",
        actor: { type: "product_user", id: "7" },
      }),
    );
    expect(
      mocks.transition.mock.calls[0]?.[1].idempotencyKey,
    ).toMatch(/^product:7:[A-Za-z0-9_-]{43}$/);
    expect(result).toEqual({
      subscriptionId: "sub_1",
      idempotentReplay: true,
      originalSnapshot: { id: "sub_1", version: 8 },
    });
  });

  it("delegates create with a null expected version", async () => {
    mocks.clientQuery.mockReset().mockResolvedValueOnce({
      rows: [
        {
          canonical_user_id: "7",
          platform_user_id: "usr_projection",
          platform_status: "active",
        },
      ],
    });
    const result = await productCommandPort.execute({
      ...input,
      action: "create",
      targetPlanVersionId: "planv_target",
      expectedVersion: null,
    });
    expect(mocks.activate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        platformUserId: "usr_projection",
        planVersionId: "planv_target",
        startInTrial: true,
        actor: { type: "product_user", id: "7" },
      }),
    );
    expect(result.subscriptionId).toBe("sub_created");
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it("fails closed before state mutation for an orphan projection", async () => {
    mocks.clientQuery.mockReset().mockResolvedValueOnce({ rows: [] });
    await expect(productCommandPort.execute(input)).rejects.toThrowError(
      expect.objectContaining<Partial<ProductError>>({
        code: "CANONICAL_USER_REQUIRED",
        status: 403,
      }),
    );
    expect(mocks.activate).not.toHaveBeenCalled();
    expect(mocks.transition).not.toHaveBeenCalled();
  });
});

