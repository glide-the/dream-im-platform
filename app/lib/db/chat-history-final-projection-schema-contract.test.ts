// [Input] Admin Drizzle 0043 migration/snapshot/journal and pure historical projection rule.
// [Output] Provider-free evidence for the exact final-only list/detail capability and conservative backfill.
// [Pos] Schema/data contract test for dream.chat-history-final-projection.v1.
// [Sync] 2026-09-02: cover additive projection columns, capability ordering, runner safety, and strict final selection.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deriveChatHistoryFinalProjection,
  strictCompletedAssistantFinalIndex,
} from "../../../drizzle/data/chat-history-final-projection-contract.mjs";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0043_chat_history_final_projection.sql"),
  "utf8",
);
const runner = readFileSync(
  resolve(process.cwd(), "drizzle/data/chat-history-final-projection.mjs"),
  "utf8",
);
const snapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), "drizzle/meta/0043_snapshot.json"),
  "utf8",
));
const journal = JSON.parse(readFileSync(
  resolve(process.cwd(), "drizzle/meta/_journal.json"),
  "utf8",
));
const dataJournal = JSON.parse(readFileSync(
  resolve(process.cwd(), "drizzle/data/_journal.json"),
  "utf8",
));

const capability = "dream.chat-history-final-projection.v1";
const contractLines = [
  `capability|${capability}`,
  "version|1",
  "table|public.chat_message",
  "columns|history_final_text:text:null,history_process_available:boolean:not-null:default-false,history_projection_version:integer:null",
  "row|version=1:assistant:nonblank-final:process-boolean",
  "read|paged-assistant-final,detail-by-thread-and-message",
  "backfill|drizzle/data/chat-history-final-projection.mjs",
];
const contractSha256 = createHash("sha256")
  .update(contractLines.join("\n"))
  .digest("hex");
const expectedContractSha256 =
  "50c27f86113c170064b0913bf052f9bd12884d3345c920d7b11468a768e0a432";

describe("Chat history final projection schema capability", () => {
  it("adds only the lightweight projection while preserving canonical parts", () => {
    const table = snapshot.tables["public.chat_message"];
    expect(table.columns.history_final_text).toMatchObject({
      type: "text",
      notNull: false,
    });
    expect(table.columns.history_process_available).toMatchObject({
      type: "boolean",
      notNull: true,
      default: false,
    });
    expect(table.columns.history_projection_version).toMatchObject({
      type: "integer",
      notNull: false,
    });
    expect(table.columns.parts).toMatchObject({ type: "text", notNull: true });
    expect(table.checkConstraints.ck_chat_message_history_projection_v1.value)
      .toContain("history_projection_version = 1");
    expect(table.checkConstraints.ck_chat_message_history_projection_v1.value)
      .toContain("role = 'assistant'");
  });

  it("keeps 0043 additive and publishes the exact capability after DDL", () => {
    expect(contractSha256).toBe(expectedContractSha256);
    expect(migration).toContain(`'${capability}'`);
    expect(migration).toContain(`'${contractSha256}'`);
    expect(migration).toContain("'admin-drizzle-0043'");
    expect(migration).toContain("'chat-history-final-projection-v1'");
    expect(migration).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP\s+COLUMN|ALTER\s+COLUMN)\b/i);
    expect(migration.lastIndexOf(capability))
      .toBeGreaterThan(migration.lastIndexOf("ADD CONSTRAINT"));
    expect(journal.entries.find((entry: { tag?: string }) => (
      entry.tag === "0043_chat_history_final_projection"
    ))).toMatchObject({ idx: 43, version: "7" });
    expect(dataJournal.entries.find((entry: { migrationKey?: string }) => (
      entry.migrationKey === "chat-history-final-projection-v1"
    ))).toMatchObject({
      idx: 4,
      runner: "chat-history-final-projection.mjs",
    });
  });

  it("keeps the explicit backfill dry-run by default and content-redacted", () => {
    expect(runner).toContain('const apply = process.argv.includes("--apply")');
    expect(runner).toContain('process.env.INK_USE_TEST_DATABASE_URL === "1"');
    expect(runner).toContain('databaseName !== "ink-memory"');
    expect(runner).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(runner).toContain("pg_advisory_xact_lock");
    expect(runner).toContain("ROLLBACK");
    expect(runner).not.toMatch(/console\.log\([^\n]*(row\.id|finalText|databaseUrl)/);
  });
});

describe("Chat history final projection rule", () => {
  const final = { type: "text", text: "Visible answer" };
  const process = [
    { type: "reasoning", text: "private process" },
    { type: "tool-invocation", toolInvocation: { state: "result" } },
  ];

  it("selects exactly one final text after process parts", () => {
    expect(strictCompletedAssistantFinalIndex([...process, final])).toBe(2);
    expect(deriveChatHistoryFinalProjection(
      JSON.stringify([...process, final]),
      JSON.stringify({
        turnId: "turn-1",
        turnStatus: "completed",
        finalPartIndex: 2,
      }),
    )).toEqual({ finalText: "Visible answer", processAvailable: true });
    expect(deriveChatHistoryFinalProjection([final], {})).toEqual({
      finalText: "Visible answer",
      processAvailable: false,
    });
  });

  it("fails closed for partial, malformed, or ambiguous histories", () => {
    expect(deriveChatHistoryFinalProjection([...process, final], { is_partial: true }))
      .toBeNull();
    expect(deriveChatHistoryFinalProjection([...process, final], {
      turnId: "turn-1",
      turnStatus: "completed",
      finalPartIndex: 1,
    })).toBeNull();
    expect(deriveChatHistoryFinalProjection([
      { type: "text", text: "before" },
      final,
    ], {})).toBeNull();
    expect(deriveChatHistoryFinalProjection([
      ...process,
      { type: "unsupported" },
      final,
    ], {})).toBeNull();
    expect(deriveChatHistoryFinalProjection("not-json", null)).toBeNull();
  });
});
