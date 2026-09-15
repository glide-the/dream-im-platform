// [Input] Strict primary-owned disposable target, OAuth/original grants and complete precommitted failed-Run facts.
// [Output] Production metadata POST/original GET, entire original recorder parity and protected17 full-state effects.
// [Pos] SELECT-only provider-free component verifier; primary owns fixtures/faults, no new Run-failure/Runtime claim.
// [Sync] 2026-09-15: validate registered77 independent envelope UOW after the prior authoritative Run COMMIT.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { z } from "zod";
import { POST } from "../../app/api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../app/api/internal/dream/v1/receipts/[requestId]/route";
import { decimalIdDto, requestIdDto } from "../../app/lib/auth/dto";
import { dreamLaunchFailureEnvelopeInputDto as inputDto, dreamLaunchFailureEnvelopeOutputDto as outputDto } from "../../app/lib/dream/dreamLaunchFailureDto";
import { dreamOperations } from "../../app/lib/dream/operationRegistry";
import { operationInputDigest } from "../../app/lib/dream/receipts";
import { projectWorkflowTimestamp } from "../../app/lib/dream/workflowRunService";
const name = "dream-launch-failure.envelope", text = z.string().min(1), code = z.string().regex(/^[A-Z0-9_]{1,100}$/);
const tokens = z.enum(["user", "other", "read_only", "matching_run", "wrong_run", "editor", "none"]);
const status = z.union([z.literal(200), z.literal(400), z.literal(401), z.literal(403), z.literal(404), z.literal(409), z.literal(503)]);
const caseDto = z.strictObject({ label: text, request_id: requestIdDto, token: tokens, input: z.json(), status, expected_code: code.nullable(),
  expected_result: outputDto.nullable(), scenario: z.enum(["updated", "missing_source", "denied"]), concurrent: z.boolean(), replay: z.boolean() });
const receiptDto = z.strictObject({ after_label: text, request_id: requestIdDto, token: tokens, query_tail: z.string(), status,
  expected_code: code.nullable(), state: z.enum(["absent", "committed"]).nullable(), source_label: text.nullable(),
  expected_result: outputDto.nullable(), historical_later_lease: z.boolean() });
const bearerFields = { user: text, other: text, read_only: text, matching_run: text, wrong_run: text, editor: text };
const canonicalFields = { user: decimalIdDto, other: decimalIdDto, read_only: decimalIdDto, matching_run: decimalIdDto, wrong_run: decimalIdDto, editor: decimalIdDto };
const fixtureDto = z.strictObject({ database: text, port: z.number().int().positive(), data_directory: text, target_verification_url: text,
  issuer: text, service_id: text, service_secret: text, auth_role: text, data_role: text, verification_role: text,
  source_root: text, oracle_python: text, source_oracle_secret: text, operation_contract_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  subjects: z.strictObject(bearerFields), canonical_ids: z.strictObject(canonicalFields), tokens: z.strictObject(bearerFields), cases: z.array(caseDto).min(1), receipts: z.array(receiptDto).min(1) });
