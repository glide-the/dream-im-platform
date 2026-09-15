// [Input] Actual Dream DeckChatContextService through a fixed source oracle and Registry105 DTO.
// [Output] Source field/error/order/provenance parity plus explicit Admin installation-status extension.
// [Pos] Cross-project source gate; it opens no pool, plugin artifact, workspace or Runtime.
// [Sync] 2026-09-15: bind the Admin aggregate read to current Dream behavior before consumer replacement.
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { deckChatContextOutputDto } from "./deckChatContextDto";

type SourceStatement = { sql: string; parameters: unknown[] };
type SourcePluginRef = {
  plugin_installation_id: string;
  package_spec: string;
  resolved_version: string;
  artifact_digest: string;
  order_index: number;
};
type SourceSuccess = {
  status: "ok";
  context: {
    deck_id: string;
    deck_name: string;
    plugin_refs: SourcePluginRef[];
    plugin_provenance: { source: string; plugins: SourcePluginRef[] };
    system_prompt: string;
  };
  statements: SourceStatement[];
  ref_calls: string[];
};
type SourceFailure = {
  status: "error";
  code: string;
  status_code: number;
  message: string;
  statements: SourceStatement[];
  ref_calls: string[];
};
type SourceOracleResult = {
  all: SourceSuccess;
  dream: SourceSuccess;
  selected: SourceSuccess;
  missing_deck: SourceFailure;
  disabled_deck: SourceFailure;
  missing_voice: SourceFailure;
  nonready_plugin: SourceFailure;
};

const sourceRoot = process.env.INK_DREAM_SOURCE, python = process.env.INK_DREAM_ORACLE_PYTHON;

it.skipIf(!sourceRoot || !python)("matches the actual Dream Deck chat-context source and freezes the strict Admin extension", () => {
  const request = {
    actor_id: "9007199254740993",
    deck: {
      id: "deck-owned", name: "创作组", name_zh: "创作组", name_en: null,
      description: "说明", description_zh: null, description_en: "Description", enabled: true,
    },
    voices: [
      { id: "voice-1", name: "Writer", name_zh: "编剧", name_en: "Writer", system_prompt: "写作😀" },
      { id: "voice-2", name: "Editor", name_zh: null, name_en: null, system_prompt: "Review" },
    ],
    refs: [
      {
        plugin_installation_id: "install-1", package_spec: "drama-forge@official",
        resolved_version: "1.2.3", artifact_digest: `sha256:${"a".repeat(64)}`,
        order_index: 0, installation_status: "ready",
      },
    ],
  };
  const child = spawnSync(python!, ["-B", "tests/integration/deckChatContextSourceOracle.py"], {
    encoding: "utf8", timeout: 20_000,
    env: { PATH: process.env.PATH, INK_DREAM_SOURCE: sourceRoot } as unknown as NodeJS.ProcessEnv,
    input: JSON.stringify(request),
  });
  expect(child.error, "Actual Dream interpreter must launch").toBeUndefined();
  expect(child.status, child.stderr || "Actual Dream source must finish").toBe(0);
  const result = JSON.parse(child.stdout) as SourceOracleResult;

  const adminOutput = deckChatContextOutputDto.parse({
    deck: (({ enabled: _enabled, ...deck }) => deck)(request.deck),
    voices: request.voices,
    plugin_refs: request.refs,
  });
  expect(adminOutput.deck.id).toBe(result.all.context.deck_id);
  expect(adminOutput.deck.name).toBe(result.all.context.deck_name);
  expect(adminOutput.voices).toEqual(request.voices);
  expect(adminOutput.plugin_refs[0]).toEqual(expect.objectContaining({ installation_status: "ready" }));
  expect(result.all.context.plugin_refs).toEqual(request.refs.map(({ installation_status: _status, ...ref }) => ref));
  expect(result.all.context.plugin_provenance).toEqual({ source: "deck_claude_plugin_refs", plugins: result.all.context.plugin_refs });
  expect(result.all.context.system_prompt).toContain("<deck_context>\n");
  expect(result.all.context.system_prompt).toContain("写作😀");
  expect(result.all.context.system_prompt).toContain("Agent output is a proposal");
  expect(result.dream.context.system_prompt).toContain("Dream workspace-file turn");
  expect(result.selected.context.system_prompt).toContain("voice-2");
  expect(result.selected.context.system_prompt).not.toContain("voice-1");

  expect(result.all.statements).toHaveLength(2);
  expect(result.all.statements[0].sql).toContain("WHERE id = %s AND owner_id = %s");
  expect(result.all.statements[0].parameters).toEqual([request.deck.id, request.actor_id]);
  expect(result.all.statements[1].sql).toContain("enabled IS TRUE ORDER BY order_index, created_at, id");
  expect(result.all.ref_calls).toEqual([request.deck.id]);
  expect(result.missing_deck).toMatchObject({ status: "error", code: "DECK_ACCESS_DENIED", status_code: 404, ref_calls: [] });
  expect(result.disabled_deck).toMatchObject({ status: "error", code: "DECK_DISABLED", status_code: 409, ref_calls: [] });
  expect(result.missing_voice).toMatchObject({ status: "error", code: "AGENT_ACCESS_DENIED", status_code: 404, ref_calls: [] });
  expect(result.nonready_plugin).toMatchObject({ status: "error", code: "DECK_PLUGIN_UNAVAILABLE", status_code: 409, ref_calls: [request.deck.id] });
  expect(result.nonready_plugin.message).toContain("drama-forge@official (status=error)");
  // Reviewed extension: Admin returns installation_status so Dream keeps the existing non-ready failure before Runtime.
});
