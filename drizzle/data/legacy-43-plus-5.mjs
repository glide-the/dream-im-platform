#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { recordLegacyReceipt } from "./registry.mjs";

const adminRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
config({ path: resolve(adminRoot, ".env.local"), quiet: true });

const { values } = parseArgs({
  options: {
    "main-sqlite": { type: "string" },
    "notion-sqlite": { type: "string" },
    mode: { type: "string", default: "source-dry-run" },
    "expected-target-database": { type: "string" },
    "expected-target-host": { type: "string" },
    "expected-target-port": { type: "string" },
    "expected-target-owner": { type: "string" },
    "target-approval": { type: "string" },
    "approve-baseline-inserts": { type: "boolean", default: false },
    "accept-post-cutover-changes": { type: "boolean", default: false },
    record: { type: "boolean", default: false },
    "full-receipt": { type: "boolean", default: false },
  },
  strict: true,
});

const supportedModes = new Set([
  "source-dry-run",
  "target-dry-run",
  "execute",
  "verify-existing",
  "production-execute",
]);
if (!supportedModes.has(values.mode)) throw new Error("Unsupported Dream data migration mode");
if (!values["main-sqlite"] || !values["notion-sqlite"]
  || !isAbsolute(values["main-sqlite"]) || !isAbsolute(values["notion-sqlite"])) {
  throw new Error("Absolute --main-sqlite and --notion-sqlite paths are required");
}
if (values.record && !new Set([
  "execute", "verify-existing", "production-execute",
]).has(values.mode)) {
  throw new Error("--record is allowed only for committed or adoption modes");
}

const dreamRoot = process.env.INK_DREAM_ROOT
  ? resolve(process.env.INK_DREAM_ROOT)
  : resolve(adminRoot, "../ink-dream-memory");
const python = process.env.INK_DREAM_MIGRATION_PYTHON
  ?? resolve(dreamRoot, "backend/.venv/bin/python");
const migrationScript = resolve(
  dreamRoot,
  "backend/script/migrate_legacy_to_postgres.py",
);
if (!existsSync(python) || !existsSync(migrationScript)) {
  throw new Error("Dream migration runtime is not available");
}

const args = [
  migrationScript,
  "--main-sqlite", values["main-sqlite"],
  "--notion-sqlite", values["notion-sqlite"],
];
const modeFlag = {
  "target-dry-run": "--target-dry-run",
  execute: "--execute",
  "verify-existing": "--verify-existing",
  "production-execute": "--production-execute",
}[values.mode];
if (modeFlag) args.push(modeFlag);
for (const [option, flag] of [
  ["expected-target-database", "--expected-target-database"],
  ["expected-target-host", "--expected-target-host"],
  ["expected-target-port", "--expected-target-port"],
  ["expected-target-owner", "--expected-target-owner"],
  ["target-approval", "--production-approval"],
]) {
  if (values[option]) args.push(flag, values[option]);
}
if (values["approve-baseline-inserts"]) args.push("--approve-baseline-inserts");
if (values["accept-post-cutover-changes"]) args.push("--accept-post-cutover-changes");

const run = spawnSync(python, args, {
  cwd: resolve(dreamRoot, "backend"),
  env: process.env,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
if (run.status !== 0) {
  process.stderr.write(run.stderr.trim());
  process.stderr.write("\n");
  process.exit(run.status ?? 2);
}
const receipt = JSON.parse(run.stdout);
let registry = null;
if (values.record) {
  const databaseUrl = values.mode === "execute"
    ? process.env.TEST_DATABASE_URL
    : process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Target database URL is required to record the run");
  registry = await recordLegacyReceipt(databaseUrl, receipt);
}

const output = values["full-receipt"]
  ? { receipt, registry }
  : {
      contract: receipt.contract,
      status: receipt.status,
      mode: receipt.mode,
      runId: receipt.runId,
      manifestSha256: receipt.manifestSha256,
      tables: receipt.validation.tables,
      sourceRows: receipt.validation.sourceRows,
      insertedRows: receipt.target.insertedRows ?? 0,
      verifiedSourcePrimaryKeys: receipt.target.verifiedSourcePrimaryKeys ?? null,
      exactMatchedRows: receipt.target.exactMatchedRows ?? null,
      postCutoverChangedRows: receipt.target.postCutoverChangedRows ?? 0,
      targetExtraRows: receipt.target.targetExtraRows ?? 0,
      targetTransaction: receipt.target.transaction,
      registry,
      redacted: true,
    };
console.log(JSON.stringify(output));
