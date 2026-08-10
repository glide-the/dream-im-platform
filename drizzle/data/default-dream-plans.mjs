#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { recordPlanSeedReceipt } from "./registry.mjs";

const adminRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
config({ path: resolve(adminRoot, ".env.local"), quiet: true });
const apply = process.argv.includes("--apply");
const seedScript = resolve(adminRoot, "scripts/seed-default-dream-plans.mjs");
const run = spawnSync(process.execPath, apply ? [seedScript, "--apply"] : [seedScript], {
  cwd: adminRoot,
  env: process.env,
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
});
if (run.status !== 0) {
  process.stderr.write(run.stderr.trim());
  process.stderr.write("\n");
  process.exit(run.status ?? 2);
}
const receipt = JSON.parse(run.stdout);
const databaseUrl = process.env.INK_USE_TEST_DATABASE_URL === "1"
  ? process.env.TEST_DATABASE_URL
  : process.env.DATABASE_URL;
const registry = apply
  ? await recordPlanSeedReceipt(databaseUrl, receipt)
  : null;
console.log(JSON.stringify({
  contract: "ink-admin-default-dream-plans-v1",
  ...receipt,
  registry,
  redacted: true,
}));
