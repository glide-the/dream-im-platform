// [Input] Verified decimal canonical owner, original section and raw filtered prompt text in caller UOW.
// [Output] Owner/section-scoped lookup, original upsert and bounded deletion boolean.
// [Pos] Registered typed Reflections repository; no pool, commit, JSON rewrite or filesystem operation.
// [Sync] 2026-09-15: retain composite conflict target/current transaction time and raw bytes.
import { and, eq, sql } from "drizzle-orm";
import { reflections_section_configs as config } from "@ink-memory/db/schema/dream";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { ReflectionsSection } from "./reflectionsSectionConfigDto";
export class ReflectionsSectionConfigRepository {
  constructor(private readonly tx: DataTransaction, private readonly actor: string) { decimalIdDto.parse(actor); }
  private owned(section: ReflectionsSection) { return and(eq(config.user_id, sql`${this.actor}::bigint`), eq(config.section, section)); }
  async get(section: ReflectionsSection) {
    return (await this.tx.select({ prompt_files: config.prompt_files }).from(config).where(this.owned(section)).limit(1))[0] ?? null;
  }
  async save(section: ReflectionsSection, raw: string) {
    await this.tx.insert(config).values({ user_id: sql`${this.actor}::bigint`, section, prompt_files: raw, updated_at: sql`CURRENT_TIMESTAMP` })
      .onConflictDoUpdate({ target: [config.user_id, config.section], set: { prompt_files: sql`EXCLUDED.prompt_files`, updated_at: sql`CURRENT_TIMESTAMP` } });
  }
  async delete(section: ReflectionsSection) {
    return (await this.tx.delete(config).where(this.owned(section)).returning({ section: config.section })).length > 0;
  }
}
