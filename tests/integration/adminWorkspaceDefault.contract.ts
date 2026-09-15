// [Input] Primary-prepared disposable PostgreSQL, restricted OAuth and independent default Workspace facts.
// [Output] Public default/original results, first-write concurrency, actual source and full protected effects.
// [Pos] Provider-free SELECT-only verifier; primary owns fixtures, faults, DDL and cleanup.
// [Sync] 2026-09-15: verify76 without claiming normal business, Runtime or complete database closure.
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
import { workspaceDefaultEnsureOutputDto } from "../../app/lib/dream/workspaceDefaultDto";
import { dreamOperations } from "../../app/lib/dream/operationRegistry";
import { operationInputDigest } from "../../app/lib/dream/receipts";
import { projectWorkflowTimestamp } from "../../app/lib/dream/workflowRunService";
const text = z.string().min(1), code = z.string().regex(/^[A-Z0-9_]{1,100}$/);
const status = z.union([z.literal(200), z.literal(400), z.literal(401), z.literal(403), z.literal(404), z.literal(409), z.literal(503)]);
const caseDto = z.strictObject({ label: text, request_id: requestIdDto, token: text, input: z.json(), status,
  expected_code: code.nullable(), scenario: z.enum(["fresh", "existing", "denied"]), expected_workspace_id: text.nullable(),
  same_original_concurrency: z.boolean(), concurrent_request_ids: z.array(requestIdDto), replay: z.boolean() });
const receiptDto = z.strictObject({ after_label: text, request_id: requestIdDto, token: text, query_tail: z.string(), status,
  expected_code: code.nullable(), state: z.enum(["absent", "committed"]).nullable(), source_label: text.nullable() });
const fixtureDto = z.strictObject({ database: text, port: z.number().int().positive(), data_directory: text, target_verification_url: text,
  issuer: text, service_id: text, service_secret: text, auth_role: text, data_role: text, verification_role: text,
  source_root: text, oracle_python: text, operation_contract_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  expected_default_name: text, expected_created_status: text, canonical_ids: z.record(z.string(), decimalIdDto), subjects: z.record(z.string(), text),
  tokens: z.record(z.string(), text), cases: z.array(caseDto).min(1), receipts: z.array(receiptDto).min(1) });
