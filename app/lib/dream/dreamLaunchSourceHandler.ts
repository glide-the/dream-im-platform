// [Input] Configured service OAuth and closed source ensure or replay lookup envelope.
// [Output] Capability-gated source write or actor-scoped frozen replay identity.
// [Pos] Registered thin launch source ingress; full preparation/Runtime are separate domains.
// [Sync] 2026-09-16: route Registry133 read with dream:read while retaining ensure write UOW.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { dreamLaunchReplayOperationContracts, dreamLaunchSourceEnsureInputDto,
  dreamLaunchSourceOperationContracts } from "./dreamLaunchSourceDto";
import { dreamLaunchSourceSchemaRequirements, ensureDreamLaunchSource, lookupDreamLaunchReplay } from "./dreamLaunchSourceService";
export function isDreamLaunchSourceOperation(name: string) {
  return Object.hasOwn(dreamLaunchSourceOperationContracts, name) || Object.hasOwn(dreamLaunchReplayOperationContracts, name);
}
export async function handleDreamLaunchSource(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isDreamLaunchSourceOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: dreamLaunchSourceEnsureInputDto }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    return withDataTransaction(dreamLaunchSourceSchemaRequirements, async tx => {
      const scope = name === "dream-launch-replay.lookup" ? "dream:read" : "dream:write";
      const principal = await principalForServiceToken(tx, token, service, scope);
      const actor = { principal, threadScope: null, runScope: null };
      return name === "dream-launch-replay.lookup"
        ? lookupDreamLaunchReplay(envelope.input, actor, tx)
        : ensureDreamLaunchSource(envelope.input, actor, service.id, envelope.request_id, tx);
    });
  });
}
