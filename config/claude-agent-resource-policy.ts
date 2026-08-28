// [Input] JSON/TypeScript/PostgreSQL integer precision, Claude SDK effort levels, and the fixed Claude Agent resource-policy setting.
// [Output] Versioned admission/Runtime defaults, technical bounds, immutable setting identity, and exact capability contracts.
// [Pos] Admin policy source; runtime effective values come only from Dream's PostgreSQL snapshot.
// [Sync] 2026-08-28: add optional global effort and model-scoped Claude Code Runtime bounds/capability; unset means no env injection.

export const CLAUDE_AGENT_MIB_IN_BYTES = 1_048_576;
export const CLAUDE_AGENT_MAX_COMBINED_MEMORY_MIB = Math.floor(
  Number.MAX_SAFE_INTEGER / CLAUDE_AGENT_MIB_IN_BYTES,
);
export const CLAUDE_CODE_RUNTIME_INTEGER_MAX = 2_147_483_647;
export const CLAUDE_CODE_EFFORT_LEVELS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export const claudeAgentResourcePolicy = {
  schemaVersion: 1,
  setting: {
    id: "setting_claude_agent_resource_policy",
    category: "claude_agent",
    key: "resource_policy",
    description: "Desired Claude Agent resource and Runtime policy",
  },
  bounds: {
    maxConcurrentRuns: { min: 1, max: null },
    runMemoryBudgetMib: { min: 1, max: null },
    memoryReserveMib: { min: 1, max: null },
    retryAfterSeconds: { min: 1, max: null },
  },
  technicalLimits: {
    mibInBytes: CLAUDE_AGENT_MIB_IN_BYTES,
    maxCombinedMemoryMib: CLAUDE_AGENT_MAX_COMBINED_MEMORY_MIB,
    claudeCodeRuntimeIntegerMax: CLAUDE_CODE_RUNTIME_INTEGER_MAX,
  },
  defaults: {
    maxConcurrentRuns: 1,
    runMemoryBudgetMib: 512,
    memoryReserveMib: 128,
    retryAfterSeconds: 60,
    claudeCodeEffortLevel: null,
  },
  claudeCodeRuntime: {
    effortLevels: CLAUDE_CODE_EFFORT_LEVELS,
    capability: "dream.claude-code-runtime-config.v1",
    version: 1,
    contractSha256: "7b4d46bad9cfb340336a05aa9c9a2b70f5518622e5e2e94d47aac2ca76d63c1d",
  },
  observer: {
    capability: "dream.claude-agent-resource-observer.v1",
    version: 1,
    contractSha256: "db2ba80eb61a9515ba23000f8a615fb41f6ed5824bd306e8d0ca5fb8f1cc044e",
    freshSeconds: 20,
    offlineSeconds: 60,
  },
} as const;
