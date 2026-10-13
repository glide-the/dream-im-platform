// [Input] PostgreSQL transaction, model/tier scope and proposed version window.
// [Output] Serialized price writes and conflict rejection shared by forms and catalog Apply.
// [Pos] Existing Admin pricing guards extracted without changing the ordinary mutation contract.
// [Sync] 2026-10-10: reuse scope locking and active-window checks in models.dev price application.
import type { PoolClient } from "pg";
import { AdminError } from "./errors";

export async function lockPricingScope(
  client: PoolClient,
  modelId: string,
  userTier: string,
) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [`${modelId}:${userTier}`],
  );
}

export async function assertPricingWindow(
  client: PoolClient,
  input: {
    modelId: string;
    userTier: string;
    effectiveFrom: string;
    effectiveTo?: string | null;
    excludeId?: string;
  },
) {
  const overlap = await client.query(
    `SELECT 1 FROM ai_pricing_rules
     WHERE model_id = $1 AND user_tier = $2 AND status = 'active'
       AND id <> COALESCE($5, '')
       AND tstzrange(effective_from, effective_to, '[)') &&
           tstzrange($3::timestamptz, $4::timestamptz, '[)')
     LIMIT 1`,
    [
      input.modelId,
      input.userTier,
      input.effectiveFrom,
      input.effectiveTo ?? "infinity",
      input.excludeId ?? null,
    ],
  );
  if (overlap.rows[0]) {
    throw new AdminError(
      "PRICING_WINDOW_CONFLICT",
      "该模型与用户层级已有价格版本覆盖此生效时间，请晚于当前版本开始时间或检查未来价格窗口",
      409,
    );
  }
}
