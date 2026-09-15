// [Input] Registry101 local-data DTOs, OAuth actor, repository seams and typed Drizzle query builders.
// [Output] Closed-field, raw-JSON, category, ownership and first-login behavior without a provider.
// [Pos] Deterministic domain/repository gate; public transaction faults remain isolated PostgreSQL evidence.
// [Sync] 2026-09-15: cover all four categories, foreign-owner rejection and insert/update/repeat completion.
import { afterEach, describe, expect, it, vi } from "vitest";
import { analysis_reports, daily_pictures, user_preferences, user_sessions } from "@ink-memory/db/schema/dream";
import type { DataTransaction } from "./database";
import { localDataImportInputDto, type LocalDataImportInput } from "./localDataImportDto";
import { LocalDataImportRepository } from "./localDataImportRepository";
import { runLocalDataImportOperation, type LocalDataImportActor } from "./localDataImportService";

const actor: LocalDataImportActor = {
  principal: { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" },
  threadScope: null, editorSessionScope: null, runScope: null,
};
const empty: LocalDataImportInput = { sessions: [], pictures: [], preferences: null, reports: [] };
const session = { id: "session-1", name: "Name", editor_state: '{"counter":9007199254740993,"float":1.0}' };
const picture = { date: "2026-09-15", image_base64: "data:image/png;base64,AA==", prompt: "prompt" };
const preferences = { voice_configs: '{"counter":9007199254740993,"float":1.0}', meta_prompt: "", state_config: '{"温度":1.0}', selected_state: null };
const legacyReportTimestampMs = 1_757_913_600_123;
const report = { type: "patterns", data: '{"counter":9007199254740993,"float":1.0}', all_notes: "notes", timestamp: new Date(legacyReportTimestampMs).toISOString() };

afterEach(() => vi.restoreAllMocks());

describe("strict normalized import DTO", () => {
  it("accepts empty and every normalized category while retaining raw JSON text", () => {
    expect(localDataImportInputDto.parse(empty)).toEqual(empty);
    const input = { sessions: [session], pictures: [picture], preferences, reports: [report] };
    expect(localDataImportInputDto.parse(input)).toEqual(input);
    expect(report.timestamp).toBe("2025-09-15T05:20:00.123Z");
  });
  it.each(["user_id", "subject", "actor", "sql", "table", "column", "database_url"])("rejects caller-authored %s", key => {
    expect(localDataImportInputDto.safeParse({ ...empty, [key]: "caller" }).success).toBe(false);
  });
  it("rejects malformed object JSON, unknown item fields and ambiguous duplicate Session IDs", () => {
    expect(localDataImportInputDto.safeParse({ ...empty, sessions: [{ ...session, editor_state: "[]" }] }).success).toBe(false);
    expect(localDataImportInputDto.safeParse({ ...empty, reports: [{ ...report, data: "{" }] }).success).toBe(false);
    expect(localDataImportInputDto.safeParse({ ...empty, pictures: [{ ...picture, user_id: "1" }] }).success).toBe(false);
    expect(localDataImportInputDto.safeParse({ ...empty, sessions: [session, session] }).success).toBe(false);
    expect(localDataImportInputDto.safeParse({ ...empty, reports: [{ ...report, timestamp: "1757913600123" }] }).success).toBe(false);
  });
});

describe("local-data business service", () => {
  it.each([
    ["empty", empty],
    ["Session", { ...empty, sessions: [session] }],
    ["Picture", { ...empty, pictures: [picture] }],
    ["Preferences", { ...empty, preferences }],
    ["Report", { ...empty, reports: [report] }],
  ] as const)("returns accepted counts for %s import", async (_label, input) => {
    const imported = { sessions: input.sessions.length, pictures: input.pictures.length, preferences: input.preferences ? 1 : 0, reports: input.reports.length };
    const call = vi.spyOn(LocalDataImportRepository.prototype, "importData").mockResolvedValue(imported);
    expect(await runLocalDataImportOperation("local-data.import", input, actor, {} as DataTransaction)).toEqual({ success: true, imported });
    expect(call).toHaveBeenCalledExactlyOnceWith(input);
  });
  it("returns the same persisted first-login state for insert, update and repeat", async () => {
    const complete = vi.spyOn(LocalDataImportRepository.prototype, "completeFirstLogin").mockResolvedValue(1);
    for (let index = 0; index < 3; index++) expect(await runLocalDataImportOperation("first-login.complete", {}, actor, {} as DataTransaction)).toEqual({ success: true, first_login_completed: 1 });
    expect(complete).toHaveBeenCalledTimes(3);
  });
  it("propagates a foreign-owner conflict and admits no delegated entity actor", async () => {
    vi.spyOn(LocalDataImportRepository.prototype, "importData").mockRejectedValue(Object.assign(new Error("conflict"), { code: "LOCAL_DATA_SESSION_OWNER_CONFLICT", status: 409 }));
    await expect(runLocalDataImportOperation("local-data.import", { ...empty, sessions: [session] }, actor, {} as DataTransaction)).rejects.toMatchObject({ code: "LOCAL_DATA_SESSION_OWNER_CONFLICT", status: 409 });
    await expect(runLocalDataImportOperation("local-data.import", empty, { ...actor, threadScope: "thread" }, {} as DataTransaction)).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
  });
});

type InsertRecord = { table: unknown; values?: unknown; conflict?: Record<string, unknown> };
function repositoryTx(owners: { id: string; owner: string }[] = [], sessionIds = [session.id], completed = 1) {
  const inserts: InsertRecord[] = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => owners }) }) }),
    insert: (table: unknown) => {
      const record: InsertRecord = { table }; inserts.push(record);
      const chain: Record<string, unknown> & PromiseLike<unknown> = {
        values(value: unknown) { record.values = value; return chain; },
        onConflictDoUpdate(value: Record<string, unknown>) { record.conflict = value; return chain; },
        returning: async () => table === user_sessions ? sessionIds.map(id => ({ id })) : [{ completed }],
        then(resolve, reject) { return Promise.resolve(undefined).then(resolve, reject); },
      };
      return chain;
    },
  } as unknown as DataTransaction;
  return { tx, inserts };
}

