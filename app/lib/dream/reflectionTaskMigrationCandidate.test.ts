// [Input] Generated 0061 snapshot, customized forward SQL and exact Reflections schema descriptor.
// [Output] Snapshot parity, contract digest, event lock/backfill order and capability publication evidence.
// [Pos] Static migration review gate; no PostgreSQL connection or migration execution.
// [Sync] 2026-09-15: bind the capability digest to int4 event bounds and locked gap-free append semantics.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import contract from "../../../drizzle/contracts/dream-reflection-task-persistence-v1.json";
import snapshot from "../../../drizzle/meta/0061_snapshot.json";
import { canonicalContractJson } from "./operationRegistry";

it("binds the exact final snapshot and publishes event constraints only after locked resequencing", () => {
  const tableNames = ["public.analysis_reports", "public.reflection_task", "public.reflection_task_section", "public.reflection_task_event", "dream.reflection_task_authorities"] as const;
  const { contract_sha256: digest, ...body } = contract;
  expect(createHash("sha256").update(canonicalContractJson(body)).digest("hex")).toBe(digest);
  for (const name of tableNames) expect(contract.tables[name]).toEqual(snapshot.tables[name]);
  expect(contract.tables["public.reflection_task"].columns).toHaveProperty("auth_user_id");
  expect(contract.tables["dream.reflection_task_authorities"].columns).toHaveProperty("token_ciphertext");
  expect(contract.tables["public.reflection_task_event"].columns.sequence.type).toBe("integer");
  expect(contract.semantics.event_identity).toContain("1..2147483647");
  expect(contract.semantics.event_append).toContain("current task max+1");

  const sql = readFileSync("drizzle/0061_outstanding_maverick.sql", "utf8");
  const lock = sql.indexOf('LOCK TABLE "reflection_task_event" IN SHARE ROW EXCLUSIVE MODE');
  const resequence = sql.indexOf("WITH ranked AS");
  const order = sql.indexOf('ORDER BY event."created_at" ASC NULLS LAST, event."id" ASC');
  const notNull = sql.indexOf('ALTER TABLE "reflection_task_event" ALTER COLUMN "sequence" SET NOT NULL');
  const positive = sql.indexOf('ADD CONSTRAINT "ck_reflection_task_event_sequence"');
  const capability = sql.indexOf("INSERT INTO drizzle.schema_capabilities");
  expect(lock).toBeGreaterThan(0); expect(lock).toBeLessThan(resequence); expect(resequence).toBeLessThan(order); expect(order).toBeLessThan(notNull);
  expect(notNull).toBeLessThan(positive); expect(positive).toBeLessThan(capability); expect(sql).toContain(digest);
});
