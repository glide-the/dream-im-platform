import type { PoolClient } from "pg";
import { AdminError } from "../admin/errors";
import {
  adminListResponse,
  buildAdminListClauses,
  parseAdminListQuery,
} from "../admin/list-query";
import { withStoryClient } from "./db";

export type StorySourceResource =
  | "source-users"
  | "story-workspaces"
  | "story-stories"
  | "story-characters"
  | "story-scenes"
  | "story-workflow-runs";

type StoryResourceConfig = {
  permission: string;
  select: string;
  from: string;
  columns: Record<string, string>;
  defaultSort: string;
  filterFields: string[];
};

const storyResources: Record<StorySourceResource, StoryResourceConfig> = {
  "source-users": {
    permission: "users.read",
    select: `u.id::text AS id, u.email, u.display_name, u.avatar_url, u.role,
             u.created_at, u.updated_at`,
    from: "FROM users AS u",
    columns: {
      id: "u.id::text",
      email: "u.email",
      display_name: "u.display_name",
      role: "u.role",
      created_at: "u.created_at",
      updated_at: "u.updated_at",
    },
    defaultSort: "created_at",
    filterFields: ["email", "display_name", "role"],
  },
  "story-workspaces": {
    permission: "story.read",
    select: `w.id, w.name, w.owner_id::text AS owner_id,
             u.email AS owner_email, u.display_name AS owner_display_name,
             w.settings, w.created_at, w.updated_at`,
    from: "FROM story_workspace_workspaces AS w JOIN users AS u ON u.id = w.owner_id",
    columns: {
      id: "w.id",
      name: "w.name",
      owner_id: "w.owner_id::text",
      owner_email: "u.email",
      created_at: "w.created_at",
      updated_at: "w.updated_at",
    },
    defaultSort: "updated_at",
    filterFields: ["name", "owner_id", "owner_email"],
  },
  "story-stories": {
    permission: "story.read",
    select: `s.id, s.identifier, s.title, s.description, s.status,
             s.review_status, s.type, s.content, s.author_id::text AS author_id,
             u.email AS author_email, s.workspace_id, w.name AS workspace_name,
             s.character_count, s.scene_count, s.agent_generated,
             s.agent_session_id, s.review_notes, s.created_at, s.updated_at,
             s.confirmed_at, s.published_at`,
    from: `FROM story_workspace_stories AS s
           JOIN users AS u ON u.id = s.author_id
           JOIN story_workspace_workspaces AS w ON w.id = s.workspace_id`,
    columns: {
      id: "s.id",
      identifier: "s.identifier",
      title: "s.title",
      status: "s.status",
      review_status: "s.review_status",
      type: "s.type",
      author_id: "s.author_id::text",
      author_email: "u.email",
      workspace_id: "s.workspace_id",
      workspace_name: "w.name",
      agent_generated: "s.agent_generated::text",
      created_at: "s.created_at",
      updated_at: "s.updated_at",
    },
    defaultSort: "updated_at",
    filterFields: [
      "identifier",
      "title",
      "status",
      "review_status",
      "type",
      "author_id",
      "author_email",
      "workspace_id",
      "workspace_name",
      "agent_generated",
    ],
  },
  "story-characters": {
    permission: "story.read",
    select: `c.id, c.identifier, c.name, c.avatar_url, c.identity,
             c.personality, c.background, c.catchphrase, c.tags, c.notes,
             c.author_id::text AS author_id, u.email AS author_email,
             c.workspace_id, w.name AS workspace_name, c.story_count,
             c.review_status, c.agent_generated, c.status, c.review_notes,
             c.confirmed_at, c.archived_at, c.created_at, c.updated_at`,
    from: `FROM story_workspace_characters AS c
           JOIN users AS u ON u.id = c.author_id
           JOIN story_workspace_workspaces AS w ON w.id = c.workspace_id`,
    columns: {
      id: "c.id",
      identifier: "c.identifier",
      name: "c.name",
      author_id: "c.author_id::text",
      author_email: "u.email",
      workspace_id: "c.workspace_id",
      workspace_name: "w.name",
      review_status: "c.review_status",
      status: "c.status",
      agent_generated: "c.agent_generated::text",
      created_at: "c.created_at",
      updated_at: "c.updated_at",
    },
    defaultSort: "updated_at",
    filterFields: [
      "identifier",
      "name",
      "author_id",
      "author_email",
      "workspace_id",
      "workspace_name",
      "review_status",
      "status",
      "agent_generated",
    ],
  },
  "story-scenes": {
    permission: "story.read",
    select: `sc.id, sc.identifier, sc.name, sc.description, sc.story_id,
             s.title AS story_title, sc.author_id::text AS author_id,
             u.email AS author_email, sc.workspace_id,
             w.name AS workspace_name, sc.character_count, sc.order_index,
             sc.review_status, sc.agent_generated, sc.status, sc.review_notes,
             sc.confirmed_at, sc.archived_at, sc.created_at, sc.updated_at`,
    from: `FROM story_workspace_scenes AS sc
           JOIN users AS u ON u.id = sc.author_id
           JOIN story_workspace_workspaces AS w ON w.id = sc.workspace_id
           LEFT JOIN story_workspace_stories AS s ON s.id = sc.story_id`,
    columns: {
      id: "sc.id",
      identifier: "sc.identifier",
      name: "sc.name",
      story_id: "sc.story_id",
      story_title: "s.title",
      author_id: "sc.author_id::text",
      author_email: "u.email",
      workspace_id: "sc.workspace_id",
      workspace_name: "w.name",
      review_status: "sc.review_status",
      status: "sc.status",
      order_index: "sc.order_index",
      agent_generated: "sc.agent_generated::text",
      created_at: "sc.created_at",
      updated_at: "sc.updated_at",
    },
    defaultSort: "updated_at",
    filterFields: [
      "identifier",
      "name",
      "story_id",
      "story_title",
      "author_id",
      "author_email",
      "workspace_id",
      "workspace_name",
      "review_status",
      "status",
      "agent_generated",
    ],
  },
  "story-workflow-runs": {
    permission: "story.read",
    select: `r.id, r.workspace_id, w.name AS workspace_name,
             r.deck_plugin_id, r.deck_plugin_version,
             r.workflow_definition_ref, r.deck_runtime_snapshot_id,
             r.status, r.failed_step, r.error_code, r.retry_of_run_id,
             r.deck_plugin_manifest_hash, r.deck_plugin_binding_id,
             r.binding_revision, r.runtime_plugin_lock_id,
             r.runtime_load_receipt_id, r.workflow_preflight_id,
             r.agent_session_id, r.source_voice_thread_id,
             r.source_message_id, r.source_message_time, r.idempotency_key,
             r.input_hash, r.semantic_fingerprint, r.status_version,
             r.created_by, r.created_at, r.started_at, r.completed_at`,
    from: `FROM workflow_runs AS r
           JOIN story_workspace_workspaces AS w ON w.id = r.workspace_id`,
    columns: {
      id: "r.id",
      workspace_id: "r.workspace_id",
      workspace_name: "w.name",
      deck_plugin_id: "r.deck_plugin_id",
      deck_plugin_version: "r.deck_plugin_version",
      workflow_definition_ref: "r.workflow_definition_ref",
      status: "r.status",
      failed_step: "r.failed_step",
      error_code: "r.error_code",
      retry_of_run_id: "r.retry_of_run_id",
      created_by: "r.created_by",
      created_at: "r.created_at",
      started_at: "r.started_at",
      completed_at: "r.completed_at",
    },
    defaultSort: "created_at",
    filterFields: [
      "workspace_id",
      "workspace_name",
      "deck_plugin_id",
      "deck_plugin_version",
      "workflow_definition_ref",
      "status",
      "failed_step",
      "error_code",
      "retry_of_run_id",
      "created_by",
    ],
  },
};

