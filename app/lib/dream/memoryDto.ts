// [Input] Fixed memory policy and source-bound report documents.
// [Output] Closed versioned memory operations; no arbitrary path or actor selection.
// [Pos] Additive Reflections memory contract, independent of frozen Registry99.
// [Sync] 2026-10-15: define artifact publication and owner behavior CAS.
// [Sync] 2026-10-15: append v2 protocol DTOs; preserve every v1 schema and descriptor.
import { z } from "zod";
import policy from "../../../config/memory-policy.json";
import { reflectionAnalysisSummaryDto } from "./reflectionAnalysisContentDto";
import { reflectionResultDto } from "./reflectionTaskDto";
const id = z.uuid(); const revision = z.number().int().positive().max(2147483647);
const sha = z.string().regex(/^[0-9a-f]{64}$/);
export const desiredDto = z.strictObject({
  enabled: z.boolean(),
  themes: z.strictObject({
    THEME_FRUSTRATION: z.strictObject({ enabled: z.boolean(), action: z.enum(["acknowledge_then_help","help_only","ask_support_type"]) }),
    THEME_DEFENSE: z.strictObject({ enabled: z.boolean(), action: z.enum(["respect_distance","help_only","ask_support_type"]) }),
    THEME_PRESSURE: z.strictObject({ enabled: z.boolean(), action: z.enum(["prioritize_actions","acknowledge_then_help","ask_support_type"]) }),
    THEME_VALUE: z.strictObject({ enabled: z.boolean(), action: z.enum(["connect_goal_to_choice","acknowledge_only","help_only"]) }),
  }),
});
export const defaultDesired = desiredDto.parse({ enabled: false, themes: Object.fromEntries(policy.themes.map(t => [t.id, { enabled: true, action: t.default_action }])) });
export const metadataDto = z.strictObject({
  task_id: id, report_id: z.string().regex(/^[1-9][0-9]{0,18}$/),
  completed_sections: z.array(z.enum(["echoes","traits","patterns"])), failed_sections: z.array(z.enum(["echoes","traits","patterns"])),
  item_count: z.number().int().nonnegative(), theme_count: z.number().int().nonnegative(),
});
export const artifactDto = z.strictObject({
  artifact_id: id, revision, report_id: z.string().regex(/^[1-9][0-9]{0,18}$/),
  state: z.enum(["pending","running","publishing","ready","empty","failed"]),
  theme_state: z.enum(["pending","ready","empty","failed"]),
  created_at: z.string(), source_sha256: sha, conversion_revision: z.literal("memory-rules-v1"),
  document: z.string().nullable(), document_sha256: sha.nullable(), body_sha256: sha.nullable(), byte_length: z.number().int().nonnegative().nullable(),
  theme_document: z.string().nullable(), theme_sha256: sha.nullable(), metadata: metadataDto.nullable(), error_code: z.string().nullable(),
});
const lookup = z.strictObject({ artifact_id: id, revision });
const claim = lookup.extend({ claim_token: id });
export const memorySourceDto = z.strictObject({
  analysis_content: reflectionAnalysisSummaryDto.nullable(),
  task_id: id, report_id: z.string(), report_sha256: sha, created_at: z.string(), start_date: z.string().nullable(), end_date: z.string().nullable(),
  echoes: z.array(reflectionResultDto), traits: z.array(reflectionResultDto), patterns: z.array(reflectionResultDto),
  failed_sections: z.array(z.enum(["echoes","traits","patterns"])),
  completed_sections: z.array(z.enum(["echoes","traits","patterns"])),
});
export const settingsDto = z.strictObject({ owner_id: z.string(), catalog: z.array(z.strictObject({ id: z.string(), label: z.string(), actions: z.array(z.string()), default_action: z.string() })), revision: z.number().int().nonnegative(), taxonomy_revision: z.literal("memory-rules-v1"), default: desiredDto, desired: desiredDto, updated_at: z.string().nullable() });
const bg = <I extends z.ZodType, O extends z.ZodType>(input:I, output:O) => ({ kind: "write" as const, audience: "background" as const, backgroundScope: "reflections:execute" as const, userScope: null, input, output });
const user = <I extends z.ZodType, O extends z.ZodType>(input:I, output:O, write=false) => ({ kind: write ? "write" as const : "read" as const, audience: "user" as const, backgroundScope: null, userScope: write ? "dream:write" as const : "dream:read" as const, input, output });
export const memoryOperations = {
  "memory.artifacts.discover": bg(z.strictObject({}), z.strictObject({ discovered: z.number().int().nonnegative() })),
  "memory.artifacts.claim": bg(z.strictObject({}), z.strictObject({ artifact: artifactDto.nullable(), claim_token: id.nullable(), source: memorySourceDto.nullable() })),
  "memory.artifacts.stage": bg(claim.extend({ document: z.string().nullable(), body_sha256: sha.nullable(), theme_document: z.string().nullable(), metadata: metadataDto, theme_error_code: z.enum(["MEMORY_THEME_CONVERSION_FAILED"]).nullable() }), artifactDto),
  "memory.artifacts.publish": bg(claim.extend({ document_sha256: sha.nullable(), theme_sha256: sha.nullable(), theme_published: z.boolean(), theme_error_code: z.enum(["MEMORY_THEME_CONVERSION_FAILED","MEMORY_THEME_PUBLICATION_FAILED"]).nullable() }), artifactDto),
  "memory.artifacts.fail": bg(claim.extend({ error_code: z.enum(["MEMORY_CONVERSION_FAILED","MEMORY_PUBLICATION_FAILED"]), retryable: z.boolean() }), artifactDto),
  "memory.distillations.list": user(z.strictObject({ limit: z.number().int().min(1).max(100), before: z.strictObject({ created_at: z.iso.datetime({ offset:true }), artifact_id: id }).nullable() }), z.strictObject({ artifacts: z.array(artifactDto), next_cursor: z.strictObject({ created_at: z.string(), artifact_id: id }).nullable() })),
  "memory.distillations.read": user(lookup, artifactDto),
  "memory.behavior.get": user(z.strictObject({}), settingsDto),
  "memory.behavior.save": user(z.strictObject({ expected_revision: z.number().int().nonnegative().max(2147483646), desired: desiredDto }), settingsDto, true),
};
export type MemoryOperation = keyof typeof memoryOperations;

