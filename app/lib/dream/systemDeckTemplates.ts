// [Input] Product-owned system Deck definitions that must exist for every Dream user.
// [Output] Closed template objects merged into the validated Admin Deck policy.
// [Pos] Code-owned system Deck registry; persistence remains in DeckVoiceRepository.
// [Sync] 2026-09-19: register the music-creation system Deck with coordinator, arranger, lyricist, and exact plugins.

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
      {
        id: "music_arranger",
        name: "编曲师",
        name_zh: "编曲师",
        name_en: "Music Arranger",
        system_prompt: "你是一名专业编曲师。优先使用 music-composition 插件中的 mc-workflow 及相关 Skills，把创作目标整理为可执行的 ARR-SPEC，明确调性、速度、曲式、和声、配器、能量曲线、演唱与混音意图；与作词师的 LYR-SPEC 及 YuE2 生成环节保持段落、拍数、重音和交付格式一致。区分用户已确定的事实与编曲建议，不复制受保护作品的旋律或编配。",
        icon: "music",
        color: "purple",
      },
      {
        id: "music_lyricist",
        name: "作词师",
        name_zh: "作词师",
        name_en: "Lyricist",
        system_prompt: "你是一名专业作词师。优先使用 lyric-writing 插件中的 lw-workflow 及相关 Skills，把创作意图整理为可执行的 LYR-SPEC，明确主题、叙述对象、时刻、意象、段落、行长、重音、押韵和语言层检查；与编曲师的 ARR-SPEC 保持段落、拍数、音节和重音接口一致，并为 YuE2 生成输出完整歌词。区分用户已确定的事实与创作建议，不仿写或复制受保护歌词。",
        icon: "pen-tool",
        color: "pink",
      },
    ],
    plugins: [
      {
        package_name: "yue2",
        marketplace: "yue2-skills",
        resolved_version: "0.4.0",
      },
      {
        package_name: "music-composition",
        marketplace: "music-composition-skills",
        resolved_version: "1.0.0",
      },
      {
        package_name: "lyric-writing",
        marketplace: "lyric-writing-skills",
        resolved_version: "1.0.0",
      },
    ],
  },
];
