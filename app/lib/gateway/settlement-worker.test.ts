// [Input] Controlled usage-unknown request, allowance and PostgreSQL client responses.
// [Output] Account-before-request/allowance ordering and conservative Token capture evidence.
// [Pos] Provider-free unit contract for unknown-usage reconciliation.
// [Sync] 2026-10-03: assert reconciliation enters the shared account transaction gate first.

import { describe, expect, it, vi } from "vitest";

import { resolveUnknownGatewayUsageOnClient } from "./settlement-worker";

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
