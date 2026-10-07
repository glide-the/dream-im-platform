// [Input] Admin Session, models.read/gateway.read and strict bounded health query.
// [Output] Safe same-model observed success, per-attempt Provider health and latency percentiles.
// [Pos] Read-only PostgreSQL aggregation; no probes, credentials, routing or ledger writes.
import { routingHealthPolicy, routingHealthWindows } from "../../../config/routing-health-policy";
import { routingConfigSchema } from "../models/routing-policy";
import { routingHealthModelIdSchema, routingHealthQuerySchema, type RoutingHealthData } from "../models/routing-health-contract";
import { withPlatformClient } from "../platform-db";
import { AdminError, adminErrorResponse } from "./errors";
import { adminRequestId, requireAdminRequest } from "./guard";

// All fragments are static application expressions; external values remain SQL parameters.
const success = "r.status = 'settled' AND r.outcome = 'succeeded'";
function performance(column: string, eligible: string) {
  const valid = `${eligible} AND ${column} IS NOT NULL AND ${column} >= 0`;
  return `jsonb_build_object('samples', COUNT(*) FILTER (WHERE ${valid}),
    'p50Ms', percentile_cont(0.5) WITHIN GROUP (ORDER BY ${column}) FILTER (WHERE ${valid}),
    'p95Ms', percentile_cont(0.95) WITHIN GROUP (ORDER BY ${column}) FILTER (WHERE ${valid}))`;
}
const requestCounts = `jsonb_build_object(
  'requests', COUNT(*), 'succeeded', COUNT(*) FILTER (WHERE ${success}),
  'failed', COUNT(*) FILTER (WHERE r.outcome = 'failed'),
  'cancelled', COUNT(*) FILTER (WHERE r.outcome = 'cancelled'),
  'pending', COUNT(*) FILTER (WHERE r.outcome NOT IN ('failed','cancelled') AND NOT (${success})),
  'successRate', ROUND(100.0 * COUNT(*) FILTER (WHERE ${success}) / NULLIF(COUNT(*) FILTER (WHERE (${success}) OR r.outcome = 'failed'), 0), 2),
  'latency', ${performance("r.latency_ms", success)},
  'firstToken', ${performance("r.first_token_ms", `(${success}) AND r.is_streaming`)})`;

