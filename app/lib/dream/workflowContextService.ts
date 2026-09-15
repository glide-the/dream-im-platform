// [Input] Stored owned Thread, complete retry graph, binding and launch-message provenance.
// [Output] Unique active retry leaf context; terminal/ordinary Chat null after integrity validation.
// [Pos] Port of the production DreamThreadContextMapper; no request-authored execution authority.
// [Sync] 2026-09-14: preserve frozen tuples, Python hashes, current Agent and terminal persistence semantics.
import { createHash } from "node:crypto";
import { z } from "zod";
import { workflowContextAttemptCapacity } from "../../../config/dream-domain-policy";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { WorkflowContextRepository } from "./workflowContextRepository";
import { workflowRunContextDto, type WorkflowRunContext } from "./workflowContextDto";
import { canonicalBusinessJson } from "./deckContentCanonical";
import { stripPythonString } from "./deckPluginManifestDto";

const nonempty = z.string().refine(value => stripPythonString(value).length > 0);
const threadFactsDto = z.strictObject({ id: z.string(), user_id: decimalIdDto, deck_id: z.string().nullable(), voice_id: z.string().nullable() });
const attemptFactsDto = z.strictObject({
  workflow_run_id: nonempty, retry_of_run_id: nonempty.nullable(), status: nonempty, workspace_id: nonempty, created_by: decimalIdDto,
  source_voice_thread_id: nonempty, source_message_id: nonempty, source_message_time: nonempty,
  source_message_thread_id: nonempty, source_message_role: nonempty, source_message_metadata: nonempty,
  input_hash: nonempty, workflow_definition_ref: nonempty, deck_plugin_manifest_hash: nonempty, deck_plugin_id: nonempty,
  deck_plugin_version: nonempty, deck_plugin_binding_id: nonempty, binding_revision: z.number().int().safe(),
  deck_runtime_snapshot_id: nonempty, runtime_plugin_lock_id: nonempty, workspace_owner_id: decimalIdDto.nullable(),
  binding_deck_id: z.string().nullable(), binding_workspace_id: z.string().nullable(), binding_deck_plugin_id: z.string().nullable(),
  binding_deck_plugin_version: z.string().nullable(), binding_revision_actual: z.number().int().safe().nullable(),
});
type Attempt = z.infer<typeof attemptFactsDto> & { metadata: Record<string, unknown>; canonicalMetadata: string };
const terminalStatuses = new Set(["rejected", "completed", "failed", "cancelled"]);
const retryParentStatuses = new Set(["failed", "rejected", "cancelled"]);
const activeStatuses = new Set(["queued", "running", "output_validating", "pending_review", "confirmed"]);
const conflict = () => { throw new AuthBoundaryError("DREAM_THREAD_BINDING_CONFLICT", 409); };
function frozenSource(row: Attempt) {
  return JSON.stringify([row.workspace_id, row.deck_plugin_id, row.deck_plugin_version, row.workflow_definition_ref,
    row.deck_runtime_snapshot_id, row.deck_plugin_manifest_hash, row.deck_plugin_binding_id, row.binding_revision,
    row.runtime_plugin_lock_id, row.input_hash, row.source_voice_thread_id, row.source_message_id, row.source_message_time,
    row.source_message_thread_id, row.source_message_role, row.canonicalMetadata]);
}
function retryLeaf(rows: Attempt[]) {
  const byId = new Map(rows.map(row => [row.workflow_run_id, row]));
  if (byId.size !== rows.length || rows.some(row => !/^run_[0-9a-f]{32}$/.test(row.workflow_run_id))) return conflict();
  const children = new Map(rows.map(row => [row.workflow_run_id, [] as string[]]));
  const roots: string[] = [];
  for (const row of rows) {
    if (row.retry_of_run_id === null) roots.push(row.workflow_run_id);
    else {
      const parent = children.get(row.retry_of_run_id);
      if (!parent) return conflict();
      parent.push(row.workflow_run_id);
    }
  }
  if (roots.length !== 1 || [...children.values()].some(items => items.length > 1)) return conflict();
  const visited = new Set<string>(); let cursor = roots[0];
  for (;;) {
    if (visited.has(cursor)) return conflict();
    visited.add(cursor);
    const next = children.get(cursor)!;
    if (!next.length) break;
    cursor = next[0];
  }
  if (visited.size !== rows.length || rows.some(row => frozenSource(row) !== frozenSource(rows[0]))) return conflict();
  return { root: byId.get(roots[0])!, leaf: byId.get(cursor)! };
}
function objectMetadata(raw: string) {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* bounded binding conflict without stored body */ }
  return conflict();
}
export async function resolveWorkflowContextFacts(canonicalUserId: string, threadId: string, rawThread: unknown, rawAttempts: unknown[], capacity: number): Promise<WorkflowRunContext | null> {
  decimalIdDto.parse(canonicalUserId);
  if (rawThread === null || !rawAttempts.length) return null;
  if (rawAttempts.length > capacity) return conflict();
  const parsedThread = threadFactsDto.safeParse(rawThread);
  if (!parsedThread.success) return conflict();
  const thread = parsedThread.data;
  if (thread.id !== threadId || thread.user_id !== canonicalUserId || !thread.deck_id || (thread.voice_id !== null && (!thread.voice_id || thread.voice_id !== stripPythonString(thread.voice_id)))) return conflict();
  const rows: Attempt[] = [];
  const canonicalMetadataCache = new Map<string, string>();
  for (const raw of rawAttempts) {
    const parsed = attemptFactsDto.safeParse(raw);
    if (!parsed.success) return conflict();
    const row = parsed.data;
    if (row.created_by !== canonicalUserId || row.source_voice_thread_id !== threadId || row.workspace_owner_id !== canonicalUserId || row.binding_deck_id !== thread.deck_id || row.binding_workspace_id !== row.workspace_id || row.binding_deck_plugin_id !== row.deck_plugin_id || row.binding_deck_plugin_version !== row.deck_plugin_version || row.binding_revision_actual !== row.binding_revision) return conflict();
    const metadata = objectMetadata(row.source_message_metadata);
    let canonicalMetadata = canonicalMetadataCache.get(row.source_message_metadata);
    if (canonicalMetadata === undefined) {
      canonicalMetadata = (await canonicalBusinessJson(row.source_message_metadata)).canonical_json;
      canonicalMetadataCache.set(row.source_message_metadata, canonicalMetadata);
    }
    rows.push({ ...row, metadata, canonicalMetadata });
  }
  const { root, leaf } = retryLeaf(rows);
  const goal = root.metadata.goal, launchAgentId = root.metadata.agentId;
  if (typeof goal !== "string" || !stripPythonString(goal) || (launchAgentId !== undefined && launchAgentId !== null && (typeof launchAgentId !== "string" || !launchAgentId || launchAgentId !== stripPythonString(launchAgentId)))) return conflict();
  const fingerprint: Record<string, string> = { deck_id: thread.deck_id, goal };
  if (typeof launchAgentId === "string") fingerprint.agent_id = launchAgentId;
  const expectedFingerprint = (await canonicalBusinessJson(JSON.stringify(fingerprint))).content_hash;
  const expectedInput = (await canonicalBusinessJson(JSON.stringify({ goal }))).content_hash;
  const fallbackSlug = `proj-${createHash("sha256").update(goal, "utf8").digest("hex").slice(0, 8)}`;
  for (const row of rows) {
    const metadata = row.metadata;
    if (row.source_message_thread_id !== threadId || row.source_message_role !== "user" || metadata.kind !== "story-workspace-dream-launch" || metadata.schemaVersion !== "story-workspace-dream-launch/v1" || metadata.visibility !== "system-hidden" || metadata.actorId !== canonicalUserId || metadata.workspaceId !== leaf.workspace_id || metadata.deckId !== thread.deck_id || metadata.threadId !== threadId || metadata.workflowRunId !== root.workflow_run_id || (metadata.projectStorySlug !== undefined && metadata.projectStorySlug !== null && metadata.projectStorySlug !== fallbackSlug) || metadata.requestFingerprint !== expectedFingerprint || row.input_hash !== expectedInput) return conflict();
  }
  if (rows.some(row => row.workflow_run_id !== leaf.workflow_run_id && !retryParentStatuses.has(row.status))) return conflict();
  if (terminalStatuses.has(leaf.status)) return null;
  if (!activeStatuses.has(leaf.status)) return conflict();
  const context = workflowRunContextDto.safeParse({ workflow_run_id: leaf.workflow_run_id, thread_id: threadId, deck_id: thread.deck_id, agent_id: thread.voice_id, deck_plugin_id: leaf.deck_plugin_id, deck_plugin_version: leaf.deck_plugin_version, deck_plugin_binding_id: leaf.deck_plugin_binding_id, binding_revision: leaf.binding_revision, deck_runtime_snapshot_id: leaf.deck_runtime_snapshot_id, runtime_plugin_lock_id: leaf.runtime_plugin_lock_id });
  if (!context.success) return conflict();
  return context.data;
}
export async function authoritativeWorkflowContext(tx: DataTransaction, canonicalUserId: string, threadId: string) {
  const repository = new WorkflowContextRepository(tx);
  const thread = await repository.thread(canonicalUserId, threadId);
  if (!thread) return null;
  const capacity = workflowContextAttemptCapacity();
  return resolveWorkflowContextFacts(canonicalUserId, threadId, thread, await repository.attempts(threadId, capacity), capacity);
}
