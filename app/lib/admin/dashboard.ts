import { withPlatformClient } from "../platform-db";
import { adminErrorResponse } from "./errors";
import { adminRequestId, requireAdminRequest } from "./guard";

export async function handleAdminDashboard(request: Request) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "dashboard.read");
    const data = await withPlatformClient(async (client) => {
      const result = await client.query<Record<string, string>>(
        `SELECT
           (SELECT COUNT(*)::text FROM platform_users) AS platform_users,
           (SELECT COUNT(*)::text FROM story_projects) AS story_projects,
           (SELECT COUNT(*)::text FROM ai_models WHERE enabled = TRUE) AS active_models,
           (SELECT COUNT(*)::text FROM gateway_requests WHERE created_at >= CURRENT_DATE) AS requests_today,
           (SELECT COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::text
              FROM gateway_requests WHERE created_at >= CURRENT_DATE) AS tokens_today,
           (SELECT COALESCE(SUM(charged_microusd), 0)::text
              FROM gateway_requests WHERE created_at >= CURRENT_DATE) AS charged_today_microusd,
           (SELECT COUNT(*)::text FROM gateway_requests WHERE outcome = 'settlement_failed') AS settlement_failures`,
      );
      const row = result.rows[0];
      return {
        platformUsers: Number(row.platform_users),
        storyProjects: Number(row.story_projects),
        activeModels: Number(row.active_models),
        requestsToday: Number(row.requests_today),
        tokensToday: Number(row.tokens_today),
        chargedTodayMicrousd: row.charged_today_microusd,
        settlementFailures: Number(row.settlement_failures),
      };
    });
    return Response.json(
      { data },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
