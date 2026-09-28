// [Input] Registered scheduled Chat operation, configured service and OAuth, exact Thread delegation or background credential.
// [Output] Strict capability-gated DTO from one Admin transaction with owner receipts or service audit.
// [Pos] Thin scheduled Chat ingress; business time, status and SQL remain in the domain service.
// [Sync] 2026-09-28: distinguish user and worker audiences and keep bearer-bearing prepare/renew outputs out of receipts.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { adminAuditLogs } from "@ink-memory/db/schema";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { DelegationService } from "../auth/delegationService";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { hasDelegatedUserBearer } from "../auth/serviceIdentity";
import { withDataTransaction } from "./database";
import { chatScheduledTaskOperationContracts, type ChatScheduledBackgroundOperation, type ChatScheduledTaskOperation, type ChatScheduledUserOperation } from "./chatScheduledTaskDto";
import { chatScheduledTaskSchemaRequirements, runChatScheduledBackgroundOperation, runChatScheduledUserOperation } from "./chatScheduledTaskService";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement, scheduledChatRuntimeSchemaRequirement } from "./schemaRequirements";
import { ReceiptRepository, operationInputDigest } from "./receipts";
import { resolveScheduledChatAuthority } from "./chatScheduledTaskAuthority";

export function isChatScheduledTaskOperation(name: string): name is ChatScheduledTaskOperation { return Object.hasOwn(chatScheduledTaskOperationContracts, name); }
export async function handleChatScheduledTaskOperation(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isChatScheduledTaskOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const contract = chatScheduledTaskOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: contract.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    if (contract.audience === "background") {
      const resolveAuthority = name === "scheduled-trigger.authority.resolve";
      if ((!resolveAuthority && hasDelegatedUserBearer(request)) || request.headers.has("cookie")) throw new AuthBoundaryError("SCHEDULE_BROWSER_CREDENTIAL_FORBIDDEN", 400);
      return withDataTransaction([identitySchemaRequirement, ...chatScheduledTaskSchemaRequirements,
        scheduledChatRuntimeSchemaRequirement], async tx => {
        if (resolveAuthority) {
          if (!service.backgroundScopes.includes("schedule:execute")) throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
          if (!hasDelegatedUserBearer(request)) throw new AuthBoundaryError("SCHEDULE_SERVICE_REQUIRED", 401);
          const bearer = request.headers.get("authorization") ?? "";
          if (!bearer.startsWith("Bearer sta_")) throw new AuthBoundaryError("SCHEDULE_AUTHORITY_REQUIRED", 401);
          const authority = await resolveScheduledChatAuthority(tx, bearer.slice(7), name, service.id);
          return contract.output.parse({ trigger_id: authority.triggerId, claim_id: authority.claimId,
            service_client_id: service.id, client_id: service.oauthClientId,
            subject: authority.principal.subject, canonical_user_id: authority.principal.canonical_user_id,
            source_thread_id: authority.sourceThreadScope, target_thread_id: authority.threadScope,
            scopes: authority.principal.scopes, purpose: "scheduled-chat-persistence",
            issued_at: authority.issuedAt.toISOString(), expires_at: authority.maximumExpiresAt.toISOString() });
        }
        const action = () => runChatScheduledBackgroundOperation(name as ChatScheduledBackgroundOperation, envelope.input, service, tx);
        if (name === "scheduled-trigger.prepare" || name === "scheduled-trigger.renew") {
          // The output contains an expiring bearer. Only a digest goes into durable audit; replay derives a new bearer from the same fenced trigger.
          const result = await action();
          await tx.insert(adminAuditLogs).values({ id: `audit_${randomUUID().replaceAll("-", "")}`, actor_type: "service",
            actor_id: service.id, action: `dream.${name}`, resource_type: "dream_operation",
            resource_id: operationInputDigest([service.id, name, envelope.request_id]), request_id: envelope.request_id,
            metadata: { input_sha256: operationInputDigest(envelope.input) } });
          return contract.output.parse(result);
        }
        return new ReceiptRepository(tx, service.id, "scheduled-task-worker").execute(name, envelope.request_id,
          envelope.input, contract.output as z.ZodType, action);
      });
    }
    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const delegated = bearer.startsWith("idg_");
    return withDataTransaction([identitySchemaRequirement, ...chatScheduledTaskSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : [])], async tx => {
      let actor;
      if (delegated) {
        if (name !== "scheduled-task.create") throw new AuthBoundaryError("SCHEDULE_DELEGATION_SCOPE_DENIED", 403);
        const sourceThreadId = (envelope.input as { source_thread_id: string }).source_thread_id;
        const resolved = await new DelegationService(tx).resolve(bearer, contract.userScope, service.id, sourceThreadId);
        if (resolved.purpose !== "server-persistence" || resolved.editorSessionId !== null || resolved.runId !== null) throw new AuthBoundaryError("SCHEDULE_DELEGATION_SCOPE_DENIED", 403);
        actor = { principal: resolved.principal, threadScope: resolved.threadId };
      } else {
        actor = { principal: await principalForServiceToken(tx, bearer, service, contract.userScope), threadScope: null };
      }
      const action = () => runChatScheduledUserOperation(name as ChatScheduledUserOperation, envelope.input, actor, tx, service.id);
      if (contract.kind === "read") return contract.output.parse(await action());
      const receiptId = name === "scheduled-task.run" ? (envelope.input as { manual_request_key: string }).manual_request_key : envelope.request_id;
      return new ReceiptRepository(tx, service.id, actor.principal.subject).execute(name, receiptId,
        envelope.input, contract.output as z.ZodType, action, actor.threadScope);
    });
  });
}
