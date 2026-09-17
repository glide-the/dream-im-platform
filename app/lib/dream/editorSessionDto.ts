// [Input] Actual Dream EditorEngine state and named Session business requests.
// [Output] Closed state/metadata projections; no arbitrary table JSON or caller identity.
// [Pos] Editor and Session wire contract independent of PostgreSQL entities.
// [Sync] 2026-09-14: preserve last-write semantics, precise timestamps and explicit missing state.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
const entityId = z.string().min(1);
const textCell = z.strictObject({ id: entityId, type: z.literal("text"), content: z.string() });
const widgetCell = z.strictObject({ id: entityId, type: z.literal("widget"), widgetType: z.enum(["chat", "greeting", "other"]), data: z.json() });
const suggestionCell = z.strictObject({ id: entityId, type: z.literal("writing-suggestion"), content: z.string(), status: z.enum(["idle", "streaming", "completed", "failed"]), anchor: z.strictObject({ textCellId: entityId, textSnapshot: z.string() }), createdAt: isoTimeDto, updatedAt: isoTimeDto, error: z.strictObject({ code: z.string(), message: z.string(), retryable: z.boolean() }).optional(), requestId: z.string().optional(), previousContent: z.string().optional() });
export const editorStateDto = z.strictObject({
  id: entityId, cells: z.array(z.discriminatedUnion("type", [textCell, widgetCell, suggestionCell])),
  commentors: z.array(z.strictObject({ id: entityId, phrase: z.string(), comment: z.string(), voiceId: z.string().optional(), voice: z.string(), icon: z.string(), color: z.string(), appliedAt: z.number().optional(), computedAt: z.number(), textSnapshot: z.string(), chatHistory: z.array(z.strictObject({ role: z.enum(["assistant", "user"]), content: z.string(), timestamp: z.number() })).optional(), feedback: z.enum(["star", "kill"]).optional() })),
  tasks: z.array(z.strictObject({ id: entityId, type: z.enum(["searching", "thinking", "other"]), message: z.string(), startedAt: z.number(), completedAt: z.number().optional() })),
  weightPath: z.array(z.strictObject({ timestamp: z.number(), text: z.string(), weight: z.number(), delta: z.number(), energy: z.number() })),
  overlappedPhrases: z.array(z.string()), notFoundPhrases: z.array(z.string()), writingThreadId: entityId.optional(), selectedState: z.string().nullable().optional(), createdAt: isoTimeDto.optional(),
});
export type EditorStateDto = z.infer<typeof editorStateDto>;
export const editorLoadInputDto = z.strictObject({ session_id: entityId });
export const editorLoadOutputDto = z.strictObject({ session_id: entityId, editor_state: editorStateDto.nullable(), updated_at: isoTimeDto.nullable() });
export const editorReplaceInputDto = z.strictObject({ session_id: entityId, editor_state: editorStateDto });
export const editorReplaceOutputDto = z.strictObject({ saved: z.literal(true), session_id: entityId, updated_at: isoTimeDto });
export const sessionDto = z.strictObject({ id: entityId, name: z.string().nullable(), editor_state: editorStateDto, labels: z.array(z.string()), created_at: isoTimeDto.nullable(), updated_at: isoTimeDto.nullable() });
export const sessionSaveInputDto = z.strictObject({ session_id: entityId, editor_state: editorStateDto, name: z.string().nullable(), labels: z.array(z.string()).nullable(), created_at: isoTimeDto.nullable() });
export const sessionPreviewDto = sessionDto.omit({ editor_state: true }).extend({ first_line: z.string(), text: z.string().nullable() });
export const editorSessionOperationContracts = {
  "editor-state.load": { kind: "read", userScope: "editor:read", input: editorLoadInputDto, output: editorLoadOutputDto },
  "editor-state.replace": { kind: "write", userScope: "editor:write", input: editorReplaceInputDto, output: editorReplaceOutputDto },
  "session.save": { kind: "write", userScope: "dream:write", input: sessionSaveInputDto, output: z.strictObject({ session: sessionDto }) },
  "session.get": { kind: "read", userScope: "dream:read", input: editorLoadInputDto, output: z.strictObject({ session: sessionDto.nullable() }) },
  "session.batch": { kind: "read", userScope: "dream:read", input: z.strictObject({ session_ids: z.array(entityId) }), output: z.strictObject({ sessions: z.array(sessionDto) }) },
  "session.list": { kind: "read", userScope: "dream:read", input: z.strictObject({ start_date: z.iso.date().nullable(), end_date: z.iso.date().nullable(), include_text: z.boolean() }), output: z.strictObject({ sessions: z.array(sessionPreviewDto) }) },
  "session.text-list": { kind: "read", userScope: "dream:read", input: z.strictObject({}), output: z.strictObject({ sessions: z.array(sessionPreviewDto.omit({ labels: true, first_line: true })) }) },
  "session.delete": { kind: "write", userScope: "dream:write", input: editorLoadInputDto, output: z.strictObject({ deleted: z.literal(true) }) },
} as const;
export type EditorSessionOperation = keyof typeof editorSessionOperationContracts;
