// [Input] Registry169 DTO, verified actor authority and caller-owned Admin UOW.
// [Output] Idempotent auto-repair terminal status with original receipt and audit.
// [Pos] DTO-Service-typed Drizzle composition; Dream retains Runtime, SSE and files.
// [Sync] 2026-09-16: implement the existing state transition as one Admin transaction.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import { z } from "zod";
import { canonicalContractJson } from "./canonicalContractJson";
import type { DataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { DreamAutoRepairRepository } from "./dreamAutoRepairRepository";
import * as dto from "./dreamAutoRepairDto";

export const dreamAutoRepairSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;
export type DreamAutoRepairActor = {
  principal: unknown;
  threadScope: string | null;
  runScope: string | null;
  editorSessionScope?: string | null;
};

function decodeStored(raw: string | null) {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    const parsed = zStoredMetadata.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const projectCleanupStoredDto = z.strictObject({
  trustedProjectSlug: z.string(),
  staleProjectSlugs: z.array(z.string()),
}).optional();
const zStoredMetadata = z.strictObject({
  kind: z.literal("story-workspace-dream-auto-repair"),
  schemaVersion: z.literal("story-workspace-dream-auto-repair/v1"),
  originatingMessageId: z.string(),
  originatingTurnId: z.string(),
  workflowRunId: z.string(),
  repairAttempt: z.literal(1),
  validationCode: z.string(),
  idempotencyKey: z.string(),
  projectCleanup: projectCleanupStoredDto,
  dispatch_status: z.enum(["dispatching", "dispatched", "failed"]),
});

function expectedStoredIdentity(value: dto.DreamAutoRepairIdentity) {
  return {
    kind: value.kind,
    schemaVersion: value.schema_version,
    originatingMessageId: value.originating_message_id,
    originatingTurnId: value.originating_turn_id,
    workflowRunId: value.workflow_run_id,
    repairAttempt: value.repair_attempt,
    validationCode: value.validation_code,
    idempotencyKey: value.idempotency_key,
    ...(value.project_cleanup === null ? {} : { projectCleanup: {
      trustedProjectSlug: value.project_cleanup.trusted_project_slug,
      staleProjectSlugs: value.project_cleanup.stale_project_slugs,
    } }),
  };
}

function storedIdentity(value: z.infer<typeof zStoredMetadata>) {
  const parsed = dto.dreamAutoRepairIdentityDto.safeParse({
    kind: value.kind,
    schema_version: value.schemaVersion,
    originating_message_id: value.originatingMessageId,
    originating_turn_id: value.originatingTurnId,
    workflow_run_id: value.workflowRunId,
    repair_attempt: value.repairAttempt,
    validation_code: value.validationCode,
    idempotency_key: value.idempotencyKey,
    project_cleanup: value.projectCleanup === undefined ? null : {
      trusted_project_slug: value.projectCleanup.trustedProjectSlug,
      stale_project_slugs: value.projectCleanup.staleProjectSlugs,
    },
  });
  return parsed.success ? expectedStoredIdentity(parsed.data) : null;
}

export async function runDreamAutoRepairOperation(
  operation: dto.DreamAutoRepairOperation,
  rawInput: unknown,
  actor: DreamAutoRepairActor,
  serviceId: string,
  requestId: string,
  tx: DataTransaction,
) {
  const contract = dto.dreamAutoRepairOperationContracts[operation];
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const input = parsed.data;
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if ((actor.threadScope !== null && actor.threadScope !== input.thread_id)
    || (actor.runScope !== null && actor.runScope !== input.expected_identity.workflow_run_id)
    || (actor.editorSessionScope ?? null) !== null) {
    throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  }

  const store = new DreamAutoRepairRepository(tx, principal.canonical_user_id);
  return new ReceiptRepository(tx, serviceId, principal.subject).execute(
    operation,
    requestId,
    input,
    contract.output,
    async () => {
      const row = await store.lockOwnedUserMessage(input.thread_id, input.message_id);
      const stored = row ? decodeStored(row.metadata) : null;
      const expected = expectedStoredIdentity(input.expected_identity);
      const currentIdentity = stored ? storedIdentity(stored) : null;
      if (!row || !stored || currentIdentity === null
        || canonicalContractJson(expected) !== canonicalContractJson(currentIdentity)) {
        throw new AuthBoundaryError("DREAM_AUTO_REPAIR_MESSAGE_INVALID", 409);
      }
      if (stored.dispatch_status === input.status) {
        return { message_id: input.message_id, status: input.status, changed: false };
      }
      const transitionAllowed = stored.dispatch_status === "dispatching"
        || (stored.dispatch_status === "dispatched" && input.status === "failed");
      if (!transitionAllowed) throw new AuthBoundaryError("DREAM_AUTO_REPAIR_MESSAGE_CONFLICT", 409);
      const metadata = canonicalContractJson({ ...stored, dispatch_status: input.status });
      if (!await store.updateMetadata(input.thread_id, input.message_id, metadata)) {
        throw new AuthBoundaryError("DREAM_AUTO_REPAIR_MESSAGE_CONFLICT", 409);
      }
      return { message_id: input.message_id, status: input.status, changed: true };
    },
    actor.threadScope,
    null,
    actor.runScope,
  );
}
