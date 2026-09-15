// [Input] Named Session/Editor DTO through a service or an exact delegated opaque bearer.
// [Output] Strict domain result/receipt; stdio carries no service or database credential.
// [Pos] Thin ingress into Admin-owned Editor/Session UOW and authorization.
// [Sync] 2026-09-15: admit server-persistence only for Session list and editor-stdio for Editor state.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { DelegationService } from "../auth/delegationService";
import { withDataTransaction, type DataTransaction } from "./database";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { editorSessionOperationContracts, type EditorSessionOperation } from "./editorSessionDto";
import { runEditorSessionOperation, type EditorSessionActor } from "./editorSessionService";
import { ReceiptRepository } from "./receipts";
export function isEditorSessionOperation(name: string): name is EditorSessionOperation { return Object.hasOwn(editorSessionOperationContracts, name); }
const requirements = [identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement];
function delegationBearer(headers: Headers) {
  const token = headers.get("authorization")?.match(/^Bearer (idg_[A-Za-z0-9_-]{43})$/)?.[1];
  if (headers.has("cookie") || !token) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
  return token;
}
export async function editorActorForBearer(tx: DataTransaction, headers: Headers, scope: string, sessionId?: string, serviceId?: string): Promise<EditorSessionActor & { serviceId: string }> {
  const token = delegationBearer(headers);
  const actor = await new DelegationService(tx).resolve(token, scope, serviceId, undefined, undefined, sessionId);
  if (actor.purpose !== "editor-stdio" || actor.editorSessionId === null) throw new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403);
  return { principal: actor.principal, editorSessionScope: actor.editorSessionId, threadScope: actor.threadId, delegationPurpose: actor.purpose, serviceId: actor.serviceClientId };
}
async function persistenceSessionListActorForBearer(tx: DataTransaction, headers: Headers, scope: string, serviceId: string): Promise<EditorSessionActor & { serviceId: string }> {
  const actor = await new DelegationService(tx).resolve(delegationBearer(headers), scope, serviceId);
  if (actor.purpose !== "server-persistence" || actor.editorSessionId !== null) throw new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403);
  return { principal: actor.principal, editorSessionScope: null, threadScope: actor.threadId, delegationPurpose: actor.purpose, serviceId: actor.serviceClientId };
}
async function execute(tx: DataTransaction, serviceId: string, name: EditorSessionOperation, requestId: string, input: unknown, actor: EditorSessionActor) {
  const operation = editorSessionOperationContracts[name], action = () => runEditorSessionOperation(name, input, actor, tx);
  return operation.kind === "read" ? action() : new ReceiptRepository(tx, serviceId, actor.principal.subject).execute(name, requestId, input, operation.output as z.ZodType, action, actor.threadScope, actor.editorSessionScope);
}
export async function handleEditorSessionOperation(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isEditorSessionOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = editorSessionOperationContracts[name];
    const parsed = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES"))); setRequestId(parsed.request_id);
    const authorization = request.headers.get("authorization") ?? "", bearer = authorization.replace(/^Bearer /, ""), delegated = bearer.startsWith("idg_");
    return withDataTransaction([identitySchemaRequirement, runtimePurposeSchemaRequirement, ...(delegated ? [runtimeDelegationSchemaRequirement] : [])], async tx => {
      const sessionId = "session_id" in parsed.input ? parsed.input.session_id : undefined;
      const actor = delegated
        ? name === "session.list"
          ? await persistenceSessionListActorForBearer(tx, request.headers, operation.userScope, service.id)
          : await editorActorForBearer(tx, request.headers, operation.userScope, sessionId, service.id)
        : { principal: await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope), threadScope: null, editorSessionScope: null, delegationPurpose: null };
      return execute(tx, service.id, name, parsed.request_id, parsed.input, actor);
    });
  });
}
async function publicEditorRequest(action: (setRequestId: (id: string) => void) => Promise<unknown>) {
  let requestId = `editor_${randomUUID().replaceAll("-", "")}`;
  const headers = { "Cache-Control": "no-store" };
  try { return Response.json({ data: await action(id => { requestId = id; }), request_id: requestId }, { headers }); }
  catch (error) { return Response.json({ error: { code: error instanceof AuthBoundaryError ? error.code : "EDITOR_UNAVAILABLE", message: "The editor request could not be completed." }, request_id: requestId }, { status: error instanceof AuthBoundaryError ? error.status : 503, headers }); }
}
export async function handlePublicEditorOperation(request: Request, name: string) {
  return publicEditorRequest(async setRequestId => {
    if (name !== "editor-state.load" && name !== "editor-state.replace") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = editorSessionOperationContracts[name];
    const parsed = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES"))); setRequestId(parsed.request_id);
    return withDataTransaction(requirements, async tx => {
      const actor = await editorActorForBearer(tx, request.headers, operation.userScope, parsed.input.session_id);
      return execute(tx, actor.serviceId, name, parsed.request_id, parsed.input, actor);
    });
  });
}
export async function handlePublicEditorReceipt(request: Request, requestId: string) {
  return publicEditorRequest(async setRequestId => {
    const id = requestIdDto.safeParse(requestId); if (!id.success) throw new AuthBoundaryError("INPUT_INVALID", 400); setRequestId(id.data);
    const query = new URL(request.url).searchParams;
    if (query.size !== 1 || query.get("operation") !== "editor-state.replace") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    return withDataTransaction(requirements, async tx => {
      const actor = await editorActorForBearer(tx, request.headers, "editor:write");
      const row = await new ReceiptRepository(tx, actor.serviceId, actor.principal.subject).find("editor-state.replace", id.data);
      if (row && (row.threadScope !== actor.threadScope || row.editorSessionScope !== actor.editorSessionScope)) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
      return row ? { status: "committed", operation: "editor-state.replace", request_id: id.data, result: editorSessionOperationContracts["editor-state.replace"].output.parse(row.result) } : { status: "absent", operation: "editor-state.replace", request_id: id.data };
    });
  });
}
