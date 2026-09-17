// [Input] The reviewed 0061 SQL and a runner-owned PostgreSQL cluster under a fresh /private/tmp directory.
// [Output] Loopback-listener, lock/resequence/constraint/capability evidence followed by complete owned-cluster cleanup.
// [Pos] Destructive Reflections migration contract harness; never connects to configured application databases.
// [Sync] 2026-09-15: prove loopback-only topology, final 0061 capability and the overlapping-writer cutover.
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { startEmbeddedPostgres, type RunningEmbeddedPostgres } from "../../packages/db/src/embedded-postgres";

const migrationSql = await readFile(
  new URL("../../drizzle/0061_outstanding_maverick.sql", import.meta.url),
  "utf8",
);
const migrationStatements = migrationSql
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean);

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve an isolated PostgreSQL port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function expectPostgresCode(action: () => Promise<unknown>, expected: string): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === expected) return;
    throw error;
  }
  throw new Error(`Expected PostgreSQL error ${expected}`);
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const suffix = randomBytes(6).toString("hex");
const database = `ink_auth_data_codex_test_reflections_${suffix}`;
const ownedRoot = await mkdtemp(join(tmpdir(), "ink-auth-data-reflection-task-"));
let embedded: RunningEmbeddedPostgres | undefined;
let evidence: Record<string, unknown> | undefined;

