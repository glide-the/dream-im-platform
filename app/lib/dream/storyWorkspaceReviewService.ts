// [Input] Strict Registry111 command, OAuth principal and caller-owned Admin transaction.
// [Output] Idempotent single or batch review result with ORM mutation, receipt and audit in one UOW.
// [Pos] Dream product-review service; Admin management review and Dream Runtime remain separate.
// [Sync] 2026-09-15: retain operation-specific result types as Registry114 adds another Story domain.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { StoryWorkspaceReviewRepository } from "./storyWorkspaceReviewRepository";
import * as dto from "./storyWorkspaceReviewDto";

export const storyWorkspaceReviewSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;

export function runStoryWorkspaceReviewOperation(
  operation: "story-workspace-review.transition", rawInput: unknown, rawPrincipal: unknown,
  serviceId: string, requestId: string, tx: DataTransaction,
): Promise<dto.StoryWorkspaceReviewTransitionResult>;
export function runStoryWorkspaceReviewOperation(
  operation: "story-workspace-review.batch", rawInput: unknown, rawPrincipal: unknown,
  serviceId: string, requestId: string, tx: DataTransaction,
): Promise<dto.StoryWorkspaceReviewBatchResult>;
export function runStoryWorkspaceReviewOperation(
  operation: dto.StoryWorkspaceReviewOperation, rawInput: unknown, rawPrincipal: unknown,
  serviceId: string, requestId: string, tx: DataTransaction,
): Promise<dto.StoryWorkspaceReviewTransitionResult | dto.StoryWorkspaceReviewBatchResult>;
export async function runStoryWorkspaceReviewOperation(
  operation: dto.StoryWorkspaceReviewOperation,
  rawInput: unknown,
  rawPrincipal: unknown,
  serviceId: string,
  requestId: string,
  tx: DataTransaction,
) {
  const principal = principalDto.parse(rawPrincipal);
  if (!principal.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const store = new StoryWorkspaceReviewRepository(tx, principal.canonical_user_id);
  const receipts = new ReceiptRepository(tx, serviceId, principal.subject);
  if (operation === "story-workspace-review.transition") {
    const contract = dto.storyWorkspaceReviewOperationContracts[operation];
    const parsed = contract.input.safeParse(rawInput);
    if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
    return receipts.execute(operation, requestId, parsed.data, contract.output,
      async () => contract.output.parse(await store.transition(parsed.data, requestId)));
  }
  if (operation === "story-workspace-review.batch") {
    const contract = dto.storyWorkspaceReviewOperationContracts[operation];
    const parsed = contract.input.safeParse(rawInput);
    if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
    return receipts.execute(operation, requestId, parsed.data, contract.output,
      async () => contract.output.parse(await store.batch(parsed.data, requestId)));
  }
  throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
}
