import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  settle: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("../platform-db", () => ({
  withPlatformTransaction: async (handler: (client: unknown) => unknown) =>
    await handler({ query: mocks.query }),
}));

vi.mock("../billing/repository", () => ({
  settleGatewayRequestOnClient: mocks.settle,
}));

vi.mock("./audit", () => ({
  recordAdminAuditOnClient: mocks.audit,
}));

vi.mock("./guard", () => ({
  adminRequestId: () => "admin_test_request",
  assertAdminMutationOrigin: () => undefined,
  requireAdminRequest: async () => ({
    id: "admin_1",
    email: "ops@example.test",
    roles: ["super_admin"],
    permissions: ["billing.adjust"],
    sessionId: "session_1",
  }),
}));

import { handleGatewayRequestReconciliation } from "./reconciliation";

const failedRequest = {
  id: "req_1",
  status: "settlement_failed",
  outcome: "failed",
  input_token_semantics: "fresh",
  reserved_microusd: "1000000",
  http_status: 502,
  error_code: "UPSTREAM_USAGE_MISSING",
  error_message: "usage missing",
  latency_ms: 250,
  first_token_ms: 100,
};

beforeEach(() => {
  mocks.query.mockReset();
  mocks.settle.mockReset();
  mocks.audit.mockReset();
  mocks.query.mockResolvedValue({ rows: [failedRequest] });
  mocks.settle.mockResolvedValue({
    idempotent: false,
    requestId: "req_1",
    charge: { chargedMicrousd: 42 },
  });
  mocks.audit.mockResolvedValue(undefined);
});

describe("handleGatewayRequestReconciliation", () => {
  it("settles known usage and records the admin actor", async () => {
    const response = await handleGatewayRequestReconciliation(
      new Request("https://admin.example.test/api/admin/reconcile", {
        method: "POST",
        body: JSON.stringify({
          mode: "settle_known_usage",
          confirmation: "SETTLE_KNOWN_USAGE",
          reason: "Matched against the upstream invoice",
          inputTokens: 100,
          outputTokens: 25,
          cacheReadTokens: 5,
          cacheWriteTokens: 0,
        }),
      }),
      "req_1",
    );

    expect(response.status).toBe(200);
    expect(mocks.settle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        gatewayRequestId: "req_1",
        actorType: "admin",
        actorId: "admin_1",
        usage: expect.objectContaining({
          inputTokens: 100,
          outputTokens: 25,
          cacheReadTokens: 5,
          inputTokenSemantics: "fresh",
        }),
      }),
    );
    expect(mocks.audit).toHaveBeenCalledOnce();
  });

  it("refuses to reconcile a request outside settlement_failed", async () => {
    mocks.query.mockResolvedValue({
      rows: [{ ...failedRequest, status: "streaming" }],
    });
    const response = await handleGatewayRequestReconciliation(
      new Request("https://admin.example.test/api/admin/reconcile", {
        method: "POST",
        body: JSON.stringify({
          mode: "release_unbilled",
          confirmation: "RELEASE_UNBILLED",
          reason: "Provider confirmed that no tokens were processed",
        }),
      }),
      "req_1",
    );

    expect(response.status).toBe(409);
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
