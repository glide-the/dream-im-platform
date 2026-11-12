// [Input] Existing transaction, verified owner and strict share DTOs.
// [Output] Atomic immutable publication, keyset lists and single-link revocation.
// [Pos] Admin PostgreSQL share owner; source deletion preserves the independent snapshot.
import {randomBytes, randomUUID} from 'node:crypto';
import {and, desc, eq, sql} from 'drizzle-orm';
import {external_shares, chat_thread, user_sessions} from '@ink-memory/db/schema/dream';
import {z} from 'zod';
import {AuthBoundaryError} from '../auth/config';
import type {DataTransaction} from './database';
import {pgTimestampToIso} from './chatThreadDto';
import {shareCreateInputDto, shareListInputDto, shareMetadataDto, shareSnapshotDto} from './externalShareDto';
type Row = typeof external_shares.$inferSelect;
function available() {return sql<boolean>`CASE WHEN ${external_shares.kind} = 'chat' THEN EXISTS(SELECT 1 FROM ${chat_thread} WHERE ${chat_thread.id} = ${external_shares.source_id} AND ${chat_thread.user_id} = ${external_shares.user_id}) ELSE EXISTS(SELECT 1 FROM ${user_sessions} WHERE ${user_sessions.id} = ${external_shares.source_id} AND ${user_sessions.user_id} = ${external_shares.user_id}) END`;}
function metadata(row: Row, sourceAvailable: boolean) {return shareMetadataDto.parse({id: row.id, kind: row.kind, source_id: row.source_id, title: row.title,
  path: `/share/${row.token}`, status: row.status, created_at: pgTimestampToIso(row.created_at), revoked_at: pgTimestampToIso(row.revoked_at), source_available: sourceAvailable});}
export class ExternalShareRepository {
  constructor(private readonly tx: DataTransaction, private readonly ownerId: string) {}
  private owner() {return eq(external_shares.user_id, sql`${this.ownerId}::bigint`);}
  async create(input: z.infer<typeof shareCreateInputDto>) {
    if (input.kind !== input.snapshot.kind) throw new AuthBoundaryError('SHARE_KIND_INVALID', 400);
    const source = input.kind === 'chat'
      ? await this.tx.select({id: chat_thread.id}).from(chat_thread).where(and(eq(chat_thread.id, input.source_id), eq(chat_thread.user_id, sql`${this.ownerId}::bigint`))).for('share').limit(1)
      : await this.tx.select({id: user_sessions.id}).from(user_sessions).where(and(eq(user_sessions.id, input.source_id), eq(user_sessions.user_id, sql`${this.ownerId}::bigint`))).for('share').limit(1);
    if (!source.length) throw new AuthBoundaryError('SHARE_SOURCE_NOT_FOUND', 404);
    const content = input.snapshot.kind === 'chat' ? input.snapshot.messages.map(message => message.content).join('\n') : input.snapshot.paragraphs.join('\n');
    if (!content.trim()) throw new AuthBoundaryError('SHARE_CONTENT_EMPTY', 400);
    const [row] = await this.tx.insert(external_shares).values({id: randomUUID(), user_id: sql`${this.ownerId}::bigint`,
      kind: input.kind, source_id: input.source_id, token: randomBytes(32).toString('base64url'), title: input.snapshot.title,
      snapshot: shareSnapshotDto.parse(input.snapshot)}).returning();
    return {share: metadata(row, true)};
  }
  async get(id: string) {
    const [found] = await this.tx.select({row: external_shares, available: available()}).from(external_shares).where(and(this.owner(), eq(external_shares.id, id))).limit(1);
    return {share: found ? metadata(found.row, found.available) : null};
  }
  async list(input: z.infer<typeof shareListInputDto>) {
    const rows = await this.tx.select({row: external_shares, available: available()}).from(external_shares).where(and(this.owner(), eq(external_shares.kind, input.kind), eq(external_shares.status, input.status),
      input.before ? sql`(${external_shares.created_at}, ${external_shares.id}) < (${input.before.created_at}::timestamptz, ${input.before.id})` : undefined))
      .orderBy(desc(external_shares.created_at), desc(external_shares.id)).limit(input.limit + 1);
    const totals = await this.tx.select({kind: external_shares.kind, total: sql<number>`count(*)::integer`}).from(external_shares)
      .where(and(this.owner(), eq(external_shares.status, 'active'))).groupBy(external_shares.kind);
    const counts = {chat: 0, note: 0}; for (const item of totals) counts[item.kind as keyof typeof counts] = item.total;
    const shares = rows.slice(0, input.limit).map(item => metadata(item.row, item.available));
    const last = shares.at(-1);
    return {shares, counts, next_cursor: rows.length > input.limit && last ? {id: last.id, created_at: last.created_at} : null};
  }
  async revoke(id: string) {
    await this.tx.update(external_shares).set({status: 'revoked', revoked_at: sql`CURRENT_TIMESTAMP`})
      .where(and(this.owner(), eq(external_shares.id, id), eq(external_shares.status, 'active')));
    const result = await this.get(id);
    if (!result.share) throw new AuthBoundaryError('SHARE_NOT_FOUND', 404);
    return {share: result.share};
  }
}
