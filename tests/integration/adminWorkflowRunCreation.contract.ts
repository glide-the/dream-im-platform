// [Input] Primary-prepared named disposable PG, live restricted OAuth and independent original creation facts.
// [Output] Public create/retry/receipt, full actual-source parameters and atomic replay/failure evidence.
// [Pos] Provider-free contract harness; verification only SELECTs, primary owns every seed and fault.
// [Sync] 2026-09-15: preserve full original creation acceptance and explicit remaining denied/receipt scope.
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
import { workflowRunDto, workflowRunReadOutputDto } from "../../app/lib/dream/workflowRunDto";
import { workflowRunCreateInputDto, workflowRunRetryInputDto } from "../../app/lib/dream/workflowRunCreationDto";
import { projectWorkflowTimestamp } from "../../app/lib/dream/workflowRunService";
import { operationInputDigest } from "../../app/lib/dream/receipts";
import { WorkflowTokenAuthority } from "../../app/lib/dream/workflowTokenAuthority";

const text = z.string().min(1), nameDto = z.enum(["workflow-run.create", "workflow-run.retry"]);
const tokenDto = z.enum(["user", "other", "read_only", "thread", "none"]);
const statusDto = z.union([z.literal(200), z.literal(400), z.literal(401), z.literal(403), z.literal(404), z.literal(409), z.literal(503)]);
const staticRun = z.strictObject({ ...workflowRunDto.shape }).omit({ workflow_run_id: true, created_at: true });
const caseDto = z.strictObject({ label: text, operation: nameDto, request_id: requestIdDto, token: tokenDto, input: z.json(), status: statusDto,
  expected_code: z.string().regex(/^[A-Z0-9_]{1,100}$/).nullable(), expected: staticRun.nullable(),
  expected_run_id: z.string().regex(/^run_[0-9a-f]{32}$/).nullable(), scenario: z.enum(["fresh", "fresh_semantic", "consumed", "denied"]),
  new_run: z.boolean(), new_consumption: z.boolean(), replay: z.boolean(), concurrent: z.boolean() });
const receiptCaseDto = z.strictObject({ operation: nameDto, request_id: requestIdDto, token: tokenDto, status: statusDto,
  state: z.enum(["absent", "committed"]).nullable(), source_label: text.nullable() });
const fixtureDto = z.strictObject({ database: text, port: z.number().int().positive(), data_directory: text, target_verification_url: text,
  issuer: text, service_id: text, service_secret: text, user_subject: text, canonical_user_id: decimalIdDto,
  source_root: text, oracle_python: text, auth_role: text, data_role: text, verification_role: text,
  tokens: z.strictObject({ user: text, other: text, read_only: text, thread: text }), cases: z.array(caseDto).min(1), receipts: z.array(receiptCaseDto).min(1),
  validation_scope: z.enum(["full", "remaining_denied_receipts"]).default("full"),
  accepted_originals: z.array(z.strictObject({ source_label: text, result: workflowRunReadOutputDto })).optional() });
