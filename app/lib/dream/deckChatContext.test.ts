// [Input] Registry105 DTO, OAuth actor and typed Drizzle repository seams.
// [Output] Closed storage shapes, owner errors, status projection, ordering and one-UOW validation.
// [Pos] Provider-free Deck chat-context data gate; enabled/ready policy, prompt/Runtime/filesystem stay in Dream.
// [Sync] 2026-09-15: prove Admin returns status facts without executing Dream domain decisions.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataTransaction } from "./database";
import {
  deckChatContextInputDto,
  deckChatContextOperationContracts,
  deckChatContextOutputDto,
} from "./deckChatContextDto";
import type { DeckChatContextInput } from "./deckChatContextDto";
import { DeckChatContextRepository } from "./deckChatContextRepository";
import { runDeckChatContextOperation } from "./deckChatContextService";

const actor = {
  principal: {
    subject: "context-subject", canonical_user_id: "9007199254740993",
    client_id: "dream-browser", scopes: ["dream:read"], status: "active" as const,
  },
  threadScope: null,
};
const input = { deck_id: "deck-owned", voice_id: null };
const repositoryDeck = {
  id: input.deck_id, name: "创作组", name_zh: "创作组", name_en: null,
  description: "说明", description_zh: null, description_en: "Description", enabled: true,
};
const deck = repositoryDeck;
const voices = [
  { id: "voice-1", name: "Writer", name_zh: "编剧", name_en: "Writer", system_prompt: "写作😀", enabled: true },
  { id: "voice-2", name: "Editor", name_zh: null, name_en: null, system_prompt: "Review", enabled: true },
];
const pluginRefs = [
  {
    plugin_installation_id: "install-1", package_spec: "drama-forge@official",
    resolved_version: "1.2.3", artifact_digest: `sha256:${"a".repeat(64)}`,
    order_index: 0, enabled: true, installation_status: "ready" as const,
  },
  {
    plugin_installation_id: "install-2", package_spec: "pending@official",
    resolved_version: "2.0.0", artifact_digest: `sha256:${"b".repeat(64)}`,
    order_index: 2, enabled: true, installation_status: "error" as const,
  },
];
const output = { deck, voices, plugin_refs: pluginRefs };

afterEach(() => vi.restoreAllMocks());

describe("strict Deck chat-context DTO", () => {
  it("requires one Deck and explicit nullable Voice while preserving prompt bytes", () => {
    expect(deckChatContextInputDto.parse(input)).toEqual(input);
    expect(deckChatContextInputDto.parse({ ...input, voice_id: "voice-1" })).toEqual({ ...input, voice_id: "voice-1" });
    expect(deckChatContextOutputDto.parse(output)).toEqual(output);
    expect(deckChatContextOutputDto.parse(output).voices[0]?.system_prompt).toBe("写作😀");
    expect(deckChatContextOperationContracts["deck-chat-context.resolve"].kind).toBe("read");
  });

  it.each(["actor_id", "user_id", "thread_id", "prompt_mode", "dream_mode", "path", "sql", "table", "column"])(
    "rejects caller-authored %s",
    key => expect(deckChatContextInputDto.safeParse({ ...input, [key]: "caller" }).success).toBe(false),
  );

  it("rejects omitted nullable fields, extra stored fields and malformed provenance", () => {
    expect(deckChatContextInputDto.safeParse({ deck_id: input.deck_id }).success).toBe(false);
    expect(deckChatContextOutputDto.safeParse({ ...output, actor_id: "42" }).success).toBe(false);
    expect(deckChatContextOutputDto.safeParse({ ...output, plugin_refs: [{ ...pluginRefs[0], artifact_digest: "bad" }] }).success).toBe(false);
    expect(deckChatContextOutputDto.safeParse({ ...output, voices: [{ ...voices[0], owner_id: "42" }] }).success).toBe(false);
  });
});

