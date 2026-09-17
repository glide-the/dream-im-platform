// [Input] Injected durable confirmation/Run scope, raw codec and controlled wall clock.
// [Output] Preserved newer claims and safe rejection of forged/stale/control namespace writes.
// [Pos] Provider-free tests of the production persistence guard; no replacement claim state machine.
// [Sync] 2026-09-15: existing DB metadata classifies control even when request kind is ordinary.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ message: vi.fn(), owns: vi.fn(), analyze: vi.fn(), claims: vi.fn(), canonical: vi.fn() }));
vi.mock("./confirmationGuardRepository", () => ({ ConfirmationGuardRepository: class { message = mocks.message; ownsRun = mocks.owns; } }));
vi.mock("./deckContentCanonical", () => ({ analyzeConfirmationEnvelope: mocks.analyze, compareConfirmationClaims: mocks.claims, canonicalBusinessJson: mocks.canonical }));
import { guardPersistedDreamConfirmation } from "./confirmationGuard";
import { AuthBoundaryError } from "../auth/config";
import type { DataTransaction } from "./database";
const actor = "9007199254740993", messageId = `dream_confirm_${"a".repeat(64)}`, runId = `run_${"b".repeat(32)}`;
const now = Date.parse("2026-09-15T00:00:00Z"), tx = {} as DataTransaction;
const fingerprint = `sha256:${"c".repeat(64)}`;
function metadata(lease = now / 1_000 + 120) { return { kind: "story-workspace-dream-confirmation", actor, thread_id: "thread1", story_workspace_run_id: runId, idempotency_key: "swc_1", request_id: "request1", command_fingerprint: fingerprint, dispatch_status: "dispatching", dispatch_claim_id: "claim1", dispatch_claim_lease_until: lease }; }
const parts = '[{"type":"text","text":"confirmation envelope"}]';
function row() { return { id: messageId, thread_id: "thread1", role: "user", parts_json: parts, metadata_json: JSON.stringify(metadata()), user_id: actor }; }
function input() { return { thread_id: "thread1", message_id: messageId, parts_json: parts, metadata_json: JSON.stringify(metadata(now / 1_000 + 60)) }; }
const guard = (value = input()) => guardPersistedDreamConfirmation(tx, actor, value);
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  mocks.message.mockResolvedValue(row()); mocks.owns.mockResolvedValue(true); mocks.claims.mockResolvedValue({ equal: true });
  mocks.canonical.mockResolvedValue({ canonical_json: parts });
  mocks.analyze.mockResolvedValue({ status: "valid", story_workspace_run_id: runId, thread_id: "thread1", idempotency_key: "swc_1", command_json: "{}", command_fingerprint: fingerprint, message_id: messageId, parts_canonical_json: parts });
});
afterEach(() => vi.useRealTimers());
describe("durable confirmation persistence protection", () => {
  it("accepts an older queued lease and preserves the durable row without writing it", async () => {
    const stored = row(); mocks.message.mockResolvedValue(stored);
    expect(await guard()).toBe(true);
    expect(stored.metadata_json).toBe(JSON.stringify(metadata()));
    expect(mocks.analyze).toHaveBeenCalledWith(parts, actor); expect(mocks.owns).toHaveBeenCalledWith(actor, "thread1", runId);
    expect(mocks.claims).toHaveBeenCalledWith(stored.metadata_json, input().metadata_json);
  });
  it("returns false only for unambiguously ordinary stored and requested Chat data", async () => {
    mocks.message.mockResolvedValue({ ...row(), id: "ordinary1", metadata_json: "{}" });
    expect(await guard({ ...input(), message_id: "ordinary1", metadata_json: null })).toBe(false);
    expect(mocks.analyze).not.toHaveBeenCalled();
    mocks.message.mockResolvedValue(null);
    expect(await guard({ ...input(), message_id: "new-ordinary", metadata_json: null })).toBe(false);
  });
  it("does not trust ordinary request kind over the database control row", async () => {
    mocks.message.mockResolvedValue({ ...row(), id: "legacy-control" });
    await expect(guard({ ...input(), message_id: "legacy-control", metadata_json: "{}" })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  });
  it("refuses a missing reserved row or a request claiming control without stored authority", async () => {
    mocks.message.mockResolvedValue(null);
    await expect(guard()).rejects.toMatchObject({ status: 409 });
    await expect(guard({ ...input(), message_id: "new-id" })).rejects.toMatchObject({ status: 409 });
  });
  it.each([{ user_id: "2" }, { role: "assistant" }, { thread_id: "other" }, { metadata_json: "[]" }, { parts_json: null }])("refuses malformed or unrelated durable facts %j", async change => {
    mocks.message.mockResolvedValue({ ...row(), ...change }); await expect(guard()).rejects.toMatchObject({ status: 409 });
  });
  it.each([{ actor: "2" }, { thread_id: "other" }, { story_workspace_run_id: "other" }, { idempotency_key: "swc_other" }, { command_fingerprint: "forged" }, { request_id: "" }])("refuses changed stored identity %j", async change => {
    mocks.message.mockResolvedValue({ ...row(), metadata_json: JSON.stringify({ ...metadata(), ...change }) }); await expect(guard()).rejects.toMatchObject({ status: 409 });
  });
  it.each([true, -1, null, now / 1_000, now / 1_000 - 1])("refuses invalid/expired authoritative lease %j", async lease => {
    mocks.message.mockResolvedValue({ ...row(), metadata_json: JSON.stringify({ ...metadata(), dispatch_claim_lease_until: lease }) }); await expect(guard()).rejects.toMatchObject({ status: 409 });
  });
  it.each([true, -1, null, now / 1_000 + 121])("refuses invalid or newer request lease %j", async lease => {
    await expect(guard({ ...input(), metadata_json: JSON.stringify({ ...metadata(), dispatch_claim_lease_until: lease }) })).rejects.toMatchObject({ status: 409 });
  });
  it("rejects failed dispatch, changed claim identity, invalid envelope, parts or Run ownership", async () => {
    await expect(guard({ ...input(), metadata_json: JSON.stringify({ ...metadata(), dispatch_status: "done" }) })).rejects.toMatchObject({ status: 409 });
    mocks.claims.mockResolvedValueOnce({ equal: false }); await expect(guard()).rejects.toMatchObject({ status: 409 });
    mocks.analyze.mockResolvedValueOnce({ status: "invalid" }); await expect(guard()).rejects.toMatchObject({ status: 409 });
    mocks.canonical.mockResolvedValueOnce({ canonical_json: "different" }); await expect(guard()).rejects.toMatchObject({ status: 409 });
    mocks.owns.mockResolvedValueOnce(false); await expect(guard()).rejects.toMatchObject({ status: 409 });
  });
  it("reports DB/codec unavailability separately without reflecting stored data", async () => {
    mocks.message.mockRejectedValueOnce(new Error("private database details")); await expect(guard()).rejects.toMatchObject({ code: "DECK_RUNTIME_CONFIG_UNAVAILABLE", status: 503 });
    mocks.owns.mockRejectedValueOnce(new Error("private SQL")); await expect(guard()).rejects.toMatchObject({ status: 503 });
    mocks.analyze.mockRejectedValueOnce(new AuthBoundaryError("DECK_CANONICAL_UNAVAILABLE")); await expect(guard()).rejects.toMatchObject({ status: 503 });
  });
});
