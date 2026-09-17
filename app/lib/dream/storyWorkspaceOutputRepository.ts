// [Input] Canonical actor, owned Thread and validated Story proposal in one caller-owned UOW.
// [Output] Typed Drizzle reconciliation of default Workspace, Story, Characters, Scenes and relations.
// [Pos] Registry109 Repository; no connection, commit, SQL selector or filesystem operation is caller-controlled.
// [Sync] 2026-09-15: preserve standalone proposal identity and reconciliation inside Admin.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  storyWorkspaceStories as stories,
  storyWorkspaceWorkspaces as workspaces,
} from "@ink-memory/db/schema";
import {
  chat_thread as threads,
  decks,
  story_workspace_characters as characters,
  story_workspace_scene_characters as sceneCharacters,
  story_workspace_scenes as scenes,
  story_workspace_story_characters as storyCharacters,
} from "@ink-memory/db/schema/dream";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { StoryWorkspaceOutputInput } from "./storyWorkspaceOutputDto";

export type StoryInsert = typeof stories.$inferInsert;
export type CharacterInsert = typeof characters.$inferInsert;
export type SceneInsert = typeof scenes.$inferInsert;

export class StoryWorkspaceOutputRepository {
  private readonly actor: string;

  constructor(private readonly tx: DataTransaction, actor: string) {
    this.actor = decimalIdDto.parse(actor);
  }

  async ownedThread(threadId: string) {
    return (await this.tx.select({ id: threads.id, deck_id: threads.deck_id })
      .from(threads)
      .where(and(eq(threads.id, threadId), eq(threads.user_id, sql`${this.actor}::bigint`)))
      .limit(1)
      .for("update"))[0] ?? null;
  }

  async deck(deckId: string | null) {
    if (deckId === null) return null;
    return (await this.tx.select({ id: decks.id, name: decks.name, name_zh: decks.name_zh, name_en: decks.name_en })
      .from(decks).where(eq(decks.id, deckId)).limit(1).for("share"))[0] ?? null;
  }

  async oldestWorkspace() {
    return (await this.tx.select({ id: workspaces.id }).from(workspaces)
      .where(eq(workspaces.owner_id, sql`${this.actor}::bigint`))
      .orderBy(asc(workspaces.created_at), asc(workspaces.id)).limit(1).for("share"))[0] ?? null;
  }

  async story(threadId: string, title: string) {
    return (await this.tx.select({ id: stories.id }).from(stories).where(and(
      eq(stories.agent_session_id, threadId),
      eq(stories.title, title),
      eq(stories.author_id, sql`${this.actor}::bigint`),
    )).orderBy(asc(stories.created_at), asc(stories.id)).limit(1).for("update"))[0] ?? null;
  }

  async insertStory(value: Omit<StoryInsert, "author_id">) {
    await this.tx.insert(stories).values({ ...value, author_id: sql`${this.actor}::bigint` });
  }

  async updateStory(id: string, workspaceId: string, story: StoryWorkspaceOutputInput["story"]) {
    await this.tx.update(stories).set({ description: story.description, status: "draft", review_status: "pending",
      type: story.type, content: story.content, workspace_id: workspaceId, agent_generated: 1,
      review_notes: null, confirmed_at: null, published_at: null, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(stories.id, id), eq(stories.author_id, sql`${this.actor}::bigint`)));
  }

  async currentCharacters(storyId: string) {
    return this.tx.select({ id: characters.id, name: characters.name }).from(characters)
      .innerJoin(storyCharacters, eq(storyCharacters.character_id, characters.id))
      .where(and(eq(storyCharacters.story_id, storyId), eq(characters.author_id, sql`${this.actor}::bigint`)));
  }

  async currentScenes(storyId: string) {
    return this.tx.select({ id: scenes.id, order_index: scenes.order_index }).from(scenes)
      .where(and(eq(scenes.story_id, storyId), eq(scenes.author_id, sql`${this.actor}::bigint`), eq(scenes.agent_generated, 1)))
      .orderBy(asc(scenes.created_at), asc(scenes.id));
  }

  async clearSceneCharacters(sceneIds: string[]) {
    if (sceneIds.length > 0) await this.tx.delete(sceneCharacters).where(inArray(sceneCharacters.scene_id, sceneIds));
  }

  async clearStoryCharacters(storyId: string) {
    await this.tx.delete(storyCharacters).where(eq(storyCharacters.story_id, storyId));
  }

  async insertCharacter(value: Omit<CharacterInsert, "author_id">) {
    await this.tx.insert(characters).values({ ...value, author_id: sql`${this.actor}::bigint` });
  }

  async updateCharacter(id: string, workspaceId: string, value: StoryWorkspaceOutputInput["story"]["characters"][number]) {
    await this.tx.update(characters).set({ identity: value.identity, personality: value.personality,
      background: value.background, catchphrase: value.catchphrase, tags: JSON.stringify(value.tags),
      workspace_id: workspaceId, review_status: "pending", agent_generated: 1,
      updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(characters.id, id), eq(characters.author_id, sql`${this.actor}::bigint`)));
  }

  async relateStoryCharacter(storyId: string, characterId: string) {
    await this.tx.insert(storyCharacters).values({ story_id: storyId, character_id: characterId, role_type: null });
  }

  async insertScene(value: Omit<SceneInsert, "author_id">) {
    await this.tx.insert(scenes).values({ ...value, author_id: sql`${this.actor}::bigint` });
  }

  async updateScene(id: string, workspaceId: string, characterCount: number,
    value: StoryWorkspaceOutputInput["story"]["scenes"][number]) {
    await this.tx.update(scenes).set({ name: value.name, description: value.description,
      workspace_id: workspaceId, character_count: characterCount, review_status: "pending",
      agent_generated: 1, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(scenes.id, id), eq(scenes.author_id, sql`${this.actor}::bigint`)));
  }

  async relateSceneCharacters(sceneId: string, characterIds: string[]) {
    if (characterIds.length > 0) await this.tx.insert(sceneCharacters)
      .values(characterIds.map(characterId => ({ scene_id: sceneId, character_id: characterId })));
  }

  async deleteScenes(storyId: string, ids: string[]) {
    if (ids.length > 0) await this.tx.delete(scenes).where(and(inArray(scenes.id, ids), eq(scenes.story_id, storyId),
      eq(scenes.author_id, sql`${this.actor}::bigint`), eq(scenes.agent_generated, 1)));
  }

  async updateStoryCounts(storyId: string, characterCount: number, sceneCount: number) {
    await this.tx.update(stories).set({ character_count: characterCount, scene_count: sceneCount,
      review_status: "pending", agent_generated: 1, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(stories.id, storyId), eq(stories.author_id, sql`${this.actor}::bigint`)));
  }

  async recountCharacter(characterId: string) {
    await this.tx.update(characters).set({ story_count: sql`(SELECT COUNT(*)::integer FROM ${storyCharacters}
      WHERE ${storyCharacters.character_id} = ${characterId})`, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(eq(characters.id, characterId));
  }
}

export function newStoryWorkspaceIdentity(prefix: "story" | "character" | "scene") {
  const id = randomUUID();
  return { id, identifier: `${prefix}-${id.slice(0, 8)}` };
}
