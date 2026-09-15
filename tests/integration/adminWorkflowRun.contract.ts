// [Input] Primary-prepared named disposable PG, restricted auth/data roles and fresh OAuth/original Run grants.
// [Output] Actual Run read/history/start/fail/cancel Route and atomic scope/replay/receipt evidence.
// [Pos] Provider-free public-contract harness; verification credential only SELECTs owned fixture state.
// [Sync] 2026-09-15: keep Runtime fixture/fault creation with the primary and exact lifecycle expectations private.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { Client } from "pg";
import { z } from "zod";
import { POST as operationRoute } from "../../app/api/internal/dream/v1/operations/[operation]/route";
import { GET as receiptRoute } from "../../app/api/internal/dream/v1/receipts/[requestId]/route";
import { requestIdDto } from "../../app/lib/auth/dto";
import { workflowRunDto, workflowRunLookupInputDto, workflowRunReadOutputDto, workflowRunHistoryOutputDto, workflowRunOperationContracts } from "../../app/lib/dream/workflowRunDto";
import { projectWorkflowTimestamp } from "../../app/lib/dream/workflowRunService";
import { workflowTimeDto } from "../../app/lib/dream/workflowRunDto";
import { workflowRunCommandOperationContracts } from "../../app/lib/dream/workflowRunCommandDto";

const text = z.string().min(1);
const statusDto = z.union([z.literal(200), z.literal(400), z.literal(401), z.literal(403), z.literal(404), z.literal(409), z.literal(503)]);
const tokenName = z.enum(["user", "other", "run", "other_run"]);
const common = { label: text, request_id: requestIdDto, token: tokenName, status: statusDto,
  expected_code: z.string().regex(/^[A-Z0-9_]{1,100}$/).nullable(), replay: z.boolean(), concurrent: z.boolean() };
