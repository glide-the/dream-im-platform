// [Input] Strict original22/27 fixture and mandatory primary-owned partial287/Editor6/raw17 continuation evidence.
// [Output] Six full existing originals restored, all16 denied POSTs/all27 GETs with zero positive POST calls.
// [Pos] Independent disposable provider-free verifier; original failed harness and production77 stay frozen.
// [Sync] 2026-09-17: require delegated user OAuth plus a short-lived client_credentials service access token.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readFile, lstat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { z } from "zod";
import { POST } from "../../app/api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../app/api/internal/dream/v1/receipts/[requestId]/route";
import { dreamLaunchFailureEnvelopeInputDto as inputDto, dreamLaunchFailureEnvelopeOutputDto as outputDto } from "../../app/lib/dream/dreamLaunchFailureDto";
import { dreamOperations } from "../../app/lib/dream/operationRegistry";
import { operationInputDigest } from "../../app/lib/dream/receipts";
import { projectWorkflowTimestamp } from "../../app/lib/dream/workflowRunService";
import { assertDeniedFailurePost, assertFailureContinuation, assertFailureRowsRetained, failureContinuationEvidenceDto, failureContinuationFixtureDto, failureProtectedRelations, type FailureContinuationCase, type FailureProtectedRows } from "./adminDreamLaunchFailureContinuation";
const name = "dream-launch-failure.envelope";
let context: { label: string; status: number | null; code: string | null } = { label: "preflight", status: null, code: null };
function responseContext(status: number, body: Record<string, unknown>) {
  const error = body.error;
  const code = error !== null && typeof error === "object" && "code" in error ? error.code : null;
  context.status = status; context.code = typeof code === "string" && /^[A-Z0-9_]{1,100}$/.test(code) ? code : null;
}
const record = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
async function ownedJson(path: string | undefined) {
  assert(path, "Mandatory owned evidence/fixture path required"); const mode = await lstat(path);
  assert(mode.isFile() && !mode.isSymbolicLink() && (mode.mode & 0o777) === 0o600 && mode.uid === process.getuid?.(), "Owned regular0600 file required");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
async function main() {
const fixture = failureContinuationFixtureDto.safeParse(await ownedJson(process.env.INK_AUTH_DREAM_LAUNCH_FAILURE_FIXTURE));
const proof = failureContinuationEvidenceDto.safeParse(await ownedJson(process.env.INK_AUTH_DREAM_LAUNCH_FAILURE_CONTINUATION_EVIDENCE));
assert(fixture.success && proof.success, "Strict continuation fixture/evidence required");
const f = fixture.data, evidence = proof.data, { positive, denied } = assertFailureContinuation(f, evidence);
assert(f.database.startsWith("ink_auth_data_codex_test_") && f.port !== 5433 && f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"), "Explicit disposable target required");
assert(dreamOperations.length === 77 && dreamOperations.find(item => item.contract.name === name)?.capability.contract_sha256 === f.operation_contract_sha256, "Exact registered77 contract required");
const anchor = evidence.current_rows as FailureProtectedRows, prepublic = evidence.prepublic_rows as FailureProtectedRows;
function credential(value: string | undefined) {
  assert(value, "Explicit target credential required"); let url: URL; try { url = new URL(value); } catch { throw new Error("Invalid target credential"); }
  assert(["postgres:", "postgresql:"].includes(url.protocol) && url.username && url.password && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && Number(url.port) === f.port && decodeURIComponent(url.pathname.slice(1)) === f.database, "Same named disposable loopback target required"); return value;
}
const globals = globalThis as typeof globalThis & { __ink_auth_pool?: { end(): Promise<void> }; __ink_dream_data_pool?: { end(): Promise<void> } };
assert(!globals.__ink_auth_pool && !globals.__ink_dream_data_pool, "Harness must own new process pools");
const clients: Client[] = [], verification = new Client({ connectionString: credential(f.target_verification_url) }), origin = f.issuer.replace(/\/api\/auth$/, "");
let assertions = 0, recoveredOriginals = 0, deniedCases = 0, executedReceipts = 0;
let nullAgent = false, nonnullAgent = false;
const equal = (left: unknown, right: unknown, message: string) => { assert(isDeepStrictEqual(left, right), message); assertions++; };
const check = (value: unknown, message: string) => { assert(value, message); assertions++; };
const outputs = new Map<string, z.output<typeof outputDto>>();
async function state(): Promise<FailureProtectedRows> {
  const entries = await Promise.all(failureProtectedRelations.map(async relation => [relation, (await verification.query<{ value: string }>(`SELECT to_jsonb(r)::text AS value FROM ${relation} r ORDER BY to_jsonb(r)::text`)).rows.map(row => row.value)] as const));
  return Object.fromEntries(entries) as FailureProtectedRows;
}
function headers(token: z.output<typeof failureContinuationFixtureDto>["cases"][number]["token"], requestId: string) { return { authorization: `Bearer ${token === "none" ? "" : f.tokens[token]}`, "content-type": "application/json", "x-request-id": requestId, "x-ink-dream-service-authorization": `Bearer ${f.service_access_token}` }; }
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
async function callDenied(item: FailureContinuationCase) {
  assertDeniedFailurePost(item);
  context = { label: item.label, status: null, code: null };
  const response = await POST(new Request(`${origin}/api/internal/dream/v1/operations/${name}`, { method: "POST", headers: headers(item.token, item.request_id), body: JSON.stringify({ request_id: item.request_id, input: item.input }) }), { params: Promise.resolve({ operation: name }) });
  const body = record(await response.json()); responseContext(response.status, body); equal(response.status, item.status, "Expected public failure status"); equal(body.request_id, item.request_id, "Original correlation required"); equal(response.headers.get("cache-control"), "no-store", "No cached metadata results");
  if (item.expected_code !== null) equal(record(body.error).code, item.expected_code, "Exact safe failure code required");
  check(response.status !== 200, "Denied POST cannot succeed");
}
async function originalGet(item: z.output<typeof failureContinuationFixtureDto>["receipts"][number]) {
    context = { label: item.after_label, status: null, code: null };
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
      } else { check(item.source_label !== null && outputs.has(item.source_label), "Recovered complete prior output required"); equal(expected, outputs.get(item.source_label!), "Independent expected completion matches restored original"); }
    }
    const response = await GET(new Request(`${origin}/api/internal/dream/v1/receipts/${item.request_id}?operation=${name}${item.query_tail}`, { headers: headers(item.token, item.request_id) }), { params: Promise.resolve({ requestId: item.request_id }) });
    const body = record(await response.json()); responseContext(response.status, body); equal(response.status, item.status, "Expected original metadata status"); equal(body.request_id, item.request_id, "Original GET correlation required"); equal(response.headers.get("cache-control"), "no-store", "Original GET cannot cache");
    if (item.expected_code !== null) equal(record(body.error).code, item.expected_code, "Exact safe recovery error required");
    if (item.status === 200) {
      const result = record(body.data); equal(result.status, item.state, "Explicit original evidence required"); equal(result.operation, name, "Original operation required"); equal(result.request_id, item.request_id, "Original request required");
      if (item.state === "committed") equal(result.result, item.expected_result, "Full immutable original completion/error required");
      else equal(result, { status: "absent", operation: name, request_id: item.request_id }, "Absent never exposes another actor's result");
    }
    equal(await state(), before, "Original GET cannot alter any protected row"); equal(await state(), anchor, "Original GET retains current17 anchor"); executedReceipts++;
}
async function recover(item: FailureContinuationCase) {
  context = { label: item.label, status: null, code: null };
  const command = inputDto.parse(item.input), expected = outputDto.parse(item.expected_result), actor = f.canonical_ids[item.token as keyof typeof f.canonical_ids];
  const run = await runRow(command.workflow_run_id); check(run, "Existing original Run required"); assert(run);
  equal([run.created_by, run.status, run.workspace_id], [actor, "failed", command.workspace_id], "Current original failed Run/owner/workspace required");
  equal([run.source_voice_thread_id, run.source_message_id], [expected.thread_id, expected.message_id], "Original full source tuple required");
  equal([expected.workflow_run_id, expected.error_code], [command.workflow_run_id, command.error_code], "Original Run/error completion required");
  const workspace = (await verification.query("SELECT id FROM public.story_workspace_workspaces WHERE id=$1 AND owner_id=$2::bigint", [command.workspace_id, actor])).rows[0];
  check(workspace, "Current original workspace ownership required");
  const current = await sourceRow(expected.message_id, expected.thread_id);
  const priorRows = prepublic["public.chat_message"].map(value => record(JSON.parse(value))).filter(value => value.id === expected.message_id);
  if (expected.updated) check(priorRows.length === 1 && current !== null, "Actual prepublic/current original source required");
  else check(priorRows.length === 0 && current === null, "Missing source original remains a no-op");
  const originalSource = current === null ? null : { ...current, metadata: priorRows[0].metadata };
  const reference = original(run, originalSource, command, actor);
  equal([reference.commits, reference.rollbacks, reference.closed], [1, 2, 1], "Whole already-failed source read rollback/separate metadata COMMIT required");
  equal(reference.parameters[0], [command.workflow_run_id, actor], "Whole original scoped Run lookup required");
  equal(reference.parameters[3], [expected.message_id, expected.thread_id], "Whole original source tuple lookup required");
  if (expected.updated) {
    assert(current && originalSource); equal(current.user_id, actor, "Current source canonical owner required"); equal(current.role, "user", "Original source user role required");
    equal(projectWorkflowTimestamp(String(current.created_at)), projectWorkflowTimestamp(String(run.source_message_time)), "Full source microseconds retained");
    equal(reference.parameters[4], [current.metadata, expected.message_id], "Full original metadata UPDATE raw bytes required");
    nullAgent ||= current.voice_id === null; nonnullAgent ||= current.voice_id !== null;
  } else equal(reference.parameters.length, 4, "Missing source invokes no UPDATE");
  const stored = (await verification.query<Record<string, unknown>>("SELECT input_sha256,result FROM dream.operation_receipts WHERE service_client_id=$1 AND actor=$2 AND operation=$3 AND request_id=$4", [f.service_id, f.subjects[item.token as keyof typeof f.subjects], name, item.request_id])).rows[0];
  check(stored, "Existing complete original receipt required"); assert(stored);
  const wrapper = record(stored.result); equal(wrapper.schema_version, 1, "Original stored version required");
  const result = outputDto.parse(wrapper.data); equal(result, expected, "Every independently prepared original result field required");
  equal(stored.input_sha256, operationInputDigest(command), "Original closed input digest required");
  equal([wrapper.thread_scope, wrapper.editor_session_scope, wrapper.run_scope], [result.thread_id, null, result.workflow_run_id], "Original full entity scopes required");
  equal((await verification.query<{ count: number }>("SELECT count(*)::int AS count FROM public.admin_audit_logs WHERE actor_id=$1 AND action=$2 AND request_id=$3", [f.service_id, `dream.${name}`, item.request_id])).rows[0].count, 1, "Exactly one correlated original service audit required");
  outputs.set(item.label, result); recoveredOriginals++;
  equal(await state(), anchor, "Six original restorations remain entirely read only");
}
try {
  await verification.connect(); clients.push(verification);
  for (const [client, role] of [[verification, f.verification_role], [new Client({ connectionString: credential(process.env.AUTH_DATABASE_URL) }), f.auth_role], [new Client({ connectionString: credential(process.env.DREAM_DATA_DATABASE_URL) }), f.data_role]] as const) {
    if (client !== verification) { await client.connect(); clients.push(client); }
    equal((await client.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_user AS role")).rows[0], { name: f.database, port: f.port, role }, "Actual target/role/catalog required");
    if (client === verification) equal((await client.query("SELECT current_setting('data_directory') AS root")).rows[0].root, f.data_directory, "Owner verifies isolated data directory");
    else equal((await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0], { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }, "App roles stay least privilege");
  }
  equal(await state(), anchor, "Actual current17 must match primary post-seed full-row anchor");
  const updatedIds = new Set(positive.filter(item => item.expected_result?.updated).map(item => item.expected_result!.message_id).filter((value): value is string => value !== null));
  assertFailureRowsRetained(prepublic, anchor, updatedIds); assertions++;
  for (const item of positive) await recover(item);
  check(nullAgent && nonnullAgent, "Original NULL/nonNULL Agent sources restored");
  for (const item of denied) { equal(await state(), anchor, "Denied POST starts at current17 anchor"); await callDenied(item); equal(await state(), anchor, "Denied POST preserves every current17 full row"); deniedCases++; }
  for (const item of f.receipts) await originalGet(item);
  equal([recoveredOriginals, deniedCases, executedReceipts], [6, 16, 27], "Every accepted original/negative/GET counted independently");
  process.stdout.write(JSON.stringify({ result: "PASS", scope: "provider-free independent failure77 continuation", recovered_originals: recoveredOriginals, denied_cases: deniedCases,
    original_gets: executedReceipts, positive_post_calls: 0, assertions, protected_tables: failureProtectedRelations.length, first_public_exit: 1,
    partial_assertions: evidence.partial_assertions, editor_probe_assertions: evidence.editor_probe.assertions,
    actual_entire_failure_recorder_already_failed: true, prior_failed_run_preserved: true, new_failed_transition_runtime_provider_filesystem: "not executed" }) + "\n");
} finally { await Promise.allSettled(clients.map(client => client.end())); await globals.__ink_auth_pool?.end(); await globals.__ink_dream_data_pool?.end(); }
}
try { await main(); } catch { process.stderr.write(JSON.stringify({ result: "FAIL", label: context.label, status: context.status, code: context.code }) + "\n"); process.exitCode = 1; }
