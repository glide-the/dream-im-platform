// [Input] Actor-free named Run lookup and the original full Workflow lifecycle/history fields.
// [Output] Closed Run/Transition DTOs retaining nullable provenance and exact PostgreSQL microseconds.
// [Pos] Production Workflow read contract; state edges belong to subsequent atomic commands.
// [Sync] 2026-09-15: preserve original stored key codepoint limits with identical JSON schema metadata.
import { z } from "zod";
import { workflowRunProtocolPolicy } from "../../../config/workflow-run-policy";
import { isoTimeDto } from "../auth/dto";
import { stripPydanticString } from "./deckPluginManifestDto";

const text = z.string().overwrite(stripPydanticString);
const identifier = text.min(1);
export const workflowRunKeyDto = text.min(1).refine(value => Array.from(value).length <= workflowRunProtocolPolicy.idempotencyKeyMaxCharacters)
  .meta({ maxLength: workflowRunProtocolPolicy.idempotencyKeyMaxCharacters });
export const workflowRunIdDto = text.regex(/^run_[0-9a-f]{32}$/);
export const workflowRunStatusDto = z.enum(["preflight", "queued", "running", "output_validating", "pending_review", "confirmed", "rejected", "completed", "failed", "cancelled"]);
const hash = text.regex(/^sha256:[0-9a-f]{64}$/);
// The storage representation has at most six fractional digits; ordering must
// compare those digits, rather than truncating lifecycle facts to milliseconds.
export const workflowTimeDto = isoTimeDto.refine(value => (value.match(/\.(\d+)/)?.[1].length ?? 0) <= 6);
export function workflowTimestampMicros(value: string): bigint {
  const valid = workflowTimeDto.parse(value);
  const match = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(valid)!;
  return BigInt(Date.parse(`${match[1]}${match[3]}`)) * 1_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}
export function workflowUtcMicroseconds(value: string): string {
  return workflowUtcFromMicroseconds(workflowTimestampMicros(value));
}
export function workflowUtcFromMicroseconds(micros: bigint): string {
  const fraction = ((micros % 1_000_000n) + 1_000_000n) % 1_000_000n;
  const seconds = (micros - fraction) / 1_000_000n;
  return new Date(Number(seconds * 1_000n)).toISOString().replace(/\.000Z$/, `.${fraction.toString().padStart(6, "0")}+00:00`);
}
const terminalStatuses = new Set(["rejected", "completed", "failed", "cancelled"]);
const startedStatuses = new Set(["running", "output_validating", "pending_review", "confirmed", "rejected", "completed"]);
export const workflowRunDto = z.strictObject({
  workflow_run_id: workflowRunIdDto, deck_plugin_id: identifier, deck_plugin_version: identifier,
  workflow_definition_ref: identifier, deck_runtime_snapshot_id: identifier, status: workflowRunStatusDto,
  failed_step: text.nullable(), error_code: text.nullable(), retry_of_run_id: workflowRunIdDto.nullable(),
  deck_plugin_manifest_hash: hash, deck_plugin_binding_id: identifier, binding_revision: z.number().int().positive().safe(),
  runtime_plugin_lock_id: identifier, runtime_load_receipt_id: text.nullable(),
  workflow_preflight_id: text.regex(/^pf_[0-9a-f]{32}$/), agent_session_id: text.regex(/^as_[0-9a-f]{32}$/).nullable(),
  source_voice_thread_id: text.nullable(), source_message_id: text.nullable(), source_message_time: workflowTimeDto.nullable(),
  workspace_id: identifier, idempotency_key: workflowRunKeyDto, input_hash: hash, semantic_fingerprint: hash,
  status_version: z.number().int().positive().safe(), created_by: identifier, created_at: workflowTimeDto,
  started_at: workflowTimeDto.nullable(), completed_at: workflowTimeDto.nullable(),
}).superRefine((run, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: "custom", message });
  if (run.status === "failed" ? run.failed_step === null || run.error_code === null : run.failed_step !== null || run.error_code !== null) invalid("Failure fields must match Run status.");
  const hasReceipt = run.runtime_load_receipt_id !== null;
  if (hasReceipt !== (run.agent_session_id !== null)) invalid("Receipt and Session bindings must be joint.");
  if (startedStatuses.has(run.status) && !hasReceipt) invalid("Started Runs require receipt and Session bindings.");
  if (["preflight", "queued"].includes(run.status) && hasReceipt) invalid("Unstarted Runs cannot bind receipt and Session.");
  const sourceCount = [run.source_voice_thread_id, run.source_message_id, run.source_message_time].filter(value => value !== null).length;
  if (![0, 3].includes(sourceCount) && !(sourceCount === 1 && run.source_voice_thread_id !== null)) invalid("Voice sources require the original complete tuple.");
  if (run.agent_session_id !== null && [run.source_voice_thread_id, run.source_message_id].includes(run.agent_session_id)) invalid("Voice sources cannot be Agent Session identifiers.");
  if ([run.created_at, run.started_at, run.completed_at].some(value => value !== null && !workflowTimeDto.safeParse(value).success)) return;
  const created = workflowTimestampMicros(run.created_at);
  const started = run.started_at === null ? null : workflowTimestampMicros(run.started_at);
  const completed = run.completed_at === null ? null : workflowTimestampMicros(run.completed_at);
  if (started !== null && started < created) invalid("Run start cannot precede creation.");
  if (completed !== null && (completed < created || (started !== null && completed < started))) invalid("Run completion cannot precede creation or start.");
  if (terminalStatuses.has(run.status) !== (completed !== null)) invalid("Only terminal Runs require completion time.");
});
export const workflowRunTransitionDto = z.strictObject({
  transition_id: text.regex(/^wrt_[0-9a-f]{32}$/), workflow_run_id: workflowRunIdDto,
  transition_seq: z.number().int().positive().safe(), from_status: workflowRunStatusDto.nullable(), to_status: workflowRunStatusDto,
  actor_id: identifier, reason_code: text.nullable(), failed_step: text.nullable(), error_code: text.nullable(), occurred_at: workflowTimeDto,
}).superRefine((transition, ctx) => {
  if (transition.from_status === null ? transition.transition_seq !== 1 || transition.to_status !== "preflight" : transition.from_status === transition.to_status) ctx.addIssue({ code: "custom", message: "Transition must be a real change or the original initial preflight event." });
  if (transition.to_status === "failed" ? transition.failed_step === null || transition.error_code === null : transition.failed_step !== null || transition.error_code !== null) ctx.addIssue({ code: "custom", message: "Transition failure fields must match target status." });
});
export const workflowRunLookupInputDto = z.strictObject({ workspace_id: identifier, workflow_run_id: workflowRunIdDto });
export const workflowRunReadOutputDto = z.strictObject({ run: workflowRunDto });
export const workflowRunHistoryOutputDto = z.strictObject({ transitions: z.array(workflowRunTransitionDto) });
export const workflowRunOperationContracts = {
  "workflow-run.read": { kind: "read" as const, input: workflowRunLookupInputDto, output: workflowRunReadOutputDto, userScope: "dream:read" },
  "workflow-run.history": { kind: "read" as const, input: workflowRunLookupInputDto, output: workflowRunHistoryOutputDto, userScope: "dream:read" },
};
export type WorkflowRun = z.infer<typeof workflowRunDto>;
export type WorkflowRunLookup = z.infer<typeof workflowRunLookupInputDto>;
export type WorkflowRunOperation = keyof typeof workflowRunOperationContracts;
