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
             (SELECT COUNT(*)::text FROM story_workspace_stories WHERE status = 'draft') AS draft_stories,
             (SELECT COUNT(*)::text FROM story_workspace_stories WHERE status = 'published') AS published_stories,
             (SELECT COUNT(*)::text FROM story_workspace_stories WHERE status = 'archived') AS archived_stories,
             (SELECT COUNT(*)::text FROM story_workspace_stories
                WHERE review_status = 'pending') AS pending_story_reviews`,
        );
        const row = result.rows[0];
        const [recentStories, recentOperations] = await Promise.all([
          client.query<Record<string, unknown>>(
            `SELECT s.id, s.title, s.status, s.review_status, s.updated_at,
                    w.id AS workspace_id, w.name AS workspace_name,
                    u.id::text AS author_id, u.email AS author_email
             FROM story_workspace_stories s
             JOIN story_workspace_workspaces w ON w.id = s.workspace_id
             JOIN users u ON u.id = s.author_id
             ORDER BY s.updated_at DESC, s.id ASC LIMIT 5`,
          ),
          client.query<Record<string, unknown>>(
            `SELECT l.id, l.actor_id, au.email AS actor_email, l.action,
                    l.resource_type, l.resource_id, l.created_at
             FROM admin_audit_logs l
             LEFT JOIN admin_users au ON au.id = l.actor_id
             ORDER BY l.created_at DESC, l.id ASC LIMIT 5`,
          ),
        ]);
        return {
          ...controlData,
          sourceUsers: Number(row.source_users),
          storyWorkspaces: Number(row.workspaces),
          storyStories: Number(row.stories),
          draftStories: Number(row.draft_stories),
          publishedStories: Number(row.published_stories),
          archivedStories: Number(row.archived_stories),
          pendingStoryReviews: Number(row.pending_story_reviews),
          recentStories: recentStories.rows,
          recentOperations: recentOperations.rows,
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
