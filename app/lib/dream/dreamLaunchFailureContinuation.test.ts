// [Input] Synthetic strict continuation facts with no private files, credentials, HTTP or database.
// [Output] Required evidence, coverage and zero-positive-POST/full-row preservation guard checks.
// [Pos] Harness integrity tests under the existing Vitest app include; not production/source acceptance.
// [Sync] 2026-09-17: build the synthetic fixture with the confidential client's OAuth access token field.
// [Sync] 2026-09-15: preserve first failure; literal token typing leaves the twelve guard cases unchanged.
import { expect, it } from "vitest";
import type { z } from "zod";
import { acceptedFailureLabels, assertDeniedFailurePost, assertFailureContinuation, assertFailureRowsRetained, failureContinuationEvidenceDto,
  failureContinuationFixtureDto, failureProtectedRelations, type FailureProtectedRows } from "../../../tests/integration/adminDreamLaunchFailureContinuation";
const result = { updated: true, workflow_run_id: "run_" + "a".repeat(32), thread_id: "thread", message_id: "message", error_code: "original_error" };
function rows(): FailureProtectedRows { return Object.fromEntries(failureProtectedRelations.map(key => [key, []])) as FailureProtectedRows; }
function fixture() {
  const positive = acceptedFailureLabels.map((label, index) => ({ label, request_id: `positive-${index}`, token: index === 5 ? "matching_run" : "user", input: {}, status: 200,
    expected_code: null, expected_result: { ...result, updated: index !== 4 }, scenario: index === 4 ? "missing_source" : "updated", concurrent: index === 0, replay: index === 0 }));
  const denied = Array.from({ length: 16 }, (_value, index) => ({ label: `denied-${index}`, request_id: `denied-${index}`, token: ["read_only", "wrong_run", "editor", "none"][index % 4], input: {},
    status: index === 4 ? 400 : index === 5 ? 409 : 403, expected_code: index === 4 ? "INPUT_INVALID" : index === 5 ? "OPERATION_REQUEST_CONFLICT" : index % 4 === 2 ? "DELEGATION_ENTITY_DENIED" : "ACCESS_SCOPE_REQUIRED",
    expected_result: null, scenario: "denied", concurrent: false, replay: false }));
  const receipt: z.input<typeof failureContinuationFixtureDto>["receipts"][number] = { after_label: positive[0].label, request_id: positive[0].request_id, token: "user", query_tail: "", status: 200, expected_code: null,
    state: "committed", source_label: positive[0].label, expected_result: positive[0].expected_result, historical_later_lease: false };
  const receipts: z.input<typeof failureContinuationFixtureDto>["receipts"] = Array.from({ length: 27 }, () => ({ ...receipt }));
  receipts[0] = { ...receipt, request_id: "historical", source_label: null, historical_later_lease: true };
  for (const [index, token] of (["read_only", "matching_run", "editor"] as const).entries()) receipts[index + 1] = { ...receipt, token, status: 403, expected_code: "ACCESS_SCOPE_REQUIRED", state: null, source_label: null, expected_result: null };
  receipts[4] = { ...receipt, token: "other", state: "absent", source_label: null, expected_result: null };
  receipts[5] = { ...receipt, query_tail: "&unexpected=caller", status: 404, expected_code: "INPUT_INVALID", state: null, source_label: null, expected_result: null };
  receipts[6] = { ...receipts[5], query_tail: "&actor_id=caller", status: 400, expected_code: "USER_OVERRIDE_FORBIDDEN" };
  receipts[7] = { ...receipts[5], query_tail: "", status: 409, expected_code: "OPERATION_REQUEST_CONFLICT" };
  const bearers = Object.fromEntries(["user", "other", "read_only", "matching_run", "wrong_run", "editor"].map(label => [label, "value"]));
  return failureContinuationFixtureDto.parse({ database: "ink_auth_data_codex_test_guard", port: 9999, data_directory: "/private/tmp/ink-auth-data-migration-guard", target_verification_url: "value",
    issuer: "value", service_id: "value", service_access_token: "value", auth_role: "value", data_role: "value", verification_role: "value", source_root: "value", oracle_python: "value", source_oracle_secret: "value",
    operation_contract_sha256: "a".repeat(64), subjects: bearers, tokens: bearers, canonical_ids: Object.fromEntries(Object.keys(bearers).map(key => [key, "1"])), cases: [...positive, ...denied], receipts });
}
function evidence() { return failureContinuationEvidenceDto.parse({ schema_version: 1, database: "ink_auth_data_codex_test_guard", partial_assertions: 287,
  editor_probe: { status: 403, code: "DELEGATION_ENTITY_DENIED", assertions: 6 }, accepted_positive_labels: [...acceptedFailureLabels], prepublic_rows: rows(), current_rows: rows() }); }
