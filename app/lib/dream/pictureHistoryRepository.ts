// [Input] Verified canonical actor, closed date range and limit in the caller's Admin data UOW.
// [Output] Typed current-owner picture summaries or newest same-date full image.
// [Pos] Picture-history persistence only; no friendship checks, connection ownership or generic selectors.
// [Sync] 2026-09-15: preserve thumbnail fallback, inclusive date casts and descending legacy order.
import { and, desc, eq, sql } from "drizzle-orm";
import { daily_pictures as pictures } from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import { pgTimestampToIso } from "./chatThreadDto";
import type { DataTransaction } from "./database";
import { pictureHistoryItemDto, type PictureHistoryListInput } from "./pictureHistoryDto";

const canonical = (id: string) => sql`${id}::bigint`;

export class PictureHistoryRepository {
  constructor(private readonly tx: DataTransaction, private readonly actor: string) {
    decimalIdDto.parse(actor);
  }

  async list(input: PictureHistoryListInput) {
    const predicates = [eq(pictures.user_id, canonical(this.actor))];
    if (input.start_date !== null) predicates.push(sql`${pictures.date}::date >= ${input.start_date}::date`);
    if (input.end_date !== null) predicates.push(sql`${pictures.date}::date <= ${input.end_date}::date`);
    const rows = await this.tx.select({
      date: pictures.date,
      base64: sql<string>`COALESCE(${pictures.thumbnail_base64}, ${pictures.image_base64})`,
      prompt: pictures.prompt,
      created_at: sql<string | null>`${pictures.created_at}::text`,
    }).from(pictures).where(and(...predicates)).orderBy(desc(pictures.date), desc(pictures.id)).limit(input.limit);

    return {
      pictures: rows.map(row => {
        let created_at: string | null;
        try { created_at = pgTimestampToIso(row.created_at); }
        catch { throw new AuthBoundaryError("PICTURE_HISTORY_DATA_INVALID"); }
        const parsed = pictureHistoryItemDto.safeParse({ ...row, created_at });
        if (!parsed.success) throw new AuthBoundaryError("PICTURE_HISTORY_DATA_INVALID");
        return parsed.data;
      }),
    };
  }

  async full(date: string) {
    const row = (await this.tx.select({ image_base64: pictures.image_base64 }).from(pictures)
      .where(and(eq(pictures.user_id, canonical(this.actor)), eq(pictures.date, date)))
      .orderBy(desc(pictures.created_at), desc(pictures.id)).limit(1))[0];
    return { image_base64: row?.image_base64 ?? null };
  }
}
