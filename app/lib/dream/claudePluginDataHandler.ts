// [Input] Registered Registry175-182 name, service-bound OAuth request and strict operation envelope.
// [Output] DTO-validated Claude Plugin result; writes commit domain state, receipt and audit in one transaction.
// [Pos] Thin OAuth ingress; no filesystem, CLI or generic database dispatch.
// [Sync] 2026-09-16: expose Admin-owned Claude Plugin persistence operations.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { identitySchemaRequirement } from "./schemaRequirements";
import { withDataTransaction } from "./database";
import { claudePluginOperationContracts, type ClaudePluginOperation } from "./claudePluginDataDto";
import { claudePluginDataSchemaRequirements, runClaudePluginOperation } from "./claudePluginDataService";
import { ReceiptRepository } from "./receipts";

export function isClaudePluginOperation(name: string): name is ClaudePluginOperation {
  return Object.hasOwn(claudePluginOperationContracts, name);
}

export async function handleClaudePluginOperation(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isClaudePluginOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = claudePluginOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...claudePluginDataSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(tx,
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      const action = () => runClaudePluginOperation(name, envelope.input, principal, tx);
      return operation.kind === "read" ? action() : new ReceiptRepository(tx, service.id, principal.subject)
        .execute(name, envelope.request_id, envelope.input, operation.output as z.ZodType, action);
    });
  });
}
