// [Input] Primary-prepared private named disposable PG, limited AUTH/DATA credentials and ES256 grants.
// [Output] Actual production Session/Editor/delegation Route and receipt/ACL contract evidence.
// [Pos] Provider-free isolated harness; never a normal-user, Google or model acceptance substitute.
// [Sync] 2026-09-17: require delegated user OAuth plus a short-lived client_credentials service access token.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { Client } from "pg";
import { POST as internalOperation } from "../../app/api/internal/dream/v1/operations/[operation]/route";
import { POST as createDelegation } from "../../app/api/internal/dream/v1/runtime-delegations/route";
import { POST as publicEditor } from "../../app/api/dream/v1/editor/operations/[operation]/route";
import { GET as editorReceipt } from "../../app/api/dream/v1/editor/receipts/[requestId]/route";
import { POST as renewDelegation } from "../../app/api/runtime-delegations/renew/route";
import { POST as revokeDelegation } from "../../app/api/runtime-delegations/revoke/route";
import { GET as actionReceipt } from "../../app/api/runtime-delegations/receipts/[requestId]/route";
import { editorSessionOperationContracts, type EditorSessionOperation } from "../../app/lib/dream/editorSessionDto";
import { delegationHash } from "../../app/lib/auth/delegationService";
import { delegationOutputDto, delegationRenewOutputDto } from "../../app/lib/auth/delegationDto";
const configPath = process.env.INK_AUTH_EDITOR_FIXTURE;
assert(configPath, "Primary-prepared private isolated fixture required");
assert.equal((await stat(configPath)).mode & 0o777, 0o600, "Private fixture mode required");
let f: Record<string, string | number>;
try { f = JSON.parse(await readFile(configPath, "utf8")); } catch { throw new Error("Invalid private fixture configuration"); }
assert(typeof f.database === "string" && f.database.startsWith("ink_auth_data_codex_test_"));
assert(typeof f.data_directory === "string" && f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"));
for (const key of ["target_verification_url", "issuer", "service_id", "service_access_token", "access_token", "other_access_token", "thread_id"]) assert(typeof f[key] === "string" && String(f[key]).length > 0, "Required private fixture field missing");
let verificationDsn: URL;
try { verificationDsn = new URL(String(f.target_verification_url)); } catch { throw new Error("Explicit PostgreSQL verification credential required"); }
assert(["postgres:", "postgresql:"].includes(verificationDsn.protocol) && verificationDsn.username && decodeURIComponent(verificationDsn.pathname.slice(1)) === f.database, "Explicit named PostgreSQL credential required");
const verification = new Client({ connectionString: String(f.target_verification_url) });
await verification.connect();
const proof = await verification.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_setting('data_directory') AS root");
assert.deepEqual(proof.rows[0], { name: f.database, port: f.port, root: f.data_directory });
const origin = String(f.issuer).replace(/\/api\/auth$/, "");
let assertions = 0;
const visited = new Set<string>();
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
function bearer(token: string, requestId: string, service = false) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json", "x-request-id": requestId, ...(service ? { "x-ink-dream-service-authorization": `Bearer ${String(f.service_access_token)}` } : {}) };
}
async function checked(response: Response, status: number, requestId: string) {
  const body = await response.json();
  const code = typeof body.error?.code === "string" && /^[A-Z0-9_]{1,100}$/.test(body.error.code) ? body.error.code : "NO_PUBLIC_ERROR_CODE";
  assert.equal(response.status, status, `Unexpected public status (${code})`); assert.equal(body.request_id, requestId); assertions += 2;
  return body.data;
}
async function session(name: EditorSessionOperation, input: unknown, options: { token?: string; requestId?: string; status?: number } = {}) {
  const requestId = options.requestId ?? id("session");
  const response = await internalOperation(new Request(`${origin}/api/internal/dream/v1/operations/${name}`, { method: "POST", headers: bearer(options.token ?? String(f.access_token), requestId, true), body: JSON.stringify({ request_id: requestId, input }) }), { params: Promise.resolve({ operation: name }) });
  const result = await checked(response, options.status ?? 200, requestId); visited.add(name);
  return response.ok ? editorSessionOperationContracts[name].output.parse(result) : result;
}
async function grant(input: unknown, options: { token?: string; requestId?: string; status?: number } = {}) {
  const requestId = options.requestId ?? id("grant");
  const response = await createDelegation(new Request(`${origin}/api/internal/dream/v1/runtime-delegations`, { method: "POST", headers: bearer(options.token ?? String(f.access_token), requestId, true), body: JSON.stringify({ request_id: requestId, input }) }));
  const result = await checked(response, options.status ?? 200, requestId);
  return response.ok ? delegationOutputDto.parse(result) : result;
}
async function editor(name: "editor-state.load" | "editor-state.replace", input: unknown, token: string, requestId = id("editor"), status = 200) {
  const response = await publicEditor(new Request(`${origin}/api/dream/v1/editor/operations/${name}`, { method: "POST", headers: bearer(token, requestId), body: JSON.stringify({ request_id: requestId, input }) }), { params: Promise.resolve({ operation: name }) });
  const result = await checked(response, status, requestId); visited.add(name);
  return response.ok ? editorSessionOperationContracts[name].output.parse(result) : result;
}
async function action(kind: "renew" | "revoke", token: string, requestId: string, status = 200) {
  const request = new Request(`${origin}/api/runtime-delegations/${kind}`, { method: "POST", headers: bearer(token, requestId), body: JSON.stringify({ request_id: requestId }) });
  return checked(await (kind === "renew" ? renewDelegation(request) : revokeDelegation(request)), status, requestId);
}
async function recovery(kind: "editor" | "renew" | "revoke", token: string, requestId: string, status = 200) {
  const operation = kind === "editor" ? "editor-state.replace" : `runtime-delegation.${kind}`;
  const path = kind === "editor" ? "dream/v1/editor" : "runtime-delegations";
  const request = new Request(`${origin}/api/${path}/receipts/${requestId}?operation=${operation}`, { headers: bearer(token, requestId) });
  return checked(await (kind === "editor" ? editorReceipt(request, { params: Promise.resolve({ requestId }) }) : actionReceipt(request, { params: Promise.resolve({ requestId }) })), status, requestId);
}
try {
  const sessionId = id("editor_session"), secondId = id("second_session");
  const state = { id: sessionId, cells: [{ id: id("cell"), type: "text", content: "provider-free isolated prose" }], commentors: [], tasks: [], weightPath: [], overlappedPhrases: [], notFoundPhrases: [] };
  const save = { session_id: sessionId, editor_state: state, name: "retained", labels: ["tag"], created_at: "2026-09-14T00:00:00.123456Z" };
  await session("session.save", save);
  await session("session.save", { ...save, name: null, labels: null, created_at: null });
  const loaded = await session("session.get", { session_id: sessionId });
  assert(loaded && "session" in loaded && loaded.session !== null && loaded.session.name === "retained" && loaded.session.labels[0] === "tag" && loaded.session.created_at?.includes("123456")); assertions++;
  await session("session.save", { ...save, editor_state: { ...state, cells: [] } }, { token: String(f.other_access_token), status: 404 });
  const unchanged = await session("session.get", { session_id: sessionId });
  assert(unchanged && "session" in unchanged && unchanged.session !== null && unchanged.session.editor_state.cells.length === 1); assertions++;
  const foreign = await session("session.get", { session_id: sessionId }, { token: String(f.other_access_token) });
  assert(foreign && "session" in foreign && foreign.session === null); assertions++;
  await session("session.save", { ...save, session_id: secondId, editor_state: { ...state, id: secondId } });
  await session("session.batch", { session_ids: [sessionId, secondId] });
  await session("session.list", { start_date: null, end_date: null, include_text: true });
  await session("session.text-list", {});
  await session("editor-state.load", { session_id: id("missing") });
  await session("session.save", { ...save, user_id: "1" }, { status: 400 });
  await session("editor-state.replace", { session_id: secondId, editor_state: state }, { status: 400 });
  const grantInput = { purpose: "editor-stdio", thread_id: String(f.thread_id), run_id: null, editor_session_id: sessionId, scopes: ["editor:read", "editor:write"] };
  const grantRequestId = id("create_editor_grant");
  const credential = await grant(grantInput, { requestId: grantRequestId });
  const original = await grant(grantInput, { requestId: grantRequestId });
  assert(credential.token === original.token, "Encrypted creation must recover one original opaque credential"); assertions++;
  await grant({ ...grantInput, editor_session_id: secondId }, { requestId: grantRequestId, status: 409 });
  await grant({ ...grantInput, scopes: ["editor:write", "messages:create"] }, { status: 403 });
  await grant({ ...grantInput, editor_session_id: null }, { status: 403 });
  await grant(grantInput, { token: String(f.other_access_token), status: 404 });
  const server = await grant({ purpose: "server-persistence", thread_id: String(f.thread_id), run_id: null, editor_session_id: null, scopes: ["dream:read", "dream:write"] });
  const cli = await grant({ purpose: "gateway-cli", thread_id: String(f.thread_id), run_id: null, editor_session_id: null, scopes: ["messages:create", "messages:count_tokens", "models:list"] });
  await editor("editor-state.load", { session_id: sessionId }, server.token, id("wrong_purpose"), 403);
  await editor("editor-state.load", { session_id: sessionId }, cli.token, id("wrong_cli_purpose"), 403);
  await session("session.list", { start_date: null, end_date: null, include_text: false }, { token: server.token, status: 403 });
  await editor("editor-state.load", { session_id: secondId }, credential.token, id("wrong_session"), 403);
  await editor("editor-state.load", { session_id: sessionId }, credential.token);
  const next = { ...state, cells: [{ ...state.cells[0], content: "changed synthetic prose" }] }, replaceId = id("replace");
  await Promise.all([editor("editor-state.replace", { session_id: sessionId, editor_state: next }, credential.token, replaceId), editor("editor-state.replace", { session_id: sessionId, editor_state: next }, credential.token, replaceId)]);
  await editor("editor-state.replace", { session_id: sessionId, editor_state: state }, credential.token, replaceId, 409);
  assert((await recovery("editor", credential.token, replaceId)).status === "committed"); assertions++;
  const secondGrant = await grant({ ...grantInput, editor_session_id: secondId });
  await recovery("editor", secondGrant.token, replaceId, 403);
  const secret = await verification.query("SELECT token_ciphertext FROM identity.runtime_delegations WHERE token_hash=$1", [delegationHash(credential.token)]);
  assert(secret.rows.length === 1 && !secret.rows[0].token_ciphertext.includes(credential.token), "Credential storage must be encrypted"); assertions++;
  const count = await verification.query("SELECT count(*)::int AS n FROM dream.operation_receipts WHERE request_id=$1", [replaceId]);
  assert(count.rows[0].n === 1, "Concurrent replacement must commit one receipt"); assertions++;
  const audit = await verification.query("SELECT count(*)::int AS n FROM public.admin_audit_logs WHERE request_id=$1", [replaceId]);
  assert(audit.rows[0].n === 1, "Concurrent replacement must append one audit"); assertions++;
  const renewalId = id("renew");
  const renewed = delegationRenewOutputDto.parse(await action("renew", credential.token, renewalId));
  await verification.query("UPDATE identity.runtime_delegations SET expires_at=CURRENT_TIMESTAMP-interval '1 second' WHERE token_hash=$1", [delegationHash(credential.token)]);
  const recovered = await recovery("renew", credential.token, renewalId);
  assert(recovered.status === "committed" && recovered.result.expires_at === renewed.expires_at, "Expired bearer recovers original bounded response only"); assertions++;
  const repeat = await action("renew", credential.token, renewalId);
  assert(repeat.expires_at === renewed.expires_at, "Original renewal replay must not extend expiry"); assertions++;
  await action("renew", credential.token, id("new_expired_renew"), 401);
  await editor("editor-state.load", { session_id: sessionId }, credential.token, id("expired_editor"), 401);
  const revokeId = id("revoke");
  await action("revoke", cli.token, revokeId);
  assert((await recovery("revoke", cli.token, revokeId)).status === "committed"); assertions++;
  const live = await grant(grantInput);
  await verification.query("UPDATE public.user_sessions SET editor_state_json='{',created_at=NULL,updated_at='2026-09-14 00:00:00.123456+00' WHERE id=$1", [sessionId]);
  await editor("editor-state.load", { session_id: sessionId }, live.token, id("corrupt_editor"), 503);
  await session("session.list", { start_date: null, end_date: null, include_text: false });
  await editor("editor-state.replace", { session_id: sessionId, editor_state: next }, live.token);
  await session("session.delete", { session_id: sessionId });
  await editor("editor-state.load", { session_id: sessionId }, live.token, id("deleted_editor"), 401);
  const cascade = await verification.query("SELECT count(*)::int AS n FROM identity.runtime_delegations WHERE editor_session_id=$1", [sessionId]);
  assert(cascade.rows[0].n === 0, "Deleting owned Session must end every bound Editor credential"); assertions++;
  assert.deepEqual([...visited].sort(), Object.keys(editorSessionOperationContracts).sort()); assertions++;
  console.log(`PUBLIC EDITOR SESSION CONTRACT PASS: operations=${visited.size}; assertions=${assertions}; restricted-pools/owner/purpose/Session/NULL/microseconds/receipt/recovery/cascade; provider-free`);
} finally {
  const own = globalThis as typeof globalThis & { __ink_dream_data_pool?: { end(): Promise<void> }; __ink_auth_pool?: { end(): Promise<void> } };
  await own.__ink_dream_data_pool?.end(); await own.__ink_auth_pool?.end(); await verification.end();
}
