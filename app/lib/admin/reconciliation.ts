import { z } from "zod";
import { settleGatewayRequestOnClient } from "../billing/repository";
import type { InputTokenSemantics } from "../billing/types";
import { withPlatformTransaction } from "../platform-db";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError, adminErrorResponse } from "./errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "./guard";

const reconciliationSchema = z
  .strictObject({
    mode: z.enum(["release_unbilled", "settle_known_usage"]),
    confirmation: z.string(),
    reason: z.string().trim().min(12).max(1_000),
    inputTokens: z.number().int().nonnegative().default(0),
    outputTokens: z.number().int().nonnegative().default(0),
    cacheReadTokens: z.number().int().nonnegative().default(0),
    cacheWriteTokens: z.number().int().nonnegative().default(0),
  })
  .superRefine((value, context) => {
    const expected =
      value.mode === "release_unbilled"
        ? "RELEASE_UNBILLED"
        : "SETTLE_KNOWN_USAGE";
    if (value.confirmation !== expected) {
      context.addIssue({
        code: "custom",
        path: ["confirmation"],
        message: `confirmation must equal ${expected}`,
      });
    }
    if (
      value.mode === "settle_known_usage" &&
      value.inputTokens +
        value.outputTokens +
        value.cacheReadTokens +
        value.cacheWriteTokens ===
        0
    ) {
      context.addIssue({
        code: "custom",
        path: ["inputTokens"],
        message: "Known-usage settlement requires at least one token",
      });
    }
  });

type ReconciliationRequestRow = {
  id: string;
  status: string;
  outcome: string;
  input_token_semantics: InputTokenSemantics;
  reserved_microusd: string | number;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  latency_ms: number | null;
  first_token_ms: number | null;
};

export async function handleGatewayRequestReconciliation(
  request: Request,
  gatewayRequestId: string,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "billing.adjust");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AdminError(
        "ADMIN_JSON_INVALID",
        "The request body must contain valid JSON",
        400,
      );
    }
    const parsed = reconciliationSchema.safeParse(body);
    if (!parsed.success) {
      throw new AdminError(
        "ADMIN_RECONCILIATION_INVALID",
        "The reconciliation input or confirmation is invalid",
        400,
        parsed.error.issues.slice(0, 5),
      );
    }

    const data = await withPlatformTransaction(async (client) => {
      const beforeResult = await client.query<ReconciliationRequestRow>(
        `SELECT id, status, outcome, input_token_semantics,
                reserved_microusd, http_status, error_code, error_message,
                latency_ms, first_token_ms
         FROM gateway_requests
         WHERE id = $1
         FOR UPDATE`,
        [gatewayRequestId],
      );
      const before = beforeResult.rows[0];
      if (!before) {
        throw new AdminError(
          "ADMIN_RESOURCE_ITEM_NOT_FOUND",
          "The Gateway request does not exist",
          404,
        );
      }
      if (before.status !== "settlement_failed") {
        throw new AdminError(
          "ADMIN_RECONCILIATION_STATE_INVALID",
          "Only settlement_failed requests can be reconciled manually",
          409,
        );
      }
      if (before.outcome !== "failed" && before.outcome !== "cancelled") {
        throw new AdminError(
          "ADMIN_RECONCILIATION_OUTCOME_INVALID",
          "The request outcome cannot be reconciled manually",
          409,
        );
      }
      if (
        before.input_token_semantics !== "fresh" &&
        before.input_token_semantics !== "total_including_cache"
      ) {
        throw new AdminError(
          "ADMIN_RECONCILIATION_USAGE_INVALID",
          "The request token semantics cannot be reconciled safely",
          409,
        );
      }

      const usage = {
        inputTokens:
          parsed.data.mode === "release_unbilled"
            ? 0
            : parsed.data.inputTokens,
        outputTokens:
          parsed.data.mode === "release_unbilled"
            ? 0
            : parsed.data.outputTokens,
        cacheReadTokens:
          parsed.data.mode === "release_unbilled"
            ? 0
            : parsed.data.cacheReadTokens,
        cacheWriteTokens:
          parsed.data.mode === "release_unbilled"
            ? 0
            : parsed.data.cacheWriteTokens,
        inputTokenSemantics: before.input_token_semantics,
      };
      const settled = await settleGatewayRequestOnClient(client, {
        gatewayRequestId,
        usage,
        outcome: before.outcome,
        httpStatus: before.http_status ?? undefined,
        errorCode: before.error_code ?? undefined,
        errorMessage: before.error_message ?? undefined,
        latencyMs: before.latency_ms ?? undefined,
        firstTokenMs: before.first_token_ms ?? undefined,
        responseSummary: {
          reconciliationMode: parsed.data.mode,
          reconciledBy: identity.id,
        },
        actorType: "admin",
        actorId: identity.id,
        settlementDescription: `Manual reconciliation: ${parsed.data.reason}`,
      });
      await recordAdminAuditOnClient(client, {
        identity,
        action: "reconcile",
        resourceType: "gateway-request",
        resourceId: gatewayRequestId,
        requestId,
        request,
        before: {
          status: before.status,
          outcome: before.outcome,
          reservedMicrousd: before.reserved_microusd,
        },
        after: {
          status: "settled",
          mode: parsed.data.mode,
          usage,
          chargedMicrousd:
            "charge" in settled ? settled.charge.chargedMicrousd : undefined,
        },
        metadata: { reason: parsed.data.reason },
      });
      return settled;
    });

    return Response.json(
      { data },
      {
        headers: {
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
