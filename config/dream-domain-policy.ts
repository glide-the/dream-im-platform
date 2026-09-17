// [Input] Explicit server capacities and runtime capability facts; no deployment name, identity or credential.
// [Output] Safe operational capacities and fail-closed original compatibility policy.
// [Pos] Operational resource policy, independent of product permissions and schema versions.
// [Sync] 2026-09-15: keep runtime host capability decisions in one explicit server configuration.
import { AuthBoundaryError } from "../app/lib/auth/config";
import { stripPythonString } from "../app/lib/dream/deckPluginManifestDto";

export function workflowContextAttemptCapacity() {
  const capacity = Number(process.env.DREAM_WORKFLOW_CONTEXT_MAX_ATTEMPTS ?? 256);
  if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(capacity + 1)) throw new AuthBoundaryError("WORKFLOW_CONTEXT_POLICY_INVALID");
  return capacity;
}
export function chatAutoTitleCapacity() {
  const capacity = Number(process.env.DREAM_CHAT_AUTO_TITLE_MAX_CHARACTERS ?? 50);
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new AuthBoundaryError("CHAT_AUTO_TITLE_POLICY_INVALID");
  return capacity;
}
export function deckRuntimeCompatibilityPolicy() {
  const enabled = (name: string) => { const raw = process.env[name]; return raw !== undefined && ["1", "true", "yes", "on"].includes(stripPythonString(raw).toLowerCase()); };
  return { deck_host_compatible: enabled("INK_DECK_HOST_COMPATIBLE"), claude_agent_compatible: enabled("INK_CLAUDE_AGENT_CONTRACT_COMPATIBLE"),
    story_schema_compatible: enabled("INK_STORY_SCHEMA_COMPATIBLE"), deck_runtime_config_compatible: enabled("INK_DECK_RUNTIME_CONFIG_COMPATIBLE") };
}
export function preflightInputCapacity() {
  const capacity = Number(process.env.DREAM_PREFLIGHT_MAX_INPUT_BYTES ?? 65_536);
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_POLICY_INVALID");
  return capacity;
}
export function preflightTokenTtlSeconds() {
  const seconds = Number(process.env.DREAM_PREFLIGHT_TOKEN_TTL_SECONDS ?? 300);
  if (!Number.isSafeInteger(seconds) || seconds < 1) throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_POLICY_INVALID");
  return seconds;
}
