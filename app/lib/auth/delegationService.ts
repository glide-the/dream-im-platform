// [Input] Admin OAuth user grant or existing opaque entity-bound delegation; capability-gated data UOW.
// [Output] Encrypted-recoverable creation and bounded renewal/revocation/validated actor projection.
// [Pos] Admin sole long-turn authority; no external actor IDs or Runtime service secrets.
// [Sync] 2026-09-14: enforce mutually exclusive purpose grants, exact Editor binding and audited actions.
import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { AuthBoundaryError, dreamServiceClients, requiredAuthValue, type DreamServiceClient } from "./config";
import { delegationCreateInputDto, delegationOutputDto, delegationRenewOutputDto, delegationRevokeOutputDto, delegationTokenDto, validDelegationPurpose, delegationReceiptOperationDto, delegationReceiptOutputDto } from "./delegationDto";
import { DelegationRepository } from "./delegationRepository";
import { principalForAccessToken } from "./browserSessionService";
import { SubjectRepository } from "./subjectRepository";
import { encryptAuthBundle, decryptAuthBundle } from "./tokenEncryption";
import { canonicalContractJson } from "../dream/operationRegistry";
import { ReceiptRepository } from "../dream/receipts";
import type { DataTransaction } from "../dream/database";
import { requestIdDto, type PrincipalDto } from "./dto";
import { gatewayClientForService } from "./gatewayBindings";
import { authoritativeWorkflowContext } from "../dream/workflowContextService";

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
  async resolve(token: string, requiredScope: string | null, serviceId?: string, threadId?: string, runId?: string | null, editorSessionId?: string | null): Promise<DelegatedPrincipal> {
    if (!delegationTokenDto.safeParse(token).success) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
    const row = await this.repository.lock(delegationHash(token));
    if (!row || row.revokedAt || row.expiresAt <= new Date() || !row.oauthClientId || !row.maximumExpiresAt || !row.tokenCiphertext || !row.requestId || !row.inputSha256 || !/^[0-9a-f]{64}$/.test(row.inputSha256) || !dreamServiceClients().some(client => client.id === row.serviceClientId)) throw new AuthBoundaryError("DELEGATION_REQUIRED", 401);
    if (!validDelegationPurpose(row)) throw new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403);
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
