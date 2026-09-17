// [Input] Primary-prepared disposable PostgreSQL facts, limited auth/data roles and fresh scoped proofs.
// [Output] Actual production Workflow context/user-turn/receipt/delegation Route evidence.
// [Pos] Provider-free non-destructive contract harness; primary alone prepares or faults owned fixtures.
// [Sync] 2026-09-17: require delegated user OAuth plus a short-lived client_credentials service access token.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { z } from "zod";
import { Client } from "pg";
import { POST as operation } from "../../app/api/internal/dream/v1/operations/[operation]/route";
import { POST as createDelegation } from "../../app/api/internal/dream/v1/runtime-delegations/route";
import { GET as receiptRoute } from "../../app/api/internal/dream/v1/receipts/[requestId]/route";
import { workflowContextOutputDto } from "../../app/lib/dream/workflowContextDto";
import { userMessageInputDto, userMessageOutputDto } from "../../app/lib/dream/userMessageDto";
import { chatThreadOperationContracts } from "../../app/lib/dream/chatThreadDto";
import { delegationOutputDto } from "../../app/lib/auth/delegationDto";

const nonempty = z.string().min(1);
const fixtureDto = z.strictObject({
  database: nonempty, port: z.number().int().positive(), data_directory: nonempty, target_verification_url: nonempty,
  issuer: nonempty, service_id: nonempty, service_access_token: nonempty, access_token: nonempty, other_access_token: nonempty,
  ordinary_thread_id: nonempty, untitled_thread_id: nonempty, terminal_thread_id: nonempty,
  split_thread_id: nonempty, split_message_id: nonempty,
  active_thread_id: nonempty, active_run_id: nonempty, terminal_run_id: nonempty, terminal_existing_grant: nonempty,
  context_cases: z.array(z.strictObject({ label: nonempty, thread_id: nonempty, status: z.union([z.literal(200), z.literal(409)]), expected: workflowContextOutputDto.nullable() })).min(1),
  confirmation_cases: z.array(z.strictObject({ label: nonempty, status: z.union([z.literal(200), z.literal(409)]), input: userMessageInputDto, generic_status: z.union([z.literal(200), z.literal(409)]), expect_preserved: z.boolean() })).min(1),
});
const path = process.env.INK_AUTH_WORKFLOW_USER_FIXTURE;
assert(path, "Primary-prepared private isolated fixture required");
assert.equal((await stat(path)).mode & 0o777, 0o600, "Private fixture mode required");
let rawFixture: unknown;
try { rawFixture = JSON.parse(await readFile(path, "utf8")); } catch { throw new Error("Invalid private fixture configuration"); }
const parsedFixture = fixtureDto.safeParse(rawFixture);
assert(parsedFixture.success, "Invalid strict private fixture configuration");
const f = parsedFixture.data;
assert(f.database.startsWith("ink_auth_data_codex_test_") && f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"), "Explicit disposable target required");
let dsn: URL;
try { dsn = new URL(f.target_verification_url); } catch { throw new Error("Explicit PostgreSQL verification credential required"); }
assert(["postgres:", "postgresql:"].includes(dsn.protocol) && dsn.username && decodeURIComponent(dsn.pathname.slice(1)) === f.database, "Explicit named PostgreSQL credential required");
const verification = new Client({ connectionString: f.target_verification_url });
await verification.connect();
const proof = await verification.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_setting('data_directory') AS root");
assert.deepEqual(proof.rows[0], { name: f.database, port: f.port, root: f.data_directory });
const origin = f.issuer.replace(/\/api\/auth$/, "");
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
let assertions = 0;
function headers(token: string, requestId: string) { return { authorization: `Bearer ${token}`, "content-type": "application/json", "x-request-id": requestId, "x-ink-dream-service-authorization": `Bearer ${f.service_access_token}` }; }
async function checked(response: Response, status: number, requestId: string) {
  const body = await response.json();
  const code = typeof body.error?.code === "string" && /^[A-Z0-9_]{1,100}$/.test(body.error.code) ? body.error.code : "NO_PUBLIC_ERROR_CODE";
  assert.equal(response.status, status, `Unexpected public status (${code})`); assert.equal(body.request_id, requestId); assertions += 2;
  return body.data;
}
async function call(name: string, input: unknown, options: { status?: number; requestId?: string; token?: string } = {}) {
  const requestId = options.requestId ?? id("workflow_user");
  return checked(await operation(new Request(`${origin}/api/internal/dream/v1/operations/${name}`, { method: "POST", headers: headers(options.token ?? f.access_token, requestId), body: JSON.stringify({ request_id: requestId, input }) }), { params: Promise.resolve({ operation: name }) }), options.status ?? 200, requestId);
}
async function currentMessage(messageId: string) {
  const result = await verification.query("SELECT m.id,m.thread_id,m.role,m.parts,m.metadata,m.created_at::text, t.title,t.updated_at::text AS thread_updated FROM public.chat_message m JOIN public.chat_thread t ON t.id=m.thread_id WHERE m.id=$1", [messageId]);
  return result.rows[0] ?? null;
}
async function grant(threadId: string, runId: string | null, status: number) {
  const requestId = id("workflow_grant");
  const result = await checked(await createDelegation(new Request(`${origin}/api/internal/dream/v1/runtime-delegations`, { method: "POST", headers: headers(f.access_token, requestId), body: JSON.stringify({ request_id: requestId, input: { purpose: "server-persistence", thread_id: threadId, run_id: runId, editor_session_id: null, scopes: ["dream:read", "dream:write"] } }) })), status, requestId);
  if (status === 200) delegationOutputDto.parse(result);
}
try {
  for (const item of f.context_cases) {
    const result = await call("workflow-context.resolve", { thread_id: item.thread_id }, { status: item.status });
    if (item.status === 200) { assert.deepEqual(workflowContextOutputDto.parse(result), item.expected, "Stored Workflow facts must determine context"); assertions++; }
  }
  await call("workflow-context.resolve", { thread_id: f.active_thread_id, run_id: f.active_run_id }, { status: 400 });
  const foreign = workflowContextOutputDto.parse(await call("workflow-context.resolve", { thread_id: f.active_thread_id }, { token: f.other_access_token }));
  assert.equal(foreign.context, null, "Foreign Thread cannot confer activation authority"); assertions++;
  await grant(f.active_thread_id, null, 403); await grant(f.active_thread_id, f.active_run_id, 200);
  await grant(f.terminal_thread_id, f.terminal_run_id, 403); await grant(f.terminal_thread_id, null, 200);
  const ordinaryInput = { thread_id: f.ordinary_thread_id, message_id: id("raw_user"), parts_json: '[{"type":"text","text":"raw numeric fixture","number":1.0,"counter":9007199254740993}]', metadata_json: null, title_candidate: "retained existing title" };
  const priorTitle = (await verification.query("SELECT title FROM public.chat_thread WHERE id=$1", [f.ordinary_thread_id])).rows[0]?.title;
  assert(typeof priorTitle === "string" && priorTitle.length > 0, "Fixture ordinary Thread must already have a title");
  const requestId = id("raw_write");
  userMessageOutputDto.parse(await call("chat-user-message.persist", ordinaryInput, { requestId }));
  const first = await currentMessage(ordinaryInput.message_id);
  assert(first?.parts.includes('"number":1.0') && first.parts.includes('9007199254740993') && first.metadata === null, "Raw numeric bytes and null must survive PostgreSQL storage"); assertions++;
  assert.equal(first.title, priorTitle, "Ordinary persistence cannot replace existing title"); assertions++;
  await call("chat-user-message.persist", ordinaryInput, { requestId });
  assert(JSON.stringify(await currentMessage(ordinaryInput.message_id)) === JSON.stringify(first), "Committed replay cannot touch message or Thread"); assertions++;
  await call("chat-user-message.persist", { ...ordinaryInput, metadata_json: "{}" }, { requestId, status: 409 });
  await call("chat-user-message.persist", { ...ordinaryInput, parts_json: '[]' }, { status: 409 });
  await call("chat-user-message.persist", { ...ordinaryInput, actor: "external" }, { status: 400 });
  await call("chat-user-message.persist", { ...ordinaryInput, message_id: id("foreign_write") }, { token: f.other_access_token, status: 404 });
  const titleInput = { ...ordinaryInput, thread_id: f.untitled_thread_id, message_id: id("title_write"), title_candidate: "\u001c😀 source title\u001c" };
  await call("chat-user-message.persist", titleInput);
  const titled = await currentMessage(titleInput.message_id);
  assert(titled?.title.startsWith("😀 source title"), "Original Python whitespace and Unicode title semantics required"); assertions++;
  const split = await currentMessage(f.split_message_id);
  assert(split && !split.title && split.role === "user" && split.thread_id === f.split_thread_id, "Primary must prepare the original split-write missing-title fixture");
  await call("chat-user-message.persist", { thread_id: f.split_thread_id, message_id: f.split_message_id, parts_json: split.parts, metadata_json: split.metadata, title_candidate: "recovered title" });
  const recovered = await currentMessage(f.split_message_id);
  assert(recovered?.title === "recovered title" && recovered.parts === split.parts && recovered.metadata === split.metadata && recovered.created_at === split.created_at, "Missing title recovery must preserve immutable message"); assertions++;
  const finalInput = { ...ordinaryInput, thread_id: f.terminal_thread_id, message_id: id("terminal_final") };
  await call("chat-user-message.persist", finalInput, { token: f.terminal_existing_grant });
  assert((await currentMessage(finalInput.message_id))?.id === finalInput.message_id, "Existing entity grant must allow final persistence after terminal status"); assertions++;
  for (const item of f.confirmation_cases) {
    const before = await currentMessage(item.input.message_id);
    const result = await call("chat-user-message.persist", item.input, { status: item.status });
    if (item.status === 200) { assert.equal(userMessageOutputDto.parse(result).confirmation_preserved, item.expect_preserved); assertions++; }
    assert(JSON.stringify(await currentMessage(item.input.message_id)) === JSON.stringify(before), "Confirmation snapshot must never overwrite durable claim or Thread timestamp"); assertions++;
    const generic = { thread_id: item.input.thread_id, message_id: item.input.message_id, role: "user", parts: JSON.parse(item.input.parts_json), metadata: item.input.metadata_json === null ? null : JSON.parse(item.input.metadata_json), history_final_text: null, history_process_available: false, history_projection_version: null };
    const genericResult = await call("chat-message.persist", generic, { status: item.generic_status });
    if (item.generic_status === 200) chatThreadOperationContracts["chat-message.persist"].output.parse(genericResult);
    assert(JSON.stringify(await currentMessage(item.input.message_id)) === JSON.stringify(before), "Generic user persist must also guard stored controls"); assertions++;
  }
  const recoveryRequest = new Request(`${origin}/api/internal/dream/v1/receipts/${requestId}?operation=chat-user-message.persist`, { headers: headers(f.access_token, requestId) });
  const recovery = await checked(await receiptRoute(recoveryRequest, { params: Promise.resolve({ requestId }) }), 200, requestId);
  assert(recovery.status === "committed" && userMessageOutputDto.safeParse(recovery.result).success); assertions++;
  const receiptCount = await verification.query("SELECT count(*)::int AS count FROM dream.operation_receipts WHERE operation='chat-user-message.persist' AND request_id=$1", [requestId]);
  const auditCount = await verification.query("SELECT count(*)::int AS count FROM public.admin_audit_logs WHERE action='dream.chat-user-message.persist' AND request_id=$1", [requestId]);
  assert.equal(receiptCount.rows[0].count, 1); assert.equal(auditCount.rows[0].count, 1); assertions += 2;
  console.log(JSON.stringify({ result: "PASS", operations: ["workflow-context.resolve", "chat-user-message.persist", "chat-message.persist", "runtime-delegation.create", "receipt.read"], context_cases: f.context_cases.length, confirmation_cases: f.confirmation_cases.length, assertions, fixture: "provider-free-isolated-restricted-roles" }));
} finally {
  await verification.end();
  const global = globalThis as typeof globalThis & { __ink_auth_pool?: { end(): Promise<void> }; __ink_dream_data_pool?: { end(): Promise<void> } };
  await global.__ink_auth_pool?.end(); await global.__ink_dream_data_pool?.end();
}
