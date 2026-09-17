// [Input] Explicit private launch continuation scope and one primary-frozen accepted checkpoint.
// [Output] Only the original source-new-null case may skip POST after full checkpoint validation.
// [Pos] Pure test-harness guards; no database, credentials, Runtime or production fallback.
// [Sync] 2026-09-15: preserve full38 scope and prevent arbitrary partial-case bypass.
import assert from "node:assert/strict";
import { z } from "zod";
import { requestIdDto } from "../../app/lib/auth/dto";
import { dreamLaunchSourceEnsureInputDto, dreamLaunchSourceEnsureOutputDto } from "../../app/lib/dream/dreamLaunchSourceDto";
export const launchValidationScopeDto = z.enum(["full", "remaining_after_source_new_null"]);
export const launchProtectedStatesDto = z.strictObject(Object.fromEntries([
  "threads", "messages", "workspaces", "decks", "voices", "runs", "transitions", "consumptions", "preflights", "preflight_requests", "sessions", "bindings", "releases", "snapshots", "locks", "receipts", "audits",
].map(name => [name, z.array(z.string())])));
const storedSourceDto = z.strictObject({ schema_version: z.literal(1), data: dreamLaunchSourceEnsureOutputDto,
  thread_scope: z.string().nullable(), editor_session_scope: z.string().nullable().optional(), run_scope: z.string().nullable().optional() });
export const launchPriorCheckpointDto = z.strictObject({ database: z.string().min(1), port: z.number().int().positive(), data_directory: z.string().min(1),
  states: launchProtectedStatesDto, accepted: z.array(z.strictObject({ label: z.literal("source-new-null"), operation: z.literal("dream-launch-source.ensure"), request_id: requestIdDto,
    row: z.strictObject({ result: storedSourceDto, input_sha256: z.string().regex(/^[0-9a-f]{64}$/), committed_at: z.string().min(1) }) })).length(1),
  source: z.record(z.string(), z.json()), thread: z.record(z.string(), z.json()) });
export type LaunchPriorCheckpoint = z.output<typeof launchPriorCheckpointDto>;
type ScopeOptions = { validation_scope: z.output<typeof launchValidationScopeDto>; prior_accepted_checkpoint?: string };
type PreparedCase = { label: string; operation: string; request_id: string; status?: number; token: string; scenario: string; thread_created: boolean; input?: unknown };
export function assertLaunchContinuation(options: ScopeOptions, cases: readonly PreparedCase[], checkpoint: LaunchPriorCheckpoint | null) {
  if (options.validation_scope === "full") {
    assert(options.prior_accepted_checkpoint === undefined && checkpoint === null, "Full acceptance cannot bypass POST with a checkpoint"); return null;
  }
  assert(options.prior_accepted_checkpoint === "/private/tmp/ink-auth-migration-validation/launch75-prior-accepted-state-private.json" && checkpoint !== null, "Exact primary-owned prior checkpoint required");
  assert(cases.length === 38, "All original38 prepared cases must remain in continuation");
  const accepted = checkpoint.accepted[0], matches = cases.filter(item => item.label === accepted.label);
  assert(matches.length === 1 && cases[0] === matches[0], "Only the first exact accepted original case may be resumed");
  const item = matches[0], parsed = dreamLaunchSourceEnsureInputDto.safeParse(item.input);
  assert(item.operation === accepted.operation && item.request_id === accepted.request_id && item.status === 200 && item.token === "user" &&
    item.scenario === "source_new" && item.thread_created && parsed.success && parsed.data.agent_id === null, "Only the original new NULL-Agent source/Thread may skip POST");
  const source = accepted.row.result.data.source;
  assert(source.created && accepted.row.result.thread_scope === source.thread_id && (accepted.row.result.editor_session_scope ?? null) === null &&
    (accepted.row.result.run_scope ?? null) === null, "Complete original source/null-scope evidence required");
  return accepted.label;
}
