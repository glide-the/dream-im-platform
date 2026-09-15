// [Input] Task-bound service authority, child Thread binding and encrypted server-side token storage.
// [Output] Short-lived Reflections worker bearer with exact operation allowlist, renewal and revocation.
// [Pos] Registered child persistence authority; separate from frozen runtime_delegations semantics.
// [Sync] 2026-09-15: expose only six exact existing operation names without a service bypass.
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { decryptAuthBundle, encryptAuthBundle } from "../auth/tokenEncryption";
import { SubjectRepository } from "../auth/subjectRepository";
import { canonicalContractJson } from "./operationRegistry";
import type { DataTransaction } from "./database";
import { ReflectionTaskAuthorityRepository } from "./reflectionTaskAuthorityRepository";
import type { ReflectionSectionStorageRow, ReflectionTaskStorageRow } from "./reflectionTaskRepository";
import { reflectionAuthorityDto, reflectionAuthorityTokenDto } from "./reflectionTaskDto";

export const reflectionTaskAuthorityOperationScopes = Object.freeze({
  "chat-user-message.persist": "dream:write",
  "chat-message.persist": "dream:write",
  "chat-thread.get": "dream:read",
  "chat-thread.update-session": "dream:write",
  "thread-system-config.get": "dream:read",
  "session.list": "dream:read",
} as const);
export type ReflectionTaskAuthorityOperation = keyof typeof reflectionTaskAuthorityOperationScopes;
export function requireReflectionTaskAuthorityOperation(name: string): ReflectionTaskAuthorityOperation {
  if (!Object.hasOwn(reflectionTaskAuthorityOperationScopes, name)) throw new AuthBoundaryError("REFLECTION_AUTHORITY_OPERATION_DENIED", 403);
  return name as ReflectionTaskAuthorityOperation;
}
export function reflectionAuthorityHash(token: string) { return createHash("sha256").update(token).digest("hex"); }
function authorityPolicy() {
  const ttl = Number(requiredAuthValue("AUTH_REFLECTIONS_AUTHORITY_TTL_SECONDS")), maximumTtl = Number(requiredAuthValue("AUTH_REFLECTIONS_AUTHORITY_MAX_TTL_SECONDS"));
  if (![ttl, maximumTtl].every(value => Number.isSafeInteger(value) && value > 0) || ttl > maximumTtl || !Number.isFinite(Date.now() + maximumTtl * 1_000)) throw new AuthBoundaryError("REFLECTION_AUTHORITY_POLICY_INVALID");
  return { ttl, maximumTtl };
}
type AuthorityOutput = z.infer<typeof reflectionAuthorityDto>;
type AuthorityRow = NonNullable<Awaited<ReturnType<ReflectionTaskAuthorityRepository["lockToken"]>>>;
function decode(row: AuthorityRow): AuthorityOutput {
  const parsed = reflectionAuthorityDto.safeParse(decryptAuthBundle(row.tokenCiphertext));
  if (!parsed.success || reflectionAuthorityHash(parsed.data.token) !== row.tokenHash || parsed.data.task_id !== row.taskId || parsed.data.section !== row.section || parsed.data.thread_id !== row.threadId || parsed.data.purpose !== row.purpose || canonicalContractJson(parsed.data.scopes) !== canonicalContractJson(row.scopes) || parsed.data.expires_at !== row.expiresAt.toISOString() || parsed.data.maximum_expires_at !== row.maximumExpiresAt.toISOString()) throw new AuthBoundaryError("REFLECTION_AUTHORITY_RECOVERY_INVALID");
  return parsed.data;
}
function validBinding(row: AuthorityRow, task: ReflectionTaskStorageRow, section: ReflectionSectionStorageRow, serviceId: string) {
  return row.serviceClientId === serviceId && row.taskId === task.id && row.section === section.section && row.threadId === section.threadId && row.authUserId === task.authUserId && row.canonicalUserId.toString() === task.userId && row.purpose === "reflections-worker" && canonicalContractJson(row.scopes) === canonicalContractJson(["dream:read", "dream:write"]);
}
function validRunningBinding(row: AuthorityRow, task: ReflectionTaskStorageRow, section: ReflectionSectionStorageRow, serviceId: string) {
  return task.status === "RUNNING" && section.status === "RUNNING" && validBinding(row, task, section, serviceId);
}
async function refreshWithinMaximum(store: ReflectionTaskAuthorityRepository, row: AuthorityRow, now: Date) {
  const current = decode(row), policy = authorityPolicy(), expiresAt = new Date(Math.min(row.maximumExpiresAt.getTime(), now.getTime() + policy.ttl * 1_000));
  if (expiresAt <= now) throw new AuthBoundaryError("REFLECTION_AUTHORITY_REQUIRED", 401);
  const renewed = reflectionAuthorityDto.parse({ ...current, expires_at: expiresAt.toISOString() });
  if (!await store.renew(row.tokenHash, expiresAt, encryptAuthBundle(renewed))) throw new AuthBoundaryError("REFLECTION_AUTHORITY_REQUIRED", 401);
  return renewed;
}

