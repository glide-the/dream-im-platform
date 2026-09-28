// [Input] Data ORM transaction and server-derived identity/client/entity bindings.
// [Sync] 2026-09-28: bind scheduled Chat grants in a separate source table while preserving pre-0070 grant reads.
// [Sync] 2026-09-27: resolve task-result claim grants without querying new columns on databases lacking the new capability.
// [Output] Locked delegation/creation lookup, exact owned entity, confirmation claim and active Gateway checks.
// [Pos] Admin persistence repository; legacy unbound rows fail closed at the service boundary.
// [Sync] 2026-09-16: persist and validate exact Story confirmation claim sources for Runtime grants.
import { randomUUID } from "node:crypto";
import { and, eq, getTableColumns, gt, isNull, or, sql } from "drizzle-orm";
import { runtimeDelegations, scheduledChatGrantSources } from "@ink-memory/db/schema/auth";
import { adminAuditLogs, gatewayApiKeys, storyWorkspaceWorkspaces } from "@ink-memory/db/schema";
import { chat_message, chat_task_result, chat_task_session, chat_thread, user_sessions, workflow_runs } from "@ink-memory/db/schema/dream";
import type { DataTransaction } from "../dream/database";
import { hasSchemaCapability } from "../dream/database";
import { chatTaskResultSchemaRequirement } from "../dream/chatThreadService";
const { sourceTaskResultId: _sourceTaskResultId, sourceTaskResultClaimId: _sourceTaskResultClaimId, ...legacyDelegationColumns } = getTableColumns(runtimeDelegations);
export class DelegationRepository {
  constructor(private readonly tx: DataTransaction) {}
  async findCreation(serviceId: string, authUserId: string, requestId: string) {
    const rows = await this.tx.select(legacyDelegationColumns).from(runtimeDelegations).where(and(eq(runtimeDelegations.serviceClientId, serviceId), eq(runtimeDelegations.authUserId, authUserId), eq(runtimeDelegations.requestId, requestId))).limit(1);
    return rows[0] ?? null;
  }
  async findConfirmationClaimCreation(serviceId: string, messageId: string, claimId: string) {
    const rows = await this.tx.select(legacyDelegationColumns).from(runtimeDelegations).where(and(
      eq(runtimeDelegations.serviceClientId, serviceId),
      eq(runtimeDelegations.authoritySource, "story-confirmation-claim"),
      eq(runtimeDelegations.sourceMessageId, messageId),
      eq(runtimeDelegations.sourceClaimId, claimId),
    )).limit(1);
    return rows[0] ?? null;
  }
  async lock(tokenHash: string) {
    const rows = await this.tx.select(legacyDelegationColumns).from(runtimeDelegations).where(eq(runtimeDelegations.tokenHash, tokenHash)).for("update").limit(1);
    if (!rows[0]) return null;
    if (!await hasSchemaCapability(this.tx, chatTaskResultSchemaRequirement)) return { ...rows[0], sourceTaskResultId: null, sourceTaskResultClaimId: null };
    const source = (await this.tx.select({ sourceTaskResultId: runtimeDelegations.sourceTaskResultId,
      sourceTaskResultClaimId: runtimeDelegations.sourceTaskResultClaimId }).from(runtimeDelegations)
      .where(eq(runtimeDelegations.tokenHash, tokenHash)).limit(1))[0];
    return { ...rows[0], sourceTaskResultId: source?.sourceTaskResultId ?? null,
      sourceTaskResultClaimId: source?.sourceTaskResultClaimId ?? null };
  }
  async findTaskResultClaimCreation(serviceId: string, notificationId: string, claimId: string, purpose: "server-persistence" | "gateway-cli") {
    return (await this.tx.select().from(runtimeDelegations).where(and(
      eq(runtimeDelegations.serviceClientId, serviceId), eq(runtimeDelegations.authoritySource, "task-result-claim"),
      eq(runtimeDelegations.sourceTaskResultId, notificationId), eq(runtimeDelegations.sourceTaskResultClaimId, claimId),
      eq(runtimeDelegations.purpose, purpose),
    )).limit(1))[0] ?? null;
  }
  async scheduledGrantSource(tokenHash: string) {
    return (await this.tx.select({ triggerId: scheduledChatGrantSources.triggerId, claimId: scheduledChatGrantSources.claimId })
      .from(scheduledChatGrantSources).where(eq(scheduledChatGrantSources.tokenHash, tokenHash)).limit(1))[0] ?? null;
  }
  async bindScheduledGrant(tokenHash: string, triggerId: string, claimId: string) {
    await this.tx.insert(scheduledChatGrantSources).values({ tokenHash, triggerId, claimId });
  }
  async taskResultClaimSource(notificationId: string, claimId: string, actorId: string, threadId: string) {
    return (await this.tx.select({ notificationId: chat_task_result.id, claimId: chat_task_result.claim_id,
      status: chat_task_result.status, actorId: sql<string>`${chat_task_session.user_id}::text`,
      sourceThreadId: chat_task_result.source_thread_id, threadId: chat_thread.id })
      .from(chat_task_result).innerJoin(chat_task_session, eq(chat_task_session.id, chat_task_result.task_id))
      .innerJoin(chat_thread, eq(chat_thread.id, chat_task_result.source_thread_id))
      .where(and(eq(chat_task_result.id, notificationId), eq(chat_task_result.claim_id, claimId),
        eq(chat_task_result.status, "dispatching"), eq(chat_task_result.source_thread_id, threadId),
        eq(chat_task_session.source_thread_id, threadId), eq(chat_task_session.user_id, sql`${actorId}::bigint`),
        eq(chat_thread.user_id, sql`${actorId}::bigint`))).limit(1))[0] ?? null;
  }
  async ownsEntities(canonicalUserId: string, threadId: string, runId: string | null) {
    const threads = await this.tx.select({ id: chat_thread.id }).from(chat_thread).where(and(eq(chat_thread.id, threadId), eq(chat_thread.user_id, sql`${canonicalUserId}::bigint`))).for("share").limit(1);
    if (!threads[0]) return false;
    if (runId === null) return true;
    const runs = await this.tx.select({ id: workflow_runs.id }).from(workflow_runs).innerJoin(storyWorkspaceWorkspaces, eq(storyWorkspaceWorkspaces.id, workflow_runs.workspace_id)).where(and(eq(workflow_runs.id, runId), eq(workflow_runs.created_by, canonicalUserId), eq(workflow_runs.source_voice_thread_id, threadId), eq(storyWorkspaceWorkspaces.owner_id, sql`${canonicalUserId}::bigint`))).for("share").limit(1);
    return !!runs[0];
  }
  async confirmationClaimSource(messageId: string, canonicalUserId: string, threadId: string) {
    const rows = await this.tx.select({
      id: chat_message.id,
      role: chat_message.role,
      metadataJson: chat_message.metadata,
      actorId: sql<string>`${chat_thread.user_id}::text`,
    }).from(chat_message).innerJoin(chat_thread, eq(chat_thread.id, chat_message.thread_id))
      .where(and(eq(chat_message.id, messageId), eq(chat_message.thread_id, threadId),
        eq(chat_thread.user_id, sql`${canonicalUserId}::bigint`)))
      .limit(1).for("share", { of: chat_message });
    if (!rows[0]) return null;
    const clock = await this.tx.execute(sql`SELECT extract(epoch FROM clock_timestamp())::double precision AS value`);
    return { ...rows[0], nowSeconds: Number(clock.rows[0]?.value) };
  }
  async gatewayKeyForClient(gatewayClientId: string) {
    const rows = await this.tx.select({ id: gatewayApiKeys.id, scopes: gatewayApiKeys.scopes }).from(gatewayApiKeys).where(and(eq(gatewayApiKeys.service_client_id, gatewayClientId), eq(gatewayApiKeys.subject_mode, "canonical_subject"), eq(gatewayApiKeys.status, "active"), isNull(gatewayApiKeys.revoked_at), or(isNull(gatewayApiKeys.expires_at), gt(gatewayApiKeys.expires_at, new Date())))).limit(1);
    return rows[0] ?? null;
  }
  async ownsEditorSession(canonicalUserId: string, editorSessionId: string) {
    const rows = await this.tx.select({ id: user_sessions.id }).from(user_sessions).where(and(eq(user_sessions.id, editorSessionId), eq(user_sessions.user_id, sql`${canonicalUserId}::bigint`))).for("share").limit(1);
    return !!rows[0];
  }
  async auditCreation(serviceId: string, requestId: string, inputHash: string, tokenHash: string) {
    await this.tx.insert(adminAuditLogs).values({ id: `audit_${randomUUID().replaceAll("-", "")}`, actor_type: "service", actor_id: serviceId, action: "dream.runtime-delegation.create", resource_type: "runtime_delegation", resource_id: tokenHash, request_id: requestId, metadata: { input_sha256: inputHash } });
  }
  async gatewayKeyById(id: string) {
    const rows = await this.tx.select({ id: gatewayApiKeys.id, scopes: gatewayApiKeys.scopes, clientId: gatewayApiKeys.service_client_id }).from(gatewayApiKeys).where(and(eq(gatewayApiKeys.id, id), eq(gatewayApiKeys.subject_mode, "canonical_subject"), eq(gatewayApiKeys.status, "active"), isNull(gatewayApiKeys.revoked_at), or(isNull(gatewayApiKeys.expires_at), gt(gatewayApiKeys.expires_at, new Date())))).limit(1);
    return rows[0] ?? null;
  }
  async create(input: typeof runtimeDelegations.$inferInsert) { await this.tx.insert(runtimeDelegations).values(input); }
  async renew(tokenHash: string, expiresAt: Date) { await this.tx.update(runtimeDelegations).set({ expiresAt }).where(eq(runtimeDelegations.tokenHash, tokenHash)); }
  async revoke(tokenHash: string) { await this.tx.update(runtimeDelegations).set({ revokedAt: new Date() }).where(and(eq(runtimeDelegations.tokenHash, tokenHash), isNull(runtimeDelegations.revokedAt))); }
}
