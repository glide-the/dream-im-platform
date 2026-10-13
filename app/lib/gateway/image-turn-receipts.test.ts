// [Input] Original PoolClient boundary, verified Runtime identity and persisted image-only receipt fixtures.
// [Output] Deterministic evidence for entity isolation, safe source identity and one execution across both routes.
// [Pos] Provider-free gate contract; real PostgreSQL rollback/concurrency remains a separate technical check.
// [Sync] 2026-10-10: validate source and execution identity without invoking a Provider or duplicating its state machine.
import type { PoolClient } from "pg";
import { expect, it, vi } from "vitest";
import type { GatewayPrincipal } from "./auth";
import { imageTurnSchemaRequirement } from "../db/image-turn-capability";
import { imageTurnBindInputDto, imageTurnSelectInputDto } from "../dream/imageTurnDto";
import { operationInputDigest } from "../dream/receipts";
import { imageTurnContext, imageTurnReceiptKey, lockImageTurnOnClient, readImageTurnOnClient,
  recordImageSourceOnClient, claimImageExecutionOnClient } from "./image-turn-receipts";

const turnKey = "dream-turn-" + "a".repeat(64);
const identity = Object.freeze({ authSubject: "subject", canonicalUserId: "102", serviceClientId: "service",
  threadId: "thread", runId: null, purpose: "gateway-cli" });
const principal = { platformUserId: "platform", runtimeIdentity: identity } as GatewayPrincipal;
const binding = { thread_id: "thread", turn_id: "actual-turn", turn_key: turnKey, message_id: "actual-message",
  ai_model: "main-ai", image_model: "selected-image", materials: [], canonical_user_id: "102", run_id: null };
const selection = { turn_key: turnKey, source_call_id: "actual-selection", operation: "native_generate",
  arguments_sha256: "b".repeat(64), reference_images: [] };
