// [Input] Actual Dream DeckChatContextAssembler through a fixed source oracle and Registry105 DTO.
// [Output] Current consumer field/error/prompt/provenance parity plus Admin status projection.
// [Pos] Cross-project source gate; it opens no pool, plugin artifact, workspace or Runtime.
// [Sync] 2026-09-16: follow Dream's DTO-only assembler after retirement of its SQL resolver.
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { deckChatContextOutputDto } from "./deckChatContextDto";

type SourcePluginRef = {
  plugin_installation_id: string;
  package_spec: string;
  resolved_version: string;
  artifact_digest: string;
  order_index: number;
};
type SourceSuccess = {
  status: "resolved";
  context: {
    deck_id: string;
    deck_name: string;
    plugin_refs: SourcePluginRef[];
    plugin_provenance: { source: string; plugins: SourcePluginRef[] };
    system_prompt: string;
  };
};
type SourceFailure = {
  status: "error";
  code: string;
  status_code: number;
  message: string;
};
type SourceOracleResult = {
  all: SourceSuccess;
  dream: SourceSuccess;
  selected: SourceSuccess;
  disabled_deck: SourceFailure;
  missing_voice: SourceFailure;
  nonready_plugin: SourceFailure;
};

const sourceRoot = process.env.INK_DREAM_SOURCE, python = process.env.INK_DREAM_ORACLE_PYTHON;

it.skipIf(!sourceRoot || !python)("matches the actual Dream Deck chat-context source and freezes the strict Admin extension", () => {
  const request = {
    deck: {
      id: "deck-owned", name: "创作组", name_zh: "创作组", name_en: null,
      description: "说明", description_zh: null, description_en: "Description", enabled: true,
    },
    voices: [
      { id: "voice-1", name: "Writer", name_zh: "编剧", name_en: "Writer", system_prompt: "写作😀", enabled: true },
      { id: "voice-2", name: "Editor", name_zh: null, name_en: null, system_prompt: "Review", enabled: true },
    ],
    refs: [
      {
        plugin_installation_id: "install-1", package_spec: "drama-forge@official",
        resolved_version: "1.2.3", artifact_digest: `sha256:${"a".repeat(64)}`,
        order_index: 0, enabled: true, installation_status: "ready",
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
    deck: request.deck,
    voices: request.voices,
    plugin_refs: request.refs,
  });
  expect(adminOutput.deck.id).toBe(result.all.context.deck_id);
  expect(adminOutput.deck.enabled).toBe(true);
  expect(adminOutput.deck.name).toBe(result.all.context.deck_name);
  expect(adminOutput.voices).toEqual(request.voices);
  expect(adminOutput.plugin_refs[0]).toEqual(expect.objectContaining({ enabled: true, installation_status: "ready" }));
  expect(result.all.context.plugin_refs).toEqual(request.refs.map(({ installation_status: _status, enabled: _enabled, ...ref }) => ref));
  expect(result.all.context.plugin_provenance).toEqual({ source: "deck_claude_plugin_refs", plugins: result.all.context.plugin_refs });
  expect(result.all.context.system_prompt).toContain("<deck_context>\n");
  expect(result.all.context.system_prompt).toContain("写作😀");
  expect(result.all.context.system_prompt).toContain("Agent output is a proposal");
  expect(result.dream.context.system_prompt).toContain("Dream workspace-file turn");
  expect(result.selected.context.system_prompt).toContain("voice-2");
  expect(result.selected.context.system_prompt).not.toContain("voice-1");

  expect(result.all.status).toBe("resolved");
  expect(result.disabled_deck).toMatchObject({ status: "error", code: "DECK_DISABLED", status_code: 409 });
  expect(result.missing_voice).toMatchObject({ status: "error", code: "AGENT_ACCESS_DENIED", status_code: 404 });
  expect(result.nonready_plugin).toMatchObject({ status: "error", code: "DECK_PLUGIN_UNAVAILABLE", status_code: 409 });
  expect(result.nonready_plugin.message).toContain("drama-forge@official (status=error)");
  // Admin projects storage status; Dream retains disabled/non-ready decisions before Runtime.
});
