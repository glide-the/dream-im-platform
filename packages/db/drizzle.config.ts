// [Input] @ink-memory/db canonical schema and explicit migration database URL.
// [Output] Drizzle Kit configuration that writes the immutable root drizzle history.
// [Pos] Schema-generation config owned by the database workspace package.
// [Sync] 2026-08-21: move Drizzle generation ownership into packages/db.
import { config } from "dotenv";
import type { Config } from "drizzle-kit";

config({ path: "../../.env.local" });

export default {
  schema: ["./src/schema/index.ts", "./src/schema/*.ts"],
  out: "../../drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL! },
} satisfies Config;
