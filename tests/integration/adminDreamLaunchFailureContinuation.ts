// [Input] Original strict22 cases/27 GET facts and primary-owned partial287/Editor6 full-row evidence.
// [Output] Exactly six read-only restorations, sixteen denied POSTs and all twenty-seven original GETs.
// [Pos] Pure harness guards; no credentials, pools, HTTP, production fallback or inferred progress.
// [Sync] 2026-09-15: independently continue the retained failed first run without any positive POST.
import assert from "node:assert/strict";
import { z } from "zod";
import { decimalIdDto, requestIdDto } from "../../app/lib/auth/dto";
import { dreamLaunchFailureEnvelopeOutputDto as outputDto } from "../../app/lib/dream/dreamLaunchFailureDto";
export const failureProtectedRelations = [
  "public.chat_thread", "public.chat_message", "public.story_workspace_workspaces", "public.decks", "public.voices",
  "public.workflow_runs", "public.workflow_run_transitions", "public.workflow_run_token_consumptions", "public.workflow_preflights",
  "dream.workflow_preflight_requests", "public.agent_sessions", "public.deck_plugin_bindings", "public.deck_plugin_releases",
  "public.deck_runtime_snapshots", "public.deck_runtime_plugin_locks", "dream.operation_receipts", "public.admin_audit_logs",
] as const;
export const acceptedFailureLabels = ["first_rich_null", "nonnull_agent", "invalid_raw_recovery", "nonobject_raw_recovery", "missing_source_noop", "matching_persistence"] as const;
const text = z.string().min(1), label = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), code = z.string().regex(/^[A-Z0-9_]{1,100}$/);
export const failureTokenDto = z.enum(["user", "other", "read_only", "matching_run", "wrong_run", "editor", "none"]);
const status = z.union([z.literal(200), z.literal(400), z.literal(401), z.literal(403), z.literal(404), z.literal(409), z.literal(503)]);
export const failureContinuationCaseDto = z.strictObject({ label, request_id: requestIdDto, token: failureTokenDto, input: z.json(), status,
  expected_code: code.nullable(), expected_result: outputDto.nullable(), scenario: z.enum(["updated", "missing_source", "denied"]), concurrent: z.boolean(), replay: z.boolean() });
const receiptDto = z.strictObject({ after_label: label, request_id: requestIdDto, token: failureTokenDto, query_tail: z.string(), status,
  expected_code: code.nullable(), state: z.enum(["absent", "committed"]).nullable(), source_label: label.nullable(), expected_result: outputDto.nullable(), historical_later_lease: z.boolean() });
const bearerFields = { user: text, other: text, read_only: text, matching_run: text, wrong_run: text, editor: text };
const canonicalFields = { user: decimalIdDto, other: decimalIdDto, read_only: decimalIdDto, matching_run: decimalIdDto, wrong_run: decimalIdDto, editor: decimalIdDto };
export const failureContinuationFixtureDto = z.strictObject({ database: text, port: z.number().int().positive(), data_directory: text, target_verification_url: text,
  issuer: text, service_id: text, service_secret: text, auth_role: text, data_role: text, verification_role: text,
  source_root: text, oracle_python: text, source_oracle_secret: text, operation_contract_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  subjects: z.strictObject(bearerFields), canonical_ids: z.strictObject(canonicalFields), tokens: z.strictObject(bearerFields),
  cases: z.array(failureContinuationCaseDto).length(22), receipts: z.array(receiptDto).length(27) });
export const failureProtectedRowsDto = z.strictObject(Object.fromEntries(failureProtectedRelations.map(name => [name, z.array(z.string())])));
export const failureContinuationEvidenceDto = z.strictObject({ schema_version: z.literal(1), database: text, partial_assertions: z.literal(287),
  editor_probe: z.strictObject({ status: z.literal(403), code: z.literal("DELEGATION_ENTITY_DENIED"), assertions: z.literal(6) }),
  accepted_positive_labels: z.array(label).length(6), prepublic_rows: failureProtectedRowsDto, current_rows: failureProtectedRowsDto });
