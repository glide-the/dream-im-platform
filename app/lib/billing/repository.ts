import type { PoolClient } from "pg";
import {
  creditAccount,
  reserveAccount,
  settleAccount,
  type AccountSnapshot,
} from "./accounting";
import { calculateCharge } from "./money";
import type { PricingSnapshot, TokenUsage } from "./types";
import { withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import { totalProcessedTokens } from "../gateway/usage";
import { settleSubscriptionAllowanceOnClient } from "../subscriptions/gateway";

type AccountRow = {
  id: string;
  platform_user_id: string;
  available_microusd: string | number;
  reserved_microusd: string | number;
  lifetime_debited_microusd: string | number;
  version: number;
};

type RequestRow = {
  id: string;
  platform_user_id: string;
  model_id: string;
  status: string;
  outcome: string;
  reserved_microusd: string | number;
  estimated_tokens: string | number;
  subscription_id: string | null;
  subscription_allowance_id: string | null;
  subscription_coverage_mode: string | null;
  allowance_reserved_microusd: string | number;
  allowance_reserved_tokens: string | number;
  created_at: Date;
  settled_at: Date | null;
  input_price_snapshot: string | number;
  output_price_snapshot: string | number;
  cache_read_price_snapshot: string | number;
  cache_write_price_snapshot: string | number;
  markup_bps_snapshot: number;
  discount_bps_snapshot: number;
};

type LedgerEntryType =
  | "credit"
  | "reserve"
  | "capture"
  | "release"
  | "refund"
  | "adjustment"
  | "allowance_capture";

function safeDbNumber(value: string | number, name: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`${name} is outside the safe integer range`);
  }
  return parsed;
}

function accountSnapshot(row: AccountRow): AccountSnapshot {
  return {
    availableMicrousd: safeDbNumber(
      row.available_microusd,
      "available_microusd",
    ),
    reservedMicrousd: safeDbNumber(
      row.reserved_microusd,
      "reserved_microusd",
    ),
    lifetimeDebitedMicrousd: safeDbNumber(
      row.lifetime_debited_microusd,
      "lifetime_debited_microusd",
    ),
  };
}

async function ensureAccount(client: PoolClient, platformUserId: string) {
  await client.query(
    `INSERT INTO billing_accounts (id, platform_user_id)
     VALUES ($1, $2)
     ON CONFLICT (platform_user_id) DO NOTHING`,
    [createPlatformId("acct"), platformUserId],
  );
}

async function lockAccount(client: PoolClient, platformUserId: string) {
  await ensureAccount(client, platformUserId);
  const { rows } = await client.query<AccountRow>(
    `SELECT id, platform_user_id, available_microusd, reserved_microusd,
            lifetime_debited_microusd, version
     FROM billing_accounts
     WHERE platform_user_id = $1
     FOR UPDATE`,
    [platformUserId],
  );
  if (!rows[0]) throw new Error("BILLING_ACCOUNT_NOT_FOUND");
  return rows[0];
}

async function existingLedgerEntry(
  client: PoolClient,
  idempotencyKey: string,
) {
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM billing_ledger_entries WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return rows[0] ?? null;
}

