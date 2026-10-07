// [Input] Production scheduled Thread read with injected owner checks and ORM results.
// [Output] Provider-free evidence for scope/owner guards, SQL owner filters and definition/execution projection.
// [Pos] Scheduled activity domain read contract; no database or model call.
// [Sync] 2026-10-07: cover source, execution, empty, missing Thread and invalid/unauthorized reads.
import { beforeEach, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { DataTransaction } from "./database";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), owned: vi.fn(), owner: vi.fn() }));
vi.mock("../auth/subjectRepository", () => ({ SubjectRepository: class { findActive = mocks.identity; } }));
vi.mock("./chatThreadRepository", () => ({ ChatThreadRepository: class {
  constructor(_tx: unknown, userId: string) { mocks.owner(userId); }
  requireOwned = mocks.owned;
} }));
import { runChatScheduledUserV2Operation, type ScheduledTaskActor } from "./chatScheduledTaskService";

const actor: ScheduledTaskActor = { principal: { subject: "subject-42", canonical_user_id: "42", client_id: "browser",
  scopes: ["dream:read"], status: "active" }, threadScope: null };
const task = { id: "550e8400-e29b-41d4-a716-446655440000", source_thread_id: "source", title: "历史任务",
  prompt: "执行检查", schedule_kind: "interval", interval_minutes: 10, time_zone: "Asia/Shanghai",
  local_date: null, local_time: null, single_offset_minutes: null, next_run_at: null,
  status: "paused", revision: 3, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-10-07T00:00:00Z" };
const trigger = { id: "550e8400-e29b-41d4-a716-446655440001", task_id: task.id, kind: "scheduled",
  scheduled_at: "2026-10-06T00:00:00Z", definition_revision: 2, title_snapshot: "旧名称",
  source_thread_id: "source", time_zone_snapshot: "Asia/Shanghai", status: "succeeded",
  task_session_id: "session", target_thread_id: "execution", input_message_id: "input",
  target_turn_id: "turn", final_message_id: "final", error_code: null,
  skipped_from_at: null, skipped_through_at: null,
  created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T00:00:00Z" };

function transaction(results: unknown[][]) {
  const predicates: { sql: string; params: unknown[] }[] = [];
  const joins: string[] = [];
  let index = 0;
  const select = vi.fn(() => {
    const rows = results[index++] ?? [];
    const query = {
      from: () => query, orderBy: () => query, limit: () => query,
      innerJoin: (_table: unknown, condition: SQL) => { joins.push(new PgDialect().sqlToQuery(condition).sql); return query; },
      where: (condition: SQL) => { predicates.push(new PgDialect().sqlToQuery(condition)); return query; },
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return query;
  });
  return { tx: { select } as unknown as DataTransaction, select, predicates, joins };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ canonicalUserId: 42 });
  mocks.owned.mockResolvedValue({ id: "source" });
});
it("returns historical paused definitions before any trigger and filters by canonical owner and source Thread", async () => {
  const db = transaction([[task], []]);
  expect(await runChatScheduledUserV2Operation("scheduled-task.v2.thread", { thread_id: "source" }, actor, db.tx, "dream"))
    .toMatchObject({ created: [{ id: task.id, status: "paused", rule: { kind: "interval", interval_minutes: 10 } }], source: null });
  expect(mocks.owner).toHaveBeenCalledWith("42");
  expect(mocks.owned).toHaveBeenCalledWith("source");
  expect(db.predicates[0].params).toEqual(["42", "source"]);
  expect(db.predicates[0].sql).toContain('"chat_scheduled_task"."user_id"');
  expect(db.predicates[0].sql).toContain('"chat_scheduled_task"."source_thread_id"');
});
it("returns the exact execution source with separate current definition and trigger states", async () => {
  const db = transaction([[], [{ task, trigger }]]);
  const result = await runChatScheduledUserV2Operation("scheduled-task.v2.thread", { thread_id: "execution" }, actor, db.tx, "dream");
  expect(result).toMatchObject({ created: [], source: { task: { title: "历史任务", status: "paused", revision: 3 },
    trigger: { title: "旧名称", status: "succeeded", definition_revision: 2, target_thread_id: "execution" } } });
  expect(db.predicates[1].params).toEqual(["execution", "42", "42"]);
  expect(db.predicates[1].sql).toContain('"chat_scheduled_trigger"."user_id"');
  expect(db.predicates[1].sql).toContain('"chat_scheduled_task"."user_id"');
  expect(db.joins[0]).toContain('"chat_scheduled_trigger"."task_id" = "chat_scheduled_task"."id"');
});
it("returns an explicit empty snapshot for an owned unrelated Thread", async () => {
  const db = transaction([[], []]);
  expect(await runChatScheduledUserV2Operation("scheduled-task.v2.thread", { thread_id: "unrelated" }, actor, db.tx, "dream"))
    .toEqual({ created: [], source: null });
});
it("rejects missing Thread ownership, scope, delegation and caller identity selectors before reading relations", async () => {
  const db = transaction([[], []]);
  const run = (nextActor: ScheduledTaskActor = actor, input: unknown = { thread_id: "foreign" }) =>
    runChatScheduledUserV2Operation("scheduled-task.v2.thread", input, nextActor, db.tx, "dream");
  mocks.owned.mockRejectedValueOnce(Object.assign(new Error("not owned"), { status: 404 }));
  await expect(run()).rejects.toMatchObject({ status: 404 });
  await expect(run({ ...actor, principal: { ...actor.principal, scopes: [] } })).rejects.toMatchObject({ status: 403 });
  await expect(run({ ...actor, threadScope: "foreign" })).rejects.toMatchObject({ status: 403 });
  await expect(run(actor, { thread_id: "foreign", user_id: "7" })).rejects.toMatchObject({ status: 400 });
  expect(db.select).not.toHaveBeenCalled();
});
