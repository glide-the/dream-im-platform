// [Input] Production data UOW and Drizzle predicates with injected ledger query results.
// [Output] Exact batch/deduplication, conflict, failure and transaction-order regressions.
// [Pos] Provider-free persistence-boundary tests; no database connection or migration.
// [Sync] 2026-11-16: cover one ledger read before the original transactional handler.
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { type SQL } from "drizzle-orm";
import { hasSchemaCapability, readSchemaCapabilities, withDataTransaction, type DataDatabase, type DataTransaction, type SchemaRequirement } from "./database";

const required: SchemaRequirement = { capability: "fixture.first", version: 1, contractSha256: "a".repeat(64) };
const second: SchemaRequirement = { capability: "fixture.second", version: 2, contractSha256: "b".repeat(64) };
function harness(rows: SchemaRequirement[] = [required, second], error?: Error) {
  const events: string[] = [];
  const query = vi.fn(async (_predicate: SQL) => {
    events.push("ledger");
    if (error) throw error;
    return rows;
  });
  const tx = { select: vi.fn(() => ({ from: () => ({ where: query }) })) } as unknown as DataTransaction;
  const database = { transaction: vi.fn(async (action: (transaction: DataTransaction) => Promise<unknown>) => {
    events.push("begin");
    try { const result = await action(tx); events.push("commit"); return result; }
    catch (failure) { events.push("rollback"); throw failure; }
  }) } as unknown as DataDatabase;
  const handler = vi.fn(async (transaction: DataTransaction) => { expect(transaction).toBe(tx); events.push("handler"); return "result"; });
  return { database, tx, query, events, handler };
}

describe("batched data schema gate", () => {
  it("deduplicates ledger names and checks before the handler in the original transaction", async () => {
    const h = harness();
    expect(await withDataTransaction([required, second, { ...required }], h.handler, h.database)).toBe("result");
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(new PgDialect().sqlToQuery(h.query.mock.calls[0][0]).params).toEqual([required.capability, second.capability]);
    expect(h.events).toEqual(["begin", "ledger", "handler", "commit"]);
  });
  it.each([{ rows: [] }, { rows: [{ ...required, version: 2 }] }, { rows: [{ ...required, contractSha256: "c".repeat(64) }] }])("rejects missing or mismatched ledger rows %j", async ({ rows }) => {
    const h = harness(rows);
    await expect(withDataTransaction([required], h.handler, h.database)).rejects.toMatchObject({ code: "DREAM_DATA_SCHEMA_NOT_READY" });
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(h.handler).not.toHaveBeenCalled();
    expect(h.events).toEqual(["begin", "ledger", "rollback"]);
  });
  it.each([{ ...required, version: 2 }, { ...required, contractSha256: "c".repeat(64) }])("rejects conflicting complete requirements %j", async conflict => {
    const h = harness();
    await expect(withDataTransaction([required, conflict], h.handler, h.database)).rejects.toMatchObject({ code: "DREAM_DATA_SCHEMA_NOT_READY" });
    expect(h.query).not.toHaveBeenCalled();
    expect(h.handler).not.toHaveBeenCalled();
    expect(h.events).toEqual(["begin", "rollback"]);
  });
  it("propagates query failure without entering the handler", async () => {
    const failure = new Error("ledger unavailable");
    const h = harness([], failure);
    await expect(withDataTransaction([required], h.handler, h.database)).rejects.toBe(failure);
    expect(h.handler).not.toHaveBeenCalled();
    expect(h.events).toEqual(["begin", "ledger", "rollback"]);
  });
  it("skips ledger I/O for an empty requirement set", async () => {
    const h = harness();
    expect(await readSchemaCapabilities(h.tx, [])).toEqual(new Map());
    expect(await withDataTransaction([], h.handler, h.database)).toBe("result");
    expect(h.query).not.toHaveBeenCalled();
  });
  it("preserves the single-capability caller API with exact comparison", async () => {
    const h = harness([required]);
    expect(await hasSchemaCapability(h.tx, required)).toBe(true);
    expect(await hasSchemaCapability(h.tx, { ...required, version: 2 })).toBe(false);
    expect(await hasSchemaCapability(h.tx, second)).toBe(false);
  });
});
