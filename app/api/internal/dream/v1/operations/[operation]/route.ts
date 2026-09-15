// [Input] Explicit registered local-data, Thread/message, Session/Editor, Workflow, Reflections, Deck/Voice or profile request.
// [Output] Strict domain DTO, never generic SQL or arbitrary function dispatch.
// [Pos] Thin named operation ingress.
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
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  const name = (await context.params).operation;
  if (isDreamAutoRepairOperation(name)) return handleDreamAutoRepair(request, name);
  if (isNotionConnectorOperation(name)) return handleNotionConnector(request, name);
  if (isManagedMcpOperation(name)) return handleManagedMcp(request, name);
  if (isDeckPluginBindingOperation(name)) return handleDeckPluginBinding(request, name);
  if (isStoryWorkspaceConfirmationOperation(name)) return handleStoryWorkspaceConfirmation(request, name);
  if (isStoryWorkspaceGuidanceOperation(name)) return handleStoryWorkspaceGuidance(request, name);
  if (isStoryWorkspaceCatalogOperation(name)) return handleStoryWorkspaceCatalog(request, name);
  if (isStoryWorkspaceReviewOperation(name)) return handleStoryWorkspaceReview(request, name);
  if (isStoryWorkspaceOutputOperation(name)) return handleStoryWorkspaceOutput(request, name);
  if (isWorkflowRuntimeActivationOperation(name)) return handleWorkflowRuntimeActivation(request, name);
  if (isWorkflowManagedMcpScopeOperation(name)) return handleWorkflowManagedMcpScope(request, name);
  if (isDeckWorkspacePluginsOperation(name)) return handleDeckWorkspacePlugins(request, name);
  if (isDeckChatContextOperation(name)) return handleDeckChatContext(request, name);
  if (isDeckDefaultPluginResolveOperation(name)) return handleDeckDefaultPluginResolve(request, name);
  if (isPictureHistoryOperation(name)) return handlePictureHistory(request, name);
  if (isLocalDataImportOperation(name)) return handleLocalDataImport(request, name);
  if (name === "dream-launch-failure.envelope") return handleDreamLaunchFailure(request, name);
  if (isUserSystemConfigOperation(name)) return handleUserSystemConfig(request, name);
  if (isThreadSystemConfigOperation(name)) return handleThreadSystemConfig(request, name);
  if (isReflectionsSectionConfigOperation(name)) return handleReflectionsSectionConfig(request, name);
  if (isReflectionTaskOperation(name)) return handleReflectionTaskOperation(request, name);
  if (name === "workspace-default.ensure") return handleWorkspaceDefault(request, name);
  if (isWorkflowRunCreationOperation(name)) return handleWorkflowRunCreation(request, name);
  if (isDreamLaunchSourceOperation(name)) return handleDreamLaunchSource(request, name);
  if (isDreamLaunchDispatchOperation(name)) return handleDreamLaunchDispatch(request, name);
  return name === "user-profile.current" ? handleUserProfile(request) : name === "workflow-context.resolve" ? handleWorkflowContext(request) : name === "workflow-preflight.read" ? handleWorkflowPreflightRead(request) : name === "workflow-preflight.execute" ? handleWorkflowPreflightExecute(request) : name === "chat-user-message.persist" ? handleUserMessage(request) : isWorkflowRunOperation(name) ? handleWorkflowRun(request, name) : isWorkflowRunCommandOperation(name) ? handleWorkflowRunCommand(request, name) : isEditorSessionOperation(name) ? handleEditorSessionOperation(request, name) : isDeckVoiceOperation(name) ? handleDeckVoiceOperation(request, name) : isDeckRuntimeDataOperation(name) ? handleDeckRuntimeData(request, name) : isUserPreferencesOperation(name) ? handleUserPreferences(request, name) : isSocialFriendshipOperation(name) ? handleSocialFriendship(request, name) : handleChatThreadOperation(request, name);
}
