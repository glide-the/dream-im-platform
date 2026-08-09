import { createHash } from "node:crypto";
import { AdminError } from "../admin/errors";
import { withPlatformTransaction } from "../platform-db";
import {
  activateSubscriptionOnClient,
  transitionSubscriptionOnClient,
} from "../subscriptions/service";
import { ProductError } from "./errors";
import type { ProductPreviewReceipt } from "./receipts";
import type { ProductAction } from "./types";

export type ProductCommandPortInput = {
  requestId: string;
  canonicalUserId: string;
  platformUserId: string;
  clientId: string;
  tokenId: string;
  action: ProductAction;
  targetPlanVersionId?: string;
  expectedVersion: number | null;
  idempotencyKey: string;
  reason: string;
  receipt: ProductPreviewReceipt;
};

export type ProductCommandPortResult = {
  subscriptionId: string;
  idempotentReplay: boolean;
  /**
   * The immutable `after` snapshot attached to the original Subscription
   * Event. An adapter must return this original snapshot on replay rather than
   * re-reading a newer subscription row.
   */
  originalSnapshot: Readonly<Record<string, unknown>>;
};

export type ProductCommandPort = {
  execute(input: ProductCommandPortInput): Promise<ProductCommandPortResult>;
};

function subscriptionIdempotencyKey(input: ProductCommandPortInput) {
  const digest = createHash("sha256")
    .update(input.idempotencyKey)
    .digest("base64url");
  return `product:${input.canonicalUserId}:${digest}`;
}

function safeAdminDetails(error: AdminError) {
  if (!error.details || typeof error.details !== "object") return undefined;
  const source = error.details as Record<string, unknown>;
  const details: Record<string, unknown> = {};
  for (const key of ["expectedVersion", "actualVersion", "periodEnd", "status"]) {
    const value = source[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      details[key] = value;
    }
  }
  return Object.keys(details).length ? details : undefined;
}

function productCommandError(error: unknown) {
  if (!(error instanceof AdminError)) {
    const postgres = error as { code?: string };
    if (["23503", "23505", "23514"].includes(postgres?.code ?? "")) {
      return new ProductError(
        "SUBSCRIPTION_STATE_CONFLICT",
        "The subscription command conflicts with the current state",
        409,
      );
    }
    return error;
  }
  const code = error.code.includes("IDEMPOTENCY")
    ? "IDEMPOTENCY_CONFLICT"
    : error.code.includes("VERSION_CONFLICT")
      ? "VERSION_CONFLICT"
      : error.code.includes("VERSION_NOT") || error.code.includes("TARGET")
        ? "PLAN_NOT_FOUND"
        : error.code.includes("NOT_FOUND")
          ? "SUBSCRIPTION_NOT_FOUND"
          : error.status === 403
            ? "SUBSCRIPTION_ACTION_FORBIDDEN"
            : "SUBSCRIPTION_STATE_CONFLICT";
  return new ProductError(
    code,
    error.message,
    [400, 403, 404, 409].includes(error.status) ? error.status : 503,
    safeAdminDetails(error),
  );
}

export const productCommandPort: ProductCommandPort = {
  async execute(input) {
    try {
      return await withPlatformTransaction(async (client) => {
        const projection = await client.query<{
          canonical_user_id: string;
          platform_user_id: string;
          platform_status: string;
        }>(
          `SELECT canonical_user.id::text AS canonical_user_id,
                  platform_user.id AS platform_user_id,
                  platform_user.status AS platform_status
           FROM users AS canonical_user
           JOIN platform_users AS platform_user
             ON platform_user.source = 'ink-dream'
            AND platform_user.external_user_id = canonical_user.id::text
           WHERE canonical_user.id = $1::bigint
             AND platform_user.id = $2
           FOR UPDATE OF canonical_user, platform_user`,
          [input.canonicalUserId, input.platformUserId],
        );
        const identity = projection.rows[0];
        if (
          !identity ||
          identity.canonical_user_id !== input.canonicalUserId ||
          identity.platform_user_id !== input.platformUserId ||
          identity.platform_status !== "active"
        ) {
          throw new ProductError(
            "CANONICAL_USER_REQUIRED",
            "The authenticated canonical user has no active platform projection",
            403,
          );
        }

        const idempotencyKey = subscriptionIdempotencyKey(input);
        const actor = {
          type: "product_user" as const,
          id: input.canonicalUserId,
        };
        if (input.action === "create") {
          if (input.expectedVersion !== null || !input.targetPlanVersionId) {
            throw new ProductError(
              "PRODUCT_INPUT_INVALID",
              "Create requires a target and no existing subscription version",
              400,
            );
          }
          const result = await activateSubscriptionOnClient(client, {
            platformUserId: input.platformUserId,
            planVersionId: input.targetPlanVersionId,
            startInTrial: true,
            idempotencyKey,
            reason: input.reason,
            actor,
          });
          if (!result.originalAfter) {
            throw new ProductError(
              "PRODUCT_COMMAND_RECEIPT_UNAVAILABLE",
              "The original command receipt is unavailable",
              503,
            );
          }
          return {
            subscriptionId: result.id,
            idempotentReplay: result.action === "idempotent",
            originalSnapshot: result.originalAfter,
          };
        }

        if (
          input.expectedVersion === null ||
          !Number.isInteger(input.expectedVersion) ||
          input.expectedVersion < 1
        ) {
          throw new ProductError(
            "PRODUCT_INPUT_INVALID",
            "expectedVersion is required for this command",
            400,
          );
        }
        const subscription = await client.query<{ id: string }>(
          `SELECT id
           FROM subscriptions
           WHERE platform_user_id = $1
             AND status IN (
               'trial', 'active', 'past_due', 'paused', 'cancel_at_period_end'
             )
           ORDER BY created_at DESC, id DESC
           LIMIT 1
           FOR UPDATE`,
          [input.platformUserId],
        );
        const subscriptionId = subscription.rows[0]?.id;
        if (!subscriptionId) {
          throw new ProductError(
            "SUBSCRIPTION_NOT_FOUND",
            "The authenticated user has no current subscription",
            404,
          );
        }
        const result = await transitionSubscriptionOnClient(client, {
          id: subscriptionId,
          platformUserId: input.platformUserId,
          action: input.action,
          actor,
          idempotencyKey,
          reason: input.reason,
          expectedVersion: input.expectedVersion,
          planVersionId: input.targetPlanVersionId,
        });
        if (!result.originalAfter) {
          throw new ProductError(
            "PRODUCT_COMMAND_RECEIPT_UNAVAILABLE",
            "The original command receipt is unavailable",
            503,
          );
        }
        return {
          subscriptionId: result.subscriptionId,
          idempotentReplay: result.idempotent,
          originalSnapshot: result.originalAfter,
        };
      });
    } catch (error) {
      throw productCommandError(error);
    }
  },
};
