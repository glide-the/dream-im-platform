// [Input] Canonical OAuth actor plus strict catalog read/workspace/edit commands in one caller-owned UOW.
// [Output] Owner-filtered Drizzle reads, controlled updates, stable pagination, relations, and mutation audits.
// [Pos] Registry114 Repository; it exposes business methods rather than caller-selected tables, columns, or SQL.
// [Sync] 2026-09-15: move Story Workspace catalog browse and edit persistence into Admin.
import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import {
  adminAuditLogs,
  storyWorkspaceStories as stories,
  storyWorkspaceWorkspaces as workspaces,
} from "@ink-memory/db/schema";
import {
  story_workspace_characters as characters,
  story_workspace_scene_characters as sceneCharacters,
  story_workspace_scenes as scenes,
  story_workspace_story_characters as storyCharacters,
} from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto, isoTimeDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type {
  StoryWorkspaceCatalogPatchInput,
  StoryWorkspaceCatalogReadInput,
} from "./storyWorkspaceCatalogDto";

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
  if (!parsed.success) throw new AuthBoundaryError("STORY_WORKSPACE_CATALOG_DATA_INVALID");
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

const storyProjection = {
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
};
const characterProjection = {
  id: characters.id, identifier: characters.identifier, name: characters.name, avatar_url: characters.avatar_url,
  identity: characters.identity, personality: characters.personality, background: characters.background,
  catchphrase: characters.catchphrase, tags: characters.tags, story_count: characters.story_count,
  review_status: characters.review_status, review_notes: characters.review_notes, status: characters.status,
  created_at: characters.created_at, updated_at: characters.updated_at, confirmed_at: characters.confirmed_at,
  archived_at: characters.archived_at,
};
const sceneProjection = {
  id: scenes.id, identifier: scenes.identifier, name: scenes.name, description: scenes.description,
  story_id: scenes.story_id, character_count: scenes.character_count, order_index: scenes.order_index,
  review_status: scenes.review_status, review_notes: scenes.review_notes, status: scenes.status,
  created_at: scenes.created_at, updated_at: scenes.updated_at, confirmed_at: scenes.confirmed_at,
  archived_at: scenes.archived_at,
};

type StoryRow = typeof stories.$inferSelect;
type CharacterRow = typeof characters.$inferSelect;
type SceneRow = typeof scenes.$inferSelect;

function publicStory(row: Pick<StoryRow, keyof typeof storyProjection>) {
  return { ...row, created_at: storyTime(row.created_at)!, updated_at: storyTime(row.updated_at)!,
    confirmed_at: storyTime(row.confirmed_at), artifact_indexed_at: storyTime(row.artifact_indexed_at),
    artifact_sync_error_code: row.artifact_sync_error_code !== null && publicSyncErrors.has(row.artifact_sync_error_code)
      ? row.artifact_sync_error_code : null,
    artifact_available: row.artifact_status === null ? null : row.artifact_status === "available" };
}

function publicCharacter(row: Pick<CharacterRow, keyof typeof characterProjection>) {
  return { ...row, tags: decodeTags(row.tags), created_at: legacyTime(row.created_at)!,
    updated_at: legacyTime(row.updated_at)!, confirmed_at: legacyTime(row.confirmed_at),
    archived_at: legacyTime(row.archived_at) };
}

function publicScene(row: Pick<SceneRow, keyof typeof sceneProjection>) {
  return { ...row, created_at: legacyTime(row.created_at)!, updated_at: legacyTime(row.updated_at)!,
    confirmed_at: legacyTime(row.confirmed_at), archived_at: legacyTime(row.archived_at) };
}

function pageResult<T>(data: T[], total: number, page: number, perPage: number) {
  return { data, pagination: { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) } };
}

export class StoryWorkspaceCatalogRepository {
  private readonly actor: string;
  constructor(private readonly tx: DataTransaction, actor: string) { this.actor = decimalIdDto.parse(actor); }
  private actorSql() { return sql`${this.actor}::bigint`; }

  async workspace(id: string) {
    const row = (await this.tx.select({ id: workspaces.id, name: workspaces.name, settings: workspaces.settings,
      created_at: workspaces.created_at, updated_at: workspaces.updated_at }).from(workspaces)
      .where(and(eq(workspaces.id, id), eq(workspaces.owner_id, this.actorSql()))).limit(1))[0];
    if (!row) throw new AuthBoundaryError("STORY_WORKSPACE_CATALOG_NOT_FOUND", 404);
    return { ...row, created_at: storyTime(row.created_at)!, updated_at: storyTime(row.updated_at)! };
  }