type Case = z.output<typeof caseDto>;
const record = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
const path = process.env.INK_AUTH_DREAM_LAUNCH_FAILURE_FIXTURE;
assert(path, "Primary-prepared private isolated failure fixture required");
const mode = await stat(path);
assert(mode.isFile() && (mode.mode & 0o777) === 0o600 && mode.uid === process.getuid?.(), "Owned regular0600 fixture required");
let raw: unknown; try { raw = JSON.parse(await readFile(path, "utf8")); } catch { throw new Error("Invalid private fixture JSON"); }
const parsed = fixtureDto.safeParse(raw); assert(parsed.success, "Invalid strict private fixture"); const f = parsed.data;
assert(f.database.startsWith("ink_auth_data_codex_test_") && f.port !== 5433 && f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"), "Explicit disposable target required");
assert(dreamOperations.length === 77 && dreamOperations.find(item => item.contract.name === name)?.capability.contract_sha256 === f.operation_contract_sha256, "Exact registered77 contract required");
assert(new Set(f.cases.map(item => item.label)).size === f.cases.length && new Set(f.cases.map(item => item.request_id)).size === f.cases.length, "Distinct original cases required");
assert(f.cases.some(item => item.concurrent && item.status === 200) && f.cases.some(item => item.replay && item.status === 200), "Initial same-original concurrency and replay required");
for (const scenario of ["updated", "missing_source", "denied"]) assert(f.cases.some(item => item.scenario === scenario), "Every independent failure path required");
assert(f.cases.some(item => item.token === "matching_run" && item.status === 200), "Original Run persistence grant must complete metadata");
for (const token of ["read_only", "wrong_run", "editor", "none"] as const) assert(f.cases.some(item => item.token === token && item.status !== 200), "Read-only/wrong-Run/Editor/missing bearer failures required");
assert(f.cases.some(item => item.status === 400 && item.expected_code === "INPUT_INVALID"), "Strict body failure required");
assert(f.cases.some(item => item.status === 409 && item.expected_code === "OPERATION_REQUEST_CONFLICT"), "Independent original input digest conflict required");
for (const item of f.cases) {
  assert((item.status === 200) === (item.expected_result !== null) && (item.status === 200) === (item.scenario !== "denied"), "Independent complete expectations required");
  if (item.status !== 200) assert(!item.concurrent && !item.replay && item.expected_code !== null, "Denied cases cannot declare accepted writes");
  else { assert(item.token === "user" || item.token === "matching_run", "Only current owner success required"); assert(item.expected_result!.updated === (item.scenario === "updated"), "Expected metadata/no-op semantics required"); }
}
for (const item of f.receipts) {
  assert(f.cases.some(value => value.label === item.after_label), "Receipt checkpoint must execute");
  if (item.status === 200 && item.state === "committed") {
    assert(item.expected_result !== null, "Independent full original expectation required");
    if (item.historical_later_lease) assert(item.source_label === null && item.token === "user" && !f.cases.some(value => value.request_id === item.request_id), "Historical original is separate and cannot skip a current POST");
    else assert(item.source_label !== null && f.cases.some(value => value.label === item.source_label && value.request_id === item.request_id && value.status === 200), "Actual original complete result source required");
  } else assert(!item.historical_later_lease && item.expected_result === null, "Only committed recovery has independent completion");
}
assert(f.receipts.some(item => item.historical_later_lease), "Historical completion under a later current source lease requires real preexisting facts");
for (const token of ["read_only", "matching_run", "editor"] as const) assert(f.receipts.some(item => item.token === token && item.status === 403), "OAuth-only recovery permission failures required");
assert(f.receipts.some(item => item.token === "other" && item.status === 200 && item.state === "absent"), "Other actor receives absent only");
assert(f.receipts.some(item => item.status === 200 && item.state === "committed") && f.receipts.some(item => item.query_tail === "&unexpected=caller" && item.status === 404), "Full recovery and ordinary query rejection required");
assert(f.receipts.some(item => item.query_tail === "&actor_id=caller" && item.status === 400 && item.expected_code === "USER_OVERRIDE_FORBIDDEN"), "Shared identity override boundary required");
assert(f.receipts.some(item => item.status === 409 && item.expected_code === "OPERATION_REQUEST_CONFLICT"), "Original stored input/result conflict must fail closed");
function credential(value: string | undefined) {
  assert(value, "Explicit target credential required"); let url: URL; try { url = new URL(value); } catch { throw new Error("Invalid target credential"); }
  assert(["postgres:", "postgresql:"].includes(url.protocol) && url.username && url.password && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && Number(url.port) === f.port && decodeURIComponent(url.pathname.slice(1)) === f.database, "Same named disposable loopback target required"); return value;
}
const globals = globalThis as typeof globalThis & { __ink_auth_pool?: { end(): Promise<void> }; __ink_dream_data_pool?: { end(): Promise<void> } };
assert(!globals.__ink_auth_pool && !globals.__ink_dream_data_pool, "Harness must own new process pools");
const clients: Client[] = [], verification = new Client({ connectionString: credential(f.target_verification_url) }), origin = f.issuer.replace(/\/api\/auth$/, "");
let assertions = 0, executedCases = 0, executedReceipts = 0;
const equal = (left: unknown, right: unknown, message: string) => { assert(isDeepStrictEqual(left, right), message); assertions++; };
const check = (value: unknown, message: string) => { assert(value, message); assertions++; };
const outputs = new Map<string, z.output<typeof outputDto>>();
const tables = { threads: "public.chat_thread", messages: "public.chat_message", workspaces: "public.story_workspace_workspaces", decks: "public.decks", voices: "public.voices",
  runs: "public.workflow_runs", transitions: "public.workflow_run_transitions", consumptions: "public.workflow_run_token_consumptions", preflights: "public.workflow_preflights", preflight_requests: "dream.workflow_preflight_requests",
  sessions: "public.agent_sessions", bindings: "public.deck_plugin_bindings", releases: "public.deck_plugin_releases", snapshots: "public.deck_runtime_snapshots", locks: "public.deck_runtime_plugin_locks", receipts: "dream.operation_receipts", audits: "public.admin_audit_logs" } as const;
async function state() {
  const entries = await Promise.all(Object.entries(tables).map(async ([key, relation]) => [key, (await verification.query<{ value: string }>(`SELECT to_jsonb(r)::text AS value FROM ${relation} r ORDER BY to_jsonb(r)::text`)).rows.map(row => row.value)] as const));
  return Object.fromEntries(entries) as Record<keyof typeof tables, string[]>;
}
function headers(token: z.output<typeof tokens>, requestId: string) { return { authorization: `Bearer ${token === "none" ? "" : f.tokens[token]}`, "content-type": "application/json", "x-request-id": requestId, "x-ink-dream-service": f.service_id, "x-ink-dream-credential": f.service_secret }; }
async function runRow(runId: string) { return (await verification.query<Record<string, unknown>>("SELECT r.*,r.created_at::text AS created_at,r.started_at::text AS started_at,r.completed_at::text AS completed_at,r.source_message_time::text AS source_message_time FROM public.workflow_runs r WHERE r.id=$1", [runId])).rows[0] ?? null; }
async function sourceRow(messageId: string | null, threadId: string | null) {
  return (await verification.query<Record<string, unknown>>("SELECT m.*,m.created_at::text AS created_at,t.user_id::text AS user_id,t.deck_id,t.voice_id FROM public.chat_message m JOIN public.chat_thread t ON t.id=m.thread_id WHERE m.id=$1 AND m.thread_id=$2", [messageId, threadId])).rows[0] ?? null;
}
function original(run: Record<string, unknown>, source: Record<string, unknown> | null, command: z.output<typeof inputDto>, actor: string) {
  const initial = { workspace_id: run.workspace_id, source_voice_thread_id: run.source_voice_thread_id, source_message_id: run.source_message_id };
  const child = spawnSync(f.oracle_python, ["-B", fileURLToPath(new URL("./dreamLaunchFailureOracle.py", import.meta.url))], { encoding: "utf8", timeout: 15000,
    env: { PATH: process.env.PATH, INK_DREAM_SOURCE: f.source_root } as unknown as NodeJS.ProcessEnv,
    input: JSON.stringify({ rows: [initial, run, null, source === null ? null : { metadata: source.metadata }, ...(source === null ? [] : [null])], clock: projectWorkflowTimestamp(String(run.completed_at)), uuid: "11111111111111111111111111111111", secret: f.source_oracle_secret,
      arguments: { workflow_run_id: command.workflow_run_id, actor_id: actor, message_id: run.source_message_id, error_code: command.error_code } }) });
  check(!child.error && child.status === 0, "Actual entire recorder must finish without publishing stderr/body");
  let result: unknown; try { result = JSON.parse(child.stdout); } catch { throw new Error("Invalid original source result"); }
  return z.strictObject({ parameters: z.array(z.array(z.unknown())), events: z.array(z.string()), commits: z.number(), rollbacks: z.number(), closed: z.number() }).parse(result);
}
async function call(item: Case) {
  const response = await POST(new Request(`${origin}/api/internal/dream/v1/operations/${name}`, { method: "POST", headers: headers(item.token, item.request_id), body: JSON.stringify({ request_id: item.request_id, input: item.input }) }), { params: Promise.resolve({ operation: name }) });
  const body = record(await response.json()); equal(response.status, item.status, "Expected public failure status"); equal(body.request_id, item.request_id, "Original correlation required"); equal(response.headers.get("cache-control"), "no-store", "No cached metadata results");
  if (item.expected_code !== null) equal(record(body.error).code, item.expected_code, "Exact safe failure code required");
  if (item.status !== 200) return null;
  const output = outputDto.parse(body.data); equal(output, item.expected_result, "Every independently prepared result field required"); return output;
}
async function originals(afterLabel: string) {
  for (const item of f.receipts.filter(value => value.after_label === afterLabel)) {
    const before = await state();
    if (item.status === 200 && item.state === "committed") {
      const expected = outputDto.parse(item.expected_result), actor = f.canonical_ids[item.token as keyof typeof f.canonical_ids];
      const run = await runRow(expected.workflow_run_id); check(run, "Original completion retains a current Run"); assert(run);
      equal(run.created_by, actor, "Original Run current canonical owner required"); equal(run.status, "failed", "Historical failure completion retains failed Run");
      equal([run.source_voice_thread_id, run.source_message_id], [expected.thread_id, expected.message_id], "Original completion source tuple required");
      const workspace = (await verification.query<{ id: string }>("SELECT w.id FROM public.story_workspace_workspaces w JOIN public.workflow_runs r ON r.workspace_id=w.id WHERE r.id=$1 AND r.created_by=$2 AND w.owner_id=$2::bigint", [expected.workflow_run_id, actor])).rows[0];
      check(workspace, "Original current workspace owner required"); assert(workspace);
      const input = inputDto.parse({ workspace_id: workspace.id, workflow_run_id: expected.workflow_run_id, error_code: expected.error_code });
      const prior = (await verification.query<Record<string, unknown>>("SELECT input_sha256,result FROM dream.operation_receipts WHERE service_client_id=$1 AND actor=$2 AND operation=$3 AND request_id=$4", [f.service_id, f.subjects[item.token as keyof typeof f.subjects], name, item.request_id])).rows[0];
      check(prior, "Committed original must already exist"); assert(prior); const wrapper = record(prior.result);
      equal(wrapper.schema_version, 1, "Original stored version required"); equal(wrapper.data, expected, "Full independent original result required"); equal(prior.input_sha256, operationInputDigest(input), "Historical input reconstructed from original error/current owned workspace");
      equal([wrapper.thread_scope, wrapper.editor_session_scope, wrapper.run_scope], [expected.thread_id, null, expected.workflow_run_id], "Original full entity scopes required");
      const source = await sourceRow(expected.message_id, expected.thread_id);
      if (expected.updated) { check(source, "Previously updated source must still exist"); assert(source); equal(source.user_id, actor, "Historical source current owner required"); equal(source.role, "user", "Historical source original role required"); equal(projectWorkflowTimestamp(String(source.created_at)), projectWorkflowTimestamp(run.source_message_time as string), "Historical original source microseconds retained"); }
      if (item.historical_later_lease) {
        assert(source && expected.updated); const metadata = record(JSON.parse(String(source.metadata)));
        check(typeof metadata.dispatchClaimId === "string" && metadata.dispatchClaimId.length > 0 && typeof metadata.dispatchClaimedAt === "string", "Independent historical fixture must already retain a later lease");
      } else { check(item.source_label !== null && outputs.has(item.source_label), "Actual complete prior output required"); equal(expected, outputs.get(item.source_label!), "Independent expected completion matches actual POST"); }
    }
    const response = await GET(new Request(`${origin}/api/internal/dream/v1/receipts/${item.request_id}?operation=${name}${item.query_tail}`, { headers: headers(item.token, item.request_id) }), { params: Promise.resolve({ requestId: item.request_id }) });
    const body = record(await response.json()); equal(response.status, item.status, "Expected original metadata status"); equal(body.request_id, item.request_id, "Original GET correlation required"); equal(response.headers.get("cache-control"), "no-store", "Original GET cannot cache");
    if (item.expected_code !== null) equal(record(body.error).code, item.expected_code, "Exact safe recovery error required");
    if (item.status === 200) {
      const result = record(body.data); equal(result.status, item.state, "Explicit original evidence required"); equal(result.operation, name, "Original operation required"); equal(result.request_id, item.request_id, "Original request required");
      if (item.state === "committed") equal(result.result, item.expected_result, "Full immutable original completion/error required");
      else equal(result, { status: "absent", operation: name, request_id: item.request_id }, "Absent never exposes another actor's result");
    }
    equal(await state(), before, "Original GET cannot alter any protected row"); executedReceipts++;
  }
}
try {
  await verification.connect(); clients.push(verification);
  for (const [client, role] of [[verification, f.verification_role], [new Client({ connectionString: credential(process.env.AUTH_DATABASE_URL) }), f.auth_role], [new Client({ connectionString: credential(process.env.DREAM_DATA_DATABASE_URL) }), f.data_role]] as const) {
    if (client !== verification) { await client.connect(); clients.push(client); }
    equal((await client.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_user AS role")).rows[0], { name: f.database, port: f.port, role }, "Actual target/role/catalog required");
    if (client === verification) equal((await client.query("SELECT current_setting('data_directory') AS root")).rows[0].root, f.data_directory, "Owner verifies isolated data directory");
    else equal((await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0], { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }, "App roles stay least privilege");
  }
  let nullAgent = false, nonnullAgent = false;
  for (const item of f.cases) {
    const before = await state(), command = item.status === 200 ? inputDto.parse(item.input) : null, runBefore = command === null ? null : await runRow(command.workflow_run_id);
    if (command !== null) { assert(runBefore); equal(runBefore.status, "failed", "Authoritative Run must already have its prior FAILED commit"); equal(runBefore.created_by, f.canonical_ids[item.token as keyof typeof f.canonical_ids], "Canonical original owner required"); equal(runBefore.workspace_id, command.workspace_id, "Exact original workspace required"); }
    const sourceBefore = runBefore === null ? null : await sourceRow(runBefore.source_message_id as string | null, runBefore.source_voice_thread_id as string | null);
    const responses = item.concurrent ? await Promise.all([call(item), call(item), call(item)]) : [await call(item)], result = responses[0];
    for (const response of responses) equal(response, result, "Every simultaneous same-original result must match entirely");
    const after = await state();
    if (result === null) { equal(after, before, "Rejected metadata must leave all17 tables byte exact"); executedCases++; await originals(item.label); continue; }
    assert(command && runBefore); outputs.set(item.label, result);
    const current = await sourceRow(result.message_id, result.thread_id); equal(await runRow(command.workflow_run_id), runBefore, "Metadata UOW cannot change the already-committed Run");
    equal(result.thread_id, runBefore.source_voice_thread_id, "Original Run Thread required"); equal(result.message_id, runBefore.source_message_id, "Original Run message required"); equal(result.error_code, command.error_code, "Original input error retained");
    for (const key of Object.keys(tables) as (keyof typeof tables)[]) if (!["messages", "receipts", "audits"].includes(key)) equal(after[key], before[key], "Every other full relation remains unchanged");
    equal(after.messages.length, before.messages.length, "Failure cannot create or delete messages");
    const withoutSource = (rows: string[]) => rows.filter(value => record(JSON.parse(value)).id !== result.message_id);
    equal(withoutSource(after.messages), withoutSource(before.messages), "All non-target source rows remain byte exact");
    equal(after.receipts.length - before.receipts.length, 1, "One original receipt only"); equal(after.audits.length - before.audits.length, 1, "One original audit only");
    for (const key of ["receipts", "audits"] as const) check(before[key].every(value => after[key].includes(value)), "All historical receipts/audits retained");
    const actor = f.canonical_ids[item.token as keyof typeof f.canonical_ids], reference = original(runBefore, sourceBefore, command, actor);
    equal([reference.commits, reference.rollbacks, reference.closed], [1, 2, 1], "Original already-FAILED read rollback and separate envelope COMMIT required");
    equal(reference.parameters[0], [command.workflow_run_id, actor], "Entire original lookup owner/Run parameters required"); equal(reference.parameters[3], [result.message_id, result.thread_id], "Original scoped source parameters required");
    if (result.updated) {
      assert(current && sourceBefore); equal(sourceBefore.user_id, actor, "Current canonical source owner required"); equal(sourceBefore.role, "user", "Original backing user source required"); equal(projectWorkflowTimestamp(String(sourceBefore.created_at)), projectWorkflowTimestamp(runBefore.source_message_time as string), "Exact original source microseconds required");
      const { metadata: oldMetadata, ...oldFields } = sourceBefore, { metadata: newMetadata, ...newFields } = current; void oldMetadata;
      equal(newFields, oldFields, "Metadata update must preserve full source parts/time/provenance"); equal(reference.parameters[4], [newMetadata, result.message_id], "Whole original failed metadata UPDATE bytes required");
      nullAgent ||= sourceBefore.voice_id === null; nonnullAgent ||= sourceBefore.voice_id !== null;
    } else { equal(sourceBefore, null, "Missing-source path requires no original message"); equal(current, null, "No-op cannot repair/create a source"); equal(after.messages, before.messages, "Missing message preserves all message rows"); equal(reference.parameters.length, 4, "Actual missing message has no UPDATE"); }
    const stored = (await verification.query<Record<string, unknown>>("SELECT input_sha256,result FROM dream.operation_receipts WHERE service_client_id=$1 AND actor=$2 AND operation=$3 AND request_id=$4", [f.service_id, f.subjects[item.token as keyof typeof f.subjects], name, item.request_id])).rows[0];
    check(stored, "Original receipt persisted"); assert(stored); const wrapper = record(stored.result);
    equal(stored.input_sha256, operationInputDigest(command), "Original exact closed input digest required"); equal(wrapper.schema_version, 1, "Stored envelope version required"); equal(wrapper.data, result, "Full persisted completion required"); equal(wrapper.thread_scope, result.thread_id, "Original Thread scope required"); equal(wrapper.editor_session_scope, null, "No Editor scope"); equal(wrapper.run_scope, result.workflow_run_id, "Original failed Run scope required");
    equal((await verification.query<{ count: number }>("SELECT count(*)::int AS count FROM public.admin_audit_logs WHERE actor_id=$1 AND action=$2 AND request_id=$3", [f.service_id, `dream.${name}`, item.request_id])).rows[0].count, 1, "One correlated service audit required");
    if (item.replay) { const prior = await state(); equal(await call(item), result, "Original replay recovers every field"); equal(await state(), prior, "Replay cannot rewrite lease/config/history or duplicate receipt/audit"); }
    executedCases++; await originals(item.label);
  }
  check(nullAgent && nonnullAgent, "Original NULL/nonNULL Agent metadata paths required"); equal(executedCases, f.cases.length, "All original cases executed"); equal(executedReceipts, f.receipts.length, "All original GET checkpoints executed");
  process.stdout.write(JSON.stringify({ result: "PASS", scope: "provider-free independent failed envelope", cases: executedCases, receipts: executedReceipts, assertions, protected_tables: Object.keys(tables).length,
    actual_entire_failure_recorder_already_failed: true, prior_failed_run_preserved: true, initial_same_original_concurrency: true, new_failed_transition_runtime_provider_filesystem: "not executed" }) + "\n");
} finally { await Promise.allSettled(clients.map(client => client.end())); await globals.__ink_auth_pool?.end(); await globals.__ink_dream_data_pool?.end(); }
