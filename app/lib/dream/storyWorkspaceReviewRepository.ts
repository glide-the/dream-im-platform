// [Input] Canonical actor, closed review command, original request ID and caller-owned Admin transaction.
// [Output] Typed Drizzle transitions, bundle cascade, ordered safe projections and durable per-item audits.
// [Pos] Registry111 Repository; callers cannot select tables, columns, SQL, actor or transaction behavior.
// [Sync] 2026-09-15: derive public artifact availability from canonical artifact_status.
import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { adminAuditLogs, storyWorkspaceStories as stories } from "@ink-memory/db/schema";
import {
  story_workspace_characters as characters,
  story_workspace_scenes as scenes,
  story_workspace_story_characters as storyCharacters,
} from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto, isoTimeDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type {
  StoryWorkspaceReviewAction,
  StoryWorkspaceReviewBatchInput,
  StoryWorkspaceReviewResourceType,
  StoryWorkspaceReviewTransitionInput,
} from "./storyWorkspaceReviewDto";

type LockedReviewRow = {
  id: string;
  review_status: string;
  status: string;
  artifact_source_type: string | null;
  script_revision: string | null;
  artifact_status: string | null;
  artifact_sync_status: string | null;
};

const publicSyncErrors = new Set([
  "story_index_row_missing", "story_index_schema_unavailable", "story_index_database_unavailable",
  "story_index_write_failed", "story_index_conflict", "story_index_invalid_artifact",
  "story_index_revision_conflict", "artifact_missing",
]);

function storyTime(value: Date | null): string | null {
  return value === null ? null : isoTimeDto.parse(value.toISOString());
}

function legacyTime(value: string | null): string | null {
  if (value === null) return null;
  let normalized = value.replace(" ", "T");
  if (/[+-]\d{2}$/.test(normalized)) normalized += ":00";
  else normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = isoTimeDto.safeParse(normalized);
  if (!parsed.success) throw new AuthBoundaryError("STORY_WORKSPACE_REVIEW_DATA_INVALID");
  return parsed.data;
}

function decodeTags(value: string | null): string[] {
  try {
    const decoded: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(decoded) && decoded.every(item => typeof item === "string") ? decoded : [];
  } catch {
    return [];
  }
}

export class StoryWorkspaceReviewRepository {
  private readonly actor: string;

  constructor(private readonly tx: DataTransaction, actor: string) {
    this.actor = decimalIdDto.parse(actor);
  }

  private actorSql() {
    return sql`${this.actor}::bigint`;
  }

  async lockOwnedGenerated(resourceType: StoryWorkspaceReviewResourceType, ids: string[]): Promise<LockedReviewRow[]> {
    if (ids.length === 0) return [];
    if (resourceType === "story") {
      return this.tx.select({
        id: stories.id, review_status: stories.review_status, status: stories.status,
        artifact_source_type: stories.artifact_source_type, script_revision: stories.script_revision,
        artifact_status: stories.artifact_status, artifact_sync_status: stories.artifact_sync_status,
      }).from(stories).where(and(inArray(stories.id, ids), eq(stories.author_id, this.actorSql()),
        eq(stories.agent_generated, 1))).for("update");
    }
    const table = resourceType === "character" ? characters : scenes;
    const rows = await this.tx.select({ id: table.id, review_status: table.review_status, status: table.status })
      .from(table).where(and(inArray(table.id, ids), eq(table.author_id, this.actorSql()),
        eq(table.agent_generated, 1))).for("update");
    return rows.map(row => ({ ...row, artifact_source_type: null, script_revision: null,
      artifact_status: null, artifact_sync_status: null }));
  }

  private requireArtifactReviewable(rows: LockedReviewRow[], action: StoryWorkspaceReviewAction) {
    if (action === "archive") return;
    for (const row of rows) {
      if (row.artifact_source_type !== null && (!row.script_revision
        || (action === "confirm" && (row.artifact_status !== "available" || row.artifact_sync_status !== "indexed")))) {
        throw new AuthBoundaryError("STORY_WORKSPACE_REVIEW_STATE_INVALID", 409);
      }
    }
  }

