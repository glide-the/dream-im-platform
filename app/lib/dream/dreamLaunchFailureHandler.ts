// [Input] Configured service and closed failed-Run envelope with the fixed server-only pure overlay.
// [Output] Live OAuth/original persistence grant, exact capabilities and independent envelope/result/audit UOW.
// [Pos] Registered77 thin failure ingress; same independent UOW, no new activation authority.
// [Sync] 2026-09-15: wire the fixed failure codec default and preserve original Run/Thread delegation.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { requireDataActor } from "./principal";
import { dreamLaunchFailureEnvelopeInputDto } from "./dreamLaunchFailureDto";
import { dreamLaunchFailureSchemaRequirements, persistDreamLaunchFailureEnvelope, type DreamLaunchFailureOverlay } from "./dreamLaunchFailureService";
import { encodeDreamLaunchFailureEnvelope } from "./dreamLaunchFailureCodec";
export async function handleDreamLaunchFailure(request: Request, name: string, overlay: DreamLaunchFailureOverlay = encodeDreamLaunchFailureEnvelope) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (name !== "dream-launch-failure.envelope") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: dreamLaunchFailureEnvelopeInputDto }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const delegated = request.headers.get("authorization")?.startsWith("Bearer idg_");
    return withDataTransaction([...dreamLaunchFailureSchemaRequirements, ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : [])], async tx => {
      const actor = await requireDataActor(tx, request.headers, service, "dream:write", undefined, envelope.input.workflow_run_id);
      return persistDreamLaunchFailureEnvelope(envelope.input, actor, service.id, envelope.request_id, tx, overlay);
    });
  });
}
