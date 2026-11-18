// [Sync] 2026-11-12: dispatch owner-scoped external-share publication and revocation.
// [Sync] 2026-11-19: name registered entry spans and trace the dispatched handler with its source file.
import {handleExternalShareOperation,isExternalShareOperation} from '../../../../../../lib/dream/externalShareHandler';
// [Sync] 2026-10-15: dispatch named memory operations.
import { handleMemoryOperation,isMemoryOperation } from "../../../../../../lib/dream/memoryHandler";
// [Sync] 2026-10-14: dispatch only the registered analysis history-page read.
// [Sync] 2026-10-13: dispatch the three additive Reflections content operations to their capability-gated handler.
// [Sync] 2026-10-10: register exact image-turn bind/select and original entity-bound receipt recovery.
// [Input] Explicit registered local-data, Thread/message, scheduled Chat, Session/Editor, Workflow, Reflections, Deck/Voice or profile request.
// [Sync] 2026-09-28: route named scheduled Chat user and background operations to one capability-gated handler.
// [Output] Strict domain DTO, never generic SQL or arbitrary function dispatch.
// [Pos] Thin named operation ingress.
// [Sync] 2026-09-27: route Registry200-204 task-result operations to the dedicated handler.
// [Sync] 2026-09-16: dispatch Registry185-191 Story Workspace Artifact operations.
// [Sync] 2026-09-16: dispatch Registry175-182 shared Claude Plugin persistence operations.
// [Sync] 2026-09-16: dispatch Registry170-174 Deck Plugin control operations.
// [Sync] 2026-09-16: dispatch Registry169 auto-repair message settlement.
// [Sync] 2026-09-16: dispatch Registry148-168 Notion connector persistence operations.
// [Sync] 2026-09-16: dispatch Registry134-147 managed-MCP persistence operations.
// [Sync] 2026-09-16: dispatch Registry122-132 binding, Agent-type and launch Runtime operations.
// [Sync] 2026-09-16: dispatch Registry120 Story Workspace confirmation operations.
import { handleChatThreadOperation } from "../../../../../../lib/dream/chatThreadHandler";
import { handleUserProfile } from "../../../../../../lib/dream/userProfileHandler";
import { handleEditorSessionOperation, isEditorSessionOperation } from "../../../../../../lib/dream/editorSessionHandler";
import { handleWorkflowContext } from "../../../../../../lib/dream/workflowContextHandler";
import { handleDeckVoiceOperation, isDeckVoiceOperation } from "../../../../../../lib/dream/deckVoiceHandler";
import { handleUserMessage } from "../../../../../../lib/dream/userMessageHandler";
import { handleWorkflowRun, isWorkflowRunOperation } from "../../../../../../lib/dream/workflowRunHandler";
import { handleWorkflowRunCommand, isWorkflowRunCommandOperation } from "../../../../../../lib/dream/workflowRunCommandHandler";
import { handleDeckRuntimeData, isDeckRuntimeDataOperation } from "../../../../../../lib/dream/deckRuntimeDataHandler";
import { handleWorkflowPreflightRead, handleWorkflowPreflightExecute } from "../../../../../../lib/dream/workflowPreflightHandler";
import { handleUserPreferences, isUserPreferencesOperation } from "../../../../../../lib/dream/userPreferencesHandler";
import { handleSocialFriendship, isSocialFriendshipOperation } from "../../../../../../lib/dream/socialFriendshipHandler";
import { handleWorkflowRunCreation, isWorkflowRunCreationOperation } from "../../../../../../lib/dream/workflowRunCreationHandler";
import { handleDreamLaunchSource, isDreamLaunchSourceOperation } from "../../../../../../lib/dream/dreamLaunchSourceHandler";
import { handleDreamLaunchDispatch, isDreamLaunchDispatchOperation } from "../../../../../../lib/dream/dreamLaunchDispatchHandler";
import { handleWorkspaceDefault } from "../../../../../../lib/dream/workspaceDefaultHandler";
import { handleDreamLaunchFailure } from "../../../../../../lib/dream/dreamLaunchFailureHandler";
import { handleUserSystemConfig, isUserSystemConfigOperation } from "../../../../../../lib/dream/userSystemConfigHandler";
import { handleThreadSystemConfig, isThreadSystemConfigOperation } from "../../../../../../lib/dream/threadSystemConfigHandler";
import { handleReflectionsSectionConfig, isReflectionsSectionConfigOperation } from "../../../../../../lib/dream/reflectionsSectionConfigHandler";
import { handleReflectionAnalysisOperation, isReflectionAnalysisOperation } from "../../../../../../lib/dream/reflectionAnalysisContentHandler";
// [Sync] 2026-10-13: route additive Reflections analysis input operations.
import { handleReflectionTaskOperation, isReflectionTaskOperation } from "../../../../../../lib/dream/reflectionTaskHandler";
import { handleLocalDataImport, isLocalDataImportOperation } from "../../../../../../lib/dream/localDataImportHandler";
import { handlePictureHistory, isPictureHistoryOperation } from "../../../../../../lib/dream/pictureHistoryHandler";
import { handleDeckDefaultPluginResolve, isDeckDefaultPluginResolveOperation } from "../../../../../../lib/dream/deckDefaultPluginResolveHandler";
import { handleDeckChatContext, isDeckChatContextOperation } from "../../../../../../lib/dream/deckChatContextHandler";
import { handleDeckWorkspacePlugins, isDeckWorkspacePluginsOperation } from "../../../../../../lib/dream/deckWorkspacePluginsHandler";
import { handleWorkflowManagedMcpScope, isWorkflowManagedMcpScopeOperation } from "../../../../../../lib/dream/workflowManagedMcpScopeHandler";
import { handleWorkflowRuntimeActivation, isWorkflowRuntimeActivationOperation } from "../../../../../../lib/dream/workflowRuntimeActivationHandler";
import { handleStoryWorkspaceOutput, isStoryWorkspaceOutputOperation } from "../../../../../../lib/dream/storyWorkspaceOutputHandler";
import { handleStoryWorkspaceReview, isStoryWorkspaceReviewOperation } from "../../../../../../lib/dream/storyWorkspaceReviewHandler";
import { handleStoryWorkspaceCatalog, isStoryWorkspaceCatalogOperation } from "../../../../../../lib/dream/storyWorkspaceCatalogHandler";
import { handleStoryWorkspaceGuidance, isStoryWorkspaceGuidanceOperation } from "../../../../../../lib/dream/storyWorkspaceGuidanceHandler";
import { handleStoryWorkspaceConfirmation, isStoryWorkspaceConfirmationOperation } from "../../../../../../lib/dream/storyWorkspaceConfirmationHandler";
import { handleDeckPluginBinding, isDeckPluginBindingOperation } from "../../../../../../lib/dream/deckPluginBindingHandler";
import { handleManagedMcp, isManagedMcpOperation } from "../../../../../../lib/dream/managedMcpHandler";
import { handleNotionConnector, isNotionConnectorOperation } from "../../../../../../lib/dream/notionConnectorHandler";
import { handleDreamAutoRepair, isDreamAutoRepairOperation } from "../../../../../../lib/dream/dreamAutoRepairHandler";
import { handleDeckPluginControl, isDeckPluginControlOperation } from "../../../../../../lib/dream/deckPluginControlHandler";
import { handleClaudePluginOperation, isClaudePluginOperation } from "../../../../../../lib/dream/claudePluginDataHandler";
import { handleStoryWorkspaceArtifact, isStoryWorkspaceArtifactOperation } from "../../../../../../lib/dream/storyWorkspaceArtifactHandler";
import { handleTaskSessionResult, isTaskSessionResultOperation } from "../../../../../../lib/dream/taskSessionResultHandler";
import { handleChatScheduledTaskOperation, isChatScheduledTaskOperation } from "../../../../../../lib/dream/chatScheduledTaskHandler";
import { handleImageTurnOperation, isImageTurnOperation } from "../../../../../../lib/dream/imageTurnHandler";
import { handleReflectionHistory } from "../../../../../../lib/dream/reflectionHistoryHandler";
import { getDreamOperationTrace } from "../../../../../../lib/dream/operationRegistry";
import { traceDreamOperationHandler } from "../../../../../../lib/observability/dreamOperationTrace";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  const name = (await context.params).operation;
  const operation = getDreamOperationTrace(name);
  function run<Args extends unknown[]>(
    file: string,
    target: Record<string, (...args: Args) => Promise<Response>>,
    ...args: Args
  ): Promise<Response> {
    const [handlerName, handler] = Object.entries(target)[0];
    return traceDreamOperationHandler(operation, handlerName, `app/lib/dream/${file}.ts`, () => handler(...args));
  }
  if (isExternalShareOperation(name)) return run("externalShareHandler", { handleExternalShareOperation }, request, name);
  if (name === "analysis-report.history-page") return run("reflectionHistoryHandler", { handleReflectionHistory }, request);
  if (isImageTurnOperation(name)) return run("imageTurnHandler", { handleImageTurnOperation }, request, name);
  if (isChatScheduledTaskOperation(name)) return run("chatScheduledTaskHandler", { handleChatScheduledTaskOperation }, request, name);
  if (isTaskSessionResultOperation(name)) return run("taskSessionResultHandler", { handleTaskSessionResult }, request, name);
  if (isStoryWorkspaceArtifactOperation(name)) return run("storyWorkspaceArtifactHandler", { handleStoryWorkspaceArtifact }, request, name);
  if (isClaudePluginOperation(name)) return run("claudePluginDataHandler", { handleClaudePluginOperation }, request, name);
  if (isDeckPluginControlOperation(name)) return run("deckPluginControlHandler", { handleDeckPluginControl }, request, name);
  if (isDreamAutoRepairOperation(name)) return run("dreamAutoRepairHandler", { handleDreamAutoRepair }, request, name);
  if (isNotionConnectorOperation(name)) return run("notionConnectorHandler", { handleNotionConnector }, request, name);
  if (isManagedMcpOperation(name)) return run("managedMcpHandler", { handleManagedMcp }, request, name);
  if (isDeckPluginBindingOperation(name)) return run("deckPluginBindingHandler", { handleDeckPluginBinding }, request, name);
  if (isStoryWorkspaceConfirmationOperation(name)) return run("storyWorkspaceConfirmationHandler", { handleStoryWorkspaceConfirmation }, request, name);
  if (isStoryWorkspaceGuidanceOperation(name)) return run("storyWorkspaceGuidanceHandler", { handleStoryWorkspaceGuidance }, request, name);
  if (isStoryWorkspaceCatalogOperation(name)) return run("storyWorkspaceCatalogHandler", { handleStoryWorkspaceCatalog }, request, name);
  if (isStoryWorkspaceReviewOperation(name)) return run("storyWorkspaceReviewHandler", { handleStoryWorkspaceReview }, request, name);
  if (isStoryWorkspaceOutputOperation(name)) return run("storyWorkspaceOutputHandler", { handleStoryWorkspaceOutput }, request, name);
  if (isWorkflowRuntimeActivationOperation(name)) return run("workflowRuntimeActivationHandler", { handleWorkflowRuntimeActivation }, request, name);
  if (isWorkflowManagedMcpScopeOperation(name)) return run("workflowManagedMcpScopeHandler", { handleWorkflowManagedMcpScope }, request, name);
  if (isDeckWorkspacePluginsOperation(name)) return run("deckWorkspacePluginsHandler", { handleDeckWorkspacePlugins }, request, name);
  if (isDeckChatContextOperation(name)) return run("deckChatContextHandler", { handleDeckChatContext }, request, name);
  if (isDeckDefaultPluginResolveOperation(name)) return run("deckDefaultPluginResolveHandler", { handleDeckDefaultPluginResolve }, request, name);
  if (isPictureHistoryOperation(name)) return run("pictureHistoryHandler", { handlePictureHistory }, request, name);
  if (isLocalDataImportOperation(name)) return run("localDataImportHandler", { handleLocalDataImport }, request, name);
  if (name === "dream-launch-failure.envelope") return run("dreamLaunchFailureHandler", { handleDreamLaunchFailure }, request, name);
  if (isUserSystemConfigOperation(name)) return run("userSystemConfigHandler", { handleUserSystemConfig }, request, name);
  if (isThreadSystemConfigOperation(name)) return run("threadSystemConfigHandler", { handleThreadSystemConfig }, request, name);
  if (isReflectionsSectionConfigOperation(name)) return run("reflectionsSectionConfigHandler", { handleReflectionsSectionConfig }, request, name);
  if (isReflectionAnalysisOperation(name)) return run("reflectionAnalysisContentHandler", { handleReflectionAnalysisOperation }, request, name);
  if (isReflectionTaskOperation(name)) return run("reflectionTaskHandler", { handleReflectionTaskOperation }, request, name);
  if (name === "workspace-default.ensure") return run("workspaceDefaultHandler", { handleWorkspaceDefault }, request, name);
  if (isWorkflowRunCreationOperation(name)) return run("workflowRunCreationHandler", { handleWorkflowRunCreation }, request, name);
  if (isDreamLaunchSourceOperation(name)) return run("dreamLaunchSourceHandler", { handleDreamLaunchSource }, request, name);
  if (isDreamLaunchDispatchOperation(name)) return run("dreamLaunchDispatchHandler", { handleDreamLaunchDispatch }, request, name);
  if (isMemoryOperation(name)) return run("memoryHandler", { handleMemoryOperation }, request, name);
  if (name === "user-profile.current") return run("userProfileHandler", { handleUserProfile }, request);
  if (name === "workflow-context.resolve") return run("workflowContextHandler", { handleWorkflowContext }, request);
  if (name === "workflow-preflight.read") return run("workflowPreflightHandler", { handleWorkflowPreflightRead }, request);
  if (name === "workflow-preflight.execute") return run("workflowPreflightHandler", { handleWorkflowPreflightExecute }, request);
  if (name === "chat-user-message.persist") return run("userMessageHandler", { handleUserMessage }, request);
  if (isWorkflowRunOperation(name)) return run("workflowRunHandler", { handleWorkflowRun }, request, name);
  if (isWorkflowRunCommandOperation(name)) return run("workflowRunCommandHandler", { handleWorkflowRunCommand }, request, name);
  if (isEditorSessionOperation(name)) return run("editorSessionHandler", { handleEditorSessionOperation }, request, name);
  if (isDeckVoiceOperation(name)) return run("deckVoiceHandler", { handleDeckVoiceOperation }, request, name);
  if (isDeckRuntimeDataOperation(name)) return run("deckRuntimeDataHandler", { handleDeckRuntimeData }, request, name);
  if (isUserPreferencesOperation(name)) return run("userPreferencesHandler", { handleUserPreferences }, request, name);
  if (isSocialFriendshipOperation(name)) return run("socialFriendshipHandler", { handleSocialFriendship }, request, name);
  return run("chatThreadHandler", { handleChatThreadOperation }, request, name);
}
