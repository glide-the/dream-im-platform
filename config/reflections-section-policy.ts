// [Input] Original Reflections static section keys, PostgreSQL CHECK and route prompt filename whitelist.
// [Output] Nonsecret original section/prompt field names; no filesystem path or deployment switch.
// [Pos] Closed custom-prompt persistence policy; defaults/effective merging stay in Dream.
// [Sync] 2026-09-15: serve registered83 section config without Runtime or generic settings.
export const reflectionsSectionPolicy = Object.freeze({
  sections: ["echoes", "traits", "patterns"] as const,
  promptFiles: ["WORKFLOW.md", "MEMORY_QUERY_PROMPT.md", "MEMORY_Distiller_PROMPT.md", "MEMORY_ANSWER_PROMPT.md", "DEFAULT_UPDATE_MEMORY_PROMPT.md"] as const,
});
