// [Input] Original empty-input Workspace receipt and current canonical ownership.
// [Output] Exact legacy ID recovery and denied/corrupt/absent evidence without initialization.
// [Pos] Provider-free original domain gate; primary's initialization service tests stay separate.
// [Sync] 2026-09-15: preserve text IDs and require null scopes/empty input digest/current owner.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), owned: vi.fn(), oldest: vi.fn(), insert: vi.fn() }));
vi.mock("./receipts", async original => ({ ...await original<typeof import("./receipts")>(), ReceiptRepository: class { find = mocks.find; } }));
vi.mock("./workspaceDefaultRepository", () => ({ WorkspaceDefaultRepository: class { owned = mocks.owned; oldestOwned = mocks.oldest; insert = mocks.insert; } }));
import type { DataTransaction } from "./database";
import { operationInputDigest } from "./receipts";
import { readOriginalWorkspaceDefaultReceipt } from "./workspaceDefaultOriginalReceiptService";
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const };
const result = { workspace_id: "legacy-workspace-text-id" };
let prior: { result: unknown; inputSha256: string; threadScope: string | null; editorSessionScope: string | null; runScope: string | null };
const tx = {} as DataTransaction;
const read = (name = "workspace-default.ensure", identity = principal) => readOriginalWorkspaceDefaultReceipt(tx, "service", identity, name, "original");
beforeEach(() => {
  vi.resetAllMocks(); prior = { result, inputSha256: operationInputDigest({}), threadScope: null, editorSessionScope: null, runScope: null };
  mocks.find.mockImplementation(() => structuredClone(prior)); mocks.owned.mockResolvedValue({ id: result.workspace_id });
});
it("recovers the complete original legacy ID from current ownership without creating or selecting a newer default", async () => {
  expect(await read()).toEqual({ status: "committed", operation: "workspace-default.ensure", request_id: "original", result });
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith("workspace-default.ensure", "original");
  expect(mocks.owned).toHaveBeenCalledExactlyOnceWith(result.workspace_id); expect(mocks.oldest).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
});
it("returns only explicit absent when this service/subject has no committed original", async () => {
  mocks.find.mockResolvedValueOnce(null); expect(await read()).toEqual({ status: "absent", operation: "workspace-default.ensure", request_id: "original" });
  expect(mocks.owned).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
});
it.each(["threadScope", "editorSessionScope", "runScope", "inputSha256"])("rejects changed original %s before reading the Workspace", async field => {
  Object.assign(prior, { [field]: "other" }); await expect(read()).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 }); expect(mocks.owned).not.toHaveBeenCalled();
});
it("denies a removed or transferred Workspace instead of returning a historical foreign ID", async () => {
  mocks.owned.mockResolvedValueOnce(null); await expect(read()).rejects.toMatchObject({ code: "WORKSPACE_DEFAULT_PERMISSION_DENIED", status: 403 }); expect(mocks.insert).not.toHaveBeenCalled();
});
it("fails closed on a corrupt or broadened original output", async () => {
  for (const changed of [{}, { ...result, settings: {} }, { workspace_id: "" }]) {
    prior.result = changed; await expect(read()).rejects.toMatchObject({ code: "WORKSPACE_DEFAULT_DATA_INVALID", status: 503 });
  }
  expect(mocks.owned).not.toHaveBeenCalled();
});
it("rejects read-only identity and unrelated operation before original lookup", async () => {
  await expect(read(undefined, { ...principal, scopes: ["dream:read"] })).rejects.toMatchObject({ status: 403 });
  await expect(read("workspace-default.replace")).rejects.toMatchObject({ status: 404 }); expect(mocks.find).not.toHaveBeenCalled();
});
