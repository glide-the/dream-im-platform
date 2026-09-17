// [Input] Verified canonical actor and closed entity selectors in the caller's Admin UOW.
// [Output] Typed Drizzle invitations/relations/picture projections with ordered transaction locks.
// [Pos] Admin social persistence only; no runtime, filesystem, independent transaction or generic CRUD.
// [Sync] 2026-09-15: serialize consumption/decisions and repair rejected same-direction reapplication without replacing IDs.
import { randomInt } from "node:crypto";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { friend_invites as invites, friendships as relations, daily_pictures as pictures } from "@ink-memory/db/schema/dream";
import { users } from "@ink-memory/db/schema";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import { pgTimestampToIso } from "./chatThreadDto";
import type { DataTransaction } from "./database";
import type { SocialFriendshipPolicy } from "./socialFriendshipDto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export function friendshipPairKey(first: string, second: string) {
  decimalIdDto.parse(first); decimalIdDto.parse(second);
  return BigInt(first) < BigInt(second) ? `dream.friendship:${first}:${second}` : `dream.friendship:${second}:${first}`;
}
export function generateFriendInviteCode(length: number) {
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}
const failure = (error: string) => ({ success: false as const, error });
const canonical = (id: string) => sql`${id}::bigint`;
export class SocialFriendshipRepository {
  constructor(private readonly tx: DataTransaction, private readonly actor: string) { decimalIdDto.parse(actor); }
  private pairPredicate(other: string) {
    return or(and(eq(relations.user_id, canonical(this.actor)), eq(relations.friend_id, canonical(other))), and(eq(relations.user_id, canonical(other)), eq(relations.friend_id, canonical(this.actor))));
  }
  private async pairLock(other: string) {
    const key = friendshipPairKey(this.actor, other);
    // A collision serializes unrelated pairs; it cannot grant authority or bypass row checks.
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`);
  }
  async generate(policy: SocialFriendshipPolicy) {
    for (let attempt = 0; attempt < policy.generation_attempts; attempt++) {
      const code = generateFriendInviteCode(policy.code_length);
      const row = (await this.tx.insert(invites).values({ code, user_id: canonical(this.actor), expires_at: sql`clock_timestamp() + ${policy.lifetime_seconds}::bigint * interval '1 second'` })
        .onConflictDoNothing({ target: invites.code }).returning({ code: invites.code, expires_at: sql<string>`${invites.expires_at}::text` }))[0];
      if (row) return { code: row.code, expires_at: pgTimestampToIso(row.expires_at) };
    }
    throw new AuthBoundaryError("FRIEND_INVITE_GENERATION_UNAVAILABLE");
  }
  async use(code: string) {
    const invite = (await this.tx.select({ inviter_id: sql<string>`${invites.user_id}::text`, used_by: sql<string | null>`${invites.used_by}::text`, used_at: invites.used_at }).from(invites).where(eq(invites.code, code)).limit(1).for("update"))[0];
    if (!invite) return failure("Invalid invite code");
    if (invite.used_by !== null || invite.used_at !== null) return failure("Invite code already used");
    // Check before self/relationship decisions, and again after waiting for the pair lock.
    const expired = async () => (await this.tx.select({ expired: sql<boolean>`${invites.expires_at} < clock_timestamp()` }).from(invites).where(eq(invites.code, code)).limit(1))[0]?.expired !== false;
    if (await expired()) return failure("Invite code expired");
    if (invite.inviter_id === this.actor) return failure("Cannot add yourself as friend");
    await this.pairLock(invite.inviter_id);
    if (await expired()) return failure("Invite code expired");
    const existing = await this.tx.select({ id: sql<string>`${relations.id}::text`, requester_id: sql<string>`${relations.user_id}::text`, status: relations.status }).from(relations).where(this.pairPredicate(invite.inviter_id)).orderBy(asc(relations.id)).for("update");
    if (existing.some(row => !["pending", "accepted", "rejected"].includes(row.status))) throw new AuthBoundaryError("FRIENDSHIP_DATA_INVALID");
    if (existing.some(row => row.status === "accepted")) return failure("Already friends");
    if (existing.some(row => row.status === "pending")) return failure("Friend request already pending");
    const inviter = (await this.tx.select({ display_name: users.display_name, email: users.email }).from(users).where(eq(users.id, canonical(invite.inviter_id))).limit(1))[0];
    if (!inviter) throw new AuthBoundaryError("FRIENDSHIP_DATA_INVALID");
    const rejected = existing.find(row => row.requester_id === this.actor);
    let requestId: string | undefined;
    if (rejected) {
      requestId = (await this.tx.update(relations).set({ status: "pending", created_at: sql`CURRENT_TIMESTAMP`, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(relations.id, canonical(rejected.id)), eq(relations.status, "rejected"))).returning({ id: sql<string>`${relations.id}::text` }))[0]?.id;
    } else {
      requestId = (await this.tx.insert(relations).values({ user_id: canonical(this.actor), friend_id: canonical(invite.inviter_id), status: "pending" }).returning({ id: sql<string>`${relations.id}::text` }))[0]?.id;
    }
    if (!requestId) throw new AuthBoundaryError("FRIENDSHIP_DATA_INVALID");
    const consumed = await this.tx.update(invites).set({ used_by: canonical(this.actor), used_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(invites.code, code), isNull(invites.used_by), isNull(invites.used_at))).returning({ code: invites.code });
    if (consumed.length !== 1) throw new AuthBoundaryError("FRIENDSHIP_DATA_INVALID");
    return { success: true as const, friend_request_id: requestId, inviter_id: invite.inviter_id, inviter_name: inviter.display_name || inviter.email };
  }
  async requests() {
    const rows = await this.tx.select({ id: sql<string>`${relations.id}::text`, requester_id: sql<string>`${relations.user_id}::text`, display_name: users.display_name, email: users.email, created_at: sql<string | null>`${relations.created_at}::text` }).from(relations)
      .innerJoin(users, eq(relations.user_id, users.id)).where(and(eq(relations.friend_id, canonical(this.actor)), eq(relations.status, "pending"))).orderBy(sql`${relations.created_at} DESC NULLS LAST`, desc(relations.id));
    return { requests: rows.map(row => ({ id: row.id, requester_id: row.requester_id, requester_name: row.display_name || row.email, created_at: pgTimestampToIso(row.created_at) })) };
  }
  async decide(requestId: string, target: "accepted" | "rejected") {
    const selector = eq(relations.id, canonical(requestId));
    const first = (await this.tx.select({ requester_id: sql<string>`${relations.user_id}::text`, recipient_id: sql<string>`${relations.friend_id}::text` }).from(relations).where(selector).limit(1))[0];
    if (!first) return failure("Request not found");
    if (first.recipient_id !== this.actor) return failure("Permission denied");
    await this.pairLock(first.requester_id);
    const row = (await this.tx.select({ requester_id: sql<string>`${relations.user_id}::text`, recipient_id: sql<string>`${relations.friend_id}::text`, status: relations.status }).from(relations).where(selector).limit(1).for("update"))[0];
    if (!row) return failure("Request not found");
    if (row.recipient_id !== this.actor) return failure("Permission denied");
    if (row.requester_id !== first.requester_id) throw new AuthBoundaryError("FRIENDSHIP_DATA_INVALID");
    if (row.status !== "pending") {
      if (!["accepted", "rejected"].includes(row.status)) throw new AuthBoundaryError("FRIENDSHIP_DATA_INVALID");
      return failure(`Request already ${row.status}`);
    }
    const changed = await this.tx.update(relations).set({ status: target, updated_at: sql`CURRENT_TIMESTAMP` }).where(and(selector, eq(relations.friend_id, canonical(this.actor)), eq(relations.status, "pending"))).returning({ id: sql<string>`${relations.id}::text` });
    if (changed.length !== 1) throw new AuthBoundaryError("FRIENDSHIP_DATA_INVALID");
    return { success: true as const };
  }
  async friends() {
    const other = sql`CASE WHEN ${relations.user_id} = ${canonical(this.actor)} THEN ${relations.friend_id} ELSE ${relations.user_id} END`;
    const rows = await this.tx.select({ friend_id: sql<string>`(${other})::text`, display_name: users.display_name, email: users.email, since: sql<string | null>`${relations.updated_at}::text` }).from(relations)
      .innerJoin(users, eq(users.id, other)).where(and(eq(relations.status, "accepted"), or(eq(relations.user_id, canonical(this.actor)), eq(relations.friend_id, canonical(this.actor)))))
      .orderBy(sql`${relations.updated_at} DESC NULLS LAST`, desc(relations.id));
    return { friends: rows.map(row => ({ friend_id: row.friend_id, friend_name: row.display_name || row.email, friend_email: row.email, since: pgTimestampToIso(row.since) })) };
  }
  async remove(friendId: string) {
    await this.pairLock(friendId);
    const deleted = await this.tx.delete(relations).where(and(eq(relations.status, "accepted"), this.pairPredicate(friendId))).returning({ id: sql<string>`${relations.id}::text` });
    return deleted.length ? { success: true as const } : failure("Friendship not found");
  }
  private async accepted(friendId: string) {
    await this.pairLock(friendId);
    return (await this.tx.select({ id: sql<string>`${relations.id}::text` }).from(relations).where(and(eq(relations.status, "accepted"), this.pairPredicate(friendId))).limit(1).for("share")).length !== 0;
  }
  async timeline(friendId: string, limit: number) {
    if (!await this.accepted(friendId)) return { pictures: null };
    const rows = await this.tx.select({ date: pictures.date, base64: sql<string>`COALESCE(${pictures.thumbnail_base64}, ${pictures.image_base64})`, prompt: pictures.prompt, created_at: sql<string | null>`${pictures.created_at}::text` }).from(pictures).where(eq(pictures.user_id, canonical(friendId))).orderBy(desc(pictures.date), desc(pictures.id)).limit(limit);
    return { pictures: rows.map(row => ({ ...row, created_at: pgTimestampToIso(row.created_at) })) };
  }
  async picture(friendId: string, date: string) {
    if (!await this.accepted(friendId)) return { image_base64: null };
    const row = (await this.tx.select({ image_base64: pictures.image_base64 }).from(pictures).where(and(eq(pictures.user_id, canonical(friendId)), eq(pictures.date, date))).orderBy(desc(pictures.created_at), desc(pictures.id)).limit(1))[0];
    return { image_base64: row?.image_base64 ?? null };
  }
}
