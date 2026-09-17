// [Input] Canonical actor plus closed Run, Episode and Story-index business values.
// [Output] Typed Drizzle authority rows, row-locked CAS and lifecycle/index mutations.
// [Pos] Registry185-191 persistence adapter; it owns all PostgreSQL access for this domain.
// [Sync] 2026-09-16: replace Dream Story Workspace SQL with one Admin ORM repository.
import { and, asc, desc, eq, gt, inArray, lt, or, sql } from "drizzle-orm";
import { storyWorkspaceStories as stories, storyWorkspaceWorkspaces as workspaces } from "@ink-memory/db/schema";
import {
  chat_message as messages,
  chat_thread as threads,
  deck_plugin_bindings as bindings,
  deck_plugin_releases as releases,
  deck_runtime_plugin_locks as runtimeLocks,
  deck_runtime_snapshots as runtimeSnapshots,
  decks,
  workflow_preflights as preflights,
  workflow_run_transitions as transitions,
  workflow_runs as runs,
} from "@ink-memory/db/schema/dream";
import type { DataTransaction } from "./database";
import type { StoryWorkspaceArtifactProjection, StoryWorkspaceArtifactRunsInput } from "./storyWorkspaceArtifactDto";

const actorBigint = (actor: string) => sql`${actor}::bigint`;
const runProjection = {
  workflow_run_id: runs.id,
  deck_plugin_id: runs.deck_plugin_id,
  deck_plugin_version: runs.deck_plugin_version,
  workflow_definition_ref: runs.workflow_definition_ref,
  deck_runtime_snapshot_id: runs.deck_runtime_snapshot_id,
  status: runs.status,
  failed_step: runs.failed_step,
  error_code: runs.error_code,
  retry_of_run_id: runs.retry_of_run_id,
  deck_plugin_manifest_hash: runs.deck_plugin_manifest_hash,
  deck_plugin_binding_id: runs.deck_plugin_binding_id,
  binding_revision: runs.binding_revision,
  runtime_plugin_lock_id: runs.runtime_plugin_lock_id,
  runtime_load_receipt_id: runs.runtime_load_receipt_id,
  workflow_preflight_id: runs.workflow_preflight_id,
  agent_session_id: runs.agent_session_id,
  source_voice_thread_id: runs.source_voice_thread_id,
  source_message_id: runs.source_message_id,
  source_message_time: sql<string | null>`${runs.source_message_time}::text`,
  workspace_id: runs.workspace_id,
  idempotency_key: runs.idempotency_key,
  input_hash: runs.input_hash,
  semantic_fingerprint: runs.semantic_fingerprint,
  status_version: runs.status_version,
  created_by: runs.created_by,
  created_at: sql<string>`${runs.created_at}::text`,
  started_at: sql<string | null>`${runs.started_at}::text`,
  completed_at: sql<string | null>`${runs.completed_at}::text`,
};
const authorityProjection = {
  ...runProjection,
  thread_id: threads.id,
  thread_updated_at: sql<string>`${threads.updated_at}::text`,
  thread_voice_id: threads.voice_id,
  deck_id: decks.id,
  deck_name: decks.name,
  source_metadata: messages.metadata,
  release_manifest_json: releases.manifest_json,
};
const indexProjection = {
  story_id: stories.id,
  identifier: stories.identifier,
  title: stories.title,
  workspace_id: stories.workspace_id,
  source_run_id: stories.source_run_id,
  source_thread_ref: stories.source_thread_ref,
  source_project_id: stories.source_project_id,
  artifact_manifest_revision: stories.artifact_manifest_revision,
  script_revision: stories.script_revision,
  artifact_sync_status: stories.artifact_sync_status,
  artifact_indexed_at: sql<string | null>`${stories.artifact_indexed_at}::text`,
  artifact_sync_error_code: stories.artifact_sync_error_code,
  episode_count: stories.episode_count,
  script_size_bytes: stories.script_size_bytes,
  artifact_status: stories.artifact_status,
  reconcile_version: stories.reconcile_version,
};

function authorityPredicate(actor: string) {
  return and(
    eq(runs.created_by, actor),
    eq(workspaces.owner_id, actorBigint(actor)),
    eq(decks.owner_id, actorBigint(actor)),
    eq(decks.enabled, true),
    eq(threads.user_id, actorBigint(actor)),
    eq(threads.deck_id, bindings.deck_id),
    eq(messages.role, "user"),
    eq(preflights.created_by, runs.created_by),
    eq(preflights.deck_id, bindings.deck_id),
    eq(preflights.binding_revision, runs.binding_revision),
    eq(preflights.deck_plugin_id, runs.deck_plugin_id),
    eq(preflights.deck_plugin_version, runs.deck_plugin_version),
    eq(preflights.runtime_plugin_lock_id, runs.runtime_plugin_lock_id),
    eq(preflights.deck_runtime_snapshot_id, runs.deck_runtime_snapshot_id),
    eq(bindings.workspace_id, runs.workspace_id),
    eq(bindings.creator_id, runs.created_by),
    eq(bindings.deck_plugin_id, runs.deck_plugin_id),
    eq(bindings.deck_plugin_version, runs.deck_plugin_version),
    eq(bindings.binding_revision, runs.binding_revision),
    eq(releases.workflow_definition_ref, runs.workflow_definition_ref),
    eq(releases.manifest_hash, runs.deck_plugin_manifest_hash),
    eq(runtimeLocks.deck_plugin_id, runs.deck_plugin_id),
    eq(runtimeLocks.deck_plugin_version, runs.deck_plugin_version),
    eq(runtimeLocks.deck_plugin_manifest_hash, runs.deck_plugin_manifest_hash),
    eq(runtimeSnapshots.deck_id, bindings.deck_id),
    eq(runtimeSnapshots.deck_plugin_binding_id, bindings.deck_plugin_binding_id),
    eq(runtimeSnapshots.binding_revision, runs.binding_revision),
  );
}

