// [Input] Primary-prepared Preflight61 facts, restricted OAuth actors and a private source interpreter fixture.
// [Output] Complete execution/read contract or remaining reads, with full original source projection evidence.
// [Pos] Provider-free isolated harness; verification only SELECTs, primary owns migration, seeds and faults.
// [Sync] 2026-09-15: mark required active/expired facts explicitly while preserving extra consumed read coverage.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { z } from "zod";
import { POST as operationRoute } from "../../app/api/internal/dream/v1/operations/[operation]/route";
import { GET as receiptRoute } from "../../app/api/internal/dream/v1/receipts/[requestId]/route";
import { decimalIdDto, requestIdDto } from "../../app/lib/auth/dto";
import { workflowPreflightDto, workflowPreflightReadOutputDto } from "../../app/lib/dream/workflowPreflightDto";
import { workflowPreflightExecutionInputDto, workflowPreflightExecutionOutputDto, workflowPreflightOriginalReceiptDto } from "../../app/lib/dream/workflowPreflightExecutionDto";
import { operationInputDigest } from "../../app/lib/dream/receipts";
import { workflowTimestampMicros } from "../../app/lib/dream/workflowRunDto";
import { projectWorkflowTimestamp } from "../../app/lib/dream/workflowRunService";

const text = z.string().min(1);
const tokenName = z.enum(["user", "other", "read_only", "thread", "none"]);
const common = { label: text, request_id: requestIdDto, token: tokenName,
  status: z.union([z.literal(200), z.literal(400), z.literal(401), z.literal(403), z.literal(404), z.literal(409), z.literal(503)]),
  expected_code: z.string().regex(/^[A-Z0-9_]{1,100}$/).nullable(), replay: z.boolean(), concurrent: z.boolean() };
// Production determines IDs, instants and token bytes. Every other original
// field is independently prepared, then ALL fields are compared with the
// actual original service against SELECTed state and the explicit authority.
const staticPreflight = z.strictObject({ ...workflowPreflightDto.shape }).omit({ workflow_preflight_id: true,
  expires_at: true, created_at: true, preflight_token: true, deck_runtime_snapshot_id: true });
const executeCase = z.strictObject({ ...common, operation: z.literal("workflow-preflight.execute"), input: z.json(),
  expected: z.strictObject({ request_state: z.enum(["committed", "in_progress"]), preflight: staticPreflight }).nullable(),
  expected_execution_owner: z.boolean().nullable(), expected_stage_count: z.number().int().nonnegative().nullable() });
const readCase = z.strictObject({ ...common, operation: z.literal("workflow-preflight.read"), input: z.json(),
  expected: workflowPreflightReadOutputDto.nullable(), raw_input_json: z.string().nullable(),
  expiry_fact: z.enum(["active_unconsumed", "expired_unconsumed"]).nullable().default(null) });
const caseDto = z.discriminatedUnion("operation", [executeCase, readCase]);
export const workflowPreflightFixtureDto = z.strictObject({ database: text, port: z.number().int().positive(), data_directory: text,
  target_verification_url: text, issuer: text, service_id: text, service_secret: text, user_subject: text,
  canonical_user_id: decimalIdDto, source_root: text, oracle_python: text,
  tokens: z.strictObject({ user: text, other: text, read_only: text, thread: text }), cases: z.array(caseDto).min(1).max(100),
  validation_scope: z.enum(["complete", "remaining_reads"]).default("complete") });

