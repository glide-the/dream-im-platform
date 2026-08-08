#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import pg from "pg";

import {
  SOURCE_TABLES,
  fingerprintIds,
  parseSafeTargetUrl,
  safeTargetLabel,
  validateSourceRows,
} from "./lib/story-source-import.mjs";

const execFileAsync = promisify(execFile);
const { Client } = pg;
const apply = process.argv.includes("--apply");
const sourcePath = process.env.INK_DREAM_SOURCE_DB_PATH;
const sqliteBinary = "/usr/bin/sqlite3";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function fileFingerprint(filePath) {
  const file = await stat(filePath);
  const { stdout } = await execFileAsync("/usr/bin/shasum", ["-a", "256", filePath], {
    maxBuffer: 1024 * 1024,
  });
  return {
    size: file.size,
    mtimeMs: file.mtimeMs,
    sha256: stdout.trim().split(/\s+/)[0],
  };
}

async function sqliteJson(snapshotPath, sql) {
  const { stdout } = await execFileAsync(
    sqliteBinary,
    ["-readonly", "-json", snapshotPath, `PRAGMA query_only=ON; ${sql}`],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout.trim() ? JSON.parse(stdout) : [];
}

async function snapshotSource(source, destination) {
  if (/\s/.test(destination)) {
    throw new Error("Temporary snapshot path must not contain whitespace.");
  }
  const sourceUrl = pathToFileURL(source);
  sourceUrl.searchParams.set("mode", "ro");
  await execFileAsync(sqliteBinary, [sourceUrl.toString(), `.backup ${destination}`], {
    maxBuffer: 1024 * 1024,
  });
  // The source persists WAL journal mode. A private backup without WAL sidecars
  // cannot be opened with `-readonly` by the macOS SQLite build, so normalize
  // only the disposable snapshot before all subsequent read-only queries.
  await execFileAsync(sqliteBinary, [destination, "PRAGMA journal_mode=DELETE; PRAGMA quick_check"], {
    maxBuffer: 1024 * 1024,
  });
}

async function readSource(snapshotPath) {
  const [users, workspaces, stories, foreignKeyFailures] = await Promise.all([
    sqliteJson(snapshotPath, "SELECT id, email, password_hash, display_name, created_at, avatar_url, role, updated_at FROM users ORDER BY id"),
    sqliteJson(snapshotPath, "SELECT id, name, owner_id, settings, created_at, updated_at FROM story_workspace_workspaces ORDER BY id"),
    sqliteJson(snapshotPath, "SELECT id, identifier, title, description, status, review_status, type, content, author_id, workspace_id, character_count, scene_count, agent_generated, agent_session_id, review_notes, created_at, updated_at, confirmed_at, published_at FROM story_workspace_stories ORDER BY id"),
    sqliteJson(snapshotPath, "PRAGMA foreign_key_check"),
  ]);
  if (foreignKeyFailures.length > 0) {
    throw new Error("Source database failed PRAGMA foreign_key_check.");
  }
  return {
    users,
    story_workspace_workspaces: workspaces,
    story_workspace_stories: stories,
  };
}

function placeholders(length) {
  return Array.from({ length }, (_, index) => `$${index + 1}`).join(", ");
}

async function insertRows(client, source) {
  const userColumns = ["id", "email", "password_hash", "display_name", "created_at", "avatar_url", "role", "updated_at"];
  for (const row of source.users) {
    await client.query(
      `INSERT INTO users (${userColumns.join(", ")}) VALUES (${placeholders(userColumns.length)})`,
      userColumns.map((column) => row[column] ?? null),
    );
  }

  const workspaceColumns = ["id", "name", "owner_id", "settings", "created_at", "updated_at"];
  for (const row of source.story_workspace_workspaces) {
    await client.query(
      `INSERT INTO story_workspace_workspaces (${workspaceColumns.join(", ")}) VALUES (${placeholders(workspaceColumns.length)})`,
      workspaceColumns.map((column) => row[column] ?? null),
    );
  }

  const storyColumns = [
    "id", "identifier", "title", "description", "status", "review_status", "type", "content",
    "author_id", "workspace_id", "character_count", "scene_count", "agent_generated", "agent_session_id",
    "review_notes", "created_at", "updated_at", "confirmed_at", "published_at",
  ];
  for (const row of source.story_workspace_stories) {
    await client.query(
      `INSERT INTO story_workspace_stories (${storyColumns.join(", ")}) VALUES (${placeholders(storyColumns.length)})`,
      storyColumns.map((column) => row[column] ?? null),
    );
  }
  await client.query(
    "SELECT setval(pg_get_serial_sequence('users', 'id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM users), 1), (SELECT COUNT(*) > 0 FROM users))",
  );
}

async function inspectTarget(client) {
  const relationResult = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [SOURCE_TABLES],
  );
  if (relationResult.rowCount !== SOURCE_TABLES.length) {
    throw new Error("Target is missing canonical Story tables; apply PostgreSQL migrations first.");
  }
  const counts = {};
  for (const table of SOURCE_TABLES) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
    counts[table] = result.rows[0].count;
  }
  return counts;
}

