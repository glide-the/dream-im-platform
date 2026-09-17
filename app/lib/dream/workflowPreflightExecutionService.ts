// [Input] Verified OAuth owner, original request and server-owned transaction/check collaborators.
// [Output] Fixed eight-check Preflight with retained commits and encrypted original response recovery.
// [Pos] Admin lifecycle orchestration; Runtime/FS stay Dream, failures never create Run/Session.
// [Sync] 2026-09-15: preserve stage commits and raw stored token bindings before output normalization.
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { preflightTokenTtlSeconds } from "../../../config/dream-domain-policy";
import { AuthBoundaryError } from "../auth/config";
import { principalDto, requestIdDto, type PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { canonicalBusinessJson } from "./deckContentCanonical";
import { ReceiptRepository, operationInputDigest } from "./receipts";
import { WorkflowPreflightDependencyService } from "./workflowPreflightDependencyService";
import { WorkflowPreflightCheckError } from "./workflowPreflightDependencies";
import { WorkflowPreflightExecutionRepository, preflightExecuteOperation, type PreflightRequestContext, type WorkflowPreflightExecutionRow } from "./workflowPreflightExecutionRepository";
import { workflowPreflightExecutionInputDto, workflowPreflightExecutionOutputDto, workflowPreflightSecretReceiptDto, type WorkflowPreflightExecutionOutput } from "./workflowPreflightExecutionDto";
import { workflowPreflightCheckDto, workflowPreflightDto } from "./workflowPreflightDto";
import { WorkflowPreflightSecretReceipt, type PreflightReceiptBinding } from "./workflowPreflightSecretReceipt";
import { WorkflowTokenAuthority } from "./workflowTokenAuthority";
import { projectWorkflowTimestamp } from "./workflowRunService";
import { workflowTimeDto, workflowTimestampMicros, workflowUtcFromMicroseconds } from "./workflowRunDto";
type PreflightCheck = z.output<typeof workflowPreflightCheckDto>;
const checkErrors: Record<PreflightCheck, string> = { identity_workspace_permission: "WORKFLOW_PERMISSION_DENIED", binding_release: "DECK_PLUGIN_UNAVAILABLE",
  manifest_workflow_schema: "DECK_PLUGIN_MANIFEST_INVALID", host_agent_runtime_compatibility: "CLAUDE_AGENT_INCOMPATIBLE",
  capability_source_policy: "WORKFLOW_PERMISSION_DENIED", deck_runtime_snapshot: "DECK_RUNTIME_CONFIG_INVALID",
  runtime_materialization: "RUNTIME_PLUGIN_NOT_READY", token_issuance: "PREFLIGHT_TOKEN_ISSUE_FAILED" };
export type PreflightStageTransaction = <T>(action: (tx: DataTransaction) => Promise<T>) => Promise<T>;
type DependencyFactory = (tx: DataTransaction, canonicalUserId: string, workspaceId: string) => WorkflowPreflightDependencyService;
export function projectPreflightExecutionRow(row: WorkflowPreflightExecutionRow, token: string | null = null) {
  try {
    return workflowPreflightDto.parse({ workflow_preflight_id: row.workflow_preflight_id, deck_id: row.deck_id, binding_revision: row.binding_revision,
      deck_plugin_id: row.deck_plugin_id, deck_plugin_version: row.deck_plugin_version, runtime_plugin_lock_id: row.runtime_plugin_lock_id,
      deck_runtime_profile_id: row.deck_runtime_profile_id, deck_runtime_snapshot_id: row.deck_runtime_snapshot_id,
      deck_runtime_snapshot_summary_hash: row.deck_runtime_snapshot_summary_hash, input_hash: row.input_hash, status: row.status,
      error_code: row.error_code, failed_check: row.failed_check, expires_at: projectWorkflowTimestamp(row.expires_at), preflight_token: token,
      created_by: row.created_by, created_at: projectWorkflowTimestamp(row.created_at) });
  } catch { throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_DATA_INVALID"); }
}
export class WorkflowPreflightExecutionService {
  private readonly authority = new WorkflowTokenAuthority();
  private readonly cipher = new WorkflowPreflightSecretReceipt();
  private readonly ttl = BigInt(preflightTokenTtlSeconds()) * 1_000_000n;
  constructor(private readonly transaction: PreflightStageTransaction,
    private readonly dependencies: DependencyFactory = (tx, owner, workspace) => new WorkflowPreflightDependencyService(tx, owner, workspace)) {}
  private binding(context: PreflightRequestContext, preflightId: string): PreflightReceiptBinding {
    return { service_client_id: context.serviceClientId, actor: context.actor, operation: preflightExecuteOperation,
      request_id: context.requestId, input_sha256: context.inputSha256, workflow_preflight_id: preflightId,
      canonical_user_id: context.canonicalUserId, workspace_id: context.input.workspace_id };
  }
  private expiry(now: string) { return workflowUtcFromMicroseconds(workflowTimestampMicros(workflowTimeDto.parse(projectWorkflowTimestamp(now))) + this.ttl); }
  private async prior(tx: DataTransaction, context: PreflightRequestContext, repo: WorkflowPreflightExecutionRepository) {
    const association = await repo.association(), receipt = await new ReceiptRepository(tx, context.serviceClientId, context.actor).find(preflightExecuteOperation, context.requestId);
    if (!association) { if (receipt) throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_RECEIPT_UNAVAILABLE"); return null; }
    if (receipt) {
      if (receipt.inputSha256 !== context.inputSha256 || receipt.threadScope !== null || receipt.editorSessionScope !== null || receipt.runScope !== null) throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
      return this.cipher.recover(this.binding(context, association.workflowPreflightId), receipt.result);
    }
    const row = await repo.read(association.workflowPreflightId);
    if (!association.executionOwner || row.status !== "checking") throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_RECEIPT_UNAVAILABLE");
    return workflowPreflightExecutionOutputDto.parse({ request_state: "in_progress", preflight: projectPreflightExecutionRow(row) });
  }
  private async guard(tx: DataTransaction, context: PreflightRequestContext, preflightId: string) {
    const repo = new WorkflowPreflightExecutionRepository(tx, context);
    await repo.lockRequest(); await repo.assertWorkspace();
    const association = await repo.association();
    if (!association?.executionOwner || association.workflowPreflightId !== preflightId || (await repo.read(preflightId)).status !== "checking") throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_DATA_INVALID");
    return repo;
  }
  private async finish(context: PreflightRequestContext, preflightId: string, action: (tx: DataTransaction, repo: WorkflowPreflightExecutionRepository) => Promise<WorkflowPreflightExecutionOutput>) {
    return this.transaction(async tx => {
      const stored = await new ReceiptRepository(tx, context.serviceClientId, context.actor).execute(preflightExecuteOperation, context.requestId, context.input, workflowPreflightSecretReceiptDto, async () => {
        const repo = await this.guard(tx, context, preflightId);
        return this.cipher.store(this.binding(context, preflightId), await action(tx, repo));
      });
      // Replay may bypass action; repeat current workspace/request ownership before decrypting.
      const repo = new WorkflowPreflightExecutionRepository(tx, context);
      await repo.assertWorkspace();
      const association = await repo.association();
      if (association?.workflowPreflightId !== preflightId) throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_RECEIPT_UNAVAILABLE");
      return this.cipher.recover(this.binding(context, preflightId), stored);
    });
  }
  async execute(serviceClientId: string, rawPrincipal: PrincipalDto, rawRequestId: string, rawInput: unknown): Promise<WorkflowPreflightExecutionOutput> {
    const parsed = workflowPreflightExecutionInputDto.safeParse(rawInput);
    if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
    const principal = principalDto.parse(rawPrincipal), requestId = requestIdDto.parse(rawRequestId);
    if (!principal.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
    const input = parsed.data, context: PreflightRequestContext = { serviceClientId, actor: principal.subject, canonicalUserId: principal.canonical_user_id,
      requestId, input, inputSha256: operationInputDigest(input) };
    const canonical = await canonicalBusinessJson(input.input_json);
    const fingerprint = (await canonicalBusinessJson(JSON.stringify({ deck_id: input.deck_id, binding_revision: input.binding_revision,
      input_hash: canonical.content_hash, actor: principal.canonical_user_id }))).content_hash;
    const initial = await this.transaction(async tx => {
      const repo = new WorkflowPreflightExecutionRepository(tx, context);
      await repo.lockRequest(); await repo.assertWorkspace();
      const prior = await this.prior(tx, context, repo);
      if (prior) return { result: prior };
      const now = await repo.clock(), reusable = await repo.active(fingerprint, now);
      if (reusable) {
        await repo.reserve(reusable, false);
        const row = await repo.read(reusable), model = projectPreflightExecutionRow(row);
        const token = model.status === "passed" ? this.authority.issueStored({ ...row, deck_runtime_snapshot_id: row.deck_runtime_snapshot_id! }) : null;
        const result = workflowPreflightExecutionOutputDto.parse({ request_state: "committed", preflight: { ...model, preflight_token: token } });
        const stored = await new ReceiptRepository(tx, context.serviceClientId, context.actor).execute(preflightExecuteOperation, requestId, input, workflowPreflightSecretReceiptDto,
          async () => this.cipher.store(this.binding(context, reusable), result));
        return { result: this.cipher.recover(this.binding(context, reusable), stored) };
      }
      const preflightId = `pf_${randomUUID().replaceAll("-", "")}`;
      await repo.checking(preflightId, fingerprint, canonical.content_hash, now, this.expiry(now));
      await repo.reserve(preflightId, true); await repo.audit("checking");
      return { preflightId };
    });
    if (initial.result) return initial.result;
    const preflightId = initial.preflightId!;
    let currentCheck: PreflightCheck = "identity_workspace_permission";
    try {
      const binding = await this.transaction(async tx => {
        const repo = await this.guard(tx, context, preflightId), dependencies = this.dependencies(tx, principal.canonical_user_id, input.workspace_id);
        await dependencies.identity(input.deck_id);
        currentCheck = "binding_release";
        const binding = await dependencies.binding(input.deck_id, input.binding_revision);
        await repo.binding(preflightId, binding, await repo.clock()); await repo.audit("binding");
        return binding;
      });
      currentCheck = "manifest_workflow_schema";
      const snapshot = await this.transaction(async tx => {
        const repo = await this.guard(tx, context, preflightId), dependencies = this.dependencies(tx, principal.canonical_user_id, input.workspace_id);
        await dependencies.identity(input.deck_id);
        await dependencies.manifest(binding, input.input_json);
        currentCheck = "host_agent_runtime_compatibility"; await dependencies.compatibility(binding);
        currentCheck = "capability_source_policy"; await dependencies.capabilities(binding);
        currentCheck = "deck_runtime_snapshot";
        const snapshot = await dependencies.snapshot(input.deck_id, binding); await repo.audit("snapshot", { reused: Number(snapshot.reused) });
        return snapshot;
      });
      await this.transaction(async tx => {
        const repo = await this.guard(tx, context, preflightId);
        await repo.snapshot(preflightId, snapshot, await repo.clock()); await repo.audit("snapshot_binding");
      });
      currentCheck = "runtime_materialization";
      return await this.finish(context, preflightId, async (tx, repo) => {
        const dependencies = this.dependencies(tx, principal.canonical_user_id, input.workspace_id);
        await dependencies.identity(input.deck_id); await dependencies.materialization(binding);
        currentCheck = "token_issuance";
        const row = await repo.read(preflightId), now = await repo.clock(), expiry = this.expiry(now);
        const token = this.authority.issueStored({ ...row, expires_at: expiry, deck_runtime_snapshot_id: snapshot.deck_runtime_snapshot_id });
        await repo.passed(preflightId, snapshot, this.authority.tokenHash(token), expiry, now);
        return workflowPreflightExecutionOutputDto.parse({ request_state: "committed", preflight: projectPreflightExecutionRow(await repo.read(preflightId), token) });
      });
    } catch (error) {
      const code = error instanceof WorkflowPreflightCheckError ? error.code : checkErrors[currentCheck];
      // Original result lookup happens inside the same advisory-locked receipt boundary:
      // an uncertain successful final commit is recovered before any failure mutation.
      return this.finish(context, preflightId, async (_tx, repo) => {
        await repo.failed(preflightId, currentCheck, code, await repo.clock());
        return workflowPreflightExecutionOutputDto.parse({ request_state: "committed", preflight: projectPreflightExecutionRow(await repo.read(preflightId)) });
      });
    }
  }
}
