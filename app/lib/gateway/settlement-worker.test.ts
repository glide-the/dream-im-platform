// [Input] Controlled usage-unknown request, allowance and PostgreSQL client responses.
// [Output] Account-before-request/allowance ordering plus unknown and persisted-actual Image recovery evidence.
// [Pos] Provider-free unit contract for Gateway settlement reconciliation.
// [Sync] 2026-10-09: assert conservative unknown capture and known Image usage recovery without Provider replay.

import * as billingRepository from "../billing/repository";
import { describe, expect, it, vi } from "vitest";

import {
  resolveKnownGatewayUsageOnClient,
  resolveUnknownGatewayUsageOnClient,
} from "./settlement-worker";

describe("usage-unknown reconciliation", () => {
  it("conservatively consumes the Token reservation without touching cash tables", async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("FROM gateway_requests")) {
          return {
            rows: [{
              id: "req_01",
              status: "settlement_failed",
              settled_at: null,
              completed_at: new Date("2026-08-09T00:00:00Z"),
              platform_user_id: "usr_01",
              subscription_id: "sub_01",
              subscription_plan_version_id: "planv_01",
              subscription_allowance_id: "allow_01",
              subscription_coverage_mode: "token_allowance",
              allowance_reserved_tokens: "2400",
              allowance_reserved_microusd: "0",
              response_summary: null,
            }],
            rowCount: 1,
          };
        }
        if (sql.includes("FROM subscription_usage_allowances")) {
          return {
            rows: [{
              subscription_id: "sub_01",
              plan_version_id: "planv_01",
              granted_tokens: "10000",
              reserved_tokens: "2400",
              consumed_tokens: "1000",
              granted_microusd: "0",
              reserved_microusd: "0",
              consumed_microusd: "0",
            }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    await expect(
      resolveUnknownGatewayUsageOnClient(client as never, {
        requestId: "req_01",
        resolvedAt: new Date("2026-08-09T00:20:00Z"),
      }),
    ).resolves.toEqual({
      requestId: "req_01",
      outcome: "conservative_capture",
      capturedTokens: 2400,
    });

    expect(statements.join("\n")).not.toMatch(
      /billing_accounts|billing_ledger_entries/i,
    );
    expect(statements.join("\n")).toContain(
      "consumed_tokens = consumed_tokens + $3",
    );
    expect(statements.join("\n")).toContain(
      "conservative_estimated_capture",
    );
    expect(statements.join("\n")).toContain("status = 'settled'");
    expect(statements.join("\n")).toContain(
      "subscription_token_ledger_entries",
    );
    const accountLockIndex = statements.findIndex(statement =>
      statement.includes("pg_advisory_xact_lock")
    );
    const requestLockIndex = statements.findIndex(statement =>
      statement.includes("FROM gateway_requests") &&
      statement.includes("FOR UPDATE")
    );
    const allowanceLockIndex = statements.findIndex(statement =>
      statement.includes("FROM subscription_usage_allowances")
    );
    expect(accountLockIndex).toBeGreaterThanOrEqual(0);
    expect(requestLockIndex).toBeGreaterThan(accountLockIndex);
    expect(allowanceLockIndex).toBeGreaterThan(requestLockIndex);
  });
});

describe("known Image usage reconciliation", () => {
  it("settles persisted token details without any Provider operation", async () => {
    const statements: string[] = [];
    let gatewaySelects = 0;
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        if (sql.includes("FROM gateway_requests")) {
          gatewaySelects += 1;
          if (gatewaySelects === 1) {
            return { rows: [{
              id: "req_image",
              operation: "images.edits",
              outcome: "failed",
              input_token_semantics: "total_including_cache",
              input_tokens: "5",
              output_tokens: "10",
              cache_read_tokens: "0",
              cache_write_tokens: "0",
              input_text_tokens: "3",
              input_image_tokens: "2",
              output_text_tokens: "0",
              output_image_tokens: "10",
              upstream_request_id: "upstream_image_1",
              http_status: 503,
              error_code: "BILLING_SETTLEMENT_UNAVAILABLE",
              error_message: "pending",
              latency_ms: 100,
              first_token_ms: null,
              response_summary: { usageKnown: true },
            }], rowCount: 1 };
          }
          if (gatewaySelects === 2) {
            return { rows: [{
              id: "req_image",
              platform_user_id: "usr_01",
              settled_at: null,
            }], rowCount: 1 };
          }
          return { rows: [{
            id: "req_image",
            platform_user_id: "usr_01",
            model_id: "model_01",
            status: "settlement_failed",
            outcome: "failed",
            operation: "images.edits",
            reserved_microusd: "0",
            estimated_tokens: "15",
            subscription_id: "sub_01",
            subscription_plan_version_id: "planv_01",
            subscription_allowance_id: "allow_01",
            subscription_coverage_mode: "token_allowance",
            allowance_reserved_microusd: "0",
            allowance_reserved_tokens: "15",
            created_at: new Date("2026-10-09T00:00:00Z"),
            settled_at: null,
            input_price_snapshot: "1000000",
            output_price_snapshot: "0",
            cache_read_price_snapshot: "0",
            cache_write_price_snapshot: "0",
            image_input_price_snapshot: "2000000",
            image_output_price_snapshot: "3000000",
            markup_bps_snapshot: 0,
            discount_bps_snapshot: 0,
          }], rowCount: 1 };
        }
        if (sql.includes("FROM subscription_usage_allowances")) {
          return { rows: [{
            subscription_id: "sub_01",
            plan_version_id: "planv_01",
            granted_tokens: "100",
            reserved_tokens: "15",
            consumed_tokens: "0",
            granted_microusd: "0",
            reserved_microusd: "0",
            consumed_microusd: "0",
          }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    await expect(resolveKnownGatewayUsageOnClient(
      client as never,
      { requestId: "req_image" },
    )).resolves.toMatchObject({ actualTokens: 15 });
    const all = statements.join("\n");
    expect(all).toContain("input_text_tokens = $18");
    expect(all).toContain("subscription_token_ledger_entries");
    expect(all).not.toMatch(/gateway_provider_attempts|routing_attempts/i);
  });
});

// [Sync] 2026-10-11: native reported-Token recovery retains full capture; ordinary text remains unchanged.
it.each([
  [{ billingScope: "responses_reported_tokens", requireFullTokenAllowanceCapture: true }, true],
  [{ billingScope: "responses_reported_tokens", requireFullTokenAllowanceCapture: false }, false],
  [{ billingScope: "other", requireFullTokenAllowanceCapture: true }, false],
  [{}, false],
])("scopes full allowance recovery to the server-marked native contract", async (summary, full) => {
  const settle = vi.spyOn(billingRepository, "settleGatewayRequestOnClient").mockResolvedValue({} as never);
  try {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: "req_native", operation: "text", outcome: "succeeded", input_token_semantics: "fresh", input_tokens: "100", output_tokens: "20", cache_read_tokens: "40", cache_write_tokens: "0", input_text_tokens: null, input_image_tokens: null, output_text_tokens: null, output_image_tokens: null, upstream_request_id: "resp_native", response_summary: { usageKnown: true, ...summary } }] }) };
    expect(await resolveKnownGatewayUsageOnClient(client as never, { requestId: "req_native" })).toMatchObject({ actualTokens: 120 });
    expect(settle).toHaveBeenCalledExactlyOnceWith(client, expect.objectContaining({ requireFullTokenAllowanceCapture: full, usage: expect.objectContaining({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, inputTokenSemantics: full ? "total_including_cache" : "fresh" }), responseSummary: expect.objectContaining({ settlementResolution: "actual_usage_recovered" }) }));
  } finally { settle.mockRestore(); }
});
