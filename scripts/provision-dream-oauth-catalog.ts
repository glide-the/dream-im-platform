#!/usr/bin/env tsx

// [Input] Private Admin env, exact identity capability and optional explicit --apply.
// [Output] Redacted dry-run/apply receipt for the configured Dream OAuth resource and public clients.
// [Pos] Release operator entry point; default execution never mutates the auth catalog.
// [Sync] 2026-09-16: add bounded DTO/Drizzle OAuth client provisioning.
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { closeAuthDatabaseConnections, withAuthTransaction } from "../app/lib/auth/database";
import { provisionDreamOAuthCatalog } from "../app/lib/auth/oauthClientCatalog";

const arguments_ = process.argv.slice(2);
if (arguments_.some(argument => argument !== "--apply") || arguments_.filter(argument => argument === "--apply").length > 1) {
  throw new Error("Usage: pnpm auth:provision-dream-oauth [--apply]");
}
loadDotenv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

try {
  const receipt = await withAuthTransaction(tx => provisionDreamOAuthCatalog(tx, arguments_.includes("--apply")));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await closeAuthDatabaseConnections();
}
