// [Input] Product-owned system Deck definitions that must exist for every Dream user.
// [Output] Closed template objects merged into the validated Admin Deck policy.
// [Pos] Code-owned system Deck registry; persistence remains in DeckVoiceRepository.
// [Sync] 2026-09-19: register the music-creation system Deck and its Yue2 plugin.

export const codeSystemDeckTemplates = [
  {
    id: "music_creation_deck",
    name: "音乐创作",
    name_zh: null,
    name_en: null,
    description: "Describe your deck here",
    description_zh: null,
    description_en: null,
    icon: "brain",
    color: "blue",
    voices: [
      {
        id: "music_style_lyrics_creator",
        name: "风格和歌词生成",
        name_zh: null,
        name_en: null,
        system_prompt: "You are a helpful assistant.",
        icon: "brain",
        color: "blue",
      },
    ],
    plugins: [
      {
        package_name: "yue2",
        marketplace: "yue2-skills",
        resolved_version: "0.4.0",
      },
    ],
  },
];
