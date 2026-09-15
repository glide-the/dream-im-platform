// [Input] Original request ID plus an implemented operation name and its exact OAuth, background or task authority.
// [Output] Strict original request evidence bound to the derived service, actor and Reflections task when applicable.
// [Pos] Unknown-commit recovery ingress; absence never causes automatic retry.
// [Sync] 2026-09-15: recover Registry114 Story catalog writes under the original OAuth actor.
import { z } from "zod";
import { AuthBoundaryError } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest } from "../auth/internalHandler";
import { requireBackgroundScope } from "../auth/serviceIdentity";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, reflectionTaskSchemaRequirement, reflectionTaskSchemaRequirements, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement, workflowPreflightExecutionSchemaRequirements } from "./schemaRequirements";
import { ReceiptRepository } from "./receipts";
import { resourceObserverPublishOutputDto } from "./resourceDto";
import { chatThreadOperationContracts } from "./chatThreadDto";
import { isChatThreadOperation } from "./chatThreadHandler";
import { requireDataActor } from "./principal";
import { editorSessionOperationContracts } from "./editorSessionDto";
import { editorActorForBearer, isEditorSessionOperation } from "./editorSessionHandler";
import { deckVoiceOperationContracts } from "./deckVoiceDto";
import { deckVoiceSchemaRequirements } from "./deckVoiceService";
import { isDeckVoiceOperation } from "./deckVoiceHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { userMessageOperationContracts } from "./userMessageDto";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { workflowRunCommandOperationContracts } from "./workflowRunCommandDto";
import { isWorkflowRunCommandOperation } from "./workflowRunCommandHandler";
import { workflowRunCommandSchemaRequirements } from "./workflowRunCommandService";
import { deckRuntimeDataOperationContracts } from "./deckRuntimeDataDto";
import { deckRuntimeDataSchemaRequirements } from "./deckRuntimeDataService";
import { isDeckRuntimeDataOperation, isThreadRuntimeDataOperation } from "./deckRuntimeDataHandler";
import { userPreferencesOperationContracts } from "./userPreferencesDto";
import { userPreferencesSchemaRequirements } from "./userPreferencesService";
import { isUserPreferencesOperation } from "./userPreferencesHandler";
import { socialFriendshipOperationContracts } from "./socialFriendshipDto";
import { socialFriendshipSchemaRequirements } from "./socialFriendshipService";
import { isSocialFriendshipOperation } from "./socialFriendshipHandler";
import { readOriginalPreflightReceipt } from "./workflowPreflightOriginalReceiptService";
import { isWorkflowRunCreationOperation } from "./workflowRunCreationHandler";
import { readOriginalRunCreationReceipt, workflowRunCreationSchemaRequirements } from "./workflowRunCreationService";
import { isDreamLaunchReceiptOperation, readOriginalDreamLaunchReceipt } from "./dreamLaunchOriginalReceiptService";
import { dreamLaunchSourceSchemaRequirements } from "./dreamLaunchSourceService";
import { workspaceDefaultIngressSchemaRequirements } from "./workspaceDefaultHandler";
import { readOriginalWorkspaceDefaultReceipt } from "./workspaceDefaultOriginalReceiptService";
import { dreamLaunchFailureSchemaRequirements } from "./dreamLaunchFailureService";
import { readOriginalDreamLaunchFailureReceipt } from "./dreamLaunchFailureOriginalReceiptService";
import { readOriginalUserSystemConfigReceipt } from "./userSystemConfigOriginalReceiptService";
import { userSystemConfigSchemaRequirements } from "./userSystemConfigService";
import { isReflectionsSectionConfigReceiptOperation, readOriginalReflectionsSectionConfigReceipt } from "./reflectionsSectionConfigOriginalReceiptService";
import { reflectionsSectionConfigSchemaRequirements } from "./reflectionsSectionConfigService";
import { reflectionTaskIdDto, reflectionTaskOperationContracts, type ReflectionTaskBackgroundOperation, type ReflectionTaskOperation } from "./reflectionTaskDto";
import { readOriginalReflectionTaskBackgroundReceipt } from "./reflectionTaskService";
import { isLocalDataImportOperation } from "./localDataImportHandler";
import { localDataImportOperationContracts } from "./localDataImportDto";
import { localDataImportSchemaRequirements } from "./localDataImportService";
import { workflowRuntimeActivationOperationContracts } from "./workflowRuntimeActivationDto";
import { isWorkflowRuntimeActivationOperation } from "./workflowRuntimeActivationHandler";
import { workflowRuntimeActivationSchemaRequirements } from "./workflowRuntimeActivationService";
import { storyWorkspaceOutputOperationContracts } from "./storyWorkspaceOutputDto";
import { isStoryWorkspaceOutputOperation } from "./storyWorkspaceOutputHandler";
import { storyWorkspaceOutputSchemaRequirements } from "./storyWorkspaceOutputService";
import { storyWorkspaceReviewOperationContracts } from "./storyWorkspaceReviewDto";
import { isStoryWorkspaceReviewOperation } from "./storyWorkspaceReviewHandler";
import { storyWorkspaceReviewSchemaRequirements } from "./storyWorkspaceReviewService";
import { storyWorkspaceCatalogOperationContracts } from "./storyWorkspaceCatalogDto";
import { isStoryWorkspaceCatalogOperation } from "./storyWorkspaceCatalogHandler";
import { storyWorkspaceCatalogSchemaRequirements } from "./storyWorkspaceCatalogService";
export async function handleReceipt(request: Request, requestId: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const parsed = requestIdDto.safeParse(requestId); if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
    setRequestId(parsed.data);
    const query = new URL(request.url).searchParams;
    const name = query.get("operation") ?? "";
    if (isLocalDataImportOperation(name)) {
      if (query.size !== 1 || query.getAll("operation").length !== 1) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
      const operation = localDataImportOperationContracts[name];
      const receiptResultDto = z.discriminatedUnion("status", [
        z.strictObject({ status: z.literal("absent"), operation: z.literal(name), request_id: requestIdDto }),
        z.strictObject({ status: z.literal("committed"), operation: z.literal(name), request_id: requestIdDto, result: operation.output }),
      ]);
      return withDataTransaction([identitySchemaRequirement, ...localDataImportSchemaRequirements], async tx => {
        const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
        const row = await new ReceiptRepository(tx, service.id, principal.subject).find(name, parsed.data);
        if (row && (!/^[0-9a-f]{64}$/.test(row.inputSha256) || row.threadScope !== null || row.editorSessionScope !== null || row.runScope !== null)) throw new AuthBoundaryError("LOCAL_DATA_RECEIPT_INVALID");
        return receiptResultDto.parse({ status: row ? "committed" : "absent", operation: name, request_id: parsed.data, ...(row ? { result: row.result } : {}) });
      });
    }
    const reflectionTaskOperation = Object.hasOwn(reflectionTaskOperationContracts, name) ? reflectionTaskOperationContracts[name as ReflectionTaskOperation] : null;
    if (reflectionTaskOperation) {
      if (reflectionTaskOperation.kind !== "write") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
      const receiptResultDto = z.discriminatedUnion("status", [
        z.strictObject({ status: z.literal("absent"), operation: z.literal(name), request_id: requestIdDto }),
        z.strictObject({ status: z.literal("committed"), operation: z.literal(name), request_id: requestIdDto, result: reflectionTaskOperation.output }),
      ]);
      if (reflectionTaskOperation.audience === "background") {
        const taskId = query.get("task_id") ?? "", parsedTaskId = reflectionTaskIdDto.safeParse(taskId);
        if (query.size !== 2 || query.getAll("operation").length !== 1 || query.getAll("task_id").length !== 1 || !parsedTaskId.success) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
        if (request.headers.has("authorization")) throw new AuthBoundaryError("REFLECTION_BROWSER_CREDENTIAL_FORBIDDEN", 400);
        return withDataTransaction([identitySchemaRequirement, ...reflectionTaskSchemaRequirements], async tx => {
          const result = await readOriginalReflectionTaskBackgroundReceipt(name as ReflectionTaskBackgroundOperation, parsedTaskId.data, parsed.data, service, tx);
          return receiptResultDto.parse({ status: result === null ? "absent" : "committed", operation: name, request_id: parsed.data, ...(result === null ? {} : { result }) });
        });
      }
      if (query.size !== 1 || query.getAll("operation").length !== 1) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
      return withDataTransaction([identitySchemaRequirement, ...reflectionTaskSchemaRequirements], async tx => {
        const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, reflectionTaskOperation.userScope);
        const row = await new ReceiptRepository(tx, service.id, principal.subject).find(name, parsed.data);
        if (row && (!/^[0-9a-f]{64}$/.test(row.inputSha256) || row.threadScope !== null || row.editorSessionScope !== null || row.runScope !== null)) throw new AuthBoundaryError("REFLECTION_RECEIPT_DATA_INVALID");
        return receiptResultDto.parse({ status: row ? "committed" : "absent", operation: name, request_id: parsed.data, ...(row ? { result: row.result } : {}) });
      });
    }
    if (isReflectionsSectionConfigReceiptOperation(name)) {
      if ([...query.keys()].some(key => key !== "operation") || query.getAll("operation").length !== 1) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
      return withDataTransaction(reflectionsSectionConfigSchemaRequirements, async tx => {
        const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, "dream:write");
        return readOriginalReflectionsSectionConfigReceipt(tx, service.id, principal, name, parsed.data);
      });
    }
    if (name === "user-system-config.patch") {
      if ([...query.keys()].some(key => key !== "operation") || query.getAll("operation").length !== 1) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
      return withDataTransaction([identitySchemaRequirement, ...userSystemConfigSchemaRequirements], async tx => {
        const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, "dream:write");
        return readOriginalUserSystemConfigReceipt(tx, service.id, principal, name, parsed.data);
      });
    }
    if (name === "dream-launch-failure.envelope") {
      if ([...query.keys()].some(key => key !== "operation") || query.getAll("operation").length !== 1) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
      return withDataTransaction(dreamLaunchFailureSchemaRequirements, async tx => {
        const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, "dream:write");
        return readOriginalDreamLaunchFailureReceipt(tx, service.id, principal, name, parsed.data);
      });
    }
    if (name === "workspace-default.ensure") {
      if ([...query.keys()].some(key => key !== "operation") || query.getAll("operation").length !== 1) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
      return withDataTransaction(workspaceDefaultIngressSchemaRequirements, async tx => {
        const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, "dream:write");
        return readOriginalWorkspaceDefaultReceipt(tx, service.id, principal, name, parsed.data);
      });
    }
    if (isDreamLaunchReceiptOperation(name)) {
      if ([...query.keys()].some(key => key !== "operation") || query.getAll("operation").length !== 1) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
      return withDataTransaction(dreamLaunchSourceSchemaRequirements, async tx => {
        const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, "dream:write");
        return readOriginalDreamLaunchReceipt(tx, service.id, principal, name, parsed.data);
      });
    }
    if (isWorkflowRunCreationOperation(name)) {
      if ([...query.keys()].some(key => key !== "operation") || query.getAll("operation").length !== 1) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
      return withDataTransaction(workflowRunCreationSchemaRequirements, async tx => {
        const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, "dream:write");
        return readOriginalRunCreationReceipt(tx, service.id, principal, name, parsed.data);
      });
    }
    if (name === "workflow-preflight.execute") {
      if ([...query.keys()].some(key => key !== "operation") || query.getAll("operation").length !== 1) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
      return withDataTransaction(workflowPreflightExecutionSchemaRequirements, async tx => {
        const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, "dream:write");
        return readOriginalPreflightReceipt(tx, service.id, principal, parsed.data);
      });
    }
    const background = name === "resource-observer.publish";
    const session = isEditorSessionOperation(name) ? editorSessionOperationContracts[name] : null;
    const deck = isDeckVoiceOperation(name) ? deckVoiceOperationContracts[name] : null;
    const userMessage = name === "chat-user-message.persist" ? userMessageOperationContracts[name] : null;
    const workflowRun = isWorkflowRunCommandOperation(name) ? workflowRunCommandOperationContracts[name] : null;
    const runtimeData = isDeckRuntimeDataOperation(name) ? deckRuntimeDataOperationContracts[name] : null;
    const runtimeActivation = isWorkflowRuntimeActivationOperation(name) ? workflowRuntimeActivationOperationContracts[name] : null;
    const storyOutput = isStoryWorkspaceOutputOperation(name) ? storyWorkspaceOutputOperationContracts[name] : null;
    const storyReview = isStoryWorkspaceReviewOperation(name) ? storyWorkspaceReviewOperationContracts[name] : null;
    const storyCatalog = isStoryWorkspaceCatalogOperation(name) ? storyWorkspaceCatalogOperationContracts[name] : null;
    if (storyCatalog?.kind === "read") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const preferences = isUserPreferencesOperation(name) ? userPreferencesOperationContracts[name] : null;
    const social = isSocialFriendshipOperation(name) ? socialFriendshipOperationContracts[name] : null;
    if ((!background && !isChatThreadOperation(name) && !session && !deck && !userMessage && !workflowRun && !runtimeData && !runtimeActivation && !storyOutput && !storyReview && !storyCatalog && !preferences && !social) || [...query.keys()].some(key => key !== "operation") || query.getAll("operation").length !== 1) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    if (background) requireBackgroundScope(service, "resource-observer:write");
    const output = background ? resourceObserverPublishOutputDto : session ? session.output : deck ? deck.output : userMessage ? userMessage.output : workflowRun ? workflowRun.output : runtimeData ? runtimeData.output : runtimeActivation ? runtimeActivation.output : storyOutput ? storyOutput.output : storyReview ? storyReview.output : storyCatalog ? storyCatalog.output : preferences ? preferences.output : social ? social.output : chatThreadOperationContracts[name as keyof typeof chatThreadOperationContracts].output;
    const receiptResultDto = z.discriminatedUnion("status", [
      z.strictObject({ status: z.literal("absent"), operation: z.literal(name), request_id: requestIdDto }),
      z.strictObject({ status: z.literal("committed"), operation: z.literal(name), request_id: requestIdDto, result: output }),
    ]);
    const bearer = request.headers.get("authorization") ?? "", delegated = bearer.startsWith("Bearer idg_"), reflectionAuthority = bearer.startsWith("Bearer rta_");
    if (reflectionAuthority && ((session && session.kind === "read") || (isChatThreadOperation(name) && chatThreadOperationContracts[name].kind === "read"))) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    return withDataTransaction([identitySchemaRequirement, ...(deck ? deckVoiceSchemaRequirements : []), ...(runtimeData ? deckRuntimeDataSchemaRequirements : []), ...(runtimeActivation ? workflowRuntimeActivationSchemaRequirements : []), ...(storyOutput ? storyWorkspaceOutputSchemaRequirements : []), ...(storyReview ? storyWorkspaceReviewSchemaRequirements : []), ...(storyCatalog ? storyWorkspaceCatalogSchemaRequirements : []), ...(preferences ? userPreferencesSchemaRequirements : []), ...(social ? socialFriendshipSchemaRequirements : []), ...(userMessage ? [dreamUnifiedSchemaRequirement] : []), ...(workflowRun ? workflowRunCommandSchemaRequirements(name as keyof typeof workflowRunCommandOperationContracts) : []), ...(session ? [runtimePurposeSchemaRequirement] : []), ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : []), ...(reflectionAuthority ? [reflectionTaskSchemaRequirement] : [])], async tx => {
      const userScope = session ? session.userScope : deck ? deck.kind === "read" ? "dream:read" : "dream:write" : userMessage ? userMessage.userScope : workflowRun ? workflowRun.userScope : runtimeData ? runtimeData.userScope : runtimeActivation ? runtimeActivation.userScope : storyOutput ? storyOutput.userScope : storyReview ? storyReview.userScope : storyCatalog ? storyCatalog.userScope : preferences ? preferences.userScope : social ? social.userScope : !background && chatThreadOperationContracts[name as keyof typeof chatThreadOperationContracts].kind === "write" ? "dream:write" : "dream:read";
      const oauthOnly = deck || storyReview || storyCatalog || preferences || social || (runtimeData && !isThreadRuntimeDataOperation(name));
      const actor = background ? null : oauthOnly ? { principal: await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, userScope), threadScope: null } : session && delegated ? await editorActorForBearer(tx, request.headers, userScope, undefined, service.id) : await requireDataActor(tx, request.headers, service, userScope, undefined, undefined, name);
      const row = await new ReceiptRepository(tx, service.id, actor?.principal.subject ?? `background:${service.id}`).find(name, parsed.data);
      if (row && storyOutput) {
        const stored = storyOutput.output.safeParse(row.result);
        if (!stored.success || !/^[0-9a-f]{64}$/.test(row.inputSha256)
          || row.threadScope === null || row.threadScope !== stored.data.chat_thread_id
          || row.editorSessionScope !== null || row.runScope !== null) {
          throw new AuthBoundaryError("STORY_WORKSPACE_OUTPUT_DATA_INVALID");
        }
      }
      if (row && storyReview && (!storyReview.output.safeParse(row.result).success
        || !/^[0-9a-f]{64}$/.test(row.inputSha256) || row.threadScope !== null
        || row.editorSessionScope !== null || row.runScope !== null)) {
        throw new AuthBoundaryError("STORY_WORKSPACE_REVIEW_DATA_INVALID");
      }
      if (row && storyCatalog && (!storyCatalog.output.safeParse(row.result).success
        || !/^[0-9a-f]{64}$/.test(row.inputSha256) || row.threadScope !== null
        || row.editorSessionScope !== null || row.runScope !== null)) {
        throw new AuthBoundaryError("STORY_WORKSPACE_CATALOG_DATA_INVALID");
      }
      if (row && actor?.threadScope && row.threadScope !== actor.threadScope) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
      if (row && actor && "editorSessionScope" in actor && row.editorSessionScope !== actor.editorSessionScope) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
      if (row && (workflowRun || runtimeActivation) && delegated && actor && (!row.runScope || !("runScope" in actor) || row.runScope !== actor.runScope)) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
      return receiptResultDto.parse({ status: row ? "committed" : "absent", operation: name, request_id: parsed.data, ...(row ? { result: row.result } : {}) });
    });
  });
}
