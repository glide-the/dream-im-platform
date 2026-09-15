// [Input] Original Reflections section and raw JSON text of Dream's postfiltered custom prompt strings.
// [Output] Closed get/save/delete DTOs; raw legacy object text remains intact on reads.
// [Pos] Registered custom-prompt data contract; no actor, path, Runtime or effective/default selector.
// [Sync] 2026-09-15: publish three closed operations while preserving raw serialized JSON.
import { z } from "zod";
import { reflectionsSectionPolicy as policy } from "../../../config/reflections-section-policy";
import { stripPythonString } from "./deckPluginManifestDto";
const prompt = z.string().min(1).refine(value => value === stripPythonString(value));
const prompts = z.strictObject(Object.fromEntries(policy.promptFiles.map(name => [name, prompt.optional()]))).refine(value => Object.keys(value).length > 0);
export function isReflectionsPostfilteredPromptJson(raw: string) {
  try { return prompts.safeParse(JSON.parse(raw)).success; } catch { return false; }
}
export const reflectionsSectionConfigLookupDto = z.strictObject({ section: z.enum(policy.sections) });
export const reflectionsSectionConfigSaveDto = reflectionsSectionConfigLookupDto.extend({ prompt_files_json: z.string().refine(isReflectionsPostfilteredPromptJson) });
export const reflectionsSectionConfigOperationContracts = {
  "reflections-section-config.get": { kind: "read" as const, input: reflectionsSectionConfigLookupDto, output: z.strictObject({ prompt_files_json: z.string().nullable() }), userScope: "dream:read" },
  "reflections-section-config.save": { kind: "write" as const, input: reflectionsSectionConfigSaveDto, output: z.strictObject({ saved: z.literal(true) }), userScope: "dream:write" },
  "reflections-section-config.delete": { kind: "write" as const, input: reflectionsSectionConfigLookupDto, output: z.strictObject({ deleted: z.boolean() }), userScope: "dream:write" },
};
export type ReflectionsSection = z.infer<typeof reflectionsSectionConfigLookupDto>["section"];
export type ReflectionsSectionConfigOperation = keyof typeof reflectionsSectionConfigOperationContracts;
