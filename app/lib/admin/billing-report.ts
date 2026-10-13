// [Sync] 2026-10-10: include Responses image requests with unknown complete usage after conservative settlement.
// [Input] Permission-checked daily Gateway report filters and persisted usage facts.
// [Output] Known usage/amount subtotals plus explicit unknown Image request counts.
// [Pos] Read-only Admin billing report; no ledger or request mutation.
// [Sync] 2026-10-10: prevent unknown Image usage from appearing as a complete zero-cost total.
// [Sync] 2026-10-10: align daily dates and range boundaries with explicit UTC usage queries.
import { z } from "zod";
import { withPlatformClient } from "../platform-db";
import { AdminError, adminErrorResponse } from "./errors";
import { adminRequestId, requireAdminRequest } from "./guard";

const dateSchema = z.iso.date();

export async function handleAdminBillingReport(request: Request) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "billing.read");
    const params = new URL(request.url).searchParams;
    const today = new Date();
    const defaultTo = today.toISOString().slice(0, 10);
    const defaultFrom = new Date(today.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
    const parsed = z.strictObject({ from: dateSchema, to: dateSchema }).safeParse({ from: params.get("from") ?? defaultFrom, to: params.get("to") ?? defaultTo });
    if (!parsed.success) throw new AdminError("BILLING_REPORT_RANGE_INVALID", "from and to must be ISO dates", 400, parsed.error.issues);
    const from = new Date(`${parsed.data.from}T00:00:00.000Z`);
    const to = new Date(`${parsed.data.to}T00:00:00.000Z`);
    const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days < 1 || days > 366) throw new AdminError("BILLING_REPORT_RANGE_INVALID", "The report range must be between 1 and 366 days", 400);

    const rows = await withPlatformClient(async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day,
                COUNT(*)::text AS requests,
                COUNT(*) FILTER (WHERE response_summary ->> 'usageKnown' = 'false')::text AS unknown_usage_requests,
                COALESCE(SUM(input_tokens) FILTER (WHERE NOT COALESCE(response_summary ->> 'usageKnown' = 'false', false)), 0)::text AS input_tokens,
                COALESCE(SUM(output_tokens) FILTER (WHERE NOT COALESCE(response_summary ->> 'usageKnown' = 'false', false)), 0)::text AS output_tokens,
                COALESCE(SUM(cache_read_tokens) FILTER (WHERE NOT COALESCE(response_summary ->> 'usageKnown' = 'false', false)), 0)::text AS cache_read_tokens,
                COALESCE(SUM(cache_write_tokens) FILTER (WHERE NOT COALESCE(response_summary ->> 'usageKnown' = 'false', false)), 0)::text AS cache_write_tokens,
                COALESCE(SUM(provider_cost_microusd) FILTER (WHERE NOT COALESCE(response_summary ->> 'usageKnown' = 'false', false)), 0)::text AS provider_cost_microusd,
                COALESCE(SUM(charged_microusd) FILTER (WHERE NOT COALESCE(response_summary ->> 'usageKnown' = 'false', false)), 0)::text AS charged_microusd,
                COUNT(*) FILTER (WHERE status = 'settlement_failed')::text AS settlement_failures
         FROM gateway_requests
         WHERE created_at >= ($1::date::timestamp AT TIME ZONE 'UTC')
           AND created_at < (($2::date + 1)::timestamp AT TIME ZONE 'UTC')
         GROUP BY (created_at AT TIME ZONE 'UTC')::date
         ORDER BY (created_at AT TIME ZONE 'UTC')::date DESC`,
        [parsed.data.from, parsed.data.to],
      );
      return result.rows;
    });
    return Response.json({ data: rows, meta: { from: parsed.data.from, to: parsed.data.to, days, timezone: "UTC", amounts: "micro-USD", totals: "known_usage_subtotal" } }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
