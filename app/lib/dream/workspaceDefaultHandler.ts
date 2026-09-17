// [Input] Configured service OAuth and a closed empty default Workspace envelope.
// [Output] Exact-capability and live-owner gated default result/audit in the existing Admin UOW.
// [Pos] Thin named Workspace ingress; domain initialization remains in the primary-owned service.
// [Sync] 2026-09-15: admit OAuth write only and preserve legacy text Workspace identifiers.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement } from "./schemaRequirements";
import { workspaceDefaultEnsureInputDto } from "./workspaceDefaultDto";
import { executeWorkspaceDefaultEnsure, workspaceDefaultSchemaRequirements } from "./workspaceDefaultService";
export const workspaceDefaultIngressSchemaRequirements = [identitySchemaRequirement, ...workspaceDefaultSchemaRequirements] as const;
export async function handleWorkspaceDefault(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (name !== "workspace-default.ensure") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: workspaceDefaultEnsureInputDto }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction(workspaceDefaultIngressSchemaRequirements, async tx => {
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, "dream:write");
      return executeWorkspaceDefaultEnsure(tx, service.id, envelope.request_id, envelope.input, { principal, threadScope: null, runScope: null, editorSessionScope: null });
    });
  });
}
