// [Input] Data ORM transaction and server-derived identity/client/entity bindings.
// [Output] Locked delegation/creation lookup, exact owned entity and active Gateway key checks.
// [Pos] Admin persistence repository; legacy unbound rows fail closed at the service boundary.
// [Sync] 2026-09-14: validate exact Editor Session ownership and append secret-free creation audit.
import { randomUUID } from "node:crypto";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { runtimeDelegations } from "@ink-memory/db/schema/auth";
import { adminAuditLogs, gatewayApiKeys, storyWorkspaceWorkspaces } from "@ink-memory/db/schema";
import { chat_thread, user_sessions, workflow_runs } from "@ink-memory/db/schema/dream";
import type { DataTransaction } from "../dream/database";
export class DelegationRepository {
  constructor(private readonly tx: DataTransaction) {}
  async findCreation(serviceId: string, authUserId: string, requestId: string) {
    const rows = await this.tx.select().from(runtimeDelegations).where(and(eq(runtimeDelegations.serviceClientId, serviceId), eq(runtimeDelegations.authUserId, authUserId), eq(runtimeDelegations.requestId, requestId))).limit(1);
    return rows[0] ?? null;
  }
  async lock(tokenHash: string) {
    const rows = await this.tx.select().from(runtimeDelegations).where(eq(runtimeDelegations.tokenHash, tokenHash)).for("update").limit(1);
    return rows[0] ?? null;
  }
  async ownsEntities(canonicalUserId: string, threadId: string, runId: string | null) {
    const threads = await this.tx.select({ id: chat_thread.id }).from(chat_thread).where(and(eq(chat_thread.id, threadId), eq(chat_thread.user_id, sql`${canonicalUserId}::bigint`))).for("share").limit(1);
    if (!threads[0]) return false;
    if (runId === null) return true;
    const runs = await this.tx.select({ id: workflow_runs.id }).from(workflow_runs).innerJoin(storyWorkspaceWorkspaces, eq(storyWorkspaceWorkspaces.id, workflow_runs.workspace_id)).where(and(eq(workflow_runs.id, runId), eq(workflow_runs.created_by, canonicalUserId), eq(workflow_runs.source_voice_thread_id, threadId), eq(storyWorkspaceWorkspaces.owner_id, sql`${canonicalUserId}::bigint`))).for("share").limit(1);
    return !!runs[0];
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
