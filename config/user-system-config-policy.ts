// [Input] Original Dream Settings normalized technical bounds and managed Runtime ownership.
// [Output] Non-secret fixed field validation; no identities, model quotas or deployment branches.
// [Pos] SystemConfig policy; product normalization and model selection stay in Dream.
// [Sync] 2026-09-15: preserve source codepoint/domain/path/env bounds and server-owned keys.
export const userSystemConfigPolicy = Object.freeze({ promptCharacters: 16384, domainEntries: 64,
  domainCharacters: 253, pathEntries: 32, pathCharacters: 512, envEntries: 64,
  envKeyCharacters: 256, envValueCharacters: 4096 });
export const systemConfigServerEnvKeys = new Set([
  "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "OPENAI_BASE_URL",
  "INK_ADMIN_PRODUCT_API_BASE_URL", "INK_ADMIN_PRODUCT_JWT_ISSUER", "INK_ADMIN_PRODUCT_JWT_AUDIENCE",
  "INK_ADMIN_PRODUCT_CLIENT_ID", "INK_ADMIN_PRODUCT_ORIGIN", "INK_GATEWAY_BASE_URL",
  "INK_GATEWAY_SERVICE_CLIENT_ID", "INK_AGENT_SANDBOX_ENABLED", "CLAUDE_CODE_EFFORT_LEVEL",
  "CLAUDE_CODE_AUTO_COMPACT_WINDOW", "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
  "INK_CLAUDE_CODE_MODEL_MAX_OUTPUT_TOKENS", "CLAUDE_CODE_MAX_OUTPUT_TOKENS", "CLAUDE_CODE_TMPDIR",
  "INK_AGENT_USER_ID", "INK_AGENT_THREAD_ID", "INK_AGENT_WORKFLOW_RUN_ID", "INK_STORY_WORKSPACE_MESSAGE_ID",
]);
export const systemConfigSecretEnvPattern = /(?:^|_)(?:API_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|TOKEN|SECRET|PASSWORD|PASSPHRASE|PRIVATE_KEY|CREDENTIAL|AUTHORIZATION)(?:$|_)/i;
