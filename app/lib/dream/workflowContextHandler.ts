// [Input] Service-bound OAuth and strict Thread-only Workflow context request.
// [Output] Validated server-derived context from the same capability-gated data transaction.
// [Pos] Thin domain orchestration; entity grants cannot acquire new Workflow activation authority.
// [Sync] 2026-09-14: accept the public production operation envelope and exclude external actor selectors.
import { z } from "zod";
import { requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement } from "./schemaRequirements";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { workflowContextInputDto, workflowContextOutputDto } from "./workflowContextDto";
import { authoritativeWorkflowContext } from "./workflowContextService";

export async function handleWorkflowContext(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const input = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: workflowContextInputDto }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(input.request_id);
    return withDataTransaction([identitySchemaRequirement, dreamUnifiedSchemaRequirement], async tx => {
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, "dream:read");
      return workflowContextOutputDto.parse({ context: await authoritativeWorkflowContext(tx, principal.canonical_user_id, input.input.thread_id) });
    });
  });
}
