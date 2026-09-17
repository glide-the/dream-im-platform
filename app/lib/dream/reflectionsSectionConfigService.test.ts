// [Input] Closed custom-prompt DTOs, current OAuth owner, raw legacy storage and existing UOW seams.
// [Output] Exact raw/fallback/ownership/replay/atomic-failure evidence without persistent database writes.
// [Pos] Registered-domain tests; cloned rollback remains separate from real PostgreSQL fault proof.
// [Sync] 2026-09-15: retain prompt bytes and original reset no-op through Registry83 publication.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), remove: vi.fn(), receipt: vi.fn() }));
vi.mock("./reflectionsSectionConfigRepository", () => ({ ReflectionsSectionConfigRepository: class { get = mocks.get; save = mocks.save; delete = mocks.remove; } }));
vi.mock("./receipts", async original => ({ ...await original<typeof import("./receipts")>(), ReceiptRepository: class { execute = mocks.receipt; } }));
import type { DataTransaction } from "./database";
import { operationInputDigest } from "./receipts";
import { reflectionsSectionConfigSaveDto, type ReflectionsSectionConfigOperation } from "./reflectionsSectionConfigDto";
import { runReflectionsSectionConfigOperation } from "./reflectionsSectionConfigService";
const actor = { principal: { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read", "dream:write"], status: "active" as const },
  threadScope: null as string | null, runScope: null as string | null, editorSessionScope: null as string | null };
const tx = {} as DataTransaction, lookup = { section: "echoes" }, raw = '{"WORKFLOW.md": "正文😀", "MEMORY_QUERY_PROMPT.md": "问"}', input = { ...lookup, prompt_files_json: raw };
let state: { raw: string | null; receipts: Map<string, { digest: string; result: unknown }>; events: string[] };
let fault: string | null;
async function run(name: ReflectionsSectionConfigOperation, value: unknown = lookup, auth = actor, requestId = "original") {
  const before = structuredClone(state);
  try { return await runReflectionsSectionConfigOperation(name, value, auth, tx, "service", requestId); } catch (error) { state = before; throw error; }
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "5000"); fault = null; state = { raw, receipts: new Map(), events: [] };
  mocks.get.mockImplementation(async () => state.raw === null ? null : { prompt_files: state.raw });
  mocks.save.mockImplementation(async (_section, text) => { if (fault === "save") throw new Error("Injected save fault"); state.raw = text; state.events.push("save"); });
  mocks.remove.mockImplementation(async () => { const deleted = state.raw !== null; state.raw = null; state.events.push("delete"); return deleted; });
  mocks.receipt.mockImplementation(async (name: string, requestId: string, value: unknown, output: z.ZodType, action: () => Promise<unknown>) => {
    const key = `${name}/${requestId}`, digest = operationInputDigest(value), prior = state.receipts.get(key);
    if (prior) { if (prior.digest !== digest) throw new Error("Original request conflict"); return output.parse(prior.result); }
    const result = output.parse(await action()); if (fault === "receipt") throw new Error("Injected receipt fault");
    state.receipts.set(key, { digest, result }); state.events.push("receipt"); if (fault === "audit") throw new Error("Injected audit fault"); state.events.push("audit"); return result;
  });
});
afterEach(() => vi.unstubAllEnvs());
it("reads exact legacy custom JSON including unknown keys, bigint, float and negative zero without repair", async () => {
  state.raw = '{"unknown":9007199254740993,"float":1.0,"negative":-0.0,"WORKFLOW.md":"正文😀"}'; const before = structuredClone(state);
  expect(await run("reflections-section-config.get")).toEqual({ prompt_files_json: state.raw }); expect(state).toEqual(before); expect(mocks.receipt).not.toHaveBeenCalled();
});
it("returns null for missing config without storing defaults", async () => {
  state.raw = null; expect(await run("reflections-section-config.get")).toEqual({ prompt_files_json: null }); expect(state.events).toEqual([]);
});
it("preserves original empty stored text as the empty custom object", async () => {
  state.raw = ""; expect(await run("reflections-section-config.get")).toEqual({ prompt_files_json: "{}" }); expect(state.raw).toBe("");
});
it.each(["broken", "[]", "null", "1"])("retains original fallback to null for %s without repair", async value => {
  state.raw = value; const before = structuredClone(state); expect(await run("reflections-section-config.get")).toEqual({ prompt_files_json: null }); expect(state).toEqual(before);
});
it("stores original Dream filtered serializer text with one bounded receipt/audit", async () => {
  expect(reflectionsSectionConfigSaveDto.parse(input)).toEqual(input); expect(await run("reflections-section-config.save", input)).toEqual({ saved: true });
  expect(mocks.save).toHaveBeenCalledExactlyOnceWith("echoes", raw); expect(state.events).toEqual(["save", "receipt", "audit"]);
});
it("same original save recovery cannot overwrite a later configuration and changed raw input conflicts", async () => {
  const result = await run("reflections-section-config.save", input); state.raw = '{"WORKFLOW.md":"后来"}'; const before = structuredClone(state);
  expect(await run("reflections-section-config.save", input)).toEqual(result); expect(state).toEqual(before);
  await expect(run("reflections-section-config.save", { ...input, prompt_files_json: '{"WORKFLOW.md":"不同"}' })).rejects.toThrow("Original request conflict"); expect(state).toEqual(before);
});
it("delete retains the original true/false reset semantics and committed no-op recovery", async () => {
  expect(await run("reflections-section-config.delete")).toEqual({ deleted: true });
  expect(await run("reflections-section-config.delete", lookup, actor, "absent")).toEqual({ deleted: false }); state.raw = raw; const before = structuredClone(state);
  expect(await run("reflections-section-config.delete", lookup, actor, "absent")).toEqual({ deleted: false }); expect(state).toEqual(before);
});
it.each(["save", "receipt", "audit"])("%s failure rolls back config and receipt/audit in this caller UOW harness", async stage => {
  fault = stage; const before = structuredClone(state); await expect(run("reflections-section-config.save", input)).rejects.toThrow("Injected"); expect(state).toEqual(before);
});
it("rejects wrong section, arbitrary files, invalid/empty JSON and unfiltered strings before persistence", async () => {
  for (const text of ["broken", "[]", "{}", '{"OTHER.md":"正文"}', '{"WORKFLOW.md":1}', '{"WORKFLOW.md":""}', '{"WORKFLOW.md":" 正文 "}', '{"WORKFLOW.md":"\u001c"}'])
    await expect(run("reflections-section-config.save", { ...input, prompt_files_json: text })).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
  await expect(run("reflections-section-config.get", { section: "other" })).rejects.toMatchObject({ status: 400 }); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("rejects caller actor/SQL/path/effective/default selectors", async () => {
  for (const key of ["actor_id", "user_id", "sql", "path", "effective", "default", "revision"])
    await expect(run("reflections-section-config.save", { ...input, [key]: "caller" })).rejects.toMatchObject({ status: 400 }); expect(state.events).toEqual([]);
});
it("rejects insufficient scope and every entity scope before business queries", async () => {
  await expect(run("reflections-section-config.save", input, { ...actor, principal: { ...actor.principal, scopes: ["dream:read"] } })).rejects.toMatchObject({ status: 403 });
  for (const key of ["threadScope", "runScope", "editorSessionScope"])
    await expect(run("reflections-section-config.get", lookup, { ...actor, [key]: "entity" })).rejects.toMatchObject({ code: "DELEGATION_ENTITY_DENIED", status: 403 });
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("propagates storage/codec unavailability rather than reporting missing config", async () => {
  mocks.get.mockRejectedValueOnce(new Error("Unavailable storage")); await expect(run("reflections-section-config.get")).rejects.toThrow("Unavailable storage");
  vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "invalid"); await expect(run("reflections-section-config.get")).rejects.toMatchObject({ status: 503 }); expect(state.events).toEqual([]);
});
