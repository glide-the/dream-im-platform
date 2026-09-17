// [Input] Configured Dream service, OAuth/server-persistence bearer and one Registry134-147 envelope.
// [Output] Capability-gated managed-MCP result from one Admin-owned DTO/Drizzle transaction.
// [Pos] Thin internal ingress; no MCP SDK, plaintext credential, generic CRUD or caller-selected actor.
// [Sync] 2026-09-16: register the complete managed-MCP persistence interface.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { DelegationService } from "../auth/delegationService";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { managedMcpOperationContracts, type ManagedMcpOperation } from "./managedMcpDto";
import { managedMcpSchemaRequirements, runManagedMcpOperation, type ManagedMcpActor } from "./managedMcpService";
import { ReceiptRepository } from "./receipts";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";

export function isManagedMcpOperation(name: string): name is ManagedMcpOperation {
  return Object.hasOwn(managedMcpOperationContracts, name);
}

export async function handleManagedMcp(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isManagedMcpOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = managedMcpOperationContracts[name];
    const envelope = await parseAuthDto(
      request,
      z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")),
    );
    setRequestId(envelope.request_id);
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const delegated = token.startsWith("idg_");
    const requirements = [
      identitySchemaRequirement,
      ...managedMcpSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : []),
    ];
    return withDataTransaction(requirements, async tx => {
      let actor: ManagedMcpActor;
      if (delegated) {
        if (envelope.input.authority === null) {
          throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
        }
        const resolved = await new DelegationService(tx).resolve(
          token,
          operation.userScope,
          service.id,
          envelope.input.authority.thread_id,
          envelope.input.authority.workflow_run_id,
          null,
        );
        if (resolved.purpose !== "server-persistence" || resolved.editorSessionId !== null) {
          throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
        }
        actor = {
          principal: resolved.principal,
          threadScope: resolved.threadId,
          runScope: resolved.runId,
          delegationPurpose: "server-persistence",
        };
      } else {
        if (envelope.input.authority !== null) {
          throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
        }
        actor = {
          principal: await principalForServiceToken(tx, token, service, operation.userScope),
          threadScope: null,
          runScope: null,
          delegationPurpose: null,
        };
      }
      const action = () => runManagedMcpOperation(name, envelope.input, actor, tx);
      if (operation.kind === "read") return action();
      return new ReceiptRepository(tx, service.id, actor.principal.subject).execute(
        name,
        envelope.request_id,
        envelope.input,
        operation.output as z.ZodType,
        action,
        actor.threadScope,
        null,
        actor.runScope,
      );
    });
  });
}
