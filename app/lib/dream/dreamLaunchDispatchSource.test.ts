// [Input] Fixed original context/lease vectors and an explicit read-only source interpreter.
// [Output] Pydantic codepoint/strip/default and microsecond legacy-time claim parity.
// [Pos] Provider-free actual-source gate; no DB, Runtime or copied dispatcher state machine.
// [Sync] 2026-09-15: preserve five-minute exact boundary, future, naive and offset claim semantics.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { dreamLaunchDispatchContextDto, dreamLaunchDispatchClaimInputDto, dreamLaunchDispatchFinishInputDto } from "./dreamLaunchDispatchDto";
import { inspectDreamLaunchEnvelope, overlayDreamLaunchClaim, overlayDreamLaunchFinish } from "./dreamLaunchDispatchCodec";
const clock = "2026-09-14T00:05:00.123456+00:00";
const context = { workflow_run_id: `run_${"a".repeat(32)}`, thread_id: "thread", deck_id: "deck", agent_id: null,
  deck_plugin_id: "plugin", deck_plugin_version: "1.0.0", deck_plugin_binding_id: "binding", binding_revision: 1,
  deck_runtime_snapshot_id: "snapshot", runtime_plugin_lock_id: "lock" };
function oracle(input: unknown) {
  const child = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", ["-B", resolve(process.cwd(), "tests/integration/dreamLaunchDispatchOracle.py")],
    { env: { PATH: process.env.PATH, INK_DREAM_SOURCE: process.env.INK_DREAM_SOURCE } as unknown as NodeJS.ProcessEnv,
      input: JSON.stringify(input), encoding: "utf8", timeout: 15000 });
  expect((child.error as NodeJS.ErrnoException | undefined)?.code ?? null).toBeNull(); expect(child.status, "Actual source must launch without publishing stderr/body").toBe(0);
  return JSON.parse(child.stdout);
}
afterEach(() => vi.unstubAllEnvs());
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual original context model strip/codepoints/default and physical revision boundaries", () => {
  const { agent_id: ignored, ...withoutAgent } = context; void ignored;
  const cases = [context, withoutAgent, { ...context, deck_plugin_id: `\u00a0${"😀".repeat(255)}\u00a0` },
    { ...context, deck_plugin_id: "😀".repeat(256) }, { ...context, deck_plugin_id: "\u001c" }, { ...context, deck_plugin_id: "\ufeff" },
    { ...context, binding_revision: true }, { ...context, binding_revision: 0 }, { ...context, binding_revision: 2147483647 }];
  const expected = oracle({ action: "context", cases });
  cases.forEach((value, index) => { const actual = dreamLaunchDispatchContextDto.safeParse(value); expect(actual.success).toBe(expected[index].accepted);
    if (actual.success) expect(actual.data).toEqual(expected[index].context); });
  expect(z.toJSONSchema(dreamLaunchDispatchContextDto).properties?.deck_plugin_id).toMatchObject({ maxLength: 255 });
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual original claim freshness at every microsecond/legacy-time boundary", async () => {
  vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000");
  const cases = [
    { dispatchStatus: "dispatching", dispatchClaimedAt: "2026-09-14T00:00:00.123457+00:00" },
    { dispatchStatus: "dispatching", dispatchClaimedAt: "2026-09-14T00:00:00.123456+00:00" },
    { dispatchStatus: "dispatching", dispatchClaimedAt: "2026-09-14T00:00:00.123455+00:00" },
    { dispatchStatus: "dispatching", dispatchClaimedAt: "2026-09-14T00:06:00.123456Z" },
    { dispatchStatus: "dispatching", dispatchClaimedAt: "2026-09-14T00:00:00.123457" },
    { dispatchStatus: "dispatching", dispatchClaimedAt: "2026-09-14T08:00:00.123457+08:00" },
    { dispatchStatus: "dispatching", dispatchClaimedAt: "invalid" },
    { dispatchStatus: "dispatching", dispatchClaimedAt: 123 }, { dispatchStatus: "pending", dispatchClaimedAt: clock }, {},
  ];
  const expected = oracle({ action: "fresh", cases: cases.map(metadata => ({ metadata, now: clock })) });
  for (const [index, metadata] of cases.entries()) expect((await inspectDreamLaunchEnvelope(JSON.stringify(metadata), clock)).claim_fresh).toBe(expected[index]);
});
it("keeps unknown raw metadata numeric categories through both fixed overlays and rejects nonfinite canonical output", async () => {
  vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000");
  const raw = '{"integer":9007199254740993,"float":1.0,"negative":-0.0,"nested":{"中文😀":9007199254740995}}';
  const claim = await overlayDreamLaunchClaim(raw, { context, claim_id: `dlc_${"b".repeat(32)}`, now: clock, project_slug: "proj-fixed", instruction_text: "目标😀" });
  const finished = await overlayDreamLaunchFinish(claim.metadata_json, false);
  for (const text of [claim.metadata_json, claim.runtime_metadata_json, finished.metadata_json]) {
    expect(text).toContain('"integer":9007199254740993'); expect(text).toContain('"float":1.0'); expect(text).toContain('"negative":-0.0'); expect(text).toContain('9007199254740995');
  }
  expect(finished.metadata_json).not.toContain("dispatchClaimId"); expect(finished.metadata_json).toContain('"dispatchStatus":"pending"');
  await expect(overlayDreamLaunchFinish('{"value":NaN}', true)).rejects.toMatchObject({ code: "DREAM_CODEC_UNAVAILABLE" });
});
it("rejects arbitrary actor/context/parts/metadata/status and caller-selected source identity in closed commands", () => {
  const lookup = { workspace_id: "workspace", workflow_run_id: context.workflow_run_id };
  for (const field of ["actor_id", "context", "parts", "metadata", "dispatch_status", "thread_id", "message_id"]) {
    expect(dreamLaunchDispatchClaimInputDto.safeParse({ ...lookup, instruction_text: "目标", [field]: "caller" }).success).toBe(false);
    expect(dreamLaunchDispatchFinishInputDto.safeParse({ ...lookup, claim_id: `dlc_${"b".repeat(32)}`, accepted: true, [field]: "caller" }).success).toBe(false);
  }
  expect(dreamLaunchDispatchFinishInputDto.safeParse({ ...lookup, claim_id: "caller", accepted: "true" }).success).toBe(false);
});
