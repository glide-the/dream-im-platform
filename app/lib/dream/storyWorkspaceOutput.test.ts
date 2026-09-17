// [Input] Registry109 strict DTO, fixed actor and mocked typed Repository/receipt UOW seams.
// [Output] Reconciliation, authorization, default Workspace and idempotency-scope assertions.
// [Pos] Provider-free DTO-Service-ORM domain test; no PostgreSQL, filesystem or Runtime process.
// [Sync] 2026-09-15: prove standalone Story proposal persistence is one Admin-owned operation.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  lockActor: vi.fn(), oldestWorkspace: vi.fn(), insertWorkspace: vi.fn(), ownedThread: vi.fn(), deck: vi.fn(),
  story: vi.fn(), insertStory: vi.fn(), updateStory: vi.fn(), currentCharacters: vi.fn(), currentScenes: vi.fn(),
  clearSceneCharacters: vi.fn(), clearStoryCharacters: vi.fn(), insertCharacter: vi.fn(), updateCharacter: vi.fn(),
  relateStoryCharacter: vi.fn(), insertScene: vi.fn(), updateScene: vi.fn(), relateSceneCharacters: vi.fn(),
  deleteScenes: vi.fn(), updateStoryCounts: vi.fn(), recountCharacter: vi.fn(), receiptExecute: vi.fn(),
  identities: vi.fn(),
}));
vi.mock("./workspaceDefaultRepository", () => ({ WorkspaceDefaultRepository: class {
  lockActor = mocks.lockActor; oldestOwned = vi.fn(); insert = mocks.insertWorkspace;
}}));
vi.mock("./storyWorkspaceOutputRepository", () => ({
  StoryWorkspaceOutputRepository: class {
    oldestWorkspace = mocks.oldestWorkspace; ownedThread = mocks.ownedThread; deck = mocks.deck; story = mocks.story;
    insertStory = mocks.insertStory; updateStory = mocks.updateStory; currentCharacters = mocks.currentCharacters;
    currentScenes = mocks.currentScenes; clearSceneCharacters = mocks.clearSceneCharacters;
    clearStoryCharacters = mocks.clearStoryCharacters; insertCharacter = mocks.insertCharacter;
    updateCharacter = mocks.updateCharacter; relateStoryCharacter = mocks.relateStoryCharacter;
    insertScene = mocks.insertScene; updateScene = mocks.updateScene; relateSceneCharacters = mocks.relateSceneCharacters;
    deleteScenes = mocks.deleteScenes; updateStoryCounts = mocks.updateStoryCounts; recountCharacter = mocks.recountCharacter;
  },
  newStoryWorkspaceIdentity: mocks.identities,
}));
vi.mock("./receipts", () => ({ ReceiptRepository: class {
  execute(...args: unknown[]) { return mocks.receiptExecute(...args); }
}}));

import type { DataTransaction } from "./database";
import { storyWorkspaceOutputInputDto, storyWorkspaceOutputResultDto } from "./storyWorkspaceOutputDto";
import { runStoryWorkspaceOutputOperation } from "./storyWorkspaceOutputService";

const input = { thread_id: "thread-1", story: { title: "午夜咖啡馆", description: "雨夜故事", type: "script" as const,
  content: "# 第一幕", characters: [
    { name: "林小雨", identity: "咖啡师", personality: "温柔", background: null, catchphrase: null, tags: ["温柔"] },
    { name: "周晴", identity: "店主", personality: null, background: null, catchphrase: null, tags: [] },
  ], scenes: [
    { name: "雨夜", description: "开场", order_index: 0 },
    { name: "清晨", description: "结尾", order_index: 1 },
  ] } };
const actor = { principal: { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:read", "dream:write"], status: "active" }, threadScope: "thread-1", runScope: null };
const tx = {} as DataTransaction;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.ownedThread.mockResolvedValue({ id: "thread-1", deck_id: "deck-1" });
  mocks.deck.mockResolvedValue({ id: "deck-1", name: "Dream", name_zh: "梦", name_en: "Dream" });
  mocks.oldestWorkspace.mockResolvedValue({ id: "workspace-1" });
  mocks.story.mockResolvedValue(null); mocks.currentCharacters.mockResolvedValue([]); mocks.currentScenes.mockResolvedValue([]);
  let index = 0; mocks.identities.mockImplementation((prefix: string) => ({ id: `${prefix}-${++index}`, identifier: `${prefix}-id` }));
  mocks.receiptExecute.mockImplementation(async (_operation, _requestId, _input, _output, action) => action());
});

