// [Input] Complete stored Workflow launch/retry facts and injected canonical serialization boundary.
// [Output] Active/current-Agent resolution, terminal ordinary Chat and integrity/ownership refusals.
// [Pos] Provider-free production resolver contract tests; no copied SQL or test runtime branch.
// [Sync] 2026-09-14: cover graph, frozen provenance and capacity independently of token lifetime.
import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ canonical: vi.fn(), thread: vi.fn(), attempts: vi.fn() }));
vi.mock("./deckContentCanonical", () => ({ canonicalBusinessJson: mocks.canonical }));
vi.mock("./workflowContextRepository", () => ({ WorkflowContextRepository: class { thread = mocks.thread; attempts = mocks.attempts; } }));
import { resolveWorkflowContextFacts, authoritativeWorkflowContext } from "./workflowContextService";
import { workflowContextInputDto } from "./workflowContextDto";
import { canonicalContractJson } from "./operationRegistry";
import type { DataTransaction } from "./database";
const actor = "9007199254740993", rootId = `run_${"a".repeat(32)}`, leafId = `run_${"b".repeat(32)}`;
const thread = { id: "thread1", user_id: actor, deck_id: "deck1", voice_id: "current-agent" };
const goal = "写一段记忆 ☁️";
const sha = (value: unknown) => `sha256:${createHash("sha256").update(canonicalContractJson(value)).digest("hex")}`;
function metadata() { return { kind: "story-workspace-dream-launch", schemaVersion: "story-workspace-dream-launch/v1", visibility: "system-hidden", actorId: actor, workspaceId: "workspace1", deckId: "deck1", threadId: thread.id, workflowRunId: rootId, goal, agentId: "launch-agent", projectStorySlug: null, requestFingerprint: sha({ deck_id: "deck1", goal, agent_id: "launch-agent" }) }; }
function attempt() { return { workflow_run_id: rootId, retry_of_run_id: null as string | null, status: "running", workspace_id: "workspace1", created_by: actor, source_voice_thread_id: thread.id, source_message_id: "source1", source_message_time: "2026-09-14 00:00:00.123456+00", source_message_thread_id: thread.id, source_message_role: "user", source_message_metadata: JSON.stringify(metadata()), input_hash: sha({ goal }), workflow_definition_ref: "workflow:v1", deck_plugin_manifest_hash: "manifest:v1", deck_plugin_id: "plugin1", deck_plugin_version: "1.0.0", deck_plugin_binding_id: "binding1", binding_revision: 1, deck_runtime_snapshot_id: "snapshot1", runtime_plugin_lock_id: "lock1", workspace_owner_id: actor, binding_deck_id: "deck1", binding_workspace_id: "workspace1", binding_deck_plugin_id: "plugin1", binding_deck_plugin_version: "1.0.0", binding_revision_actual: 1 }; }
const resolve = (rows: unknown[], rawThread: unknown = thread, capacity = 256) => resolveWorkflowContextFacts(actor, thread.id, rawThread, rows, capacity);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.canonical.mockImplementation(async (raw: string) => ({ canonical_json: canonicalContractJson(JSON.parse(raw)), content_hash: sha(JSON.parse(raw)) }));
  mocks.thread.mockResolvedValue(thread); mocks.attempts.mockResolvedValue([attempt()]);
});
afterEach(() => vi.unstubAllEnvs());
describe("authoritative Workflow Thread context", () => {
  it("derives active context and uses current Agent without mutating launch provenance", async () => {
    expect(await resolve([attempt()])).toMatchObject({ workflow_run_id: rootId, thread_id: thread.id, agent_id: "current-agent", binding_revision: 1 });
    expect(mocks.canonical).toHaveBeenCalledWith(attempt().source_message_metadata);
  });
  it("selects a linear retry leaf while preserving root launch provenance", async () => {
    expect(await resolve([{ ...attempt(), status: "failed" }, { ...attempt(), workflow_run_id: leafId, retry_of_run_id: rootId, status: "queued" }])).toMatchObject({ workflow_run_id: leafId });
  });
  it.each(["rejected", "completed", "failed", "cancelled"])("returns ordinary Chat for valid terminal leaf %s", async status => {
    expect(await resolve([{ ...attempt(), status }])).toBeNull();
  });
  it("returns no authority for ordinary or missing owned Thread", async () => {
    expect(await resolve([])).toBeNull(); expect(await resolve([attempt()], null)).toBeNull();
  });
  it.each([
    [{ ...attempt(), workflow_run_id: "forged-run" }],
    [attempt(), attempt()],
    [{ ...attempt(), retry_of_run_id: leafId }],
    [attempt(), { ...attempt(), workflow_run_id: leafId }],
    [{ ...attempt(), retry_of_run_id: leafId }, { ...attempt(), workflow_run_id: leafId, retry_of_run_id: rootId }],
    [{ ...attempt(), status: "failed" }, { ...attempt(), workflow_run_id: leafId, retry_of_run_id: rootId }, { ...attempt(), workflow_run_id: `run_${"c".repeat(32)}`, retry_of_run_id: rootId }],
  ])("rejects invalid retry graph %#", async (...rows) => {
    await expect(resolve(rows)).rejects.toMatchObject({ code: "DREAM_THREAD_BINDING_CONFLICT", status: 409 });
  });
  it("refuses any changed frozen source even when leaf is terminal", async () => {
    await expect(resolve([{ ...attempt(), status: "failed" }, { ...attempt(), workflow_run_id: leafId, retry_of_run_id: rootId, status: "completed", source_message_time: "2026-09-14 00:00:00.123457+00" }])).rejects.toMatchObject({ status: 409 });
  });
  it.each([{ created_by: "2" }, { workspace_owner_id: "2" }, { binding_deck_id: "other" }, { binding_revision_actual: 2 }, { source_message_metadata: "[]" }, { source_message_time: null }, { status: "preflight" }, { status: "unknown" }])("refuses incomplete or mismatched facts %j", async changed => {
    await expect(resolve([{ ...attempt(), ...changed }])).rejects.toMatchObject({ status: 409 });
  });
  it.each([{ actorId: "2" }, { workflowRunId: leafId }, { visibility: "visible" }, { projectStorySlug: "different" }, { agentId: " launch-agent" }, { requestFingerprint: sha({ goal }) }])("rejects forged launch provenance %j", async changed => {
    await expect(resolve([{ ...attempt(), source_message_metadata: JSON.stringify({ ...metadata(), ...changed }) }])).rejects.toMatchObject({ status: 409 });
  });
  it("accepts exact original fallback slug and null current Agent", async () => {
    const projectStorySlug = `proj-${createHash("sha256").update(goal).digest("hex").slice(0, 8)}`;
    expect(await resolve([{ ...attempt(), source_message_metadata: JSON.stringify({ ...metadata(), projectStorySlug }) }], { ...thread, voice_id: null })).toMatchObject({ agent_id: null });
  });
  it("refuses active parents, current owner/Agent mismatch and over-capacity", async () => {
    await expect(resolve([attempt(), { ...attempt(), workflow_run_id: leafId, retry_of_run_id: rootId }])).rejects.toMatchObject({ status: 409 });
    await expect(resolve([attempt()], { ...thread, user_id: "2" })).rejects.toMatchObject({ status: 409 });
    await expect(resolve([attempt()], { ...thread, voice_id: " agent" })).rejects.toMatchObject({ status: 409 });
    await expect(resolve([attempt(), attempt()], thread, 1)).rejects.toMatchObject({ status: 409 });
  });
  it("uses one owner query and explicit server capacity; caller selectors are forbidden", async () => {
    vi.stubEnv("DREAM_WORKFLOW_CONTEXT_MAX_ATTEMPTS", "12");
    expect(await authoritativeWorkflowContext({} as DataTransaction, actor, thread.id)).toMatchObject({ workflow_run_id: rootId });
    expect(mocks.thread).toHaveBeenCalledWith(actor, thread.id); expect(mocks.attempts).toHaveBeenCalledWith(thread.id, 12);
    expect(workflowContextInputDto.safeParse({ thread_id: thread.id, run_id: rootId }).success).toBe(false);
    vi.stubEnv("DREAM_WORKFLOW_CONTEXT_MAX_ATTEMPTS", "0");
    await expect(authoritativeWorkflowContext({} as DataTransaction, actor, thread.id)).rejects.toMatchObject({ code: "WORKFLOW_CONTEXT_POLICY_INVALID" });
  });
});
