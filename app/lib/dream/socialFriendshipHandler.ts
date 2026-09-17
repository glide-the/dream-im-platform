// [Input] Configured service, bound OAuth and one closed original social request.
// [Output] Coordinator-owned strict relationship projection or same-UOW result/receipt/audit.
// [Pos] Thin Social ingress; persistence entity bearers cannot act on friendships or invitations.
// [Sync] 2026-09-15: compose verified nine contracts through existing OAuth/UOW/receipt boundaries.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement } from "./schemaRequirements";
import { ReceiptRepository } from "./receipts";
import { socialFriendshipOperationContracts, type SocialFriendshipOperation } from "./socialFriendshipDto";
import { runSocialFriendshipOperation, socialFriendshipSchemaRequirements } from "./socialFriendshipService";
export function isSocialFriendshipOperation(name: string): name is SocialFriendshipOperation { return Object.hasOwn(socialFriendshipOperationContracts, name); }
export async function handleSocialFriendship(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isSocialFriendshipOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = socialFriendshipOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...socialFriendshipSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      const action = () => runSocialFriendshipOperation(name, envelope.input, { principal, threadScope: null }, tx);
      return operation.kind === "read" ? action() : new ReceiptRepository(tx, service.id, principal.subject).execute(name, envelope.request_id, envelope.input, operation.output as z.ZodType, action);
    });
  });
}
