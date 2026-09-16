// [Input] Registered Registry175-184 name, service identity, optional OAuth bearer and strict envelope.
// [Output] DTO-validated Claude Plugin result; writes commit domain state, receipt and audit in one transaction.
// [Pos] Thin OAuth/background ingress; no filesystem, CLI or generic database dispatch.
// [Sync] 2026-09-16: admit scoped builtin reconciliation without a fabricated user principal.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { requireBackgroundScope } from "../auth/serviceIdentity";
import { identitySchemaRequirement } from "./schemaRequirements";
import { withDataTransaction } from "./database";
import { claudePluginOperationContracts, type ClaudePluginBackgroundOperation, type ClaudePluginOperation } from "./claudePluginDataDto";
import { claudePluginDataSchemaRequirements, runClaudePluginBackgroundOperation, runClaudePluginOperation } from "./claudePluginDataService";
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
      if (operation.audience === "background") {
        if (request.headers.has("authorization")) throw new AuthBoundaryError("CLAUDE_PLUGIN_BROWSER_CREDENTIAL_FORBIDDEN", 400);
        requireBackgroundScope(service, "plugins:catalog");
        const action = () => runClaudePluginBackgroundOperation(name as ClaudePluginBackgroundOperation, envelope.input, service, tx);
        return new ReceiptRepository(tx, service.id, `background:${service.id}`)
          .execute(name, envelope.request_id, envelope.input, operation.output as z.ZodType, action);
      }
      const principal = await principalForServiceToken(tx,
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      const action = () => runClaudePluginOperation(name, envelope.input, principal, tx);
      return operation.kind === "read" ? action() : new ReceiptRepository(tx, service.id, principal.subject)
        .execute(name, envelope.request_id, envelope.input, operation.output as z.ZodType, action);
    });
  });
}