  private async updateEligible(resourceType: StoryWorkspaceReviewResourceType, ids: string[], action: StoryWorkspaceReviewAction,
    reviewNotes: string | null) {
    if (ids.length === 0) return;
    const timestamp = sql`CURRENT_TIMESTAMP`;
    let updated: { id: string }[];
    if (resourceType === "story") {
      const condition = and(inArray(stories.id, ids), eq(stories.author_id, this.actorSql()),
        eq(stories.agent_generated, 1), ne(stories.status, "archived"),
        ...(action === "archive" ? [] : [eq(stories.review_status, "pending")]));
      if (action === "confirm") {
        updated = await this.tx.update(stories).set({ review_status: "confirmed", status: "published",
          confirmed_at: timestamp, published_at: timestamp, reviewed_script_revision: stories.script_revision,
          updated_at: timestamp }).where(condition).returning({ id: stories.id });
      } else if (action === "reject") {
        updated = await this.tx.update(stories).set({ review_status: "rejected", review_notes: reviewNotes,
          reviewed_script_revision: stories.script_revision, updated_at: timestamp })
          .where(condition).returning({ id: stories.id });
      } else {
        updated = await this.tx.update(stories).set({ status: "archived", updated_at: timestamp })
          .where(condition).returning({ id: stories.id });
      }
    } else {
      const table = resourceType === "character" ? characters : scenes;
      const condition = and(inArray(table.id, ids), eq(table.author_id, this.actorSql()),
        eq(table.agent_generated, 1), eq(table.review_status, "pending"), ne(table.status, "archived"));
      if (action === "confirm") {
        updated = await this.tx.update(table).set({ review_status: "confirmed", confirmed_at: timestamp,
          updated_at: timestamp }).where(condition).returning({ id: table.id });
      } else if (action === "reject") {
        updated = await this.tx.update(table).set({ review_status: "rejected", review_notes: reviewNotes,
          updated_at: timestamp }).where(condition).returning({ id: table.id });
      } else {
        updated = await this.tx.update(table).set({ status: "archived", archived_at: timestamp,
          updated_at: timestamp }).where(condition).returning({ id: table.id });
      }
    }
    const changed = new Set(updated.map(row => row.id));
    if (changed.size !== ids.length || ids.some(id => !changed.has(id))) {
      throw new AuthBoundaryError("STORY_WORKSPACE_REVIEW_STATE_CHANGED", 409);
    }
  }

  private async confirmStoryBundles(storyIds: string[]) {
    if (storyIds.length === 0) return;
    const timestamp = sql`CURRENT_TIMESTAMP`;
    await this.tx.update(scenes).set({ review_status: "confirmed", confirmed_at: timestamp, updated_at: timestamp })
      .where(and(inArray(scenes.story_id, storyIds), eq(scenes.author_id, this.actorSql()),
        eq(scenes.agent_generated, 1), eq(scenes.review_status, "pending"), ne(scenes.status, "archived")));
    const linkedCharacters = this.tx.select({ id: storyCharacters.character_id }).from(storyCharacters)
      .where(inArray(storyCharacters.story_id, storyIds));
    await this.tx.update(characters).set({ review_status: "confirmed", confirmed_at: timestamp, updated_at: timestamp })
      .where(and(inArray(characters.id, linkedCharacters), eq(characters.author_id, this.actorSql()),
        eq(characters.agent_generated, 1), eq(characters.review_status, "pending"), ne(characters.status, "archived")));
  }

  private async storyItems(ids: string[]) {
    const rows = await this.tx.select({
      id: stories.id, identifier: stories.identifier, title: stories.title, description: stories.description,
      status: stories.status, review_status: stories.review_status, review_notes: stories.review_notes,
      type: stories.type, character_count: stories.character_count, scene_count: stories.scene_count,
      created_at: stories.created_at, updated_at: stories.updated_at, confirmed_at: stories.confirmed_at,
      source_run_id: stories.source_run_id, source_project_id: stories.source_project_id,
      episode_count: stories.episode_count, artifact_status: stories.artifact_status,
      artifact_manifest_revision: stories.artifact_manifest_revision, script_revision: stories.script_revision,
      artifact_sync_status: stories.artifact_sync_status, artifact_indexed_at: stories.artifact_indexed_at,
      artifact_sync_error_code: stories.artifact_sync_error_code, script_size_bytes: stories.script_size_bytes,
      reconcile_version: stories.reconcile_version,
    }).from(stories).where(and(inArray(stories.id, ids), eq(stories.author_id, this.actorSql())));
    return rows.map(row => ({ ...row, created_at: storyTime(row.created_at)!, updated_at: storyTime(row.updated_at)!,
      confirmed_at: storyTime(row.confirmed_at), artifact_indexed_at: storyTime(row.artifact_indexed_at),
      artifact_sync_error_code: row.artifact_sync_error_code !== null && publicSyncErrors.has(row.artifact_sync_error_code)
        ? row.artifact_sync_error_code : null,
      artifact_available: row.artifact_status === null ? null : row.artifact_status === "available",
    }));
  }

  private async characterItems(ids: string[]) {
    const rows = await this.tx.select({
      id: characters.id, identifier: characters.identifier, name: characters.name, avatar_url: characters.avatar_url,
      identity: characters.identity, personality: characters.personality, background: characters.background,
      catchphrase: characters.catchphrase, tags: characters.tags, story_count: characters.story_count,
      review_status: characters.review_status, review_notes: characters.review_notes, status: characters.status,
      created_at: characters.created_at, updated_at: characters.updated_at, confirmed_at: characters.confirmed_at,
      archived_at: characters.archived_at,
    }).from(characters).where(and(inArray(characters.id, ids), eq(characters.author_id, this.actorSql())));
    return rows.map(row => ({ ...row, tags: decodeTags(row.tags), created_at: legacyTime(row.created_at)!,
      updated_at: legacyTime(row.updated_at)!, confirmed_at: legacyTime(row.confirmed_at),
      archived_at: legacyTime(row.archived_at) }));
  }