describe("Deck chat-context service", () => {
  it("passes the validated actor and selection to one repository call", async () => {
    const resolve = vi.spyOn(DeckChatContextRepository.prototype, "resolve").mockResolvedValue(output);
    expect(await runDeckChatContextOperation("deck-chat-context.resolve", input, actor, {} as DataTransaction)).toEqual(output);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(input);
  });

  it("rejects invalid input, missing scope and entity delegation before repository I/O", async () => {
    const resolve = vi.spyOn(DeckChatContextRepository.prototype, "resolve");
    await expect(runDeckChatContextOperation("deck-chat-context.resolve", { ...input, user_id: "42" }, actor, {} as DataTransaction)).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
    await expect(runDeckChatContextOperation("deck-chat-context.resolve", input, { ...actor, principal: { ...actor.principal, scopes: ["dream:write"] } }, {} as DataTransaction)).rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
    await expect(runDeckChatContextOperation("deck-chat-context.resolve", input, { ...actor, threadScope: "thread-1" }, {} as DataTransaction)).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("fails closed when stored data does not satisfy the output DTO", async () => {
    vi.spyOn(DeckChatContextRepository.prototype, "resolve").mockResolvedValue({ ...output, voices: [{ ...voices[0], system_prompt: null }] } as never);
    await expect(runDeckChatContextOperation("deck-chat-context.resolve", input, actor, {} as DataTransaction)).rejects.toMatchObject({ code: "DECK_CHAT_CONTEXT_DATA_INVALID", status: 503 });
  });
});

type RepositoryRows = { deck: typeof repositoryDeck | null; voices: typeof voices; refs: typeof pluginRefs };
type CapturedCall = {
  projection: Record<string, unknown>;
  table?: unknown;
  joins: unknown[];
  where?: unknown;
  ordering: unknown[];
  limit?: number;
};
function capturedTransaction(rows: RepositoryRows) {
  const calls: CapturedCall[] = [];
  let index = 0;
  const database = {
    select(projection: Record<string, unknown>) {
      const call: CapturedCall = { projection, joins: [], ordering: [] };
      calls.push(call);
      const result = index++ === 0 ? (rows.deck === null ? [] : [rows.deck]) : index === 2 ? rows.voices : rows.refs;
      const chain = {
        from(table: unknown) { call.table = table; return chain; },
        innerJoin(...value: unknown[]) { call.joins.push(value); return chain; },
        where(value: unknown) { call.where = value; return chain; },
        orderBy(...value: unknown[]) { call.ordering = value; return Promise.resolve(result); },
        async limit(value: number) { call.limit = value; return result; },
      };
      return chain;
    },
  } as unknown as DataTransaction;
  return { database, calls };
}

const repositoryErrorCases: Array<[string, RepositoryRows, DeckChatContextInput, string, number]> = [
  ["missing Deck", { deck: null, voices: [], refs: [] }, input, "DECK_ACCESS_DENIED", 404],
];

describe("typed Deck chat-context repository", () => {
  it("projects only prompt facts and applies stable Voice/ref ordering", async () => {
    const { database, calls } = capturedTransaction({ deck: repositoryDeck, voices, refs: pluginRefs });
    expect(await new DeckChatContextRepository(database, actor.principal.canonical_user_id).resolve(input)).toEqual(output);
    expect(calls).toHaveLength(3);
    expect(Object.keys(calls[0]?.projection ?? {})).toEqual(Object.keys(deck));
    expect(Object.keys(calls[1]?.projection ?? {})).toEqual(Object.keys(voices[0] ?? {}));
    expect(Object.keys(calls[2]?.projection ?? {})).toEqual(Object.keys(pluginRefs[0] ?? {}));
    expect(calls[0]?.limit).toBe(1);
    expect(calls[1]?.ordering).toHaveLength(3);
    expect(calls[2]?.ordering).toHaveLength(3);
    expect(calls[2]?.joins).toHaveLength(1);
  });

  it.each(repositoryErrorCases)("keeps the original %s error", async (_label, rows, selection, code, status) => {
    const { database } = capturedTransaction(rows);
    await expect(new DeckChatContextRepository(database, actor.principal.canonical_user_id).resolve(selection)).rejects.toMatchObject({ code, status });
  });

  it("returns disabled and missing-selection facts for Dream-owned policy", async () => {
    const disabled = capturedTransaction({
      deck: { ...repositoryDeck, enabled: false },
      voices: [],
      refs: [],
    });
    expect(await new DeckChatContextRepository(disabled.database, actor.principal.canonical_user_id).resolve(input)).toMatchObject({
      deck: { enabled: false }, voices: [], plugin_refs: [],
    });
    const missingVoice = capturedTransaction({ deck: repositoryDeck, voices: [], refs: [] });
    expect(await new DeckChatContextRepository(missingVoice.database, actor.principal.canonical_user_id).resolve({ ...input, voice_id: "voice-absent" })).toMatchObject({
      deck: { enabled: true }, voices: [], plugin_refs: [],
    });
  });
});
