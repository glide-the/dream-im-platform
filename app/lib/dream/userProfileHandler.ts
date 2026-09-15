// [Input] Service-authenticated current profile operation with strict empty input DTO.
// [Output] Current user DTO through capability-gated service/repository/UOW.
// [Pos] Thin profile request orchestration; no caller user_id or claim-built email.
import { z } from "zod";
import { requestIdDto } from "../auth/dto";
import { requiredAuthValue } from "../auth/config";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement } from "./schemaRequirements";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { userProfileInputDto } from "./userProfileDto";
import { currentUserProfile } from "./userProfileService";
export async function handleUserProfile(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const input = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: userProfileInputDto }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES"))); setRequestId(input.request_id);
    return withDataTransaction([identitySchemaRequirement], async tx => {
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, "dream:read");
      return currentUserProfile(tx, principal);
    });
  });
}
