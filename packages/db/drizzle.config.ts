// [Input] Built @ink-memory/db canonical schema and explicit migration database URL.
// [Output] Drizzle Kit configuration that writes the immutable root drizzle history.
// [Pos] Schema-generation config owned by the database workspace package.
// [Sync] 2026-09-04: load built NodeNext modules so Drizzle Kit resolves intentional .js imports without source-loader drift.
import { config } from "dotenv";
import type { Config } from "drizzle-kit";

config({ path: "../../.env.local" });

export default {
  schema: [
    "./dist/schema/index.js",
    "./dist/schema/dream.js",
    "./dist/schema/capabilities.js",
  ],
  out: "../../drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.MIGRATION_DATABASE_URL! },
} satisfies Config;