it("creates and relates a complete bundle through one Thread-scoped receipt", async () => {
  const result = await runStoryWorkspaceOutputOperation("story-workspace-output.store", input, actor,
    "dream-service", "request-1", tx);
  expect(result).toEqual({ story_id: "story-1", review_status: "pending",
    character_ids: ["character-2", "character-3"], scene_ids: ["scene-4", "scene-5"],
    chat_thread_id: "thread-1", deck_id: "deck-1", deck_name: "Dream", deck_name_zh: "梦", deck_name_en: "Dream" });
  expect(storyWorkspaceOutputResultDto.safeParse(result).success).toBe(true);
  expect(mocks.lockActor).toHaveBeenCalledOnce();
  expect(mocks.ownedThread).toHaveBeenCalledExactlyOnceWith("thread-1");
  expect(mocks.receiptExecute).toHaveBeenCalledWith("story-workspace-output.store", "request-1", input,
    storyWorkspaceOutputResultDto, expect.any(Function), "thread-1");
  expect(mocks.insertStory).toHaveBeenCalledWith(expect.objectContaining({ title: "午夜咖啡馆",
    workspace_id: "workspace-1", agent_session_id: "thread-1", review_status: "pending" }));
  expect(mocks.relateStoryCharacter).toHaveBeenCalledTimes(2);
  expect(mocks.relateSceneCharacters).toHaveBeenCalledTimes(2);
  expect(mocks.updateStoryCounts).toHaveBeenCalledWith("story-1", 2, 2);
});

it("reuses established identities, deletes stale scenes and recomputes affected character counts", async () => {
  mocks.story.mockResolvedValue({ id: "story-existing" });
  mocks.currentCharacters.mockResolvedValue([{ id: "char-old", name: "林小雨" }, { id: "char-stale", name: "旧角色" }]);
  mocks.currentScenes.mockResolvedValue([{ id: "scene-old", order_index: 0 }, { id: "scene-duplicate", order_index: 0 },
    { id: "scene-stale", order_index: 9 }]);
  const result = await runStoryWorkspaceOutputOperation("story-workspace-output.store", input, actor,
    "dream-service", "request-2", tx);
  expect(result.character_ids[0]).toBe("char-old"); expect(result.scene_ids[0]).toBe("scene-old");
  expect(mocks.updateStory).toHaveBeenCalledWith("story-existing", "workspace-1", input.story);
  expect(mocks.clearSceneCharacters).toHaveBeenCalledWith(["scene-old", "scene-duplicate", "scene-stale"]);
  expect(mocks.deleteScenes).toHaveBeenCalledWith("story-existing", ["scene-duplicate", "scene-stale"]);
  expect(mocks.recountCharacter.mock.calls.map(call => call[0])).toEqual(["char-old", "char-stale", "character-1"]);
});

it("creates the configured default Workspace inside the same receipt action", async () => {
  mocks.oldestWorkspace.mockResolvedValue(null);
  await runStoryWorkspaceOutputOperation("story-workspace-output.store", input, actor, "service", "request", tx);
  expect(mocks.insertWorkspace).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/));
  expect(mocks.insertStory).toHaveBeenCalledWith(expect.objectContaining({ workspace_id: mocks.insertWorkspace.mock.calls[0][0] }));
});

it("rejects duplicate bundle identities and caller-controlled authority selectors", async () => {
  expect(storyWorkspaceOutputInputDto.safeParse({ ...input, story: { ...input.story,
    characters: [...input.story.characters, input.story.characters[0]] } }).success).toBe(false);
  expect(storyWorkspaceOutputInputDto.safeParse({ ...input, story: { ...input.story,
    scenes: [...input.story.scenes, { ...input.story.scenes[0], name: "重复" }] } }).success).toBe(false);
  for (const key of ["actor_id", "user_id", "workspace_id", "sql", "table", "column", "path"])
    expect(storyWorkspaceOutputInputDto.safeParse({ ...input, [key]: "caller" }).success).toBe(false);
  for (const order_index of [-2_147_483_649, 2_147_483_648])
    expect(storyWorkspaceOutputInputDto.safeParse({ ...input, story: { ...input.story,
      scenes: [{ ...input.story.scenes[0], order_index }] } }).success).toBe(false);
});

it("fails before receipt or graph mutation for a missing Thread or altered delegation", async () => {
  mocks.ownedThread.mockResolvedValueOnce(null);
  await expect(runStoryWorkspaceOutputOperation("story-workspace-output.store", input, actor, "service", "missing", tx))
    .rejects.toMatchObject({ code: "CHAT_THREAD_NOT_FOUND", status: 404 });
  await expect(runStoryWorkspaceOutputOperation("story-workspace-output.store", input,
    { ...actor, threadScope: "other" }, "service", "scope", tx))
    .rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
  expect(mocks.receiptExecute).not.toHaveBeenCalled();
});