try {
  embedded = await startEmbeddedPostgres({
    mode: "embedded-postgres",
    dataDir: join(ownedRoot, "postgres"),
    port: await availablePort(),
    user: "postgres",
    password: `pg_${randomBytes(24).toString("base64url")}`,
    database,
    sharedBuffers: "24MB",
    maxConnections: 12,
  }, { listenAddresses: "127.0.0.1" });

  const setup = new pg.Client({ connectionString: embedded.connectionString });
  const writer = new pg.Client({ connectionString: embedded.connectionString });
  const migration = new pg.Client({ connectionString: embedded.connectionString });
  const observer = new pg.Client({ connectionString: embedded.connectionString });
  await Promise.all([setup.connect(), writer.connect(), migration.connect(), observer.connect()]);

  try {
    const listenAddresses = await setup.query("SHOW listen_addresses");
    const serverAddress = await setup.query("SELECT host(inet_server_addr()) AS address");
    const configuredListenAddresses = listenAddresses.rows[0]?.listen_addresses;
    const connectedServerAddress = serverAddress.rows[0]?.address;
    if (
      configuredListenAddresses !== "127.0.0.1"
      || connectedServerAddress !== "127.0.0.1"
    ) {
      throw new Error(`Reflections migration PostgreSQL must listen only on IPv4 loopback: ${JSON.stringify({ configuredListenAddresses, connectedServerAddress })}`);
    }

    await setup.query(`
      CREATE SCHEMA identity;
      CREATE SCHEMA dream;
      CREATE SCHEMA drizzle;
      CREATE TABLE drizzle.schema_capabilities (
        capability text PRIMARY KEY,
        version integer NOT NULL,
        contract_sha256 text NOT NULL,
        adopted_from text NOT NULL,
        metadata jsonb NOT NULL
      );
      CREATE TABLE users (id bigint PRIMARY KEY);
      CREATE TABLE identity."user" (id text PRIMARY KEY);
      CREATE TABLE chat_thread (id text PRIMARY KEY);
      CREATE TABLE reflection_task (
        id text PRIMARY KEY,
        user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status text NOT NULL,
        sections text NOT NULL DEFAULT '[]',
        input_snapshot text NOT NULL DEFAULT '{}',
        workspace_path text,
        agent_contract_version text,
        error_summary text,
        created_at timestamptz DEFAULT now(),
        started_at timestamptz,
        completed_at timestamptz,
        updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE analysis_reports (
        id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
        user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        report_type text NOT NULL,
        report_data_json text NOT NULL,
        all_notes_text text,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE reflection_task_event (
        id text PRIMARY KEY,
        task_id text NOT NULL REFERENCES reflection_task(id) ON DELETE CASCADE,
        sequence integer,
        event_type text NOT NULL,
        payload text NOT NULL DEFAULT '{}',
        created_at timestamptz DEFAULT now()
      );
      INSERT INTO users (id) VALUES (1), (2);
      INSERT INTO identity."user" (id) VALUES ('auth-1');
      INSERT INTO chat_thread (id) VALUES ('thread-1');
      INSERT INTO reflection_task (id, user_id, status) VALUES
        ('task-a', 1, 'CREATED'),
        ('task-b', 2, 'CREATED');
      INSERT INTO reflection_task_event (id, task_id, sequence, event_type, created_at) VALUES
        ('event-a', 'task-a', 8, 'progress', '2024-01-02T00:00:00Z'),
        ('event-b', 'task-a', 8, 'progress', '2024-01-02T00:00:00Z'),
        ('event-c', 'task-a', NULL, 'progress', NULL),
        ('event-z', 'task-b', -4, 'progress', '2024-01-03T00:00:00Z');
    `);

    await writer.query("BEGIN");
    await writer.query(
      `INSERT INTO reflection_task_event (id, task_id, sequence, event_type, created_at)
       VALUES ('event-0', 'task-a', NULL, 'started', '2024-01-01T00:00:00Z')`,
    );

    const migrationPid = Number((await migration.query("SELECT pg_backend_pid() AS pid")).rows[0]?.pid);
    const migrationWork = (async () => {
      await migration.query("BEGIN");
      try {
        for (const statement of migrationStatements) await migration.query(statement);
        await migration.query("COMMIT");
      } catch (error) {
        await migration.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    })();
    migrationWork.catch(() => undefined);

    let oldWriterBlockedMigration = false;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const activity = await observer.query(
        "SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid = $1",
        [migrationPid],
      );
      const row = activity.rows[0];
      if (row?.wait_event_type === "Lock" && row?.wait_event === "relation") {
        oldWriterBlockedMigration = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!oldWriterBlockedMigration) throw new Error("0061 did not wait for the overlapping legacy writer");

    await writer.query("COMMIT");
    await withTimeout(migrationWork, 10_000, "0061 migration");

    const events = await setup.query(
      `SELECT id, task_id, sequence
       FROM reflection_task_event
       ORDER BY task_id, sequence`,
    );
    const expectedEvents = [
      { id: "event-0", task_id: "task-a", sequence: 1 },
      { id: "event-a", task_id: "task-a", sequence: 2 },
      { id: "event-b", task_id: "task-a", sequence: 3 },
      { id: "event-c", task_id: "task-a", sequence: 4 },
      { id: "event-z", task_id: "task-b", sequence: 1 },
    ];
    if (JSON.stringify(events.rows) !== JSON.stringify(expectedEvents)) {
      throw new Error(`Unexpected event resequence result: ${JSON.stringify(events.rows)}`);
    }

    await expectPostgresCode(
      () => setup.query("INSERT INTO reflection_task_event (id, task_id, sequence, event_type) VALUES ('null-sequence', 'task-a', NULL, 'bad')"),
      "23502",
    );
    await expectPostgresCode(
      () => setup.query("INSERT INTO reflection_task_event (id, task_id, sequence, event_type) VALUES ('zero-sequence', 'task-a', 0, 'bad')"),
      "23514",
    );
    await expectPostgresCode(
      () => setup.query("INSERT INTO reflection_task_event (id, task_id, sequence, event_type) VALUES ('duplicate-sequence', 'task-a', 1, 'bad')"),
      "23505",
    );
    await expectPostgresCode(
      () => setup.query("INSERT INTO reflection_task_section (task_id, section, status) VALUES ('task-a', 'echoes', 'UNKNOWN')"),
      "23514",
    );
    await setup.query("INSERT INTO reflection_task_section (task_id, section, status) VALUES ('task-a', 'echoes', 'PENDING')");
    await expectPostgresCode(
      () => setup.query(`
        INSERT INTO dream.reflection_task_authorities (
          token_hash, service_client_id, task_id, section, thread_id, auth_user_id,
          canonical_user_id, purpose, scopes, request_id, input_sha256, token_ciphertext,
          expires_at, maximum_expires_at
        ) VALUES (
          'token-bad-purpose', 'dream-service', 'task-a', 'echoes', 'thread-1', 'auth-1',
          1, 'wrong-purpose', ARRAY['dream:read','dream:write'], 'request-1',
          repeat('a', 64), 'ciphertext', now() + interval '1 minute', now() + interval '2 minutes'
        )
      `),
      "23514",
    );
    await setup.query(
      "INSERT INTO analysis_reports (user_id, report_type, report_data_json, reflection_task_id) VALUES (1, 'full_analysis', '{}', 'task-a')",
    );
    await expectPostgresCode(
      () => setup.query("INSERT INTO analysis_reports (user_id, report_type, report_data_json, reflection_task_id) VALUES (1, 'full_analysis', '{}', 'task-a')"),
      "23505",
    );
    await expectPostgresCode(
      () => setup.query("INSERT INTO reflection_task_section (task_id, section, status) VALUES ('missing-task', 'traits', 'PENDING')"),
      "23503",
    );

    const capability = await setup.query(
      "SELECT version, contract_sha256, metadata FROM drizzle.schema_capabilities WHERE capability = 'dream.reflection-task-persistence.v1'",
    );
    const capabilityRow = capability.rows[0];
    if (
      capability.rowCount !== 1
      || capabilityRow.version !== 1
      || capabilityRow.contract_sha256 !== "52340d24e76db9ee91dfbe8748ebaf3b0f3c2d20f15367c1c096d2e869d4753f"
      || capabilityRow.metadata?.event_lock !== "share-row-exclusive"
    ) {
      throw new Error("Unexpected Reflections schema capability row");
    }

    evidence = {
      result: "PASS",
      target: "runner-owned-named-disposable-postgresql",
      database_prefix: "ink_auth_data_codex_test_reflections_",
      old_writer_blocked_migration: oldWriterBlockedMigration,
      resequenced_events: events.rowCount,
      rejected_writes: {
        null_sequence: "23502",
        nonpositive_sequence: "23514",
        duplicate_task_sequence: "23505",
        invalid_section_state: "23514",
        invalid_authority_purpose: "23514",
        duplicate_task_report: "23505",
        missing_task_reference: "23503",
      },
      capability_version: capabilityRow.version,
      listen_addresses: configuredListenAddresses,
      server_address: connectedServerAddress,
    };
  } finally {
    await Promise.allSettled([setup.end(), writer.end(), migration.end(), observer.end()]);
  }
} finally {
  await embedded?.stop().catch(() => undefined);
  await rm(ownedRoot, { recursive: true, force: true });
}

if (!evidence) throw new Error("Reflections migration evidence was not produced");
console.log(JSON.stringify({ ...evidence, owned_cluster_removed: true }));