const fixturePath = process.env.INK_AUTH_WORKFLOW_RUN_CREATION_FIXTURE;
assert(fixturePath, "Primary-prepared private isolated fixture required");
const mode = await stat(fixturePath); assert(mode.isFile() && (mode.mode & 0o777) === 0o600 && mode.uid === process.getuid?.(), "Private owned fixture file required");
let raw: unknown; try { raw = JSON.parse(await readFile(fixturePath, "utf8")); } catch { throw new Error("Invalid private fixture JSON"); }
const parsed = fixtureDto.safeParse(raw); assert(parsed.success, "Invalid strict private fixture"); const f = parsed.data;
const remaining = f.validation_scope === "remaining_denied_receipts";
if (remaining) {
  assert(new Set(f.cases.map(item => item.label)).size === f.cases.length, "Skipped original labels must be unambiguous");
  assert(f.accepted_originals && new Set(f.accepted_originals.map(item => item.source_label)).size === f.accepted_originals.length, "Distinct complete original accepted results required");
  assert(f.accepted_originals.length === f.cases.filter(item => item.status === 200).length &&
    f.cases.filter(item => item.status === 200).every(item => f.accepted_originals!.some(original => original.source_label === item.label)), "Every skipped original accepted case must retain its prepared complete result");
} else assert(f.accepted_originals === undefined, "Full scope cannot bypass original creation acceptance");
assert(f.database.startsWith("ink_auth_data_codex_test_") && f.port !== 5433 && f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"), "Explicit disposable target required");
assert(new Set(f.cases.map(item => `${item.operation}/${item.request_id}`)).size === f.cases.length, "Original cases must be distinct");
for (const operation of nameDto.options) assert(f.cases.some(item => item.operation === operation && item.status === 200), "Both operations need success cases");
for (const operation of nameDto.options) {
  assert(f.receipts.some(item => item.operation === operation && item.token === "user" && item.status === 200 && item.state === "committed" && item.source_label !== null), "Both operations require bounded public receipt recovery");
  assert(f.receipts.some(item => item.operation === operation && item.token === "other" && item.status === 200 && item.state === "absent"), "Other actor must have explicit absent evidence");
  for (const token of ["read_only", "thread"] as const) assert(f.receipts.some(item => item.operation === operation && item.token === token && item.status === 403), "Read-only and entity grants cannot obtain original creation results");
}
for (const scenario of ["fresh", "fresh_semantic", "consumed", "denied"]) assert(f.cases.some(item => item.scenario === scenario), "Every original token path and failure must be prepared");
assert(f.cases.some(item => item.concurrent) && f.cases.some(item => item.replay), "Concurrent/original replay coverage required");
assert(f.cases.some(item => item.status === 200 && item.operation === "workflow-run.create" && workflowRunCreateInputDto.parse(item.input).source_message_id !== null), "Complete real owned source tuple case required");
assert(f.cases.some(item => item.status === 200 && Array.from(String((item.input as Record<string, unknown>).idempotency_key)).length !== String((item.input as Record<string, unknown>).idempotency_key).length), "Unicode key codepoint case required");
for (const item of f.cases) {
  assert((item.status === 200) === (item.expected !== null) && (item.status === 200) === (item.scenario !== "denied"), "Independent success/failure expectations required");
  if (item.status !== 200) assert(!item.new_run && !item.new_consumption && !item.concurrent && !item.replay, "Rejected cases cannot declare effects or replay");
  else {
    assert(item.token === "user" && (item.scenario === "fresh") === item.new_run && (item.scenario !== "consumed") === item.new_consumption, "Success effects must match the original token path");
    assert(item.new_run ? item.expected_run_id === null && item.expected?.status === "queued" && item.expected.status_version === 2 : item.expected_run_id !== null, "New ID is server-owned; semantic recovery requires the prepared original ID");
  }
}
function credential(value: string | undefined) {
  assert(value, "Explicit target credential required"); let url: URL; try { url = new URL(value); } catch { throw new Error("Invalid target credential"); }
  assert(["postgres:", "postgresql:"].includes(url.protocol) && url.username && url.password && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    Number(url.port) === f.port && decodeURIComponent(url.pathname.slice(1)) === f.database, "Every credential must name the same disposable loopback target"); return value;
}
const globals = globalThis as typeof globalThis & { __ink_auth_pool?: { end(): Promise<void> }; __ink_dream_data_pool?: { end(): Promise<void> } };
assert(!globals.__ink_auth_pool && !globals.__ink_dream_data_pool, "Harness must own newly created process pools");
const clients: Client[] = [], verification = new Client({ connectionString: credential(f.target_verification_url) });
const secret = process.env.INK_WORKFLOW_TOKEN_SECRET; assert(secret && Buffer.byteLength(secret, "utf8") >= 32, "Explicit original token authority required");
let assertions = 0, executedCases = 0, skippedAcceptedCases = 0;
const equal = (left: unknown, right: unknown, message: string) => { assert(isDeepStrictEqual(left, right), message); assertions++; };
const check = (value: unknown, message: string) => { assert(value, message); assertions++; };
const outputs = new Map<string, z.output<typeof workflowRunReadOutputDto>>();
const origin = f.issuer.replace(/\/api\/auth$/, "");
function headers(token: z.output<typeof tokenDto>, requestId: string) { return { authorization: `Bearer ${token === "none" ? "" : f.tokens[token]}`, "content-type": "application/json",
  "x-request-id": requestId, "x-ink-dream-service": f.service_id, "x-ink-dream-credential": f.service_secret }; }
async function state() {
  return (await verification.query("SELECT (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]'::jsonb)::text FROM public.workflow_runs r) AS runs,(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY workflow_run_id,transition_seq),'[]'::jsonb)::text FROM public.workflow_run_transitions t) AS transitions,(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY token_digest),'[]'::jsonb)::text FROM public.workflow_run_token_consumptions c) AS consumption,(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY workflow_preflight_id),'[]'::jsonb)::text FROM public.workflow_preflights p) AS preflights,(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY service_client_id,actor,operation,request_id),'[]'::jsonb)::text FROM dream.operation_receipts r) AS receipts,(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]'::jsonb)::text FROM public.admin_audit_logs a) AS audits,(SELECT count(*)::int FROM public.workflow_runs) AS run_count,(SELECT count(*)::int FROM public.workflow_run_transitions) AS transition_count,(SELECT count(*)::int FROM public.workflow_run_token_consumptions) AS consumption_count,(SELECT count(*)::int FROM public.agent_sessions) AS sessions")).rows[0];
}
async function runRow(runId: string) {
  return (await verification.query("SELECT r.*,r.created_by::text AS created_by,r.created_at::text AS created_at,r.started_at::text AS started_at,r.completed_at::text AS completed_at,r.source_message_time::text AS source_message_time FROM public.workflow_runs r WHERE r.id=$1", [runId])).rows[0] ?? null;
}
async function protectedState() {
  return (await verification.query("SELECT jsonb_build_object('threads',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.chat_thread t),'messages',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY id),'[]'::jsonb) FROM public.chat_message m),'workspaces',(SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY id),'[]'::jsonb) FROM public.story_workspace_workspaces w),'sessions',(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY agent_session_id),'[]'::jsonb) FROM public.agent_sessions s))::text AS value")).rows[0].value;
}
async function requestCounts(item: z.output<typeof caseDto>) {
  return (await verification.query("SELECT (SELECT count(*)::int FROM dream.operation_receipts WHERE service_client_id=$1 AND actor=$2 AND operation=$3 AND request_id=$4) AS receipts,(SELECT count(*)::int FROM public.admin_audit_logs WHERE actor_id=$1 AND action=$5 AND request_id=$4) AS audits", [f.service_id, f.user_subject, item.operation, item.request_id, `dream.${item.operation}`])).rows[0];
}
async function call(item: z.output<typeof caseDto>, input: unknown = item.input, status: number = item.status) {
  const response = await POST(new Request(`${origin}/api/internal/dream/v1/operations/${item.operation}`, { method: "POST", headers: headers(item.token, item.request_id),
    body: JSON.stringify({ request_id: item.request_id, input }) }), { params: Promise.resolve({ operation: item.operation }) });
  const body = await response.json(), code = typeof body.error?.code === "string" && /^[A-Z0-9_]{1,100}$/.test(body.error.code) ? body.error.code : "NO_PUBLIC_ERROR_CODE";
  equal(response.status, status, `Unexpected public status (${code})`); equal(body.request_id, item.request_id, "Original request correlation required"); equal(response.headers.get("cache-control"), "no-store", "No secret result may be cached");
  if (status === item.status && item.expected_code !== null) equal(code, item.expected_code, "Original safe error code required");
  if (status !== 200) return null;
  const output = workflowRunReadOutputDto.safeParse(body.data); check(output.success, "Strict complete original Run projection required"); assert(output.success);
  const { workflow_run_id: ignoredId, created_at: ignoredTime, ...fields } = output.data.run; void ignoredId; void ignoredTime;
  equal(staticRun.parse(fields), item.expected, "Every independently prepared original static Run field must match");
  if (item.expected_run_id !== null) equal(output.data.run.workflow_run_id, item.expected_run_id, "Semantic/token replay must preserve the original Run ID");
  const prior = outputs.get(item.label); if (prior) equal(output.data, prior, "Concurrent/original replay returns the same bounded Run/time"); else outputs.set(item.label, output.data);
  return output.data;
}
function oracle(input: unknown) {
  const child = spawnSync(f.oracle_python, ["-B", fileURLToPath(new URL("./workflowRunCreationOracle.py", import.meta.url))],
    { env: { PATH: process.env.PATH, INK_DREAM_SOURCE: f.source_root } as unknown as NodeJS.ProcessEnv, input: JSON.stringify(input), encoding: "utf8", timeout: 15000 });
  check(!child.error && child.status === 0, "Actual original source harness must finish without publishing private stderr/body");
  try { return JSON.parse(child.stdout); } catch { throw new Error("Invalid actual source response"); }
}
async function originalFacts(item: z.output<typeof caseDto>) {
  const input = item.operation === "workflow-run.create" ? workflowRunCreateInputDto.parse(item.input) : workflowRunRetryInputDto.parse(item.input);
  const context = (await verification.query("SELECT p.*,p.created_by::text AS created_by,p.created_at::text AS created_at,p.updated_at::text AS updated_at,p.expires_at::text AS expires_at,p.consumed_at::text AS consumed_at,b.deck_plugin_binding_id,b.workspace_id AS binding_workspace_id,b.creator_id AS binding_creator_id,r.manifest_hash,r.workflow_definition_ref,l.deck_plugin_manifest_hash AS lock_manifest_hash,l.lock_json FROM public.workflow_preflights p JOIN public.deck_plugin_bindings b ON b.deck_id=p.deck_id AND b.binding_revision=p.binding_revision AND b.deck_plugin_id=p.deck_plugin_id AND b.deck_plugin_version=p.deck_plugin_version JOIN public.deck_plugin_releases r ON r.deck_plugin_id=p.deck_plugin_id AND r.deck_plugin_version=p.deck_plugin_version JOIN public.deck_runtime_plugin_locks l ON l.id=p.runtime_plugin_lock_id AND l.deck_plugin_id=p.deck_plugin_id AND l.deck_plugin_version=p.deck_plugin_version WHERE p.workflow_preflight_id=$1", [input.workflow_preflight_id])).rows[0];
  check(context, "Primary must prepare the exact original joined context");
  const existing = (await verification.query("SELECT id FROM public.workflow_runs WHERE created_by=$1 AND workspace_id=$2 AND idempotency_key=$3", [f.canonical_user_id, input.workspace_id, input.idempotency_key])).rows[0];
  const old = existing ? await runRow(existing.id) : null;
  const digest = new WorkflowTokenAuthority(Buffer.from(secret!)).consumptionDigest(input.preflight_token);
  const consumption = (await verification.query("SELECT c.*,c.actor_id::text AS actor_id FROM public.workflow_run_token_consumptions c WHERE token_digest=$1", [digest])).rows[0] ?? null;
  let source, retryOf: string | null = null, expectedRetrySource: unknown = null;
  if (item.operation === "workflow-run.retry") {
    const retry = workflowRunRetryInputDto.parse(input), parent = await runRow(retry.workflow_run_id); check(parent, "Original owned retry source must be prepared");
    retryOf = retry.workflow_run_id; source = { source_voice_thread_id: parent.source_voice_thread_id, source_message_id: parent.source_message_id, source_message_time: projectWorkflowTimestamp(parent.source_message_time) };
    expectedRetrySource = oracle({ action: "retry-frozen", row: parent, secret });
  } else { const create = workflowRunCreateInputDto.parse(input); source = { source_voice_thread_id: create.source_voice_thread_id, source_message_id: create.source_message_id, source_message_time: create.source_message_time }; }
  return { input, context, old, consumption, digest, source, retryOf, expectedRetrySource };
}
try {
  await verification.connect(); clients.push(verification);
  for (const [client, role] of [[verification, f.verification_role], [new Client({ connectionString: credential(process.env.AUTH_DATABASE_URL) }), f.auth_role],
    [new Client({ connectionString: credential(process.env.DREAM_DATA_DATABASE_URL) }), f.data_role]] as const) {
    if (client !== verification) { await client.connect(); clients.push(client); }
    const target = (await client.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_user AS role")).rows[0];
    equal(target, { name: f.database, port: f.port, role }, "Actual credential role/catalog must match the named isolated target");
    if (client === verification) equal((await client.query("SELECT current_setting('data_directory') AS root")).rows[0].root, f.data_directory, "Owner verifier proves the exact disposable instance directory");
    if (client !== verification) {
      const permissions = (await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
      equal(permissions, { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }, "Actual app role must be restricted");
    }
  }
  for (const item of f.cases) {
    if (remaining && item.status === 200) {
      const original = f.accepted_originals!.find(value => value.source_label === item.label); assert(original);
      const { workflow_run_id: originalId, created_at: originalTime, ...fields } = original.result.run;
      equal(staticRun.parse(fields), item.expected, "Skipped accepted case preserves every independently prepared original static field");
      if (item.expected_run_id !== null) equal(originalId, item.expected_run_id, "Skipped semantic/token case preserves its original prepared Run ID");
      const input = item.operation === "workflow-run.create" ? workflowRunCreateInputDto.parse(item.input) : workflowRunRetryInputDto.parse(item.input);
      const stored = (await verification.query("SELECT input_sha256,result FROM dream.operation_receipts WHERE service_client_id=$1 AND actor=$2 AND operation=$3 AND request_id=$4", [f.service_id, f.user_subject, item.operation, item.request_id])).rows[0];
      check(stored, "Skipped accepted case requires its already committed original receipt");
      equal(stored.input_sha256, operationInputDigest(input), "Skipped original input identity is unchanged");
      equal(workflowRunReadOutputDto.parse(stored.result.data), original.result, "Skipped complete original result remains independently bounded");
      equal([stored.result.run_scope, stored.result.thread_scope, stored.result.editor_session_scope ?? null], [originalId, original.result.run.source_voice_thread_id, null], "Skipped original receipt retains exact entity scopes");
      const storedRun = await runRow(originalId); check(storedRun, "Skipped original Run remains visible in the isolated target");
      equal(projectWorkflowTimestamp(storedRun.created_at), originalTime, "Skipped original Run creation time remains exact");
      equal([storedRun.created_by, storedRun.workspace_id], [f.canonical_user_id, input.workspace_id], "Skipped original actor/workspace remain unchanged");
      outputs.set(item.label, original.result); skippedAcceptedCases++; continue;
    }
    executedCases++;
    const before = await state(), protectedBefore = await protectedState(), facts = item.status === 200 ? await originalFacts(item) : null;
    if (item.concurrent) await Promise.all([call(item), call(item)]); else await call(item);
    const after = await state();
    equal(await protectedState(), protectedBefore, "Creation/retry leaves source Chat, workspace and all Agent Session facts unchanged");
    if (item.status !== 200) { equal(after, before, "Rejected creation/retry preserves all original Run/PF/token/history/receipt/audit state"); continue; }
    assert(facts); const output = outputs.get(item.label); assert(output); const rawRun = await runRow(output.run.workflow_run_id); check(rawRun, "Actual created/recovered Run required");
    equal(output.run.created_at, projectWorkflowTimestamp(rawRun.created_at), "Run creation time must preserve exact PostgreSQL microseconds");
    equal(after.run_count, before.run_count + Number(item.new_run), "Only fresh creation adds one Run"); equal(after.transition_count, before.transition_count + (item.new_run ? 2 : 0), "Only fresh creation appends the two original transitions");
    equal(after.consumption_count, before.consumption_count + Number(item.new_consumption), "Token is consumed once or original mapping recovered"); equal(after.sessions, before.sessions, "Creation never starts an Agent Session");
    equal(await requestCounts(item), { receipts: 1, audits: 1 }, "Business/result/audit commit exactly once");
    const pf = (await verification.query("SELECT consumed_at::text AS consumed_at,updated_at::text AS updated_at FROM public.workflow_preflights WHERE workflow_preflight_id=$1", [facts.input.workflow_preflight_id])).rows[0];
    const history = (await verification.query("SELECT t.*,t.actor_id::text AS actor_id,t.occurred_at::text AS occurred_at FROM public.workflow_run_transitions t WHERE workflow_run_id=$1 ORDER BY transition_seq", [rawRun.id])).rows;
    const rows = item.scenario === "fresh" ? [null, facts.context, null, null, null, null, null, null, null, null, rawRun]
      : item.scenario === "fresh_semantic" ? [null, facts.context, null, facts.old, null, null] : [null, facts.context, facts.consumption, facts.old];
    const clockSequence = item.scenario === "fresh" ? [output.run.created_at, output.run.created_at, projectWorkflowTimestamp(pf.consumed_at), projectWorkflowTimestamp(pf.updated_at)]
      : item.scenario === "fresh_semantic" ? [projectWorkflowTimestamp(pf.consumed_at), projectWorkflowTimestamp(pf.consumed_at), projectWorkflowTimestamp(pf.updated_at)] : [];
    const expected = oracle({ action: "create", rows, secret, clock: output.run.created_at, ...(clockSequence.length ? { clock_sequence: clockSequence } : {}),
      ...(item.new_run ? { uuids: [rawRun.id.slice(4), ...history.map(event => event.id.slice(4))] } : {}), actor: { actor_id: f.canonical_user_id, workspace_id: facts.input.workspace_id },
      source: facts.source, token: facts.input.preflight_token, preflight_id: facts.input.workflow_preflight_id, key: facts.input.idempotency_key,
      retry_of_run_id: facts.retryOf, expected_retry_source: facts.expectedRetrySource });
    check(expected.accepted === true, "Actual original _create_run must accept the same fixed facts"); equal(workflowRunReadOutputDto.parse({ run: expected.run }), output, "Full actual original Run projection must match every public field"); equal([expected.commits, expected.rollbacks], [1, 0], "Actual creation source has the original single write commit");
    if (item.new_run) {
      const order = ["id", "workspace_id", "deck_plugin_id", "deck_plugin_version", "workflow_definition_ref", "deck_runtime_snapshot_id", "retry_of_run_id", "deck_plugin_manifest_hash", "deck_plugin_binding_id", "binding_revision", "runtime_plugin_lock_id", "workflow_preflight_id", "source_voice_thread_id", "source_message_id", "source_message_time", "idempotency_key", "input_hash", "semantic_fingerprint", "created_by", "created_at"];
      equal(order.map(key => /(?:created_at|source_message_time)$/.test(key) ? projectWorkflowTimestamp(rawRun[key]) : rawRun[key]), expected.parameters[4], "All twenty original Run INSERT fields must match actual PostgreSQL");
      const transitionOrder = ["id", "workflow_run_id", "transition_seq", "from_status", "to_status", "actor_id", "reason_code", "failed_step", "error_code", "occurred_at"];
      equal(history.length, 2, "Fresh Run has exactly two original transitions");
      history.forEach((event, index) => equal(transitionOrder.map(key => key === "occurred_at" ? projectWorkflowTimestamp(event[key]) : event[key]), expected.parameters[index === 0 ? 7 : 9], "Original transition identity/sequence/time must match"));
    }
    if (item.new_consumption) {
      const mapped = (await verification.query("SELECT token_digest,workflow_run_id,workflow_preflight_id,workspace_id,actor_id::text AS actor_id,idempotency_key,semantic_fingerprint FROM public.workflow_run_token_consumptions WHERE token_digest=$1", [facts.digest])).rows[0];
      equal(Object.values(mapped), expected.parameters[item.new_run ? 5 : 4], "All original token consumption fields must match"); equal([projectWorkflowTimestamp(pf.consumed_at), projectWorkflowTimestamp(pf.updated_at), facts.input.workflow_preflight_id], expected.parameters[item.new_run ? 6 : 5], "Consumption CAS preserves exact independent instants");
    }
    const receipt = (await verification.query("SELECT result,input_sha256,actor FROM dream.operation_receipts WHERE service_client_id=$1 AND actor=$2 AND operation=$3 AND request_id=$4", [f.service_id, f.user_subject, item.operation, item.request_id])).rows[0];
    equal(receipt.input_sha256, operationInputDigest(facts.input), "Original receipt binds the normalized closed input"); equal(receipt.result.thread_scope, output.run.source_voice_thread_id, "Original receipt binds source Thread"); equal(receipt.result.run_scope, output.run.workflow_run_id, "Original receipt independently binds Run");
    check(!JSON.stringify(receipt.result).includes(facts.input.preflight_token), "Preflight token must never enter Run receipt JSON");
    if (item.replay) { await call(item); equal(await state(), after, "Original replay cannot add or reorder any business effect"); await call(item, { ...facts.input, preflight_token: "pft_conflicting_original_input" }, 409); equal(await state(), after, "Conflicting original request rolls back every effect"); }
  }
  for (const item of f.receipts) {
    const before = await state(), response = await GET(new Request(`${origin}/api/internal/dream/v1/receipts/${item.request_id}?operation=${item.operation}`, { headers: headers(item.token, item.request_id) }), { params: Promise.resolve({ requestId: item.request_id }) });
    const body = await response.json(); equal(response.status, item.status, "Original receipt enforces current OAuth authority"); equal(body.request_id, item.request_id, "Original receipt correlation required");
    if (item.status === 200) { equal(body.data.status, item.state, "Committed/absent evidence is explicit"); equal(body.data.operation, item.operation, "Receipt name is exact"); if (item.state === "committed") { assert(item.source_label); equal(workflowRunReadOutputDto.parse(body.data.result), outputs.get(item.source_label), "Original GET recovers its exact bounded result"); } }
    equal(await state(), before, "Original GET is read-only");
  }
  console.log(JSON.stringify({ result: "PASS", operations: nameDto.options, validation_scope: f.validation_scope, cases: executedCases,
    skipped_accepted_cases: skippedAcceptedCases, prepared_original_cases: f.cases.length, receipt_cases: f.receipts.length, assertions,
    source: remaining ? "remaining denied/GET only; original accepted bounded results retained, no repeated creation/source execution"
      : "actual original _create_run full projection/20 INSERT fields/consumption/transitions/commit", fixture: "provider-free-isolated-restricted-roles", normal_database: "untouched" }));
} finally {
  for (const client of clients.reverse()) await client.end(); await globals.__ink_auth_pool?.end(); await globals.__ink_dream_data_pool?.end();
}
