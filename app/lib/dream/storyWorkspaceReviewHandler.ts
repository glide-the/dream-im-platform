// [Input] Configured Dream service, OAuth bearer and one Registry111 review envelope.
// [Output] Capability-gated review result from a single Admin transaction.
// [Pos] Thin OAuth-only review ingress; Dream retains pages, orchestration, Runtime, SSE and files.
// [Sync] 2026-09-15: expose strict Story Workspace review operations without generic CRUD.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement } from "./schemaRequirements";
import { storyWorkspaceReviewOperationContracts, type StoryWorkspaceReviewOperation } from "./storyWorkspaceReviewDto";
import { runStoryWorkspaceReviewOperation, storyWorkspaceReviewSchemaRequirements } from "./storyWorkspaceReviewService";

export function isStoryWorkspaceReviewOperation(name: string): name is StoryWorkspaceReviewOperation {
  return Object.hasOwn(storyWorkspaceReviewOperationContracts, name);
}

export async function handleStoryWorkspaceReview(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isStoryWorkspaceReviewOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = storyWorkspaceReviewOperationContracts[name];
    const envelope = await parseAuthDto(request,
      z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...storyWorkspaceReviewSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(tx,
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      return runStoryWorkspaceReviewOperation(name, envelope.input, principal, service.id, envelope.request_id, tx);
    });
  });
}
