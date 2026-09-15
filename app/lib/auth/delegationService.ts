// [Input] Admin OAuth user grant or exact Admin-owned confirmation claim; capability-gated data UOW.
// [Output] Encrypted-recoverable creation and claim-fenced renewal/revocation/actor projection.
// [Pos] Admin sole long-turn authority; no external actor IDs or Runtime service secrets.
// [Sync] 2026-09-16: issue server-persistence grants from exact live Story confirmation claims.
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { AuthBoundaryError, dreamServiceClients, requiredAuthValue, type DreamServiceClient } from "./config";
import { delegationCreateInputDto, delegationOutputDto, delegationRenewOutputDto, delegationRevokeOutputDto, delegationTokenDto, validDelegationPurpose, delegationReceiptOperationDto, delegationReceiptOutputDto } from "./delegationDto";
import { DelegationRepository } from "./delegationRepository";
import { principalForAccessToken } from "./browserSessionService";
import { SubjectRepository } from "./subjectRepository";
import { encryptAuthBundle, decryptAuthBundle } from "./tokenEncryption";
import { canonicalContractJson } from "../dream/canonicalContractJson";
import { ReceiptRepository } from "../dream/receipts";
import type { DataTransaction } from "../dream/database";
import { requestIdDto, type PrincipalDto } from "./dto";
import { gatewayClientForService } from "./gatewayBindings";
import { authoritativeWorkflowContext } from "../dream/workflowContextService";
import { storyWorkspaceConfirmationClaimIdDto, storyWorkspaceConfirmationMessageIdDto,
  storyWorkspaceConfirmationMetadataDto } from "../dream/storyWorkspaceConfirmationDto";
import { workflowRunIdDto } from "../dream/workflowRunDto";

const confirmationGrantBindingDto = z.strictObject({
  messageId: storyWorkspaceConfirmationMessageIdDto,
  claimId: storyWorkspaceConfirmationClaimIdDto,
  actorId: z.string().regex(/^[1-9][0-9]*$/),
  threadId: z.string().min(1).max(255),
  runId: workflowRunIdDto,
});
export type ConfirmationGrantBinding = z.infer<typeof confirmationGrantBindingDto>;

