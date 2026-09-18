// [Input] Deployment Deck policy environment and the code-owned system Deck registry.
// [Output] Prove music is always present once and conflicting overrides fail closed.
// [Pos] Provider-free policy composition regression tests.
// [Sync] 2026-09-19: cover code-owned music system Deck composition.

import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredDeckVoicePolicy } from "./deckVoiceService";

const basePolicy = {
  default_system_deck_id: "screenplay_creation_deck",
  retired_system_deck_ids: [],
  default_plugin_package_name: "drama-forge",
  default_plugin_version: "1.0.1",
  default_memory_workspace_config_json: "{}",
  template: {
    name: "剧本创作团队",
    name_zh: "剧本创作团队",
    name_en: "Screenplay Creation Team",
    description: null,
    description_zh: null,
    description_en: null,
    icon: "masks",
    color: "purple",
    voices: [],
  },
};

describe("configuredDeckVoicePolicy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("adds the code-owned music system Deck without deployment duplication", () => {
    vi.stubEnv("DREAM_DECK_POLICY_JSON", JSON.stringify(basePolicy));
    const policy = configuredDeckVoicePolicy();
    expect(policy.additional_system_decks).toEqual([
      expect.objectContaining({
        id: "music_creation_deck",
        name: "音乐创作",
        plugins: [
          {
            package_name: "yue2",
            marketplace: "yue2-skills",
            resolved_version: "0.4.0",
          },
        ],
      }),
    ]);
  });

  it("fails closed when deployment policy conflicts with the code-owned template", () => {
    vi.stubEnv(
      "DREAM_DECK_POLICY_JSON",
      JSON.stringify({
        ...basePolicy,
        additional_system_decks: [
          {
            id: "music_creation_deck",
            name: "conflict",
            name_zh: null,
            name_en: null,
            description: null,
            description_zh: null,
            description_en: null,
            icon: null,
            color: null,
            voices: [{ id: "voice", name: "voice", name_zh: null, name_en: null, system_prompt: "", icon: null, color: null }],
            plugins: [{ package_name: "other", marketplace: "other", resolved_version: "1.0.0" }],
          },
        ],
      }),
    );
    expect(() => configuredDeckVoicePolicy()).toThrowError(
      expect.objectContaining({ code: "DECK_POLICY_NOT_CONFIGURED" }),
    );
  });
});
