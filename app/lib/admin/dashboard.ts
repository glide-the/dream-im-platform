import { withPlatformClient } from "../platform-db";
import { adminErrorResponse } from "./errors";
import { adminRequestId, requireAdminRequest } from "./guard";

const STORY_TABLES = [
  "users",
  "story_workspace_workspaces",
  "story_workspace_stories",
] as const;

export async function handleAdminDashboard(request: Request) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "dashboard.read");
    const data = await withPlatformClient(async (client) => {
        const result = await client.query<Record<string, string>>(
        `SELECT
           (SELECT COUNT(*)::text FROM platform_users) AS platform_users,
           (SELECT COUNT(*)::text FROM ai_models WHERE enabled = TRUE) AS active_models,
           (SELECT COUNT(*)::text FROM gateway_requests WHERE created_at >= CURRENT_DATE) AS requests_today,
           (SELECT COALESCE(SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens), 0)::text
              FROM gateway_requests WHERE created_at >= CURRENT_DATE) AS tokens_today,
           (SELECT COALESCE(SUM(charged_microusd), 0)::text
              FROM gateway_requests WHERE created_at >= CURRENT_DATE) AS charged_today_microusd,
           (SELECT COUNT(*)::text FROM gateway_requests WHERE status = 'settlement_failed') AS settlement_failures`,
      );
        const row = result.rows[0];
        const controlData = {
          platformUsers: Number(row.platform_users),
          activeModels: Number(row.active_models),
          requestsToday: Number(row.requests_today),
          tokensToday: row.tokens_today,
          chargedTodayMicrousd: row.charged_today_microusd,
          settlementFailures: Number(row.settlement_failures),
        };

        const readiness = await client.query<Record<string, string | null>>(
          `SELECT
             to_regclass('public.users')::text AS users,
             to_regclass('public.story_workspace_workspaces')::text AS story_workspace_workspaces,
             to_regclass('public.story_workspace_stories')::text AS story_workspace_stories`,
        );
        const missingTables = STORY_TABLES.filter(
          (table) => !readiness.rows[0]?.[table],
        );
        if (missingTables.length > 0) {
          return {
            ...controlData,
            sourceUsers: null,
            storyWorkspaces: null,
            storyStories: null,
            pendingStoryReviews: null,
            storySource: {
              state: "migration_required" as const,
              missingTables,
            },
          };
        }

        try {
        const result = await client.query<Record<string, string>>(
          `SELECT
             (SELECT COUNT(*)::text FROM users) AS source_users,
             (SELECT COUNT(*)::text FROM story_workspace_workspaces) AS workspaces,
             (SELECT COUNT(*)::text FROM story_workspace_stories) AS stories,
             (SELECT COUNT(*)::text FROM story_workspace_stories
                WHERE review_status = 'pending') AS pending_story_reviews`,
        );
        const row = result.rows[0];
        return {
          ...controlData,
          sourceUsers: Number(row.source_users),
          storyWorkspaces: Number(row.workspaces),
          storyStories: Number(row.stories),
          pendingStoryReviews: Number(row.pending_story_reviews),
          storySource: {
            state: "ready" as const,
            missingTables: [],
          },
        };
        } catch {
          return {
            ...controlData,
            sourceUsers: null,
            storyWorkspaces: null,
            storyStories: null,
            pendingStoryReviews: null,
            storySource: {
              state: "migration_required" as const,
              missingTables: [...STORY_TABLES],
            },
          };
        }
      });
    return Response.json(
      { data },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
