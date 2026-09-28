// [Input] Runner-owned PostgreSQL migrated through 0067 and the production Chat operation service.
// [Output] Legacy task create/replay/get/launch/final receipts and a returning-task capability denial.
// [Pos] Isolated pre-0068 compatibility probe; never points at the normal business database.
// [Sync] 2026-09-28: protect the expand-to-0068 release order without duplicating production logic.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { AuthBoundaryError } from "../app/lib/auth/config";
import { runChatThreadOperation, type ChatThreadActor } from "../app/lib/dream/chatThreadService";

const url = process.env.DREAM_DATA_DATABASE_URL;
if (!url || !new URL(url).pathname.slice(1).startsWith("ink_chat_input_queue_test_")) {
  throw new Error("Named isolated queue database required");
}
const pool = new Pool({ connectionString: url });
const database = drizzle(pool);
const actor: ChatThreadActor = { principal: { subject: "pre-result-probe", canonical_user_id: "11",
  client_id: "queue-probe", scopes: ["dream:read", "dream:write"], status: "active" }, threadScope: null };
const run = <T>(operation: Parameters<typeof runChatThreadOperation>[0], input: unknown) =>
  database.transaction(tx => runChatThreadOperation(operation, input, actor, tx)) as Promise<T>;

try {
  const state = (await pool.query(`SELECT current_database() AS db,
    to_regclass('public.chat_task_result') AS result_table,
    EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='chat_task_session' AND column_name='return_result') AS return_column`)).rows[0];
  if (state?.db !== new URL(url).pathname.slice(1) || state.result_table !== null || state.return_column) {
    throw new Error("Probe did not receive a pre-0068 schema");
  }
  await pool.query("INSERT INTO users (id, email, password_hash) VALUES (11, 'pre-result@example.invalid', 'fixture')");
  const source = await run<{ thread_id: string }>("chat-thread.create", {
    deck_id: null, voice_id: null, title: "Pre-result source",
  });
  const input = { source_thread_id: source.thread_id, request_key: "pre-result-create",
    title: "Pre-result task", initial_message: "Inspect current state",
    source_message_id: null, expected_revision: null };
  const created = (await run<{ task: { task_id: string; thread_id: string; launch_status: string } }>(
    "task-session.create", input)).task;
  const replay = (await run<{ task: { task_id: string } }>("task-session.create", input)).task;
  const fetched = (await run<{ task: { task_id: string } | null }>("task-session.get", {
    source_thread_id: source.thread_id, task_id: created.task_id,
  })).task;
  if (created.thread_id === source.thread_id || created.task_id !== replay.task_id
    || fetched?.task_id !== created.task_id || created.launch_status !== "pending") {
    throw new Error("Legacy task identity or replay changed");
  }
  const launch = await run<{ changed: boolean; task: { launch_status: string } }>("task-session.launch", {
    source_thread_id: source.thread_id, task_id: created.task_id, action: "claim", error_code: null,
  });
  if (!launch.changed || launch.task.launch_status !== "starting") {
    throw new Error("Legacy task launch claim changed");
  }
  await run("chat-message.persist", { thread_id: created.thread_id, message_id: "pre-result-final",
    role: "assistant", parts: [{ type: "text", text: "Completed" }],
    metadata: { turnId: "pre-result-turn", turnStatus: "completed", finalPartIndex: 0 },
    history_final_text: "Completed", history_process_available: false, history_projection_version: 1 });
  let denied = false;
  try {
    await run("task-session.create-returning", { ...input, request_key: "pre-result-returning" });
  } catch (error) {
    if (!(error instanceof AuthBoundaryError) || error.code !== "DREAM_DATA_SCHEMA_NOT_READY") throw error;
    denied = true;
  }
  if (!denied) throw new Error("Returning task bypassed the missing 0068 capability");
  const taskCount = (await pool.query("SELECT count(*)::int AS count FROM chat_task_session WHERE source_thread_id=$1", [source.thread_id])).rows[0]?.count;
  if (taskCount !== 1) throw new Error("Rejected returning task changed task rows");
  process.stdout.write(JSON.stringify({ status: "passed", database: state.db,
    legacy_create: true, replay: true, get: true, launch: true,
    target_final_persisted: true, returning_capability_denied: true }) + "\n");
} finally {
  await pool.end();
}
