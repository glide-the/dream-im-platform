#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.argv.includes("--apply")) {
  throw new Error("Refusing to update local private environments without --apply");
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const adminRoot = resolve(scriptDirectory, "..");
const dreamRoot = resolve(adminRoot, "../ink-dream-memory");
const adminEnvPath = resolve(adminRoot, ".env.local");
const dreamEnvPath = resolve(dreamRoot, "backend/.env");
const issuer = "ink-dream-memory";
const audience = "ink-memory-product-api";
const clientId = "ink-dream-memory";
const requestOrigin = "http://127.0.0.1:5173";
const sharedSecret = randomBytes(32).toString("base64url");

function encodeEnvValue(value) {
  if (/^[A-Za-z0-9_./:@%+,=\-]*$/.test(value)) return value;
  return JSON.stringify(value);
}

async function updatePrivateEnv(path, updates) {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }
  const remaining = new Map(updates);
  const lines = text.split(/\r?\n/).map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match || !remaining.has(match[1])) return line;
    const value = remaining.get(match[1]);
    remaining.delete(match[1]);
    return `${match[1]}=${encodeEnvValue(value)}`;
  });
  while (lines.at(-1) === "") lines.pop();
  if (remaining.size > 0) {
    lines.push("", "# Local Dream to Admin Product API integration (server-only).");
    for (const [key, value] of remaining) {
      lines.push(`${key}=${encodeEnvValue(value)}`);
    }
  }
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
}

await updatePrivateEnv(adminEnvPath, new Map([
  ["PRODUCT_API_JWT_SECRET", sharedSecret],
  ["PRODUCT_API_JWT_ISSUER", issuer],
  ["PRODUCT_API_JWT_AUDIENCE", audience],
  ["PRODUCT_API_ORIGIN_ALLOWLIST", requestOrigin],
]));

await updatePrivateEnv(dreamEnvPath, new Map([
  ["INK_ADMIN_PRODUCT_API_BASE_URL", "http://127.0.0.1:3000"],
  ["INK_ADMIN_PRODUCT_JWT_SECRET", sharedSecret],
  ["INK_ADMIN_PRODUCT_JWT_ISSUER", issuer],
  ["INK_ADMIN_PRODUCT_JWT_AUDIENCE", audience],
  ["INK_ADMIN_PRODUCT_CLIENT_ID", clientId],
  ["INK_ADMIN_PRODUCT_ORIGIN", requestOrigin],
  ["INK_ADMIN_PRODUCT_JWT_TTL_SECONDS", "240"],
]));

console.log(JSON.stringify({
  adminBaseUrl: "http://127.0.0.1:3000",
  requestOrigin,
  issuer,
  audience,
  clientId,
  secretPersistence: "mode-0600-private-env-only",
}));
