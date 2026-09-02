// [Input] Admin Drizzle chat_message declaration, 0042 migration, snapshot, and journal.
// [Output] Exact stable keyset index and capability-publication evidence for Dream Chat history.
// [Pos] Provider-free schema contract for dream.chat-history-keyset-pagination.v1.
// [Sync] 2026-09-02: created for the additive Chat history pagination capability.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0042_chat_history_keyset_pagination.sql"),
  "utf8",
);
const snapshot = JSON.parse(readFileSync(
  resolve(process.cwd(), "drizzle/meta/0042_snapshot.json"),
  "utf8",
));
const journal = JSON.parse(readFileSync(
  resolve(process.cwd(), "drizzle/meta/_journal.json"),
  "utf8",
));

const capability = "dream.chat-history-keyset-pagination.v1";
const contractLines = [
  `capability|${capability}`,
  "version|1",
  "table|public.chat_message",
  "index|idx_chat_message_thread_created_id_desc:btree",
  "keys|thread_id:asc:nulls-last:text_ops,created_at:desc:nulls-last:timestamptz_ops,id:desc:nulls-last:text_ops",
  "query|thread_id:eq,order:created_at-desc-nulls-last-id-desc,keyset:before-created-at-and-id",
];
const contractSha256 = createHash("sha256")
  .update(contractLines.join("\n"))
  .digest("hex");
const expectedContractSha256 =
  "a0dfe5f8d4b4330a9e17db07a8716d5d2bc25e291f3624f09005e79c01fc8ab0";

describe("Chat history keyset pagination schema capability", () => {
  it("declares the exact stable ordering index without copying message JSON", () => {
    const table = snapshot.tables["public.chat_message"];
    const index = table.indexes.idx_chat_message_thread_created_id_desc;

    expect(index).toMatchObject({
      isUnique: false,
      concurrently: false,
      method: "btree",
    });
    expect(index.columns).toEqual([
      {
        expression: "thread_id",
        isExpression: false,
        asc: true,
        nulls: "last",
        opclass: "text_ops",
      },
      {
        expression: "created_at",
        isExpression: false,
        asc: false,
        nulls: "last",
        opclass: "timestamptz_ops",
      },
      {
        expression: "id",
        isExpression: false,
        asc: false,
        nulls: "last",
        opclass: "text_ops",
      },
    ]);
    expect(migration).not.toMatch(/\bINCLUDE\s*\([^)]*(parts|metadata)/i);
  });

  it("keeps 0042 additive and publishes the exact capability after the index", () => {
    expect(contractSha256).toBe(expectedContractSha256);
    expect(migration).toContain(
      '"created_at" DESC NULLS LAST,\n    "id" DESC NULLS LAST',
    );
    expect(migration).toContain(`'${capability}'`);
    expect(migration).toContain(`'${contractSha256}'`);
    expect(migration).toContain("'admin-drizzle-0042'");
    expect(migration).toContain('"covering":false');
    expect(migration).not.toMatch(/\b(DROP|TRUNCATE|ALTER\s+COLUMN|CREATE\s+TRIGGER)\b/i);
    expect(migration.lastIndexOf(capability))
      .toBeGreaterThan(migration.lastIndexOf("CREATE INDEX"));
    expect(
      journal.entries.find(
        (entry: { tag?: string }) => entry.tag === "0042_chat_history_keyset_pagination",
      ),
    ).toMatchObject({
      idx: 42,
      tag: "0042_chat_history_keyset_pagination",
      version: "7",
    });
  });
});