function fixture(input: { binding?: unknown; selected?: unknown; permissions?: boolean } = {}) {
  const facts = new Map<string, unknown>([[`image-turn.bind:${imageTurnReceiptKey(turnKey)}`, input.binding ?? binding]]);
  if (input.selected !== null) facts.set(`image-turn.select:${imageTurnReceiptKey(turnKey)}`, input.selected ?? selection);
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes("FROM drizzle.schema_capabilities")) return { rows: [{ version: imageTurnSchemaRequirement.version,
      contract_sha256: imageTurnSchemaRequirement.contractSha256, can_use_schema: true, can_read: true,
      can_append: input.permissions !== false, can_audit: true }] };
    if (sql.startsWith("SELECT input_sha256")) {
      const data = facts.get(`${args[2]}:${args[3]}`);
      return { rows: data === undefined ? [] : [{ input_sha256: operationInputDigest(data), result: {
        schema_version: 1, data, thread_scope: "thread", run_scope: null } }] };
    }
    if (sql.startsWith("INSERT INTO dream.operation_receipts")) {
      const envelope = JSON.parse(String(args[5]));
      facts.set(`${args[2]}:${args[3]}`, envelope.data);
    }
    return { rows: [], rowCount: 1 };
  });
  return { client: { query } as unknown as PoolClient, query, facts };
}
it("requires verified Runtime authority and rejects caller identity/configuration fields", () => {
  expect(() => imageTurnContext({ platformUserId: "platform" } as GatewayPrincipal, turnKey)).toThrow();
  expect(() => imageTurnContext({ ...principal, runtimeIdentity: { ...identity, purpose: "server-persistence" } }, turnKey)).toThrow();
  expect(() => imageTurnContext(principal, "caller-turn")).toThrow();
  const { canonical_user_id: ignoredUser, run_id: ignoredRun, ...bindInput } = binding;
  void ignoredUser; void ignoredRun;
  expect(imageTurnBindInputDto.safeParse(bindInput).success).toBe(true);
  expect(imageTurnBindInputDto.safeParse({ ...bindInput, user_id: "other" }).success).toBe(false);
  expect(imageTurnSelectInputDto.safeParse({ thread_id: "thread", turn_key: turnKey, source_call_id: "call",
    arguments: { operation: "image_gen_generate", prompt: "request", reference_images: [], model: "caller-choice" } }).success).toBe(false);
});
it.each(["canonical_user_id", "thread_id", "run_id", "turn_key"])("does not use a binding with different %s", async (field) => {
  const f = fixture({ binding: { ...binding, [field]: field === "canonical_user_id" ? "103" : field === "turn_key" ? "dream-turn-" + "b".repeat(64) : "different" } });
  await expect(readImageTurnOnClient(f.client, imageTurnContext(principal, turnKey))).rejects.toMatchObject({ code: "IMAGE_TURN_NOT_BOUND" });
});
it("checks each role permission before acquiring the turn gate", async () => {
  const f = fixture({ permissions: false });
  await expect(lockImageTurnOnClient(f.client, imageTurnContext(principal, turnKey))).rejects.toMatchObject({ code: "IMAGE_TURN_CONFIGURATION_UNAVAILABLE" });
  expect(f.query.mock.calls.some(([sql]) => sql.includes("pg_advisory_xact_lock"))).toBe(false);
});
it("records actual upstream item and CLI call IDs separately with only an argument digest", async () => {
  const f = fixture(), context = imageTurnContext(principal, turnKey);
  const source = { call_id: "cli_call", output_item_id: "provider_item", gateway_request_id: "req_" + "c".repeat(32),
    tool_name: "mcp__image_gen__select_image_operation" as const, arguments_sha256: "d".repeat(64) };
  expect(await recordImageSourceOnClient(f.client, context, source)).toEqual(source);
  expect(await recordImageSourceOnClient(f.client, context, source)).toEqual(source);
  const inserts = f.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO dream.operation_receipts"));
  expect(inserts).toHaveLength(1);
  expect(String(inserts[0]![1]?.[5])).not.toContain("prompt");
  await expect(recordImageSourceOnClient(f.client, context, { ...source, output_item_id: "other_item" })).rejects.toMatchObject({ code: "IMAGE_TURN_CONFLICT" });
  const locks = f.query.mock.calls.filter(([sql]) => sql.includes("pg_advisory_xact_lock"));
  expect(locks[0]?.[1]).toContain("platform");
  expect(String(locks[1]?.[1]?.[0])).toContain("image-turn");
});
it("rejects missing selection, another route or a substituted model before execution", async () => {
  const claim = { gateway_request_id: "req_" + "e".repeat(32), operation: "native_generate" as const,
    selected_model: "main-ai", selection_call_id: "actual-selection" };
  for (const [f, changed] of [[fixture({ selected: null }), claim], [fixture(), { ...claim, selected_model: "other" }],
    [fixture(), { ...claim, operation: "image_gen_generate" }]] as const) {
    await expect(claimImageExecutionOnClient(f.client, imageTurnContext(principal, turnKey), changed)).rejects.toMatchObject({ code: "IMAGE_TURN_SELECTION_MISMATCH" });
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith("INSERT INTO dream.operation_receipts"))).toBe(false);
  }
});
it("does not permit a second Gateway execution by changing request identity", async () => {
  const f = fixture(), context = imageTurnContext(principal, turnKey);
  const claim = { gateway_request_id: "req_" + "e".repeat(32), operation: "native_generate" as const,
    selected_model: "main-ai", selection_call_id: "actual-selection" };
  await expect(claimImageExecutionOnClient(f.client, context, claim)).resolves.toEqual(claim);
  await expect(claimImageExecutionOnClient(f.client, context, { ...claim, gateway_request_id: "req_" + "f".repeat(32) })).rejects.toMatchObject({ code: "IMAGE_TURN_ALREADY_EXECUTED" });
  expect(f.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO dream.operation_receipts"))).toHaveLength(1);
});
it('matches Images prompt/material/operation to the actual source and rejects changed arguments', async () => {
  const argumentsValue = {operation:'image_gen_generate',prompt:'Actual selected prompt',reference_images:[]};
  const f = fixture({selected:{...selection,operation:'image_gen_generate',arguments_sha256:operationInputDigest(argumentsValue)}});
  const context = imageTurnContext(principal,turnKey);
  const executionSource = {callId:'actual-execution',argumentsSha256:operationInputDigest({prompt:argumentsValue.prompt,reference_images:[]}),selectionArgumentsSha256:operationInputDigest(argumentsValue),materialSha256:[]};
  await recordImageSourceOnClient(f.client,context,{call_id:executionSource.callId,output_item_id:'provider-execution',gateway_request_id:'req_'+'c'.repeat(32),tool_name:'mcp__image_gen__imagegen',arguments_sha256:executionSource.argumentsSha256});
  const claim={gateway_request_id:'req_'+'d'.repeat(32),operation:'image_gen_generate' as const,selected_model:'selected-image',selection_call_id:'actual-selection'};
  await expect(claimImageExecutionOnClient(f.client,context,claim,{...executionSource,selectionArgumentsSha256:operationInputDigest({...argumentsValue,prompt:'Changed prompt'})})).rejects.toMatchObject({code:'IMAGE_TURN_SOURCE_MISMATCH'});
  await expect(claimImageExecutionOnClient(f.client,context,claim,executionSource)).resolves.toEqual(claim);
});