  private async sceneItems(ids: string[]) {
    const rows = await this.tx.select({
      id: scenes.id, identifier: scenes.identifier, name: scenes.name, description: scenes.description,
      story_id: scenes.story_id, character_count: scenes.character_count, order_index: scenes.order_index,
      review_status: scenes.review_status, review_notes: scenes.review_notes, status: scenes.status,
      created_at: scenes.created_at, updated_at: scenes.updated_at, confirmed_at: scenes.confirmed_at,
      archived_at: scenes.archived_at,
    }).from(scenes).where(and(inArray(scenes.id, ids), eq(scenes.author_id, this.actorSql())));
    return rows.map(row => ({ ...row, created_at: legacyTime(row.created_at)!, updated_at: legacyTime(row.updated_at)!,
      confirmed_at: legacyTime(row.confirmed_at), archived_at: legacyTime(row.archived_at) }));
  }

  private async orderedItems(resourceType: StoryWorkspaceReviewResourceType, ids: string[]): Promise<unknown[]> {
    const rows = resourceType === "story" ? await this.storyItems(ids)
      : resourceType === "character" ? await this.characterItems(ids) : await this.sceneItems(ids);
    const byId = new Map<string, unknown>(rows.map(row => [row.id, row] as const));
    if (byId.size !== ids.length || ids.some(id => !byId.has(id))) {
      throw new AuthBoundaryError("STORY_WORKSPACE_REVIEW_DATA_INVALID");
    }
    return ids.map(id => byId.get(id)!);
  }

  private async audit(requestId: string, resourceType: StoryWorkspaceReviewResourceType,
    action: StoryWorkspaceReviewAction, rows: LockedReviewRow[], reviewNotes: string | null) {
    if (rows.length === 0) return;
    const next = action === "confirm" ? "confirmed" : action === "reject" ? "rejected" : "archived";
    await this.tx.insert(adminAuditLogs).values(rows.map(row => ({
      id: `audit_${randomUUID().replaceAll("-", "")}`,
      actor_type: "user", actor_id: this.actor,
      action: `dream.story-workspace-review.${action}`,
      resource_type: `story_workspace_${resourceType}`,
      resource_id: row.id, request_id: requestId,
      before: { state: action === "archive" ? row.status : row.review_status },
      after: { state: next }, metadata: { review_notes: reviewNotes },
    })));
  }

  async transition(input: StoryWorkspaceReviewTransitionInput, requestId: string) {
    const rows = await this.lockOwnedGenerated(input.resource_type, [input.resource_id]);
    if (rows.length !== 1) throw new AuthBoundaryError("STORY_WORKSPACE_REVIEW_NOT_FOUND", 404);
    const row = rows[0];
    const eligible = input.action === "archive"
      ? row.status !== "archived"
      : row.review_status === "pending" && row.status !== "archived";
    if (!eligible) throw new AuthBoundaryError("STORY_WORKSPACE_REVIEW_STATE_INVALID", 409);
    this.requireArtifactReviewable(rows, input.action);
    await this.updateEligible(input.resource_type, [input.resource_id], input.action, input.review_notes);
    if (input.resource_type === "story" && input.action === "confirm") await this.confirmStoryBundles([input.resource_id]);
    const [item] = await this.orderedItems(input.resource_type, [input.resource_id]);
    await this.audit(requestId, input.resource_type, input.action, rows, input.review_notes);
    return { resource_type: input.resource_type, item };
  }

  async batch(input: StoryWorkspaceReviewBatchInput, requestId: string) {
    const rows = await this.lockOwnedGenerated(input.resource_type, input.ids);
    const byId = new Map(rows.map(row => [row.id, row]));
    const eligibleIds = input.ids.filter(id => {
      const row = byId.get(id);
      return row !== undefined && row.review_status === "pending" && row.status !== "archived";
    });
    const eligibleRows = eligibleIds.map(id => byId.get(id)!);
    this.requireArtifactReviewable(eligibleRows, input.action);
    await this.updateEligible(input.resource_type, eligibleIds, input.action, input.review_notes);
    if (input.resource_type === "story" && input.action === "confirm") await this.confirmStoryBundles(eligibleIds);
    const updatedItems = await this.orderedItems(input.resource_type, eligibleIds);
    await this.audit(requestId, input.resource_type, input.action, eligibleRows, input.review_notes);
    return {
      success: true as const, action: input.action, resource_type: input.resource_type,
      total_requested: input.ids.length, total_updated: updatedItems.length,
      skipped_ids: input.ids.filter(id => !eligibleIds.includes(id)), updated_items: updatedItems,
    };
  }
}
