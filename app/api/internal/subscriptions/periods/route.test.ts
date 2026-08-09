import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  advance: vi.fn(),
}));

vi.mock("../../../../lib/subscriptions/period-worker", () => ({
  advanceDueSubscriptions: mocks.advance,
}));

import { POST } from "./route";

const secret = "period-worker-test-secret-with-32-bytes-minimum";

describe("subscription period worker route", () => {
  beforeEach(() => {
    mocks.advance.mockReset();
    delete process.env.SUBSCRIPTION_PERIOD_WORKER_SECRET;
  });

  afterEach(() => {
    delete process.env.SUBSCRIPTION_PERIOD_WORKER_SECRET;
  });

  it("fails closed when the worker secret is not configured", async () => {
    const response = await POST(
      new Request("http://localhost/api/internal/subscriptions/periods", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(503);
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer token without revealing configuration", async () => {
    process.env.SUBSCRIPTION_PERIOD_WORKER_SECRET = secret;
    const response = await POST(
      new Request("http://localhost/api/internal/subscriptions/periods", {
        method: "POST",
        headers: { authorization: "Bearer wrong-secret" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.advance).not.toHaveBeenCalled();
  });

  it("runs the bounded worker with valid service authorization", async () => {
    process.env.SUBSCRIPTION_PERIOD_WORKER_SECRET = secret;
    mocks.advance.mockResolvedValue([
      { subscriptionId: "sub_1", outcome: "renewed" },
    ]);
    const response = await POST(
      new Request("http://localhost/api/internal/subscriptions/periods", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ limit: 25 }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { processed: 1 },
    });
    expect(mocks.advance).toHaveBeenCalledWith({ limit: 25 });
  });
});
