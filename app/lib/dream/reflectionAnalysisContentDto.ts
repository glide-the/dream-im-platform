// [Input] Existing Reflections DTOs and server-verified selected Notion page bodies.
// [Output] Additive task content create, owner summary and service-only frozen input contracts.
// [Pos] Analysis input boundary; Registry99 descriptors and Session identities remain unchanged.
// [Sync] 2026-10-13: freeze Notion inputs and selected Agent instructions per analysis task.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
import { reflectionTaskCreateInputDto, reflectionTaskGetOutputDto, reflectionTaskLookupDto } from "./reflectionTaskDto";

const id = z.string().min(1).max(256);
const uniqueIds = z.array(id).refine(values => new Set(values).size === values.length);
export const reflectionNotionPageDto = z.strictObject({
  page_id: id, title: z.string(), url: z.string().nullable(), markdown: z.string().min(1),
  content_sha256: z.string().regex(/^[0-9a-f]{64}$/), read_at: isoTimeDto,
});
export const reflectionNotionInputDto = z.strictObject({
  connector_id: id, snapshot_version: id, pages: z.array(reflectionNotionPageDto), empty_page_ids: uniqueIds,
}).superRefine((value, ctx) => {
  const ids = [...value.pages.map(page => page.page_id), ...value.empty_page_ids];
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Notion page identities must be unique." });
});
export const reflectionAgentInputDto = z.strictObject({ deck_id: id, agent_id: id });
export const reflectionAnalysisSelectionDto = z.strictObject({
  notion: reflectionNotionInputDto.nullable(), agent: reflectionAgentInputDto.nullable(), diary_session_ids: uniqueIds.nullable(),
});
export const reflectionAnalysisCreateDto = reflectionTaskCreateInputDto.extend({ analysis_content: reflectionAnalysisSelectionDto }).refine(value => {
  const selected = value.analysis_content.diary_session_ids;
  return selected === null ? value.input_snapshot.session_ids.length === 0
    : selected.length === value.input_snapshot.session_ids.length && selected.every((id, index) => id === value.input_snapshot.session_ids[index]);
}, { message: "Diary selection must match the task input." });
export const reflectionAgentSnapshotDto = reflectionAgentInputDto.extend({ deck_name: z.string(), agent_name: z.string(), system_prompt: z.string() });
export const reflectionAnalysisSnapshotDto = z.strictObject({
  notion: reflectionNotionInputDto.nullable(), agent: reflectionAgentSnapshotDto.nullable(), diary_session_ids: uniqueIds.nullable(),
});
export const reflectionAnalysisSummaryDto = z.strictObject({
  diary_session_ids: uniqueIds.nullable(),
  notion: z.strictObject({ connector_id: id, snapshot_version: id,
    pages: z.array(reflectionNotionPageDto.omit({ markdown: true })), empty_page_count: z.number().int().nonnegative().safe(),
  }).nullable(),
  agent: reflectionAgentSnapshotDto.omit({ system_prompt: true }).nullable(),
});
export const reflectionAnalysisSummaryOutputDto = z.strictObject({ analysis_content: reflectionAnalysisSummaryDto.nullable() });
export const reflectionAnalysisLoadOutputDto = z.strictObject({ analysis_content: reflectionAnalysisSnapshotDto });
export function reflectionAnalysisSummary(input: z.infer<typeof reflectionAnalysisSnapshotDto>) {
  return reflectionAnalysisSummaryDto.parse({
    diary_session_ids: input.diary_session_ids,
    notion: input.notion === null ? null : { connector_id: input.notion.connector_id, snapshot_version: input.notion.snapshot_version,
      pages: input.notion.pages.map(({ markdown: _markdown, ...page }) => page), empty_page_count: input.notion.empty_page_ids.length },
    agent: input.agent === null ? null : { deck_id: input.agent.deck_id, agent_id: input.agent.agent_id,
      deck_name: input.agent.deck_name, agent_name: input.agent.agent_name },
  });
}
export const reflectionAnalysisContentOperations = {
  "reflection-task.create-with-content": { audience: "oauth", kind: "write", userScope: "dream:write", input: reflectionAnalysisCreateDto, output: reflectionTaskGetOutputDto },
  "reflection-task.analysis-content": { audience: "oauth", kind: "read", userScope: "dream:read", input: reflectionTaskLookupDto, output: reflectionAnalysisSummaryOutputDto },
  "reflection-task.analysis-content-load": { audience: "background", kind: "read", backgroundScope: "reflections:execute", input: reflectionTaskLookupDto, output: reflectionAnalysisLoadOutputDto },
} as const;
export type ReflectionAnalysisOperation = keyof typeof reflectionAnalysisContentOperations;
