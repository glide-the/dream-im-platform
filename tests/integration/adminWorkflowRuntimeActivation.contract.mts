// [Input] Primary-prepared named disposable PG, restricted DATA credential and strict activation facts.
// [Output] Actual DTO-Service-typed ORM activation, replay, conflict and late-fault rollback evidence.
// [Pos] Registry108 provider-free persistence contract; no Runtime, filesystem or normal database access.
// [Sync] 2026-09-15: prove the Story Runtime binding and operation receipt share one Admin UOW.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { Client } from "pg";
import { z } from "zod";
import { decimalIdDto, requestIdDto } from "../../app/lib/auth/dto";
import {
  workflowRuntimeActivationInputDto,
  workflowRuntimeActivationOutputDto,
  workflowRuntimeActivationPolicyDto,
} from "../../app/lib/dream/workflowRuntimeActivationDto";

const text = z.string().min(1);
const fixtureDto = z.strictObject({
  database: z.string().regex(/^ink_auth_data_codex_test_[a-z0-9_]+_runtime108_[a-z0-9]+$/),
  port: z.number().int().positive(),
  data_directory: text,
  data_database_url: text,
  target_verification_url: text,
  canonical_user_id: decimalIdDto,
  actor_subject: text,
  service_id: text,
  input: workflowRuntimeActivationInputDto,
  fault_input: workflowRuntimeActivationInputDto,
  policy: workflowRuntimeActivationPolicyDto,
});