export const delegationHash = (token: string) => createHash("sha256").update(token).digest("hex");
function delegationPolicy() {
  const ttl = Number(requiredAuthValue("AUTH_RUNTIME_DELEGATION_TTL_SECONDS"));
  const maximumTtl = Number(requiredAuthValue("AUTH_RUNTIME_DELEGATION_MAX_TTL_SECONDS"));
  if (![ttl, maximumTtl].every(value => Number.isSafeInteger(value) && value > 0) || ttl > maximumTtl || !Number.isFinite(new Date(Date.now() + maximumTtl * 1_000).getTime())) throw new AuthBoundaryError("RUNTIME_DELEGATION_POLICY_INVALID");
  return { ttl, maximumTtl };
}
export type DelegatedPrincipal = { principal: PrincipalDto; serviceClientId: string; threadId: string; runId: string | null; purpose: z.infer<typeof delegationOutputDto>["purpose"]; editorSessionId: string | null; tokenHash: string; gatewayApiKeyId: string | null };
export class DelegationService {
  private readonly repository: DelegationRepository;
  constructor(private readonly tx: DataTransaction) { this.repository = new DelegationRepository(tx); }
  async create(service: DreamServiceClient, headers: Headers, requestId: string, input: z.infer<typeof delegationCreateInputDto>) {
    delegationCreateInputDto.parse(input);
    if (!validDelegationPurpose({ purpose: input.purpose, scopes: input.scopes, editorSessionId: input.editor_session_id })) throw new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403);
    const principal = await principalForAccessToken(this.tx, headers.get("authorization")?.replace(/^Bearer /, "") ?? "", "dream:write");
    if (principal.client_id !== service.oauthClientId && principal.client_id !== requiredAuthValue("AUTH_DEVICE_CLIENT_ID")) throw new AuthBoundaryError("DELEGATION_CLIENT_DENIED", 403);
    if (input.scopes.some(scope => !principal.scopes.includes(scope))) throw new AuthBoundaryError("ACCESS_SCOPE_REQUIRED", 403);
    if (!await this.repository.ownsEntities(principal.canonical_user_id, input.thread_id, input.run_id)) throw new AuthBoundaryError("ENTITY_NOT_FOUND", 404);
    if (input.editor_session_id !== null && !await this.repository.ownsEditorSession(principal.canonical_user_id, input.editor_session_id)) throw new AuthBoundaryError("ENTITY_NOT_FOUND", 404);
    const hash = delegationHash(canonicalContractJson(input));
    const key = delegationHash(canonicalContractJson([service.id, principal.subject, requestId]));
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
    const prior = await this.repository.findCreation(service.id, principal.subject, requestId);
    if (prior) {
      if (prior.inputSha256 !== hash) throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
      if (prior.revokedAt || prior.expiresAt <= new Date() || !prior.tokenCiphertext) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
      const original = delegationOutputDto.parse(decryptAuthBundle(prior.tokenCiphertext));
      if (delegationHash(original.token) !== prior.tokenHash || original.purpose !== prior.purpose || original.thread_id !== prior.threadId || original.run_id !== prior.runId || original.editor_session_id !== prior.editorSessionId || canonicalContractJson(original.scopes) !== canonicalContractJson(prior.scopes) || original.maximum_expires_at !== prior.maximumExpiresAt?.toISOString()) throw new AuthBoundaryError("DELEGATION_RECOVERY_INVALID");
      await this.resolve(original.token, null, service.id, input.thread_id, input.run_id, input.editor_session_id);
      return original;
    }
    const workflowContext = await authoritativeWorkflowContext(this.tx, principal.canonical_user_id, input.thread_id);
    if ((workflowContext?.workflow_run_id ?? null) !== input.run_id) throw new AuthBoundaryError("DELEGATION_WORKFLOW_CONTEXT_DENIED", 403);
    const gatewayScopes = input.scopes.filter(scope => ["messages:create", "messages:count_tokens", "models:list"].includes(scope));
    let gatewayApiKeyId: string | null = null;
    if (gatewayScopes.length) {
      const binding = gatewayClientForService(service.id);
      if (!binding.oauth_client_ids.includes(principal.client_id)) throw new AuthBoundaryError("DELEGATION_CLIENT_DENIED", 403);
      const key = await this.repository.gatewayKeyForClient(binding.gateway_client_id);
      if (!key || gatewayScopes.some(scope => !key.scopes.includes(scope))) throw new AuthBoundaryError("GATEWAY_SCOPE_REQUIRED", 403);
      gatewayApiKeyId = key.id;
    }
    const policy = delegationPolicy(); const now = Date.now();
    const token = `idg_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(now + policy.ttl * 1_000), maximumExpiresAt = new Date(now + policy.maximumTtl * 1_000);
    const result = delegationOutputDto.parse({ token, expires_at: expiresAt.toISOString(), maximum_expires_at: maximumExpiresAt.toISOString(), purpose: input.purpose, thread_id: input.thread_id, run_id: input.run_id, editor_session_id: input.editor_session_id, scopes: input.scopes });
    await this.repository.create({ tokenHash: delegationHash(token), serviceClientId: service.id, authUserId: principal.subject, oauthClientId: principal.client_id, canonicalUserId: BigInt(principal.canonical_user_id), threadId: input.thread_id, runId: input.run_id, purpose: input.purpose, editorSessionId: input.editor_session_id, scopes: input.scopes, gatewayApiKeyId, requestId, inputSha256: hash, tokenCiphertext: encryptAuthBundle(result), expiresAt, maximumExpiresAt });
    await this.repository.auditCreation(service.id, requestId, hash, delegationHash(token));
    return result;
  }

  async createForConfirmationClaim(
    service: { id: string; oauthClientId: string; backgroundScopes: readonly string[] },
    rawBinding: ConfirmationGrantBinding,
  ) {
    const binding = confirmationGrantBindingDto.parse(rawBinding);
    if (!service.backgroundScopes.includes("story-confirmation:dispatch")) {
      throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
    }
    const source = await this.repository.confirmationClaimSource(
      binding.messageId, binding.actorId, binding.threadId,
    );
    if (!this.validConfirmationSource(source, binding)) {
      throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
    }
    const identity = await new SubjectRepository(this.tx).findActiveByCanonicalUserId(binding.actorId);
    if (!identity || !await this.repository.ownsEntities(binding.actorId, binding.threadId, binding.runId)) {
      throw new AuthBoundaryError("ACTIVE_SUBJECT_REQUIRED", 403);
    }
    const requestId = `confirmation-claim_${delegationHash(canonicalContractJson([
      service.id, binding.messageId, binding.claimId,
    ]))}`;
    const inputSha256 = delegationHash(canonicalContractJson({
      authority_source: "story-confirmation-claim",
      service_client_id: service.id,
      auth_user_id: identity.authUserId,
      canonical_user_id: binding.actorId,
      thread_id: binding.threadId,
      run_id: binding.runId,
      source_message_id: binding.messageId,
      source_claim_id: binding.claimId,
      purpose: "server-persistence",
      scopes: ["dream:read", "dream:write"],
    }));
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${requestId}, 0))`);
    const prior = await this.repository.findConfirmationClaimCreation(
      service.id, binding.messageId, binding.claimId,
    );
    if (prior) {
      if (prior.authUserId !== identity.authUserId
        || prior.canonicalUserId.toString() !== binding.actorId
        || prior.oauthClientId !== service.oauthClientId
        || prior.requestId !== requestId
        || prior.inputSha256 !== inputSha256
        || prior.authoritySource !== "story-confirmation-claim"
        || prior.sourceMessageId !== binding.messageId
        || prior.sourceClaimId !== binding.claimId
        || prior.threadId !== binding.threadId
        || prior.runId !== binding.runId
        || prior.purpose !== "server-persistence"
        || prior.editorSessionId !== null
        || prior.gatewayApiKeyId !== null
        || canonicalContractJson(prior.scopes) !== canonicalContractJson(["dream:read", "dream:write"])
        || prior.revokedAt || prior.expiresAt <= new Date() || !prior.tokenCiphertext) {
        throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
      }
      const recovered = delegationOutputDto.parse(decryptAuthBundle(prior.tokenCiphertext));
      if (delegationHash(recovered.token) !== prior.tokenHash
        || recovered.thread_id !== binding.threadId || recovered.run_id !== binding.runId
        || recovered.purpose !== "server-persistence" || recovered.editor_session_id !== null
        || canonicalContractJson(recovered.scopes) !== canonicalContractJson(["dream:read", "dream:write"])
        || recovered.expires_at !== prior.expiresAt.toISOString()
        || recovered.maximum_expires_at !== prior.maximumExpiresAt?.toISOString()) {
        throw new AuthBoundaryError("DELEGATION_RECOVERY_INVALID");
      }
      await this.resolve(recovered.token, null, service.id, binding.threadId, binding.runId, null);
      return recovered;
    }
    const policy = delegationPolicy(); const now = Date.now();
    const token = `idg_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(now + policy.ttl * 1_000);
    const maximumExpiresAt = new Date(now + policy.maximumTtl * 1_000);
    const result = delegationOutputDto.parse({
      token, expires_at: expiresAt.toISOString(), maximum_expires_at: maximumExpiresAt.toISOString(),
      purpose: "server-persistence", thread_id: binding.threadId, run_id: binding.runId,
      editor_session_id: null, scopes: ["dream:read", "dream:write"],
    });
    await this.repository.create({
      tokenHash: delegationHash(token), serviceClientId: service.id,
      authUserId: identity.authUserId, oauthClientId: service.oauthClientId,
      canonicalUserId: BigInt(binding.actorId), threadId: binding.threadId, runId: binding.runId,
      purpose: "server-persistence", editorSessionId: null, scopes: ["dream:read", "dream:write"],
      gatewayApiKeyId: null, requestId, inputSha256, tokenCiphertext: encryptAuthBundle(result),
      authoritySource: "story-confirmation-claim", sourceMessageId: binding.messageId,
      sourceClaimId: binding.claimId, expiresAt, maximumExpiresAt,
    });
    await this.repository.auditCreation(service.id, requestId, inputSha256, delegationHash(token));
    return result;
  }

  private validConfirmationSource(
    source: Awaited<ReturnType<DelegationRepository["confirmationClaimSource"]>>,
    binding: ConfirmationGrantBinding,
  ) {
    if (!source || source.role !== "user" || source.metadataJson === null
      || source.id !== binding.messageId || source.actorId !== binding.actorId
      || !Number.isFinite(source.nowSeconds)) return false;
    try {
      const metadata = storyWorkspaceConfirmationMetadataDto.parse(JSON.parse(source.metadataJson));
      return metadata.actor === binding.actorId
        && metadata.thread_id === binding.threadId
        && metadata.story_workspace_run_id === binding.runId
        && metadata.dispatch_status === "dispatching"
        && metadata.dispatch_claim_id === binding.claimId
        && typeof metadata.dispatch_claim_lease_until === "number"
        && metadata.dispatch_claim_lease_until > source.nowSeconds;
    } catch { return false; }
  }

  private async requireActiveConfirmationSource(row: NonNullable<Awaited<ReturnType<DelegationRepository["lock"]>>>) {
    const emptySource = row.authoritySource == null
      && row.sourceMessageId == null && row.sourceClaimId == null;
    if (emptySource) return;
    if (row.authoritySource !== "story-confirmation-claim"
      || !row.sourceMessageId || !row.sourceClaimId || !row.runId
      || row.purpose !== "server-persistence" || row.editorSessionId !== null
      || row.gatewayApiKeyId !== null) {
      throw new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403);
    }
    const source = await this.repository.confirmationClaimSource(
      row.sourceMessageId, row.canonicalUserId.toString(), row.threadId,
    );
    if (!this.validConfirmationSource(source, {
      messageId: row.sourceMessageId, claimId: row.sourceClaimId,
      actorId: row.canonicalUserId.toString(), threadId: row.threadId, runId: row.runId,
    })) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
  }

  async resolve(token: string, requiredScope: string | null, serviceId?: string, threadId?: string, runId?: string | null, editorSessionId?: string | null): Promise<DelegatedPrincipal> {
    if (!delegationTokenDto.safeParse(token).success) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
    const row = await this.repository.lock(delegationHash(token));
    if (!row || row.revokedAt || row.expiresAt <= new Date() || !row.oauthClientId || !row.maximumExpiresAt || !row.tokenCiphertext || !row.requestId || !row.inputSha256 || !/^[0-9a-f]{64}$/.test(row.inputSha256) || !dreamServiceClients().some(client => client.id === row.serviceClientId)) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
    if (!validDelegationPurpose(row)) throw new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403);
    await this.requireActiveConfirmationSource(row);
    if ((serviceId && row.serviceClientId !== serviceId) || (threadId !== undefined && row.threadId !== threadId) || (runId !== undefined && row.runId !== runId) || (editorSessionId !== undefined && row.editorSessionId !== editorSessionId)) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
    if (requiredScope && !row.scopes.includes(requiredScope)) throw new AuthBoundaryError("ACCESS_SCOPE_REQUIRED", 403);
    const identity = await new SubjectRepository(this.tx).findActive(row.authUserId);
    if (!identity || identity.canonicalUserId !== row.canonicalUserId) throw new AuthBoundaryError("ACTIVE_SUBJECT_REQUIRED", 403);
    if (!await this.repository.ownsEntities(row.canonicalUserId.toString(), row.threadId, row.runId)) throw new AuthBoundaryError("ENTITY_NOT_FOUND", 404);
    if (row.editorSessionId !== null && !await this.repository.ownsEditorSession(row.canonicalUserId.toString(), row.editorSessionId)) throw new AuthBoundaryError("ENTITY_NOT_FOUND", 404);
    if (row.gatewayApiKeyId) {
      const gateway = await this.repository.gatewayKeyById(row.gatewayApiKeyId);
      if (!gateway || gateway.clientId !== gatewayClientForService(row.serviceClientId).gateway_client_id || row.scopes.filter(scope => ["messages:create", "messages:count_tokens", "models:list"].includes(scope)).some(scope => !gateway.scopes.includes(scope))) throw new AuthBoundaryError("GATEWAY_SCOPE_REQUIRED", 403);
    }
    return { principal: { subject: row.authUserId, canonical_user_id: row.canonicalUserId.toString(), client_id: row.oauthClientId, scopes: row.scopes, status: "active" }, serviceClientId: row.serviceClientId, threadId: row.threadId, runId: row.runId, purpose: row.purpose as DelegatedPrincipal["purpose"], editorSessionId: row.editorSessionId, tokenHash: row.tokenHash, gatewayApiKeyId: row.gatewayApiKeyId };
  }
  async renew(token: string, requestId: string) {
    const original = await this.receipt(token, "runtime-delegation.renew", requestId);
    if (original.status === "committed") return delegationRenewOutputDto.parse(original.result);
    const actor = await this.resolve(token, null);
    const row = await this.repository.lock(actor.tokenHash);
    if (!row?.maximumExpiresAt) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
    const policy = delegationPolicy();
    return new ReceiptRepository(this.tx, row.serviceClientId, actor.principal.subject).execute("runtime-delegation.renew", requestId, { token_sha256: actor.tokenHash }, delegationRenewOutputDto, async () => {
      const expiresAt = new Date(Math.min(row.maximumExpiresAt!.getTime(), Date.now() + policy.ttl * 1_000));
      if (expiresAt <= new Date()) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
      await this.repository.renew(actor.tokenHash, expiresAt);
      return delegationRenewOutputDto.parse({ expires_at: expiresAt.toISOString(), maximum_expires_at: row.maximumExpiresAt!.toISOString(), purpose: actor.purpose, thread_id: row.threadId, run_id: row.runId, editor_session_id: row.editorSessionId, scopes: row.scopes });
    }, row.threadId, row.editorSessionId);
  }
  async receipt(token: string, operation: z.infer<typeof delegationReceiptOperationDto>, requestId: string) {
    delegationReceiptOperationDto.parse(operation); requestIdDto.parse(requestId);
    if (!delegationTokenDto.safeParse(token).success) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
    const row = await this.repository.lock(delegationHash(token));
    if (!row || !row.requestId || !row.oauthClientId || !row.maximumExpiresAt || !row.tokenCiphertext || !row.inputSha256 || !/^[0-9a-f]{64}$/.test(row.inputSha256) || !validDelegationPurpose(row) || !dreamServiceClients().some(client => client.id === row.serviceClientId)) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
    if (operation === "runtime-delegation.renew") {
      const identity = await new SubjectRepository(this.tx).findActive(row.authUserId);
      if (!identity || identity.canonicalUserId !== row.canonicalUserId) throw new AuthBoundaryError("ACTIVE_SUBJECT_REQUIRED", 403);
      if (!await this.repository.ownsEntities(row.canonicalUserId.toString(), row.threadId, row.runId) || (row.editorSessionId !== null && !await this.repository.ownsEditorSession(row.canonicalUserId.toString(), row.editorSessionId))) throw new AuthBoundaryError("ENTITY_NOT_FOUND", 404);
    }
    const stored = await new ReceiptRepository(this.tx, row.serviceClientId, row.authUserId).find(operation, requestId);
    if (stored && (stored.inputSha256 !== delegationHash(canonicalContractJson({ token_sha256: row.tokenHash })) || stored.threadScope !== row.threadId || stored.editorSessionScope !== row.editorSessionId)) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
    if (stored && operation === "runtime-delegation.renew") {
      const original = delegationRenewOutputDto.parse(stored.result);
      if (original.purpose !== row.purpose || original.thread_id !== row.threadId || original.run_id !== row.runId || original.editor_session_id !== row.editorSessionId || original.maximum_expires_at !== row.maximumExpiresAt.toISOString() || canonicalContractJson(original.scopes) !== canonicalContractJson(row.scopes) || new Date(original.expires_at) > row.maximumExpiresAt) throw new AuthBoundaryError("DELEGATION_RECOVERY_INVALID");
    }
    // An expired/revoked bearer can read only its original bounded action result.
    // This does not resolve a principal, update expiry or enable a new action.
    return delegationReceiptOutputDto(operation).parse({ status: stored ? "committed" : "absent", operation, request_id: requestId, ...(stored ? { result: stored.result } : {}) });
  }
  async revoke(token: string, requestId: string) {
    if (!delegationTokenDto.safeParse(token).success) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
    const row = await this.repository.lock(delegationHash(token));
    if (!row) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
    return new ReceiptRepository(this.tx, row.serviceClientId, row.authUserId).execute("runtime-delegation.revoke", requestId, { token_sha256: row.tokenHash }, delegationRevokeOutputDto, async () => {
      await this.repository.revoke(row.tokenHash); return { revoked: true as const };
    }, row.threadId, row.editorSessionId);
  }
}
