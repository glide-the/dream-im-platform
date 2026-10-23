// [Input] Published task/content schemas and an actor-owned Notion index identity.
// [Output] Additive scope-only task creation and task-bound page evidence contracts.
// [Pos] Reflections v2 uses the existing analysis_content_json column and connector snapshot.
// [Sync] 2026-10-23: keep v1 immutable; record actual page reads during Agent execution.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
import { notionLightSnapshotDto } from "./notionLightSnapshotDto";
import { reflectionTaskCreateInputDto, reflectionTaskGetOutputDto, reflectionTaskLookupDto, reflectionSectionDto } from "./reflectionTaskDto";
import { reflectionAgentInputDto, reflectionAgentSnapshotDto, reflectionAnalysisSummaryDto } from "./reflectionAnalysisContentDto";
const id = z.string().min(1).max(256);
export const reflectionNotionScopeSelectionDto = z.strictObject({ connector_id: id, snapshot_version: id });
export const reflectionNotionReadDto = z.strictObject({ page_id: id, title: z.string(), url: z.string().nullable(),
  markdown: z.string(), content_sha256: z.string().regex(/^[0-9a-f]{64}$/), read_at: isoTimeDto });
export const reflectionNotionScopeDto = reflectionNotionScopeSelectionDto.extend({ snapshot: notionLightSnapshotDto,
  pages: z.array(reflectionNotionReadDto), empty_page_ids: z.array(id) });
export const reflectionScopeSelectionDto = z.strictObject({ diary_session_ids: z.array(id).nullable(),
  notion: reflectionNotionScopeSelectionDto.nullable(), agent: reflectionAgentInputDto.nullable() });
export const reflectionScopeCreateDto = reflectionTaskCreateInputDto.extend({ analysis_content: reflectionScopeSelectionDto }).refine(value => {
  const selected = value.analysis_content.diary_session_ids;
  return selected === null ? value.input_snapshot.session_ids.length === 0
    : selected.length === value.input_snapshot.session_ids.length && new Set(selected).size === selected.length
      && selected.every((id, index) => id === value.input_snapshot.session_ids[index]);
}, { message: "Diary selection must match the task input." });
export const reflectionScopeSnapshotDto = z.strictObject({ diary_session_ids: z.array(id).nullable(),
  notion: reflectionNotionScopeDto.nullable(), agent: reflectionAgentSnapshotDto.nullable() });
const readBinding = z.strictObject({ task_id: z.string().uuid(), section: reflectionSectionDto, thread_id: id, section_revision: z.number().int().positive().safe(), page_id: id });
export const reflectionNotionReadContextDto = readBinding;
export const reflectionNotionEvidenceInputDto = readBinding.extend({ page: reflectionNotionReadDto });
const readOutput = z.strictObject({ page: reflectionNotionReadDto.nullable() });
export function reflectionScopeSummary(content: z.infer<typeof reflectionScopeSnapshotDto>) {
  return reflectionAnalysisSummaryDto.parse({ diary_session_ids: content.diary_session_ids,
    notion: content.notion ? { connector_id: content.notion.connector_id, snapshot_version: content.notion.snapshot_version,
      pages: content.notion.pages.filter(page => page.markdown.trim()).map(({ markdown: _markdown, ...page }) => page),
      empty_page_count: content.notion.pages.filter(page => !page.markdown.trim()).length } : null,
    agent: content.agent ? { deck_id: content.agent.deck_id, agent_id: content.agent.agent_id,
      deck_name: content.agent.deck_name, agent_name: content.agent.agent_name } : null });
}
export const reflectionNotionScopeOperations = {
  "reflection-task.v2.create-with-content": { audience: "oauth", kind: "write", userScope: "dream:write", input: reflectionScopeCreateDto, output: reflectionTaskGetOutputDto },
  "reflection-task.v2.analysis-content": { audience: "oauth", kind: "read", userScope: "dream:read", input: reflectionTaskLookupDto, output: z.strictObject({ analysis_content: reflectionAnalysisSummaryDto.nullable() }) },
  "reflection-task.v2.analysis-content-load": { audience: "background", kind: "read", backgroundScope: "reflections:execute", input: reflectionTaskLookupDto, output: z.strictObject({ analysis_content: reflectionScopeSnapshotDto }) },
  "reflection-task.v2.notion-context": { audience: "background", kind: "read", backgroundScope: "reflections:execute", input: readBinding, output: readOutput },
  "reflection-task.v2.notion-evidence": { audience: "background", kind: "write", backgroundScope: "reflections:execute", input: reflectionNotionEvidenceInputDto, output: readOutput },
} as const;
export type ReflectionNotionScopeOperation = keyof typeof reflectionNotionScopeOperations;