export type FailureContinuationCase = z.output<typeof failureContinuationCaseDto>;
export type FailureProtectedRows = Record<typeof failureProtectedRelations[number], string[]>;
export function assertFailureRowsRetained(before: FailureProtectedRows, current: FailureProtectedRows, updatedMessages: ReadonlySet<string>) {
  for (const relation of failureProtectedRelations) {
    assert(new Set(before[relation]).size === before[relation].length && new Set(current[relation]).size === current[relation].length, "Full rows must be unique");
    for (const raw of before[relation]) {
      if (current[relation].includes(raw)) continue;
      assert(relation === "public.chat_message", "Every historical non-target full row must remain");
      const old = JSON.parse(raw) as Record<string, unknown>;
      assert(typeof old.id === "string" && updatedMessages.has(old.id), "Only accepted source metadata may differ");
      const matches = current[relation].map(value => JSON.parse(value) as Record<string, unknown>).filter(value => value.id === old.id);
      assert(matches.length === 1, "Original source row must remain unique");
      // chat_message fields are text/timestamps, booleans and int32; metadata/parts remain raw text.
      const { metadata: oldMetadata, ...oldFields } = old, { metadata: newMetadata, ...newFields } = matches[0];
      void oldMetadata; void newMetadata;
      assert(JSON.stringify(oldFields) === JSON.stringify(newFields), "Original full source fields except metadata must remain");
    }
  }
}
export function assertDeniedFailurePost(item: FailureContinuationCase) {
  assert(item.status !== 200 && item.scenario === "denied" && item.expected_result === null && item.expected_code !== null && !item.concurrent && !item.replay, "Only denied POST is permitted");
}
export function assertFailureContinuation(f: z.output<typeof failureContinuationFixtureDto>, evidence: z.output<typeof failureContinuationEvidenceDto>) {
  assert(f.database === evidence.database, "Evidence target must match fixture");
  assert(new Set(evidence.accepted_positive_labels).size === 6 && acceptedFailureLabels.every(value => evidence.accepted_positive_labels.includes(value)), "Exact six accepted labels required");
  assert(new Set(f.cases.map(item => item.label)).size === 22 && new Set(f.cases.map(item => item.request_id)).size === 22, "Distinct twenty-two original cases required");
  const positive = f.cases.filter(item => item.status === 200), denied = f.cases.filter(item => item.status !== 200);
  assert(positive.length === 6 && denied.length === 16 && positive.every(item => evidence.accepted_positive_labels.includes(item.label)), "Six restorations and sixteen denials required");
  assert(positive.some(item => item.concurrent) && positive.some(item => item.replay), "Historical first concurrency and replay facts required");
  assert(positive.some(item => item.token === "matching_run") && positive.some(item => item.scenario === "missing_source"), "Original persistence and missing source facts required");
  for (const item of positive) assert(item.expected_result !== null && item.expected_code === null && ["user", "matching_run"].includes(item.token) && item.scenario !== "denied" && item.expected_result.updated === (item.scenario === "updated"), "Complete independent positive expectation required");
  denied.forEach(assertDeniedFailurePost);
  for (const token of ["read_only", "wrong_run", "editor", "none"] as const) assert(denied.some(item => item.token === token), "Every denial boundary required");
  assert(denied.filter(item => item.token === "editor").every(item => item.status === 403 && item.expected_code === evidence.editor_probe.code), "Editor binding-first probe must match");
  assert(denied.some(item => item.status === 400 && item.expected_code === "INPUT_INVALID") && denied.some(item => item.status === 409 && item.expected_code === "OPERATION_REQUEST_CONFLICT"), "Strict input and digest conflict required");
  for (const item of f.receipts) {
    assert(f.cases.some(value => value.label === item.after_label), "Original GET checkpoint label required");
    if (item.status === 200 && item.state === "committed") {
      assert(item.expected_result !== null, "Full original GET expectation required");
      if (item.historical_later_lease) assert(item.source_label === null && item.token === "user" && !f.cases.some(value => value.request_id === item.request_id), "Separate preexisting historical original required");
      else assert(item.source_label !== null && positive.some(value => value.label === item.source_label && value.request_id === item.request_id), "Recovered six original result source required");
    } else assert(!item.historical_later_lease && item.expected_result === null, "Only committed original has completion");
  }
  assert(f.receipts.some(item => item.historical_later_lease), "Later historical lease required");
  for (const token of ["read_only", "matching_run", "editor"] as const) assert(f.receipts.some(item => item.token === token && item.status === 403), "OAuth-only GET denials required");
  assert(f.receipts.some(item => item.token === "other" && item.status === 200 && item.state === "absent"), "Other actor absent required");
  assert(f.receipts.some(item => item.query_tail === "&unexpected=caller" && item.status === 404), "Ordinary query rejection required");
  assert(f.receipts.some(item => item.query_tail === "&actor_id=caller" && item.status === 400 && item.expected_code === "USER_OVERRIDE_FORBIDDEN"), "Identity override boundary required");
  assert(f.receipts.some(item => item.status === 409 && item.expected_code === "OPERATION_REQUEST_CONFLICT"), "Original input/result conflict required");
  return { positive, denied };
}
