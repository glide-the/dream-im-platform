// [Input] Configured service request, Registry120 operation name and strict request envelope.
// [Output] OAuth owner or service-only confirmation state transition in one capability-gated UOW.
// [Pos] Thin ingress; Admin Service/Repository own authorization, lifecycle and persistence.
// [Sync] 2026-09-16: expose the closed confirmation DTO/ORM operations.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement } from "./schemaRequirements";
import { storyWorkspaceConfirmationOperationContracts, type StoryWorkspaceConfirmationBackgroundOperation,
  type StoryWorkspaceConfirmationOAuthOperation, type StoryWorkspaceConfirmationOperation } from "./storyWorkspaceConfirmationDto";
import { runStoryWorkspaceConfirmationBackgroundOperation, runStoryWorkspaceConfirmationOAuthOperation,
  storyWorkspaceConfirmationSchemaRequirements } from "./storyWorkspaceConfirmationService";

export function isStoryWorkspaceConfirmationOperation(name: string): name is StoryWorkspaceConfirmationOperation {
  return Object.hasOwn(storyWorkspaceConfirmationOperationContracts, name);
}

export async function handleStoryWorkspaceConfirmation(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isStoryWorkspaceConfirmationOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = storyWorkspaceConfirmationOperationContracts[name];
    const envelope = await parseAuthDto(request,
      z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...storyWorkspaceConfirmationSchemaRequirements], async tx => {
      if (operation.audience === "background") {
        if (request.headers.has("authorization")) throw new AuthBoundaryError("CONFIRMATION_BROWSER_CREDENTIAL_FORBIDDEN", 400);
        return runStoryWorkspaceConfirmationBackgroundOperation(
          name as StoryWorkspaceConfirmationBackgroundOperation, envelope.input, service, tx,
        );
      }
      const principal = await principalForServiceToken(tx,
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      return runStoryWorkspaceConfirmationOAuthOperation(
        name as StoryWorkspaceConfirmationOAuthOperation, envelope.input, principal, service.id, envelope.request_id, tx,
      );
    });
  });
}
