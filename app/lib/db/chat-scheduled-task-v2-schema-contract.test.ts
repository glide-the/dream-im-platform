// [Input] Reviewed scheduled-task v2 capability JSON and forward Drizzle migrations 0075/0076.
// [Output] Exact canonical digest plus interval, Editor target and unknown-recheck DDL evidence.
// [Pos] Provider-free schema publication gate for Dream's v2 scheduled-task consumer.
// [Sync] 2026-10-07: publish capability only after interval columns and scheduled Editor-grant authority are both installed.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import contract from "../../../drizzle/contracts/dream-chat-scheduled-task-v2.json";
import { canonicalContractJson } from "../dream/canonicalContractJson";

it("publishes the exact scheduled-task v2 schema capability", () => {
  const { contract_sha256: digest, ...body } = contract;
  expect(createHash("sha256").update(canonicalContractJson(body)).digest("hex")).toBe(digest);
  const definitionMigration = readFileSync(new URL("../../../drizzle/0075_cute_bucky.sql", import.meta.url), "utf8");
  const publicationMigration = readFileSync(new URL("../../../drizzle/0076_concerned_reptil.sql", import.meta.url), "utf8");
  expect(definitionMigration).toContain('ADD COLUMN "interval_minutes" integer');
  expect(definitionMigration).toContain('ADD COLUMN "target_editor_session_id" text');
  expect(definitionMigration).toContain('ADD COLUMN "target_editor_session_id_snapshot" text');
  expect(definitionMigration).toContain('ADD COLUMN "unknown_recheck_at" timestamp with time zone');
  expect(definitionMigration).toContain("schedule_kind IN ('once','daily','interval')");
  expect(definitionMigration).not.toContain(contract.capability);
  expect(publicationMigration).toContain("'editor-stdio'");
  expect(publicationMigration).toContain(contract.capability);
  expect(publicationMigration).toContain(digest);
});