const record = (value: unknown) => z.record(z.string(), z.unknown()).parse(value);
const path = process.env.INK_AUTH_WORKSPACE_DEFAULT_FIXTURE; assert(path, "Primary-prepared private disposable fixture required");
const mode = await stat(path); assert(mode.isFile() && (mode.mode & 0o777) === 0o600 && mode.uid === process.getuid?.(), "Private owned fixture required");
let raw: unknown; try { raw = JSON.parse(await readFile(path, "utf8")); } catch { throw new Error("Invalid private fixture JSON"); }
const parsed = fixtureDto.safeParse(raw); assert(parsed.success, "Invalid strict private fixture"); const f = parsed.data;
const name = "workspace-default.ensure", contract = dreamOperations.find(item => item.contract.name === name);
assert(dreamOperations.length === 76 && contract?.capability.contract_sha256 === f.operation_contract_sha256, "Exact prepared76 contract required");
assert(f.database.startsWith("ink_auth_data_codex_test_") && f.port !== 5433 && f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"), "Explicit disposable target required");
assert(new Set(f.cases.map(item => item.label)).size === f.cases.length, "Distinct prepared labels required");
const requestIds = f.cases.flatMap(item => [item.request_id, ...item.concurrent_request_ids]); assert(new Set(requestIds).size === requestIds.length, "Distinct original request IDs required");
assert(f.cases[0].scenario === "fresh" && f.cases[0].same_original_concurrency && f.cases[0].concurrent_request_ids.length > 0, "First case must prove simultaneous same/different-original initialization");
for (const scenario of ["fresh", "existing", "denied"]) assert(f.cases.some(item => item.scenario === scenario), "Every original default path required");
assert(f.cases.some(item => item.replay), "Full original replay required");
for (const token of ["read_only", "thread"]) assert(f.cases.some(item => item.token === token && item.status === 403), "Read-only/entity default initialization must fail");
assert(f.cases.some(item => item.token === "none" && item.status === 401), "Missing OAuth must fail closed");
assert(f.cases.some(item => item.status === 400 && item.expected_code === "INPUT_INVALID"), "Strict empty-body failure required");
assert(f.cases.some(item => item.status === 409 && item.expected_code === "OPERATION_REQUEST_CONFLICT"), "Primary-prepared original digest conflict required");
for (const item of f.cases) {
  assert(item.token === "none" || Object.hasOwn(f.tokens, item.token), "Explicit prepared bearer required");
  assert((item.status === 200) === (item.scenario !== "denied") && (item.status === 200) === (item.expected_code === null), "Independent success/failure expectations required");
  if (item.status === 200) assert(Object.hasOwn(f.canonical_ids, item.token) && Object.hasOwn(f.subjects, item.token) && Object.keys(record(item.input)).length === 0 &&
    (item.scenario === "fresh") === (item.expected_workspace_id === null), "Success requires mapped canonical actor/strict empty input and independent ID facts");
  else assert(!item.same_original_concurrency && item.concurrent_request_ids.length === 0 && !item.replay && item.expected_workspace_id === null, "Denied cases cannot declare writes/concurrency/replay");
}
for (const item of f.receipts) {
  assert(f.cases.some(value => value.label === item.after_label), "Every original checkpoint must execute");
  assert(item.token === "none" || Object.hasOwn(f.tokens, item.token), "Prepared original bearer required");
  assert((item.status === 200) === (item.state !== null) && (item.status === 200) === (item.expected_code === null), "Complete independent original evidence/error facts required");
  if (item.state === "committed") assert(item.source_label !== null && f.cases.some(value => value.label === item.source_label && value.status === 200 &&
    [value.request_id, ...value.concurrent_request_ids].includes(item.request_id)), "Complete matching original result required");
}
for (const token of ["read_only", "thread"]) assert(f.receipts.some(item => item.token === token && item.status === 403), "Read-only/entity original recovery must fail");
assert(f.receipts.some(item => item.state === "absent" && item.status === 200), "Other/uncommitted original absent evidence required");
assert(f.receipts.some(item => item.query_tail === "&unexpected=caller" && item.status === 404 && item.expected_code === "OPERATION_UNAVAILABLE"), "Ordinary unknown selector must be closed");
assert(f.receipts.some(item => item.query_tail === "&actor_id=caller" && item.status === 400 && item.expected_code === "USER_OVERRIDE_FORBIDDEN"), "Shared identity override boundary must stay exact");
function credential(value: string | undefined) {
  assert(value, "Explicit target credential required"); let url: URL; try { url = new URL(value); } catch { throw new Error("Invalid target credential"); }
  assert(["postgres:", "postgresql:"].includes(url.protocol) && url.username && url.password && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    Number(url.port) === f.port && decodeURIComponent(url.pathname.slice(1)) === f.database, "All credentials must name the same disposable loopback target"); return value;
}
const globals = globalThis as typeof globalThis & { __ink_auth_pool?: { end(): Promise<void> }; __ink_dream_data_pool?: { end(): Promise<void> } };
assert(!globals.__ink_auth_pool && !globals.__ink_dream_data_pool, "Harness must own fresh process pools");
const clients: Client[] = [], verification = new Client({ connectionString: credential(f.target_verification_url) }), outputs = new Map<string, unknown>();
const origin = f.issuer.replace(/\/api\/auth$/, ""); let assertions = 0, executedCases = 0, executedReceipts = 0;
const equal = (left: unknown, right: unknown, message: string) => { assert(isDeepStrictEqual(left, right), message); assertions++; };
const check = (value: unknown, message: string) => { assert(value, message); assertions++; };
const tables = { threads: "public.chat_thread", messages: "public.chat_message", workspaces: "public.story_workspace_workspaces", decks: "public.decks", voices: "public.voices",
  runs: "public.workflow_runs", transitions: "public.workflow_run_transitions", consumptions: "public.workflow_run_token_consumptions", preflights: "public.workflow_preflights",
  preflight_requests: "dream.workflow_preflight_requests", sessions: "public.agent_sessions", bindings: "public.deck_plugin_bindings", releases: "public.deck_plugin_releases",
  snapshots: "public.deck_runtime_snapshots", locks: "public.deck_runtime_plugin_locks", receipts: "dream.operation_receipts", audits: "public.admin_audit_logs" } as const;
async function state() { return Object.fromEntries(await Promise.all(Object.entries(tables).map(async ([key, relation]) => [key,
  (await verification.query<{ value: string }>(`SELECT to_jsonb(r)::text AS value FROM ${relation} r ORDER BY to_jsonb(r)::text`)).rows.map(row => row.value)] as const))) as Record<keyof typeof tables, string[]>; }
function headers(token: string, requestId: string) { return { authorization: `Bearer ${token === "none" ? "" : f.tokens[token]}`, "content-type": "application/json",
  "x-request-id": requestId, "x-ink-dream-service": f.service_id, "x-ink-dream-credential": f.service_secret }; }
async function clock() { return projectWorkflowTimestamp((await verification.query<{ now: string }>("SELECT clock_timestamp()::text AS now")).rows[0].now)!; }
function sourceOracle(actor: string, workspaceId: string, existing: string | null) {
  const child = spawnSync(f.oracle_python, ["-B", fileURLToPath(new URL("./workspaceDefaultSourceOracle.py", import.meta.url))], { encoding: "utf8", timeout: 15000,
    env: { PATH: process.env.PATH, INK_DREAM_SOURCE: f.source_root } as unknown as NodeJS.ProcessEnv,
    input: JSON.stringify({ cases: [{ actor, uuid: existing === null ? workspaceId : "00000000-0000-0000-0000-000000000000", existing }] }) });
  check(!child.error && child.status === 0, "Actual source must finish without printing private stderr/body");
  let result: unknown; try { result = JSON.parse(child.stdout); } catch { throw new Error("Invalid actual source response"); }
  return record(z.array(z.unknown()).length(1).parse(result)[0]);
}
async function call(item: z.output<typeof caseDto>, requestId: string) {
  const response = await POST(new Request(`${origin}/api/internal/dream/v1/operations/${name}`, { method: "POST", headers: headers(item.token, requestId),
    body: JSON.stringify({ request_id: requestId, input: item.input }) }), { params: Promise.resolve({ operation: name }) });
  const body = record(await response.json()); equal(response.status, item.status, "Exact public default status required"); equal(body.request_id, requestId, "Original correlation required");
  equal(response.headers.get("cache-control"), "no-store", "No default caching");
  if (item.expected_code !== null) equal(record(body.error).code, item.expected_code, "Exact safe public error required");
  return response.status === 200 ? workspaceDefaultEnsureOutputDto.parse(body.data) : null;
}
async function originals(label: string) {
  for (const item of f.receipts.filter(value => value.after_label === label)) {
    const before = await state(), response = await GET(new Request(`${origin}/api/internal/dream/v1/receipts/${item.request_id}?operation=${name}${item.query_tail}`,
      { headers: headers(item.token, item.request_id) }), { params: Promise.resolve({ requestId: item.request_id }) });
    const body = record(await response.json()); equal(response.status, item.status, "Exact public original status required"); equal(body.request_id, item.request_id, "Original GET correlation required");
    equal(response.headers.get("cache-control"), "no-store", "No original caching");
    if (item.expected_code !== null) equal(record(body.error).code, item.expected_code, "Exact safe original error required");
    if (item.status === 200) {
      if (item.state === "committed") check(item.source_label !== null && outputs.has(item.source_label), "Full prior original result must already exist");
      equal(body.data, item.state === "committed" ? { status: "committed", operation: name, request_id: item.request_id, result: outputs.get(item.source_label!) } :
        { status: "absent", operation: name, request_id: item.request_id }, "Full bounded original/absent evidence required");
    }
    equal(await state(), before, "Every GET leaves all17 protected tables byte exact"); executedReceipts++;
  }
}
try {
  await verification.connect(); clients.push(verification);
  for (const [client, role] of [[verification, f.verification_role], [new Client({ connectionString: credential(process.env.AUTH_DATABASE_URL) }), f.auth_role],
    [new Client({ connectionString: credential(process.env.DREAM_DATA_DATABASE_URL) }), f.data_role]] as const) {
    if (client !== verification) { await client.connect(); clients.push(client); }
    equal((await client.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_user AS role")).rows[0], { name: f.database, port: f.port, role }, "Exact actual target role required");
    if (client === verification) equal((await client.query("SELECT current_setting('data_directory') AS root")).rows[0].root, f.data_directory, "Owner verifier proves disposable data directory");
    else equal((await client.query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0],
      { rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }, "Actual app roles must stay restricted");
  }
  for (const item of f.cases) {
    const before = await state(), actor = f.canonical_ids[item.token], oldest = item.status === 200 ? (await verification.query<{ id: string }>(
      "SELECT id FROM public.story_workspace_workspaces WHERE owner_id=$1::bigint ORDER BY created_at ASC,id ASC LIMIT 1", [actor])).rows[0]?.id ?? null : null;
    if (item.scenario === "fresh") equal(oldest, null, "Fresh actor must have zero existing Workspace before first concurrent POST");
    if (item.scenario === "existing") equal(oldest, item.expected_workspace_id, "Complete independent oldest created_at/id fact required");
    const started = await clock(), ids = [item.request_id, ...item.concurrent_request_ids], firstCalls = item.same_original_concurrency ? [item.request_id, item.request_id, ...ids] : ids;
    const results = await Promise.all(firstCalls.map(requestId => call(item, requestId))), result = results[0], finished = await clock();
    for (const value of results) equal(value, result, "All first concurrent same/different originals must return one complete default result");
    if (item.replay) { const replayBefore = await state(); equal(await call(item, item.request_id), result, "Full same-original replay required"); equal(await state(), replayBefore, "Replay cannot duplicate effects"); }
    const after = await state();
    if (!result) { equal(after, before, "Denied default request rolls back all17 tables"); executedCases++; await originals(item.label); continue; }
    outputs.set(item.label, result); if (item.expected_workspace_id !== null) equal(result.workspace_id, item.expected_workspace_id, "Every independent existing ID field required");
    else check(z.uuid().safeParse(result.workspace_id).success, "Fresh default must be a server-generated UUID");
    for (const key of Object.keys(tables) as (keyof typeof tables)[]) {
      if (["workspaces", "receipts", "audits"].includes(key)) continue; equal(after[key], before[key], `Unrelated ${key} remains byte exact`);
    }
    equal(after.workspaces.length - before.workspaces.length, item.scenario === "fresh" ? 1 : 0, "Concurrent initialization creates exactly one Workspace");
    check(before.workspaces.every(value => after.workspaces.includes(value)), "Every preexisting Workspace row remains byte exact");
    for (const key of ["receipts", "audits"] as const) {
      equal(after[key].length - before[key].length, ids.length, "Exactly one receipt/audit per distinct original"); check(before[key].every(value => after[key].includes(value)), "All original receipt/audit history retained");
    }
    const row = (await verification.query<Record<string, unknown>>("SELECT w.*,w.owner_id::text AS owner_id,w.created_at::text AS created_at,w.updated_at::text AS updated_at FROM public.story_workspace_workspaces w WHERE id=$1", [result.workspace_id])).rows[0];
    check(row, "Full owned default row required"); equal(row.owner_id, actor, "Exact canonical bigint ownership required");
    const original = sourceOracle(actor, result.workspace_id, oldest);
    equal([original.result, original.error, original.commits, original.rollbacks], [result.workspace_id, null, item.scenario === "fresh" ? 1 : 0, 0], "Actual entire original helper result/transaction parity required");
    const parameters = z.array(z.array(z.unknown())).parse(original.parameters); equal(parameters[0], [actor], "Exact original bigint lookup parameter required");
    if (item.scenario === "fresh") {
      equal(parameters[1], [row.id, row.name, actor, "{}"], "Actual complete original INSERT parameters required");
      const created = projectWorkflowTimestamp(String(row.created_at)), updated = projectWorkflowTimestamp(String(row.updated_at));
      equal(row, { id: result.workspace_id, name: f.expected_default_name, owner_id: actor, settings: {}, status: f.expected_created_status, created_at: row.created_at, updated_at: row.updated_at }, "Every fresh schema/default field required");
      check(created !== null && updated === created && created >= started && created <= finished, "Exact original PG timestamp pair/creation interval required");
    } else equal(parameters.length, 1, "Existing original helper never inserts");
    for (const requestId of ids) {
      const receipt = (await verification.query<Record<string, unknown>>("SELECT input_sha256,result FROM dream.operation_receipts WHERE service_client_id=$1 AND actor=$2 AND operation=$3 AND request_id=$4",
        [f.service_id, f.subjects[item.token], name, requestId])).rows[0];
      check(receipt, "Complete original receipt required"); equal(receipt.input_sha256, operationInputDigest({}), "Strict empty input digest required");
      const wrapper = record(receipt.result); equal(wrapper.schema_version, 1, "Original wrapper version required"); equal(wrapper.data, result, "Full stored original result required");
      equal([wrapper.thread_scope, wrapper.editor_session_scope, wrapper.run_scope ?? null], [null, null, null], "All exact null entity scopes required");
      equal((await verification.query<{ count: number }>("SELECT count(*)::int AS count FROM public.admin_audit_logs WHERE actor_id=$1 AND action=$2 AND request_id=$3", [f.service_id, `dream.${name}`, requestId])).rows[0].count, 1, "One same-UOW correlated audit per original required");
    }
    executedCases++; await originals(item.label);
  }
  equal(executedReceipts, f.receipts.length, "All original checkpoints executed");
  process.stdout.write(JSON.stringify({ result: "PASS", scope: "provider-free default Workspace", cases: executedCases, receipts: executedReceipts, assertions,
    protected_tables: Object.keys(tables).length, initial_same_and_distinct_original_concurrency: true, actual_entire_original_source: true, normal_business_runtime: "not executed" }) + "\n");
} finally { await Promise.allSettled(clients.map(client => client.end())); await globals.__ink_auth_pool?.end(); await globals.__ink_dream_data_pool?.end(); }
