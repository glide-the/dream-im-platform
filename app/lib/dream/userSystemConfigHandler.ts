// [Input] Configured service, live OAuth token and closed user SystemConfig operation envelope.
// [Output] Exact raw read or same-UOW patch/receipt/audit through the mandatory fixed codec.
// [Pos] Thin account-config ingress; entity grants and caller identities cannot manage settings.
// [Sync] 2026-09-15: register OAuth-only user get/patch without Runtime or generic database selectors.
// [Sync] 2026-09-28: allow only scheduled source-fenced server-persistence grant to reuse the exact Thread config read for get.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";
import { identitySchemaRequirement } from "./schemaRequirements";
import { userSystemConfigOperationContracts as contracts, type UserSystemConfigOperation } from "./userSystemConfigDto";
import { runUserSystemConfigOperation, userSystemConfigSchemaRequirements, type UserSystemConfigCodec } from "./userSystemConfigService";
import { encodeUserSystemConfig } from "./userSystemConfigCodec";
import { DelegationService } from "../auth/delegationService";
import { DelegationRepository } from "../auth/delegationRepository";
import { runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement, scheduledChatRuntimeSchemaRequirement } from "./schemaRequirements";
import { chatScheduledTaskSchemaRequirement, chatScheduledTurnBindingSchemaRequirement, chatScheduledLinkLifecycleSchemaRequirement } from "./chatScheduledTaskService";
import { runThreadSystemConfigOperation } from "./threadSystemConfigService";
export function isUserSystemConfigOperation(name: string): name is UserSystemConfigOperation { return Object.hasOwn(contracts, name); }
export async function handleUserSystemConfig(request: Request, name: string, codec: UserSystemConfigCodec = encodeUserSystemConfig) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isUserSystemConfigOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = contracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const delegated = bearer.startsWith("idg_");
    return withDataTransaction([identitySchemaRequirement, ...userSystemConfigSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement,
        chatScheduledTaskSchemaRequirement, chatScheduledTurnBindingSchemaRequirement, chatScheduledLinkLifecycleSchemaRequirement, scheduledChatRuntimeSchemaRequirement] : [])], async tx => {
      if (delegated) {
        if (name !== "user-system-config.get") throw new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403);
        const authority = await new DelegationService(tx).resolve(bearer, "dream:read", service.id);
        const source = await new DelegationRepository(tx).lock(authority.tokenHash);
        if (!source || source.authoritySource !== "scheduled-chat-authority" || authority.purpose !== "server-persistence"
          || authority.runId !== null || authority.editorSessionId !== null) throw new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403);
        return runThreadSystemConfigOperation("thread-system-config.get", { thread_id: authority.threadId },
          { principal: authority.principal, threadScope: authority.threadId, runScope: null, editorSessionScope: null }, tx, codec);
      }
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      const actor = { principal, threadScope: null, runScope: null, editorSessionScope: null };
      const action = () => runUserSystemConfigOperation(name, envelope.input, actor, tx, codec);
      return operation.kind === "read" ? action() : new ReceiptRepository(tx, service.id, principal.subject)
        .execute(name, envelope.request_id, envelope.input, operation.output as z.ZodType, action);
    });
  });
}
