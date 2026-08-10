import type { PoolClient } from "pg";
import { z } from "zod";
import { recordAdminAuditOnClient } from "../admin/audit";
import { AdminError, adminErrorResponse } from "../admin/errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "../admin/guard";
import { withStoryTransaction } from "./db";
import {
  isStorySourceResource,
  queryStorySourceItem,
  storySourceError,
  storySourcePermission,
  type StorySourceResource,
} from "./repository";

const nonEmptyPatch = <T extends z.ZodRawShape>(shape: T) =>
  z
    .strictObject(shape)
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field must be provided",
    });

const workspacePatchSchema = nonEmptyPatch({
  name: z.string().trim().min(1).max(180).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
const characterPatchSchema = nonEmptyPatch({
  name: z.string().trim().min(1).max(180).optional(),
  identity: z.string().trim().max(20_000).nullable().optional(),
  personality: z.string().trim().max(20_000).nullable().optional(),
  background: z.string().trim().max(20_000).nullable().optional(),
  catchphrase: z.string().trim().max(4_000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  avatarUrl: z.url().max(2_000).nullable().optional(),
});
const scenePatchSchema = nonEmptyPatch({
  name: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(20_000).nullable().optional(),
  storyId: z.string().trim().min(1).max(200).nullable().optional(),
  orderIndex: z.number().int().nonnegative().optional(),
});
const reviewActionSchema = z.strictObject({
  reviewNotes: z.string().trim().min(1).max(2_000).optional(),
  expectedScriptRevision: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .optional(),
});

type PatchConfig = {
  table: string;
  permission: string;
  safeSelect?: string;
  schema: z.ZodType<Record<string, unknown>>;
  fields: Record<string, { column: string; json?: boolean }>;
};

const patchConfigs: Partial<Record<StorySourceResource, PatchConfig>> = {
  "story-workspaces": {
    table: "story_workspace_workspaces",
    permission: "story.write",
    schema: workspacePatchSchema,
    fields: {
      name: { column: "name" },
      settings: { column: "settings", json: true },
    },
  },
  "story-characters": {
    table: "story_workspace_characters",
    permission: "story.write",
    schema: characterPatchSchema,
    fields: {
      name: { column: "name" },
      identity: { column: "identity" },
      personality: { column: "personality" },
      background: { column: "background" },
      catchphrase: { column: "catchphrase" },
      tags: { column: "tags", json: true },
      avatarUrl: { column: "avatar_url" },
    },
  },
  "story-scenes": {
    table: "story_workspace_scenes",
    permission: "story.write",
    schema: scenePatchSchema,
    fields: {
      name: { column: "name" },
      description: { column: "description" },
      storyId: { column: "story_id" },
      orderIndex: { column: "order_index" },
    },
  },
};

async function parseBody<T extends z.ZodTypeAny>(request: Request, schema: T) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AdminError(
      "STORY_SOURCE_JSON_INVALID",
      "The request body must contain valid JSON",
      400,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AdminError(
      "STORY_SOURCE_INPUT_INVALID",
      "The Story resource input is invalid",
      400,
      parsed.error.issues.slice(0, 5),
    );
  }
  return parsed.data;
}

async function loadRowForUpdate(
  client: PoolClient,
  table: string,
  id: string,
  safeSelect = "*",
) {
  const result = await client.query<Record<string, unknown>>(
    `SELECT ${safeSelect} FROM ${table} WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!result.rows[0]) {
    throw new AdminError(
      "STORY_SOURCE_ITEM_NOT_FOUND",
      "The requested Story item does not exist",
      404,
    );
  }
  return result.rows[0];
}

async function updateSourceRow(
  client: PoolClient,
  id: string,
  input: Record<string, unknown>,
  config: PatchConfig,
) {
  const before = await loadRowForUpdate(
    client,
    config.table,
    id,
    config.safeSelect,
  );
  if (config.table === "story_workspace_scenes" && input.storyId) {
    const parent = await client.query(
      `SELECT 1 FROM story_workspace_stories
       WHERE id = $1 AND author_id = $2 AND workspace_id = $3 LIMIT 1`,
      [input.storyId, before.author_id, before.workspace_id],
    );
    if (!parent.rows[0]) {
      throw new AdminError(
        "STORY_SOURCE_PARENT_CONFLICT",
        "The target story must belong to the same author and workspace",
        409,
      );
    }
  }

  const entries = Object.entries(input);
  const values = entries.map(([key, value]) =>
    config.fields[key]?.json ? JSON.stringify(value) : value,
  );
  const assignments = entries.map(([key], index) => {
    const field = config.fields[key];
    if (!field) {
      throw new AdminError(
        "STORY_SOURCE_FIELD_INVALID",
        `Field ${key} is not writable`,
        400,
      );
    }
    return `${field.column} = $${index + 2}${field.json ? "::jsonb" : ""}`;
  });
  await client.query(
    `UPDATE ${config.table}
     SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id, ...values],
  );
  const after = await loadRowForUpdate(
    client,
    config.table,
    id,
    config.safeSelect,
  );
  return { before, after };
}

async function auditSourceMutation(client: PoolClient, input: {
  request: Request;
  requestId: string;
  identity: Awaited<ReturnType<typeof requireAdminRequest>>;
  action: string;
  resource: string;
  id: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  await recordAdminAuditOnClient(client, {
    identity: input.identity,
    action: input.action,
    resourceType: input.resource,
    resourceId: input.id,
    requestId: input.requestId,
    request: input.request,
    before: input.before,
    after: input.after,
    metadata: { dataSource: "single-postgresql" },
  });
}

export async function handleStorySourceUpdate(
  request: Request,
  resource: StorySourceResource,
  id: string,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const config = patchConfigs[resource];
    if (!config) {
      throw new AdminError(
        "STORY_SOURCE_UPDATE_DENIED",
        "This Story source resource is read-only in the control plane",
        405,
      );
    }
    const identity = await requireAdminRequest(request, config.permission);
    const input = await parseBody(request, config.schema);
    await withStoryTransaction(async (client) => {
      const changed = await updateSourceRow(client, id, input, config);
      await auditSourceMutation(client, {
        request,
        requestId,
        identity,
        action: "update",
        resource,
        id,
        ...changed,
      });
    });
    const data = await queryStorySourceItem(resource, id);
    return Response.json(
      { data },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(storySourceError(error), requestId);
  }
}

export async function handleStorySourceCreate(
  request: Request,
  resource: StorySourceResource,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    await requireAdminRequest(request, storySourcePermission(resource));
    throw new AdminError(
      "STORY_SOURCE_CREATE_DENIED",
      "This Story resource is created by the product workflow, not by Admin",
      405,
    );
  } catch (error) {
    return adminErrorResponse(storySourceError(error), requestId);
  }
}

export async function handleStorySourceDelete(
  request: Request,
  resource: StorySourceResource,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    await requireAdminRequest(request, storySourcePermission(resource));
    throw new AdminError(
      "STORY_SOURCE_DELETE_DENIED",
      "Story source records cannot be hard-deleted from Admin",
      405,
    );
  } catch (error) {
    return adminErrorResponse(storySourceError(error), requestId);
  }
}

