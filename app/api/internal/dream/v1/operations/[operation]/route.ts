// [Input] Explicit registered local-data, Thread/message, Session/Editor, Workflow, Reflections, Deck/Voice or profile request.
// [Output] Strict domain DTO, never generic SQL or arbitrary function dispatch.
// [Pos] Thin named operation ingress.
// [Sync] 2026-09-15: dispatch the OAuth local-data aggregate and first-login completion through Registry101.
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
import { handleDreamLaunchSource } from "../../../../../../lib/dream/dreamLaunchSourceHandler";
import { handleDreamLaunchDispatch, isDreamLaunchDispatchOperation } from "../../../../../../lib/dream/dreamLaunchDispatchHandler";
import { handleWorkspaceDefault } from "../../../../../../lib/dream/workspaceDefaultHandler";
import { handleDreamLaunchFailure } from "../../../../../../lib/dream/dreamLaunchFailureHandler";
import { handleUserSystemConfig, isUserSystemConfigOperation } from "../../../../../../lib/dream/userSystemConfigHandler";
import { handleThreadSystemConfig, isThreadSystemConfigOperation } from "../../../../../../lib/dream/threadSystemConfigHandler";
import { handleReflectionsSectionConfig, isReflectionsSectionConfigOperation } from "../../../../../../lib/dream/reflectionsSectionConfigHandler";
import { handleReflectionTaskOperation, isReflectionTaskOperation } from "../../../../../../lib/dream/reflectionTaskHandler";
import { handleLocalDataImport, isLocalDataImportOperation } from "../../../../../../lib/dream/localDataImportHandler";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ operation: string }> }) {
  const name = (await context.params).operation;
  if (isLocalDataImportOperation(name)) return handleLocalDataImport(request, name);
  if (name === "dream-launch-failure.envelope") return handleDreamLaunchFailure(request, name);
  if (isUserSystemConfigOperation(name)) return handleUserSystemConfig(request, name);
  if (isThreadSystemConfigOperation(name)) return handleThreadSystemConfig(request, name);
  if (isReflectionsSectionConfigOperation(name)) return handleReflectionsSectionConfig(request, name);
  if (isReflectionTaskOperation(name)) return handleReflectionTaskOperation(request, name);
  if (name === "workspace-default.ensure") return handleWorkspaceDefault(request, name);
  if (isWorkflowRunCreationOperation(name)) return handleWorkflowRunCreation(request, name);
  if (name === "dream-launch-source.ensure") return handleDreamLaunchSource(request, name);
  if (isDreamLaunchDispatchOperation(name)) return handleDreamLaunchDispatch(request, name);
  return name === "user-profile.current" ? handleUserProfile(request) : name === "workflow-context.resolve" ? handleWorkflowContext(request) : name === "workflow-preflight.read" ? handleWorkflowPreflightRead(request) : name === "workflow-preflight.execute" ? handleWorkflowPreflightExecute(request) : name === "chat-user-message.persist" ? handleUserMessage(request) : isWorkflowRunOperation(name) ? handleWorkflowRun(request, name) : isWorkflowRunCommandOperation(name) ? handleWorkflowRunCommand(request, name) : isEditorSessionOperation(name) ? handleEditorSessionOperation(request, name) : isDeckVoiceOperation(name) ? handleDeckVoiceOperation(request, name) : isDeckRuntimeDataOperation(name) ? handleDeckRuntimeData(request, name) : isUserPreferencesOperation(name) ? handleUserPreferences(request, name) : isSocialFriendshipOperation(name) ? handleSocialFriendship(request, name) : handleChatThreadOperation(request, name);
}
