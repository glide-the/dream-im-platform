// [Input] Configured Dream service, OAuth or exact turn grant and Registry169 envelope.
// [Output] Capability-gated auto-repair settlement from one Admin transaction.
// [Pos] Thin ingress; validation, authorization, ORM and receipt live in the domain service.
// [Sync] 2026-09-16: expose Registry169 without generic message mutation.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { requireDataActor } from "./principal";
import { dreamAutoRepairOperationContracts, type DreamAutoRepairOperation } from "./dreamAutoRepairDto";
import { dreamAutoRepairSchemaRequirements, runDreamAutoRepairOperation } from "./dreamAutoRepairService";

export function isDreamAutoRepairOperation(name: string): name is DreamAutoRepairOperation {
  return Object.hasOwn(dreamAutoRepairOperationContracts, name);
}

export async function handleDreamAutoRepair(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isDreamAutoRepairOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = dreamAutoRepairOperationContracts[name];
    const envelope = await parseAuthDto(request,
      z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const delegated = request.headers.get("authorization")?.startsWith("Bearer idg_");
    return withDataTransaction([
      identitySchemaRequirement,
      ...dreamAutoRepairSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : []),
    ], async tx => {
      const actor = await requireDataActor(tx, request.headers, service, operation.userScope,
        envelope.input.thread_id, undefined, name);
      return runDreamAutoRepairOperation(name, envelope.input, actor, service.id, envelope.request_id, tx);
    });
  });
}
