// [Input] Current OAuth principals and original full save/delete receipts on fixed UOW seams.
// [Output] Bounded recovery, identity/scopes/corruption failures and unchanged later configuration.
// [Pos] Bounded recovery tests; no SQL, codec, pool or public Route execution.
// [Sync] 2026-09-15: retain immutable completion without reapplying prompts or a prior no-op reset.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), identity: vi.fn() }));
vi.mock("./receipts", () => ({ ReceiptRepository: class {
  constructor(_tx: unknown, service: string, subject: string) { mocks.identity(service, subject); }
  find = mocks.find;
} }));
import type { PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { isReflectionsSectionConfigReceiptOperation, readOriginalReflectionsSectionConfigReceipt } from "./reflectionsSectionConfigOriginalReceiptService";

const principal: PrincipalDto = { subject: "original-subject", canonical_user_id: "9007199254740993",
  client_id: "browser", scopes: ["dream:read", "dream:write"], status: "active" };
const service = "configured-service", save = "reflections-section-config.save", remove = "reflections-section-config.delete";
const methods = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), execute: vi.fn() };
const tx = methods as unknown as DataTransaction;
const stored = (result: unknown) => ({ inputSha256: "a".repeat(64), result, threadScope: null, editorSessionScope: null, runScope: null });
function read(name = save, actor = principal, request = "original") {
  return readOriginalReflectionsSectionConfigReceipt(tx, service, actor, name, request);
}
function assertNoConfigAccess() { for (const method of Object.values(methods)) expect(method).not.toHaveBeenCalled(); }
beforeEach(() => {
  vi.resetAllMocks();
  for (const method of Object.values(methods)) method.mockImplementation(() => { throw new Error("Unexpected configuration access"); });
  mocks.find.mockResolvedValue(stored({ saved: true }));
});

it("admits only the two original write operation names", () => {
  expect(isReflectionsSectionConfigReceiptOperation(save)).toBe(true);
  expect(isReflectionsSectionConfigReceiptOperation(remove)).toBe(true);
  for (const name of ["reflections-section-config.get", "__proto__", "constructor", "other"])
    expect(isReflectionsSectionConfigReceiptOperation(name)).toBe(false);
});
it("returns absent without looking up or creating configuration", async () => {
  mocks.find.mockResolvedValue(null);
  expect(await read()).toEqual({ status: "absent", operation: save, request_id: "original" });
  expect(mocks.identity).toHaveBeenCalledExactlyOnceWith(service, principal.subject);
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith(save, "original"); assertNoConfigAccess();
});
it("binds recovery to the configured service and current subject, never the decimal canonical ID", async () => {
  const other = { ...principal, subject: "other-subject", canonical_user_id: "9007199254740995" };
  mocks.find.mockResolvedValue(null);
  expect(await read(save, other)).toMatchObject({ status: "absent" });
  expect(mocks.identity).toHaveBeenCalledExactlyOnceWith(service, other.subject); assertNoConfigAccess();
});
it.each([[save, { saved: true }], [remove, { deleted: true }], [remove, { deleted: false }]])(
  "returns the complete original %s result %j", async (name, result) => {
    mocks.find.mockResolvedValue(stored(result));
    expect(await read(name as string)).toEqual({ status: "committed", operation: name, request_id: "original", result });
    assertNoConfigAccess();
  },
);
it("save and prior no-op delete recovery preserve a later configuration without reapplying either command", async () => {
  const laterConfig = { section: "echoes", prompt_files: '{"WORKFLOW.md":"后来正文😀"}', updated_at: "2026-09-15T01:02:03.123456Z" };
  const before = structuredClone(laterConfig);
  mocks.find.mockResolvedValueOnce(stored({ saved: true })).mockResolvedValueOnce(stored({ deleted: false }));
  expect(await read()).toMatchObject({ result: { saved: true } });
  expect(await read(remove)).toMatchObject({ result: { deleted: false } });
  expect(laterConfig).toEqual(before); assertNoConfigAccess();
});
it("rejects read-only or invalid live principals before receipt lookup", async () => {
  await expect(read(save, { ...principal, scopes: ["dream:read"] })).rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
  for (const patch of [{ status: "disabled" }, { canonical_user_id: "0" }, { canonical_user_id: 9007199254740992 }])
    await expect(read(save, { ...principal, ...patch } as PrincipalDto)).rejects.toMatchObject({ code: "DREAM_PRINCIPAL_INVALID", status: 403 });
  expect(mocks.find).not.toHaveBeenCalled(); assertNoConfigAccess();
});
it("rejects unknown/read operations and invalid original request IDs before receipt lookup", async () => {
  for (const name of ["reflections-section-config.get", "__proto__", "other"])
    await expect(read(name)).rejects.toMatchObject({ code: "OPERATION_UNAVAILABLE", status: 404 });
  for (const request of ["", " original", "original?section=echoes"])
    await expect(read(save, principal, request)).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
  expect(mocks.find).not.toHaveBeenCalled(); assertNoConfigAccess();
});
it.each(["threadScope", "editorSessionScope", "runScope"])("rejects a stored %s on account configuration", async key => {
  mocks.find.mockResolvedValue({ ...stored({ saved: true }), [key]: "entity" });
  await expect(read()).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 }); assertNoConfigAccess();
});
it("rejects malformed stored input hashes without inferring an original body from later config", async () => {
  for (const inputSha256 of [null, "short", "A".repeat(64)]) {
    mocks.find.mockResolvedValue({ ...stored({ saved: true }), inputSha256 });
    await expect(read()).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 });
  }
  assertNoConfigAccess();
});
it("fails closed for incomplete, mismatched, nonboolean or extra-field stored results", async () => {
  for (const [name, result] of [[save, {}], [save, { saved: false }], [save, { saved: true, prompt_files_json: "caller" }],
    [remove, { saved: true }], [remove, { deleted: "false" }], [remove, null]]) {
    mocks.find.mockResolvedValue(stored(result));
    await expect(read(name as string)).rejects.toMatchObject({ code: "REFLECTIONS_SECTION_CONFIG_RECEIPT_INVALID", status: 503 });
  }
  assertNoConfigAccess();
});
it("propagates receipt storage failures rather than reporting absence or reissuing a write", async () => {
  mocks.find.mockRejectedValue(new Error("Receipt store unavailable"));
  await expect(read()).rejects.toThrow("Receipt store unavailable"); assertNoConfigAccess();
});
