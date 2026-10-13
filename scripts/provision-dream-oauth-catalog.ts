#!/usr/bin/env tsx

// [Input] Private Admin env, exact identity capability and optional explicit --apply.
// [Output] Redacted dry-run/apply receipt for the Dream resource, public clients and confidential service clients.
// [Pos] Release operator entry point; default execution never mutates the auth catalog.
// [Sync] 2026-09-17: reconcile client_credentials service registrations without emitting client secrets.
// [Sync] 2026-10-11: permit an existing-client callback-only release with drift checks and full-row readback.
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { closeAuthDatabaseConnections, withAuthTransaction } from "../app/lib/auth/database";
import { provisionDreamOAuthCatalog, provisionDreamBrowserRedirects } from "../app/lib/auth/oauthClientCatalog";

const arguments_ = process.argv.slice(2);
if (arguments_.some(argument => !["--apply", "--browser-redirects"].includes(argument))
  || new Set(arguments_).size !== arguments_.length) {
  throw new Error("Usage: pnpm auth:provision-dream-oauth [--browser-redirects] [--apply]");
}
loadDotenv({ path: resolve(process.cwd(), ".env.local"), quiet: true });

try {
  const receipt = arguments_.includes("--browser-redirects")
    ? await withAuthTransaction(tx => provisionDreamBrowserRedirects(tx, arguments_.includes("--apply")))
    : await withAuthTransaction(tx => provisionDreamOAuthCatalog(tx, arguments_.includes("--apply")));
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  await closeAuthDatabaseConnections();
}
