// [Input] Registry185-191 strict DTOs, verified actor and one caller-owned Admin UOW.
// [Output] Actor-filtered authority, lifecycle transitions and transactional Story index results.
// [Pos] DTO-Service-typed Drizzle composition; Dream retains Runtime, SSE and shared files.
// [Sync] 2026-09-16: move the final Story Workspace database state machines into Admin.
import { createHash, randomUUID } from "node:crypto";
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { canonicalContractJson } from "./canonicalContractJson";
import { projectStoredWorkflowRun, projectWorkflowTimestamp } from "./workflowRunService";
import {
  StoryWorkspaceArtifactRepository,
  type StoryWorkspaceArtifactAuthorityRow,
  type StoryWorkspaceArtifactIndexRow,
} from "./storyWorkspaceArtifactRepository";
import * as dto from "./storyWorkspaceArtifactDto";

export const storyWorkspaceArtifactSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;
export type StoryWorkspaceArtifactActor = {
  principal: unknown;
  threadScope: string | null;
  runScope: string | null;
};

const launchAllowedKeys = new Set([
  "kind", "schemaVersion", "visibility", "actorId", "workspaceId", "deckId", "agentId", "goal",
  "idempotencyKey", "requestFingerprint", "dispatchStatus", "dispatchClaimId", "dispatchClaimedAt",
  "workflowRunId", "threadId", "dreamContext", "projectStorySlug", "story_workspace_episode_identity",
]);
const launchContextKeys = new Set([
  "workflow_run_id", "thread_id", "deck_id", "agent_id", "deck_plugin_id", "deck_plugin_version",
  "deck_plugin_binding_id", "binding_revision", "deck_runtime_snapshot_id", "runtime_plugin_lock_id",
]);
const requiredContextKeys = [...launchContextKeys].filter(key => key !== "agent_id");

