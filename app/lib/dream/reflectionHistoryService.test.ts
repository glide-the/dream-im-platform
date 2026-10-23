// [Input] Real history Service/DTO and owner-scoped repository responses.
// [Output] Page cursor, configured bounds, owner denial and missing-time fail-closed regression.
// [Pos] Deterministic Reflections read contract, independent of PostgreSQL and providers.
// [Sync] 2026-10-23: locate the frozen history descriptor by name as additive operations are appended.
// [Sync] 2026-10-14: preserve exact instants and decimal IDs; no writes or legacy contract changes.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DataTransaction } from "./database";
const history = vi.hoisted(() => vi.fn());
vi.mock("./reflectionTaskRepository", () => ({ ReflectionTaskRepository: class { reportHistory = history; } }));
import { readReflectionHistory } from "./reflectionHistoryService";
import { reflectionHistoryInputDto } from "./reflectionHistoryDto";
import { dreamOperations } from "./operationRegistry";
const actor = { principal: { subject: "fixture", canonical_user_id: "7001", client_id: "fixture-browser", scopes: ["dream:read"], status: "active" as const }, threadScope: null };
const tx = {} as DataTransaction;
const row = { id: "9007199254740993", report_type: "full_analysis", report_data_json: '{"echoes":[]}',
  task_id: null, created_at: "2026-12-01T00:00:00Z", analysis_created_at: "2026-09-30T16:00:00.123456Z" };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("DREAM_REFLECTION_REPORT_LIST_MAX_ROWS", "10"); });
afterEach(() => vi.unstubAllEnvs());
it("pages exact creation-time/id and preserves lossless report data", async () => {
  history.mockResolvedValue([row, { ...row, id: "9007199254740992" }]);
  const before = { id: "9007199254740994", created_at: row.analysis_created_at };
  const page = await readReflectionHistory({ limit: 1, before }, actor, tx);
  expect(page).toEqual({ reports: [row], next_cursor: { id: row.id, created_at: row.analysis_created_at } });
  expect(history).toHaveBeenCalledExactlyOnceWith("7001", { limit: 1, before });
});
it("returns empty and final pages without a cursor", async () => {
  history.mockResolvedValueOnce([]).mockResolvedValueOnce([row]);
  expect(await readReflectionHistory({}, actor, tx)).toEqual({ reports: [], next_cursor: null });
  expect((await readReflectionHistory({}, actor, tx)).next_cursor).toBeNull();
});
it("rejects scopes, entity delegation and per-page capacity before repository access", async () => {
  await expect(readReflectionHistory({}, { ...actor, principal: { ...actor.principal, scopes: [] } }, tx)).rejects.toMatchObject({ status: 403 });
  await expect(readReflectionHistory({}, { ...actor, runScope: "wrong" } as unknown as typeof actor, tx)).rejects.toMatchObject({ status: 403 });
  await expect(readReflectionHistory({ limit: 11 }, actor, tx)).rejects.toMatchObject({ code: "REFLECTION_REPORT_LIMIT_EXCEEDED" });
  expect(history).not.toHaveBeenCalled();
});
it("rejects missing analysis creation instead of falling back to saved time", async () => {
  history.mockResolvedValue([{ ...row, analysis_created_at: null }]);
  await expect(readReflectionHistory({}, actor, tx)).rejects.toMatchObject({ code: "REFLECTION_HISTORY_DATA_INVALID", status: 503 });
});
it("keeps input closed and advertises the exact additional read under existing capabilities", () => {
  expect(reflectionHistoryInputDto.safeParse({ before: { id: "1", created_at: "2026-02-30T00:00:00Z" } }).success).toBe(false);
  expect(reflectionHistoryInputDto.safeParse({ user_id: "caller" }).success).toBe(false);
  expect(dreamOperations.find(operation => operation.capability.name === "analysis-report.history-page")?.capability).toMatchObject({ name: "analysis-report.history-page", kind: "read", user_scope: "dream:read", contract_sha256: "a946906d179dc9d7b0b920d21f8b6d4d8a198730114514c99fd0fbc586bcc710" });
});
