// [Input] Registered history operation, confidential service and delegated OAuth request.
// [Output] Read-only owner-scoped dispatch under published existing schema capabilities.
// [Pos] Reflections history ingress; persistence and rules stay in Repository/Service.
// [Sync] 2026-10-14: additive closed history operation without changing old descriptors.
import { z } from "zod";
import { requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, reflectionTaskSchemaRequirements } from "./schemaRequirements";
import { reflectionHistoryInputDto } from "./reflectionHistoryDto";
import { readReflectionHistory } from "./reflectionHistoryService";

export async function handleReflectionHistory(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: reflectionHistoryInputDto }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...reflectionTaskSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, "dream:read");
      return readReflectionHistory(envelope.input, { principal, threadScope: null, editorSessionScope: null, runScope: null }, tx);
    });
  });
}
