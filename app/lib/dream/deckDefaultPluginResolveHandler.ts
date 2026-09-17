// [Input] Configured Dream service, OAuth bearer and one Registry104 empty read envelope.
// [Output] Strict configured default-plugin candidate from the existing capability-checked UOW.
// [Pos] Thin named ingress; policy, selection and storage validation remain in Service/Repository.
// [Sync] 2026-09-15: dispatch an OAuth-only read without receipt, evidence input or filesystem access.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { deckDefaultPluginResolveOperationContracts, type DeckDefaultPluginResolveOperation } from "./deckDefaultPluginResolveDto";
import { deckDefaultPluginResolveSchemaRequirements, runDeckDefaultPluginResolveOperation } from "./deckDefaultPluginResolveService";
import { identitySchemaRequirement } from "./schemaRequirements";

export function isDeckDefaultPluginResolveOperation(name: string): name is DeckDefaultPluginResolveOperation {
  return Object.hasOwn(deckDefaultPluginResolveOperationContracts, name);
}

export async function handleDeckDefaultPluginResolve(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isDeckDefaultPluginResolveOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = deckDefaultPluginResolveOperationContracts[name];
    const envelope = await parseAuthDto(
      request,
      z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")),
    );
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...deckDefaultPluginResolveSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(
        tx,
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
        service,
        operation.userScope,
      );
      return runDeckDefaultPluginResolveOperation(name, envelope.input, { principal, threadScope: null }, tx);
    });
  });
}
