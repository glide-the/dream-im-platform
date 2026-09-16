// [Input] Stored Voice rows containing legacy Memory text values.
// [Output] Repository projection preserves exact text for the Dream compatibility projector.
// [Pos] Provider-free regression for Deck detail DTO compatibility; no database or HTTP.
// [Sync] 2026-09-17: cover empty and malformed legacy Memory text without Repository healing.
import { describe, expect, it } from "vitest";
import { projectDeckVoiceRow, type VoiceEntity } from "./deckVoiceRepository";

function row(memoryWorkspaceConfig: string | null): VoiceEntity {
  return {
    id: "voice-1",
    deck_id: "deck-1",
    name: "Voice",
    name_zh: null,
    name_en: null,
    system_prompt: "Prompt",
    icon: null,
    color: null,
    is_system: false,
    parent_id: null,
    owner_id: "42",
    enabled: true,
    has_local_changes: false,
    order_index: 0,
    created_at: "2026-09-17 01:02:03+00",
    updated_at: null,
    thread_id: null,
    memory_workspace_config: memoryWorkspaceConfig,
  };
}

describe("Deck Voice repository projection", () => {
  it.each([null, "", "bad json", "[]", "null", "false", "0", '"text"'])
  ("preserves stored legacy Memory text %j", (raw) => {
    expect(projectDeckVoiceRow(row(raw)).memory_workspace_config_json).toBe(raw);
  });

  it("preserves exact JSON numeric lexemes", () => {
    const raw = '{"float":1.0,"zero":-0.0,"big":9007199254740993}';
    expect(projectDeckVoiceRow(row(raw)).memory_workspace_config_json).toBe(raw);
  });
});
