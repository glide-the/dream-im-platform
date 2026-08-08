import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to apply generated migrations");
}

const migrationsDirectory = fileURLToPath(
  new URL("../drizzle/", import.meta.url),
);

async function readMigrations() {
  const journal = JSON.parse(
    await readFile(`${migrationsDirectory}/meta/_journal.json`, "utf8"),
  );
  if (!Array.isArray(journal.entries)) {
    throw new Error("Drizzle migration journal does not contain entries");
  }

  return Promise.all(
    journal.entries.map(async (entry) => {
      if (
        !entry ||
        typeof entry.tag !== "string" ||
        !Number.isSafeInteger(entry.when)
      ) {
        throw new Error("Drizzle migration journal contains an invalid entry");
      }
      const sql = await readFile(
        `${migrationsDirectory}/${entry.tag}.sql`,
        "utf8",
      );
      return {
        tag: entry.tag,
        createdAt: entry.when,
        hash: createHash("sha256").update(sql).digest("hex"),
        statements: sql
          .split("--> statement-breakpoint")
          .map((statement) => statement.trim())
          .filter(Boolean),
      };
    }),
  );
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  const migrations = await readMigrations();
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    ["ink-admin-memory:drizzle-migrations"],
  );
  await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await client.query(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const appliedResult = await client.query(
    `SELECT hash, created_at
     FROM "drizzle"."__drizzle_migrations"
     ORDER BY created_at ASC
     FOR UPDATE`,
  );
  const applied = new Map(
    appliedResult.rows.map((row) => [String(row.created_at), row.hash]),
  );

  for (const migration of migrations) {
    const existingHash = applied.get(String(migration.createdAt));
    if (existingHash) {
      if (existingHash !== migration.hash) {
        throw new Error(
          `Applied migration ${migration.tag} no longer matches its recorded hash`,
        );
      }
      continue;
    }
    for (const statement of migration.statements) {
      await client.query(statement);
    }
    await client.query(
      `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
       VALUES ($1, $2)`,
      [migration.hash, migration.createdAt],
    );
    console.log(`Applied migration ${migration.tag}`);
  }

  await client.query("COMMIT");
  console.log("Generated database migrations applied successfully");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