export const artifactV2Dto = artifactDto.extend({ conversion_revision: z.enum(["memory-rules-v1", "memory-rules-v2"]) });
export const settingsV2Dto = settingsDto.extend({ taxonomy_revision: z.literal("memory-rules-v2") });
export const memoryV2Operations = {
  "memory.v2.artifacts.discover": bg(memoryOperations["memory.artifacts.discover"].input, memoryOperations["memory.artifacts.discover"].output),
  "memory.v2.artifacts.claim": bg(memoryOperations["memory.artifacts.claim"].input, z.strictObject({ artifact: artifactV2Dto.nullable(), claim_token: id.nullable(), source: memorySourceDto.nullable() })),
  "memory.v2.artifacts.stage": bg(memoryOperations["memory.artifacts.stage"].input, artifactV2Dto),
  "memory.v2.artifacts.publish": bg(memoryOperations["memory.artifacts.publish"].input, artifactV2Dto),
  "memory.v2.artifacts.fail": bg(memoryOperations["memory.artifacts.fail"].input, artifactV2Dto),
  "memory.v2.distillations.list": user(memoryOperations["memory.distillations.list"].input, z.strictObject({ artifacts: z.array(artifactV2Dto), next_cursor: memoryOperations["memory.distillations.list"].output.shape.next_cursor })),
  "memory.v2.distillations.read": user(lookup, artifactV2Dto),
  "memory.v2.behavior.get": user(memoryOperations["memory.behavior.get"].input, settingsV2Dto),
  "memory.v2.behavior.save": user(memoryOperations["memory.behavior.save"].input, settingsV2Dto, true),
};
export const allMemoryOperations = { ...memoryOperations, ...memoryV2Operations };
export type AnyMemoryOperation = keyof typeof allMemoryOperations;
export function baseMemoryOperation(name: AnyMemoryOperation): MemoryOperation {
  return name.replace(/^memory\.v2\./, "memory.") as MemoryOperation;
}