export function isStorySourceResource(
  resource: string,
): resource is StorySourceResource {
  return Object.hasOwn(storyResources, resource);
}

export function storySourcePermission(resource: StorySourceResource) {
  return storyResources[resource].permission;
}

export function storySourceError(error: unknown): AdminError {
  if (error instanceof AdminError) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";
  if (["23503", "23505", "23514"].includes(code)) {
    return new AdminError(
      "STORY_SOURCE_CONFLICT",
      "The Story change conflicts with an existing relation or constraint",
      409,
    );
  }
  if (
    [
      "3D000",
      "28P01",
      "42P01",
      "42703",
      "57P01",
      "ECONNREFUSED",
      "ECONNRESET",
      "ENETUNREACH",
      "ENOTFOUND",
      "ETIMEDOUT",
    ].includes(code) ||
    (error instanceof Error &&
      /(connection|timeout|database .* does not exist)/i.test(error.message))
  ) {
    return new AdminError(
      "STORY_SOURCE_UNAVAILABLE",
      "The Story PostgreSQL source is unavailable or its schema is not ready",
      503,
    );
  }
  return new AdminError(
    "STORY_SOURCE_ERROR",
    "The Story PostgreSQL source could not complete the request",
    500,
  );
}

async function queryList(
  client: PoolClient,
  request: Request,
  config: StoryResourceConfig,
) {
  const fields = Object.keys(config.columns);
  const query = parseAdminListQuery(request, {
    sortFields: fields,
    filterFields: config.filterFields,
    defaultSort: config.defaultSort,
  });
  const clauses = buildAdminListClauses(query, { columns: config.columns });
  const data = await client.query<Record<string, unknown>>(
    `SELECT ${config.select} ${config.from}
     ${clauses.whereSql} ${clauses.orderSql} ${clauses.pageSql}`,
    clauses.parameters,
  );
  const count = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total ${config.from} ${clauses.whereSql}`,
    clauses.parameters.slice(0, -2),
  );
  const total = Number(count.rows[0]?.total ?? 0);
  if (!Number.isSafeInteger(total)) {
    throw new AdminError(
      "STORY_SOURCE_TOTAL_INVALID",
      "The Story resource total is outside the supported range",
      500,
    );
  }
  return adminListResponse(data.rows, query, total);
}

export async function queryStorySourceList(
  request: Request,
  resource: StorySourceResource,
) {
  const config = storyResources[resource];
  try {
    return await withStoryClient(
      async (client) => await queryList(client, request, config),
    );
  } catch (error) {
    throw storySourceError(error);
  }
}

export async function queryStorySourceItem(
  resource: StorySourceResource,
  id: string,
) {
  const config = storyResources[resource];
  try {
    return await withStoryClient(async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT ${config.select} ${config.from}
         WHERE ${config.columns.id} = $1 LIMIT 1`,
        [id],
      );
      if (!result.rows[0]) {
        throw new AdminError(
          "STORY_SOURCE_ITEM_NOT_FOUND",
          `The requested ${resource} item does not exist`,
          404,
        );
      }
      return result.rows[0];
    });
  } catch (error) {
    throw storySourceError(error);
  }
}
