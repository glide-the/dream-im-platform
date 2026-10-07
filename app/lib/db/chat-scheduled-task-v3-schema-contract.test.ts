// [Input] Reviewed scheduled-task v3 capability JSON and forward Drizzle migration 0077.
// [Output] Exact digest plus recurrence, thread-mode, model-snapshot and source-admission DDL evidence.
// [Pos] Provider-free schema publication gate for Dream's v3 scheduled-task consumer.
// [Sync] 2026-10-07: publish v3 only with canonical recurrence and bounded source/new-thread execution columns.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import contract from "../../../drizzle/contracts/dream-chat-scheduled-task-v3.json";
import { canonicalContractJson } from "../dream/canonicalContractJson";

it("publishes the exact scheduled-task v3 schema capability", () => {
  const { contract_sha256: digest, ...body } = contract;
  expect(createHash("sha256").update(canonicalContractJson(body)).digest("hex")).toBe(digest);
  const migration = readFileSync(new URL("../../../drizzle/0077_tiny_joshua_kane.sql", import.meta.url), "utf8");
  expect(migration).toContain('ADD COLUMN "rrule" text');
  expect(migration).toContain('ADD COLUMN "run_thread_mode" text');
  expect(migration).toContain('ADD COLUMN "model_alias" text');
  expect(migration).toContain('ADD COLUMN "run_thread_mode_snapshot" text');
  expect(migration).toContain('ADD COLUMN "model_alias_snapshot" text');
  expect(migration).toContain('DROP CONSTRAINT "uq_chat_scheduled_trigger_target_thread"');
  expect(migration).toContain('CREATE UNIQUE INDEX "uq_chat_scheduled_trigger_source_thread_open"');
  expect(migration).toContain("status IN ('claimed','queued','running','state_unknown')");
  expect(migration).toContain(contract.capability);
  expect(migration).toContain(digest);
});
