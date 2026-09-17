#!/usr/bin/env tsx

// [Input] Private owner-only adoption config, explicit migration DSN and inspect/dry-run/approved-apply mode.
// [Output] Redacted target-bound receipt for one exact legacy Google-to-Dream subject adoption.
// [Pos] Release operator entry point; never invoked by application startup or exposed as a generic data API.
// [Sync] 2026-09-16: command-mode failures pass through the same fixed redacted JSON boundary as database failures.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { assertAuthCapability, type AuthRepositoryDatabase } from "../app/lib/auth/database";
import {
  legacyGoogleAdoptionConfigDto,
  legacyGoogleInspectionConfigDto,
  type LegacyGoogleAdoptionTarget,
} from "../app/lib/auth/legacyGoogleAdoptionDto";
import { DrizzleLegacyGoogleAdoptionRepository } from "../app/lib/auth/legacyGoogleAdoptionRepository";
import { LegacyGoogleAdoptionService } from "../app/lib/auth/legacyGoogleAdoptionService";

function commandMode(arguments_: string[]) {
  const allowed = new Set(["--inspect", "--apply", "--production-approval"]);
  if (arguments_.some(argument => !allowed.has(argument)) || new Set(arguments_).size !== arguments_.length) {
    throw new Error("LEGACY_GOOGLE_ARGUMENTS_INVALID");
  }
  const inspect = arguments_.includes("--inspect");
  const apply = arguments_.includes("--apply");
  const approved = arguments_.includes("--production-approval");
  if (inspect && (apply || approved) || apply !== approved) throw new Error("LEGACY_GOOGLE_ARGUMENTS_INVALID");
  return { inspect, apply };
}

async function readPrivateConfig(path: string | undefined) {
  if (!path) throw new Error("LEGACY_GOOGLE_PRIVATE_CONFIG_REQUIRED");
  const info = await stat(path);
  if ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error("LEGACY_GOOGLE_PRIVATE_CONFIG_REQUIRED");
  return readFile(path, "utf8");
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z0-9_]+$/.test(message) ? message : "LEGACY_GOOGLE_ADOPTION_FAILED";
}

async function assertTarget(
  database: AuthRepositoryDatabase,
  expected: LegacyGoogleAdoptionTarget,
) {
  const result = await database.execute<{ database: string; port: number; dataDirectory: string }>(sql`
    SELECT current_database() AS database,
           current_setting('port')::int AS port,
           current_setting('data_directory') AS "dataDirectory"
  `);
  const actual = result.rows[0];
  if (!actual || actual.database !== expected.database || actual.port !== expected.port || actual.dataDirectory !== expected.data_directory) {
    throw new Error("LEGACY_GOOGLE_TARGET_MISMATCH");
  }
}

let pool: Pool | undefined;
try {
  const { inspect, apply } = commandMode(process.argv.slice(2));
  loadDotenv({ path: resolve(process.cwd(), ".env.local"), quiet: true });
  const rawConfig = await readPrivateConfig(process.env.AUTH_LEGACY_GOOGLE_ADOPTION_CONFIG);
  let json: unknown;
  try { json = JSON.parse(rawConfig); } catch { throw new Error("LEGACY_GOOGLE_CONFIG_INVALID"); }
  const config = inspect ? legacyGoogleInspectionConfigDto.parse(json) : legacyGoogleAdoptionConfigDto.parse(json);
  const dsnText = process.env.MIGRATION_DATABASE_URL;
  if (!dsnText) throw new Error("LEGACY_GOOGLE_MIGRATION_DSN_REQUIRED");
  let dsn: URL;
  try { dsn = new URL(dsnText); } catch { throw new Error("LEGACY_GOOGLE_MIGRATION_DSN_REQUIRED"); }
  if (!["postgres:", "postgresql:"].includes(dsn.protocol) || !dsn.username || decodeURIComponent(dsn.pathname.slice(1)) !== config.target.database) {
    throw new Error("LEGACY_GOOGLE_MIGRATION_DSN_REQUIRED");
  }
  pool = new Pool({ connectionString: dsnText, max: 1 });
  const database = drizzle(pool);
  const manifestSha256 = createHash("sha256").update(rawConfig).digest("hex");
  const receipt = await database.transaction(async tx => {
    await assertTarget(tx, config.target);
    await assertAuthCapability(tx);
    const service = new LegacyGoogleAdoptionService(new DrizzleLegacyGoogleAdoptionRepository(tx));
    return inspect ? service.inspect(config.entry) : service.adopt(config.entry, { apply, manifestSha256 });
  });
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: safeError(error), redacted: true }));
  process.exitCode = 1;
} finally {
  await pool?.end();
}
