// [Input] Configured service OAuth and the one closed hidden-source ensure envelope.
// [Output] Capability-gated source/result/audit in the same live-owner Admin transaction.
// [Pos] Registered thin launch source ingress; full preparation/Runtime are separate domains.
// [Sync] 2026-09-15: require OAuth write authority without entity grants or caller control metadata.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { dreamLaunchSourceEnsureInputDto } from "./dreamLaunchSourceDto";
import { dreamLaunchSourceSchemaRequirements, ensureDreamLaunchSource } from "./dreamLaunchSourceService";
export async function handleDreamLaunchSource(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (name !== "dream-launch-source.ensure") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: dreamLaunchSourceEnsureInputDto }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    return withDataTransaction(dreamLaunchSourceSchemaRequirements, async tx => {
      const principal = await principalForServiceToken(tx, token, service, "dream:write");
      return ensureDreamLaunchSource(envelope.input, { principal, threadScope: null, runScope: null }, service.id, envelope.request_id, tx);
    });
  });
}
