// [Input] Strict Registry109 proposal, verified actor and caller-owned Admin UOW.
// [Output] Idempotent pending-review Story graph plus source Thread/Deck projection.
// [Pos] DTO-Service-typed ORM composition; Dream retains parsing, Agent Runtime, SSE and files.
// [Sync] 2026-09-15: migrate standalone Story proposal persistence as one Admin transaction.
import { randomUUID } from "node:crypto";
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { WorkspaceDefaultRepository } from "./workspaceDefaultRepository";
import { newStoryWorkspaceIdentity, StoryWorkspaceOutputRepository } from "./storyWorkspaceOutputRepository";
import * as dto from "./storyWorkspaceOutputDto";

export const storyWorkspaceOutputSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;
export type StoryWorkspaceOutputActor = {
  principal: unknown;
  threadScope: string | null;
  runScope: string | null;
  editorSessionScope?: string | null;
};

export async function runStoryWorkspaceOutputOperation(
  operation: dto.StoryWorkspaceOutputOperation,
  rawInput: unknown,
  actor: StoryWorkspaceOutputActor,
  serviceId: string,
  requestId: string,
  tx: DataTransaction,
) {
  const contract = dto.storyWorkspaceOutputOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const input = parsed.data;
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if ((actor.threadScope !== null && actor.threadScope !== input.thread_id)
    || actor.runScope !== null || (actor.editorSessionScope ?? null) !== null) {
    throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  }

  const workspaceStore = new WorkspaceDefaultRepository(tx, principal.canonical_user_id);
  await workspaceStore.lockActor();
  const store = new StoryWorkspaceOutputRepository(tx, principal.canonical_user_id);
  const thread = await store.ownedThread(input.thread_id);
  if (!thread) throw new AuthBoundaryError("CHAT_THREAD_NOT_FOUND", 404);

  return new ReceiptRepository(tx, serviceId, principal.subject).execute(
    operation,
    requestId,
    input,
    contract.output,
    async () => {
      let workspace = await store.oldestWorkspace();
      if (!workspace) {
        const workspaceId = randomUUID();
        await workspaceStore.insert(workspaceId);
        workspace = { id: workspaceId };
      }

      let currentStory = await store.story(input.thread_id, input.story.title);
      if (!currentStory) {
        const identity = newStoryWorkspaceIdentity("story");
        await store.insertStory({
          ...identity,
          title: input.story.title,
          description: input.story.description,
          status: "draft",
          review_status: "pending",
          type: input.story.type,
          content: input.story.content,
          workspace_id: workspace.id,
          character_count: 0,
          scene_count: 0,
          agent_generated: 1,
          agent_session_id: input.thread_id,
        });
        currentStory = { id: identity.id };
      } else {
        await store.updateStory(currentStory.id, workspace.id, input.story);
      }

      const existingCharacterRows = await store.currentCharacters(currentStory.id);
      const existingCharacters = new Map(existingCharacterRows.map(row => [row.name, row.id]));
      const oldCharacterIds = existingCharacterRows.map(row => row.id);
      const existingSceneRows = await store.currentScenes(currentStory.id);
      const existingScenes = new Map<number, string>();
      const duplicateSceneIds: string[] = [];
      for (const row of existingSceneRows) {
        if (existingScenes.has(row.order_index)) duplicateSceneIds.push(row.id);
        else existingScenes.set(row.order_index, row.id);
      }
      const allExistingSceneIds = existingSceneRows.map(row => row.id);
      await store.clearSceneCharacters(allExistingSceneIds);
      await store.clearStoryCharacters(currentStory.id);

      const characterIds: string[] = [];
      for (const character of input.story.characters) {
        let characterId = existingCharacters.get(character.name);
        if (!characterId) {
          const identity = newStoryWorkspaceIdentity("character");
          characterId = identity.id;
          await store.insertCharacter({
            ...identity,
            name: character.name,
            identity: character.identity,
            personality: character.personality,
            background: character.background,
            catchphrase: character.catchphrase,
            tags: JSON.stringify(character.tags),
              workspace_id: workspace.id,
            story_count: 0,
            review_status: "pending",
            agent_generated: 1,
          });
        } else {
          await store.updateCharacter(characterId, workspace.id, character);
        }
        characterIds.push(characterId);
        await store.relateStoryCharacter(currentStory.id, characterId);
      }

      const sceneIds: string[] = [];
      const retainedSceneIds = new Set<string>();
      for (const scene of input.story.scenes) {
        let sceneId = existingScenes.get(scene.order_index);
        if (!sceneId) {
          const identity = newStoryWorkspaceIdentity("scene");
          sceneId = identity.id;
          await store.insertScene({
            ...identity,
            name: scene.name,
            description: scene.description,
            story_id: currentStory.id,
              workspace_id: workspace.id,
            character_count: characterIds.length,
            order_index: scene.order_index,
            review_status: "pending",
            agent_generated: 1,
          });
        } else {
          await store.updateScene(sceneId, workspace.id, characterIds.length, scene);
        }
        sceneIds.push(sceneId);
        retainedSceneIds.add(sceneId);
        await store.relateSceneCharacters(sceneId, characterIds);
      }

      const staleSceneIds = [...new Set([
        ...duplicateSceneIds,
        ...allExistingSceneIds.filter(id => !retainedSceneIds.has(id)),
      ])];
      await store.deleteScenes(currentStory.id, staleSceneIds);
      await store.updateStoryCounts(currentStory.id, characterIds.length, sceneIds.length);
      for (const characterId of [...new Set([...oldCharacterIds, ...characterIds])].sort()) {
        await store.recountCharacter(characterId);
      }

      const deck = await store.deck(thread.deck_id);
      return {
        story_id: currentStory.id,
        review_status: "pending" as const,
        character_ids: characterIds,
        scene_ids: sceneIds,
        chat_thread_id: thread.id,
        deck_id: thread.deck_id,
        deck_name: deck?.name ?? null,
        deck_name_zh: deck?.name_zh ?? null,
        deck_name_en: deck?.name_en ?? null,
      };
    },
    input.thread_id,
  );
}
