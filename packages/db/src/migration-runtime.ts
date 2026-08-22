// [Input] Explicit migration DSN or embedded PostgreSQL topology capability.
// [Output] A migration connection plus ownership-aware shutdown callback.
// [Pos] Paperclip-style database target resolver for release-owned migrations.
// [Sync] 2026-08-21: support explicit external targets and package-managed embedded PostgreSQL.
import { startEmbeddedPostgres } from "./embedded-postgres.js";
import {
  resolveEmbeddedPostgresConfig,
  resolveExplicitMigrationDatabaseUrl,
} from "./runtime-config.js";

export type MigrationConnection = {
  connectionString: string;
  source: string;
  stop(): Promise<void>;
};

export async function resolveMigrationConnection(): Promise<MigrationConnection> {
  const explicitUrl = await resolveExplicitMigrationDatabaseUrl();
  if (explicitUrl) return { connectionString: explicitUrl, source: "MIGRATION_DATABASE_URL", stop: async () => undefined };
  const config = resolveEmbeddedPostgresConfig();
  if (config.mode !== "embedded-postgres") {
    throw new Error("MIGRATION_DATABASE_URL is required unless INK_DATABASE_MODE=embedded-postgres is explicit.");
  }
  const running = await startEmbeddedPostgres(config);
  return {
    connectionString: running.connectionString,
    source: `embedded-postgres@${config.port}`,
    stop: running.stop,
  };
}