const fixturePath = process.env.INK_AUTH_WORKFLOW_RUNTIME_ACTIVATION_FIXTURE;
assert(fixturePath, "Primary-prepared private Registry108 fixture required");
const metadata = await stat(fixturePath);
assert(metadata.isFile() && (metadata.mode & 0o777) === 0o600 && metadata.uid === process.getuid?.(), "Owned 0600 fixture required");
let raw: unknown;
try { raw = JSON.parse(await readFile(fixturePath, "utf8")); } catch { throw new Error("Invalid private Registry108 fixture JSON"); }
const parsed = fixtureDto.safeParse(raw);
assert(parsed.success, "Invalid strict Registry108 fixture");
const fixture = parsed.data;
assert(fixture.port !== 54329 && fixture.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"), "Named disposable cluster required");

function credential(value: string, expectedRole: "data" | "verification") {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${expectedRole} credential`); }
  assert(["postgres:", "postgresql:"].includes(url.protocol)
    && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    && url.username && url.password && Number(url.port) === fixture.port
    && decodeURIComponent(url.pathname.slice(1)) === fixture.database, `Explicit ${expectedRole} target required`);
  if (expectedRole === "data") assert(url.username.endsWith("_data"), "Restricted DATA role required");
  return value;
}

process.env.DREAM_DATA_DATABASE_URL = credential(fixture.data_database_url, "data");
process.env.DREAM_DATA_PGPOOL_MAX = "4";
process.env.DREAM_DOMAIN_CANONICAL_TIMEOUT_MS = "5000";
const verification = new Client({ connectionString: credential(fixture.target_verification_url, "verification") });
await verification.connect();
const target = (await verification.query("SELECT current_database() AS database,current_setting('port')::int AS port,current_setting('data_directory') AS data_directory")).rows[0];
assert.deepEqual(target, { database: fixture.database, port: fixture.port, data_directory: fixture.data_directory }, "Disposable target identity must match");

const { withDataTransaction } = await import("../../app/lib/dream/database");
const { workflowRuntimeActivationSchemaRequirements, runWorkflowRuntimeActivationOperation } = await import("../../app/lib/dream/workflowRuntimeActivationService");
const actor = {
  principal: { subject: fixture.actor_subject, canonical_user_id: fixture.canonical_user_id,
    client_id: fixture.service_id, scopes: ["dream:read", "dream:write"], status: "active" },
  threadScope: null,
  runScope: null,
};
const operation = "workflow-runtime.activate" as const;

async function activate(input: z.output<typeof workflowRuntimeActivationInputDto>, requestId: string) {
  requestIdDto.parse(requestId);
  return withDataTransaction(workflowRuntimeActivationSchemaRequirements,
    tx => runWorkflowRuntimeActivationOperation(operation, input, actor, fixture.service_id, requestId, tx, fixture.policy));
}

async function domainState(runId: string) {
  const result = await verification.query(`SELECT
    (SELECT to_jsonb(r) FROM public.workflow_runs r WHERE r.id=$1) AS run,
    (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.transition_seq),'[]'::jsonb) FROM public.workflow_run_transitions t WHERE t.workflow_run_id=$1) AS transitions,
    (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.agent_session_id),'[]'::jsonb) FROM public.agent_sessions s WHERE s.workflow_run_id=$1) AS sessions,
    (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.receipt_id),'[]'::jsonb) FROM public.runtime_load_receipts r WHERE r.workflow_run_id=$1) AS load_receipts,
    (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.receipt_id,e.claude_code_plugin_id),'[]'::jsonb)
       FROM public.runtime_load_receipt_entries e JOIN public.runtime_load_receipts r ON r.receipt_id=e.receipt_id WHERE r.workflow_run_id=$1) AS load_entries`, [runId]);
  return result.rows[0];
}

async function materializationState() {
  return (await verification.query(`SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.runtime_materialization_id),'[]'::jsonb) AS rows
    FROM public.runtime_plugin_materializations m
    WHERE m.runtime_environment_id=$1 AND m.runtime_node_id=$2 AND m.claude_code_plugin_id=$3 AND m.resolved_version=$4`,
  [fixture.policy.runtime_environment_id, fixture.policy.runtime_node_id, fixture.policy.required_plugin_id,
    fixture.policy.required_plugin_version])).rows[0].rows;
}

async function requestEffects(requestId: string) {
  return (await verification.query(`SELECT
    (SELECT count(*)::int FROM dream.operation_receipts WHERE service_client_id=$1 AND actor=$2 AND operation=$3 AND request_id=$4) AS receipts,
    (SELECT count(*)::int FROM public.admin_audit_logs WHERE actor_id=$1 AND action=$5 AND request_id=$4) AS audits`,
  [fixture.service_id, fixture.actor_subject, operation, requestId, `dream.${operation}`])).rows[0];
}

let assertions = 0;
const equal = (actual: unknown, expected: unknown, message: string) => {
  assert(isDeepStrictEqual(actual, expected), message);
  assertions++;
};
const check = (condition: unknown, message: string) => { assert(condition, message); assertions++; };
const firstRequest = "registry108-original";
const replayRequest = "registry108-active-replay";
const invalidRequest = "registry108-invalid-plugin";
const faultRequest = "registry108-late-fault";

try {
  const before = await domainState(fixture.input.workflow_run_id);
  check(before.run?.status === "queued" && before.run?.runtime_load_receipt_id === null && before.run?.agent_session_id === null,
    "Prepared original Run must be queued and unbound");
  const [left, right] = await Promise.all([activate(fixture.input, firstRequest), activate(fixture.input, firstRequest)]);
  equal(left, right, "Concurrent same-request calls must return the one committed DTO");
  const committed = workflowRuntimeActivationOutputDto.parse(left);
  check(committed.status === "running" && committed.replayed === false, "First committed result must identify a fresh activation");
  const after = await domainState(fixture.input.workflow_run_id);
  check(after.run?.status === "running" && after.run?.status_version === before.run.status_version + 1,
    "Run must advance once from queued to running");
  check(after.run?.runtime_load_receipt_id === committed.runtime_load_receipt_id
    && after.run?.agent_session_id === committed.agent_session_id, "Run must bind the returned receipt and Session");
  check(after.transitions.length === before.transitions.length + 1
    && after.transitions.at(-1)?.from_status === "queued" && after.transitions.at(-1)?.to_status === "running",
  "One queued-to-running transition must commit");
  check(after.sessions.length === 1 && after.sessions[0].status === "active"
    && after.sessions[0].remote_session_ref === fixture.input.remote_session_ref, "One active Session must bind the observed SDK Thread");
  check(after.load_receipts.length === 1 && after.load_entries.length === fixture.input.verified_plugins.length
    && after.load_receipts[0].required_entries_ready === 1, "One complete load receipt must commit");
  const materialized = await materializationState();
  check(materialized.length === fixture.input.verified_plugins.length
    && materialized.every((row: Record<string, unknown>) => row.activation_status === "loaded"), "Exact verified materializations must be loaded");
  equal(await requestEffects(firstRequest), { receipts: 1, audits: 1 }, "Concurrent original activation must commit one receipt and audit");

  equal(await activate(fixture.input, firstRequest), committed, "Same request replay must retain the original committed DTO");
  equal(await domainState(fixture.input.workflow_run_id), after, "Same request replay cannot change domain rows");
  await assert.rejects(() => activate({ ...fixture.input, remote_session_ref: `${fixture.input.remote_session_ref}-changed` }, firstRequest),
    (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "OPERATION_REQUEST_CONFLICT"));
  equal(await domainState(fixture.input.workflow_run_id), after, "Changed input under the same request must roll back");

  const activeReplay = await activate(fixture.input, replayRequest);
  check(activeReplay.replayed === true && activeReplay.agent_session_id === committed.agent_session_id
    && activeReplay.runtime_load_receipt_id === committed.runtime_load_receipt_id, "New request must revalidate and reuse the active binding");
  equal(await domainState(fixture.input.workflow_run_id), after, "Active replay cannot add lifecycle rows");
  equal(await requestEffects(replayRequest), { receipts: 1, audits: 1 }, "Active replay must have its own recoverable operation receipt");

  const extraInput = { ...fixture.input, verified_plugins: [...fixture.input.verified_plugins,
    { ...fixture.input.verified_plugins[0], package_spec: "extra@platform-builtin" }] };
  await assert.rejects(() => activate(extraInput, invalidRequest),
    (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "DREAM_RUNTIME_INIT_INVALID"));
  equal(await requestEffects(invalidRequest), { receipts: 0, audits: 0 }, "Invalid plugin evidence cannot commit operation effects");

  const faultBefore = await domainState(fixture.fault_input.workflow_run_id);
  const materializedBeforeFault = await materializationState();
  await assert.rejects(() => activate(fixture.fault_input, faultRequest));
  equal(await domainState(fixture.fault_input.workflow_run_id), faultBefore,
    "Late transition failure must roll back receipt, Session, Run and history");
  equal(await materializationState(), materializedBeforeFault, "Late failure must roll back materialization refresh");
  equal(await requestEffects(faultRequest), { receipts: 0, audits: 0 }, "Late failure cannot commit receipt or audit");

  console.log(JSON.stringify({ result: "PASS", operation, assertions, concurrent_original_calls: 2,
    active_replay: true, conflicting_input: true, late_fault_rollback: true,
    fixture: "provider-free-isolated-restricted-data-role", normal_database: "untouched" }));
} finally {
  await verification.end();
  const globals = globalThis as typeof globalThis & { __ink_dream_data_pool?: { end(): Promise<void> } };
  await globals.__ink_dream_data_pool?.end();
}
