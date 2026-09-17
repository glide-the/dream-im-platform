// [Input] Actual original launch command/application/ensure-source methods on fixed facts and clock.
// [Output] Full command/UUID/hash/source and fresh/replay INSERT parameter/commit parity.
// [Pos] Provider-free launch source gate; no production route registration or PostgreSQL access.
// [Sync] 2026-09-15: cover actual application source callsite and null-Agent fingerprint omission.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { dreamLaunchCommandFields, dreamLaunchSourceEnsureInputDto } from "./dreamLaunchSourceDto";
import { dreamLaunchSourceEnvelope, dreamLaunchSourceIdentity } from "./dreamLaunchSourceSemantics";

function oracle(input: unknown) {
  const result = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", ["-B", resolve(process.cwd(), "tests/integration/dreamLaunchSourceOracle.py")],
    { env: process.env, encoding: "utf8", timeout: 10_000, input: JSON.stringify(input) });
  expect((result.error as NodeJS.ErrnoException | undefined)?.code ?? null, "Actual source interpreter must launch; body/stderr stay private").toBeNull();
  expect(result.status, "Actual original source must finish").toBe(0);
  return JSON.parse(result.stdout);
}
const actor = "9007199254740993", clock = "2026-09-14T00:00:00.123456+00:00";
const base = { workspace_id: "workspace_中文😀", deck_id: "deck", agent_id: null, goal: "目标 é😀", idempotency_key: "launch-key:1" };
afterEach(() => vi.unstubAllEnvs());
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual launch command Unicode and boundary whitespace validation", () => {
  const values = [base, { ...base, deck_id: "😀".repeat(255) }, { ...base, deck_id: "😀".repeat(256) },
    { ...base, goal: "😀".repeat(12000) }, { ...base, goal: "😀".repeat(12001) }, { ...base, goal: "\u001c目标" },
    { ...base, goal: "\ufeff" }, { ...base, agent_id: " agent " }, { ...base, idempotency_key: "key/invalid" }, { ...base, idempotency_key: "key😀" }];
  const expected = oracle({ action: "command", cases: values.map(value => ({ deckId: value.deck_id, agentId: value.agent_id, goal: value.goal, idempotencyKey: value.idempotency_key })) });
  const commandDto = z.strictObject(dreamLaunchCommandFields);
  values.forEach((value, index) => {
    const { workspace_id: ignored, ...command } = value; void ignored;
    const actual = commandDto.safeParse(command);
    expect(actual.success).toBe(expected[index].accepted);
    if (actual.success) expect(actual.data).toEqual(expected[index].command);
  });
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual deterministic UUIDv5 and request fingerprint on exact decimal and Unicode scope", async () => {
  vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000");
  const cases = [{ actor, input: base }, { actor, input: { ...base, goal: "different content" } },
    { actor: "9007199254740994", input: base }, { actor, input: { ...base, workspace_id: "other_workspace" } },
    { actor, input: { ...base, agent_id: "agent😀", idempotency_key: "other-key" } }];
  const expected = oracle({ action: "identity", cases });
  for (const [index, value] of cases.entries()) expect(await dreamLaunchSourceIdentity(value.actor, value.input)).toEqual(expected[index]);
  expect(expected[0].threadId).toBe(expected[1].threadId); expect(expected[0].messageId).toBe(expected[1].messageId);
  expect(expected[0].requestFingerprint).not.toBe(expected[1].requestFingerprint);
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual application source call arguments after prepare for null and explicit Agent", async () => {
  vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000");
  const cases = [{ actor, input: base }, { actor, input: { ...base, agent_id: "agent😀" } },
    { actor, input: { ...base, goal: "different content" } }, { actor: "9007199254740994", input: base },
    { actor, input: { ...base, workspace_id: "other_workspace" } }];
  const expected = oracle({ action: "application-source", cases });
  for (const [index, value] of cases.entries()) {
    const identity = await dreamLaunchSourceIdentity(value.actor, value.input);
    expect(expected[index].events).toEqual(["prepare", "source"]);
    expect(expected[index].arguments).toEqual({ actor_id: value.actor, workspace_id: value.input.workspace_id,
      deck_id: value.input.deck_id, agent_id: value.input.agent_id, goal: value.input.goal, idempotency_key: value.input.idempotency_key,
      request_fingerprint: identity.requestFingerprint, thread_id: identity.threadId, message_id: identity.messageId });
  }
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual fresh source projection, title, hidden metadata and all backing INSERT parameters", async () => {
  vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000");
  const input = { ...base, goal: "😀".repeat(81), agent_id: "agent" }, identity = await dreamLaunchSourceIdentity(actor, input);
  const args = { actor_id: actor, workspace_id: input.workspace_id, deck_id: input.deck_id, agent_id: input.agent_id, goal: input.goal,
    idempotency_key: input.idempotency_key, request_fingerprint: identity.requestFingerprint, thread_id: identity.threadId, message_id: identity.messageId };
  const result = oracle({ action: "ensure", arguments: args, clock, results: [null, { id: input.deck_id }, null, null, null, null, null] });
  expect(result.source).toEqual({ thread_id: identity.threadId, message_id: identity.messageId, message_time: clock, request_fingerprint: identity.requestFingerprint, created: true });
  const envelope = dreamLaunchSourceEnvelope(actor, input, identity.requestFingerprint);
  expect(result.parameters[4]).toEqual([identity.threadId, actor, envelope.title, input.deck_id, input.agent_id]);
  expect(result.parameters[5]).toEqual([identity.messageId, identity.threadId, envelope.parts, envelope.metadata, clock]);
  expect(result.parameters[6]).toEqual([clock, identity.threadId]); expect(result.commits).toBe(1); expect(result.rollbacks).toBe(0);
  expect(envelope.title).toBe("Dream · " + "😀".repeat(80)); expect(JSON.parse(envelope.metadata)).not.toHaveProperty("workflowRunId");
});
it("rejects caller IDs, fingerprint, actor and hidden metadata at the closed boundary", () => {
  expect(dreamLaunchSourceEnsureInputDto.safeParse(base).success).toBe(true);
  for (const field of ["actor_id", "thread_id", "message_id", "request_fingerprint", "metadata", "workflow_run_id"])
    expect(dreamLaunchSourceEnsureInputDto.safeParse({ ...base, [field]: "caller" }).success).toBe(false);
});
