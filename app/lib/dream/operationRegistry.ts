// [Sync] 2026-09-16: append launch scope/plan/prepare operations as Registry130-132.
// [Sync] 2026-09-16: append Agent-type clear/plan/prepare operations as Registry127-129.
// [Sync] 2026-09-16: append claim-bound confirmation Runtime authority as Registry121.
// [Input] Named domain input/output DTOs and exact schema requirements.
// [Output] Version/hash descriptors for implemented operations only.
// [Pos] API compatibility registry; independent from the global Drizzle head.
// [Sync] 2026-09-15: append Story Workspace guidance persistence as Registry115.
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalContractJson } from "./canonicalContractJson";
export { canonicalContractJson } from "./canonicalContractJson";
import { claudeAgentResourcePolicy as policy } from "../../../config/claude-agent-resource-policy";
import { resourcePolicyReadInputDto, resourcePolicyReadOutputDto, resourceObserverPublishInputDto, resourceObserverPublishOutputDto } from "./resourceDto";
import type { SchemaRequirement } from "./database";
import { identitySchemaRequirement, reflectionTaskSchemaRequirements, workflowPreflightExecutionSchemaRequirements } from "./schemaRequirements";
import { chatThreadOperationContracts } from "./chatThreadDto";
import { chatThreadSchemaRequirements } from "./chatThreadService";
import { userProfileInputDto, userProfileOutputDto } from "./userProfileDto";
import { editorSessionOperationContracts } from "./editorSessionDto";
import { runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { workflowContextOperationContracts } from "./workflowContextDto";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { deckVoiceOperationContracts } from "./deckVoiceDto";
import { deckVoiceSchemaRequirements } from "./deckVoiceService";
import { userMessageOperationContracts } from "./userMessageDto";
import { workflowRunOperationContracts } from "./workflowRunDto";
import { workflowRunCommandOperationContracts } from "./workflowRunCommandDto";
import { workflowRunCommandSchemaRequirements } from "./workflowRunCommandService";
import { deckRuntimeDataOperationContracts } from "./deckRuntimeDataDto";
import { deckRuntimeDataSchemaRequirements } from "./deckRuntimeDataService";
import { workflowPreflightOperationContracts } from "./workflowPreflightDto";
import { userPreferencesOperationContracts } from "./userPreferencesDto";
import { userPreferencesSchemaRequirements } from "./userPreferencesService";
import { socialFriendshipOperationContracts } from "./socialFriendshipDto";
import { socialFriendshipSchemaRequirements } from "./socialFriendshipService";
import { workflowPreflightExecutionOperationContracts } from "./workflowPreflightExecutionDto";
import { workflowRunCreationOperationContracts } from "./workflowRunCreationDto";
import { workflowRunCreationSchemaRequirements } from "./workflowRunCreationService";
import { dreamLaunchSourceOperationContracts } from "./dreamLaunchSourceDto";
import { dreamLaunchDispatchOperationContracts } from "./dreamLaunchDispatchDto";
import { workspaceDefaultOperationContracts } from "./workspaceDefaultDto";
import { dreamLaunchFailureOperationContracts } from "./dreamLaunchFailureDto";
import { userSystemConfigOperationContracts } from "./userSystemConfigDto";
import { userSystemConfigSchemaRequirements } from "./userSystemConfigService";
import { threadSystemConfigOperationContracts } from "./threadSystemConfigDto";
import { threadSystemConfigSchemaRequirements } from "./threadSystemConfigService";
import { reflectionsSectionConfigOperationContracts } from "./reflectionsSectionConfigDto";
import { reflectionTaskOperationContracts } from "./reflectionTaskDto";
import { localDataImportOperationContracts } from "./localDataImportDto";
import { localDataImportSchemaRequirements } from "./localDataImportService";
import { pictureHistoryOperationContracts } from "./pictureHistoryDto";
import { pictureHistorySchemaRequirements } from "./pictureHistoryService";
import { deckDefaultPluginResolveOperationContracts } from "./deckDefaultPluginResolveDto";
import { deckDefaultPluginResolveSchemaRequirements } from "./deckDefaultPluginResolveService";
import { deckChatContextOperationContracts } from "./deckChatContextDto";
import { deckChatContextSchemaRequirements } from "./deckChatContextService";
import { deckWorkspacePluginsOperationContracts } from "./deckWorkspacePluginsDto";
import { deckWorkspacePluginsSchemaRequirements } from "./deckWorkspacePluginsService";
import { workflowManagedMcpScopeOperationContracts } from "./workflowManagedMcpScopeDto";
import { workflowManagedMcpScopeSchemaRequirements } from "./workflowManagedMcpScopeService";
import { workflowRuntimeActivationOperationContracts } from "./workflowRuntimeActivationDto";
import { workflowRuntimeActivationSchemaRequirements } from "./workflowRuntimeActivationService";
import { storyWorkspaceOutputOperationContracts } from "./storyWorkspaceOutputDto";
import { storyWorkspaceOutputSchemaRequirements } from "./storyWorkspaceOutputService";
import { storyWorkspaceReviewOperationContracts } from "./storyWorkspaceReviewDto";
import { storyWorkspaceReviewSchemaRequirements } from "./storyWorkspaceReviewService";
import { storyWorkspaceCatalogOperationContracts } from "./storyWorkspaceCatalogDto";
import { storyWorkspaceCatalogSchemaRequirements } from "./storyWorkspaceCatalogService";
import { storyWorkspaceGuidanceOperationContracts } from "./storyWorkspaceGuidanceDto";
import { storyWorkspaceGuidanceSchemaRequirements } from "./storyWorkspaceGuidanceService";
import { storyWorkspaceConfirmationOperationContracts } from "./storyWorkspaceConfirmationDto";
import { storyWorkspaceConfirmationRequirements } from "./storyWorkspaceConfirmationService";
import { deckPluginBindingOperationContracts } from "./deckPluginBindingDto";
import { deckPluginBindingSchemaRequirements } from "./deckPluginBindingService";
function descriptor(name: string, kind: "read" | "write", backgroundScope: string | null, input: z.ZodType, output: z.ZodType, requirements: readonly SchemaRequirement[], userScope: string | null = null) {
  const contract = { name, input_schema_version: 1 as const, output_schema_version: 1 as const, input: z.toJSONSchema(input, { io: "input" }), output: z.toJSONSchema(output, { io: "output" }) };
  return { contract, requirements, capability: { name, kind, user_scope: userScope, background_scope: backgroundScope, input_schema_version: 1 as const, output_schema_version: 1 as const, contract_sha256: createHash("sha256").update(canonicalContractJson(contract)).digest("hex") } };
}
export const dreamOperations = [
  descriptor("resource-policy.read", "read", "resource-policy:read", resourcePolicyReadInputDto, resourcePolicyReadOutputDto, [policy.observer, policy.claudeCodeRuntime]),
  descriptor("resource-observer.publish", "write", "resource-observer:write", resourceObserverPublishInputDto, resourceObserverPublishOutputDto, [policy.observer, identitySchemaRequirement]),
  ...Object.entries(chatThreadOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, ...chatThreadSchemaRequirements], operation.kind === "read" ? "dream:read" : "dream:write")),
  descriptor("user-profile.current", "read", null, userProfileInputDto, userProfileOutputDto, [identitySchemaRequirement], "dream:read"),
  ...Object.entries(editorSessionOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, runtimePurposeSchemaRequirement], operation.userScope)),
  ...Object.entries(workflowContextOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, dreamUnifiedSchemaRequirement], operation.userScope)),
  ...Object.entries(deckVoiceOperationContracts).map(([name, operation]) => descriptor(name, operation.kind === "read" ? "read" : "write", null, operation.input, operation.output, [identitySchemaRequirement, ...deckVoiceSchemaRequirements], operation.kind === "read" ? "dream:read" : "dream:write")),
  ...Object.entries(userMessageOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, dreamUnifiedSchemaRequirement], operation.userScope)),
  ...Object.entries(workflowRunOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, dreamUnifiedSchemaRequirement], operation.userScope)),
  ...Object.entries(workflowRunCommandOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, workflowRunCommandSchemaRequirements(name as keyof typeof workflowRunCommandOperationContracts), operation.userScope)),
  ...Object.entries(deckRuntimeDataOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, ...deckRuntimeDataSchemaRequirements], operation.userScope)),
  ...Object.entries(workflowPreflightOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, dreamUnifiedSchemaRequirement], operation.userScope)),
  ...Object.entries(userPreferencesOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, ...userPreferencesSchemaRequirements], operation.userScope)),
  ...Object.entries(socialFriendshipOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, ...socialFriendshipSchemaRequirements], operation.userScope)),
  ...Object.entries(workflowPreflightExecutionOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, workflowPreflightExecutionSchemaRequirements, operation.userScope)),
  ...Object.entries(workflowRunCreationOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, workflowRunCreationSchemaRequirements, operation.userScope)),
  ...Object.entries(dreamLaunchSourceOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, dreamUnifiedSchemaRequirement], operation.userScope)),
  ...Object.entries(dreamLaunchDispatchOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, dreamUnifiedSchemaRequirement], operation.userScope)),
  ...Object.entries(workspaceDefaultOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, dreamUnifiedSchemaRequirement], operation.userScope)),
  ...Object.entries(dreamLaunchFailureOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, dreamUnifiedSchemaRequirement], operation.userScope)),
  ...Object.entries(userSystemConfigOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, ...userSystemConfigSchemaRequirements], operation.userScope)),
  ...Object.entries(threadSystemConfigOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, ...threadSystemConfigSchemaRequirements], operation.userScope)),
  ...Object.entries(reflectionsSectionConfigOperationContracts).map(([name, operation]) => descriptor(name, operation.kind, null, operation.input, operation.output, [identitySchemaRequirement, dreamUnifiedSchemaRequirement], operation.userScope)),
  ...Object.entries(reflectionTaskOperationContracts).map(([name, operation]) => descriptor(
    name,
    operation.kind,
    operation.audience === "background" ? operation.backgroundScope : null,
    operation.input,
    operation.output,
    [identitySchemaRequirement, ...reflectionTaskSchemaRequirements],
    operation.audience === "oauth" ? operation.userScope : null,
  )),
  ...Object.entries(localDataImportOperationContracts).map(([name, operation]) => descriptor(
    name, operation.kind, null, operation.input, operation.output,
    [identitySchemaRequirement, ...localDataImportSchemaRequirements], operation.userScope,
  )),
  ...Object.entries(pictureHistoryOperationContracts).map(([name, operation]) => descriptor(
    name, operation.kind, null, operation.input, operation.output,
    [identitySchemaRequirement, ...pictureHistorySchemaRequirements], operation.userScope,
  )),
  ...Object.entries(deckDefaultPluginResolveOperationContracts).map(([name, operation]) => descriptor(
    name, operation.kind, null, operation.input, operation.output,
    [identitySchemaRequirement, ...deckDefaultPluginResolveSchemaRequirements], operation.userScope,
  )),
  ...Object.entries(deckChatContextOperationContracts).map(([name, operation]) => descriptor(
    name, operation.kind, null, operation.input, operation.output,
    [identitySchemaRequirement, ...deckChatContextSchemaRequirements], operation.userScope,
  )),
  ...Object.entries(deckWorkspacePluginsOperationContracts).map(([name, operation]) => descriptor(
    name, operation.kind, null, operation.input, operation.output,
    [identitySchemaRequirement, ...deckWorkspacePluginsSchemaRequirements], operation.userScope,
  )),
  ...Object.entries(workflowManagedMcpScopeOperationContracts).map(([name, operation]) => descriptor(
    name, operation.kind, null, operation.input, operation.output,
    [identitySchemaRequirement, ...workflowManagedMcpScopeSchemaRequirements], operation.userScope,
  )),
  ...Object.entries(workflowRuntimeActivationOperationContracts).map(([name, operation]) => descriptor(
    name, operation.kind, null, operation.input, operation.output,
    [identitySchemaRequirement, ...workflowRuntimeActivationSchemaRequirements], operation.userScope,
  )),
  ...Object.entries(storyWorkspaceOutputOperationContracts).map(([name, operation]) => descriptor(
    name, operation.kind, null, operation.input, operation.output,
    [identitySchemaRequirement, ...storyWorkspaceOutputSchemaRequirements], operation.userScope,
  )),
  ...Object.entries(storyWorkspaceReviewOperationContracts).map(([name, operation]) => descriptor(
    name, operation.kind, null, operation.input, operation.output,
    [identitySchemaRequirement, ...storyWorkspaceReviewSchemaRequirements], operation.userScope,
  )),
  ...Object.entries(storyWorkspaceCatalogOperationContracts).map(([name, operation]) => descriptor(
    name, operation.kind, null, operation.input, operation.output,
    [identitySchemaRequirement, ...storyWorkspaceCatalogSchemaRequirements], operation.userScope,
  )),
  ...Object.entries(storyWorkspaceGuidanceOperationContracts).map(([name, operation]) => descriptor(
    name, operation.kind, null, operation.input, operation.output,
    [identitySchemaRequirement, ...storyWorkspaceGuidanceSchemaRequirements], operation.userScope,
  )),
  ...Object.entries(storyWorkspaceConfirmationOperationContracts).map(([name, operation]) => descriptor(
    name,
    operation.kind,
    operation.audience === "background" ? operation.backgroundScope : null,
    operation.input,
    operation.output,
    [identitySchemaRequirement, ...storyWorkspaceConfirmationRequirements(name as keyof typeof storyWorkspaceConfirmationOperationContracts)],
    operation.audience === "oauth" ? operation.userScope : null,
  )),
  ...Object.entries(deckPluginBindingOperationContracts).map(([name, operation]) => descriptor(
    name, operation.kind, null, operation.input, operation.output,
    [identitySchemaRequirement, ...deckPluginBindingSchemaRequirements], operation.userScope,
  )),
] as const;
