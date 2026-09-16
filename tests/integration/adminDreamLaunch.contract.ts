// [Input] Primary-prepared disposable PG, restricted OAuth and complete independent launch component facts.
// [Output] Public source/claim/finish/original results, actual source parity and exact protected effects.
// [Pos] Provider-free component harness; verification only SELECTs and primary owns all seeds/faults.
// [Sync] 2026-09-17: require delegated user OAuth plus a short-lived client_credentials service access token.
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
import { dreamLaunchSourceEnsureInputDto, dreamLaunchSourceEnsureOutputDto } from "../../app/lib/dream/dreamLaunchSourceDto";
import { dreamLaunchDispatchClaimInputDto, dreamLaunchDispatchFinishInputDto, dreamLaunchDispatchClaimOutputDto,
  dreamLaunchDispatchFinishOutputDto, dreamLaunchDispatchContextDto } from "../../app/lib/dream/dreamLaunchDispatchDto";
import { operationInputDigest } from "../../app/lib/dream/receipts";
import { projectWorkflowTimestamp } from "../../app/lib/dream/workflowRunService";
import { dreamOperations } from "../../app/lib/dream/operationRegistry";
import { assertLaunchContinuation, launchPriorCheckpointDto, launchValidationScopeDto, type LaunchPriorCheckpoint } from "./adminDreamLaunchContinuation";

const text = z.string().min(1), nameDto = z.enum(["dream-launch-source.ensure", "dream-launch-dispatch.claim", "dream-launch-dispatch.finish"]);
const tokenDto = z.enum(["user", "other", "read_only", "thread", "none"]);
const statusDto = z.union([z.literal(200), z.literal(400), z.literal(401), z.literal(403), z.literal(404), z.literal(409), z.literal(503)]);
const codeDto = z.string().regex(/^[A-Z0-9_]{1,100}$/);
const caseDto = z.strictObject({ label: text, operation: nameDto, request_id: requestIdDto, token: tokenDto, input: z.json(),
  claim_from: text.nullable(), status: statusDto, expected_code: codeDto.nullable(), expected_result: z.json().nullable(),
  scenario: z.enum(["source_new", "source_existing", "claim_new", "claim_none", "finish_match", "finish_stale", "denied"]),
  thread_created: z.boolean(), goal: text.nullable(), system_prompt: z.string().nullable(), reference_context: dreamLaunchDispatchContextDto.nullable(), replay: z.boolean(), concurrent: z.boolean() });
const receiptDto = z.strictObject({ after_label: text, operation: nameDto, request_id: requestIdDto, token: tokenDto,
  query_tail: z.string(), status: statusDto, expected_code: codeDto.nullable(), state: z.enum(["absent", "committed"]).nullable(), source_label: text.nullable() });
const fixtureDto = z.strictObject({ database: text, port: z.number().int().positive(), data_directory: text, target_verification_url: text,
  issuer: text, service_id: text, service_access_token: text, user_subject: text, canonical_user_id: decimalIdDto,
  source_root: text, oracle_python: text, auth_role: text, data_role: text, verification_role: text,
  operation_contracts: z.strictObject({ "dream-launch-source.ensure": z.string().regex(/^[0-9a-f]{64}$/), "dream-launch-dispatch.claim": z.string().regex(/^[0-9a-f]{64}$/), "dream-launch-dispatch.finish": z.string().regex(/^[0-9a-f]{64}$/) }),
  tokens: z.strictObject({ user: text, other: text, read_only: text, thread: text }), cases: z.array(caseDto).min(1), receipts: z.array(receiptDto).min(1),
  validation_scope: launchValidationScopeDto.default("full"), prior_accepted_checkpoint: text.optional() });