function actionTable(resource: StorySourceResource) {
  const tables = {
    "story-stories": "story_workspace_stories",
    stories: "story_workspace_stories",
    "story-characters": "story_workspace_characters",
    "story-scenes": "story_workspace_scenes",
  } as const;
  return tables[resource as keyof typeof tables];
}

async function transitionReview(
  client: PoolClient,
  resource: StorySourceResource,
  id: string,
  action: "confirm" | "reject" | "archive",
  reviewNotes?: string,
  expectedScriptRevision?: string,
) {
  const table = actionTable(resource);
  if (!table) {
    throw new AdminError(
      "STORY_SOURCE_ACTION_DENIED",
      "This Story source resource does not support review transitions",
      405,
    );
  }
  const isStory = resource === "story-stories" || resource === "stories";
  const before = await loadRowForUpdate(
    client,
    table,
    id,
    isStory
      ? `id, identifier, title, status, review_status, type,
         author_id, workspace_id, agent_generated, review_notes,
         script_revision, reviewed_script_revision, confirmed_at,
         published_at, updated_at`
      : "*",
  );
  if (!["1", "true"].includes(String(before.agent_generated))) {
    throw new AdminError(
      "STORY_SOURCE_ACTION_DENIED",
      "Only Agent-generated Story assets use Admin review transitions",
      409,
    );
  }
  if (isStory) {
    if (action === "archive") {
      throw new AdminError(
        "STORY_SOURCE_ACTION_DENIED",
        "Admin cannot change the canonical Story business status",
        405,
      );
    }
    if (!before.script_revision) {
      throw new AdminError(
        "STORY_ARTIFACT_REVISION_REQUIRED",
        "The Story has no indexed script revision to review",
        409,
      );
    }
    if (!expectedScriptRevision) {
      throw new AdminError(
        "STORY_ARTIFACT_EXPECTED_REVISION_REQUIRED",
        "expectedScriptRevision is required for Story review actions",
        400,
      );
    }
    if (expectedScriptRevision !== before.script_revision) {
      throw new AdminError(
        "STORY_ARTIFACT_REVISION_CONFLICT",
        "The Story script revision changed; reload the Artifact before reviewing",
        409,
        { currentRevision: before.script_revision },
      );
    }
  }

  if (action === "archive") {
    if (before.status === "archived") {
      throw new AdminError(
        "STORY_SOURCE_ALREADY_ARCHIVED",
        "The Story item is already archived",
        409,
      );
    }
    await client.query(
      `UPDATE ${table}
       SET status = 'archived',
           ${resource === "story-stories" || resource === "stories" ? "" : "archived_at = CURRENT_TIMESTAMP,"}
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id],
    );
  } else {
    if (before.review_status !== "pending" || before.status === "archived") {
      throw new AdminError(
        "STORY_SOURCE_REVIEW_CONFLICT",
        "Only pending, non-archived Story items can be reviewed",
        409,
      );
    }
    if (action === "confirm") {
      await client.query(
        `UPDATE ${table}
         SET review_status = 'confirmed',
             confirmed_at = CURRENT_TIMESTAMP,
             ${isStory ? "reviewed_script_revision = script_revision," : ""}
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id],
      );
    } else {
      await client.query(
        `UPDATE ${table}
         SET review_status = 'rejected', review_notes = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, reviewNotes ?? null],
      );
    }
  }
  const after = await loadRowForUpdate(
    client,
    table,
    id,
    isStory
      ? `id, identifier, title, status, review_status, type,
         author_id, workspace_id, agent_generated, review_notes,
         script_revision, reviewed_script_revision, confirmed_at,
         published_at, updated_at`
      : "*",
  );
  return { before, after };
}

export async function handleStorySourceAction(
  request: Request,
  resource: string,
  id: string,
  action: string,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    if (!isStorySourceResource(resource)) {
      throw new AdminError(
        "STORY_SOURCE_RESOURCE_NOT_FOUND",
        "The requested Story source resource does not exist",
        404,
      );
    }
    if (!(["confirm", "reject", "archive"] as const).includes(action as never)) {
      throw new AdminError(
        "STORY_SOURCE_ACTION_NOT_FOUND",
        "The requested Story action does not exist",
        404,
      );
    }
    const identity = await requireAdminRequest(request, "story.write");
    const body = await parseBody(request, reviewActionSchema);
    await withStoryTransaction(async (client) => {
      const changed = await transitionReview(
        client,
        resource,
        id,
        action as "confirm" | "reject" | "archive",
        body.reviewNotes,
        body.expectedScriptRevision,
      );
      await auditSourceMutation(client, {
        request,
        requestId,
        identity,
        action,
        resource,
        id,
        ...changed,
      });
    });
    const data = await queryStorySourceItem(resource, id);
    return Response.json(
      { data },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(storySourceError(error), requestId);
  }
}