export class StoryWorkspaceArtifactRepository {
  constructor(private readonly tx: DataTransaction) {}

  async authority(actor: string, runId: string, lock = false) {
    const query = this.tx.select(authorityProjection).from(runs)
      .innerJoin(workspaces, eq(workspaces.id, runs.workspace_id))
      .innerJoin(preflights, eq(preflights.workflow_preflight_id, runs.workflow_preflight_id))
      .innerJoin(bindings, eq(bindings.deck_plugin_binding_id, runs.deck_plugin_binding_id))
      .innerJoin(releases, and(eq(releases.deck_plugin_id, runs.deck_plugin_id), eq(releases.deck_plugin_version, runs.deck_plugin_version)))
      .innerJoin(runtimeLocks, eq(runtimeLocks.id, runs.runtime_plugin_lock_id))
      .innerJoin(runtimeSnapshots, eq(runtimeSnapshots.deck_runtime_snapshot_id, runs.deck_runtime_snapshot_id))
      .innerJoin(decks, eq(decks.id, bindings.deck_id))
      .innerJoin(threads, eq(threads.id, runs.source_voice_thread_id))
      .innerJoin(messages, and(eq(messages.id, runs.source_message_id), eq(messages.thread_id, threads.id)))
      .where(and(authorityPredicate(actor), eq(runs.id, runId))).limit(2);
    const rows = lock ? await query.for("update", { of: [runs, messages] }) : await query;
    return rows;
  }

  async listAuthorities(actor: string, input: StoryWorkspaceArtifactRunsInput) {
    const cursor = input.cursor;
    const cursorPredicate = cursor === null ? undefined : or(
      lt(runs.created_at, cursor.created_at),
      and(eq(runs.created_at, cursor.created_at), gt(runs.id, cursor.workflow_run_id)),
    );
    return this.tx.select(authorityProjection).from(runs)
      .innerJoin(workspaces, eq(workspaces.id, runs.workspace_id))
      .innerJoin(preflights, eq(preflights.workflow_preflight_id, runs.workflow_preflight_id))
      .innerJoin(bindings, eq(bindings.deck_plugin_binding_id, runs.deck_plugin_binding_id))
      .innerJoin(releases, and(eq(releases.deck_plugin_id, runs.deck_plugin_id), eq(releases.deck_plugin_version, runs.deck_plugin_version)))
      .innerJoin(runtimeLocks, eq(runtimeLocks.id, runs.runtime_plugin_lock_id))
      .innerJoin(runtimeSnapshots, eq(runtimeSnapshots.deck_runtime_snapshot_id, runs.deck_runtime_snapshot_id))
      .innerJoin(decks, eq(decks.id, bindings.deck_id))
      .innerJoin(threads, eq(threads.id, runs.source_voice_thread_id))
      .innerJoin(messages, and(eq(messages.id, runs.source_message_id), eq(messages.thread_id, threads.id)))
      .where(and(authorityPredicate(actor), cursorPredicate))
      .orderBy(desc(runs.created_at), asc(runs.id)).limit(input.limit + 1);
  }

  async storyTitles(runIds: readonly string[], keys: readonly { workspaceId: string; projectId: string }[]) {
    if (runIds.length === 0 && keys.length === 0) return [];
    const pairs = keys.map(key => and(eq(stories.workspace_id, key.workspaceId), eq(stories.source_project_id, key.projectId)));
    return this.tx.select({
      source_run_id: stories.source_run_id,
      workspace_id: stories.workspace_id,
      source_project_id: stories.source_project_id,
      title: stories.title,
      updated_at: stories.updated_at,
      story_id: stories.id,
    }).from(stories).where(and(
      eq(stories.artifact_source_type, "dream_episode"),
      or(runIds.length === 0 ? undefined : inArray(stories.source_run_id, [...runIds]), ...pairs),
    )).orderBy(desc(stories.updated_at), asc(stories.id));
  }

  async confirmationRows(threadIds: readonly string[]) {
    if (threadIds.length === 0) return [];
    return this.tx.select({
      id: messages.id,
      thread_id: messages.thread_id,
      metadata: messages.metadata,
      created_at: messages.created_at,
    }).from(messages).where(and(eq(messages.role, "user"), inArray(messages.thread_id, [...threadIds])))
      .orderBy(asc(messages.thread_id), asc(messages.created_at), asc(messages.id));
  }