it("retains all22/27 and returns only six read restorations and sixteen denied calls", () => {
  const prepared = assertFailureContinuation(fixture(), evidence()); expect(prepared.positive).toHaveLength(6); expect(prepared.denied).toHaveLength(16);
  prepared.denied.forEach(assertDeniedFailurePost); prepared.positive.forEach(item => expect(() => assertDeniedFailurePost(item)).toThrow("Only denied"));
});
it("rejects missing, broad or fabricated partial-progress evidence", () => {
  expect(failureContinuationEvidenceDto.safeParse(null).success).toBe(false);
  for (const patch of [{ partial_assertions: 286 }, { accepted_positive_labels: acceptedFailureLabels.slice(1) }, { completed_indices: [0] }, { validation_scope: "skip" }, { editor_probe: { status: 403, code: "ACCESS_SCOPE_REQUIRED", assertions: 6 } }])
    expect(failureContinuationEvidenceDto.safeParse({ ...evidence(), ...patch }).success).toBe(false);
});
it("rejects wrong target, duplicated or substituted accepted labels", () => {
  for (const patch of [{ database: "different" }, { accepted_positive_labels: Array(6).fill(acceptedFailureLabels[0]) }, { accepted_positive_labels: [...acceptedFailureLabels.slice(0, 5), "unaccepted"] }])
    expect(() => assertFailureContinuation(fixture(), { ...evidence(), ...patch })).toThrow();
});
it("rejects dropped cases, dropped GETs and added selectors", () => {
  const f = fixture();
  for (const patch of [{ cases: f.cases.slice(1) }, { receipts: f.receipts.slice(1) }, { actor_id: "caller" }, { prior_completed: [] }])
    expect(failureContinuationFixtureDto.safeParse({ ...f, ...patch }).success).toBe(false);
});
it("rejects positive injection, concurrent denial and replay denial before HTTP", () => {
  const f = fixture(), denial = f.cases[6];
  for (const patch of [{ status: 200 as const }, { scenario: "updated" as const }, { expected_result: result }, { expected_code: null }, { concurrent: true }, { replay: true }])
    expect(() => assertDeniedFailurePost({ ...denial, ...patch })).toThrow("Only denied");
});
it("requires corrected Editor binding-first status and actual safe code", () => {
  for (const patch of [{ status: 401 as const }, { expected_code: "ACCESS_SCOPE_REQUIRED" }]) {
    const f = fixture(); f.cases[8] = { ...f.cases[8], ...patch }; expect(() => assertFailureContinuation(f, evidence())).toThrow("Editor binding-first");
  }
});
it("cannot drop any denial or original recovery boundary", () => {
  const f = fixture(); f.cases = f.cases.map(item => item.token === "none" ? { ...item, token: "other" } : item);
  expect(() => assertFailureContinuation(f, evidence())).toThrow("Every denial");
  const g = fixture(); g.receipts = g.receipts.map(item => item.historical_later_lease ? { ...item, historical_later_lease: false, source_label: g.cases[0].label, request_id: g.cases[0].request_id } : item);
  expect(() => assertFailureContinuation(g, evidence())).toThrow("Later historical");
});
it("rejects incomplete positive results and unrelated GET completion sources", () => {
  const f = fixture(); f.cases[0].expected_result = null; expect(() => assertFailureContinuation(f, evidence())).toThrow("Complete independent");
  const g = fixture(); g.receipts[8].source_label = "denied-0"; expect(() => assertFailureContinuation(g, evidence())).toThrow("Recovered six");
});
it("requires exactly seventeen literal relation arrays with no alias or extra relation", () => {
  const e = evidence(), { [failureProtectedRelations[0]]: ignored, ...missing } = e.current_rows; void ignored;
  for (const current_rows of [missing, { ...e.current_rows, threads: [] }, { ...e.current_rows, "public.users": [] }])
    expect(failureContinuationEvidenceDto.safeParse({ ...e, current_rows }).success).toBe(false);
});
it("allows new seed rows while retaining historical bigint/raw microsecond rows byte exactly", () => {
  const before = rows(), current = rows(); const old = '{"id":"run","created_by":9007199254740993,"time":"2026-09-15T00:00:00.123456Z"}';
  before["public.workflow_runs"] = [old]; current["public.workflow_runs"] = [old, '{"id":"new"}'];
  expect(() => assertFailureRowsRetained(before, current, new Set())).not.toThrow();
  current["public.workflow_runs"][0] = old.replace("9007199254740993", "9007199254740992"); expect(() => assertFailureRowsRetained(before, current, new Set())).toThrow("Every historical");
});
it("permits only accepted source metadata changes with full other fields intact", () => {
  const before = rows(), current = rows(); const source = { id: "source", parts: '{"n":9007199254740993,"negative":-0.0}', created_at: "exact.123456", history_projection_version: 1, metadata: "old" };
  before["public.chat_message"] = [JSON.stringify(source)]; current["public.chat_message"] = [JSON.stringify({ ...source, metadata: "new" })];
  expect(() => assertFailureRowsRetained(before, current, new Set(["source"]))).not.toThrow();
  expect(() => assertFailureRowsRetained(before, current, new Set())).toThrow("Only accepted");
  for (const patch of [{ parts: "changed" }, { created_at: "rounded" }, { history_projection_version: 2 }]) {
    current["public.chat_message"] = [JSON.stringify({ ...source, ...patch, metadata: "new" })];
    expect(() => assertFailureRowsRetained(before, current, new Set(["source"]))).toThrow("Original full source");
  }
});
it("rejects missing historical rows and duplicate current source evidence", () => {
  const before = rows(), current = rows(); before["public.chat_message"] = ['{"id":"source","metadata":"old"}'];
  expect(() => assertFailureRowsRetained(before, current, new Set(["source"]))).toThrow("remain unique");
  current["public.chat_message"] = ['{"id":"source","metadata":"new"}', '{"id":"source","metadata":"different"}'];
  expect(() => assertFailureRowsRetained(before, current, new Set(["source"]))).toThrow("remain unique");
});
