// [Input] Named owner-scoped Plugin compatibility lookup and original structured compatibility results.
// [Output] Closed result retaining the original first-failure code/action and Python capability order.
// [Pos] Plugin metadata contract; no client-supplied readiness, grants, actor or executable path.
// [Sync] 2026-09-15: preserve full compatibility failure invariants and Unicode code-point ordering.
import { z } from "zod";
import { deckPluginManifestDto, stripPydanticString } from "./deckPluginManifestDto";
const identifier = z.string().overwrite(stripPydanticString).min(1);
export function comparePythonStrings(left: string, right: string) {
  const a = Array.from(left), b = Array.from(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const difference = a[i].codePointAt(0)! - b[i].codePointAt(0)!;
    if (difference) return difference;
  }
  return a.length - b.length;
}
export const deckPluginCompatibilityCheckDto = z.enum(["release_available", "deck_host_compatible", "claude_agent_compatible", "story_schema_compatible", "deck_runtime_config_compatible", "runtime_plugin_resolved", "workflow_permission", "runtime_plugin_ready"]);
export const deckPluginCompatibilityResultDto = z.strictObject({ passed: z.boolean(), failed_check: deckPluginCompatibilityCheckDto.nullable(),
  error_code: z.string().nullable(), recovery_action: z.string().nullable(), effective_capabilities: z.array(z.string()) }).superRefine((value, ctx) => {
  const failure = [value.failed_check, value.error_code, value.recovery_action];
  if (value.passed ? failure.some(item => item !== null) : failure.some(item => item === null) || value.effective_capabilities.length !== 0) ctx.addIssue({ code: "custom", message: "Compatibility failure fields must match the verdict." });
  const canonical = [...new Set(value.effective_capabilities)].sort(comparePythonStrings);
  if (canonical.some((item, i) => item !== value.effective_capabilities[i]) || canonical.length !== value.effective_capabilities.length) ctx.addIssue({ code: "custom", message: "Capabilities must be unique and in original Python order." });
});
export const deckPluginCompatibilityInputDto = z.strictObject({ workspace_id: identifier,
  deck_plugin_id: deckPluginManifestDto.shape.deck_plugin_id, deck_plugin_version: deckPluginManifestDto.shape.deck_plugin_version });
export const deckPluginCompatibilityOutputDto = z.strictObject({ compatibility: deckPluginCompatibilityResultDto });
export const deckPluginCompatibilityOperationContracts = { "deck-plugin-compatibility.check": { kind: "read" as const, input: deckPluginCompatibilityInputDto, output: deckPluginCompatibilityOutputDto, userScope: "dream:read" } };
export type DeckPluginCompatibilityInput = z.infer<typeof deckPluginCompatibilityInputDto>;
export type DeckPluginCompatibilityResult = z.infer<typeof deckPluginCompatibilityResultDto>;