  async patchWorkspace(id: string, patch: Record<string, unknown>) {
    const updated = await this.tx.update(workspaces).set({ ...patch, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(workspaces.id, id), eq(workspaces.owner_id, this.actorSql()))).returning({ id: workspaces.id });
    if (updated.length !== 1) throw new AuthBoundaryError("STORY_WORKSPACE_CATALOG_NOT_FOUND", 404);
    return this.workspace(id);
  }

  private storyConditions(input?: Extract<StoryWorkspaceCatalogReadInput, { view: "story_list" }>) {
    const conditions: SQL[] = [eq(stories.author_id, this.actorSql())];
    if (input?.q) conditions.push(ilike(stories.title, `%${input.q}%`));
    if (input?.review_status.length) conditions.push(inArray(stories.review_status, input.review_status));
    if (input?.status.length) conditions.push(inArray(stories.status, input.status));
    if (input?.type.length) conditions.push(inArray(stories.type, input.type));
    return and(...conditions)!;
  }

  async listStories(input: Extract<StoryWorkspaceCatalogReadInput, { view: "story_list" }>) {
    const where = this.storyConditions(input);
    const [{ total }] = await this.tx.select({ total: count() }).from(stories).where(where);
    const sortColumn = input.sort === "created_at" ? stories.created_at
      : input.sort === "title" ? stories.title : stories.updated_at;
    const direction = input.order === "asc" ? asc : desc;
    const rows = await this.tx.select(storyProjection).from(stories).where(where)
      .orderBy(direction(sortColumn), asc(stories.id)).limit(input.per_page).offset((input.page - 1) * input.per_page);
    return pageResult(rows.map(publicStory), total, input.page, input.per_page);
  }

  private async storyItem(id: string) {
    const row = (await this.tx.select(storyProjection).from(stories)
      .where(and(eq(stories.id, id), eq(stories.author_id, this.actorSql()))).limit(1))[0];
    if (!row) throw new AuthBoundaryError("STORY_WORKSPACE_CATALOG_NOT_FOUND", 404);
    return publicStory(row);
  }

  private async characterItem(id: string) {
    const row = (await this.tx.select(characterProjection).from(characters)
      .where(and(eq(characters.id, id), eq(characters.author_id, this.actorSql()))).limit(1))[0];
    if (!row) throw new AuthBoundaryError("STORY_WORKSPACE_CATALOG_NOT_FOUND", 404);
    return publicCharacter(row);
  }

  private async sceneItem(id: string) {
    const row = (await this.tx.select(sceneProjection).from(scenes)
      .where(and(eq(scenes.id, id), eq(scenes.author_id, this.actorSql()))).limit(1))[0];
    if (!row) throw new AuthBoundaryError("STORY_WORKSPACE_CATALOG_NOT_FOUND", 404);
    return publicScene(row);
  }

  async storyDetail(id: string) {
    const item = await this.storyItem(id);
    const relatedCharacters = await this.tx.select({ ...characterProjection, role_type: storyCharacters.role_type })
      .from(characters).innerJoin(storyCharacters, eq(storyCharacters.character_id, characters.id))
      .where(and(eq(storyCharacters.story_id, id), eq(characters.author_id, this.actorSql())))
      .orderBy(asc(characters.name), asc(characters.id));
    const relatedScenes = await this.tx.select(sceneProjection).from(scenes)
      .where(and(eq(scenes.story_id, id), eq(scenes.author_id, this.actorSql())))
      .orderBy(asc(scenes.order_index), asc(scenes.id));
    return { ...item, characters: relatedCharacters.map(row => ({ ...publicCharacter(row), role_type: row.role_type })),
      scenes: relatedScenes.map(publicScene) };
  }

  async listCharacters(input: Extract<StoryWorkspaceCatalogReadInput, { view: "character_list" }>) {
    const conditions: SQL[] = [eq(characters.author_id, this.actorSql())];
    if (input.q) conditions.push(ilike(characters.name, `%${input.q}%`));
    if (input.review_status.length) conditions.push(inArray(characters.review_status, input.review_status));
    const where = and(...conditions)!;
    const [{ total }] = await this.tx.select({ total: count() }).from(characters).where(where);
    const sortColumn = input.sort === "created_at" ? characters.created_at
      : input.sort === "name" ? characters.name : characters.updated_at;
    const direction = input.order === "asc" ? asc : desc;
    const rows = await this.tx.select(characterProjection).from(characters).where(where)
      .orderBy(direction(sortColumn), asc(characters.id)).limit(input.per_page).offset((input.page - 1) * input.per_page);
    return pageResult(rows.map(publicCharacter), total, input.page, input.per_page);
  }

