// [Input] @ink-memory/db client and schema modules.
// [Output] Public database package API.
// [Pos] Workspace package barrel following the Paperclip package boundary.
// [Sync] 2026-08-21: establish the Admin database package public surface.
export * from "./client.js";
export * from "./schema/index.js";
export * from "./schema/capabilities.js";