async function updateAccount(
  client: PoolClient,
  accountId: string,
  state: AccountSnapshot,
) {
  await client.query(
    `UPDATE billing_accounts
     SET available_microusd = $2,
         reserved_microusd = $3,
         lifetime_debited_microusd = $4,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [
      accountId,
      state.availableMicrousd,
      state.reservedMicrousd,
      state.lifetimeDebitedMicrousd,
    ],
  );
}

async function insertLedgerEntry(
  client: PoolClient,
  input: {
    accountId: string;
    platformUserId: string;
    gatewayRequestId?: string | null;
    subscriptionId?: string | null;
    subscriptionAllowanceId?: string | null;
    entryType: LedgerEntryType;
    amountMicrousd: number;
    before: AccountSnapshot;
    after: AccountSnapshot;
    idempotencyKey: string;
    description?: string;
    actorType: string;
    actorId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  const id = createPlatformId("ledger");
  await client.query(
    `INSERT INTO billing_ledger_entries (
       id, account_id, platform_user_id, gateway_request_id,
       subscription_id, subscription_allowance_id, entry_type,
       amount_microusd, available_before_microusd, available_after_microusd,
       reserved_before_microusd, reserved_after_microusd, idempotency_key,
       description, actor_type, actor_id, metadata
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17::jsonb
     )`,
    [
      id,
      input.accountId,
      input.platformUserId,
      input.gatewayRequestId ?? null,
      input.subscriptionId ?? null,
      input.subscriptionAllowanceId ?? null,
      input.entryType,
      input.amountMicrousd,
      input.before.availableMicrousd,
      input.after.availableMicrousd,
      input.before.reservedMicrousd,
      input.after.reservedMicrousd,
      input.idempotencyKey,
      input.description ?? null,
      input.actorType,
      input.actorId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return id;
}

export type CreditBillingAccountInput = {
  platformUserId: string;
  amountMicrousd: number;
  idempotencyKey: string;
  description: string;
  actorType: "admin" | "system";
  actorId?: string;
};

export async function creditBillingAccountOnClient(
  client: PoolClient,
  input: CreditBillingAccountInput,
) {
  const account = await lockAccount(client, input.platformUserId);
  const duplicate = await existingLedgerEntry(client, input.idempotencyKey);
  if (duplicate) {
    return {
      idempotent: true,
      ledgerEntryId: duplicate.id,
      account: accountSnapshot(account),
    };
  }
  const transition = creditAccount(
    accountSnapshot(account),
    input.amountMicrousd,
  );
  await updateAccount(client, account.id, transition.after);
  const ledgerEntryId = await insertLedgerEntry(client, {
    accountId: account.id,
    platformUserId: input.platformUserId,
    entryType: "credit",
    amountMicrousd: input.amountMicrousd,
    before: transition.before,
    after: transition.after,
    idempotencyKey: input.idempotencyKey,
    description: input.description,
    actorType: input.actorType,
    actorId: input.actorId,
  });
  return {
    idempotent: false,
    ledgerEntryId,
    account: transition.after,
  };
}

export async function creditBillingAccount(input: CreditBillingAccountInput) {
  return await withPlatformTransaction(async (client) => {
    return await creditBillingAccountOnClient(client, input);
  });
}

export async function reserveGatewayRequestOnClient(
  client: PoolClient,
  input: {
    platformUserId: string;
    gatewayRequestId: string;
    amountMicrousd: number;
  },
) {
  const idempotencyKey = `${input.gatewayRequestId}:reserve`;
  const requestResult = await client.query<{
    platform_user_id: string;
    status: string;
    settled_at: Date | null;
  }>(
    `SELECT platform_user_id, status, settled_at
     FROM gateway_requests
     WHERE id = $1
     FOR UPDATE`,
    [input.gatewayRequestId],
  );
  const request = requestResult.rows[0];
  if (!request) throw new Error("GATEWAY_REQUEST_NOT_FOUND");
  if (request.platform_user_id !== input.platformUserId) {
    throw new Error("GATEWAY_REQUEST_ACCOUNT_MISMATCH");
  }
  if (request.settled_at) {
    throw new Error("GATEWAY_REQUEST_ALREADY_SETTLED");
  }
  const account = await lockAccount(client, input.platformUserId);
  const duplicate = await existingLedgerEntry(client, idempotencyKey);
  if (duplicate) {
    return {
      idempotent: true,
      ledgerEntryId: duplicate.id,
      account: accountSnapshot(account),
    };
  }
  const transition = reserveAccount(
    accountSnapshot(account),
    input.amountMicrousd,
  );
  await updateAccount(client, account.id, transition.after);
  const ledgerEntryId = await insertLedgerEntry(client, {
    accountId: account.id,
    platformUserId: input.platformUserId,
    gatewayRequestId: input.gatewayRequestId,
    entryType: "reserve",
    amountMicrousd: input.amountMicrousd,
    before: transition.before,
    after: transition.after,
    idempotencyKey,
    description: "Gateway request pre-authorization",
    actorType: "gateway",
    actorId: input.gatewayRequestId,
  });
  await client.query(
    `UPDATE gateway_requests
     SET status = 'reserved', reserved_microusd = $2, started_at = NOW()
     WHERE id = $1 AND platform_user_id = $3`,
    [input.gatewayRequestId, input.amountMicrousd, input.platformUserId],
  );
  return {
    idempotent: false,
    ledgerEntryId,
    account: transition.after,
  };
}

export async function reserveGatewayRequest(input: {
  platformUserId: string;
  gatewayRequestId: string;
  amountMicrousd: number;
}) {
  return await withPlatformTransaction(async (client) => {
    return await reserveGatewayRequestOnClient(client, input);
  });
}

function pricingFromRequest(row: RequestRow): PricingSnapshot {
  return {
    inputPriceMicrousdPerMillion: safeDbNumber(
      row.input_price_snapshot,
      "input_price_snapshot",
    ),
    outputPriceMicrousdPerMillion: safeDbNumber(
      row.output_price_snapshot,
      "output_price_snapshot",
    ),
    cacheReadPriceMicrousdPerMillion: safeDbNumber(
      row.cache_read_price_snapshot,
      "cache_read_price_snapshot",
    ),
    cacheWritePriceMicrousdPerMillion: safeDbNumber(
      row.cache_write_price_snapshot,
      "cache_write_price_snapshot",
    ),
    markupBps: row.markup_bps_snapshot,
    discountBps: row.discount_bps_snapshot,
  };
}

export type SettleGatewayRequestInput = {
  gatewayRequestId: string;
  usage: TokenUsage;
  outcome: "succeeded" | "failed" | "cancelled";
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  latencyMs?: number;
  firstTokenMs?: number;
  responseSummary?: Record<string, unknown>;
  actorType?: "gateway" | "admin" | "system";
  actorId?: string;
  settlementDescription?: string;
};

export async function settleGatewayRequestOnClient(
  client: PoolClient,
  input: SettleGatewayRequestInput,
) {
    const { rows } = await client.query<RequestRow>(
      `SELECT id, platform_user_id, model_id, status, outcome,
              reserved_microusd, estimated_tokens, subscription_id,
              subscription_allowance_id, subscription_coverage_mode,
              allowance_reserved_microusd, allowance_reserved_tokens, created_at,
              settled_at, input_price_snapshot, output_price_snapshot,
              cache_read_price_snapshot, cache_write_price_snapshot,
              markup_bps_snapshot, discount_bps_snapshot
       FROM gateway_requests
       WHERE id = $1
       FOR UPDATE`,
      [input.gatewayRequestId],
    );
    const request = rows[0];
    if (!request) throw new Error("GATEWAY_REQUEST_NOT_FOUND");
    if (request.settled_at) {
      return { idempotent: true, requestId: request.id };
    }

    const account = await lockAccount(client, request.platform_user_id);
    const charge = calculateCharge(input.usage, pricingFromRequest(request));
    const reserved = safeDbNumber(
      request.reserved_microusd,
      "reserved_microusd",
    );
    const actualTokens = totalProcessedTokens(input.usage);
    const allowance = await settleSubscriptionAllowanceOnClient(client, {
      allowanceId: request.subscription_allowance_id,
      coverageMode: request.subscription_coverage_mode,
      reservedTokens: safeDbNumber(
        request.allowance_reserved_tokens,
        "allowance_reserved_tokens",
      ),
      reservedMicrousd: safeDbNumber(
        request.allowance_reserved_microusd,
        "allowance_reserved_microusd",
      ),
      actualTokens,
      chargeMicrousd: charge.chargedMicrousd,
    });
    const transitions = settleAccount(
      accountSnapshot(account),
      reserved,
      allowance.cashChargeMicrousd,
    );
    const estimatedTokens = safeDbNumber(
      request.estimated_tokens,
      "estimated_tokens",
    );
    const tokenDelta = actualTokens - estimatedTokens;

    if (allowance.allowanceChargeMicrousd > 0) {
      const snapshot = accountSnapshot(account);
      await insertLedgerEntry(client, {
        accountId: account.id,
        platformUserId: request.platform_user_id,
        gatewayRequestId: request.id,
        subscriptionId: request.subscription_id,
        subscriptionAllowanceId: request.subscription_allowance_id,
        entryType: "allowance_capture",
        amountMicrousd: allowance.allowanceChargeMicrousd,
        before: snapshot,
        after: snapshot,
        idempotencyKey: `${request.id}:allowance:capture`,
        description: "Capture subscription allowance for gateway usage",
        actorType: input.actorType ?? "gateway",
        actorId: input.actorId ?? request.id,
        metadata: { allowanceChargedTokens: allowance.allowanceChargedTokens },
      });
    }

    for (const windowType of ["day", "month"] as const) {
      await client.query(
        `UPDATE gateway_rate_limits
         SET token_count = GREATEST(0, token_count + $5::bigint),
             updated_at = NOW()
         WHERE platform_user_id = $1 AND model_id = $2
           AND window_type = $3
           AND window_start = date_trunc($3, $4::timestamptz)`,
        [
          request.platform_user_id,
          request.model_id,
          windowType,
          request.created_at,
          tokenDelta,
        ],
      );
    }

    if (transitions.capture) {
      await insertLedgerEntry(client, {
        accountId: account.id,
        platformUserId: request.platform_user_id,
        gatewayRequestId: request.id,
        subscriptionId: request.subscription_id,
        subscriptionAllowanceId: request.subscription_allowance_id,
        entryType: "capture",
        amountMicrousd: transitions.capture.amountMicrousd,
        before: transitions.capture.before,
        after: transitions.capture.after,
        idempotencyKey: `${request.id}:capture`,
        description:
          input.settlementDescription ?? "Capture actual gateway usage",
        actorType: input.actorType ?? "gateway",
        actorId: input.actorId ?? request.id,
        metadata: { providerCostMicrousd: charge.providerCostMicrousd },
      });
    }
    if (transitions.release) {
      await insertLedgerEntry(client, {
        accountId: account.id,
        platformUserId: request.platform_user_id,
        gatewayRequestId: request.id,
        subscriptionId: request.subscription_id,
        subscriptionAllowanceId: request.subscription_allowance_id,
        entryType: "release",
        amountMicrousd: transitions.release.amountMicrousd,
        before: transitions.release.before,
        after: transitions.release.after,
        idempotencyKey: `${request.id}:release`,
        description:
          input.settlementDescription ??
          "Release unused gateway pre-authorization",
        actorType: input.actorType ?? "gateway",
        actorId: input.actorId ?? request.id,
      });
    }

    await updateAccount(client, account.id, transitions.final);
    await client.query(
      `UPDATE gateway_requests
       SET status = 'settled', outcome = $2,
           input_tokens = $3, output_tokens = $4,
           cache_read_tokens = $5, cache_write_tokens = $6,
           provider_cost_microusd = $7, charged_microusd = $8,
           upstream_request_id = COALESCE($9, upstream_request_id),
           http_status = $10, error_code = $11, error_message = $12,
           latency_ms = $13, first_token_ms = $14,
           response_summary = $15::jsonb,
           allowance_charged_microusd = $16,
           allowance_charged_tokens = $17,
           completed_at = COALESCE(completed_at, NOW()), settled_at = NOW()
       WHERE id = $1`,
      [
        request.id,
        input.outcome,
        input.usage.inputTokens,
        input.usage.outputTokens,
        input.usage.cacheReadTokens,
        input.usage.cacheWriteTokens,
        charge.providerCostMicrousd,
        charge.chargedMicrousd,
        input.usage.upstreamRequestId ?? null,
        input.httpStatus ?? null,
        input.errorCode ?? null,
        input.errorMessage?.slice(0, 1_000) ?? null,
        input.latencyMs ?? null,
        input.firstTokenMs ?? null,
        JSON.stringify(input.responseSummary ?? {}),
        allowance.allowanceChargeMicrousd,
        allowance.allowanceChargedTokens,
      ],
    );

    if (transitions.overdraftMicrousd > 0) {
      await client.query(
        `UPDATE platform_users
         SET status = 'suspended', updated_at = NOW()
         WHERE id = $1 AND status = 'active'`,
        [request.platform_user_id],
      );
    }

    return {
      idempotent: false,
      requestId: request.id,
      charge,
      account: transitions.final,
      overdraftMicrousd: transitions.overdraftMicrousd,
    };
}

export async function settleGatewayRequest(input: SettleGatewayRequestInput) {
  return await withPlatformTransaction(async (client) => {
    return await settleGatewayRequestOnClient(client, input);
  });
}

export async function markGatewayRequestSettlementFailed(input: {
  gatewayRequestId: string;
  outcome: "failed" | "cancelled";
  errorCode: string;
  errorMessage: string;
  httpStatus?: number;
  latencyMs?: number;
  firstTokenMs?: number;
}) {
  return await withPlatformTransaction(async (client) => {
    const result = await client.query(
      `UPDATE gateway_requests
       SET status = 'settlement_failed', outcome = $2,
           http_status = $3, error_code = $4, error_message = $5,
           latency_ms = $6, first_token_ms = $7,
           completed_at = COALESCE(completed_at, NOW())
       WHERE id = $1 AND settled_at IS NULL
         AND status IN ('reserved', 'streaming')`,
      [
        input.gatewayRequestId,
        input.outcome,
        input.httpStatus ?? null,
        input.errorCode,
        input.errorMessage.slice(0, 1_000),
        input.latencyMs ?? null,
        input.firstTokenMs ?? null,
      ],
    );
    return { updated: result.rowCount === 1 };
  });
}