  async characterDetail(id: string) {
    const item = await this.characterItem(id);
    const related = await this.tx.select(storyProjection).from(stories)
      .innerJoin(storyCharacters, eq(storyCharacters.story_id, stories.id))
      .where(and(eq(storyCharacters.character_id, id), eq(stories.author_id, this.actorSql())))
      .orderBy(desc(stories.updated_at), asc(stories.id));
    return { ...item, stories: related.map(publicStory) };
  }

  async listScenes(input: Extract<StoryWorkspaceCatalogReadInput, { view: "scene_list" }>) {
    const conditions: SQL[] = [eq(scenes.author_id, this.actorSql())];
    if (input.q) conditions.push(ilike(scenes.name, `%${input.q}%`));
    if (input.review_status.length) conditions.push(inArray(scenes.review_status, input.review_status));
    if (input.story_id) conditions.push(eq(scenes.story_id, input.story_id));
    const where = and(...conditions)!;
    const [{ total }] = await this.tx.select({ total: count() }).from(scenes).where(where);
    const sortColumn = input.sort === "created_at" ? scenes.created_at : input.sort === "name" ? scenes.name
      : input.sort === "order_index" ? scenes.order_index : scenes.updated_at;
    const direction = input.order === "asc" ? asc : desc;
    const rows = await this.tx.select(sceneProjection).from(scenes).where(where)
      .orderBy(direction(sortColumn), asc(scenes.id)).limit(input.per_page).offset((input.page - 1) * input.per_page);
    return pageResult(rows.map(publicScene), total, input.page, input.per_page);
  }

  async sceneDetail(id: string) {
    const item = await this.sceneItem(id);
    const story = item.story_id === null ? null : await this.storyItem(item.story_id);
    const related = await this.tx.select(characterProjection).from(characters)
      .innerJoin(sceneCharacters, eq(sceneCharacters.character_id, characters.id))
      .where(and(eq(sceneCharacters.scene_id, id), eq(characters.author_id, this.actorSql())))
      .orderBy(asc(characters.name), asc(characters.id));
    return { ...item, story, characters: related.map(publicCharacter) };
  }

  async read(input: StoryWorkspaceCatalogReadInput) {
    if (input.view === "story_list") return { view: input.view, ...await this.listStories(input) };
    if (input.view === "story_detail") return { view: input.view, item: await this.storyDetail(input.resource_id) };
    if (input.view === "character_list") return { view: input.view, ...await this.listCharacters(input) };
    if (input.view === "character_detail") return { view: input.view, item: await this.characterDetail(input.resource_id) };
    if (input.view === "scene_list") return { view: input.view, ...await this.listScenes(input) };
    return { view: input.view, item: await this.sceneDetail(input.resource_id) };
  }

  async patch(input: StoryWorkspaceCatalogPatchInput) {
    if (input.resource_type === "story") {
      const updated = await this.tx.update(stories).set({ ...input.patch, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(stories.id, input.resource_id), eq(stories.author_id, this.actorSql())))
        .returning({ id: stories.id });
      if (updated.length !== 1) throw new AuthBoundaryError("STORY_WORKSPACE_CATALOG_NOT_FOUND", 404);
      return { resource_type: input.resource_type, item: await this.storyItem(input.resource_id) };
    }
    if (input.resource_type === "character") {
      const { tags, ...characterPatch } = input.patch;
      const values = { ...characterPatch, ...(tags === undefined ? {} : { tags: JSON.stringify(tags) }),
        updated_at: sql`CURRENT_TIMESTAMP` };
      const updated = await this.tx.update(characters).set(values)
        .where(and(eq(characters.id, input.resource_id), eq(characters.author_id, this.actorSql())))
        .returning({ id: characters.id });
      if (updated.length !== 1) throw new AuthBoundaryError("STORY_WORKSPACE_CATALOG_NOT_FOUND", 404);
      return { resource_type: input.resource_type, item: await this.characterItem(input.resource_id) };
    }
    if (input.patch.story_id !== undefined && input.patch.story_id !== null) await this.storyItem(input.patch.story_id);
    const updated = await this.tx.update(scenes).set({ ...input.patch, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(scenes.id, input.resource_id), eq(scenes.author_id, this.actorSql())))
      .returning({ id: scenes.id });
    if (updated.length !== 1) throw new AuthBoundaryError("STORY_WORKSPACE_CATALOG_NOT_FOUND", 404);
    return { resource_type: input.resource_type, item: await this.sceneItem(input.resource_id) };
  }

  async audit(requestId: string, action: string, resourceType: string, resourceId: string) {
    await this.tx.insert(adminAuditLogs).values({
      id: `audit_${randomUUID().replaceAll("-", "")}`,
      actor_type: "user", actor_id: this.actor, action,
      resource_type: resourceType, resource_id: resourceId, request_id: requestId,
      before: null, after: null, metadata: {},
    });
  }
}
