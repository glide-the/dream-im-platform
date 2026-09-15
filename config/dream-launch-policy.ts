// [Input] Original Story Workspace launch wire, source identity and title contracts.
// [Output] Fixed original protocol limits and UUIDv5 namespace; no secret or deployment branch.
// [Pos] Launch protocol policy shared by DTO and server-derived source projection.
// [Sync] 2026-09-15: preserve original source identity, character boundaries and five-minute claim protocol.
export const dreamLaunchProtocolPolicy = Object.freeze({
  identifierMaxCharacters: 255,
  goalMaxCharacters: 12000,
  titleGoalMaxCharacters: 80,
  uuidNamespaceUrl: "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
  threadIdentityPrefix: "ink-dream:thread:",
  messageIdentityPrefix: "ink-dream:message:",
  titlePrefix: "Dream · ",
  metadataKind: "story-workspace-dream-launch",
  metadataVersion: "story-workspace-dream-launch/v1",
  dispatchClaimTtlSeconds: 5 * 60,
});
