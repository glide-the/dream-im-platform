// [Input] Forward 0068 SQL/snapshot/journal and the published task-result capability descriptor.
// [Output] Exact additive relation, source-claim guards and capability publication evidence.
// [Pos] Provider-free migration contract test; isolated PostgreSQL proves execution separately.
// [Sync] 2026-09-27: protect result uniqueness, source input and dual claim authorization.
// [Sync] 2026-10-05: bind the immutable capability migration by its journal index while allowing forward migrations.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { chat_task_result, chat_task_session } from "@ink-memory/db/schema/dream";
import contract from "../../../drizzle/contracts/dream-chat-task-result-v1.json";

const root = process.cwd();
const migration = readFileSync(resolve(root, "drizzle/0068_cool_psylocke.sql"), "utf8");
const snapshot = JSON.parse(readFileSync(resolve(root, "drizzle/meta/0068_snapshot.json"), "utf8"));
const journal = JSON.parse(readFileSync(resolve(root, "drizzle/meta/_journal.json"), "utf8"));

describe("Chat task result physical capability", () => {
  it("binds one target turn, one source input and one active source dispatch", () => {
    expect(Object.keys(getTableColumns(chat_task_result))).toEqual([
      "id", "task_id", "target_turn_id", "target_final_message_id", "source_thread_id",
      "status", "revision", "claim_id", "claim_request_key", "source_turn_id", "source_input_message_id",
      "source_final_message_id", "error_code", "created_at", "updated_at",
    ]);
    expect(getTableColumns(chat_task_session).return_result).toBeDefined();
    const table = snapshot.tables["public.chat_task_result"];
    expect(table.uniqueConstraints.uq_chat_task_result_task_turn).toBeDefined();
    expect(table.uniqueConstraints.uq_chat_task_result_source_turn).toBeDefined();
    expect(table.uniqueConstraints.uq_chat_task_result_source_input).toBeDefined();
    expect(table.uniqueConstraints.uq_chat_task_result_claim_request).toBeDefined();
    expect(table.indexes.uq_chat_task_result_source_dispatching).toBeDefined();
    expect(table.foreignKeys.fk_chat_task_result_target_message).toBeDefined();
    expect(table.foreignKeys.fk_chat_task_result_source_input).toBeDefined();
    expect(table.checkConstraints.ck_chat_task_result_claim.value).toContain("source_input_message_id IS NOT NULL");
    expect(snapshot.tables["identity.runtime_delegations"].indexes.runtime_delegations_task_result_claim_uidx).toBeDefined();
  });

  it("publishes the exact capability after all DDL and limits task-return grants", () => {
    const { contract_sha256: hash, ...claim } = contract;
    expect(createHash("sha256").update(JSON.stringify(Object.fromEntries(Object.entries(claim).sort(([a], [b]) => a.localeCompare(b))))).digest("hex")).toBe(hash);
    expect(migration).toContain(`'${hash}'`);
    expect(migration.lastIndexOf("dream.chat-task-result.v1")).toBeGreaterThan(migration.lastIndexOf("CREATE UNIQUE INDEX"));
    expect(migration).toContain("'task-result-claim'");
    expect(migration).toContain("'server-persistence'");
    expect(migration).toContain("'gateway-cli'");
    expect(journal.entries.find((entry: { idx: number }) => entry.idx === 68)).toMatchObject({ idx: 68, tag: "0068_cool_psylocke" });
  });
});
