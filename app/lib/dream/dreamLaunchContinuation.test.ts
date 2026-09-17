// [Input] Pure prepared-case/checkpoint shapes without file, database or credential access.
// [Output] Full-scope and single accepted-source bypass guards reject missing or broadened evidence.
// [Pos] Harness integrity checks; business POST/source assertions remain in the production-route harness.
// [Sync] 2026-09-15: permit only38 original cases with the first exact NULL-Agent source already committed.
import { expect, it } from "vitest";
import { assertLaunchContinuation, launchPriorCheckpointDto } from "../../../tests/integration/adminDreamLaunchContinuation";
const requestId = "original", thread = "11111111-1111-4111-8111-111111111111", message = "22222222-2222-4222-8222-222222222222";
const first = { label: "source-new-null", operation: "dream-launch-source.ensure", request_id: requestId, status: 200, token: "user", scenario: "source_new", thread_created: true,
  input: { workspace_id: "workspace", deck_id: "deck", agent_id: null, goal: "goal", idempotency_key: "key" } };
const cases = [first, ...Array.from({ length: 37 }, (_value, index) => ({ ...first, label: `retained-original-${index}`, request_id: `remaining-${index}`, status: 403, token: "other", scenario: "denied", thread_created: false }))];
const source = { thread_id: thread, message_id: message, message_time: "2026-09-15T00:00:00.123456+00:00", request_fingerprint: `sha256:${"a".repeat(64)}`, created: true };
function checkpoint() { return launchPriorCheckpointDto.parse({ database: "ink_auth_data_codex_test_fixture", port: 9999, data_directory: "/private/tmp/ink-auth-data-migration-fixture",
  states: Object.fromEntries(["threads", "messages", "workspaces", "decks", "voices", "runs", "transitions", "consumptions", "preflights", "preflight_requests", "sessions", "bindings", "releases", "snapshots", "locks", "receipts", "audits"].map(key => [key, []])),
  accepted: [{ label: first.label, operation: first.operation, request_id: requestId, row: { result: { schema_version: 1, data: { source }, thread_scope: thread, editor_session_scope: null }, input_sha256: "b".repeat(64), committed_at: "2026-09-15 00:00:00.123456+00" } }], source: {}, thread: {} }); }
const options = { validation_scope: "remaining_after_source_new_null" as const, prior_accepted_checkpoint: "/private/tmp/ink-auth-migration-validation/launch75-prior-accepted-state-private.json" };
it("full scope never skips a POST and rejects any checkpoint bypass", () => {
  expect(assertLaunchContinuation({ validation_scope: "full" }, cases, null)).toBeNull();
  expect(() => assertLaunchContinuation({ validation_scope: "full", prior_accepted_checkpoint: options.prior_accepted_checkpoint }, cases, checkpoint())).toThrow("Full acceptance");
});
it("only the exact first new NULL-Agent source with all38 originals returns a single skipped label", () => {
  expect(assertLaunchContinuation(options, cases, checkpoint())).toBe(first.label);
});
it("missing, unrelated or dropped-case evidence cannot authorize continuation", () => {
  expect(() => assertLaunchContinuation(options, cases, null)).toThrow("checkpoint");
  expect(() => assertLaunchContinuation({ ...options, prior_accepted_checkpoint: "/private/tmp/unrelated.json" }, cases, checkpoint())).toThrow("checkpoint");
  expect(() => assertLaunchContinuation(options, cases.slice(0, 37), checkpoint())).toThrow("original38");
  expect(() => assertLaunchContinuation(options, [...cases.slice(1), first], checkpoint())).toThrow("first exact");
});
it("other actor, non-null Agent, existing source or uncommitted status cannot skip a POST", () => {
  for (const patch of [{ token: "other" }, { input: { ...first.input, agent_id: "agent" } }, { scenario: "source_existing" }, { thread_created: false }, { status: 403 }, { request_id: "different" }])
    expect(() => assertLaunchContinuation(options, [{ ...first, ...patch }, ...cases.slice(1)], checkpoint())).toThrow("original new");
});
it("multiple accepted rows, missing protected table or extra selector fail the strict checkpoint schema", () => {
  const prior = checkpoint(); expect(launchPriorCheckpointDto.safeParse({ ...prior, accepted: [prior.accepted[0], prior.accepted[0]] }).success).toBe(false);
  const { runs: ignored, ...missing } = prior.states; void ignored;
  expect(launchPriorCheckpointDto.safeParse({ ...prior, states: missing }).success).toBe(false);
  expect(launchPriorCheckpointDto.safeParse({ ...prior, actor_id: "caller" }).success).toBe(false);
});
it("source result must retain created=true, original Thread and null Run/Editor scopes", () => {
  for (const field of ["thread_scope", "run_scope", "editor_session_scope"]) {
    const prior = checkpoint(); const row = prior.accepted[0].row;
    const changed = launchPriorCheckpointDto.parse({ ...prior, accepted: [{ ...prior.accepted[0], row: { ...row, result: { ...row.result, [field]: "wrong" } } }] });
    expect(() => assertLaunchContinuation(options, cases, changed)).toThrow("null-scope");
  }
  const prior = checkpoint(); prior.accepted[0].row.result.data.source.created = false;
  expect(() => assertLaunchContinuation(options, cases, prior)).toThrow("null-scope");
});