const readCase = z.strictObject({ ...common, operation: z.literal("workflow-run.read"), input: workflowRunLookupInputDto, expected: workflowRunReadOutputDto.nullable() });
const historyCase = z.strictObject({ ...common, operation: z.literal("workflow-run.history"), input: workflowRunLookupInputDto, expected: workflowRunHistoryOutputDto.nullable() });
// Command clock values are determined by the production transaction. Compare
// all static original fields and verify those two exact instants against PG;
// a fixture must never dictate application time through a hidden test path.
const commandExpectation = z.strictObject({ run: z.strictObject({ ...workflowRunDto.shape }).omit({ started_at: true, completed_at: true }) });
const startCase = z.strictObject({ ...common, operation: z.literal("workflow-run.start"), input: workflowRunCommandOperationContracts["workflow-run.start"].input, expected: commandExpectation.nullable() });
const failCase = z.strictObject({ ...common, operation: z.literal("workflow-run.fail"), input: workflowRunCommandOperationContracts["workflow-run.fail"].input, expected: commandExpectation.nullable() });
const cancelCase = z.strictObject({ ...common, operation: z.literal("workflow-run.cancel"), input: workflowRunCommandOperationContracts["workflow-run.cancel"].input, expected: commandExpectation.nullable() });
const caseDto = z.discriminatedUnion("operation", [readCase, historyCase, startCase, failCase, cancelCase]);
const fixtureDto = z.strictObject({ database: text, port: z.number().int().positive(), data_directory: text, target_verification_url: text,
  issuer: text, service_id: text, service_secret: text, tokens: z.strictObject({ user: text, other: text, run: text, other_run: text }),
  cases: z.array(caseDto).min(1), receipt_request_id: requestIdDto, receipt_operation: z.enum(["workflow-run.start", "workflow-run.fail", "workflow-run.cancel"]),
});
const path = process.env.INK_AUTH_WORKFLOW_RUN_FIXTURE;
assert(path, "Primary-prepared private isolated fixture required");
assert.equal((await stat(path)).mode & 0o777, 0o600, "Private fixture mode required");
let raw: unknown;
try { raw = JSON.parse(await readFile(path, "utf8")); } catch { throw new Error("Invalid private fixture configuration"); }
const parsed = fixtureDto.safeParse(raw); assert(parsed.success, "Invalid strict private fixture configuration");
const f = parsed.data;
assert(f.database.startsWith("ink_auth_data_codex_test_") && f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"), "Explicit disposable target required");
let dsn: URL;
try { dsn = new URL(f.target_verification_url); } catch { throw new Error("Explicit PostgreSQL verification credential required"); }
assert(["postgres:", "postgresql:"].includes(dsn.protocol) && dsn.username && decodeURIComponent(dsn.pathname.slice(1)) === f.database, "Explicit named PostgreSQL credential required");
assert(new Set(f.cases.map(item => `${item.operation}/${item.request_id}`)).size === f.cases.length, "Distinct original cases required; replay uses the same prepared case");
const expectedOperations = [...Object.keys(workflowRunOperationContracts), ...Object.keys(workflowRunCommandOperationContracts)];
assert(expectedOperations.every(name => f.cases.some(item => item.operation === name && item.status === 200)), "Every implemented Run operation requires a successful public case");
assert(f.cases.some(item => item.status !== 200), "A failing public case is required");
const verification = new Client({ connectionString: f.target_verification_url }); await verification.connect();
const proof = await verification.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_setting('data_directory') AS root");
assert(JSON.stringify(proof.rows[0]) === JSON.stringify({ name: f.database, port: f.port, root: f.data_directory }), "Disposable target proof must match");
const origin = f.issuer.replace(/\/api\/auth$/, "");
let assertions = 0;
const committedResults = new Map<string, unknown>();
const equal = (left: unknown, right: unknown, message: string) => {
  const matches = JSON.stringify(left) === JSON.stringify(right);
  if (!matches) {
    const fields: string[] = [], times: Array<{ field: string; left_type: string; right_type: string; left?: string | null; right?: string | null }> = [];
    const walk = (a: unknown, b: unknown, path: string) => {
      if (isDeepStrictEqual(a, b)) return;
      if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) if (/^[A-Za-z0-9_]+$/.test(key)) walk((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`);
      } else {
        fields.push(path);
        if (/(?:_at|source_message_time|occurred_at)$/.test(path)) times.push({ field: path, left_type: a === null ? "null" : typeof a, right_type: b === null ? "null" : typeof b,
          ...(a === null || workflowTimeDto.safeParse(a).success ? { left: a as string | null } : {}), ...(b === null || workflowTimeDto.safeParse(b).success ? { right: b as string | null } : {}) });
      }
    };
    walk(left, right, "result");
    console.log(JSON.stringify({ diagnostic: "run-contract-comparison", fields, times, key_order_only: isDeepStrictEqual(left, right) }));
  }
  assert(matches, message); assertions++;
};
function headers(token: string, requestId: string) { return { authorization: `Bearer ${token}`, "content-type": "application/json", "x-request-id": requestId,
  "x-ink-dream-service": f.service_id, "x-ink-dream-credential": f.service_secret }; }
async function call(item: z.infer<typeof caseDto>, input: unknown = item.input, expectedStatus: number = item.status, requestId = item.request_id) {
  const response = await operationRoute(new Request(`${origin}/api/internal/dream/v1/operations/${item.operation}`, { method: "POST", headers: headers(f.tokens[item.token], requestId),
    body: JSON.stringify({ request_id: requestId, input }) }), { params: Promise.resolve({ operation: item.operation }) });
  const body = await response.json();
  const code = typeof body.error?.code === "string" && /^[A-Z0-9_]{1,100}$/.test(body.error.code) ? body.error.code : "NO_PUBLIC_ERROR_CODE";
  assert.equal(response.status, expectedStatus, `Unexpected public status (${code})`); assert.equal(body.request_id, requestId); assertions += 2;
  if (expectedStatus === item.status && item.expected_code !== null) { assert.equal(code, item.expected_code); assertions++; }
  if (expectedStatus === 200) {
    const output = item.operation === "workflow-run.history" ? workflowRunHistoryOutputDto.parse(body.data) : workflowRunReadOutputDto.parse(body.data);
    if (Object.hasOwn(workflowRunCommandOperationContracts, item.operation)) {
      const result = workflowRunReadOutputDto.parse(output);
      equal(commandExpectation.parse({ run: Object.fromEntries(Object.entries(result.run).filter(([key]) => key !== "started_at" && key !== "completed_at")) }), item.expected, "Authoritative Run must match every static original lifecycle field");
      const key = `${item.operation}/${item.request_id}`;
      if (committedResults.has(key)) equal(output, committedResults.get(key), "Concurrent/original replay must retain the exact committed timestamps and full result");
      else committedResults.set(key, output);
    } else equal(output, item.expected, "Authoritative full Run/history must match the original prepared lifecycle expectation");
  }
  return body;
}
async function snapshot(runId: string) {
  const runs = await verification.query("SELECT to_jsonb(r) AS value FROM public.workflow_runs r WHERE r.id=$1", [runId]);
  const history = await verification.query("SELECT to_jsonb(t) AS value FROM public.workflow_run_transitions t WHERE t.workflow_run_id=$1 ORDER BY t.transition_seq", [runId]);
  const sessions = await verification.query("SELECT agent_session_id,status,started_at::text,lease_expires_at::text,owner_token IS NULL AS owner_cleared FROM public.agent_sessions WHERE workflow_run_id=$1 ORDER BY agent_session_id", [runId]);
  return { run: runs.rows[0]?.value ?? null, history: history.rows.map(row => row.value), sessions: sessions.rows };
}
async function counts(operation: string, requestId: string) {
  const receipts = await verification.query("SELECT count(*)::int AS value FROM dream.operation_receipts WHERE service_client_id=$1 AND operation=$2 AND request_id=$3", [f.service_id, operation, requestId]);
  const audit = await verification.query("SELECT count(*)::int AS value FROM public.admin_audit_logs WHERE action=$1 AND request_id=$2", [`dream.${operation}`, requestId]);
  return { receipts: receipts.rows[0].value, audit: audit.rows[0].value };
}
try {
  for (const item of f.cases) {
    const before = await snapshot(item.input.workflow_run_id);
    if (item.concurrent) { assert(item.status === 200 && item.operation !== "workflow-run.read" && item.operation !== "workflow-run.history", "Concurrent case must be an implemented successful write"); await Promise.all([call(item), call(item)]); }
    else await call(item);
    const after = await snapshot(item.input.workflow_run_id);
    const write = Object.hasOwn(workflowRunCommandOperationContracts, item.operation);
    if (!write || item.status !== 200) equal(after, before, "Read/rejected command must preserve Run, history and Session state");
    else {
      const target = item.operation === "workflow-run.start" ? "running" : item.operation === "workflow-run.fail" ? "failed" : "cancelled";
      const changed = before.run.status !== target;
      assert.equal(after.history.length, before.history.length + (changed ? 1 : 0));
      assert.equal(after.run.status_version, before.run.status_version + (changed ? 1 : 0)); assertions += 2;
      equal(await counts(item.operation, item.request_id), { receipts: 1, audit: 1 }, "Original write must commit one receipt and one audit");
      const times = (await verification.query("SELECT started_at::text,completed_at::text FROM public.workflow_runs WHERE id=$1", [item.input.workflow_run_id])).rows[0];
      const committed = workflowRunReadOutputDto.parse(committedResults.get(`${item.operation}/${item.request_id}`));
      equal({ started_at: committed.run.started_at, completed_at: committed.run.completed_at },
        { started_at: projectWorkflowTimestamp(times.started_at), completed_at: projectWorkflowTimestamp(times.completed_at) }, "Production command instants must match exact PostgreSQL microseconds");
      if (item.operation === "workflow-run.start" && changed) {
        const session = after.sessions.find(row => row.agent_session_id === item.input.agent_session_id);
        assert(session && session.status === "active" && session.started_at !== null && session.lease_expires_at === null && session.owner_cleared, "Run start must atomically activate and release the original creating Session"); assertions++;
      }
      if (item.replay) {
        await call(item); equal(await snapshot(item.input.workflow_run_id), after, "Original committed replay cannot touch Run, history or Session");
        equal(await counts(item.operation, item.request_id), { receipts: 1, audit: 1 }, "Original replay cannot append receipt/audit");
        await call(item, { ...item.input, reason_code: "conflicting-original-request" }, 409);
        equal(await snapshot(item.input.workflow_run_id), after, "Conflicting original request must roll back every business effect");
      }
    }
    if (write && item.status !== 200) equal(await counts(item.operation, item.request_id), { receipts: 0, audit: 0 }, "Rejected command cannot commit receipt/audit");
  }
  const successful = f.cases.find(item => item.operation === f.receipt_operation && item.request_id === f.receipt_request_id && item.status === 200);
  assert(successful, "Original committed Run receipt case required");
  for (const [token, status] of [["user", 200], ["run", 200], ["other_run", 403]] as const) {
    const request = new Request(`${origin}/api/internal/dream/v1/receipts/${f.receipt_request_id}?operation=${f.receipt_operation}`, { headers: headers(f.tokens[token], f.receipt_request_id) });
    const response = await receiptRoute(request, { params: Promise.resolve({ requestId: f.receipt_request_id }) });
    const body = await response.json(); assert.equal(response.status, status, "Original receipt requires matching canonical actor and exact Run/Thread grant"); assertions++;
    if (status === 200) { assert(body.data.status === "committed", "Original committed receipt required"); equal(workflowRunReadOutputDto.parse(body.data.result), committedResults.get(`${successful.operation}/${successful.request_id}`), "Original receipt must preserve its committed bounded result"); }
  }
  const firstRead = f.cases.find(item => item.operation === "workflow-run.read" && item.status === 200);
  assert(firstRead, "Successful strict lookup case required");
  await call(firstRead, { ...firstRead.input, actor_id: "external-actor" }, 400, `${firstRead.request_id}.invalid`);
  console.log(JSON.stringify({ result: "PASS", operations: expectedOperations, cases: f.cases.length, assertions, fixture: "provider-free-isolated-restricted-roles" }));
} finally {
  await verification.end();
  const globals = globalThis as typeof globalThis & { __ink_auth_pool?: { end(): Promise<void> }; __ink_dream_data_pool?: { end(): Promise<void> } };
  await globals.__ink_auth_pool?.end(); await globals.__ink_dream_data_pool?.end();
}
