// [Input] Original default Workspace creation semantics from Dream agent_integration.
// [Output] Centralized original default name; no user settings or deployment switch.
// [Pos] Non-secret Workspace creation policy, independent of role or API version.
// [Sync] 2026-09-15: preserve the original default label and empty settings.
export const workspaceDefaultPolicy = Object.freeze({ name: "默认工作区" });
