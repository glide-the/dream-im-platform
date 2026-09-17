// [Input] Original user SystemConfig patch receipt and current live OAuth owner on captured storage seams.
// [Output] Bounded absent/committed result with strict digest, null entity scopes and no config reapply.
// [Pos] Original recovery domain gate; no current config read, codec, SQL selector or Runtime execution.
// [Sync] 2026-09-15: recover only the stored success bit for the exact service/subject/request tuple.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), identity: vi.fn() }));
vi.mock("./receipts", () => ({ ReceiptRepository: class {
  constructor(_tx: unknown, service: string, subject: string) { mocks.identity(service, subject); }
  find = mocks.find;
} }));
import type { PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { readOriginalUserSystemConfigReceipt } from "./userSystemConfigOriginalReceiptService";
const principal: PrincipalDto = { subject: "original-subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read", "dream:write"], status: "active" };
const name = "user-system-config.patch", service = "configured-service";
const methods = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), execute: vi.fn() };
const tx = methods as unknown as DataTransaction;
const stored = (result: unknown) => ({ inputSha256: "a".repeat(64), result, threadScope: null, editorSessionScope: null, runScope: null });
function read(operation = name, actor = principal, requestId = "original") { return readOriginalUserSystemConfigReceipt(tx, service, actor, operation, requestId); }
function assertNoConfigAccess() { for (const method of Object.values(methods)) expect(method).not.toHaveBeenCalled(); }
beforeEach(() => {
  vi.resetAllMocks(); for (const method of Object.values(methods)) method.mockImplementation(() => { throw new Error("Unexpected configuration access"); });
  mocks.find.mockResolvedValue(stored({ success: true }));
});
it("returns the complete immutable original result without reading or reapplying current config", async () => {
  expect(await read()).toEqual({ status: "committed", operation: name, request_id: "original", result: { success: true } });
  expect(mocks.identity).toHaveBeenCalledExactlyOnceWith(service, principal.subject); expect(mocks.find).toHaveBeenCalledExactlyOnceWith(name, "original"); assertNoConfigAccess();
});
it("returns explicit absence for the configured service and current subject", async () => {
  mocks.find.mockResolvedValueOnce(null); expect(await read()).toEqual({ status: "absent", operation: name, request_id: "original" });
  expect(mocks.identity).toHaveBeenCalledExactlyOnceWith(service, principal.subject); assertNoConfigAccess();
});
it("binds lookup to subject rather than caller or decimal canonical identity", async () => {
  const other = { ...principal, subject: "other-subject", canonical_user_id: "9007199254740995" }; mocks.find.mockResolvedValueOnce(null);
  expect(await read(name, other)).toMatchObject({ status: "absent" }); expect(mocks.identity).toHaveBeenCalledExactlyOnceWith(service, other.subject); assertNoConfigAccess();
});
it("rejects read-only and malformed principals before receipt lookup", async () => {
  await expect(read(name, { ...principal, scopes: ["dream:read"] })).rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
  for (const patch of [{ status: "disabled" }, { canonical_user_id: "0" }, { subject: "" }])
    await expect(read(name, { ...principal, ...patch } as PrincipalDto)).rejects.toMatchObject({ code: "DREAM_PRINCIPAL_INVALID", status: 403 });
  expect(mocks.find).not.toHaveBeenCalled(); assertNoConfigAccess();
});
it("rejects read/unknown operations and invalid request IDs before lookup", async () => {
  for (const operation of ["user-system-config.get", "__proto__", "other"])
    await expect(read(operation)).rejects.toMatchObject({ code: "OPERATION_UNAVAILABLE", status: 404 });
  for (const requestId of ["", " original", "original?actor=caller"])
    await expect(read(name, principal, requestId)).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
  expect(mocks.find).not.toHaveBeenCalled(); assertNoConfigAccess();
});
it.each(["threadScope", "editorSessionScope", "runScope"])("rejects stored %s instead of widening account authority", async key => {
  mocks.find.mockResolvedValueOnce({ ...stored({ success: true }), [key]: "entity" });
  await expect(read()).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 }); assertNoConfigAccess();
});
it("rejects malformed stored input hashes without reconstructing the old patch", async () => {
  for (const inputSha256 of [null, "short", "A".repeat(64)]) {
    mocks.find.mockResolvedValueOnce({ ...stored({ success: true }), inputSha256 });
    await expect(read()).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 });
  }
  assertNoConfigAccess();
});
it("fails closed for incomplete, false, extra-field or nonobject stored results", async () => {
  for (const result of [{}, { success: false }, { success: true, config_json: "later" }, null, "true"]) {
    mocks.find.mockResolvedValueOnce(stored(result));
    await expect(read()).rejects.toMatchObject({ code: "USER_SYSTEM_CONFIG_RECEIPT_INVALID", status: 503 });
  }
  assertNoConfigAccess();
});
it("propagates storage failure without reporting absence or reissuing the patch", async () => {
  mocks.find.mockRejectedValueOnce(new Error("Receipt store unavailable")); await expect(read()).rejects.toThrow("Receipt store unavailable"); assertNoConfigAccess();
});
