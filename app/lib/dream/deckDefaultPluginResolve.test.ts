// [Input] Registry104 strict DTO, OAuth actor, configured Deck policy and typed Drizzle read seam.
// [Output] Closed request, nullable/raw projection, scope/entity/policy gates and one-row repository behavior.
// [Pos] Provider-free default-plugin domain gate; stable real PostgreSQL selection remains isolated evidence.
// [Sync] 2026-09-19: include the empty additional system Deck registry in the typed policy fixture.
// [Sync] 2026-09-15: prove the read derives package/version from policy and returns only six fields.
import { afterEach, describe, expect, it, vi } from "vitest";
import { claude_plugin_installations } from "@ink-memory/db/schema/dream";
import type { DataTransaction } from "./database";
import type { DeckVoicePolicyDto } from "./deckVoiceDto";
import {
  deckDefaultPluginInstallationDto,
  deckDefaultPluginResolveOperationContracts,
} from "./deckDefaultPluginResolveDto";
import { DeckDefaultPluginResolveRepository } from "./deckDefaultPluginResolveRepository";
import { runDeckDefaultPluginResolveOperation } from "./deckDefaultPluginResolveService";

const policy: DeckVoicePolicyDto = {
  default_system_deck_id: "system-default",
  retired_system_deck_ids: [],
  default_plugin_package_name: "platform.default-plugin",
  default_plugin_version: "1.2.3",
  default_memory_workspace_config_json: "{}",
  template: {
    name: "Default", name_zh: null, name_en: null, description: null,
    description_zh: null, description_en: null, icon: null, color: null, voices: [],
  },
  additional_system_decks: [],
};
const actor = {
  principal: {
    subject: "deck-default-plugin-subject", canonical_user_id: "9007199254740993",
    client_id: "dream-browser", scopes: ["dream:read"], status: "active" as const,
  },
  threadScope: null,
};
const candidate = {
  plugin_installation_id: "install-ready",
  package_name: policy.default_plugin_package_name,
  marketplace: "official",
  resolved_version: policy.default_plugin_version,
  artifact_digest: `sha256:${"a".repeat(64)}`,
  compatibility_json: '{"raw":true,"counter":9007199254740993}',
};
const tx = {} as DataTransaction;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("strict configured candidate DTO", () => {
  it("accepts only an empty input and one nullable six-field projection", () => {
    const contract = deckDefaultPluginResolveOperationContracts["deck.default-plugin.resolve"];
    expect(contract.input.parse({})).toEqual({});
    expect(contract.output.parse({ installation: candidate })).toEqual({ installation: candidate });
    expect(contract.output.parse({ installation: null })).toEqual({ installation: null });
    expect(Object.keys(deckDefaultPluginInstallationDto.shape)).toEqual([
      "plugin_installation_id", "package_name", "marketplace", "resolved_version", "artifact_digest", "compatibility_json",
    ]);
  });

  it.each([
    "actor", "user_id", "thread_id", "package_name", "resolved_version",
    "plugin_installation_id", "evidence", "sql", "table", "column",
  ])("rejects caller-authored %s", key => {
    expect(deckDefaultPluginResolveOperationContracts["deck.default-plugin.resolve"].input.safeParse({ [key]: "caller" }).success).toBe(false);
  });

  it("preserves compatibility JSON bytes and rejects extra or malformed stored fields", () => {
    expect(deckDefaultPluginInstallationDto.parse(candidate).compatibility_json).toBe(candidate.compatibility_json);
    expect(deckDefaultPluginInstallationDto.safeParse({ ...candidate, status: "ready" }).success).toBe(false);
    expect(deckDefaultPluginInstallationDto.safeParse({ ...candidate, artifact_digest: `sha256:${"z".repeat(64)}` }).success).toBe(false);
  });
});

describe("default-plugin resolve service", () => {
  it("passes only the configured package/version and returns an exact candidate or absence", async () => {
    const resolve = vi.spyOn(DeckDefaultPluginResolveRepository.prototype, "resolve")
      .mockResolvedValueOnce(candidate)
      .mockResolvedValueOnce(null);
    expect(await runDeckDefaultPluginResolveOperation("deck.default-plugin.resolve", {}, actor, tx, policy)).toEqual({ installation: candidate });
    expect(await runDeckDefaultPluginResolveOperation("deck.default-plugin.resolve", {}, actor, tx, policy)).toEqual({ installation: null });
    expect(resolve.mock.calls).toEqual([[policy], [policy]]);
  });

  it("rejects invalid input, missing scope and entity delegation before persistence", async () => {
    const resolve = vi.spyOn(DeckDefaultPluginResolveRepository.prototype, "resolve");
    await expect(runDeckDefaultPluginResolveOperation("deck.default-plugin.resolve", { package_name: "caller" }, actor, tx, policy)).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
    await expect(runDeckDefaultPluginResolveOperation("deck.default-plugin.resolve", {}, { ...actor, principal: { ...actor.principal, scopes: ["dream:write"] } }, tx, policy)).rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
    await expect(runDeckDefaultPluginResolveOperation("deck.default-plugin.resolve", {}, { ...actor, threadScope: "thread-1" }, tx, policy)).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("fails closed before querying when the server policy is missing or malformed", async () => {
    const resolve = vi.spyOn(DeckDefaultPluginResolveRepository.prototype, "resolve");
    vi.stubEnv("DREAM_DECK_POLICY_JSON", "{");
    await expect(runDeckDefaultPluginResolveOperation("deck.default-plugin.resolve", {}, actor, tx)).rejects.toMatchObject({ code: "DECK_POLICY_NOT_CONFIGURED", status: 503 });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed stored projection", async () => {
    vi.spyOn(DeckDefaultPluginResolveRepository.prototype, "resolve").mockResolvedValue({ ...candidate, compatibility_json: 1 } as never);
    await expect(runDeckDefaultPluginResolveOperation("deck.default-plugin.resolve", {}, actor, tx, policy)).rejects.toMatchObject({ code: "DEFAULT_DECK_PLUGIN_DATA_INVALID", status: 503 });
  });
});

describe("typed default-plugin repository", () => {
  it("selects only the six-field projection and limits the stable query to one row", async () => {
    const calls: { projection?: Record<string, unknown>; table?: unknown; where?: unknown; ordering?: unknown[]; limit?: number } = {};
    const chain = {
      from(table: unknown) { calls.table = table; return chain; },
      where(value: unknown) { calls.where = value; return chain; },
      orderBy(...values: unknown[]) { calls.ordering = values; return chain; },
      async limit(value: number) { calls.limit = value; return [candidate]; },
    };
    const database = { select(projection: Record<string, unknown>) { calls.projection = projection; return chain; } } as unknown as DataTransaction;
    expect(await new DeckDefaultPluginResolveRepository(database).resolve(policy)).toEqual(candidate);
    expect(calls.table).toBe(claude_plugin_installations);
    expect(Object.keys(calls.projection ?? {})).toEqual(Object.keys(candidate));
    expect(calls.where).toBeDefined(); expect(calls.ordering).toHaveLength(2); expect(calls.limit).toBe(1);
  });

  it("maps an empty exact-match query to explicit null", async () => {
    const chain = { from: () => chain, where: () => chain, orderBy: () => chain, limit: async () => [] };
    const database = { select: () => chain } as unknown as DataTransaction;
    expect(await new DeckDefaultPluginResolveRepository(database).resolve(policy)).toBeNull();
  });
});