  async compareAndSetSourceMetadata(messageId: string, oldMetadata: string, metadata: string) {
    const rows = await this.tx.update(messages).set({ metadata }).where(and(
      eq(messages.id, messageId), eq(messages.metadata, oldMetadata),
    )).returning({ id: messages.id });
    return rows.length === 1;
  }

  async clockText() {
    const result = await this.tx.execute(sql`SELECT clock_timestamp()::text AS value`);
    return String(result.rows[0]?.value ?? "");
  }

  async advanceRun(current: { workflow_run_id: string; status: string; status_version: number }, target: string,
    actor: string, reasonCode: string, transitionId: string, occurredAt: string) {
    const updated = await this.tx.update(runs).set({ status: target, status_version: current.status_version + 1 })
      .where(and(eq(runs.id, current.workflow_run_id), eq(runs.status, current.status), eq(runs.status_version, current.status_version)))
      .returning({ workflow_run_id: runs.id, status: runs.status, status_version: runs.status_version });
    if (updated.length !== 1) return null;
    await this.tx.insert(transitions).values({
      id: transitionId,
      workflow_run_id: current.workflow_run_id,
      transition_seq: current.status_version + 1,
      from_status: current.status,
      to_status: target,
      actor_id: actor,
      reason_code: reasonCode,
      failed_step: null,
      error_code: null,
      occurred_at: occurredAt,
    });
    return updated[0];
  }

  async lockIndexKey(workspaceId: string, projectId: string) {
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${workspaceId}\0dream_episode\0${projectId}`}, 0))`);
  }

  async indexRecord(workspaceId: string, projectId: string, lock = false) {
    const query = this.tx.select(indexProjection).from(stories).where(and(
      eq(stories.workspace_id, workspaceId),
      eq(stories.artifact_source_type, "dream_episode"),
      eq(stories.source_project_id, projectId),
    )).limit(2);
    return lock ? query.for("update", { of: stories }) : query;
  }

  async storyIdExists(storyId: string) {
    const rows = await this.tx.select({ id: stories.id }).from(stories).where(eq(stories.id, storyId)).limit(1).for("update", { of: stories });
    return rows.length !== 0;
  }

  async insertIndex(storyId: string, actor: string, workspaceId: string, threadId: string, runId: string,
    projection: StoryWorkspaceArtifactProjection) {
    const rows = await this.tx.insert(stories).values({
      id: storyId,
      identifier: projection.source_project_id,
      title: projection.title,
      description: null,
      status: "draft",
      review_status: "pending",
      type: "script",
      content: null,
      author_id: actorBigint(actor),
      workspace_id: workspaceId,
      character_count: 0,
      scene_count: 0,
      agent_generated: 1,
      artifact_source_type: "dream_episode",
      source_run_id: runId,
      source_thread_ref: threadId,
      source_project_id: projection.source_project_id,
      episode_count: projection.episode_count,
      artifact_manifest_revision: projection.artifact_manifest_revision,
      script_revision: projection.script_revision,
      artifact_sync_status: "indexed",
      artifact_indexed_at: sql`CURRENT_TIMESTAMP`,
      artifact_sync_error_code: null,
      script_size_bytes: projection.script_size_bytes,
      artifact_status: projection.artifact_status,
      reconcile_version: 1,
    }).returning(indexProjection);
    return rows[0] ?? null;
  }

  async updateIndex(storyId: string, runId: string, projection: StoryWorkspaceArtifactProjection) {
    const shouldUnpublish = sql`${stories.status} = 'published' AND (${stories.reviewed_script_revision} IS DISTINCT FROM ${projection.script_revision} OR ${projection.artifact_status} <> 'available')`;
    const rows = await this.tx.update(stories).set({
      identifier: projection.source_project_id,
      title: projection.title,
      source_run_id: runId,
      episode_count: projection.episode_count,
      artifact_manifest_revision: projection.artifact_manifest_revision,
      script_revision: projection.script_revision,
      artifact_sync_status: "indexed",
      artifact_indexed_at: sql`CURRENT_TIMESTAMP`,
      artifact_sync_error_code: null,
      script_size_bytes: projection.script_size_bytes,
      artifact_status: projection.artifact_status,
      reconcile_version: 1,
      status: sql`CASE WHEN ${shouldUnpublish} THEN 'draft' ELSE ${stories.status} END`,
      published_at: sql`CASE WHEN ${shouldUnpublish} THEN NULL ELSE ${stories.published_at} END`,
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(eq(stories.id, storyId)).returning(indexProjection);
    return rows[0] ?? null;
  }
}

export type StoryWorkspaceArtifactAuthorityRow = Awaited<ReturnType<StoryWorkspaceArtifactRepository["authority"]>>[number];
export type StoryWorkspaceArtifactIndexRow = Awaited<ReturnType<StoryWorkspaceArtifactRepository["indexRecord"]>>[number];
