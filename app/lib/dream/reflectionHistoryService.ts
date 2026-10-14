// [Input] OAuth owner, configured report page capacity and existing typed report Repository.
// [Output] Lossless report history ordered by actual analysis creation with exact keyset cursors.
// [Pos] Read-only Reflections history service; no task, report or schema writes.
// [Sync] 2026-10-14: retain legacy report list/save contracts and reject missing creation facts.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import { reflectionReportListCapacity } from "../../../config/reflection-task-policy";
import type { DataTransaction } from "./database";
import type { ReflectionTaskOAuthActor } from "./reflectionTaskService";
import { ReflectionTaskRepository } from "./reflectionTaskRepository";
import { reflectionHistoryInputDto, reflectionHistoryOutputDto } from "./reflectionHistoryDto";

export async function readReflectionHistory(raw: unknown, actor: ReflectionTaskOAuthActor, tx: DataTransaction) {
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes("dream:read") || actor.threadScope !== null || actor.editorSessionScope != null || actor.runScope != null) {
    throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
  }
  const input = reflectionHistoryInputDto.parse(raw);
  if (input.limit > reflectionReportListCapacity() || input.limit === Number.MAX_SAFE_INTEGER) {
    throw new AuthBoundaryError("REFLECTION_REPORT_LIMIT_EXCEEDED", 400);
  }
  const rows = await new ReflectionTaskRepository(tx).reportHistory(principal.canonical_user_id, input);
  const reports = rows.slice(0, input.limit);
  const last = reports.at(-1);
  const parsed = reflectionHistoryOutputDto.safeParse({ reports,
    next_cursor: rows.length > input.limit && last ? { created_at: last.analysis_created_at, id: last.id } : null,
  });
  if (!parsed.success) throw new AuthBoundaryError("REFLECTION_HISTORY_DATA_INVALID", 503);
  return parsed.data;
}