describe("typed aggregate repository", () => {
  it("rejects a locked foreign Session before any category write", async () => {
    const { tx, inserts } = repositoryTx([{ id: session.id, owner: "7" }]);
    await expect(new LocalDataImportRepository(tx, actor.principal.canonical_user_id).importData({ sessions: [session], pictures: [picture], preferences, reports: [report] })).rejects.toMatchObject({ code: "LOCAL_DATA_SESSION_OWNER_CONFLICT", status: 409 });
    expect(inserts).toEqual([]);
  });
  it("uses same-owner Session upsert and writes all four categories with unchanged JSON bytes and RFC3339 report time", async () => {
    const { tx, inserts } = repositoryTx([{ id: session.id, owner: actor.principal.canonical_user_id }]);
    const result = await new LocalDataImportRepository(tx, actor.principal.canonical_user_id).importData({ sessions: [session], pictures: [picture], preferences, reports: [report] });
    expect(result).toEqual({ sessions: 1, pictures: 1, preferences: 2, reports: 1 });
    expect(inserts.map(item => item.table)).toEqual([user_sessions, daily_pictures, user_preferences, analysis_reports]);
    expect(inserts[0].conflict).toHaveProperty("setWhere");
    expect(inserts[0].values).toEqual([expect.objectContaining({ id: session.id, name: session.name, editor_state_json: session.editor_state })]);
    expect(inserts[2].values).toEqual(expect.objectContaining({ voice_configs_json: preferences.voice_configs, state_config_json: preferences.state_config }));
    expect(inserts[3].values).toEqual([expect.objectContaining({ report_data_json: report.data, all_notes_text: report.all_notes, created_at: report.timestamp })]);
  });
  it.each([
    [{ voice_configs: null, meta_prompt: null, state_config: null, selected_state: null }, 0],
    [{ voice_configs: "{}", meta_prompt: "", state_config: null, selected_state: null }, 0],
    [{ voice_configs: '{"a":1}', meta_prompt: "", state_config: null, selected_state: null }, 1],
    [{ voice_configs: '{"a":1}', meta_prompt: "prompt", state_config: null, selected_state: null }, 2],
    [{ voice_configs: '{"a":1}', meta_prompt: "prompt", state_config: '{"b":2}', selected_state: null }, 3],
    [{ voice_configs: '{"a":1}', meta_prompt: "prompt", state_config: '{"b":2}', selected_state: "focused" }, 4],
  ] as const)("returns the existing visible preference count %s -> %i", async (value, count) => {
    const { tx } = repositoryTx();
    expect(await new LocalDataImportRepository(tx, actor.principal.canonical_user_id).importData({ ...empty, preferences: value })).toEqual({ sessions: 0, pictures: 0, preferences: count, reports: 0 });
  });
  it("upserts first-login completion to one for missing, existing and repeated rows", async () => {
    const { tx, inserts } = repositoryTx(); const repository = new LocalDataImportRepository(tx, actor.principal.canonical_user_id);
    expect(await repository.completeFirstLogin()).toBe(1); expect(await repository.completeFirstLogin()).toBe(1);
    expect(inserts).toHaveLength(2);
    for (const insert of inserts) {
      expect(insert.table).toBe(user_preferences);
      expect(insert.values).toEqual(expect.objectContaining({ first_login_completed: 1 }));
      expect(insert.conflict).toEqual(expect.objectContaining({ target: user_preferences.user_id, set: expect.objectContaining({ first_login_completed: 1 }) }));
    }
  });
});
