// [Input] Actual replay service with fixed typed repository facts and canonical source semantics.
// [Output] Null/frozen replay DTO plus permission, source and idempotency conflict failures.
// [Pos] Provider-free Registry133 domain regression; PostgreSQL role evidence is covered by launch contract E2E.
// [Sync] 2026-09-16: prove replay is actor-derived, read-scoped and exact-content bounded.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireScope: vi.fn(), scopedReplay: vi.fn(), existingMessage: vi.fn() }));
vi.mock("./dreamLaunchSourceRepository", () => ({ DreamLaunchSourceRepository: class {
  constructor() { Object.assign(this, mocks); }
} }));
import type { DataTransaction } from "./database";
import { lookupDreamLaunchReplay } from "./dreamLaunchSourceService";
import { dreamLaunchSourceEnvelope, dreamLaunchSourceIdentity } from "./dreamLaunchSourceSemantics";
import { canonicalBusinessJson } from "./deckContentCanonical";

const canonical = "9007199254740993";
const input = { workspace_id: "workspace", deck_id: "deck", agent_id: "agent", goal: "目标😀", idempotency_key: "key:one" };
const actor = { principal: { subject: "subject", canonical_user_id: canonical, client_id: "browser",
  scopes: ["dream:read"], status: "active" as const }, threadScope: null, runScope: null };
const time = "2026-09-16T01:02:03.123456+00:00";

beforeEach(async () => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "5000");
  const identity = await dreamLaunchSourceIdentity(canonical, input);
  mocks.existingMessage.mockResolvedValue({ thread_id: identity.threadId, role: "user", user_id: canonical,
    deck_id: input.deck_id, voice_id: input.agent_id, created_at: time,
    metadata: dreamLaunchSourceEnvelope(canonical, input, identity.requestFingerprint).metadata });
  mocks.scopedReplay.mockResolvedValue({ workflow_run_id: `run_${"a".repeat(32)}`,
    workflow_preflight_id: `pf_${"b".repeat(32)}`, source_voice_thread_id: identity.threadId,
    source_message_id: identity.messageId, source_message_time: time,
    input_hash: (await canonicalBusinessJson(JSON.stringify({ goal: input.goal }))).content_hash,
    preflight_deck_id: input.deck_id, preflight_created_by: canonical });
});
afterEach(() => vi.unstubAllEnvs());

it("returns the exact frozen Run/source identity without exposing actor or persistence fields", async () => {
  const identity = await dreamLaunchSourceIdentity(canonical, input);
  await expect(lookupDreamLaunchReplay(input, actor, {} as DataTransaction)).resolves.toEqual({ replay: {
    workflow_run_id: `run_${"a".repeat(32)}`, workflow_preflight_id: `pf_${"b".repeat(32)}`,
    thread_id: identity.threadId, message_id: identity.messageId } });
  expect(mocks.requireScope).toHaveBeenCalledWith(input.workspace_id, input.deck_id);
  expect(mocks.scopedReplay).toHaveBeenCalledWith(input.workspace_id, input.idempotency_key);
});

it("returns null before source inspection when the business key has no Run", async () => {
  mocks.scopedReplay.mockResolvedValueOnce(null);
  await expect(lookupDreamLaunchReplay(input, actor, {} as DataTransaction)).resolves.toEqual({ replay: null });
  expect(mocks.existingMessage).not.toHaveBeenCalled();
});

it.each([
  ["preflight_deck_id", "other"], ["preflight_created_by", "9007199254740994"],
  ["source_voice_thread_id", "other"], ["source_message_id", "other"],
  ["source_message_time", "2026-09-16T01:02:04.123456+00:00"], ["input_hash", `sha256:${"0".repeat(64)}`],
])("rejects replay with conflicting %s", async (field, value) => {
  mocks.scopedReplay.mockResolvedValueOnce({ ...await mocks.scopedReplay(), [field]: value });
  await expect(lookupDreamLaunchReplay(input, actor, {} as DataTransaction))
    .rejects.toMatchObject({ code: "DREAM_LAUNCH_IDEMPOTENCY_CONFLICT", status: 409 });
});

it("fails closed for missing source and non-read/entity-scoped principals", async () => {
  mocks.existingMessage.mockResolvedValueOnce(null);
  await expect(lookupDreamLaunchReplay(input, actor, {} as DataTransaction))
    .rejects.toMatchObject({ code: "DREAM_LAUNCH_SOURCE_UNAVAILABLE", status: 503 });
  await expect(lookupDreamLaunchReplay(input, { ...actor, principal: { ...actor.principal, scopes: ["dream:write"] } }, {} as DataTransaction))
    .rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
  await expect(lookupDreamLaunchReplay(input, { ...actor, runScope: "run" }, {} as DataTransaction))
    .rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
});
