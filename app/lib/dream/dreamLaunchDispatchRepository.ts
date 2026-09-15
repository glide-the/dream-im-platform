// [Input] Existing Admin transaction and current owner-scoped Run/source identities.
// [Output] Locked message/Thread, frozen binding and narrow envelope updates with raw PostgreSQL time.
// [Pos] Dispatch metadata repository; no commit, Runtime, pool or caller SQL.
// [Sync] 2026-09-15: preserve workspace/Run-before-message lock order and complete stored source facts.
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { chat_message as message, chat_thread as thread, deck_plugin_bindings as binding, workflow_runs as run } from "@ink-memory/db/schema/dream";
import { storyWorkspaceWorkspaces as workspace } from "@ink-memory/db/schema";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";

export class DreamLaunchDispatchRepository {
  constructor(private readonly tx: DataTransaction) {}
  async ownedWorkspace(actor: string, runId: string) {
    decimalIdDto.parse(actor);
    return (await this.tx.select({ workspace_id: run.workspace_id }).from(run).innerJoin(workspace, eq(workspace.id, run.workspace_id))
      .where(and(eq(run.id, runId), eq(run.created_by, actor), eq(workspace.owner_id, sql`${actor}::bigint`))).limit(1))[0]?.workspace_id ?? null;
  }
  async run(actor: string, workspaceId: string, runId: string, lock: boolean) {
    decimalIdDto.parse(actor);
    const query = this.tx.select({ ...getTableColumns(run), created_at: sql<string>`${run.created_at}::text`,
      started_at: sql<string | null>`${run.started_at}::text`, completed_at: sql<string | null>`${run.completed_at}::text`,
      source_message_time: sql<string | null>`${run.source_message_time}::text` }).from(run).innerJoin(workspace, eq(workspace.id, run.workspace_id))
      .where(and(eq(run.id, runId), eq(run.workspace_id, workspaceId), eq(run.created_by, actor), eq(workspace.owner_id, sql`${actor}::bigint`))).limit(1);
    return (lock ? await query.for("update", { of: [run] }) : await query)[0] ?? null;
  }
  async source(messageId: string, threadId: string) {
    return (await this.tx.select({ message_id: message.id, thread_id: message.thread_id, role: message.role, parts: message.parts, metadata: message.metadata,
      created_at: sql<string>`${message.created_at}::text`, user_id: sql<string>`${thread.user_id}::text`, deck_id: thread.deck_id, agent_id: thread.voice_id })
      .from(message).innerJoin(thread, eq(thread.id, message.thread_id)).where(and(eq(message.id, messageId), eq(message.thread_id, threadId)))
      .limit(1).for("update", { of: [message, thread] }))[0] ?? null;
  }
  async binding(bindingId: string) {
    return (await this.tx.select({ workspace_id: binding.workspace_id, deck_id: binding.deck_id, deck_plugin_id: binding.deck_plugin_id,
      deck_plugin_version: binding.deck_plugin_version, binding_revision: binding.binding_revision }).from(binding)
      .where(eq(binding.deck_plugin_binding_id, bindingId)).limit(1).for("share"))[0] ?? null;
  }
  async clock() {
    const result = await this.tx.execute(sql`SELECT clock_timestamp()::text AS now`);
    const now = (result.rows[0] as { now: string } | undefined)?.now;
    if (!now) throw new AuthBoundaryError("DREAM_LAUNCH_DISPATCH_UNAVAILABLE");
    return now;
  }
  async claim(messageId: string, threadId: string, parts: string, metadata: string) {
    await this.tx.update(message).set({ parts, metadata }).where(and(eq(message.id, messageId), eq(message.thread_id, threadId)));
  }
  async finish(messageId: string, threadId: string, metadata: string) {
    await this.tx.update(message).set({ metadata }).where(and(eq(message.id, messageId), eq(message.thread_id, threadId)));
  }
}
