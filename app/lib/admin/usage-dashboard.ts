import type { PoolClient } from "pg";
import { z } from "zod";
import { withPlatformClient } from "../platform-db";
import { AdminError, adminErrorResponse } from "./errors";
import { adminRequestId, requireAdminRequest } from "./guard";

const querySchema = z.strictObject({
  from: z.iso.date(),
  to: z.iso.date(),
  protocol: z.enum(["anthropic", "openai"]).optional(),
  providerId: z.string().min(1).max(100).optional(),
  modelId: z.string().min(1).max(100).optional(),
  platformUserId: z.string().min(1).max(100).optional(),
  outcome: z.string().min(1).max(80).optional(),
});

type UsageQuery = z.infer<typeof querySchema>;

function usageWhere(query: UsageQuery) {
  const values: unknown[] = [query.from, query.to];
  const clauses = [
    "r.created_at >= $1::date",
    "r.created_at < ($2::date + INTERVAL '1 day')",
  ];
  for (const [column, value] of [
    ["r.protocol", query.protocol],
    ["r.provider_id", query.providerId],
    ["r.model_id", query.modelId],
    ["r.platform_user_id", query.platformUserId],
    ["r.outcome", query.outcome],
  ] as const) {
    if (!value) continue;
    values.push(value);
    clauses.push(`${column} = $${values.length}`);
  }
  return { sql: `WHERE ${clauses.join(" AND ")}`, values };
}

async function queryUsageDashboard(client: PoolClient, query: UsageQuery) {
  const where = usageWhere(query);
  const from = new Date(`${query.from}T00:00:00.000Z`);
  const to = new Date(`${query.to}T00:00:00.000Z`);
  const days = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const bucket = days <= 2 ? "hour" : "day";
  const [summary, trend, providers, models] = await Promise.all([
    client.query<Record<string, unknown>>(
      `SELECT COUNT(*)::text AS requests,
              COUNT(*) FILTER (WHERE r.outcome = 'success' OR (r.http_status >= 200 AND r.http_status < 300))::text AS successful_requests,
              COALESCE(SUM(r.input_tokens), 0)::text AS input_tokens,
              COALESCE(SUM(r.output_tokens), 0)::text AS output_tokens,
              COALESCE(SUM(r.cache_read_tokens), 0)::text AS cache_read_tokens,
              COALESCE(SUM(r.cache_write_tokens), 0)::text AS cache_write_tokens,
              COALESCE(SUM(r.provider_cost_microusd), 0)::text AS provider_cost_microusd,
              COALESCE(SUM(r.charged_microusd), 0)::text AS charged_microusd,
              COUNT(*) FILTER (WHERE r.status = 'settlement_failed')::text AS settlement_failures,
              MAX(r.created_at) AS latest_request_at
       FROM gateway_requests r ${where.sql}`,
      where.values,
    ),
    client.query<Record<string, unknown>>(
      `SELECT date_trunc($${where.values.length + 1}, r.created_at) AS bucket,
              COUNT(*)::text AS requests,
              COALESCE(SUM(r.input_tokens), 0)::text AS input_tokens,
              COALESCE(SUM(r.output_tokens), 0)::text AS output_tokens,
              COALESCE(SUM(r.cache_read_tokens), 0)::text AS cache_read_tokens,
              COALESCE(SUM(r.cache_write_tokens), 0)::text AS cache_write_tokens,
              COALESCE(SUM(r.charged_microusd), 0)::text AS charged_microusd
       FROM gateway_requests r ${where.sql}
       GROUP BY 1 ORDER BY 1 ASC`,
      [...where.values, bucket],
    ),
    client.query<Record<string, unknown>>(
      `SELECT p.id AS provider_id, p.code AS provider_code, p.name AS provider_name,
              COUNT(*)::text AS requests,
              COUNT(*) FILTER (WHERE r.outcome = 'success' OR (r.http_status >= 200 AND r.http_status < 300))::text AS successful_requests,
              COALESCE(SUM(COALESCE(r.input_tokens, 0) + COALESCE(r.output_tokens, 0) + COALESCE(r.cache_read_tokens, 0) + COALESCE(r.cache_write_tokens, 0)), 0)::text AS tokens,
              COALESCE(SUM(r.provider_cost_microusd), 0)::text AS provider_cost_microusd,
              COALESCE(SUM(r.charged_microusd), 0)::text AS charged_microusd,
              COALESCE(AVG(r.latency_ms) FILTER (WHERE r.latency_ms IS NOT NULL), 0)::text AS average_latency_ms
       FROM gateway_requests r JOIN ai_providers p ON p.id = r.provider_id
       ${where.sql} GROUP BY p.id, p.code, p.name ORDER BY COUNT(*) DESC, p.code ASC`,
      where.values,
    ),
    client.query<Record<string, unknown>>(
      `SELECT m.id AS model_id, m.code AS model_code, m.display_name,
              p.code AS provider_code, COUNT(*)::text AS requests,
              COUNT(*) FILTER (WHERE r.outcome = 'success' OR (r.http_status >= 200 AND r.http_status < 300))::text AS successful_requests,
              COALESCE(SUM(COALESCE(r.input_tokens, 0) + COALESCE(r.output_tokens, 0) + COALESCE(r.cache_read_tokens, 0) + COALESCE(r.cache_write_tokens, 0)), 0)::text AS tokens,
              COALESCE(SUM(r.provider_cost_microusd), 0)::text AS provider_cost_microusd,
              COALESCE(SUM(r.charged_microusd), 0)::text AS charged_microusd
       FROM gateway_requests r
       JOIN ai_models m ON m.id = r.model_id
       JOIN ai_providers p ON p.id = r.provider_id
       ${where.sql} GROUP BY m.id, m.code, m.display_name, p.code
       ORDER BY COUNT(*) DESC, m.code ASC`,
      where.values,
    ),
  ]);
  return {
    summary: summary.rows[0] ?? {},
    trend: trend.rows,
    providerStats: providers.rows,
    modelStats: models.rows,
    meta: {
      ...query,
      bucket,
      timezone: "UTC",
      generatedAt: new Date().toISOString(),
    },
  };
}

export async function handleAdminUsageDashboard(request: Request) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "billing.read");
    const url = new URL(request.url);
    const today = new Date();
    const defaultTo = today.toISOString().slice(0, 10);
    const defaultFrom = new Date(today.getTime() - 6 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const raw = Object.fromEntries(
      ["from", "to", "protocol", "providerId", "modelId", "platformUserId", "outcome"]
        .map((key) => [key, url.searchParams.get(key) || undefined]),
    );
    raw.from ??= defaultFrom;
    raw.to ??= defaultTo;
    const parsed = querySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AdminError(
        "USAGE_DASHBOARD_QUERY_INVALID",
        "Usage dashboard filters are invalid",
        400,
        parsed.error.issues,
      );
    }
    const days =
      Math.floor(
        (new Date(`${parsed.data.to}T00:00:00.000Z`).getTime() -
          new Date(`${parsed.data.from}T00:00:00.000Z`).getTime()) /
          86_400_000,
      ) + 1;
    if (days < 1 || days > 366) {
      throw new AdminError(
        "USAGE_DASHBOARD_RANGE_INVALID",
        "Usage range must be between 1 and 366 days",
        400,
      );
    }
    const data = await withPlatformClient((client) =>
      queryUsageDashboard(client, parsed.data),
    );
    return Response.json(
      { data },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
