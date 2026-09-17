// [Input] Primary-prepared named disposable PostgreSQL and short-lived provider-free fixture credentials.
// [Output] Actual production Route/DTO/ORM/receipt integration assertions, never real Google/model acceptance.
// [Pos] Explicit standalone isolated contract harness; excluded from default app unit discovery.
// [Sync] 2026-09-17: require delegated user OAuth plus a short-lived client_credentials service access token.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { POST } from "../../app/api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../app/api/internal/dream/v1/receipts/[requestId]/route";
import { dreamDataDatabase } from "../../app/lib/dream/database";
import { chat_thread as thread } from "@ink-memory/db/schema/dream";
import { operationReceipts } from "@ink-memory/db/schema/auth";
import { adminAuditLogs } from "@ink-memory/db/schema";
import { chatThreadOperationContracts } from "../../app/lib/dream/chatThreadDto";
const fixturePath = process.env.INK_AUTH_THREAD_FIXTURE;
assert(fixturePath, "Primary-prepared isolated fixture configuration required");
const f = JSON.parse(await readFile(fixturePath, "utf8"));
assert(f.database.startsWith("ink_auth_data_codex_test_") && f.port !== 5433, "Named disposable target required");
const database = dreamDataDatabase();
const verificationClient = f.target_verification_url ? new Client({ connectionString: f.target_verification_url }) : null;
await verificationClient?.connect();
// Ownership/catalog receipt verification is separate from restricted production auth/data pools.
const verificationDatabase = verificationClient ? drizzle(verificationClient) : database;
const proof = await verificationDatabase.execute(sql`SELECT current_database() AS name, current_setting('port')::int AS port, current_setting('data_directory') AS root`);
assert.deepEqual(proof.rows[0], { name: f.database, port: f.port, root: f.data_directory });
let assertions = 0;
const visitedOperations = new Set<string>();
function headers(token = f.access_token, requestId: string) { return { "x-request-id": requestId, "content-type": "application/json", "x-ink-dream-service-authorization": `Bearer ${f.service_access_token}`, authorization: `Bearer ${token}` }; }
async function call(name: keyof typeof chatThreadOperationContracts, input: unknown, options: { token?: string; requestId?: string; status?: number } = {}) {
  const requestId = options.requestId ?? `contract_${randomUUID()}`;
  const response = await POST(new Request(`${f.issuer.replace("/api/auth", "")}/api/internal/dream/v1/operations/${name}`, { method: "POST", headers: headers(options.token, requestId), body: JSON.stringify({ request_id: requestId, input }) }), { params: Promise.resolve({ operation: name }) });
  const result = await response.json();
  const code = typeof result?.error?.code === "string" && /^[A-Z0-9_]{1,100}$/.test(result.error.code) ? result.error.code : "NO_PUBLIC_ERROR_CODE";
  assert.equal(response.status, options.status ?? 200, `${name} unexpected HTTP status (${code})`);
  assert.equal(result.request_id, requestId);
  assertions += 2; visitedOperations.add(name);
  if (response.ok) chatThreadOperationContracts[name].output.parse(result.data);
  return result;
}
async function receipt(operation: string, requestId: string, token = f.access_token) {
  const response = await GET(new Request(`${f.issuer.replace("/api/auth", "")}/api/internal/dream/v1/receipts/${requestId}?operation=${encodeURIComponent(operation)}`, { headers: headers(token, requestId) }), { params: Promise.resolve({ requestId }) });
  assert.equal(response.status, 200); assertions++;
  return (await response.json()).data;
}
try {
  const createRequestId = `create_${randomUUID()}`;
  const createInput = { deck_id: f.deck_id, voice_id: f.voice_id, title: "contract" };
  const created = await call("chat-thread.create", createInput, { requestId: createRequestId });
  const id = created.data.thread_id;
  assert.equal((await call("chat-thread.create", createInput, { requestId: createRequestId })).data.thread_id, id);
  await call("chat-thread.create", { ...createInput, title: "different" }, { requestId: createRequestId, status: 409 });
  assert.equal((await receipt("chat-thread.create", createRequestId)).status, "committed");
  assert.equal((await receipt("chat-thread.create", createRequestId, f.other_access_token)).status, "absent");
  const loaded = (await call("chat-thread.get", { thread_id: id })).data.thread;
  assert.equal(loaded.user_id, "9007199254740993");
  assert.equal((await call("chat-thread.get", { thread_id: id }, { token: f.other_access_token })).data.thread, null);
  await call("chat-message.list", { thread_id: id }, { token: f.other_access_token, status: 404 });
  await call("chat-thread.create", { deck_id: f.other_deck_id, voice_id: null, title: null }, { status: 404 });
  await call("chat-thread.create", { ...createInput, user_id: "1" }, { status: 400 });
  await call("chat-thread.update-title", { thread_id: id, title: "no write" }, { token: f.read_only_token, status: 403 });
  const listed = (await call("chat-thread.list", { deck_id: f.deck_id, limit: null, offset: 0 })).data.threads;
  assert(listed.some((v: { id: string }) => v.id === id));
  assert.equal((await call("chat-thread.list", { deck_id: f.deck_id, limit: 1, offset: 0 }, { token: f.other_access_token })).data.threads.length, 0);
  await call("chat-thread.update-title", { thread_id: id, title: "retitled" });
  assert.equal((await call("chat-thread.get", { thread_id: id })).data.thread.title, "retitled");
  const unbound = (await call("chat-thread.create", { deck_id: null, voice_id: null, title: "unbound" })).data.thread_id;
  await call("chat-thread.bind-deck", { thread_id: unbound, deck_id: f.deck_id }, { token: f.other_access_token, status: 404 });
  assert.equal((await call("chat-thread.bind-deck", { thread_id: unbound, deck_id: f.deck_id })).data.changed, true);
  assert.equal((await call("chat-thread.bind-deck", { thread_id: unbound, deck_id: f.deck_id })).data.changed, true);
  assert.equal((await call("chat-thread.get", { thread_id: unbound })).data.thread.deck_id, f.deck_id);

  const envelope = { thread_id: id, message_id: `message_${randomUUID()}`, role: "user", parts: [{ type: "text", text: "hello" }], metadata: { z: 2, a: 1 }, history_final_text: null, history_process_available: false, history_projection_version: null };
  const persistRequest = `persist_${randomUUID()}`;
  await Promise.all([call("chat-message.persist", envelope, { requestId: persistRequest }), call("chat-message.persist", envelope, { requestId: persistRequest })]);
  const beforeReplay = (await call("chat-thread.get", { thread_id: id })).data.thread.updated_at;
  await call("chat-message.persist", { ...envelope, metadata: { a: 1, z: 2 } });
  assert.equal((await call("chat-thread.get", { thread_id: id })).data.thread.updated_at, beforeReplay, "Exact message replay must not touch Thread order");
  await call("chat-message.persist", { ...envelope, parts: [{ type: "text", text: "changed" }] }, { status: 409 });
  const messages = (await call("chat-message.list", { thread_id: id })).data.messages;
  assert.equal(messages.length, 1); assert.deepEqual(messages[0].metadata, { a: 1, z: 2 });
  const search = (await call("chat-thread.search", { deck_id: f.deck_id })).data.threads;
  assert(search.find((v: { id: string }) => v.id === id).messages_text.includes("hello"));
  assert.equal((await call("chat-thread.search", { deck_id: f.deck_id }, { token: f.other_access_token })).data.threads.length, 0);
  await call("chat-message.persist", { ...envelope, thread_id: unbound, message_id: `delete_message_${randomUUID()}` });
  assert.equal((await call("chat-thread.delete", { thread_id: unbound }, { token: f.other_access_token })).data.changed, false);
  const deleteRequestId = `delete_${randomUUID()}`;
  assert.equal((await call("chat-thread.delete", { thread_id: unbound }, { requestId: deleteRequestId })).data.changed, true);
  assert.equal((await call("chat-thread.delete", { thread_id: unbound }, { requestId: deleteRequestId })).data.changed, true);
  assert.equal((await call("chat-thread.get", { thread_id: unbound })).data.thread, null);
  await call("chat-message.list", { thread_id: unbound }, { status: 404 });

  const conflictReceipt = await receipt("chat-message.persist", `absent_${randomUUID()}`); assert.equal(conflictReceipt.status, "absent");
  const projected = { ...envelope, message_id: `assistant_${randomUUID()}`, role: "assistant", parts: [{ type: "reasoning", text: "process" }, { type: "text", text: "answer" }], metadata: { turnId: "isolated-turn", turnStatus: "completed", finalPartIndex: 1 }, history_final_text: "answer", history_process_available: true, history_projection_version: 1 };
  await call("chat-message.persist", projected);
  await call("chat-message.persist", { ...projected, message_id: `bad_${randomUUID()}`, history_final_text: "wrong" }, { status: 400 });
  const page = (await call("chat-message.page", { thread_id: id, limit: 1, before: null })).data;
  assert.equal(page.has_more, true); assert.deepEqual(page.messages[0].parts, [{ type: "text", text: "answer" }]);
  const process = (await call("chat-message.process-detail", { thread_id: id, message_id: projected.message_id })).data.message;
  assert.equal(process.parts.length, 2);
  assert.equal((await call("chat-message.latest", { thread_id: id })).data.message_id, projected.message_id);
  await call("chat-thread.select-voice", { thread_id: id, deck_id: f.deck_id, voice_id: f.voice_id, expected_voice_id: null }).then(v => assert.equal(v.data.changed, false));
  await call("chat-thread.select-voice", { thread_id: id, deck_id: f.deck_id, voice_id: f.voice_id, expected_voice_id: f.voice_id }).then(v => assert.equal(v.data.changed, true));
  await call("chat-thread.update-session", { thread_id: id, claude_session_id: "isolated-session", agent_contract_version: "isolated-contract" });
  assert.equal((await call("chat-thread.get", { thread_id: id })).data.thread.claude_session_id, "isolated-session");
  const second = f.history_thread_id;
  const older = { message_id: f.history_older_id }, newer = { message_id: f.history_newer_id }, legacyNull = { message_id: f.history_null_id };
  const precise = (await call("chat-message.page", { thread_id: second, limit: 1, before: null })).data;
  assert.equal(precise.messages[0].id, newer.message_id); assert(precise.messages[0].created_at.includes("123457"));
  const olderPage = (await call("chat-message.page", { thread_id: second, limit: 2, before: { id: newer.message_id, created_at: precise.messages[0].created_at } })).data;
  assert.deepEqual(olderPage.messages.map((m: { id: string }) => m.id), [legacyNull.message_id, older.message_id]);
  assert.equal(olderPage.has_more, false);
  assert.equal((await call("chat-message.page", { thread_id: second, limit: 1, before: { id: legacyNull.message_id, created_at: null } })).data.messages.length, 0);
  const count = await verificationDatabase.select({ n: sql<string>`count(*)::text` }).from(operationReceipts).where(eq(operationReceipts.requestId, persistRequest));
  assert.equal(count[0].n, "1");
  const audit = await verificationDatabase.select({ n: sql<string>`count(*)::text` }).from(adminAuditLogs).where(eq(adminAuditLogs.request_id, persistRequest)); assert.equal(audit[0].n, "1");
  const raw = await database.select({ user_id: sql<string>`${thread.user_id}::text` }).from(thread).where(eq(thread.id, id)); assert.equal(raw[0].user_id, "9007199254740993");
  assert.deepEqual([...visitedOperations].sort(), Object.keys(chatThreadOperationContracts).sort(), "All 14 public operations must be exercised");
  console.log(`PUBLIC THREAD CONTRACT PASS: operations=${visitedOperations.size}; route_calls_assertions=${assertions}; owner/scope/DTO/CAS/semantic replay/concurrent receipt/audit/final/process/microsecond/NULL verified; database=${f.database}; provider-free`);
} finally {
  const own = globalThis as typeof globalThis & { __ink_dream_data_pool?: { end(): Promise<void> }; __ink_auth_pool?: { end(): Promise<void> } };
  await own.__ink_dream_data_pool?.end(); await own.__ink_auth_pool?.end(); await verificationClient?.end();
}