export async function handleRoutingHealth(request: Request, modelId: string) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "models.read");
    await requireAdminRequest(request, "gateway.read");
    const params = new URL(request.url).searchParams;
    const parsed = routingHealthQuerySchema.safeParse(Object.fromEntries(params));
    if (!routingHealthModelIdSchema.safeParse(modelId).success || !parsed.success || new Set(params.keys()).size !== [...params].length) {
      throw new AdminError("ROUTING_HEALTH_QUERY_INVALID", "请检查统计范围和分页参数", 400);
    }
    const query = parsed.data;
    const hours = routingHealthWindows.find(option => option.value === query.window)!.hours;
    const data = await withPlatformClient(async client => {
      const row = (await client.query<{
        id: string; code: string; display_name: string; provider_id: string; upstream_model: string;
        status: RoutingHealthData["policy"]["status"]; revision: number; effective: unknown; observed_at: Date;
      }>(`SELECT m.id, m.code, m.display_name, m.provider_id, m.upstream_model,
        p.status, p.revision, p.effective, NOW() AS observed_at
        FROM ai_model_route_policies p JOIN ai_models m ON m.id = p.model_id WHERE m.id = $1`, [modelId])).rows[0];
      if (!row) throw new AdminError("ROUTING_POLICY_NOT_FOUND", "路由策略不存在", 404);
      const effective = row.effective === null ? null : routingConfigSchema.parse(row.effective);
      const targets = effective?.targets ?? [{ providerId: row.provider_id, upstreamModel: row.upstream_model, weight: 1 }];
      const to = row.observed_at.toISOString();
      const from = new Date(row.observed_at.getTime() - hours * 3600_000).toISOString();
      const result = (await client.query<{
        summary: RoutingHealthData["summary"]; timeline: RoutingHealthData["timeline"];
        providers: RoutingHealthData["providers"]; current_targets: RoutingHealthData["currentTargets"]; provider_total: number;
      }>(`WITH scoped AS MATERIALIZED (
        SELECT r.*, date_bin(make_interval(secs => $4), r.created_at, $2::timestamptz) AS bucket
        FROM gateway_requests r WHERE r.model_id = $1 AND r.created_at >= $2::timestamptz AND r.created_at < $3::timestamptz
        AND (jsonb_array_length(r.routing_attempts) > 0 OR (r.routing_snapshot IS NULL AND r.started_at IS NOT NULL))
      ), attempts AS (
        SELECT r.provider_id AS final_provider_id, r.resolved_model, r.latency_ms, r.first_token_ms,
          r.is_streaming, r.status AS request_status, r.outcome, r.created_at,
          a.value->>'providerId' AS provider_id, a.value->>'upstreamModel' AS upstream_model, a.value->>'status' AS status
        FROM scoped r CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_array_length(r.routing_attempts) > 0 THEN r.routing_attempts
          ELSE jsonb_build_array(jsonb_build_object('providerId', r.provider_id, 'upstreamModel', r.resolved_model,
            'status', CASE WHEN ${success} THEN 'succeeded' WHEN r.outcome = 'failed' THEN 'failed' WHEN r.outcome = 'cancelled' THEN 'cancelled' ELSE 'started' END)) END) a
      ), current_targets AS (
        SELECT t->>'providerId' AS provider_id, t->>'upstreamModel' AS upstream_model, ord
        FROM jsonb_array_elements($5::jsonb) WITH ORDINALITY AS x(t, ord)
      ), provider_keys AS (
        SELECT provider_id, upstream_model FROM attempts UNION SELECT provider_id, upstream_model FROM current_targets
      ), provider_stats AS (
        SELECT k.provider_id, k.upstream_model, COALESCE(p.name, k.provider_id) AS name, COALESCE(p.status, 'deleted') AS provider_status,
          EXISTS(SELECT 1 FROM current_targets t WHERE t.provider_id = k.provider_id AND t.upstream_model = k.upstream_model) AS current,
          jsonb_build_object('requests', COUNT(a.provider_id), 'succeeded', COUNT(*) FILTER (WHERE a.status = 'succeeded'),
            'failed', COUNT(*) FILTER (WHERE a.status = 'failed'), 'cancelled', COUNT(*) FILTER (WHERE a.status = 'cancelled'),
            'pending', COUNT(*) FILTER (WHERE a.status IS NOT NULL AND a.status NOT IN ('succeeded','failed','cancelled')),
            'successRate', ROUND(100.0 * COUNT(*) FILTER (WHERE a.status = 'succeeded') / NULLIF(COUNT(*) FILTER (WHERE a.status IN ('succeeded','failed')), 0), 2),
            'lastObservedAt', MAX(a.created_at),
            'latency', ${performance("a.latency_ms", "a.status = 'succeeded' AND a.request_status = 'settled' AND a.outcome = 'succeeded' AND a.final_provider_id = k.provider_id AND a.resolved_model = k.upstream_model")},
            'firstToken', ${performance("a.first_token_ms", "a.status = 'succeeded' AND a.request_status = 'settled' AND a.outcome = 'succeeded' AND a.is_streaming AND a.final_provider_id = k.provider_id AND a.resolved_model = k.upstream_model")}) AS stats
        FROM provider_keys k LEFT JOIN ai_providers p ON p.id = k.provider_id
        LEFT JOIN attempts a ON a.provider_id = k.provider_id AND a.upstream_model = k.upstream_model
        GROUP BY k.provider_id, k.upstream_model, p.name, p.status
      ), trend AS (
        SELECT r.bucket, ${requestCounts} AS counts FROM scoped r GROUP BY r.bucket
      ), buckets AS (
        SELECT at FROM generate_series($2::timestamptz, $3::timestamptz - INTERVAL '1 microsecond', make_interval(secs => $4)) AS at
      ) SELECT
        (SELECT ${requestCounts} || jsonb_build_object('recovered', COUNT(*) FILTER (WHERE (${success}) AND jsonb_array_length(r.routing_attempts) > 1),
          'lastObservedAt', MAX(r.created_at)) FROM scoped r) AS summary,
        (SELECT jsonb_agg(jsonb_build_object('at', b.at) || COALESCE(t.counts,
          '{"requests":0,"succeeded":0,"failed":0,"cancelled":0,"pending":0,"successRate":null,"latency":{"samples":0,"p50Ms":null,"p95Ms":null},"firstToken":{"samples":0,"p50Ms":null,"p95Ms":null}}'::jsonb) ORDER BY b.at)
          FROM buckets b LEFT JOIN trend t ON t.bucket = b.at) AS timeline,
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('providerId', s.provider_id, 'upstreamModel', s.upstream_model,
          'providerName', s.name, 'providerStatus', s.provider_status, 'current', s.current) || s.stats ORDER BY s.current DESC, s.name, s.provider_id, s.upstream_model), '[]'::jsonb)
          FROM (SELECT * FROM provider_stats ORDER BY current DESC, name, provider_id, upstream_model LIMIT $6 OFFSET $7) s) AS providers,
        (SELECT COUNT(*)::int FROM provider_stats) AS provider_total,
        (SELECT jsonb_agg(jsonb_build_object('providerId', t.provider_id, 'providerName', COALESCE(p.name, t.provider_id),
          'upstreamModel', t.upstream_model, 'providerStatus', COALESCE(p.status, 'deleted')) ORDER BY t.ord)
          FROM current_targets t LEFT JOIN ai_providers p ON p.id = t.provider_id) AS current_targets`,
      [modelId, from, to, routingHealthPolicy.bucketSeconds, JSON.stringify(targets), routingHealthPolicy.providerPageSize,
        (query.providerPage - 1) * routingHealthPolicy.providerPageSize])).rows[0];
      return { model: { id: row.id, code: row.code, displayName: row.display_name },
        policy: { status: row.status, revision: row.revision, effective }, currentTargets: result.current_targets,
        summary: result.summary, timeline: result.timeline, providers: result.providers,
        meta: { ...query, from, to, generatedAt: to, bucketSeconds: routingHealthPolicy.bucketSeconds,
          providerPageSize: routingHealthPolicy.providerPageSize, providerTotal: result.provider_total } } satisfies RoutingHealthData;
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) { return adminErrorResponse(error, requestId); }
}
