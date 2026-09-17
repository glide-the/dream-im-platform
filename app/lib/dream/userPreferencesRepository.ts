// [Input] Server-derived canonical OAuth ID and five allowed fields in the caller's Admin data UOW.
// [Output] Exact raw projection or one atomic insert/COALESCE merge without a read/write race.
// [Pos] Typed user_preferences Drizzle repository; no independent connection or generic patch.
// [Sync] 2026-09-15: preserve first-login/system config and avoid bigint Number conversion.
import { eq, sql } from "drizzle-orm";
import { user_preferences as preference } from "@ink-memory/db/schema/dream";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { UserPreferencesSaveInput } from "./userPreferencesDto";
export class UserPreferencesRepository {
  constructor(private readonly tx: DataTransaction, private readonly canonicalUserId: string) { decimalIdDto.parse(canonicalUserId); }
  async get() {
    const rows = await this.tx.select({ voice_configs_json: preference.voice_configs_json, meta_prompt: preference.meta_prompt,
      state_config_json: preference.state_config_json, selected_state: preference.selected_state, timezone: preference.timezone,
      first_login_completed: preference.first_login_completed, updated_at: sql<string | null>`${preference.updated_at}::text`,
    }).from(preference).where(eq(preference.user_id, sql`${this.canonicalUserId}::bigint`)).limit(1);
    return rows[0] ?? null;
  }
  async save(input: UserPreferencesSaveInput) {
    await this.tx.insert(preference).values({ user_id: sql`${this.canonicalUserId}::bigint`, ...input }).onConflictDoUpdate({
      target: preference.user_id,
      set: { voice_configs_json: sql`COALESCE(EXCLUDED.voice_configs_json, ${preference.voice_configs_json})`,
        meta_prompt: sql`COALESCE(EXCLUDED.meta_prompt, ${preference.meta_prompt})`,
        state_config_json: sql`COALESCE(EXCLUDED.state_config_json, ${preference.state_config_json})`,
        selected_state: sql`COALESCE(EXCLUDED.selected_state, ${preference.selected_state})`,
        timezone: sql`COALESCE(EXCLUDED.timezone, ${preference.timezone})`, updated_at: sql`CURRENT_TIMESTAMP` },
    });
  }
}
