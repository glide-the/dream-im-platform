import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reconcile: vi.fn() }));

vi.mock("../../../../lib/gateway/settlement-worker", () => ({
  reconcileUnknownGatewayUsage: mocks.reconcile,
}));

import { POST } from "./route";

const originalSecret = process.env.GATEWAY_SETTLEMENT_WORKER_SECRET;
const originalGrace = process.env.GATEWAY_UNKNOWN_USAGE_GRACE_SECONDS;

describe("POST /api/internal/gateway/settlements", () => {
  beforeEach(() => {
    mocks.reconcile.mockReset();
    delete process.env.GATEWAY_SETTLEMENT_WORKER_SECRET;
    delete process.env.GATEWAY_UNKNOWN_USAGE_GRACE_SECONDS;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.GATEWAY_SETTLEMENT_WORKER_SECRET;
    } else {
      process.env.GATEWAY_SETTLEMENT_WORKER_SECRET = originalSecret;
    }
    if (originalGrace === undefined) {
      delete process.env.GATEWAY_UNKNOWN_USAGE_GRACE_SECONDS;
    } else {
      process.env.GATEWAY_UNKNOWN_USAGE_GRACE_SECONDS = originalGrace;
    }
  });

  it("fails closed when worker configuration is missing", async () => {
    const response = await POST(
      new Request("https://admin.test/api/internal/gateway/settlements", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(503);
  });

  it("rejects an invalid worker credential", async () => {
    process.env.GATEWAY_SETTLEMENT_WORKER_SECRET = "s".repeat(32);
    const response = await POST(
      new Request("https://admin.test/api/internal/gateway/settlements", {
        method: "POST",
        headers: { authorization: `Bearer ${"x".repeat(32)}` },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("runs bounded conservative reconciliation with configured grace", async () => {
    process.env.GATEWAY_SETTLEMENT_WORKER_SECRET = "s".repeat(32);
    process.env.GATEWAY_UNKNOWN_USAGE_GRACE_SECONDS = "1200";
    mocks.reconcile.mockResolvedValue([
      {
        requestId: "req_01",
        outcome: "conservative_capture",
        capturedTokens: 2400,
      },
    ]);
    const response = await POST(
      new Request("https://admin.test/api/internal/gateway/settlements", {
        method: "POST",
        headers: {
          authorization: `Bearer ${"s".repeat(32)}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ limit: 10 }),
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledWith({
      graceSeconds: 1200,
      limit: 10,
    });
  });
});
