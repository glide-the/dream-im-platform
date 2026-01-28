import type { Config } from "drizzle-kit";

export default {
  schema: "./app/lib/db/schema.ts",
  out: "./drizzle",
  driver: "pg",
  dbCredentials: {
    connectionString: process.env.DATABASE_URL!
  }
} satisfies Config;