type Case = z.output<typeof caseDto>;
const record = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
const fixturePath = process.env.INK_AUTH_DREAM_LAUNCH_FIXTURE;
assert(fixturePath, "Primary-prepared private isolated fixture required");
const mode = await stat(fixturePath);
assert(mode.isFile() && (mode.mode & 0o777) === 0o600 && mode.uid === process.getuid?.(), "Private owned fixture required");
let raw: unknown; try { raw = JSON.parse(await readFile(fixturePath, "utf8")); } catch { throw new Error("Invalid private fixture JSON"); }
const parsed = fixtureDto.safeParse(raw); assert(parsed.success, "Invalid strict private fixture"); const f = parsed.data;
let checkpoint: LaunchPriorCheckpoint | null = null;
if (f.prior_accepted_checkpoint !== undefined) {
  assert(f.validation_scope === "remaining_after_source_new_null", "Full acceptance cannot read a bypass checkpoint");
  assert(f.prior_accepted_checkpoint === "/private/tmp/ink-auth-migration-validation/launch75-prior-accepted-state-private.json", "Exact isolated prior checkpoint required");
  const priorMode = await stat(f.prior_accepted_checkpoint);
  assert(priorMode.isFile() && (priorMode.mode & 0o777) === 0o600 && priorMode.uid === process.getuid?.(), "Private owned checkpoint required");
  let priorRaw: unknown; try { priorRaw = JSON.parse(await readFile(f.prior_accepted_checkpoint, "utf8")); } catch { throw new Error("Invalid private checkpoint JSON"); }
  const prior = launchPriorCheckpointDto.safeParse(priorRaw); assert(prior.success, "Invalid strict prior checkpoint"); checkpoint = prior.data;
}
const acceptedLabel = assertLaunchContinuation(f, f.cases, checkpoint);
assert(f.database.startsWith("ink_auth_data_codex_test_") && f.port !== 5433 && f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"), "Explicit disposable target required");
assert(dreamOperations.length === 75 && nameDto.options.every(name => dreamOperations.find(item => item.contract.name === name)?.capability.contract_sha256 === f.operation_contracts[name]), "Prepared exact75 operation contracts required");
assert(new Set(f.cases.map(item => item.label)).size === f.cases.length && new Set(f.cases.map(item => `${item.operation}/${item.request_id}`)).size === f.cases.length, "Distinct original cases required");
for (const name of nameDto.options) {
  assert(f.cases.some(item => item.operation === name && item.status === 200), "All three components require success");
  assert(f.cases.some(item => item.operation === name && item.status !== 200), "All three components require denied no-effects");
  assert(f.receipts.some(item => item.operation === name && item.token === "user" && item.state === "committed" && item.status === 200), "Every component requires original full recovery");
  assert(f.receipts.some(item => item.operation === name && item.token === "other" && item.state === "absent" && item.status === 200), "Other actor must receive absent evidence");
  for (const token of ["read_only", "thread"] as const) assert(f.receipts.some(item => item.operation === name && item.token === token && item.status === 403), "Read-only/entity grant recovery must fail");
}
for (const scenario of ["source_new", "source_existing", "claim_new", "claim_none", "finish_match", "finish_stale", "denied"])
  assert(f.cases.some(item => item.scenario === scenario), "Every original component path required");
assert(f.cases.some(item => item.concurrent) && f.cases.some(item => item.replay), "Concurrent and original replay required");
for (const agentIsNull of [true, false]) {
  assert(f.cases.some(item => item.scenario === "source_new" && (record(item.input).agent_id === null) === agentIsNull), "Actual application null/non-null Agent sources required");
  assert(f.cases.some(item => item.scenario === "claim_new" && (record(record(item.expected_result).context).agent_id === null) === agentIsNull), "Full null/non-null context/turn parity required");
}
assert(f.cases.some(item => item.scenario === "finish_match" && record(item.input).accepted === false) &&
  f.cases.some(item => item.scenario === "finish_match" && record(item.input).accepted === true), "Both original finish outcomes required");
assert(f.receipts.some(item => item.operation === "dream-launch-dispatch.claim" && item.status === 409 && item.expected_code === "DREAM_LAUNCH_CLAIM_STALE"), "Original claim must lose authority after finish");
assert(f.receipts.some(item => item.query_tail !== "" && item.status === 404), "Closed original query selectors required");
for (const item of f.cases) {
  assert((item.status === 200) === (item.expected_result !== null) && (item.status === 200) === (item.scenario !== "denied"), "Independent full success/failure expectations required");
  assert(item.claim_from === null || item.operation === "dream-launch-dispatch.finish", "Only finish can consume a prior server-issued claim");
  if (item.status !== 200) assert(!item.thread_created && !item.replay && !item.concurrent && item.expected_code !== null, "Denied requests require safe errors and cannot declare effects/replay");
  else {
    assert(item.token === "user", "Only canonical owner success facts accepted");
    const expected = record(item.expected_result);
    if (item.operation === "dream-launch-source.ensure") assert(!Object.hasOwn(record(expected.source), "message_time"), "Only unknown server source time is omitted from independent expectation");
    if (item.operation === "dream-launch-dispatch.claim" && expected.claimed === true)
      assert(["claim_id", "parts_json", "metadata_json"].every(key => !Object.hasOwn(expected, key)), "Only server claim ID and actual-source checked envelope fields are omitted");
  }
  if (item.operation === "dream-launch-dispatch.claim" && item.status === 200) {
    assert(item.reference_context !== null && item.goal !== null, "Every claim needs complete independent original context and goal");
    assert((item.reference_context.agent_id === null) === (item.system_prompt === null), "Original non-null Agent requires independently prepared complete prompt");
  }
}
for (const item of f.receipts) {
  assert(f.cases.some(value => value.label === item.after_label), "Every receipt checkpoint must execute");
  assert(item.source_label === null || f.cases.some(value => value.label === item.source_label && value.operation === item.operation && value.status === 200), "Original full receipt source required");
}
function credential(value: string | undefined) {
  assert(value, "Explicit target credential required"); let url: URL; try { url = new URL(value); } catch { throw new Error("Invalid target credential"); }
  assert(["postgres:", "postgresql:"].includes(url.protocol) && url.username && url.password && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    Number(url.port) === f.port && decodeURIComponent(url.pathname.slice(1)) === f.database, "Every credential must name the same disposable loopback target"); return value;
}
const globals = globalThis as typeof globalThis & { __ink_auth_pool?: { end(): Promise<void> }; __ink_dream_data_pool?: { end(): Promise<void> } };
assert(!globals.__ink_auth_pool && !globals.__ink_dream_data_pool, "Harness must own newly created process pools");
const clients: Client[] = [], verification = new Client({ connectionString: credential(f.target_verification_url) });
const origin = f.issuer.replace(/\/api\/auth$/, "");
let assertions = 0, executedCases = 0, executedReceipts = 0, skippedAcceptedCases = 0;
const equal = (left: unknown, right: unknown, message: string) => { assert(isDeepStrictEqual(left, right), message); assertions++; };
const check = (value: unknown, message: string) => { assert(value, message); assertions++; };
const outputs = new Map<string, unknown>();
function headers(token: z.output<typeof tokenDto>, requestId: string) { return { authorization: `Bearer ${token === "none" ? "" : f.tokens[token]}`, "content-type": "application/json",
  "x-request-id": requestId, "x-ink-dream-service-authorization": `Bearer ${f.service_access_token}` }; }
// Fixed verifier inventory: caller DTOs never select a relation, column or SQL.
const tables = { threads: "public.chat_thread", messages: "public.chat_message", workspaces: "public.story_workspace_workspaces", decks: "public.decks", voices: "public.voices",
  runs: "public.workflow_runs", transitions: "public.workflow_run_transitions", consumptions: "public.workflow_run_token_consumptions", preflights: "public.workflow_preflights",
  preflight_requests: "dream.workflow_preflight_requests", sessions: "public.agent_sessions", bindings: "public.deck_plugin_bindings", releases: "public.deck_plugin_releases",
  snapshots: "public.deck_runtime_snapshots", locks: "public.deck_runtime_plugin_locks", receipts: "dream.operation_receipts", audits: "public.admin_audit_logs" } as const;
async function state() {
  const entries = await Promise.all(Object.entries(tables).map(async ([key, relation]) => [key,
    (await verification.query<{ value: string }>(`SELECT to_jsonb(r)::text AS value FROM ${relation} r ORDER BY to_jsonb(r)::text`)).rows.map(row => row.value)] as const));
  return Object.fromEntries(entries) as Record<keyof typeof tables, string[]>;
}
async function sourceRow(messageId: string) {
  return (await verification.query<Record<string, unknown>>("SELECT m.*,m.created_at::text AS created_at,t.user_id::text AS user_id,t.deck_id,t.voice_id FROM public.chat_message m JOIN public.chat_thread t ON t.id=m.thread_id WHERE m.id=$1", [messageId])).rows[0] ?? null;
}
async function threadRow(threadId: string) {
  return (await verification.query<Record<string, unknown>>("SELECT t.*,t.user_id::text AS user_id,t.created_at::text AS created_at,t.updated_at::text AS updated_at FROM public.chat_thread t WHERE t.id=$1", [threadId])).rows[0] ?? null;
}
function oracle(kind: "source" | "dispatch", input: unknown) {
  const file = kind === "source" ? "./dreamLaunchSourceOracle.py" : "./dreamLaunchDispatchOracle.py";
  const child = spawnSync(f.oracle_python, ["-B", fileURLToPath(new URL(file, import.meta.url))], { encoding: "utf8", timeout: 15000,
    env: { PATH: process.env.PATH, INK_DREAM_SOURCE: f.source_root } as unknown as NodeJS.ProcessEnv, input: JSON.stringify(input) });
  check(!child.error && child.status === 0, "Actual source must finish without publishing private stderr/body");
  try { return JSON.parse(child.stdout) as unknown; } catch { throw new Error("Invalid actual source response"); }
}
function parsedInput(item: Case) {
  let input: unknown = item.input;
  if (item.claim_from !== null) {
    const prior = dreamLaunchDispatchClaimOutputDto.parse(outputs.get(item.claim_from)); assert(prior.claimed, "Prior issued active claim required");
    assert(!Object.hasOwn(record(item.input), "claim_id"), "Private fixture must not override the server claim"); input = { ...record(item.input), claim_id: prior.claim_id };
  }
  if (item.status !== 200) return input;
  return item.operation === "dream-launch-source.ensure" ? dreamLaunchSourceEnsureInputDto.parse(input) :
    item.operation === "dream-launch-dispatch.claim" ? dreamLaunchDispatchClaimInputDto.parse(input) : dreamLaunchDispatchFinishInputDto.parse(input);
}
async function call(item: Case, input: unknown) {
  const response = await POST(new Request(`${origin}/api/internal/dream/v1/operations/${item.operation}`, { method: "POST", headers: headers(item.token, item.request_id),
    body: JSON.stringify({ request_id: item.request_id, input }) }), { params: Promise.resolve({ operation: item.operation }) });
  const body = record(await response.json()), error = body.error === undefined ? {} : record(body.error);
  equal(response.status, item.status, "Unexpected public component status"); equal(body.request_id, item.request_id, "Original correlation required"); equal(response.headers.get("cache-control"), "no-store", "No result caching");
  if (item.expected_code !== null) equal(error.code, item.expected_code, "Exact safe public error required");
  if (response.status !== 200) return null;
  const output = item.operation === "dream-launch-source.ensure" ? dreamLaunchSourceEnsureOutputDto.parse(body.data) :
    item.operation === "dream-launch-dispatch.claim" ? dreamLaunchDispatchClaimOutputDto.parse(body.data) : dreamLaunchDispatchFinishOutputDto.parse(body.data);
  const expected = record(item.expected_result);
  if (item.operation === "dream-launch-source.ensure") {
    const source = dreamLaunchSourceEnsureOutputDto.parse(output).source;
    equal(output, dreamLaunchSourceEnsureOutputDto.parse({ source: { ...record(expected.source), message_time: source.message_time } }), "Every independent static source field required");
  } else if (item.operation === "dream-launch-dispatch.claim") {
    const claim = dreamLaunchDispatchClaimOutputDto.parse(output);
    equal(output, dreamLaunchDispatchClaimOutputDto.parse(claim.claimed ? { ...expected, claim_id: claim.claim_id, parts_json: claim.parts_json, metadata_json: claim.metadata_json } : expected), "Every independent context/source field required");
  } else equal(output, dreamLaunchDispatchFinishOutputDto.parse(expected), "Full independent finish result required");
  if (outputs.has(item.label)) equal(output, outputs.get(item.label), "Original replay/concurrent full result required"); else outputs.set(item.label, output);
  return output;
}
async function checkOriginals(afterLabel: string) {
  for (const item of f.receipts.filter(value => value.after_label === afterLabel)) {
    const before = await state();
    const response = await GET(new Request(`${origin}/api/internal/dream/v1/receipts/${item.request_id}?operation=${item.operation}${item.query_tail}`, { headers: headers(item.token, item.request_id) }), { params: Promise.resolve({ requestId: item.request_id }) });
    const body = record(await response.json()); equal(response.status, item.status, "Unexpected public original status"); equal(body.request_id, item.request_id, "Original GET correlation required"); equal(response.headers.get("cache-control"), "no-store", "Original GET cannot cache");
    if (item.expected_code !== null) equal(record(body.error).code, item.expected_code, "Exact safe original error required");
    if (item.status === 200) {
      const result = record(body.data); equal(result.status, item.state, "Explicit original evidence required");
      equal(result.operation, item.operation, "Original operation required"); equal(result.request_id, item.request_id, "Original result ID required");
      if (item.state === "committed") { check(item.source_label !== null && outputs.has(item.source_label), "Complete prior bounded result required"); equal(result.result, outputs.get(item.source_label!), "Every original bounded field/time/claim required"); }
      else equal(result, { status: "absent", operation: item.operation, request_id: item.request_id }, "Other actor cannot select a result");
    }
    equal(await state(), before, "Original GET must not change any protected state"); executedReceipts++;
  }
}
async function resumeAcceptedSource(item: Case, proof: LaunchPriorCheckpoint) {
  equal([proof.database, proof.port, proof.data_directory], [f.database, f.port, f.data_directory], "Prior checkpoint must name the same proved target");
  const before = await state(); equal(before, proof.states, "All17 postaccepted tables must remain byte exact before continuation");
  const accepted = proof.accepted[0], command = dreamLaunchSourceEnsureInputDto.parse(item.input), bounded = accepted.row.result.data;
  equal(accepted.row.input_sha256, operationInputDigest(command), "Old original closed source digest required");
  const stored = (await verification.query<Record<string, unknown>>("SELECT result,input_sha256,committed_at::text AS committed_at FROM dream.operation_receipts WHERE service_client_id=$1 AND actor=$2 AND operation=$3 AND request_id=$4", [f.service_id, f.user_subject, item.operation, item.request_id])).rows[0];
  check(stored, "The only skipped source must already have its original committed receipt"); equal(stored, accepted.row, "Full old wrapper/result/scopes/digest/commit time must remain exact");
  equal(bounded, dreamLaunchSourceEnsureOutputDto.parse({ source: { ...record(record(item.expected_result).source), message_time: bounded.source.message_time } }), "Every independently prepared original static source field required");
  const source = await sourceRow(bounded.source.message_id), thread = await threadRow(bounded.source.thread_id);
  equal(source, proof.source, "Complete prior source parts/metadata/provenance/time must remain exact"); equal(thread, proof.thread, "Complete prior Thread/scope/order must remain exact"); assert(source && thread);
  equal([source.id, source.thread_id, source.role, source.user_id, source.deck_id, source.voice_id], [bounded.source.message_id, bounded.source.thread_id, "user", f.canonical_user_id, command.deck_id, command.agent_id], "Old source canonical ownership and original provenance required");
  equal(projectWorkflowTimestamp(String(source.created_at)), bounded.source.message_time, "Original PG source microseconds retained"); equal(projectWorkflowTimestamp(String(thread.updated_at)), bounded.source.message_time, "Original Thread ordering retained");
  const captures = z.array(z.strictObject({ arguments: z.record(z.string(), z.unknown()), events: z.array(z.string()) })).parse(oracle("source", { action: "application-source", cases: [{ actor: f.canonical_user_id, input: command }] }));
  equal(captures[0].events, ["prepare", "source"], "Actual original application order required on skipped source");
  equal([captures[0].arguments.thread_id, captures[0].arguments.message_id, captures[0].arguments.request_fingerprint], [bounded.source.thread_id, bounded.source.message_id, bounded.source.request_fingerprint], "Full actual application NULL-Agent identity required");
  const original = record(oracle("source", { action: "ensure", clock: bounded.source.message_time, arguments: captures[0].arguments, results: [null, { id: command.deck_id }, null, null, null, null, null] }));
  const originalSource = record(original.source); equal(bounded, { source: { ...originalSource, message_time: projectWorkflowTimestamp(String(originalSource.message_time)) } }, "Entire original fresh source result remains independently valid");
  const parameters = z.array(z.array(z.unknown())).parse(original.parameters);
  equal(parameters[4], [bounded.source.thread_id, f.canonical_user_id, thread.title, thread.deck_id, thread.voice_id], "Original whole fresh Thread INSERT parameters required without POST");
  equal(parameters[5], [bounded.source.message_id, bounded.source.thread_id, source.parts, source.metadata, bounded.source.message_time], "Original whole source INSERT parameters required without POST");
  equal(parameters[6], [bounded.source.message_time, bounded.source.thread_id], "Original ordering parameters required without POST"); equal([original.commits, original.rollbacks], [1, 0], "Original fresh source commit contract retained");
  equal((await verification.query<{ count: number }>("SELECT count(*)::int AS count FROM public.admin_audit_logs WHERE actor_id=$1 AND action=$2 AND request_id=$3", [f.service_id, `dream.${item.operation}`, item.request_id])).rows[0].count, 1, "Exactly one prior correlated audit required");
  equal(await state(), before, "Resuming the accepted source must be entirely read only"); outputs.set(item.label, bounded); skippedAcceptedCases++;
}
try {
  await verification.connect(); clients.push(verification);
  for (const [client, role] of [[verification, f.verification_role], [new Client({ connectionString: credential(process.env.AUTH_DATABASE_URL) }), f.auth_role],
    [new Client({ connectionString: credential(process.env.DREAM_DATA_DATABASE_URL) }), f.data_role]] as const) {
    if (client !== verification) { await client.connect(); clients.push(client); }
    equal((await client.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_user AS role")).rows[0], { name: f.database, port: f.port, role }, "Exact actual target role/catalog required");
    if (client === verification) equal((await client.query("SELECT current_setting('data_directory') AS root")).rows[0].root, f.data_directory, "Owner verifier proves disposable instance directory");
    else equal((await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0],
      { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }, "Actual app role must remain restricted");
  }
  for (const item of f.cases) {
    if (acceptedLabel === item.label) { assert(checkpoint); await resumeAcceptedSource(item, checkpoint); await checkOriginals(item.label); continue; }
    const input = parsedInput(item), expected = item.expected_result === null ? null : record(item.expected_result);
    const ids = expected === null ? null : item.operation === "dream-launch-source.ensure" ? record(expected.source) : expected;
    const before = await state(), sourceBefore = ids === null ? null : await sourceRow(String(ids.message_id)), threadBefore = ids === null ? null : await threadRow(String(ids.thread_id));
    const result = item.concurrent ? (await Promise.all([call(item, input), call(item, input), call(item, input)]))[0] : await call(item, input);
    if (item.replay) await call(item, input);
    const after = await state();
    if (result === null) { equal(after, before, "Denied component must roll back all protected rows"); executedCases++; await checkOriginals(item.label); continue; }
    assert(ids && expected); const messageId = String(ids.message_id), threadId = String(ids.thread_id), current = await sourceRow(messageId), thread = await threadRow(threadId);
    check(current && thread, "Owned current backing source required"); assert(current && thread);
    equal(current.user_id, f.canonical_user_id, "Canonical source owner required"); equal(current.thread_id, threadId, "Exact Thread provenance required"); equal(current.role, "user", "Original source role required");
    for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
      if (["messages", "receipts", "audits"].includes(key) || (key === "threads" && item.scenario === "source_new")) continue;
      equal(after[key], before[key], `Unrelated ${key} must remain byte exact`);
    }
    for (const key of ["threads", "messages"] as const) {
      const id = key === "threads" ? threadId : messageId;
      const excluding = (rows: string[]) => rows.filter(value => record(JSON.parse(value)).id !== id);
      equal(excluding(after[key]), excluding(before[key]), "Other backing rows must remain byte exact");
    }
    equal(after.messages.length - before.messages.length, item.scenario === "source_new" ? 1 : 0, "Exact backing message count required");
    equal(after.threads.length - before.threads.length, item.thread_created ? 1 : 0, "Exact backing Thread count required");
    equal(after.receipts.length - before.receipts.length, 1, "One immutable original receipt required"); equal(after.audits.length - before.audits.length, 1, "One same-UOW audit required");
    for (const key of ["receipts", "audits"] as const) check(before[key].every(value => after[key].includes(value)), "Existing receipts/audits must stay byte exact");
    const receipt = (await verification.query<Record<string, unknown>>("SELECT input_sha256,result FROM dream.operation_receipts WHERE service_client_id=$1 AND actor=$2 AND operation=$3 AND request_id=$4", [f.service_id, f.user_subject, item.operation, item.request_id])).rows[0];
    check(receipt, "Original receipt persisted"); const stored = record(receipt.result);
    equal(stored.schema_version, 1, "Original stored envelope version required"); equal(stored.data, result, "Stored full bounded result required"); equal(receipt.input_sha256, operationInputDigest(input), "Original closed input digest required");
    equal(stored.thread_scope, threadId, "Receipt Thread scope required"); equal(stored.editor_session_scope, null, "No Editor scope added"); equal(stored.run_scope ?? null, item.operation === "dream-launch-source.ensure" ? null : ids.workflow_run_id, "Exact bounded Run scope required");
    equal((await verification.query<{ count: number }>("SELECT count(*)::int AS count FROM public.admin_audit_logs WHERE actor_id=$1 AND action=$2 AND request_id=$3", [f.service_id, `dream.${item.operation}`, item.request_id])).rows[0].count, 1, "One exact correlated service audit required");
    if (item.operation === "dream-launch-source.ensure") {
      const command = dreamLaunchSourceEnsureInputDto.parse(input), source = dreamLaunchSourceEnsureOutputDto.parse(result).source;
      const captures = z.array(z.strictObject({ arguments: z.record(z.string(), z.unknown()), events: z.array(z.string()) })).parse(oracle("source", { action: "application-source", cases: [{ actor: f.canonical_user_id, input: command }] }));
      equal(captures[0].events, ["prepare", "source"], "Actual application call order required");
      equal([captures[0].arguments.thread_id, captures[0].arguments.message_id, captures[0].arguments.request_fingerprint], [source.thread_id, source.message_id, source.request_fingerprint], "Actual application source identity including omitted null-Agent hash key required");
      const rows = item.scenario === "source_new" ? [null, { id: command.deck_id }, null, threadBefore, ...(threadBefore ? [] : [null]), null, null] : [null, { id: command.deck_id }, sourceBefore];
      const original = record(oracle("source", { action: "ensure", clock: source.message_time, arguments: captures[0].arguments, results: rows }));
      const originalSource = record(original.source); equal(result, { source: { ...originalSource, message_time: projectWorkflowTimestamp(String(originalSource.message_time)) } }, "Actual entire ensure source result required"); equal([original.commits, original.rollbacks], [1, 0], "Original ensure commits independently");
      if (item.scenario === "source_new") {
        const parameters = z.array(z.array(z.unknown())).parse(original.parameters), messageParams = parameters.at(-2)!;
        equal(messageParams, [messageId, threadId, current.parts, current.metadata, source.message_time], "Exact original full message INSERT parameters required");
        equal(parameters.at(-1), [source.message_time, threadId], "Original Thread ordering update required");
        equal(projectWorkflowTimestamp(String(thread.updated_at)), source.message_time, "Source updates Thread ordering once");
        if (item.thread_created) equal(parameters[4], [threadId, f.canonical_user_id, thread.title, thread.deck_id, thread.voice_id], "Exact original Thread INSERT parameters required");
      } else { equal(current, sourceBefore, "Source replay preserves complete parts/metadata/time"); equal(thread, threadBefore, "Source replay preserves Thread ordering"); }
    } else if (item.operation === "dream-launch-dispatch.claim") {
      const claim = dreamLaunchDispatchClaimOutputDto.parse(result); assert(sourceBefore, "Primary must prepare the original source");
      assert(item.reference_context && item.goal !== null);
      if (claim.claimed) equal(claim.context, item.reference_context, "Independent full context must match source/Run/binding projection");
      if (item.reference_context.agent_id !== null) equal((await verification.query<{ system_prompt: string }>("SELECT system_prompt FROM public.voices WHERE id=$1 AND deck_id=$2 AND enabled IS TRUE", [item.reference_context.agent_id, item.reference_context.deck_id])).rows[0]?.system_prompt, item.system_prompt, "Actual original owned source Agent prompt required");
      equal(projectWorkflowTimestamp(String(current.created_at)), projectWorkflowTimestamp(String(sourceBefore.created_at)), "Claim preserves source creation time");
      if (claim.claimed) {
        assert(item.goal !== null); equal(record(input).instruction_text, record(oracle("dispatch", { action: "instruction", goal: item.goal })).instruction, "Dream pure original instruction required");
        const metadata = record(JSON.parse(String(current.metadata))), now = text.parse(metadata.dispatchClaimedAt);
        const original = record(oracle("dispatch", { action: "dispatch", clock: now, uuid: claim.claim_id.slice(4), actor: f.canonical_user_id, goal: item.goal, context: claim.context,
          source: { thread_id: threadId, message_id: messageId, message_time: projectWorkflowTimestamp(String(sourceBefore.created_at)), request_fingerprint: record(JSON.parse(String(sourceBefore.metadata))).requestFingerprint, created: true },
          results: [null, sourceBefore, null, ...(claim.context.agent_id === null ? [] : [{ system_prompt: item.system_prompt }])] }));
        equal(z.array(z.array(z.unknown())).parse(original.parameters)[2], [current.parts, current.metadata, messageId], "Exact original claim UPDATE metadata/parts required");
        equal(original.turns, [{ actor_id: f.canonical_user_id, thread_id: threadId, message_id: messageId, parts_json: claim.parts_json, metadata_json: claim.metadata_json,
          context: claim.context, system_prompt: item.system_prompt, resume: false }], "Full original context, Runtime envelope and prompt capture required");
        const events = z.array(z.string()).parse(original.events); check(events.indexOf("commit") < events.indexOf("turn"), "Original claim COMMIT must precede captured turn"); equal([original.commits, original.rollbacks], [1, 0], "Original claim commit retained");
      } else {
        equal(current, sourceBefore, "Fresh/dispatched no-claim preserves complete source");
        const now = projectWorkflowTimestamp((await verification.query<{ now: string }>("SELECT clock_timestamp()::text AS now")).rows[0].now);
        const original = record(oracle("dispatch", { action: "dispatch", clock: now, uuid: "00000000000000000000000000000000", actor: f.canonical_user_id, goal: item.goal, context: item.reference_context,
          source: { thread_id: threadId, message_id: messageId, message_time: projectWorkflowTimestamp(String(sourceBefore.created_at)), request_fingerprint: record(JSON.parse(String(sourceBefore.metadata))).requestFingerprint, created: true }, results: [null, sourceBefore] }));
        equal(original.accepted, false, "Actual original dispatched/fresh no-claim required"); equal(original.turns, [], "Original no-claim cannot dispatch Runtime"); equal([original.commits, original.rollbacks], [1, 0], "Original no-claim commits its independent read UOW");
      }
    } else {
      assert(sourceBefore); const finish = dreamLaunchDispatchFinishInputDto.parse(input), output = dreamLaunchDispatchFinishOutputDto.parse(result);
      const original = record(oracle("dispatch", { action: "finish", clock: projectWorkflowTimestamp(String(sourceBefore.created_at)), uuid: finish.claim_id.slice(4), message_id: messageId,
        claim_id: finish.claim_id, status: finish.accepted ? "dispatched" : "pending", results: [null, { metadata: sourceBefore.metadata }, ...(output.finished ? [null] : [])] }));
      equal(output.finished, original.accepted, "Actual independent finish outcome required"); equal([original.commits, original.rollbacks], [1, 0], "Original finish commits independently");
      equal(current.parts, sourceBefore.parts, "Finish cannot rewrite parts"); equal(current.created_at, sourceBefore.created_at, "Finish preserves original source time");
      if (output.finished) equal(z.array(z.array(z.unknown())).parse(original.parameters)[2], [current.metadata, messageId], "Exact original fixed-status finish UPDATE required");
      else equal(current, sourceBefore, "Stale claim finish preserves later lease");
    }
    executedCases++; await checkOriginals(item.label);
  }
  equal(executedReceipts, f.receipts.length, "All prepared original checkpoints executed");
  equal(skippedAcceptedCases, acceptedLabel === null ? 0 : 1, "Only the single primary-proved accepted case may skip POST");
  process.stdout.write(JSON.stringify({ result: "PASS", scope: "provider-free launch components", validation_scope: f.validation_scope, cases: executedCases, skipped_accepted_cases: skippedAcceptedCases, prepared_cases: f.cases.length, receipts: executedReceipts, assertions,
    source_application_and_entire_ensure: true, claim_commit_before_captured_turn: true, independent_finish: true,
    full_prepare_failure_runtime: "not executed", protected_tables: Object.keys(tables).length }) + "\n");
} finally {
  await Promise.allSettled(clients.map(client => client.end())); await globals.__ink_auth_pool?.end(); await globals.__ink_dream_data_pool?.end();
}
