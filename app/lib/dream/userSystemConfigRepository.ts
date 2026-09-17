// [Input] Existing caller-owned Drizzle UOW and decimal canonical actor.
// [Output] Current SystemConfig column read or locked merge prerequisites and isolated-column update.
// [Pos] Typed repository; no pool, commit, DDL, caller column names or JSON-number conversion.
// [Sync] 2026-09-15: INSERT-conflict plus row lock serializes first patches with independent Preferences UPSERT.
import { eq, sql } from "drizzle-orm";
import { user_preferences as preferences } from "@ink-memory/db/schema/dream";
import { decimalIdDto } from "../auth/dto";
import { AuthBoundaryError } from "../auth/config";
import type { DataTransaction } from "./database";
export class UserSystemConfigRepository {
  private readonly actor: string;
  constructor(private readonly tx: DataTransaction, actor: string) { this.actor = decimalIdDto.parse(actor); }
  private owned() { return eq(preferences.user_id, sql`${this.actor}::bigint`); }
  async get() { return (await this.tx.select({ system_config_json: preferences.system_config_json }).from(preferences).where(this.owned()).limit(1))[0] ?? null; }
  async ensureLocked() {
    await this.tx.insert(preferences).values({ user_id: sql`${this.actor}::bigint` }).onConflictDoNothing({ target: preferences.user_id });
    const row = (await this.tx.select({ system_config_json: preferences.system_config_json }).from(preferences).where(this.owned()).limit(1).for("update"))[0];
    if (!row) throw new AuthBoundaryError("USER_SYSTEM_CONFIG_DATA_INVALID");
    return row;
  }
  async update(raw: string) {
    const result = await this.tx.update(preferences).set({ system_config_json: raw, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(this.owned()).returning({ actor: sql<string>`${preferences.user_id}::text` });
    if (result.length !== 1 || result[0].actor !== this.actor) throw new AuthBoundaryError("USER_SYSTEM_CONFIG_DATA_INVALID");
  }
}
