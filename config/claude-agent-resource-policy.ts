// [Input] Product safety limits for the fixed Claude Agent resource-policy setting.
// [Output] Versioned defaults, bounds, immutable setting identity, and exact observer freshness/capability contract.
// [Pos] Admin policy source; runtime effective values come only from Dream's PostgreSQL snapshot.
// [Sync] 2026-08-27: pin the canonical DB-clock/latest-instance Observer contract hash.

export const claudeAgentResourcePolicy = {
  schemaVersion: 1,
  setting: {
    id: "setting_claude_agent_resource_policy",
    category: "claude_agent",
    key: "resource_policy",
    description: "Desired Claude Agent admission resource policy",
  },
  bounds: {
    maxConcurrentRuns: { min: 1, max: 16 },
    runMemoryBudgetMib: { min: 128, max: 8_192 },
    memoryReserveMib: { min: 64, max: 4_096 },
    retryAfterSeconds: { min: 5, max: 3_600 },
  },
  defaults: {
    maxConcurrentRuns: 1,
    runMemoryBudgetMib: 512,
    memoryReserveMib: 128,
    retryAfterSeconds: 60,
  },
  observer: {
    capability: "dream.claude-agent-resource-observer.v1",
    version: 1,
    contractSha256: "db2ba80eb61a9515ba23000f8a615fb41f6ed5824bd306e8d0ca5fb8f1cc044e",
    freshSeconds: 20,
    offlineSeconds: 60,
  },
} as const;
