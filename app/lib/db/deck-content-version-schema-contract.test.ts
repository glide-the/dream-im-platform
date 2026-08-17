// [Input] Admin Drizzle Dream schema and forward Deck content-version migration.
// [Output] Prove the aggregate draft columns, append-only commit table, and capability receipt stay declared.
// [Pos] Shared PostgreSQL Deck version schema contract test.
// [Sync] 2026-08-16: add dream.deck-content-versions.v1 expand contract.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { decks, deck_versions } from "./schema/dream";

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0036_amused_the_executioner.sql"),
  "utf8",
);

describe("Deck content version schema capability", () => {
  it("declares one aggregate draft revision and immutable commit relation", () => {
    expect(getTableName(deck_versions)).toBe("deck_versions");
    expect(Object.keys(getTableColumns(decks))).toEqual(
      expect.arrayContaining([
        "draft_revision",
        "latest_version",
        "published_draft_revision",
      ]),
    );
    expect(Object.keys(getTableColumns(deck_versions))).toEqual(
      expect.arrayContaining([
        "deck_id",
        "version",
        "source_draft_revision",
        "snapshot_json",
        "content_hash",
      ]),
    );
  });

  it("publishes the capability only after both append-only triggers", () => {
    const updateTrigger = migration.indexOf("deck_versions_no_update");
    const deleteTrigger = migration.indexOf("deck_versions_no_delete");
    const capability = migration.indexOf("dream.deck-content-versions.v1");
    expect(updateTrigger).toBeGreaterThan(0);
    expect(deleteTrigger).toBeGreaterThan(updateTrigger);
    expect(capability).toBeGreaterThan(deleteTrigger);
    expect(migration).toContain("DECK_CONTENT_VERSION_IMMUTABLE");
    expect(migration).toContain("ca7ad5914895d6aa9e8c7d576b9af3ed65b44f34318e068d2fc10c90e351e4c3");
  });
});
