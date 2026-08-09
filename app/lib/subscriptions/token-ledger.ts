import type { PoolClient } from "pg";

import { createPlatformId } from "../platform-ids";

export type TokenAllowanceState = {
  grantedTokens: number;
  reservedTokens: number;
  consumedTokens: number;
};

export type TokenLedgerSnapshot = {
  availableTokens: number;
  reservedTokens: number;
  consumedTokens: number;
};

export type TokenLedgerEntryType =
  | "reserve"
  | "capture"
  | "release"
  | "refund"
  | "reversal";

function safeToken(value: number, field: string, positive = false) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    (positive && value === 0)
  ) {
    throw new RangeError(`${field} is outside the safe Token range`);
  }
  return value;
}

export function tokenLedgerSnapshot(
  state: TokenAllowanceState,
): TokenLedgerSnapshot {
  const grantedTokens = safeToken(state.grantedTokens, "grantedTokens");
  const reservedTokens = safeToken(state.reservedTokens, "reservedTokens");
  const consumedTokens = safeToken(state.consumedTokens, "consumedTokens");
  const availableTokens = grantedTokens - reservedTokens - consumedTokens;
  if (!Number.isSafeInteger(availableTokens) || availableTokens < 0) {
    throw new Error("SUBSCRIPTION_TOKEN_LEDGER_CONSERVATION_INVALID");
  }
  return { availableTokens, reservedTokens, consumedTokens };
}

export async function appendSubscriptionTokenLedgerEntryOnClient(
  client: PoolClient,
  input: {
    platformUserId: string;
    subscriptionId: string;
    planVersionId: string;
    allowanceId: string;
    gatewayRequestId: string;
    requestSequence: number;
    entryType: TokenLedgerEntryType;
    amountTokens: number;
    before: TokenLedgerSnapshot;
    after: TokenLedgerSnapshot;
    idempotencyKey: string;
    actorType?: "gateway" | "system" | "admin";
    actorId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const amountTokens = safeToken(input.amountTokens, "amountTokens", true);
  const requestSequence = safeToken(
    input.requestSequence,
    "requestSequence",
    true,
  );
  for (const [field, value] of Object.entries({
    availableBeforeTokens: input.before.availableTokens,
    availableAfterTokens: input.after.availableTokens,
    reservedBeforeTokens: input.before.reservedTokens,
    reservedAfterTokens: input.after.reservedTokens,
    consumedBeforeTokens: input.before.consumedTokens,
    consumedAfterTokens: input.after.consumedTokens,
  })) {
    safeToken(value, field);
  }
  if (
    !input.idempotencyKey ||
    input.idempotencyKey.length > 200 ||
    [
      input.platformUserId,
      input.subscriptionId,
      input.planVersionId,
      input.allowanceId,
      input.gatewayRequestId,
    ].some((value) => !value)
  ) {
    throw new Error("SUBSCRIPTION_TOKEN_LEDGER_IDENTITY_INVALID");
  }
  const id = createPlatformId("tokenledger");
  await client.query(
    `INSERT INTO subscription_token_ledger_entries (
       id, platform_user_id, subscription_id, plan_version_id,
       subscription_allowance_id, gateway_request_id, request_sequence, entry_type,
       amount_tokens, available_before_tokens, available_after_tokens,
       reserved_before_tokens, reserved_after_tokens,
       consumed_before_tokens, consumed_after_tokens, idempotency_key,
       actor_type, actor_id, metadata
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb
     )`,
    [
      id,
      input.platformUserId,
      input.subscriptionId,
      input.planVersionId,
      input.allowanceId,
      input.gatewayRequestId,
      requestSequence,
      input.entryType,
      amountTokens,
      input.before.availableTokens,
      input.after.availableTokens,
      input.before.reservedTokens,
      input.after.reservedTokens,
      input.before.consumedTokens,
      input.after.consumedTokens,
      input.idempotencyKey,
      input.actorType ?? "gateway",
      input.actorId ?? input.gatewayRequestId,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return id;
}