export async function issueReflectionTaskAuthority(tx: DataTransaction, task: ReflectionTaskStorageRow, section: ReflectionSectionStorageRow, serviceId: string, requestId: string) {
  if (!task.authUserId || !section.threadId || task.status !== "RUNNING" || section.status !== "RUNNING") throw new AuthBoundaryError("REFLECTION_AUTHORITY_BINDING_MISSING");
  const store = new ReflectionTaskAuthorityRepository(tx), prior = await store.lockLive(task.id, section.section), now = new Date();
  if (prior) {
    if (!validRunningBinding(prior, task, section, serviceId)) throw new AuthBoundaryError("REFLECTION_AUTHORITY_BINDING_CONFLICT", 409);
    if (prior.maximumExpiresAt <= now) { await store.revoke(prior.tokenHash); throw new AuthBoundaryError("REFLECTION_AUTHORITY_REQUIRED", 401); }
    return { tokenHash: prior.tokenHash, authority: prior.expiresAt > now ? decode(prior) : await refreshWithinMaximum(store, prior, now), created: false };
  }
  const policy = authorityPolicy(), token = `rta_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(now.getTime() + policy.ttl * 1_000), maximumExpiresAt = new Date(now.getTime() + policy.maximumTtl * 1_000);
  const authority = reflectionAuthorityDto.parse({ token, purpose: "reflections-worker", task_id: task.id, section: section.section, thread_id: section.threadId, scopes: ["dream:read", "dream:write"], expires_at: expiresAt.toISOString(), maximum_expires_at: maximumExpiresAt.toISOString() });
  const inputSha256 = reflectionAuthorityHash(canonicalContractJson({ service_client_id: serviceId, task_id: task.id, section: section.section, thread_id: section.threadId, auth_user_id: task.authUserId, canonical_user_id: task.userId }));
  await store.create({ tokenHash: reflectionAuthorityHash(token), serviceClientId: serviceId, taskId: task.id, section: section.section, threadId: section.threadId, authUserId: task.authUserId, canonicalUserId: BigInt(task.userId), purpose: "reflections-worker", scopes: ["dream:read", "dream:write"], requestId, inputSha256, tokenCiphertext: encryptAuthBundle(authority), expiresAt, maximumExpiresAt });
  return { tokenHash: reflectionAuthorityHash(token), authority, created: true };
}

export async function recoverReflectionTaskAuthority(tx: DataTransaction, tokenHash: string, task: ReflectionTaskStorageRow, section: ReflectionSectionStorageRow, serviceId: string) {
  const store = new ReflectionTaskAuthorityRepository(tx), row = await store.lockToken(tokenHash), now = new Date();
  if (!row || !validRunningBinding(row, task, section, serviceId) || row.revokedAt || row.maximumExpiresAt <= now) throw new AuthBoundaryError("REFLECTION_AUTHORITY_REQUIRED", 401);
  return row.expiresAt > now ? decode(row) : refreshWithinMaximum(store, row, now);
}

export async function renewReflectionTaskAuthority(tx: DataTransaction, task: ReflectionTaskStorageRow, section: ReflectionSectionStorageRow, serviceId: string) {
  const store = new ReflectionTaskAuthorityRepository(tx), row = await store.lockLive(task.id, section.section), now = new Date();
  if (!row || !validRunningBinding(row, task, section, serviceId) || row.revokedAt || row.maximumExpiresAt <= now) throw new AuthBoundaryError("REFLECTION_AUTHORITY_REQUIRED", 401);
  const renewed = await refreshWithinMaximum(store, row, now);
  return reflectionAuthorityDto.omit({ token: true }).parse(renewed);
}

export async function revokeReflectionTaskAuthority(tx: DataTransaction, taskId: string, section: string) {
  const store = new ReflectionTaskAuthorityRepository(tx), row = await store.lockLive(taskId, section);
  if (row) await store.revoke(row.tokenHash);
}
export async function revokeReflectionTaskAuthorities(tx: DataTransaction, taskId: string) { await new ReflectionTaskAuthorityRepository(tx).revokeTask(taskId); }

export async function resolveReflectionTaskAuthority(tx: DataTransaction, token: string, operation: string, serviceId?: string) {
  reflectionAuthorityTokenDto.parse(token); const name = requireReflectionTaskAuthorityOperation(operation), scope = reflectionTaskAuthorityOperationScopes[name];
  const store = new ReflectionTaskAuthorityRepository(tx), row = await store.lockToken(reflectionAuthorityHash(token)), now = new Date();
  if (!row || row.revokedAt || row.expiresAt <= now || row.maximumExpiresAt <= now || (serviceId !== undefined && row.serviceClientId !== serviceId)) throw new AuthBoundaryError("REFLECTION_AUTHORITY_REQUIRED", 401);
  const authority = decode(row);
  if (!row.scopes.includes(scope) || !await store.verifyAggregate(row)) throw new AuthBoundaryError("REFLECTION_AUTHORITY_ENTITY_DENIED", 403);
  const identity = await new SubjectRepository(tx).findActive(row.authUserId);
  if (!identity || identity.canonicalUserId !== row.canonicalUserId) throw new AuthBoundaryError("ACTIVE_SUBJECT_REQUIRED", 403);
  return {
    principal: { subject: row.authUserId, canonical_user_id: row.canonicalUserId.toString(), client_id: `reflections-worker:${row.serviceClientId}`, scopes: [...row.scopes], status: "active" as const },
    serviceClientId: row.serviceClientId, threadScope: row.threadId, editorSessionScope: null, runScope: null,
    purpose: "reflections-worker" as const, taskId: row.taskId, section: row.section, tokenHash: row.tokenHash, authority,
  };
}
