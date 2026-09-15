// [Input] One verified canonical owner, one normalized import aggregate and the caller's Admin data UOW.
// [Output] Same-owner Session upserts, append-only Picture/Report inserts, full preference import and first-login completion.
// [Pos] Typed Drizzle repository for Registry101; it owns no connection and accepts no physical selectors.
// [Sync] 2026-09-15: reject foreign Session IDs before any aggregate effect and preserve receipt-level replay safety.
import { eq, inArray, sql } from "drizzle-orm";
import { analysis_reports, daily_pictures, user_preferences, user_sessions } from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { LocalDataImportInput } from "./localDataImportDto";

export class LocalDataImportRepository {
  private readonly canonicalUserId: string;
  constructor(private readonly tx: DataTransaction, canonicalUserId: string) {
    this.canonicalUserId = decimalIdDto.parse(canonicalUserId);
  }
  private ownerValue() { return sql`${this.canonicalUserId}::bigint`; }
  private preferenceCount(input: NonNullable<LocalDataImportInput["preferences"]>) {
    const configPresent = (raw: string | null) => raw !== null && Object.keys(JSON.parse(raw) as Record<string, unknown>).length > 0;
    return Number(configPresent(input.voice_configs)) + Number(input.meta_prompt !== null && input.meta_prompt.length > 0)
      + Number(configPresent(input.state_config)) + Number(input.selected_state !== null && input.selected_state.length > 0);
  }

  private async requireImportableSessions(sessionIds: string[]) {
    if (!sessionIds.length) return;
    const rows = await this.tx.select({ id: user_sessions.id, owner: sql<string>`${user_sessions.user_id}::text` })
      .from(user_sessions).where(inArray(user_sessions.id, sessionIds)).for("update");
    if (rows.some(row => row.owner !== this.canonicalUserId)) throw new AuthBoundaryError("LOCAL_DATA_SESSION_OWNER_CONFLICT", 409);
  }

  async importData(input: LocalDataImportInput) {
    await this.requireImportableSessions(input.sessions.map(item => item.id));
    if (input.sessions.length) {
      const rows = await this.tx.insert(user_sessions).values(input.sessions.map(item => ({
        id: item.id, user_id: this.ownerValue(), name: item.name, editor_state_json: item.editor_state,
        updated_at: sql`CURRENT_TIMESTAMP`,
      }))).onConflictDoUpdate({
        target: user_sessions.id,
        set: { name: sql`EXCLUDED.name`, editor_state_json: sql`EXCLUDED.editor_state_json`, updated_at: sql`CURRENT_TIMESTAMP` },
        setWhere: eq(user_sessions.user_id, this.ownerValue()),
      }).returning({ id: user_sessions.id });
      if (rows.length !== input.sessions.length) throw new AuthBoundaryError("LOCAL_DATA_SESSION_OWNER_CONFLICT", 409);
    }
    if (input.pictures.length) await this.tx.insert(daily_pictures).values(input.pictures.map(item => ({
      user_id: this.ownerValue(), date: item.date, image_base64: item.image_base64, prompt: item.prompt,
    })));
    if (input.preferences) await this.tx.insert(user_preferences).values({
      user_id: this.ownerValue(), voice_configs_json: input.preferences.voice_configs,
      meta_prompt: input.preferences.meta_prompt, state_config_json: input.preferences.state_config,
      selected_state: input.preferences.selected_state,
    }).onConflictDoUpdate({
      target: user_preferences.user_id,
      set: {
        voice_configs_json: sql`EXCLUDED.voice_configs_json`, meta_prompt: sql`EXCLUDED.meta_prompt`,
        state_config_json: sql`EXCLUDED.state_config_json`, selected_state: sql`EXCLUDED.selected_state`,
        updated_at: sql`CURRENT_TIMESTAMP`,
      },
    });
    if (input.reports.length) await this.tx.insert(analysis_reports).values(input.reports.map(item => ({
      user_id: this.ownerValue(), report_type: item.type, report_data_json: item.data, all_notes_text: item.all_notes,
      created_at: item.timestamp,
    })));
    return {
      sessions: input.sessions.length, pictures: input.pictures.length,
      preferences: input.preferences === null ? 0 : this.preferenceCount(input.preferences), reports: input.reports.length,
    };
  }

  async completeFirstLogin() {
    const row = (await this.tx.insert(user_preferences).values({
      user_id: this.ownerValue(), first_login_completed: 1,
    }).onConflictDoUpdate({
      target: user_preferences.user_id,
      set: { first_login_completed: 1, updated_at: sql`CURRENT_TIMESTAMP` },
    }).returning({ completed: user_preferences.first_login_completed }))[0];
    if (row?.completed !== 1) throw new AuthBoundaryError("FIRST_LOGIN_DATA_INVALID");
    return row.completed;
  }
}
