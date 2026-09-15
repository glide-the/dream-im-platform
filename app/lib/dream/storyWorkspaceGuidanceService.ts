// [Input] Strict Registry115 guidance command, OAuth principal, request identity and Admin transaction.
// [Output] Idempotent persisted message result plus new-only Dream Runtime dispatch DTO.
// [Pos] DTO-Service-typed ORM composition; Dream retains ThreadFactory, Runtime, EventBus and SSE.
// [Sync] 2026-09-15: implement guidance persistence and recovery as one Admin-owned transaction.
import { createHash } from "node:crypto";
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import { canonicalContractJson } from "./canonicalContractJson";
import type { DataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { StoryWorkspaceGuidanceRepository } from "./storyWorkspaceGuidanceRepository";
import * as dto from "./storyWorkspaceGuidanceDto";

export const storyWorkspaceGuidanceSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;
const guidableStatuses = new Set(["confirmed", "failed"]);

function messageId(input: dto.StoryWorkspaceGuidanceInput) {
  return `guide_${input.idempotency_key}`;
}

function commandFingerprint(actor: string, input: dto.StoryWorkspaceGuidanceInput) {
  return `sha256:${createHash("sha256").update(canonicalContractJson({
    story_workspace_run_id: input.workflow_run_id,
    actor,
    command_kind: input.kind,
    text: input.text,
    step_id: input.step_id,
  })).digest("hex")}`;
}

function turnText(input: dto.StoryWorkspaceGuidanceInput) {
  const prefix = `[story-workspace guidance · run ${input.workflow_run_id}]`;
  if (input.kind === "retry-step") {
    return `${prefix} retry step ${input.step_id}${input.text ? `: ${input.text}` : ""}`;
  }
  return `${prefix} ${input.text ?? ""}`;
}

function textSummary(input: dto.StoryWorkspaceGuidanceInput) {
  const value = input.kind === "retry-step"
    ? `retry-step ${input.step_id}${input.text ? `: ${input.text}` : ""}`
    : input.text ?? "";
  return Array.from(value).slice(0, 200).join("");
}

function decodeStored(row: Awaited<ReturnType<StoryWorkspaceGuidanceRepository["message"]>>) {
  if (!row || row.metadata === null) return null;
  try {
    const parts: unknown = JSON.parse(row.parts);
    const metadata: unknown = JSON.parse(row.metadata);
    const parsedParts = dto.storyWorkspaceGuidanceDispatchDto.shape.parts.safeParse(parts);
    const parsedMetadata = dto.storyWorkspaceGuidanceMetadataDto.safeParse(metadata);
    if (!parsedParts.success || !parsedMetadata.success) return null;
    return { row, parts: parsedParts.data, metadata: parsedMetadata.data };
  } catch {
    return null;
  }
}

export async function runStoryWorkspaceGuidanceOperation(
  operation: dto.StoryWorkspaceGuidanceOperation,
  rawInput: unknown,
  rawPrincipal: unknown,
  serviceId: string,
  requestId: string,
  tx: DataTransaction,
) {
  const contract = dto.storyWorkspaceGuidanceOperationContracts[operation];
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const input = parsed.data;
  const principal = principalDto.parse(rawPrincipal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);

  const store = new StoryWorkspaceGuidanceRepository(tx, principal.canonical_user_id);
  const run = await store.ownedRun(input.workflow_run_id);
  if (!run) throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
  if (!guidableStatuses.has(run.status) || run.source_voice_thread_id === null
    || !await store.ownsThread(run.source_voice_thread_id)) {
    throw new AuthBoundaryError("WORKFLOW_RUN_NOT_GUIDABLE", 409);
  }
  const threadId = run.source_voice_thread_id;

  return new ReceiptRepository(tx, serviceId, principal.subject).execute(
    operation,
    requestId,
    input,
    contract.output,
    async () => {
      const id = messageId(input);
      const fingerprint = commandFingerprint(principal.canonical_user_id, input);
      await store.lockMessageIdentity(id);
      const prior = decodeStored(await store.message(id));
      if (prior) {
        const matches = prior.row.thread_id === threadId
          && prior.row.role === "user"
          && prior.metadata.story_workspace_run_id === input.workflow_run_id
          && prior.metadata.actor === principal.canonical_user_id
          && prior.metadata.idempotency_key === input.idempotency_key
          && prior.metadata.command_fingerprint === fingerprint;
        if (!matches) throw new AuthBoundaryError("IDEMPOTENCY_CONFLICT", 409);
        return {
          message_id: id,
          story_workspace_run_id: input.workflow_run_id,
          review_action: "guide" as const,
          status: "accepted" as const,
          replayed: true,
          request_id: prior.metadata.request_id,
          dispatch: null,
        };
      }
      if (await store.message(id)) throw new AuthBoundaryError("IDEMPOTENCY_CONFLICT", 409);

      const parts = [{ type: "text" as const, text: turnText(input) }];
      const metadata: dto.StoryWorkspaceGuidanceMetadata = {
        kind: "story-workspace-guidance",
        story_workspace_run_id: input.workflow_run_id,
        actor: principal.canonical_user_id,
        request_id: requestId,
        idempotency_key: input.idempotency_key,
        command_kind: input.kind,
        step_id: input.step_id,
        text_summary: textSummary(input),
        review_action: "guide",
        command_fingerprint: fingerprint,
      };
      const partsJson = canonicalContractJson(parts);
      const metadataJson = canonicalContractJson(metadata);
      if (!await store.insertMessage(id, threadId, partsJson, metadataJson)) {
        throw new AuthBoundaryError("IDEMPOTENCY_CONFLICT", 409);
      }
      return {
        message_id: id,
        story_workspace_run_id: input.workflow_run_id,
        review_action: "guide" as const,
        status: "accepted" as const,
        replayed: false,
        request_id: requestId,
        dispatch: { thread_id: threadId, message_id: id, parts, metadata },
      };
    },
    threadId,
    null,
    input.workflow_run_id,
  );
}
