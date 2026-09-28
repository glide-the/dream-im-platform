// [Input] Service-bound OAuth or exact Thread Runtime grant and strict Workflow context request.
// [Output] Validated server-derived context from the same capability-gated data transaction.
// [Pos] Thin domain orchestration; entity grants cannot acquire new Workflow activation authority.
// [Sync] 2026-09-28: allow exact source Thread claim grants to read context for task-result continuation.
// [Sync] 2026-09-14: accept the public production operation envelope and exclude external actor selectors.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { DelegationService } from "../auth/delegationService";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { requireDataActor } from "./principal";
import { workflowContextInputDto, workflowContextOutputDto } from "./workflowContextDto";
import { authoritativeWorkflowContext } from "./workflowContextService";

export async function handleWorkflowContext(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const input = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: workflowContextInputDto }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(input.request_id);
    const delegated = (request.headers.get("authorization") ?? "").startsWith("Bearer idg_");
    const requirements = [identitySchemaRequirement, dreamUnifiedSchemaRequirement,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : [])];
    return withDataTransaction(requirements, async tx => {
      let canonicalUserId: string;
      if (delegated) {
        const token = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
        const grant = await new DelegationService(tx).resolve(token, "dream:read", service.id, input.input.thread_id);
        if (grant.purpose !== "server-persistence" || grant.editorSessionId !== null || grant.runId !== null)
          throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
        canonicalUserId = grant.principal.canonical_user_id;
      } else {
        const actor = await requireDataActor(tx, request.headers, service, "dream:read", input.input.thread_id,
          undefined, "workflow-context.resolve");
        canonicalUserId = actor.principal.canonical_user_id;
      }
      return workflowContextOutputDto.parse({ context: await authoritativeWorkflowContext(
        tx, canonicalUserId, input.input.thread_id,
      ) });
    });
  });
}