const fixturePath = process.env.INK_AUTH_WORKFLOW_PREFLIGHT_FIXTURE;
assert(fixturePath, "Primary-prepared private isolated fixture required");
const file = await stat(fixturePath);
assert((file.mode & 0o777) === 0o600 && file.isFile() && file.uid === process.getuid?.(), "Private owned fixture file required");
let raw: unknown;
try { raw = JSON.parse(await readFile(fixturePath, "utf8")); } catch { throw new Error("Invalid private fixture JSON"); }
const parsed = workflowPreflightFixtureDto.safeParse(raw);
assert(parsed.success, "Invalid strict private fixture configuration");
const f = parsed.data;
assert(f.database.startsWith("ink_auth_data_codex_test_") && f.database.endsWith("_preflight61") && f.port !== 5433 &&
  f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"), "Explicit new disposable Preflight target required");
assert(new Set(f.cases.map(item => `${item.operation}/${item.request_id}`)).size === f.cases.length, "Distinct original cases required");
if (f.validation_scope === "complete") {
  assert(["workflow-preflight.read", "workflow-preflight.execute"].every(name => f.cases.some(item => item.operation === name && item.status === 200)), "Both public operations require success cases");
  assert(f.cases.some(item => item.status !== 200) && f.cases.some(item => item.operation === "workflow-preflight.execute" && item.replay) &&
    f.cases.some(item => item.operation === "workflow-preflight.execute" && item.concurrent), "Failure, original replay and concurrency cases required");
} else {
  assert(f.cases.every(item => item.operation === "workflow-preflight.read"), "Remaining-read validation may never repeat execution operations");
  for (const fact of ["active_unconsumed", "expired_unconsumed"] as const) {
    assert(f.cases.filter(item => item.operation === "workflow-preflight.read" && item.expiry_fact === fact).length === 1, "Exactly one explicitly marked required read fact of each expiry kind required");
    assert(f.cases.some(item => item.operation === "workflow-preflight.read" && item.expiry_fact === fact && item.status === 200 &&
      item.expected?.preflight.status === "passed" && (item.expected.preflight.preflight_token !== null) === (fact === "active_unconsumed")), "Required markers must retain their independent full passed/token expectations");
  }
}
for (const item of f.cases) {
  if (item.operation === "workflow-preflight.read" && item.expiry_fact !== null) assert(f.validation_scope === "remaining_reads", "Required read markers belong only to the explicit remaining-read scope");
  assert((item.status === 200) === (item.expected !== null), "Prepared success and failure expectations must match the actual status contract");
  assert(!(item.replay || item.concurrent) || (item.operation === "workflow-preflight.execute" && item.status === 200), "Replay/concurrency only belongs to successful original execution cases");
  if (item.operation === "workflow-preflight.execute" && item.status === 200) {
    assert(item.token === "user" && item.expected_execution_owner !== null && item.expected_stage_count !== null, "Positive execution requires explicit canonical actor and every retained stage fact");
  }
}
const secret = process.env.INK_WORKFLOW_TOKEN_SECRET;
assert(secret && Buffer.byteLength(secret, "utf8") >= 32, "Explicit original token authority required");
for (const name of ["INK_DECK_HOST_COMPATIBLE", "INK_CLAUDE_AGENT_CONTRACT_COMPATIBLE", "INK_STORY_SCHEMA_COMPATIBLE", "INK_DECK_RUNTIME_CONFIG_COMPATIBLE"]) {
  assert(process.env[name] === "true", "Explicit positive runtime capabilities required; primary verifies faults separately");
}
function targetDsn(value: string | undefined) {
  assert(value, "Explicit target credential required");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid target credential"); }
  assert(["postgres:", "postgresql:"].includes(url.protocol) && url.username && url.password &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && Number(url.port) === f.port &&
    decodeURIComponent(url.pathname.slice(1)) === f.database, "Every credential must identify the same new named loopback target");
  return value;
}
const globals = globalThis as typeof globalThis & { __ink_auth_pool?: { end(): Promise<void> }; __ink_dream_data_pool?: { end(): Promise<void> } };
assert(!globals.__ink_auth_pool && !globals.__ink_dream_data_pool, "Harness must own newly created process pools");
const verification = new Client({ connectionString: targetDsn(f.target_verification_url) });
await verification.connect();
const actualClients: Client[] = [];
let assertions = 0;
const equal = (left: unknown, right: unknown, message: string) => { assert(isDeepStrictEqual(left, right), message); assertions++; };
const check = (value: unknown, message: string) => { assert(value, message); assertions++; };
const origin = f.issuer.replace(/\/api\/auth$/, "");
function headers(token: string, requestId: string) { return { authorization: `Bearer ${token}`, "content-type": "application/json",
  "x-request-id": requestId, "x-ink-dream-service": f.service_id, "x-ink-dream-credential": f.service_secret }; }
async function state() {
  const result = await verification.query("SELECT (SELECT jsonb_agg(to_jsonb(p) ORDER BY workflow_preflight_id) FROM public.workflow_preflights p) AS preflights,(SELECT jsonb_agg(to_jsonb(m) ORDER BY service_client_id,actor,request_id) FROM dream.workflow_preflight_requests m) AS mappings,(SELECT count(*)::int FROM dream.operation_receipts) AS receipts,(SELECT count(*)::int FROM public.admin_audit_logs) AS audits,(SELECT count(*)::int FROM public.workflow_runs) AS runs,(SELECT count(*)::int FROM public.agent_sessions) AS sessions");
  return result.rows[0];
}
async function requestCounts(requestId: string) {
  return (await verification.query("SELECT (SELECT count(*)::int FROM dream.workflow_preflight_requests WHERE service_client_id=$1 AND request_id=$2) AS mappings,(SELECT count(*)::int FROM dream.operation_receipts WHERE service_client_id=$1 AND operation='workflow-preflight.execute' AND request_id=$2) AS receipts,(SELECT count(*)::int FROM public.admin_audit_logs WHERE action='dream.workflow-preflight.execute' AND request_id=$2) AS audits,(SELECT count(*)::int FROM public.admin_audit_logs WHERE action='dream.workflow-preflight.stage' AND request_id=$2) AS stages", [f.service_id, requestId])).rows[0] as { mappings: number; receipts: number; audits: number; stages: number };
}
async function call(item: z.infer<typeof caseDto>, input: unknown = item.input, status: number = item.status, requestId = item.request_id) {
  const response = await operationRoute(new Request(`${origin}/api/internal/dream/v1/operations/${item.operation}`, { method: "POST",
    headers: headers(item.token === "none" ? "" : f.tokens[item.token], requestId), body: JSON.stringify({ request_id: requestId, input }) }),
  { params: Promise.resolve({ operation: item.operation }) });
  const body = await response.json();
  const code = typeof body.error?.code === "string" && /^[A-Z0-9_]{1,100}$/.test(body.error.code) ? body.error.code : "NO_PUBLIC_ERROR_CODE";
  equal(response.status, status, `Unexpected public status (${code})`);
  equal(body.request_id, requestId, "Original request correlation required");
  if (status === item.status && item.expected_code !== null) equal(code, item.expected_code, "Original safe failure code required");
  if (status !== 200) return null;
  const dto = item.operation === "workflow-preflight.execute" ? workflowPreflightExecutionOutputDto : workflowPreflightReadOutputDto;
  const output = dto.safeParse(body.data);
  assert(output.success, "Strict complete public Preflight projection required"); assertions++;
  return output.data;
}
async function originalReceipt(requestId: string, token: string, status = 200) {
  const response = await receiptRoute(new Request(`${origin}/api/internal/dream/v1/receipts/${requestId}?operation=workflow-preflight.execute`,
    { headers: headers(token, requestId) }), { params: Promise.resolve({ requestId }) });
  const body = await response.json(); equal(response.status, status, "Original receipt must enforce OAuth scope and canonical ownership");
  equal(body.request_id, requestId, "Original receipt correlation required");
  if (status !== 200) return null;
  const result = workflowPreflightOriginalReceiptDto.safeParse(body.data);
  assert(result.success, "Strict absent/in-progress/committed original receipt required"); assertions++;
  return result.data;
}
async function sourceProjection(preflight: z.output<typeof workflowPreflightDto>, mode: "read" | "execute", rawInput: string | null) {
  const rows = await verification.query("SELECT p.*,p.expires_at::text AS expires_at,p.created_at::text AS created_at,p.updated_at::text AS updated_at,p.consumed_at::text AS consumed_at,clock_timestamp()::text AS clock FROM public.workflow_preflights p WHERE p.workflow_preflight_id=$1 AND p.created_by=$2", [preflight.workflow_preflight_id, preflight.created_by]);
  check(rows.rows.length === 1, "Exact canonical Preflight row required");
  const row = rows.rows[0];
  const payload = JSON.stringify({ action: "preflight-projection", mode, row, raw_input_json: rawInput, secret, clock: row.clock });
  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(f.oracle_python, ["-B", fileURLToPath(new URL("./deckPluginMetadataOracle.py", import.meta.url))],
      { env: { ...process.env, INK_DREAM_SOURCE: f.source_root }, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8"); child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.resume(); // Original exception may contain private facts; never publish it.
    child.on("error", () => reject(new Error("Original source oracle could not start")));
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error("Original source oracle harness failed")));
    child.stdin.on("error", () => reject(new Error("Original source oracle input failed")));
    child.stdin.end(payload);
  });
  let source: unknown;
  try { source = JSON.parse(stdout); } catch { throw new Error("Original source oracle returned invalid JSON"); }
  const expected = z.strictObject({ preflight: workflowPreflightDto, input_hash: text.nullable(), fingerprint: text }).safeParse(source);
  assert(expected.success, "Original complete source projection required"); assertions++;
  equal(preflight, expected.data.preflight, "Every original Preflight field, UTC microsecond and token byte must match actual source");
  if (rawInput !== null) equal(row.input_hash, expected.data.input_hash, "Raw input hash must match actual original canonical JSON");
  equal(row.request_fingerprint, expected.data.fingerprint, "Stored fingerprint must match actual original source");
  if (preflight.deck_runtime_snapshot_id !== null) {
    const snapshot = (await verification.query("SELECT deck_id,binding_revision,deck_runtime_profile_id,sanitized_summary_hash FROM public.deck_runtime_snapshots WHERE deck_runtime_snapshot_id=$1", [preflight.deck_runtime_snapshot_id])).rows[0];
    equal(snapshot, { deck_id: preflight.deck_id, binding_revision: preflight.binding_revision,
      deck_runtime_profile_id: preflight.deck_runtime_profile_id, sanitized_summary_hash: preflight.deck_runtime_snapshot_summary_hash }, "Immutable snapshot reference and sanitized summary must match stored owner facts");
  }
  return row;
}
try {
  equal((await verification.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_setting('data_directory') AS root")).rows[0],
    { name: f.database, port: f.port, root: f.data_directory }, "Explicit owner target identity required");
  for (const value of [process.env.AUTH_DATABASE_URL, process.env.DREAM_DATA_DATABASE_URL]) {
    const client = new Client({ connectionString: targetDsn(value) }); actualClients.push(client); await client.connect();
    const actual = (await client.query("SELECT current_database() AS name,current_setting('port')::int AS port,r.rolsuper AS superuser FROM pg_roles r WHERE r.rolname=current_user")).rows[0];
    equal(actual, { name: f.database, port: f.port, superuser: false }, "Each actual application credential must use the named target and restricted role");
  }
  for (const item of f.cases) {
    const before = await state();
    const responses = item.concurrent ? await Promise.all([call(item), call(item)]) : [await call(item)];
    if (item.status !== 200) {
      equal(await state(), before, "Rejected ingress must preserve all Preflight, receipt, audit and Run/Session facts");
      continue;
    }
    if (item.operation === "workflow-preflight.read") {
      const result = workflowPreflightReadOutputDto.parse(responses[0]); equal(result, item.expected, "Full original prepared read projection required");
      const stored = await sourceProjection(result.preflight, "read", item.raw_input_json);
      if (item.expiry_fact !== null) {
        check(stored.consumed_at === null, "Remaining active/expired read facts must both be unconsumed");
        const active = workflowTimestampMicros(projectWorkflowTimestamp(stored.expires_at)!) > workflowTimestampMicros(projectWorkflowTimestamp(stored.clock)!);
        check(active === (item.expiry_fact === "active_unconsumed"), "Marked required expiry fact must match the actual current database clock");
        check((result.preflight.preflight_token !== null) === active, "Original token projection must match actual expiry and current database clock");
      }
      equal(await state(), before, "Read and expired-token projection must never mutate persisted state");
      continue;
    }
    const values = responses.map(value => workflowPreflightExecutionOutputDto.parse(value));
    const result = values.find(value => value.request_state === "committed") ?? values[0];
    const dynamicFields = new Set(["workflow_preflight_id", "expires_at", "created_at", "preflight_token", "deck_runtime_snapshot_id"]);
    const staticResult = { request_state: result.request_state, preflight: staticPreflight.parse(Object.fromEntries(Object.entries(result.preflight).filter(([key]) => !dynamicFields.has(key)))) };
    const safeLabel = /^[A-Za-z0-9_.-]{1,100}$/.test(item.label) ? item.label : "PRIVATE_CASE";
    equal(staticResult, item.expected, `Every independently prepared static field and original request state required (${safeLabel})`);
    for (const value of values) {
      if (value.request_state === "committed") equal(value, result, "Concurrent committed result must retain every original field and token byte");
      else { check(value.preflight.status === "checking" && value.preflight.preflight_token === null, "In-progress evidence cannot issue token or manufacture final receipt");
        equal(value.preflight.workflow_preflight_id, result.preflight.workflow_preflight_id, "Concurrent original calls must share one Preflight"); }
    }
    const input = workflowPreflightExecutionInputDto.parse(item.input);
    await sourceProjection(result.preflight, "execute", input.input_json);
    const mapping = (await verification.query("SELECT actor,canonical_user_id::text AS canonical_user_id,workspace_id,input_sha256,workflow_preflight_id,execution_owner FROM dream.workflow_preflight_requests WHERE service_client_id=$1 AND request_id=$2", [f.service_id, item.request_id])).rows;
    equal(mapping, [{ actor: f.user_subject, canonical_user_id: f.canonical_user_id, workspace_id: input.workspace_id,
      input_sha256: operationInputDigest(input), workflow_preflight_id: result.preflight.workflow_preflight_id,
      execution_owner: item.expected_execution_owner }], "Exactly one immutable original request must bind canonical owner, input and execution ownership");
    const counts = await requestCounts(item.request_id);
    equal({ mappings: counts.mappings, receipts: counts.receipts, audits: counts.audits },
      { mappings: 1, receipts: result.request_state === "committed" ? 1 : 0, audits: result.request_state === "committed" ? 1 : 0 }, "Final result and audit must commit atomically; checking is separate evidence");
    if (item.expected_stage_count !== null) equal(counts.stages, item.expected_stage_count, "Actual retained stage commits must match the prepared original boundary facts");
    const receipt = await originalReceipt(item.request_id, f.tokens.user);
    check(receipt?.status === result.request_state, "Original receipt must report the actual original request state");
    if (receipt && receipt.status !== "absent") equal(receipt.result, result, "Original recovery must retain the full bounded response");
    if (result.request_state === "committed") {
      const stored = (await verification.query("SELECT result FROM dream.operation_receipts WHERE service_client_id=$1 AND actor=$2 AND operation='workflow-preflight.execute' AND request_id=$3", [f.service_id, f.user_subject, item.request_id])).rows[0]?.result;
      check(stored?.schema_version === 1 && stored.data?.format === "workflow-preflight/v1" && typeof stored.data?.ciphertext === "string" &&
        Object.keys(stored.data).length === 2 && (result.preflight.preflight_token === null || !JSON.stringify(stored).includes(result.preflight.preflight_token)), "Original full result must be stored only in the bound encrypted wrapper");
    }
    const after = await state();
    equal({ runs: after.runs, sessions: after.sessions }, { runs: before.runs, sessions: before.sessions }, "Preflight never creates a pseudo Run or starts Session");
    if (item.replay) {
      const replayed = await call(item); equal(replayed, result, "Original replay must preserve IDs, instants, status and exact token");
      equal(await state(), after, "Original replay cannot rerun stages, refresh expiry or append audit");
      await call(item, { ...input, input_json: `${input.input_json} ` }, 409);
      equal(await state(), after, "Conflicting original raw request cannot change any business state");
    }
  }
  if (f.validation_scope === "complete") {
    const success = f.cases.find(item => item.operation === "workflow-preflight.execute" && item.status === 200);
    assert(success, "A successful original request required");
    const beforeDenied = await state();
    equal((await originalReceipt(success.request_id, f.tokens.other))?.status, "absent", "Other canonical actor cannot obtain an original result");
    await originalReceipt(success.request_id, f.tokens.read_only, 403); await originalReceipt(success.request_id, f.tokens.thread, 403);
    await call(success, { ...workflowPreflightExecutionInputDto.parse(success.input), actor_id: f.canonical_user_id }, 400, `${success.request_id}.invalid`);
    equal(await state(), beforeDenied, "Receipt permission and forbidden actor selectors cannot mutate state");
  }
  console.log(JSON.stringify({ result: "PASS", validation_scope: f.validation_scope, operations: f.validation_scope === "complete" ? 2 : 1, cases: f.cases.length, assertions,
    fixture: "provider-free-isolated-restricted-roles", source: "actual PreflightService full projection/raw input/fingerprint/pft bytes",
    semantics: f.validation_scope === "complete" ? "retained stages; three original states; encrypted bounded result; concurrent/replay/owner/scope; no Run/Session"
      : "remaining reads only; independent active/expired unconsumed facts; full original projection; actual clock; no writes or repeated execution" }));
} finally {
  await Promise.allSettled(actualClients.map(client => client.end()));
  await verification.end(); await globals.__ink_auth_pool?.end(); await globals.__ink_dream_data_pool?.end();
}
