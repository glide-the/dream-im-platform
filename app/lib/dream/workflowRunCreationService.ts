// [Input] Verified OAuth owner and closed create/retry envelopes through caller-owned Admin transactions.
// [Output] Original atomic queued Run, token consumption and two transitions with scoped result/audit recovery.
// [Pos] Workflow creation composition; no Session/Runtime/FS or generic lifecycle patch.
// [Sync] 2026-09-15: reuse current-owner/frozen/source validation for bounded original receipt lookup.
import { randomUUID, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { AuthBoundaryError } from "../auth/config";
import { principalDto, requestIdDto, type PrincipalDto } from "../auth/dto";
import type { PreflightStageTransaction } from "./workflowPreflightExecutionService";
import { WorkflowTokenAuthority } from "./workflowTokenAuthority";
import { WorkflowRunCreationRepository } from "./workflowRunCreationRepository";
import { ReceiptRepository, operationInputDigest, operationRequestKeyDigest } from "./receipts";
import { sql } from "drizzle-orm";
import type { DataTransaction } from "./database";
import { projectStoredWorkflowRun, projectWorkflowTimestamp } from "./workflowRunService";
import { workflowRunReadOutputDto, workflowTimestampMicros, type WorkflowRun } from "./workflowRunDto";
import { workflowRunCreateInputDto, workflowRunRetryInputDto, type WorkflowRunCreateInput, type WorkflowRunCreationOperation } from "./workflowRunCreationDto";
import { identitySchemaRequirement } from "./schemaRequirements";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { analyzeWorkflowRunCreation, frozenRunSourceFromRun, normalizeWorkflowRunSourceTime, workflowRunSourceFacts, type WorkflowRunSource } from "./workflowRunCreationSemantics";
export const workflowRunCreationSchemaRequirements = [identitySchemaRequirement, dreamUnifiedSchemaRequirement] as const;

const conflict = (): never => { throw new AuthBoundaryError("IDEMPOTENCY_CONFLICT", 409); };
const retryMismatch = (): never => { throw new AuthBoundaryError("RETRY_SOURCE_MISMATCH", 409); };
class CompletedRetryRead extends Error {
  constructor(readonly run: WorkflowRun) { super("Read-only retry prerequisite complete."); }
}
function equalSecret(expected: string, actual: string) {
  const left = Buffer.from(expected, "utf8"), right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
function requireRetry(original: WorkflowRun, key: string) {
  if (!["failed", "rejected", "cancelled"].includes(original.status) || original.idempotency_key === key) retryMismatch();
}
async function requireSource(repository: WorkflowRunCreationRepository, source: WorkflowRunSource, deckId: string | null = null) {
  if (source.source_voice_thread_id === null && source.source_message_id === null && source.source_message_time === null) return;
  if (source.source_voice_thread_id === null || source.source_message_id === null || source.source_message_time === null) throw new AuthBoundaryError("INVALID_RUN_REQUEST", 400);
  const row = await repository.source(source.source_voice_thread_id, source.source_message_id);
  if (!row || row.role !== "user" || row.created_at === null || (deckId !== null && row.deck_id !== deckId) ||
    projectWorkflowTimestamp(row.created_at) !== normalizeWorkflowRunSourceTime(source.source_message_time)) throw new AuthBoundaryError("WORKFLOW_SOURCE_NOT_AUTHORIZED", 403);
}
async function validateBoundedRunResult(repository: WorkflowRunCreationRepository, principal: PrincipalDto, prior: NonNullable<Awaited<ReturnType<ReceiptRepository["find"]>>>) {
  const result = workflowRunReadOutputDto.parse(prior.result), run = result.run;
  if (prior.runScope !== run.workflow_run_id || prior.threadScope !== run.source_voice_thread_id || prior.editorSessionScope !== null || run.created_by !== principal.canonical_user_id)
    throw new AuthBoundaryError("WORKFLOW_RUN_DATA_INVALID");
  const current = projectStoredWorkflowRun(await repository.runs.read(principal.canonical_user_id, { workspace_id: run.workspace_id, workflow_run_id: run.workflow_run_id }, true));
  if (current.workflow_run_id !== run.workflow_run_id || current.workspace_id !== run.workspace_id || current.created_by !== run.created_by ||
    current.idempotency_key !== run.idempotency_key || current.semantic_fingerprint !== run.semantic_fingerprint || current.retry_of_run_id !== run.retry_of_run_id ||
    !isDeepStrictEqual(frozenRunSourceFromRun(current), frozenRunSourceFromRun(run))) throw new AuthBoundaryError("WORKFLOW_RUN_DATA_INVALID");
  await requireSource(repository, workflowRunSourceFacts(current)); return result;
}
export async function readOriginalRunCreationReceipt(tx: DataTransaction, serviceClientId: string, rawPrincipal: PrincipalDto, operation: WorkflowRunCreationOperation, rawRequestId: string) {
  const principal = principalDto.parse(rawPrincipal), requestId = requestIdDto.parse(rawRequestId);
  if (!principal.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (operation !== "workflow-run.create" && operation !== "workflow-run.retry") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const prior = await new ReceiptRepository(tx, serviceClientId, principal.subject).find(operation, requestId);
  if (!prior) return { status: "absent" as const, operation, request_id: requestId };
  const bounded = workflowRunReadOutputDto.parse(prior.result);
  const repository = new WorkflowRunCreationRepository(tx, principal.canonical_user_id, bounded.run.workspace_id);
  await repository.assertWorkspace();
  const result = await validateBoundedRunResult(repository, principal, prior);
  return { status: "committed" as const, operation, request_id: requestId, result };
}
export class WorkflowRunCreationService {
  private readonly authority = new WorkflowTokenAuthority();
  constructor(private readonly transaction: PreflightStageTransaction) {}
  async execute(operation: WorkflowRunCreationOperation, serviceClientId: string, rawPrincipal: PrincipalDto, rawRequestId: string, rawInput: unknown) {
    const principal = principalDto.parse(rawPrincipal), requestId = requestIdDto.parse(rawRequestId);
    if (!principal.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
    if (operation !== "workflow-run.create" && operation !== "workflow-run.retry") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const parsed = (operation === "workflow-run.create" ? workflowRunCreateInputDto : workflowRunRetryInputDto).safeParse(rawInput);
    if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
    const input = parsed.data;
    let observedRetry: WorkflowRun | null = null;
    if (operation === "workflow-run.retry") {
      const retry = workflowRunRetryInputDto.parse(input);
      // The deliberate sentinel rolls back the successful read-only UOW,
      // preserving the original clean boundary before the atomic write UOW.
      try {
        await this.transaction(async tx => {
          const repository = new WorkflowRunCreationRepository(tx, principal.canonical_user_id, input.workspace_id);
          await repository.assertWorkspace();
          const original = projectStoredWorkflowRun(await repository.runs.read(principal.canonical_user_id, retry));
          requireRetry(original, retry.idempotency_key); throw new CompletedRetryRead(original);
        });
      } catch (error) {
        if (!(error instanceof CompletedRetryRead)) throw error;
        observedRetry = error.run;
      }
    }
    return this.transaction(async tx => {
      const repository = new WorkflowRunCreationRepository(tx, principal.canonical_user_id, input.workspace_id);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${operationRequestKeyDigest(serviceClientId, principal.subject, operation, requestId)}, 0))`);
      await repository.lockKey(input.idempotency_key); await repository.assertWorkspace();
      const receipts = new ReceiptRepository(tx, serviceClientId, principal.subject), prior = await receipts.find(operation, requestId);
      if (prior) {
        const result = workflowRunReadOutputDto.parse(prior.result), run = result.run;
        if (prior.inputSha256 !== operationInputDigest(input) || prior.runScope !== run.workflow_run_id || prior.threadScope !== run.source_voice_thread_id || prior.editorSessionScope !== null) throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
        if (run.workspace_id !== input.workspace_id || run.created_by !== principal.canonical_user_id) throw new AuthBoundaryError("WORKFLOW_RUN_DATA_INVALID");
        return validateBoundedRunResult(repository, principal, prior);
      }
      let retryOfRunId: string | null = null;
      let source: WorkflowRunSource;
      if (observedRetry) {
        const original = projectStoredWorkflowRun(await repository.runs.read(principal.canonical_user_id, { workspace_id: input.workspace_id, workflow_run_id: observedRetry.workflow_run_id }, true));
        requireRetry(original, input.idempotency_key);
        if (!isDeepStrictEqual(frozenRunSourceFromRun(original), frozenRunSourceFromRun(observedRetry))) retryMismatch();
        retryOfRunId = original.workflow_run_id; source = workflowRunSourceFacts(original);
      } else source = workflowRunSourceFacts(workflowRunCreateInputDto.parse(input));
      const context = await repository.context(input.workflow_preflight_id);
      if (!context || context.manifest_hash !== context.lock_manifest_hash) throw new AuthBoundaryError("PREFLIGHT_NOT_FOUND_OR_NOT_AUTHORIZED", 404);
      if (!this.authority.verify({ ...context, deck_runtime_snapshot_id: context.deck_runtime_snapshot_id!, expires_at: projectWorkflowTimestamp(context.expires_at)! }, input.preflight_token)) throw new AuthBoundaryError("PREFLIGHT_TOKEN_INVALID", 409);
      const tokenDigest = this.authority.consumptionDigest(input.preflight_token), consumption = await repository.tokenConsumption(tokenDigest);
      if (context.created_by !== principal.canonical_user_id || context.binding_creator_id !== principal.canonical_user_id || context.binding_workspace_id !== input.workspace_id) {
        if (consumption) conflict(); throw new AuthBoundaryError("PREFLIGHT_NOT_FOUND_OR_NOT_AUTHORIZED", 404);
      }
      await requireSource(repository, source, context.deck_id);
      const { fingerprint, frozenSource } = await analyzeWorkflowRunCreation(context, source, retryOfRunId);
      if (observedRetry && !isDeepStrictEqual(frozenSource, frozenRunSourceFromRun(observedRetry))) retryMismatch();
      const existing = await repository.scopedRun(input.idempotency_key);
      if (consumption) {
        if (consumption.workflow_preflight_id !== context.workflow_preflight_id || consumption.workspace_id !== input.workspace_id ||
          consumption.actor_id !== principal.canonical_user_id || consumption.idempotency_key !== input.idempotency_key || consumption.semantic_fingerprint !== fingerprint ||
          !existing || existing.workflow_run_id !== consumption.workflow_run_id || existing.semantic_fingerprint !== fingerprint || existing.retry_of_run_id !== retryOfRunId) conflict();
      } else {
        if (context.status !== "passed") throw new AuthBoundaryError("PREFLIGHT_TOKEN_INVALID", 409);
        if (workflowTimestampMicros(projectWorkflowTimestamp(context.expires_at)!) <= workflowTimestampMicros(projectWorkflowTimestamp(await repository.clock())!)) throw new AuthBoundaryError("PREFLIGHT_TOKEN_EXPIRED", 409);
        if (context.consumed_at !== null) throw new AuthBoundaryError("PREFLIGHT_TOKEN_REPLAYED", 409);
        if (context.preflight_token_hash === null || !equalSecret(this.authority.tokenHash(input.preflight_token), context.preflight_token_hash)) throw new AuthBoundaryError("PREFLIGHT_TOKEN_INVALID", 409);
        if (existing && (existing.semantic_fingerprint !== fingerprint || existing.retry_of_run_id !== retryOfRunId)) conflict();
      }
      const runId = existing?.workflow_run_id ?? `run_${randomUUID().replaceAll("-", "")}`;
      return receipts.execute(operation, requestId, input, workflowRunReadOutputDto, async () => {
        if (!existing) {
          const now = projectWorkflowTimestamp(await repository.clock())!;
          await repository.insertRun({ id: runId, workspace_id: input.workspace_id, deck_plugin_id: context.deck_plugin_id, deck_plugin_version: context.deck_plugin_version,
            workflow_definition_ref: context.workflow_definition_ref, deck_runtime_snapshot_id: context.deck_runtime_snapshot_id!, status: "preflight", status_version: 1,
            retry_of_run_id: retryOfRunId, deck_plugin_manifest_hash: context.manifest_hash, deck_plugin_binding_id: context.deck_plugin_binding_id,
            binding_revision: context.binding_revision, runtime_plugin_lock_id: context.runtime_plugin_lock_id, workflow_preflight_id: context.workflow_preflight_id,
            source_voice_thread_id: source.source_voice_thread_id, source_message_id: source.source_message_id, source_message_time: normalizeWorkflowRunSourceTime(source.source_message_time),
            idempotency_key: input.idempotency_key, input_hash: context.input_hash, semantic_fingerprint: fingerprint, created_by: principal.canonical_user_id, created_at: now });
          await this.consume(repository, input, tokenDigest, runId, fingerprint, principal);
          await repository.append({ id: `wrt_${randomUUID().replaceAll("-", "")}`, workflow_run_id: runId, transition_seq: 1, from_status: null,
            to_status: "preflight", actor_id: principal.canonical_user_id, reason_code: "run_created", occurred_at: now });
          await repository.queue(runId);
          await repository.append({ id: `wrt_${randomUUID().replaceAll("-", "")}`, workflow_run_id: runId, transition_seq: 2, from_status: "preflight",
            to_status: "queued", actor_id: principal.canonical_user_id, reason_code: "preflight_passed", occurred_at: now });
        } else if (!consumption) await this.consume(repository, input, tokenDigest, runId, fingerprint, principal);
        return workflowRunReadOutputDto.parse({ run: projectStoredWorkflowRun(await repository.runs.read(principal.canonical_user_id, { workspace_id: input.workspace_id, workflow_run_id: runId })) });
      }, source.source_voice_thread_id, null, runId);
    });
  }
  private async consume(repository: WorkflowRunCreationRepository, input: Pick<WorkflowRunCreateInput, "workflow_preflight_id" | "workspace_id" | "idempotency_key">,
    tokenDigest: string, runId: string, fingerprint: string, principal: PrincipalDto) {
    await repository.consume({ token_digest: tokenDigest, workflow_run_id: runId, workflow_preflight_id: input.workflow_preflight_id,
      workspace_id: input.workspace_id, actor_id: principal.canonical_user_id, idempotency_key: input.idempotency_key, semantic_fingerprint: fingerprint },
    projectWorkflowTimestamp(await repository.clock())!, projectWorkflowTimestamp(await repository.clock())!);
  }
}
