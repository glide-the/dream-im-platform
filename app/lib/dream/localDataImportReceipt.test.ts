// [Input] Identical, changed and concurrent Registry101 writes at the production ReceiptRepository boundary.
// [Output] One mutation/audit for duplicates, stable replay and changed-input conflict evidence.
// [Pos] Deterministic receipt gate; unknown final COMMIT is recovered by the separately tested GET route.
// [Sync] 2026-09-15: prove aggregate inserts are never repeated for the same committed request ID.
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { adminAuditLogs } from "@ink-memory/db/schema";
import { operationReceipts } from "@ink-memory/db/schema/auth";
import type { DataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";

const output = z.strictObject({ success: z.literal(true), imported: z.strictObject({ sessions: z.number(), pictures: z.number(), preferences: z.number(), reports: z.number() }) });
type StoredReceipt = { inputSha256: string; result: unknown };

function receiptTx() {
  let stored: StoredReceipt | null = null, auditCount = 0, locked = false;
  const waiters: (() => void)[] = [];
  const acquire = async () => {
    if (!locked) { locked = true; return; }
    await new Promise<void>(resolve => waiters.push(resolve));
  };
  const release = () => { const next = waiters.shift(); if (next) next(); else locked = false; };
  const tx = {
    execute: acquire,
    select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => {
      if (table !== operationReceipts || !stored) return [];
      const result = [{ inputSha256: stored.inputSha256, result: stored.result }];
      release();
      return result;
    } }) }) }),
    insert: (table: unknown) => {
      const chain: Record<string, unknown> & PromiseLike<unknown> = {
        values(value: unknown) {
          if (table === operationReceipts) {
            const row = value as { inputSha256: string; result: unknown };
            stored = { inputSha256: row.inputSha256, result: row.result };
          } else if (table === adminAuditLogs) { auditCount++; release(); }
          return chain;
        },
        then(resolve, reject) { return Promise.resolve(undefined).then(resolve, reject); },
      };
      return chain;
    },
  } as unknown as DataTransaction;
  return { tx, auditCount: () => auditCount };
}

const input = { sessions: [], pictures: [], preferences: null, reports: [] };
const result = { success: true as const, imported: { sessions: 0, pictures: 0, preferences: 0, reports: 0 } };

it("replays an identical committed aggregate without invoking its mutation again", async () => {
  const state = receiptTx(), store = new ReceiptRepository(state.tx, "service", "subject"), action = vi.fn().mockResolvedValue(result);
  expect(await store.execute("local-data.import", "request", input, output, action)).toEqual(result);
  expect(await store.execute("local-data.import", "request", input, output, action)).toEqual(result);
  expect(action).toHaveBeenCalledTimes(1); expect(state.auditCount()).toBe(1);
});

it("serializes concurrent identical requests to one aggregate mutation", async () => {
  const state = receiptTx(), store = new ReceiptRepository(state.tx, "service", "subject"), action = vi.fn(async () => { await Promise.resolve(); return result; });
  expect(await Promise.all([
    store.execute("local-data.import", "request", input, output, action),
    store.execute("local-data.import", "request", input, output, action),
  ])).toEqual([result, result]);
  expect(action).toHaveBeenCalledTimes(1); expect(state.auditCount()).toBe(1);
});

it("rejects a changed payload for the same request before another aggregate mutation", async () => {
  const state = receiptTx(), store = new ReceiptRepository(state.tx, "service", "subject"), action = vi.fn().mockResolvedValue(result);
  await store.execute("local-data.import", "request", input, output, action);
  await expect(store.execute("local-data.import", "request", { ...input, pictures: [{ date: "2026-09-15" }] }, output, action)).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 });
  expect(action).toHaveBeenCalledTimes(1); expect(state.auditCount()).toBe(1);
});