function jsonObject(raw: string | null) {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function manifestSupportsDream(raw: string) {
  const manifest = jsonObject(raw);
  if (!manifest) return false;
  const surfaces = Array.isArray(manifest.surfaces) ? manifest.surfaces : [];
  if (surfaces.some(value => value !== null && typeof value === "object" && !Array.isArray(value)
    && (value as Record<string, unknown>).name === "dream")) return true;
  if (Array.isArray(manifest.capabilities) && manifest.capabilities.includes("story.workspace.propose")) return true;
  const runtime = manifest.runtime;
  if (runtime === null || typeof runtime !== "object" || Array.isArray(runtime)) return false;
  const plugins = (runtime as Record<string, unknown>).claude_code_plugins;
  return Array.isArray(plugins) && plugins.some(plugin => {
    if (plugin === null || typeof plugin !== "object" || Array.isArray(plugin)) return false;
    const bindings = (plugin as Record<string, unknown>).capability_bindings;
    return Array.isArray(bindings) && bindings.includes("story.workspace.propose");
  });
}

function fallbackProjectSlug(goal: string) {
  return `proj-${createHash("sha256").update(Buffer.from(goal, "utf8")).digest("hex").slice(0, 8)}`;
}

function decodeLaunch(row: StoryWorkspaceArtifactAuthorityRow, actor: string) {
  const metadata = jsonObject(row.source_metadata);
  if (!metadata || [...Object.keys(metadata)].some(key => !launchAllowedKeys.has(key))) return null;
  const context = metadata.dreamContext;
  if (context === null || typeof context !== "object" || Array.isArray(context)) return null;
  const dreamContext = context as Record<string, unknown>;
  if (requiredContextKeys.some(key => !(key in dreamContext))
    || Object.keys(dreamContext).some(key => !launchContextKeys.has(key))) return null;
  const agentPresent = "agentId" in metadata;
  const contextAgentPresent = "agent_id" in dreamContext;
  const schemaPresent = "schemaVersion" in metadata;
  if (schemaPresent) {
    if (metadata.schemaVersion !== "story-workspace-dream-launch/v1" || !agentPresent || !contextAgentPresent) return null;
  } else if (agentPresent || contextAgentPresent) return null;
  const agent = agentPresent ? metadata.agentId : null;
  if (agent !== null && (typeof agent !== "string" || agent.length === 0 || agent.trim() !== agent)) return null;
  if (agent !== (contextAgentPresent ? dreamContext.agent_id : null)) return null;
  const expected = {
    workflow_run_id: row.workflow_run_id,
    thread_id: row.thread_id,
    deck_id: row.deck_id,
    deck_plugin_id: row.deck_plugin_id,
    deck_plugin_version: row.deck_plugin_version,
    deck_plugin_binding_id: row.deck_plugin_binding_id,
    binding_revision: row.binding_revision,
    deck_runtime_snapshot_id: row.deck_runtime_snapshot_id,
    runtime_plugin_lock_id: row.runtime_plugin_lock_id,
  } as const;
  if (Object.entries(expected).some(([key, value]) => dreamContext[key] !== value)) return null;
  if (metadata.kind !== "story-workspace-dream-launch" || String(metadata.actorId) !== actor
    || metadata.workspaceId !== row.workspace_id || metadata.deckId !== row.deck_id
    || metadata.workflowRunId !== row.workflow_run_id || metadata.threadId !== row.thread_id) return null;
  const goal = typeof metadata.goal === "string" && metadata.goal.length >= 1 && metadata.goal.length <= 12_000
    && metadata.goal.trim() === metadata.goal ? metadata.goal : row.deck_name;
  const nested = dto.storyWorkspaceEpisodeAuthorityDto.safeParse(metadata.story_workspace_episode_identity);
  if (metadata.story_workspace_episode_identity !== undefined && !nested.success) return null;
  const projectCandidate = metadata.projectStorySlug ?? (nested.success ? nested.data.story_slug : null) ?? fallbackProjectSlug(goal);
  const project = dto.storyWorkspaceArtifactProjectionDto.shape.source_project_id.safeParse(projectCandidate);
  if (!project.success || (nested.success && nested.data.workflow_run_id !== row.workflow_run_id)
    || (nested.success && nested.data.story_slug !== project.data)) return null;
  return { metadata, goal, agent: agent as string | null, project: project.data, episode: nested.success ? nested.data : null };
}

function assertActorScope(actor: StoryWorkspaceArtifactActor, authority: StoryWorkspaceArtifactAuthorityRow) {
  if ((actor.threadScope !== null && actor.threadScope !== authority.thread_id)
    || (actor.runScope !== null && actor.runScope !== authority.workflow_run_id)) {
    throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  }
}

function titleMaps(rows: Awaited<ReturnType<StoryWorkspaceArtifactRepository["storyTitles"]>>) {
  const byRun = new Map<string, string>();
  const byProject = new Map<string, string>();
  for (const row of rows) {
    if (row.source_run_id !== null && !byRun.has(row.source_run_id)) byRun.set(row.source_run_id, row.title);
    if (row.source_project_id !== null) {
      const key = `${row.workspace_id}\0${row.source_project_id}`;
      if (!byProject.has(key)) byProject.set(key, row.title);
    }
  }
  return { byRun, byProject };
}

function confirmationMap(rows: Awaited<ReturnType<StoryWorkspaceArtifactRepository["confirmationRows"]>>,
  authorities: readonly StoryWorkspaceArtifactAuthorityRow[], actor: string) {
  const byThread = new Map(authorities.map(row => [row.thread_id, row.workflow_run_id]));
  const result = new Map(authorities.map(row => [row.workflow_run_id, { accepted: false, dispatched: false }]));
  const seen = new Set<string>();
  for (const row of rows) {
    const runId = byThread.get(row.thread_id);
    if (!runId) continue;
    const metadata = jsonObject(row.metadata);
    if (!metadata || metadata.kind !== "story-workspace-dream-confirmation") continue;
    if (seen.has(row.thread_id) || metadata.actor !== actor || metadata.thread_id !== row.thread_id
      || metadata.story_workspace_run_id !== runId) throw new AuthBoundaryError("DREAM_DATA_INVALID");
    seen.add(row.thread_id);
    result.set(runId, { accepted: true, dispatched: metadata.dispatch_status === "dispatched" });
  }
  return result;
}

function authorityOutput(row: StoryWorkspaceArtifactAuthorityRow, launch: NonNullable<ReturnType<typeof decodeLaunch>>,
  projectTitle: string | null, confirmation: { accepted: boolean; dispatched: boolean }) {
  if (!manifestSupportsDream(row.release_manifest_json) || row.thread_updated_at === null) return null;
  try {
    const threadUpdatedAt = projectWorkflowTimestamp(row.thread_updated_at);
    if (threadUpdatedAt === null) return null;
    const {
      thread_id: _threadId,
      thread_updated_at: _threadUpdatedAt,
      thread_voice_id: _threadVoiceId,
      deck_id: _deckId,
      deck_name: _deckName,
      source_metadata: _sourceMetadata,
      release_manifest_json: _releaseManifest,
      ...storedRun
    } = row;
    return dto.storyWorkspaceArtifactAuthorityDto.parse({
      run: projectStoredWorkflowRun(storedRun),
      thread_id: row.thread_id,
      thread_updated_at: threadUpdatedAt,
      deck_id: row.deck_id,
      deck_display_name: row.deck_name,
      launch_agent_id: launch.agent,
      goal: launch.goal,
      project_story_slug: launch.project,
      episode_authority: launch.episode,
      project_title: projectTitle,
      confirmation_accepted: confirmation.accepted,
      confirmation_dispatched: confirmation.dispatched,
    });
  } catch { return null; }
}

async function loadAuthority(store: StoryWorkspaceArtifactRepository, actorId: string, runId: string,
  actor: StoryWorkspaceArtifactActor, lock: boolean) {
  const rows = await store.authority(actorId, runId, lock);
  if (rows.length !== 1) throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
  const row = rows[0];
  assertActorScope(actor, row);
  const launch = decodeLaunch(row, actorId);
  if (!launch || !manifestSupportsDream(row.release_manifest_json)) throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
  return { row, launch };
}

function uuidV5Url(value: string) {
  const namespace = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const digest = createHash("sha1").update(namespace).update(Buffer.from(value, "utf8")).digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalIndex(actorId: string, authority: StoryWorkspaceArtifactAuthorityRow,
  launch: NonNullable<ReturnType<typeof decodeLaunch>>, projection: dto.StoryWorkspaceArtifactProjection) {
  if (projection.source_project_id !== launch.project || launch.episode === null) {
    throw new AuthBoundaryError("STORY_INDEX_INVALID_ARTIFACT", 422);
  }
  return {
    storyId: uuidV5Url(`urn:ink-memory:artifact-story:v1:${authority.workspace_id}:${projection.source_project_id}`),
    actorId,
    workspaceId: authority.workspace_id,
    threadId: authority.thread_id,
    runId: authority.workflow_run_id,
    projection,
  };
}

function observation(index: ReturnType<typeof canonicalIndex>, row: StoryWorkspaceArtifactIndexRow | null) {
  const p = index.projection;
  const identityConflict = row !== null && (row.story_id !== index.storyId || row.source_thread_ref !== index.threadId);
  let status: "missing" | "stale" | "indexed" | "failed";
  let errorCode: "story_index_row_missing" | "story_index_write_failed" | "story_index_conflict" | null = null;
  let retryable = false;
  if (row === null) { status = "missing"; errorCode = "story_index_row_missing"; retryable = true; }
  else if (identityConflict) { status = "failed"; errorCode = "story_index_conflict"; }
  else if (row.identifier !== p.source_project_id || row.title !== p.title || row.source_run_id !== index.runId
    || row.episode_count !== p.episode_count || row.artifact_manifest_revision !== p.artifact_manifest_revision
    || row.script_revision !== p.script_revision || row.script_size_bytes !== p.script_size_bytes) {
    status = "stale"; retryable = true;
  } else if (row.artifact_sync_status === "indexed" && row.artifact_indexed_at !== null
    && row.artifact_sync_error_code === null && row.artifact_status === "available" && row.reconcile_version === 1) status = "indexed";
  else if (row.artifact_sync_status === "stale") { status = "stale"; retryable = true; }
  else { status = "failed"; errorCode = row.artifact_sync_error_code === "story_index_conflict" ? "story_index_conflict" : "story_index_write_failed"; retryable = errorCode !== "story_index_conflict"; }
  const payload = {
    run_id: index.runId,
    project_id: p.source_project_id,
    project_title: p.title,
    story_id: row === null || identityConflict ? null : row.story_id,
    status,
    observed_manifest_revision: p.artifact_manifest_revision,
    observed_script_revision: p.script_revision,
    indexed_manifest_revision: row?.artifact_manifest_revision ?? null,
    indexed_script_revision: row?.script_revision ?? null,
    episode_count: p.episode_count,
    last_indexed_at: projectWorkflowTimestamp(row?.artifact_indexed_at ?? null),
    error_code: errorCode,
    retryable,
  };
  return dto.storyWorkspaceArtifactIndexObservationDto.parse({
    ...payload,
    etag: `sha256:${createHash("sha256").update(canonicalContractJson(payload)).digest("hex")}`,
  });
}

function sameIndex(index: ReturnType<typeof canonicalIndex>, row: StoryWorkspaceArtifactIndexRow) {
  const p = index.projection;
  return row.story_id === index.storyId && row.source_thread_ref === index.threadId && row.identifier === p.source_project_id
    && row.title === p.title && row.source_run_id === index.runId && row.episode_count === p.episode_count
    && row.artifact_manifest_revision === p.artifact_manifest_revision && row.script_revision === p.script_revision
    && row.script_size_bytes === p.script_size_bytes && row.artifact_sync_status === "indexed"
    && row.artifact_indexed_at !== null && row.artifact_sync_error_code === null
    && row.artifact_status === "available" && row.reconcile_version === 1;
}

async function writeIndex(store: StoryWorkspaceArtifactRepository, index: ReturnType<typeof canonicalIndex>, expectedEtag: string | null) {
  await store.lockIndexKey(index.workspaceId, index.projection.source_project_id);
  const rows = await store.indexRecord(index.workspaceId, index.projection.source_project_id, true);
  if (rows.length > 1) throw new AuthBoundaryError("STORY_INDEX_CONFLICT", 409);
  const current = rows[0] ?? null;
  if (expectedEtag !== null && observation(index, current).etag !== expectedEtag) {
    throw new AuthBoundaryError("STORY_INDEX_REVISION_CONFLICT", 409);
  }
  if (current !== null && (current.story_id !== index.storyId || current.source_thread_ref !== index.threadId)) {
    throw new AuthBoundaryError("STORY_INDEX_CONFLICT", 409);
  }
  if (current !== null && sameIndex(index, current)) return { row: current, status: "same_revision" as const };
  if (current === null && await store.storyIdExists(index.storyId)) throw new AuthBoundaryError("STORY_INDEX_CONFLICT", 409);
  const next = current === null
    ? await store.insertIndex(index.storyId, index.actorId, index.workspaceId, index.threadId, index.runId, index.projection)
    : await store.updateIndex(current.story_id, index.runId, index.projection);
  if (!next) throw new AuthBoundaryError("STORY_INDEX_WRITE_FAILED");
  return { row: next, status: current === null ? "created" as const : "updated" as const };
}

export async function runStoryWorkspaceArtifactOperation(operation: dto.StoryWorkspaceArtifactOperation, rawInput: unknown,
  actor: StoryWorkspaceArtifactActor, serviceId: string, requestId: string, tx: DataTransaction) {
  const contract = dto.storyWorkspaceArtifactOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const store = new StoryWorkspaceArtifactRepository(tx);

  if (operation === "story-workspace-artifact.runs") {
    if (actor.threadScope !== null || actor.runScope !== null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
    const input = dto.storyWorkspaceArtifactRunsInputDto.parse(parsed.data);
    const rows = await store.listAuthorities(principal.canonical_user_id, input);
    const page = rows.slice(0, input.limit);
    const decoded = page.map(row => ({ row, launch: decodeLaunch(row, principal.canonical_user_id) }))
      .filter((item): item is { row: StoryWorkspaceArtifactAuthorityRow; launch: NonNullable<ReturnType<typeof decodeLaunch>> } => item.launch !== null && manifestSupportsDream(item.row.release_manifest_json));
    const titleRows = await store.storyTitles(decoded.map(item => item.row.workflow_run_id), decoded.map(item => ({ workspaceId: item.row.workspace_id, projectId: item.launch.project })));
    const titles = titleMaps(titleRows);
    const confirmations = confirmationMap(await store.confirmationRows(decoded.map(item => item.row.thread_id)), decoded.map(item => item.row), principal.canonical_user_id);
    const outputs = decoded.map(({ row, launch }) => authorityOutput(row, launch,
      titles.byRun.get(row.workflow_run_id) ?? titles.byProject.get(`${row.workspace_id}\0${launch.project}`) ?? null,
      confirmations.get(row.workflow_run_id) ?? { accepted: false, dispatched: false })).filter((value): value is dto.StoryWorkspaceArtifactAuthority => value !== null);
    const last = page.at(-1);
    return dto.storyWorkspaceArtifactRunsOutputDto.parse({ runs: outputs,
      next_cursor: rows.length > input.limit && last ? { created_at: projectWorkflowTimestamp(last.created_at), workflow_run_id: last.workflow_run_id } : null });
  }

  const runId = (parsed.data as { workflow_run_id: string }).workflow_run_id;
  if (operation === "story-workspace-artifact.authority") {
    const { row, launch } = await loadAuthority(store, principal.canonical_user_id, runId, actor, false);
    const titleRows = await store.storyTitles([runId], [{ workspaceId: row.workspace_id, projectId: launch.project }]);
    const titles = titleMaps(titleRows);
    const confirmations = confirmationMap(await store.confirmationRows([row.thread_id]), [row], principal.canonical_user_id);
    const output = authorityOutput(row, launch, titles.byRun.get(runId) ?? titles.byProject.get(`${row.workspace_id}\0${launch.project}`) ?? null,
      confirmations.get(runId) ?? { accepted: false, dispatched: false });
    if (!output) throw new AuthBoundaryError("WORKFLOW_RUN_DATA_INVALID");
    return dto.storyWorkspaceArtifactAuthorityOutputDto.parse({ authority: output });
  }

  const receipt = new ReceiptRepository(tx, serviceId, principal.subject);
  if (operation === "story-workspace-artifact.episode-authority.ensure") {
    const input = dto.storyWorkspaceEpisodeAuthorityEnsureInputDto.parse(parsed.data);
    return receipt.execute(operation, requestId, input, dto.storyWorkspaceEpisodeAuthorityEnsureOutputDto, async () => {
      const { row, launch } = await loadAuthority(store, principal.canonical_user_id, runId, actor, true);
      if (input.story_slug !== launch.project) throw new AuthBoundaryError("STORY_WORKSPACE_AUTHORITY_CONFLICT", 409);
      if (launch.episode !== null) {
        if (launch.episode.story_slug !== input.story_slug || launch.episode.episode_code !== input.episode_code) throw new AuthBoundaryError("STORY_WORKSPACE_AUTHORITY_CONFLICT", 409);
        if (launch.metadata.projectStorySlug !== input.story_slug) {
          if (row.source_message_id === null || row.source_metadata === null
            || !await store.compareAndSetSourceMetadata(row.source_message_id, row.source_metadata,
              canonicalContractJson({ ...launch.metadata, projectStorySlug: input.story_slug }))) {
            throw new AuthBoundaryError("STORY_WORKSPACE_AUTHORITY_CONFLICT", 409);
          }
        }
        return { authority: launch.episode, replayed: true };
      }
      if (row.source_message_id === null || row.source_metadata === null) throw new AuthBoundaryError("WORKFLOW_RUN_DATA_INVALID");
      const authority = dto.storyWorkspaceEpisodeAuthorityDto.parse({ schema: "story-workspace-episode-authority/v1",
        workflow_run_id: runId, episode_uid: randomUUID().replaceAll("-", ""), story_slug: input.story_slug, episode_code: input.episode_code });
      const metadata = { ...launch.metadata, projectStorySlug: input.story_slug, story_workspace_episode_identity: authority };
      if (!await store.compareAndSetSourceMetadata(row.source_message_id, row.source_metadata, canonicalContractJson(metadata))) {
        throw new AuthBoundaryError("STORY_WORKSPACE_AUTHORITY_CONFLICT", 409);
      }
      return { authority, replayed: false };
    }, rowScope(actor), null, runId);
  }

  if (operation === "story-workspace-artifact.output-ready") {
    const input = dto.storyWorkspaceArtifactOutputReadyInputDto.parse(parsed.data);
    return receipt.execute(operation, requestId, input, dto.storyWorkspaceArtifactOutputReadyOutputDto, async () => {
      const { row } = await loadAuthority(store, principal.canonical_user_id, runId, actor, true);
      let current = { workflow_run_id: row.workflow_run_id, status: row.status, status_version: row.status_version };
      if (["pending_review", "confirmed", "rejected", "completed"].includes(current.status)) {
        return dto.storyWorkspaceArtifactOutputReadyOutputDto.parse({ ...current, replayed: true });
      }
      const transitions = [["running", "output_validating", "dream_required_stages_present"], ["output_validating", "pending_review", "dream_output_contract_valid"]] as const;
      for (const [from, target, reason] of transitions) {
        if (current.status !== from) continue;
        const next = await store.advanceRun(current, target, principal.canonical_user_id, reason,
          `wrt_${randomUUID().replaceAll("-", "")}`, await store.clockText());
        if (!next) throw new AuthBoundaryError("ILLEGAL_RUN_TRANSITION", 409);
        current = next;
      }
      if (current.status !== "pending_review") throw new AuthBoundaryError("ILLEGAL_RUN_TRANSITION", 409);
      return dto.storyWorkspaceArtifactOutputReadyOutputDto.parse({ ...current, replayed: false });
    }, rowScope(actor), null, runId);
  }

  const reconcileInput = operation === "story-workspace-artifact.index.reconcile"
    ? dto.storyWorkspaceArtifactIndexReconcileInputDto.parse(parsed.data)
    : null;
  const input = dto.storyWorkspaceArtifactIndexInputDto.parse(parsed.data);
  const executeIndex = async (write: boolean, expected: string | null) => {
    const { row, launch } = await loadAuthority(store, principal.canonical_user_id, runId, actor, write);
    const index = canonicalIndex(principal.canonical_user_id, row, launch, input.projection);
    if (!write) {
      const records = await store.indexRecord(index.workspaceId, index.projection.source_project_id, false);
      if (records.length > 1) throw new AuthBoundaryError("STORY_INDEX_CONFLICT", 409);
      return { observation: observation(index, records[0] ?? null), write_status: null };
    }
    const result = await writeIndex(store, index, expected);
    return { observation: observation(index, result.row), write_status: result.status };
  };
  if (operation === "story-workspace-artifact.index.inspect") return dto.storyWorkspaceArtifactIndexOutputDto.parse(await executeIndex(false, null));
  const expected = reconcileInput?.expected_etag ?? null;
  return receipt.execute(operation, requestId, input, dto.storyWorkspaceArtifactIndexOutputDto,
    () => executeIndex(true, expected), rowScope(actor), null, runId);
}

function rowScope(actor: StoryWorkspaceArtifactActor) {
  return actor.threadScope;
}
