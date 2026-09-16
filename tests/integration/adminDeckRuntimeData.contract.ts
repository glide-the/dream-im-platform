// [Input] Primary-prepared named isolated target, restricted pools and private short-lived actor proofs.
// [Output] Actual six production operation contracts and receipt/permission/semantic atomicity evidence.
// [Pos] Public-only provider-free harness; every owner SQL query is SELECT, never fixture/fault execution.
// [Sync] 2026-09-17: require delegated user OAuth plus a short-lived client_credentials service access token.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { z } from "zod";
import { POST } from "../../app/api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../app/api/internal/dream/v1/receipts/[requestId]/route";
import { deckRuntimeDataOperationContracts as contracts, pluginRefEvidenceDto, type DeckRuntimeDataOperation } from "../../app/lib/dream/deckRuntimeDataDto";
const id = z.string().min(1);
const fixtureDto = z.strictObject({ database: id, port: z.number().int().positive(), data_directory: id, target_verification_url: id, issuer: id, service_id: id, service_access_token: id, access_token: id, other_access_token: id, read_only_token: id, thread_grant: id, deck_id: id, foreign_deck_id: id, thread_id: id, other_owned_thread_id: id, repair_thread_id: id, repair_voice_id: id, unbound_thread_id: id, analysis_voice_id: id, disabled_voice_id: id, disabled_deck_voice_id: id, retired_voice_id: id, changed_retired_voice_id: id, not_ready_installation_id: id, refs: z.array(pluginRefEvidenceDto).length(2), raw_memory: id, default_memory: id });
const path = process.env.INK_AUTH_DECK_RUNTIME_FIXTURE; assert(path, "Explicit private primary-prepared fixture required"); assert.equal((await stat(path)).mode & 0o777, 0o600);
const raw = JSON.parse(await readFile(path, "utf8"));const parsed = fixtureDto.safeParse(raw);assert(parsed.success, "Strict private fixture contract required");const f = parsed.data;
assert(f.database.startsWith("ink_auth_data_codex_test_") && f.port !== 5433 && f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"));
const dsn = new URL(f.target_verification_url);assert(["postgres:", "postgresql:"].includes(dsn.protocol) && decodeURIComponent(dsn.pathname.slice(1)) === f.database);
const verification = new Client({ connectionString: f.target_verification_url });await verification.connect();
const proof = await verification.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_setting('data_directory') AS root");assert.deepEqual(proof.rows[0], { name: f.database, port: f.port, root: f.data_directory });
const origin = f.issuer.replace(/\/api\/auth$/, "");let assertions = 0;const visited = new Set<string>();
const requestId = () => `deck_runtime_${randomUUID()}`;
function headers(token: string, correlation: string) { return { authorization: `Bearer ${token}`, "content-type": "application/json", "x-request-id": correlation, "x-ink-dream-service-authorization": `Bearer ${f.service_access_token}` }; }
async function call(name: DeckRuntimeDataOperation, input: unknown, options: { status?: number; token?: string; correlation?: string } = {}) {
  const correlation = options.correlation ?? requestId();const response = await POST(new Request(`${origin}/api/internal/dream/v1/operations/${name}`, { method: "POST", headers: headers(options.token ?? f.access_token, correlation), body: JSON.stringify({ request_id: correlation, input }) }), { params: Promise.resolve({ operation: name }) });const body = await response.json();
  const code = typeof body.error?.code === "string" && /^[A-Z0-9_]{1,100}$/.test(body.error.code) ? body.error.code : "NO_PUBLIC_ERROR_CODE";assert.equal(response.status, options.status ?? 200, `${name} public status (${code})`);assert.equal(body.request_id, correlation);assertions += 2;visited.add(name);
  if (response.ok) contracts[name].output.parse(body.data);return body.data;
}
async function snapshot() { const r = await verification.query("SELECT d.draft_revision,d.updated_at::text,(SELECT json_agg(json_build_array(r.plugin_installation_id,r.package_spec,r.resolved_version,r.artifact_digest,r.enabled,r.order_index,r.created_at::text,r.updated_at::text) ORDER BY r.order_index,r.plugin_installation_id) FROM public.deck_claude_plugin_refs r WHERE r.deck_id=d.id) AS refs FROM public.decks d WHERE d.id=$1", [f.deck_id]);return JSON.stringify(r.rows[0]); }
async function repairSnapshot() { const r = await verification.query("SELECT v.memory_workspace_config,v.updated_at::text,d.draft_revision,d.updated_at::text AS deck_updated FROM public.voices v JOIN public.decks d ON d.id=v.deck_id WHERE v.id=$1", [f.repair_voice_id]);return r.rows[0]; }
async function receipt(name: DeckRuntimeDataOperation, correlation: string, token = f.access_token) { const response = await GET(new Request(`${origin}/api/internal/dream/v1/receipts/${correlation}?operation=${name}`, { headers: headers(token, correlation) }), { params: Promise.resolve({ requestId: correlation }) });const body = await response.json();assert.equal(response.status, 200);assert.equal(body.request_id, correlation);assertions += 2;return body.data; }
try {
  const empty = await call("deck-plugin-refs.list", { deck_id: f.deck_id });assert.equal(empty.refs.length, 0);assertions++;
  await call("deck-plugin-refs.list", { deck_id: f.foreign_deck_id }, { status: 404 });await call("deck-plugin-refs.list", { deck_id: f.deck_id }, { token: f.other_access_token, status: 404 });
  await call("deck-plugin-refs.list", { deck_id: f.deck_id, user_id: "external" }, { status: 400 });await call("deck-plugin-refs.list", { deck_id: f.deck_id }, { token: f.thread_grant, status: 403 });
  const prepared = await call("deck-plugin-refs.prepare", { deck_id: f.deck_id, installation_ids: f.refs.map(ref => ref.plugin_installation_id) });assert.equal(prepared.installations.length, 2);assert(prepared.installations.every((row: Record<string, unknown>) => !Object.hasOwn(row, "artifact_path")));assertions += 2;
  await call("deck-plugin-refs.prepare", { deck_id: f.deck_id, installation_ids: [f.refs[0].plugin_installation_id, "missing-installation"] }, { status: 404 });await call("deck-plugin-refs.prepare", { deck_id: f.deck_id, installation_ids: [f.not_ready_installation_id] }, { status: 409 });
  await call("deck-plugin-refs.prepare", { deck_id: f.deck_id, installation_ids: [f.refs[0].plugin_installation_id, ` ${f.refs[0].plugin_installation_id} `] }, { status: 400 });
  const input = { deck_id: f.deck_id, refs: f.refs }, original = requestId(), before = await snapshot();
  const first = await call("deck-plugin-refs.replace", input, { correlation: original });assert(first.changed && first.refs.length === 2);assertions++;
  const written = await snapshot();assert.notEqual(written, before);assertions++;
  const replay = await call("deck-plugin-refs.replace", input, { correlation: original });assert.deepEqual(replay, first);assert.equal(await snapshot(), written);assertions += 2;
  const equivalent = await call("deck-plugin-refs.replace", { ...input, refs: [...f.refs].reverse() });assert.equal(equivalent.changed, false);assert.equal(await snapshot(), written);assertions += 2;
  await call("deck-plugin-refs.replace", { ...input, refs: [] }, { correlation: original, status: 409 });await call("deck-plugin-refs.replace", input, { token: f.read_only_token, status: 403 });await call("deck-plugin-refs.replace", input, { token: f.thread_grant, status: 403 });
  const failedId = requestId();await call("deck-plugin-refs.replace", { ...input, refs: [f.refs[0], { ...f.refs[1], plugin_installation_id: f.not_ready_installation_id }] }, { correlation: failedId, status: 409 });assert.equal(await snapshot(), written);assertions++;
  assert.equal((await receipt("deck-plugin-refs.replace", failedId)).status, "absent");assertions++;
  await call("deck-plugin-refs.replace", { ...input, refs: [f.refs[0], { ...f.refs[1], compatibility_json: '{"changed":true}' }] }, { status: 409 });
  await call("deck-plugin-refs.replace", { ...input, refs: [{ ...f.refs[0], artifact_path: "/caller/path" }] }, { status: 400 });
  await call("deck-plugin-refs.replace", { ...input, refs: [f.refs[0], f.refs[0]] }, { status: 400 });assert.equal(await snapshot(), written);assertions++;
  const runtime = await call("deck-plugin-refs.runtime-read", { thread_id: f.thread_id }, { token: f.thread_grant });assert.equal(runtime.deck_id, f.deck_id);assert.deepEqual(runtime.refs.map((row: { plugin_installation_id: string }) => row.plugin_installation_id), [f.refs.find(ref => ref.enabled)!.plugin_installation_id]);assertions += 2;
  await call("deck-plugin-refs.runtime-read", { thread_id: f.other_owned_thread_id }, { token: f.thread_grant, status: 403 });await call("deck-plugin-refs.runtime-read", { thread_id: f.thread_id }, { token: f.other_access_token, status: 404 });
  assert.deepEqual(await call("deck-plugin-refs.runtime-read", { thread_id: f.unbound_thread_id }), { deck_id: null, refs: [] });assertions++;
  const analysis = await call("voice-analysis.list", {});const visible = new Set(analysis.voices.map((row: { voice_id: string }) => row.voice_id));assert(visible.has(f.analysis_voice_id) && visible.has(f.changed_retired_voice_id));assert(!visible.has(f.disabled_voice_id) && !visible.has(f.disabled_deck_voice_id) && !visible.has(f.retired_voice_id));assertions += 2;
  await call("voice-analysis.list", {}, { token: f.thread_grant, status: 403 });await call("voice-analysis.list", { actor: "external" }, { status: 400 });
  const valid = await call("voice-memory.resolve", { thread_id: f.thread_id }, { token: f.thread_grant });assert.deepEqual(valid, { memory_workspace_config_json: f.raw_memory, repaired: false });assertions++;
  await call("voice-memory.resolve", { thread_id: f.other_owned_thread_id }, { token: f.thread_grant, status: 403 });await call("voice-memory.resolve", { thread_id: f.thread_id }, { token: f.other_access_token, status: 404 });await call("voice-memory.resolve", { thread_id: f.thread_id }, { token: f.read_only_token, status: 403 });
  assert.deepEqual(await call("voice-memory.resolve", { thread_id: f.unbound_thread_id }), { memory_workspace_config_json: null, repaired: false });assertions++;
  const repairBefore = await repairSnapshot(), repairId = requestId();const repaired = await call("voice-memory.resolve", { thread_id: f.repair_thread_id }, { correlation: repairId });assert.deepEqual(repaired, { memory_workspace_config_json: f.default_memory, repaired: true });const repairAfter = await repairSnapshot();assert.equal(repairAfter.memory_workspace_config, f.default_memory);assert.equal(repairAfter.draft_revision, repairBefore.draft_revision);assert.equal(repairAfter.deck_updated, repairBefore.deck_updated);assert.notEqual(repairAfter.updated_at, repairBefore.updated_at);assertions += 5;
  assert.deepEqual(await call("voice-memory.resolve", { thread_id: f.repair_thread_id }, { correlation: repairId }), repaired);assert.deepEqual(await repairSnapshot(), repairAfter);assertions += 2;
  assert.deepEqual(await call("voice-memory.resolve", { thread_id: f.repair_thread_id }), { memory_workspace_config_json: f.default_memory, repaired: false });assert.deepEqual(await repairSnapshot(), repairAfter);assertions += 2;
  const recovered = await receipt("deck-plugin-refs.replace", original);assert.equal(recovered.status, "committed");assert.deepEqual(recovered.result, first);assertions += 2;
  const counts = await verification.query("SELECT (SELECT count(*)::int FROM dream.operation_receipts WHERE operation='deck-plugin-refs.replace' AND request_id=$1) AS receipts,(SELECT count(*)::int FROM public.admin_audit_logs WHERE action='dream.deck-plugin-refs.replace' AND request_id=$1) AS audits", [original]);assert.deepEqual(counts.rows[0], { receipts: 1, audits: 1 });assertions++;
  assert.equal(visited.size, 6);assertions++;
  console.log(JSON.stringify({ result: "PASS", operations: visited.size, assertions, fixture: "provider-free-isolated-restricted-roles", filesystem: "metadata-only; actual Dream artifact and CLI validation not claimed" }));
} finally { await verification.end();const global = globalThis as typeof globalThis & { __ink_auth_pool?: { end(): Promise<void> }; __ink_dream_data_pool?: { end(): Promise<void> } };await global.__ink_auth_pool?.end();await global.__ink_dream_data_pool?.end(); }
