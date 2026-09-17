// [Input] Strict default Workspace service/DTO, repository and existing receipt seams.
// [Output] Provider-free original-ID/current-owner/entity/scope and atomic error assertions.
// [Pos] Candidate validation; actual PostgreSQL concurrency/rollback awaits registered public gate.
// [Sync] 2026-09-15: exercise closed actor-independent input and bounded original replay.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DataTransaction } from "./database";
import { ReceiptRepository, operationInputDigest } from "./receipts";
import { WorkspaceDefaultRepository } from "./workspaceDefaultRepository";
import { workspaceDefaultEnsureInputDto } from "./workspaceDefaultDto";
import { executeWorkspaceDefaultEnsure, requireOwnedWorkspaceDefaultResult, type WorkspaceDefaultActor } from "./workspaceDefaultService";
const tx = {} as DataTransaction;
const actor: WorkspaceDefaultActor = { principal: {subject: "workspace-sub", canonical_user_id: "9007199254740993",
  client_id: "dream-browser", scopes: ["dream:write"], status: "active"}, threadScope: null, runScope: null, editorSessionScope: null };
const requestId = "3183f39f-87f2-4603-b460-5376b79d5a71";
beforeEach(() => {
  vi.spyOn(WorkspaceDefaultRepository.prototype, "lockActor").mockResolvedValue(undefined);
  vi.spyOn(ReceiptRepository.prototype, "find").mockResolvedValue(null);
  vi.spyOn(ReceiptRepository.prototype, "execute").mockImplementation(async (_op, _req, _input, _output, action) => action());
});
afterEach(() => vi.restoreAllMocks());
it.each(["user_id", "actor", "workspace_id", "name", "settings", "table", "sql"])("rejects caller %s", key => {
  expect(workspaceDefaultEnsureInputDto.safeParse({[key]: "caller"}).success).toBe(false);
});
it("returns an existing legacy ID without insertion", async () => {
  vi.spyOn(WorkspaceDefaultRepository.prototype, "oldestOwned").mockResolvedValue({id: "legacy-workspace"});
  const insert = vi.spyOn(WorkspaceDefaultRepository.prototype, "insert");
  expect(await executeWorkspaceDefaultEnsure(tx, "dream-service", requestId, {}, actor)).toEqual({workspace_id: "legacy-workspace"});
  expect(insert).not.toHaveBeenCalled();
});
it("creates a UUID only for an absent owned Workspace", async () => {
  vi.spyOn(WorkspaceDefaultRepository.prototype, "oldestOwned").mockResolvedValue(null);
  const insert = vi.spyOn(WorkspaceDefaultRepository.prototype, "insert").mockResolvedValue(undefined);
  const result = await executeWorkspaceDefaultEnsure(tx, "dream-service", requestId, {}, actor);
  expect(result.workspace_id).toMatch(/^[0-9a-f-]{36}$/); expect(insert).toHaveBeenCalledWith(result.workspace_id);
});
it("does not return or receipt a partial insert failure", async () => {
  vi.spyOn(WorkspaceDefaultRepository.prototype, "oldestOwned").mockResolvedValue(null);
  vi.spyOn(WorkspaceDefaultRepository.prototype, "insert").mockRejectedValue(new Error("insert failed"));
  await expect(executeWorkspaceDefaultEnsure(tx, "dream-service", requestId, {}, actor)).rejects.toThrow("insert failed");
});
it("rejects readonly before repository access", async () => {
  await expect(executeWorkspaceDefaultEnsure(tx, "dream-service", requestId, {}, {...actor, principal: {...actor.principal, scopes: ["dream:read"]}})).rejects.toMatchObject({code: "DREAM_SCOPE_REQUIRED", status: 403});
  expect(WorkspaceDefaultRepository.prototype.lockActor).not.toHaveBeenCalled();
});
it.each(["threadScope", "runScope", "editorSessionScope"] as const)("rejects %s delegation", async key => {
  await expect(executeWorkspaceDefaultEnsure(tx, "dream-service", requestId, {}, {...actor, [key]: "entity"})).rejects.toMatchObject({code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403});
});
it("rejects inactive principal", async () => {
  const invalid = {...actor, principal: {...actor.principal, status: "disabled"}} as unknown as WorkspaceDefaultActor;
  await expect(executeWorkspaceDefaultEnsure(tx, "dream-service", requestId, {}, invalid)).rejects.toMatchObject({code: "DREAM_PRINCIPAL_INVALID", status: 403});
});
it("validates the exact decimal owner of original bounded result", async () => {
  const owned = vi.spyOn(WorkspaceDefaultRepository.prototype, "owned").mockResolvedValue({id: "legacy-workspace"});
  expect(await requireOwnedWorkspaceDefaultResult(tx, actor.principal.canonical_user_id, {workspace_id: "legacy-workspace"})).toEqual({workspace_id: "legacy-workspace"});
  expect(owned).toHaveBeenCalledWith("legacy-workspace");
});
it("denies deleted or foreign original result", async () => {
  vi.spyOn(WorkspaceDefaultRepository.prototype, "owned").mockResolvedValue(null);
  await expect(requireOwnedWorkspaceDefaultResult(tx, actor.principal.canonical_user_id, {workspace_id: "gone"})).rejects.toMatchObject({code: "WORKSPACE_DEFAULT_PERMISSION_DENIED", status: 403});
});
it("rejects corrupted original result before query", async () => {
  const owned = vi.spyOn(WorkspaceDefaultRepository.prototype, "owned");
  await expect(requireOwnedWorkspaceDefaultResult(tx, actor.principal.canonical_user_id, {workspace_id: "owned", actor: "caller"})).rejects.toMatchObject({code: "WORKSPACE_DEFAULT_DATA_INVALID", status: 503});
  expect(owned).not.toHaveBeenCalled();
});
it("checks current owner before same-request receipt replay", async () => {
  vi.mocked(ReceiptRepository.prototype.find).mockResolvedValue({inputSha256: operationInputDigest({}), result: {workspace_id: "old"}, threadScope: null, runScope: null, editorSessionScope: null});
  vi.spyOn(WorkspaceDefaultRepository.prototype, "owned").mockResolvedValue(null);
  await expect(executeWorkspaceDefaultEnsure(tx, "dream-service", requestId, {}, actor)).rejects.toMatchObject({code: "WORKSPACE_DEFAULT_PERMISSION_DENIED"});
  expect(ReceiptRepository.prototype.execute).not.toHaveBeenCalled();
});
it("rejects receipt input or entity binding drift", async () => {
  vi.mocked(ReceiptRepository.prototype.find).mockResolvedValue({inputSha256: operationInputDigest({}), result: {workspace_id: "old"}, threadScope: "thread", runScope: null, editorSessionScope: null});
  await expect(executeWorkspaceDefaultEnsure(tx, "dream-service", requestId, {}, actor)).rejects.toMatchObject({code: "OPERATION_REQUEST_CONFLICT", status: 409});
});
