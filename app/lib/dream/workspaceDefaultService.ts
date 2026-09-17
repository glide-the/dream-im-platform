// [Input] Live OAuth write actor, empty request, original receipt identity and existing Admin UOW.
// [Output] Original owned default ID with result/audit atomicity and current-owner bounded replay.
// [Pos] Registered76 Workspace service; producer owns ingress/capabilities and original GET wiring.
// [Sync] 2026-09-15: retain actor initialization/receipt locking; registered76 OAuth-only public acceptance pending.
import { randomUUID } from "node:crypto";
import { AuthBoundaryError } from "../auth/config";
import { principalDto, requestIdDto, type PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { ReceiptRepository, operationInputDigest } from "./receipts";
import { WorkspaceDefaultRepository } from "./workspaceDefaultRepository";
import { workspaceDefaultEnsureInputDto, workspaceDefaultEnsureOutputDto } from "./workspaceDefaultDto";
export const workspaceDefaultSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;
export type WorkspaceDefaultActor = { principal: PrincipalDto; threadScope: string | null;
  runScope: string | null; editorSessionScope: string | null };
export function requireWorkspaceDefaultActor(actor: WorkspaceDefaultActor) {
  const parsed = principalDto.safeParse(actor.principal);
  if (!parsed.success) throw new AuthBoundaryError("DREAM_PRINCIPAL_INVALID", 403);
  if (!parsed.data.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null || actor.runScope !== null || actor.editorSessionScope !== null)
    throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  return parsed.data;
}
export async function requireOwnedWorkspaceDefaultResult(tx: DataTransaction, canonicalActor: string, rawResult: unknown) {
  const result = workspaceDefaultEnsureOutputDto.safeParse(rawResult);
  if (!result.success) throw new AuthBoundaryError("WORKSPACE_DEFAULT_DATA_INVALID");
  if (!(await new WorkspaceDefaultRepository(tx, canonicalActor).owned(result.data.workspace_id)))
    throw new AuthBoundaryError("WORKSPACE_DEFAULT_PERMISSION_DENIED", 403);
  return result.data;
}
export async function executeWorkspaceDefaultEnsure(tx: DataTransaction, serviceId: string, requestId: string,
  rawInput: unknown, actor: WorkspaceDefaultActor) {
  const parsed = workspaceDefaultEnsureInputDto.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = requireWorkspaceDefaultActor(actor), id = requestIdDto.parse(requestId);
  const store = new WorkspaceDefaultRepository(tx, principal.canonical_user_id);
  await store.lockActor();
  const receipts = new ReceiptRepository(tx, serviceId, principal.subject);
  const prior = await receipts.find("workspace-default.ensure", id);
  if (prior) {
    if (prior.inputSha256 !== operationInputDigest(parsed.data) || prior.threadScope !== null ||
      prior.runScope !== null || prior.editorSessionScope !== null)
      throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
    await requireOwnedWorkspaceDefaultResult(tx, principal.canonical_user_id, prior.result);
  }
  return receipts.execute("workspace-default.ensure", id, parsed.data, workspaceDefaultEnsureOutputDto, async () => {
    const oldest = await store.oldestOwned();
    if (oldest) return { workspace_id: oldest.id };
    const workspaceId = randomUUID();
    await store.insert(workspaceId);
    return { workspace_id: workspaceId };
  });
}
