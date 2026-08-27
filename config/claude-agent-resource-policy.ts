// [Input] Product safety limits for the fixed Claude Agent resource-policy setting.
// [Output] Versioned defaults, bounds, and immutable system_settings identity.
// [Pos] Admin policy source; runtime effective values still come from Dream composition-root configuration.

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
} as const;
