// [Input] Configured Dream service, OAuth or exact Run grant and Registry185-191 envelope.
// [Output] Capability-gated Story Workspace authority/lifecycle/index result.
// [Pos] Thin operation ingress; filesystem projection, Runtime and SSE remain in Dream.
// [Sync] 2026-09-16: dispatch the final Story Workspace database cutover operations.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { requireDataActor } from "./principal";
import { storyWorkspaceArtifactOperationContracts, type StoryWorkspaceArtifactOperation } from "./storyWorkspaceArtifactDto";
import { runStoryWorkspaceArtifactOperation, storyWorkspaceArtifactSchemaRequirements } from "./storyWorkspaceArtifactService";

export function isStoryWorkspaceArtifactOperation(name: string): name is StoryWorkspaceArtifactOperation {
  return Object.hasOwn(storyWorkspaceArtifactOperationContracts, name);
}

export async function handleStoryWorkspaceArtifact(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isStoryWorkspaceArtifactOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = storyWorkspaceArtifactOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const delegated = request.headers.get("authorization")?.startsWith("Bearer idg_");
    const runId = "workflow_run_id" in envelope.input ? envelope.input.workflow_run_id : undefined;
    return withDataTransaction([identitySchemaRequirement, ...storyWorkspaceArtifactSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : [])], async tx => {
      const actor = await requireDataActor(tx, request.headers, service, operation.userScope, undefined, runId);
      return runStoryWorkspaceArtifactOperation(name, envelope.input, actor, service.id, envelope.request_id, tx);
    });
  });
}
