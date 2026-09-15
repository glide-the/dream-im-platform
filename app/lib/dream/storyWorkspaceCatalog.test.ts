// [Input] Registry114 strict DTOs, OAuth principals, and mocked Repository/default/receipt seams.
// [Output] Read/write scope, nonempty patch, idempotent Workspace, and closed-selector assertions.
// [Pos] Provider-free catalog service test; PostgreSQL behavior has a restricted-role integration harness.
// [Sync] 2026-09-15: prove DTO-Service-Repository composition for catalog browse and edit.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  read: vi.fn(), patch: vi.fn(), workspace: vi.fn(), patchWorkspace: vi.fn(), audit: vi.fn(),
  lockActor: vi.fn(), oldestOwned: vi.fn(), insert: vi.fn(), execute: vi.fn(),
}));
vi.mock("./storyWorkspaceCatalogRepository", () => ({ StoryWorkspaceCatalogRepository: class {
  read = mocks.read; patch = mocks.patch; workspace = mocks.workspace;
  patchWorkspace = mocks.patchWorkspace; audit = mocks.audit;
}}));
vi.mock("./workspaceDefaultRepository", () => ({ WorkspaceDefaultRepository: class {
  lockActor = mocks.lockActor; oldestOwned = mocks.oldestOwned; insert = mocks.insert;
}}));
vi.mock("./receipts", () => ({ ReceiptRepository: class {
  execute(...args: unknown[]) { return mocks.execute(...args); }
}}));

import type { DataTransaction } from "./database";
import { storyWorkspaceCatalogPatchInputDto, storyWorkspaceCatalogReadInputDto } from "./storyWorkspaceCatalogDto";
import { runStoryWorkspaceCatalogOperation } from "./storyWorkspaceCatalogService";

const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:read", "dream:write"], status: "active" };
const time = "2026-09-15T01:02:03.000Z";
const workspace = { id: "workspace-1", name: "默认工作区", settings: {}, created_at: time, updated_at: time };
const story = { id: "story-1", identifier: "story-one", title: "标题", description: null,
  status: "draft", review_status: "pending", review_notes: null, type: "short",
  character_count: 0, scene_count: 0, created_at: time, updated_at: time, confirmed_at: null,
  source_run_id: null, source_project_id: null, episode_count: null, artifact_status: null,
  artifact_manifest_revision: null, script_revision: null, artifact_sync_status: null,
  artifact_indexed_at: null, artifact_sync_error_code: null, script_size_bytes: null,
  artifact_available: null, reconcile_version: null } as const;
const tx = {} as DataTransaction;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.execute.mockImplementation(async (_operation, _requestId, _input, _output, action) => action());
  mocks.read.mockResolvedValue({ view: "story_list", data: [story], pagination: {
    page: 1, per_page: 20, total: 1, total_pages: 1 } });
  mocks.oldestOwned.mockResolvedValue({ id: "workspace-1" }); mocks.workspace.mockResolvedValue(workspace);
  mocks.patch.mockResolvedValue({ resource_type: "story", item: { ...story, title: "新标题" } });
});

it("runs one owner-scoped read without a write receipt", async () => {
  const input = { view: "story_list", q: null, review_status: [], status: [], type: [],
    sort: "updated_at", order: "desc", page: 1, per_page: 20 } as const;
  const result = await runStoryWorkspaceCatalogOperation("story-workspace-catalog.read", input,
    principal, "dream-service", "catalog-read", tx);
  expect(result).toMatchObject({ view: "story_list", data: [{ id: "story-1" }] });
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(input); expect(mocks.execute).not.toHaveBeenCalled();
});

it("serializes default Workspace ensure behind the original receipt and audits it", async () => {
  const result = await runStoryWorkspaceCatalogOperation("story-workspace-catalog.workspace", { action: "ensure" },
    principal, "dream-service", "workspace-original", tx);
  expect(result).toEqual({ action: "ensure", item: workspace });
  expect(mocks.lockActor).toHaveBeenCalledOnce(); expect(mocks.insert).not.toHaveBeenCalled();
  expect(mocks.audit).toHaveBeenCalledExactlyOnceWith("workspace-original",
    "dream.story-workspace-catalog.ensure", "story_workspace_workspace", "workspace-1");
  expect(mocks.execute).toHaveBeenCalledOnce();
});

it("rejects empty patches and caller-selected persistence fields", async () => {
  await expect(runStoryWorkspaceCatalogOperation("story-workspace-catalog.patch",
    { resource_type: "story", resource_id: "story-1", patch: {} }, principal,
    "dream-service", "empty", tx)).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
  const read = { view: "story_detail", resource_id: "story-1" };
  for (const key of ["actor_id", "user_id", "workspace_id", "table", "column", "sql", "path", "transaction"])
    expect(storyWorkspaceCatalogReadInputDto.safeParse({ ...read, [key]: "caller" }).success).toBe(false);
  expect(storyWorkspaceCatalogPatchInputDto.safeParse({ resource_type: "story", resource_id: "story-1",
    patch: { author_id: "caller" } }).success).toBe(false);
  expect(mocks.patch).not.toHaveBeenCalled();
});

it("requires read/write scopes before Repository work", async () => {
  await expect(runStoryWorkspaceCatalogOperation("story-workspace-catalog.read",
    { view: "story_detail", resource_id: "story-1" }, { ...principal, scopes: ["dream:write"] },
    "service", "read-denied", tx)).rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
  await expect(runStoryWorkspaceCatalogOperation("story-workspace-catalog.patch",
    { resource_type: "story", resource_id: "story-1", patch: { title: "新标题" } },
    { ...principal, scopes: ["dream:read"] }, "service", "write-denied", tx))
    .rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
});
