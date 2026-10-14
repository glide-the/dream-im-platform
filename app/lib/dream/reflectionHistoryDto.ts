// [Input] Existing Reflections report DTO, ISO instants and PostgreSQL decimal identities.
// [Output] Additive owner-scoped history-page input/output; legacy Registry99 stays frozen.
// [Pos] Reflections analysis history wire boundary.
// [Sync] 2026-10-14: use exact creation-time/id cursors without new schema.
import { z } from "zod";
import { decimalIdDto, isoTimeDto } from "../auth/dto";
import { analysisReportDto, reflectionTaskIdDto } from "./reflectionTaskDto";

export const reflectionHistoryCursorDto = z.strictObject({ created_at: isoTimeDto, id: decimalIdDto });
export const reflectionHistoryInputDto = z.strictObject({
  limit: z.number().int().positive().safe().default(10),
  before: reflectionHistoryCursorDto.nullable().default(null),
});
export const reflectionHistoryReportDto = analysisReportDto.extend({
  task_id: reflectionTaskIdDto.nullable(),
  analysis_created_at: isoTimeDto,
});
export const reflectionHistoryOutputDto = z.strictObject({
  reports: z.array(reflectionHistoryReportDto),
  next_cursor: reflectionHistoryCursorDto.nullable(),
});
export const reflectionHistoryOperations = {
  "analysis-report.history-page": { kind: "read", userScope: "dream:read", input: reflectionHistoryInputDto, output: reflectionHistoryOutputDto },
} as const;
