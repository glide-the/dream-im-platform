import { withPlatformTransaction } from "../platform-db";
import { advanceSubscriptionPeriodOnClient } from "./service";

type DueSubscription = {
  id: string;
  version: number;
  current_period_number: number;
  current_period_end: Date;
};

export type PeriodAdvanceResult = {
  subscriptionId: string;
  outcome: "renewed" | "payment_required" | "cancelled" | "expired" | "idempotent";
};

function assertLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError("limit must be an integer between 1 and 500");
  }
}

function boundaryKey(row: DueSubscription) {
  return [
    "subscription-period",
    row.id,
    row.current_period_number + 1,
    row.current_period_end.toISOString(),
  ].join(":");
}

/**
 * Advances due subscriptions one transaction at a time.
 *
 * Each transaction claims exactly one row with SKIP LOCKED. A failure rolls
 * back only that subscription; previously completed boundaries remain
 * committed and every retry reuses a stable boundary idempotency key.
 */
export async function advanceDueSubscriptions(input?: {
  at?: Date;
  limit?: number;
}): Promise<PeriodAdvanceResult[]> {
  const at = input?.at ?? new Date();
  const limit = input?.limit ?? 100;
  if (Number.isNaN(at.getTime())) throw new RangeError("at must be a valid Date");
  assertLimit(limit);

  const completed: PeriodAdvanceResult[] = [];
  for (let index = 0; index < limit; index += 1) {
    const advanced = await withPlatformTransaction(async (client) => {
      const result = await client.query<DueSubscription>(
        `SELECT id, version, current_period_number, current_period_end
         FROM subscriptions
         WHERE current_period_end <= $1
           AND status IN (
             'trial', 'active', 'paused', 'cancel_at_period_end'
           )
         ORDER BY current_period_end ASC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [at],
      );
      const due = result.rows[0];
      if (!due) return null;
      const outcome = await advanceSubscriptionPeriodOnClient(client, {
        id: due.id,
        expectedVersion: due.version,
        expectedPeriodEnd: due.current_period_end,
        at,
        idempotencyKey: boundaryKey(due),
      });
      return {
        subscriptionId: outcome.subscriptionId,
        outcome: outcome.outcome,
      } satisfies PeriodAdvanceResult;
    });
    if (!advanced) break;
    completed.push(advanced);
  }
  return completed;
}
