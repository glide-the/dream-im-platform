// [Input] Named Editor/Session operation, active owner and optional exact Editor delegation scope.
// [Output] Strict domain state/projection, missing null and explicit corrupt/unavailable errors.
// [Pos] Session business boundary; Dream keeps metrics, SSE and in-memory editor orchestration.
// [Sync] 2026-09-15: allow a Reflections task authority to list metadata-only source Sessions.
import { AuthBoundaryError } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import type { DelegatedPrincipal } from "../auth/delegationService";
import type { DataTransaction } from "./database";
import { editorStateDto, editorSessionOperationContracts, type EditorSessionOperation, type EditorStateDto } from "./editorSessionDto";
import { EditorSessionRepository, type EditorSessionRow } from "./editorSessionRepository";
import { pgTimestampToIso } from "./chatThreadDto";
export type EditorSessionActor = {
  principal: PrincipalDto;
  editorSessionScope: string | null;
  threadScope: string | null;
  delegationPurpose: DelegatedPrincipal["purpose"] | "reflections-worker" | null;
};
function decodeState(row: EditorSessionRow): EditorStateDto {
  try {
    const state = editorStateDto.parse(JSON.parse(row.stateJson));
    if (state.id !== row.id) throw new Error("binding");
    return state;
  } catch { throw new AuthBoundaryError("EDITOR_STATE_INVALID", 503); }
}
function labels(row: EditorSessionRow) {
  try { const value: unknown = row.labelsJson ? JSON.parse(row.labelsJson) : []; return Array.isArray(value) && value.every(item => typeof item === "string") ? value : []; } catch { return []; }
}
function fullSession(row: EditorSessionRow) { return { id: row.id, name: row.name, editor_state: decodeState(row), labels: labels(row), created_at: pgTimestampToIso(row.createdAt), updated_at: pgTimestampToIso(row.updatedAt) }; }
function preview(row: EditorSessionRow, includeText: boolean, preserveCellWhitespace = false) {
  let text = "";
  try {
    const raw: unknown = JSON.parse(row.stateJson);
    if (raw && typeof raw === "object" && "cells" in raw && Array.isArray(raw.cells)) text = raw.cells.filter((cell): cell is { type: "text"; content: string } => Boolean(cell && typeof cell === "object" && cell.type === "text" && typeof cell.content === "string" && cell.content.trim())).map(cell => preserveCellWhitespace ? cell.content : cell.content.trim()).join("\n\n").trim();
  } catch { /* Existing metadata lists keep malformed prose out of previews. */ }
  return { id: row.id, name: row.name, labels: labels(row), created_at: pgTimestampToIso(row.createdAt), updated_at: pgTimestampToIso(row.updatedAt), first_line: Array.from(text.split("\n")[0] ?? "").slice(0, 30).join(""), text: includeText ? text : null };
}
export async function runEditorSessionOperation(name: EditorSessionOperation, rawInput: unknown, actor: EditorSessionActor, tx: DataTransaction) {
  principalDto.parse(actor.principal);
  const operation = editorSessionOperationContracts[name], input = operation.input.parse(rawInput);
  if (!actor.principal.scopes.includes(operation.userScope)) throw new AuthBoundaryError("ACCESS_SCOPE_REQUIRED", 403);
  const oauth = actor.delegationPurpose === null && actor.threadScope === null && actor.editorSessionScope === null;
  const editorDelegation = actor.delegationPurpose === "editor-stdio" && actor.threadScope !== null && actor.editorSessionScope !== null && name.startsWith("editor-state.");
  const persistenceSessionList = actor.delegationPurpose === "server-persistence" && actor.threadScope !== null && actor.editorSessionScope === null && name === "session.list";
  const reflectionSessionList = actor.delegationPurpose === "reflections-worker" && actor.threadScope !== null && actor.editorSessionScope === null && name === "session.list" && "include_text" in input && input.include_text === false;
  if (!oauth && !editorDelegation && !persistenceSessionList && !reflectionSessionList) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
  if (actor.editorSessionScope !== null && (!("session_id" in input) || input.session_id !== actor.editorSessionScope)) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
  const repository = new EditorSessionRepository(tx, actor.principal.canonical_user_id);
  async function validateState(sessionId: string, state: EditorStateDto) {
    if (state.id !== sessionId) throw new AuthBoundaryError("EDITOR_SESSION_MISMATCH", 400);
    if (state.writingThreadId && !await repository.ownsWritingThread(state.writingThreadId)) throw new AuthBoundaryError("ENTITY_NOT_FOUND", 404);
  }
  let result: unknown;
  switch (name) {
    case "editor-state.load": {
      const value = editorSessionOperationContracts[name].input.parse(input), row = await repository.current(value.session_id);
      result = { session_id: value.session_id, editor_state: row ? decodeState(row) : null, updated_at: row ? pgTimestampToIso(row.updatedAt) : null }; break;
    }
    case "editor-state.replace": {
      const value = editorSessionOperationContracts[name].input.parse(input);
      await validateState(value.session_id, value.editor_state);
      const row = await repository.replace(value.session_id, value.editor_state);
      if (!row) throw new AuthBoundaryError("ENTITY_NOT_FOUND", 404);
      result = { saved: true, session_id: value.session_id, updated_at: pgTimestampToIso(row.updatedAt) }; break;
    }
    case "session.save": {
      const value = editorSessionOperationContracts[name].input.parse(input);
      await validateState(value.session_id, value.editor_state);
      const row = await repository.save({ session_id: value.session_id, editor_state: value.editor_state, name: value.name ?? null, labels: value.labels ?? null, created_at: value.created_at ?? null });
      if (!row) throw new AuthBoundaryError("ENTITY_NOT_FOUND", 404);
      result = { session: fullSession(row) }; break;
    }
    case "session.get": {
      const value = editorSessionOperationContracts[name].input.parse(input), row = await repository.current(value.session_id);
      result = { session: row ? fullSession(row) : null }; break;
    }
    case "session.batch": result = { sessions: (await repository.batch(editorSessionOperationContracts[name].input.parse(input).session_ids)).map(fullSession) }; break;
    case "session.list": {
      const value = editorSessionOperationContracts[name].input.parse(input);
      result = { sessions: (await repository.list(value.start_date, value.end_date)).map(row => preview(row, value.include_text)) }; break;
    }
    case "session.text-list": result = { sessions: (await repository.list()).map(row => { const value = preview(row, true, true); return { id: value.id, name: value.name, created_at: value.created_at, updated_at: value.updated_at, text: value.text }; }) }; break;
    case "session.delete": await repository.delete(editorSessionOperationContracts[name].input.parse(input).session_id); result = { deleted: true }; break;
  }
  return operation.output.parse(result);
}
