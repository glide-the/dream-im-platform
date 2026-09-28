// [Input] Admin-prepared trigger, configured service identity and short-lived signed bearer.
// [Output] Exact trigger/claim/owner/target-bound Chat persistence actor after live database checks.
// [Pos] Scheduled worker authority boundary; this token is not OAuth or a general runtime delegation.
// [Sync] 2026-09-28: sign only one target Thread and recheck current identity, source, Deck and trigger state on every use.
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { chat_scheduled_task as task, chat_scheduled_trigger as trigger, decks, voices } from "@ink-memory/db/schema/dream";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { SubjectRepository } from "../auth/subjectRepository";
import type { DataTransaction } from "./database";
import { ChatThreadRepository } from "./chatThreadRepository";

const payloadDto = z.strictObject({
  version: z.literal(1), trigger_id: z.string().uuid(), claim_id: z.string().uuid(),
  service_client_id: z.string().min(1), auth_user_id: z.string().min(1),
  user_id: z.string().regex(/^[1-9]\d*$/), source_thread_id: z.string().min(1),
  target_thread_id: z.string().min(1), purpose: z.literal("scheduled-chat-persistence"),
  issued_at: z.number().int().positive().safe(), expires_at: z.number().int().positive().safe(),
});
type Payload = z.infer<typeof payloadDto>;
const allowedOperations = new Set(["chat-user-message.persist", "chat-message.persist", "chat-thread.get", "chat-thread.update-session", "runtime-delegation.create", "scheduled-trigger.authority.resolve"]);
function secret() {
  const value = requiredAuthValue("AUTH_CHAT_SCHEDULE_AUTHORITY_SECRET");
  if (Buffer.byteLength(value) < 32) throw new AuthBoundaryError("SCHEDULE_AUTHORITY_NOT_CONFIGURED");
  return value;
}
function signature(encoded: string) { return createHmac("sha256", secret()).update(encoded).digest("base64url"); }
export function issueScheduledChatAuthority(input: Omit<Payload, "version" | "purpose">) {
  const payload = payloadDto.parse({ ...input, version: 1, purpose: "scheduled-chat-persistence" });
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `sta_${encoded}.${signature(encoded)}`;
}
export async function resolveScheduledChatClaim(tx: DataTransaction, binding: {
  triggerId: string; claimId: string; serviceId: string; authUserId: string;
  userId: string; targetThreadId: string; maximumExpiresAt: Date;
}) {
  const row = (await tx.select({ trigger, task }).from(trigger).innerJoin(task, eq(trigger.task_id, task.id))
    .where(and(eq(trigger.id, binding.triggerId), eq(trigger.claim_id, binding.claimId),
      eq(task.service_client_id, binding.serviceId))).limit(1))[0];
  if (!row || !["queued", "running"].includes(row.trigger.status) || row.trigger.target_thread_id !== binding.targetThreadId
    || String(row.trigger.user_id) !== binding.userId || String(row.task.user_id) !== binding.userId
    || row.task.auth_user_id !== binding.authUserId || row.trigger.source_thread_id !== row.task.source_thread_id
    || !row.trigger.lease_expires_at || new Date(row.trigger.lease_expires_at) < binding.maximumExpiresAt
    || new Date(row.trigger.lease_expires_at).getTime() <= Date.now()) throw new AuthBoundaryError("SCHEDULE_AUTHORITY_ENTITY_DENIED", 403);
  const identity = await new SubjectRepository(tx).findActive(binding.authUserId);
  if (!identity || String(identity.canonicalUserId) !== binding.userId) throw new AuthBoundaryError("ACTIVE_SUBJECT_REQUIRED", 403);
  const threads = new ChatThreadRepository(tx, binding.userId);
  await threads.requireOwned(row.trigger.source_thread_id);
  await threads.requireOwned(binding.targetThreadId);
  const target = await threads.get(binding.targetThreadId);
  if (!target) throw new AuthBoundaryError("CHAT_THREAD_NOT_FOUND", 404);
  if (target.deck_id !== null) {
    const deck = (await tx.select({ enabled: decks.enabled }).from(decks).where(and(eq(decks.id, target.deck_id), eq(decks.owner_id, row.task.user_id))).limit(1))[0];
    if (!deck?.enabled) throw new AuthBoundaryError("DECK_ACCESS_DENIED", 403);
    if (target.voice_id !== null) {
      const voice = (await tx.select({ enabled: voices.enabled }).from(voices).where(and(eq(voices.id, target.voice_id), eq(voices.deck_id, target.deck_id))).limit(1))[0];
      if (!voice?.enabled) throw new AuthBoundaryError("AGENT_ACCESS_DENIED", 403);
    }
  }
  return { principal: { subject: binding.authUserId, canonical_user_id: binding.userId,
    client_id: `scheduled-chat:${binding.serviceId}`, scopes: ["dream:read", "dream:write"], status: "active" as const },
    threadScope: binding.targetThreadId, sourceThreadScope: row.trigger.source_thread_id, runScope: null,
    triggerId: binding.triggerId, claimId: binding.claimId, maximumExpiresAt: binding.maximumExpiresAt };
}
export async function resolveScheduledChatAuthority(tx: DataTransaction, token: string, operation: string, serviceId: string) {
  if (!allowedOperations.has(operation)) throw new AuthBoundaryError("SCHEDULE_AUTHORITY_OPERATION_DENIED", 403);
  const match = /^sta_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!match || match[1].length > 2_048) throw new AuthBoundaryError("SCHEDULE_AUTHORITY_REQUIRED", 401);
  const expected = Buffer.from(signature(match[1]));
  const actual = Buffer.from(match[2]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new AuthBoundaryError("SCHEDULE_AUTHORITY_REQUIRED", 401);
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); } catch { throw new AuthBoundaryError("SCHEDULE_AUTHORITY_REQUIRED", 401); }
  const parsed = payloadDto.safeParse(decoded);
  if (!parsed.success || parsed.data.service_client_id !== serviceId || parsed.data.expires_at <= Date.now()
    || parsed.data.issued_at > Date.now() || parsed.data.expires_at <= parsed.data.issued_at) throw new AuthBoundaryError("SCHEDULE_AUTHORITY_REQUIRED", 401);
  const binding = parsed.data;
  const source = await resolveScheduledChatClaim(tx, { triggerId: binding.trigger_id, claimId: binding.claim_id,
    serviceId, authUserId: binding.auth_user_id, userId: binding.user_id,
    targetThreadId: binding.target_thread_id, maximumExpiresAt: new Date(binding.expires_at) });
  if (binding.source_thread_id !== (await tx.select({ source: trigger.source_thread_id }).from(trigger)
    .where(eq(trigger.id, binding.trigger_id)).limit(1))[0]?.source) throw new AuthBoundaryError("SCHEDULE_AUTHORITY_ENTITY_DENIED", 403);
  return { ...source, issuedAt: new Date(binding.issued_at) };
}
