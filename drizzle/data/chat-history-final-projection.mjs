#!/usr/bin/env node

// [Input] Admin-owned chat_message canonical parts/metadata and the exact 0043 capability.
// [Output] Dry-run or audited v1 final-text projection backfill with content-free aggregate receipt.
// [Pos] Explicit data migration runner for historical assistant rows; never runs from Admin or Dream startup.
// [Sync] 2026-09-02: create strict completed/legacy final projection backfill with target identity and advisory-lock guards.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

import { deriveChatHistoryFinalProjection } from "./chat-history-final-projection-contract.mjs";
import {
  CHAT_HISTORY_FINAL_PROJECTION_CAPABILITY,
  CHAT_HISTORY_FINAL_PROJECTION_KEY,
  recordChatHistoryFinalProjectionReceipt,
} from "./registry.mjs";

const adminRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
config({ path: resolve(adminRoot, ".env.local"), quiet: true });

const apply = process.argv.includes("--apply");
const allowedArguments = new Set(["--apply"]);
for (const argument of process.argv.slice(2)) {
  if (!allowedArguments.has(argument)) {
    throw new Error("Usage: node drizzle/data/chat-history-final-projection.mjs [--apply]");
  }
}

function positiveBatchSize() {
  const raw = process.env.INK_CHAT_HISTORY_PROJECTION_BATCH_SIZE ?? "100";
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("INK_CHAT_HISTORY_PROJECTION_BATCH_SIZE must be a positive safe integer");
  }
  return value;
}

function targetDatabaseUrl() {
  const useTestDatabase = process.env.INK_USE_TEST_DATABASE_URL === "1";
  const variableName = useTestDatabase ? "TEST_DATABASE_URL" : "DATABASE_URL";
  const raw = process.env[variableName];
  if (!raw) throw new Error(`${variableName} is required`);
  const parsed = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Chat history projection backfill requires PostgreSQL");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const testMarkers = new Set(databaseName.toLowerCase().split(/[^a-z0-9]+/));
  const safeTestName = ["codex", "test", "tests", "tmp", "temp", "ci", "sandbox"]
    .some((marker) => testMarkers.has(marker));
  if (!localHosts.has(parsed.hostname)
    || (useTestDatabase ? !safeTestName : databaseName !== "ink-memory")) {
    throw new Error("Chat history projection backfill rejected the database safety identity");
  }
  return raw;
}

const databaseUrl = targetDatabaseUrl();
const batchSize = positiveBatchSize();
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
let receipt;
try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [CHAT_HISTORY_FINAL_PROJECTION_KEY],
  );
  const capability = await client.query(
    `SELECT version, contract_sha256
       FROM drizzle.schema_capabilities
      WHERE capability = $1
      FOR SHARE`,
    [CHAT_HISTORY_FINAL_PROJECTION_CAPABILITY],
  );
  if (Number(capability.rows[0]?.version) !== 1
    || capability.rows[0]?.contract_sha256
      !== "50c27f86113c170064b0913bf052f9bd12884d3345c920d7b11468a768e0a432") {
    throw new Error("Apply exact Drizzle migration 0043 before the Chat history projection backfill");
  }

  const inventory = await client.query(
    `SELECT
       count(*)::int AS total_assistant_rows,
       count(*) FILTER (WHERE history_projection_version = 1)::int AS projected_rows
     FROM chat_message
     WHERE role = 'assistant'`,
  );
  const totalAssistantRows = Number(inventory.rows[0]?.total_assistant_rows ?? 0);
  const initiallyProjectedRows = Number(inventory.rows[0]?.projected_rows ?? 0);
  const fingerprint = createHash("sha256");
  let cursor = "";
  let projectableRows = 0;
  let fallbackRows = 0;
  let changedRows = 0;

  while (true) {
    const batch = await client.query(
      `SELECT id, parts, metadata, history_projection_version
         FROM chat_message
        WHERE role = 'assistant' AND id > $1
        ORDER BY id
        LIMIT $2`,
      [cursor, batchSize],
    );
    if (batch.rows.length === 0) break;
    for (const row of batch.rows) {
      cursor = String(row.id);
      fingerprint.update(cursor).update("\0");
      fingerprint.update(createHash("sha256").update(String(row.parts ?? "")).digest());
      fingerprint.update(createHash("sha256").update(String(row.metadata ?? "")).digest());
      if (Number(row.history_projection_version) === 1) continue;
      const projection = deriveChatHistoryFinalProjection(row.parts, row.metadata);
      if (!projection) {
        fallbackRows += 1;
        continue;
      }
      projectableRows += 1;
      if (!apply) continue;
      const updated = await client.query(
        `UPDATE chat_message
            SET history_final_text = $2,
                history_process_available = $3,
                history_projection_version = 1
          WHERE id = $1 AND history_projection_version IS NULL`,
        [row.id, projection.finalText, projection.processAvailable],
      );
      changedRows += updated.rowCount ?? 0;
    }
  }

  const verification = await client.query(
    `SELECT count(*)::int AS projected_rows
       FROM chat_message
      WHERE role = 'assistant' AND history_projection_version = 1`,
  );
  const projectedRows = apply
    ? Number(verification.rows[0]?.projected_rows ?? 0)
    : initiallyProjectedRows;
  const remainingProjectableRows = apply ? projectableRows - changedRows : projectableRows;
  receipt = {
    contract: "ink-admin-chat-history-final-projection-v1",
    mode: apply ? "applied" : "dry-run",
    projectionVersion: 1,
    totalAssistantRows,
    initiallyProjectedRows,
    projectableRows,
    changedRows: apply ? changedRows : projectableRows,
    projectedRows,
    fallbackRows,
    remainingProjectableRows,
    sourceFingerprintSha256: fingerprint.digest("hex"),
    redacted: true,
  };
  if (apply && remainingProjectableRows !== 0) {
    throw new Error("Chat history projection backfill left projectable rows behind");
  }
  if (apply) await client.query("COMMIT");
  else await client.query("ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

const registry = apply
  ? await recordChatHistoryFinalProjectionReceipt(databaseUrl, receipt)
  : null;
console.log(JSON.stringify({ ...receipt, registry }));