async function verifyTarget(client, expected) {
  const counts = {};
  const fingerprints = {};
  for (const table of SOURCE_TABLES) {
    const result = await client.query(`SELECT id::text AS id FROM ${table} ORDER BY id`);
    counts[table] = result.rowCount;
    fingerprints[table] = fingerprintIds(result.rows.map((row) => row.id));
  }
  const orphanResult = await client.query(
    `SELECT
      (SELECT COUNT(*)::int FROM story_workspace_workspaces w LEFT JOIN users u ON u.id = w.owner_id WHERE u.id IS NULL) AS workspace_owner_orphans,
      (SELECT COUNT(*)::int FROM story_workspace_stories s LEFT JOIN users u ON u.id = s.author_id WHERE u.id IS NULL) AS story_author_orphans,
      (SELECT COUNT(*)::int FROM story_workspace_stories s LEFT JOIN story_workspace_workspaces w ON w.id = s.workspace_id WHERE w.id IS NULL) AS story_workspace_orphans`,
  );
  if (JSON.stringify(counts) !== JSON.stringify(expected.counts) || JSON.stringify(fingerprints) !== JSON.stringify(expected.fingerprints)) {
    throw new Error("Post-import count or primary-key fingerprint verification failed.");
  }
  if (Object.values(orphanResult.rows[0]).some((value) => Number(value) !== 0)) {
    throw new Error("Post-import foreign-key verification failed.");
  }
  return { counts, fingerprints, orphans: orphanResult.rows[0] };
}

async function main() {
  if (!sourcePath) throw new Error("INK_DREAM_SOURCE_DB_PATH is required.");
  const targetUrl = parseSafeTargetUrl(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
  const sourceBefore = await fileFingerprint(sourcePath);
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "ink-story-import-"));
  const snapshotPath = path.join(temporaryDirectory, "source-readonly-snapshot.db");
  const operationId = randomUUID();
  let client;
  try {
    await snapshotSource(sourcePath, snapshotPath);
    const source = await readSource(snapshotPath);
    const sourceAudit = validateSourceRows(source);
    const sourceAfter = await fileFingerprint(sourcePath);
    if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter)) {
      throw new Error("Source file changed while the read-only snapshot was prepared; retry from a stable source.");
    }

    client = new Client({ connectionString: targetUrl.toString(), application_name: "ink-story-source-import" });
    await client.connect();
    await client.query("SET TIME ZONE 'UTC'");
    const targetBefore = await inspectTarget(client);
    if (Object.values(targetBefore).some((count) => count !== 0)) {
      throw new Error("Target Story tables must all be empty; import refuses merge, overwrite, truncate, or delete behavior.");
    }

    const baseReceipt = {
      operationId,
      mode: apply ? "apply" : "dry-run",
      source: {
        fileSha256: sourceBefore.sha256,
        fileSize: sourceBefore.size,
        snapshotSha256: sha256(await import("node:fs/promises").then(({ readFile }) => readFile(snapshotPath))),
      },
      target: safeTargetLabel(targetUrl),
      sourceAudit,
      targetBefore,
    };
    if (!apply) {
      console.log(JSON.stringify({ ...baseReceipt, status: "ready", applied: false }, null, 2));
      return;
    }

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      const lockedCounts = await inspectTarget(client);
      if (Object.values(lockedCounts).some((count) => count !== 0)) {
        throw new Error("Target changed after preflight; import aborted.");
      }
      await insertRows(client, source);
      const verification = await verifyTarget(client, sourceAudit);
      await client.query("COMMIT");
      console.log(JSON.stringify({ ...baseReceipt, status: "applied", applied: true, verification }, null, 2));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client?.end().catch(() => undefined);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", message: error instanceof Error ? error.message : "Unknown import failure" }));
  process.exitCode = 1;
});
