// [Input] Existing Admin UOW, canonical owner or configured service, and closed Reflections commands.
// [Output] Owner/service-filtered task aggregate persistence with locks, CAS and stable ordering.
// [Pos] Registered typed Reflections Repository; no pool, commit, caller SQL, user or Thread selector.
// [Sync] 2026-09-15: require gap-free task event append under the service-held task row lock.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  analysis_reports as report, chat_message as message, chat_thread as thread,
  reflection_result as result, reflection_task as task, reflection_task_event as event,
  reflection_task_section as taskSection, reflections_section_configs as sectionConfig,
  user_sessions as session,
} from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { postgresInt4Max, type ReflectionTaskPublicInput } from "./reflectionTaskDto";

const taskFields = {
  id: task.id, userId: sql<string>`${task.user_id}::text`, status: task.status, sectionsJson: task.sections,
  inputSnapshotJson: task.input_snapshot, workspacePath: task.workspace_path, agentContractVersion: task.agent_contract_version,
  errorSummary: task.error_summary, serviceClientId: task.service_client_id, launchSnapshotJson: task.launch_snapshot_json,
  authUserId: task.auth_user_id,
  revision: task.revision, createdAt: sql<string | null>`${task.created_at}::text`, startedAt: sql<string | null>`${task.started_at}::text`,
  completedAt: sql<string | null>`${task.completed_at}::text`, updatedAt: sql<string | null>`${task.updated_at}::text`,
};
const sectionFields = {
  taskId: taskSection.task_id, section: taskSection.section, status: taskSection.status, threadId: taskSection.thread_id,
  resultCount: taskSection.result_count, errorSummary: taskSection.error_summary, revision: taskSection.revision,
  startedAt: sql<string | null>`${taskSection.started_at}::text`, completedAt: sql<string | null>`${taskSection.completed_at}::text`,
};
const resultFields = {
  id: result.id, taskId: result.task_id, section: result.section, title: result.title, description: result.description,
  relatedSessionIdsJson: result.related_session_ids, evidence: result.evidence, confidence: result.confidence,
  createdAt: sql<string | null>`${result.created_at}::text`,
};

export type ReflectionTaskStorageRow = typeof taskFields extends Record<string, infer _> ? {
  id: string; userId: string; status: string; sectionsJson: string; inputSnapshotJson: string; workspacePath: string | null;
  agentContractVersion: string | null; errorSummary: string | null; serviceClientId: string | null; authUserId: string | null; launchSnapshotJson: string | null;
  revision: number; createdAt: string | null; startedAt: string | null; completedAt: string | null; updatedAt: string | null;
} : never;
export type ReflectionSectionStorageRow = {
  taskId: string; section: string; status: string; threadId: string | null; resultCount: number; errorSummary: string | null;
  revision: number; startedAt: string | null; completedAt: string | null;
};

export function requireNextReflectionEventSequence(current: number, requested: number) {
  if (!Number.isInteger(current) || current < 0 || current > postgresInt4Max || !Number.isInteger(requested) || requested < 1 || requested > postgresInt4Max || requested !== current + 1) throw new AuthBoundaryError("REFLECTION_EVENT_SEQUENCE_CONFLICT", 409);
}

export class ReflectionTaskRepository {
  constructor(private readonly tx: DataTransaction) {}
  private owner(canonicalUserId: string) { return eq(task.user_id, sql`${decimalIdDto.parse(canonicalUserId)}::bigint`); }

  async create(canonicalUserId: string, authUserId: string, serviceClientId: string, sections: readonly string[], input: ReflectionTaskPublicInput) {
    const taskId = randomUUID();
    await this.tx.insert(task).values({
      id: taskId, user_id: sql`${decimalIdDto.parse(canonicalUserId)}::bigint`, status: "CREATED", sections: JSON.stringify(sections),
      input_snapshot: JSON.stringify(input), agent_contract_version: "reflections-agent-v1", service_client_id: serviceClientId, auth_user_id: authUserId,
      revision: 1, updated_at: sql`CURRENT_TIMESTAMP`,
    });
    await this.tx.insert(taskSection).values(sections.map(section => ({ task_id: taskId, section, status: "PENDING", revision: 1 })));
    return taskId;
  }

  async readOwned(canonicalUserId: string, taskId: string, lock = false) {
    const query = this.tx.select(taskFields).from(task).where(and(eq(task.id, taskId), this.owner(canonicalUserId))).limit(1);
    const rows = lock ? await query.for("update") : await query;
    return (rows[0] ?? null) as ReflectionTaskStorageRow | null;
  }

  async readForService(taskId: string, serviceClientId: string, lock = false) {
    const query = this.tx.select(taskFields).from(task).where(and(eq(task.id, taskId), eq(task.service_client_id, serviceClientId))).limit(1);
    const rows = lock ? await query.for("update") : await query;
    return (rows[0] ?? null) as ReflectionTaskStorageRow | null;
  }

  async adoptOwned(taskId: string, canonicalUserId: string, authUserId: string, serviceClientId: string) {
    const row = await this.readOwned(canonicalUserId, taskId, true);
    if (!row) throw new AuthBoundaryError("REFLECTION_TASK_NOT_FOUND", 404);
    if (row.serviceClientId !== null && row.serviceClientId !== serviceClientId) throw new AuthBoundaryError("REFLECTION_TASK_SERVICE_CONFLICT", 409);
    if (row.authUserId !== null && row.authUserId !== authUserId) throw new AuthBoundaryError("REFLECTION_TASK_SUBJECT_CONFLICT", 409);
    if (row.serviceClientId === null || row.authUserId === null) {
      await this.tx.update(task).set({ service_client_id: serviceClientId, auth_user_id: authUserId, revision: sql`${task.revision} + 1`, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(task.id, taskId), this.owner(canonicalUserId), or(isNull(task.service_client_id), eq(task.service_client_id, serviceClientId)), or(isNull(task.auth_user_id), eq(task.auth_user_id, authUserId))));
    }
    return (await this.readOwned(canonicalUserId, taskId, false))!;
  }

  async insertMissingSections(row: ReflectionTaskStorageRow, sections: readonly string[]) {
    const counts = await this.tx.select({ section: result.section, count: sql<number>`count(*)::int` }).from(result).where(and(eq(result.task_id, row.id), eq(result.user_id, sql`${row.userId}::bigint`))).groupBy(result.section);
    const bySection = new Map(counts.map(item => [item.section, item.count]));
    const terminal = ["COMPLETED", "PARTIAL_FAILED", "FAILED"].includes(row.status);
    await this.tx.insert(taskSection).values(sections.map(section => {
      const count = bySection.get(section) ?? 0;
      const status = terminal ? count > 0 ? "COMPLETED" : "FAILED" : "PENDING";
      return {
        task_id: row.id, section, status, result_count: status === "COMPLETED" ? count : 0, revision: 1,
        started_at: status === "PENDING" ? null : row.startedAt ?? row.createdAt ?? sql`CURRENT_TIMESTAMP`,
        completed_at: terminal ? row.completedAt ?? row.updatedAt ?? sql`CURRENT_TIMESTAMP` : null,
        error_summary: status === "FAILED" ? row.errorSummary ?? "Historical section did not persist results." : null,
      };
    })).onConflictDoNothing({ target: [taskSection.task_id, taskSection.section] });
  }

  async sections(taskId: string, lock = false) {
    const query = this.tx.select(sectionFields).from(taskSection).where(eq(taskSection.task_id, taskId)).orderBy(asc(taskSection.section));
    const rows = lock ? await query.for("update") : await query;
    return rows as ReflectionSectionStorageRow[];
  }

  async results(taskId: string, canonicalUserId: string) {
    return this.tx.select(resultFields).from(result).innerJoin(task, eq(task.id, result.task_id)).where(and(
      eq(result.task_id, taskId), eq(result.user_id, sql`${decimalIdDto.parse(canonicalUserId)}::bigint`), this.owner(canonicalUserId),
    )).orderBy(asc(result.section), asc(result.created_at), asc(result.id));
  }

  async latestOwned(canonicalUserId: string) {
    const row = (await this.tx.select(taskFields).from(task).where(this.owner(canonicalUserId)).orderBy(desc(task.updated_at), desc(task.created_at), desc(task.id)).limit(1))[0] ?? null;
    return row as ReflectionTaskStorageRow | null;
  }

  async latestTerminalOwned(canonicalUserId: string) {
    const row = (await this.tx.select(taskFields).from(task).where(and(this.owner(canonicalUserId), inArray(task.status, ["COMPLETED", "PARTIAL_FAILED"])))
      .orderBy(desc(task.completed_at), desc(task.updated_at), desc(task.created_at), desc(task.id)).limit(1))[0] ?? null;
    return row as ReflectionTaskStorageRow | null;
  }

  async materializeLaunchSnapshot(row: ReflectionTaskStorageRow, snapshotJson: string, publicInputJson: string, workspacePath: string) {
    if (row.launchSnapshotJson !== null) return row;
    const updated = await this.tx.update(task).set({
      launch_snapshot_json: snapshotJson, input_snapshot: publicInputJson, workspace_path: workspacePath,
      status: row.status === "CREATED" ? "ASSEMBLING" : row.status,
      revision: sql`${task.revision} + 1`, updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(and(eq(task.id, row.id), eq(task.service_client_id, row.serviceClientId!), isNull(task.launch_snapshot_json), eq(task.revision, row.revision))).returning(taskFields);
    if (!updated[0]) throw new AuthBoundaryError("REFLECTION_TASK_REVISION_CONFLICT", 409);
    return updated[0] as ReflectionTaskStorageRow;
  }

  async ensureWorkspacePath(row: ReflectionTaskStorageRow, workspacePath: string) {
    if (row.workspacePath === workspacePath) return row;
    if (row.workspacePath !== null) throw new AuthBoundaryError("REFLECTION_WORKSPACE_BINDING_CONFLICT", 409);
    const updated = await this.tx.update(task).set({ workspace_path: workspacePath, revision: sql`${task.revision} + 1`, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(task.id, row.id), eq(task.service_client_id, row.serviceClientId!), isNull(task.workspace_path), eq(task.revision, row.revision))).returning(taskFields);
    if (!updated[0]) throw new AuthBoundaryError("REFLECTION_TASK_REVISION_CONFLICT", 409);
    return updated[0] as ReflectionTaskStorageRow;
  }

  async sourceSessions(canonicalUserId: string, input: ReflectionTaskPublicInput) {
    const idFilter = input.session_ids.length ? inArray(session.id, input.session_ids) : undefined;
    return this.tx.select({
      id: session.id, name: session.name, stateJson: session.editor_state_json, labelsJson: session.labels,
      createdAt: sql<string | null>`${session.created_at}::text`, updatedAt: sql<string | null>`${session.updated_at}::text`,
    }).from(session).where(and(
      eq(session.user_id, sql`${decimalIdDto.parse(canonicalUserId)}::bigint`), idFilter,
      sql`(${input.start_date}::date IS NULL OR date(COALESCE(${session.created_at}, ${session.updated_at})) >= ${input.start_date}::date)`,
      sql`(${input.end_date}::date IS NULL OR date(COALESCE(${session.created_at}, ${session.updated_at})) <= ${input.end_date}::date)`,
    )).orderBy(desc(session.updated_at), asc(session.id));
  }

  async customPrompts(canonicalUserId: string, sections: readonly string[]) {
    return this.tx.select({ section: sectionConfig.section, promptFilesJson: sectionConfig.prompt_files }).from(sectionConfig).where(and(
      eq(sectionConfig.user_id, sql`${decimalIdDto.parse(canonicalUserId)}::bigint`), inArray(sectionConfig.section, [...sections]),
    ));
  }

  async advance(row: ReflectionTaskStorageRow, action: "context-ready" | "run-started" | "finalize" | "fatal-fail", expectedRevision: number, terminal?: { status: string; errorSummary: string | null }) {
    if (row.revision !== expectedRevision) throw new AuthBoundaryError("REFLECTION_TASK_REVISION_CONFLICT", 409);
    const target = action === "context-ready" ? "QUEUED" : action === "run-started" ? "RUNNING" : action === "fatal-fail" ? "FAILED" : terminal!.status;
    const expected = action === "context-ready" ? ["ASSEMBLING"] : action === "run-started" ? ["QUEUED"] : action === "fatal-fail" ? ["CREATED", "ASSEMBLING", "QUEUED", "RUNNING"] : ["RUNNING"];
    if (row.status === target) return row;
    if (!expected.includes(row.status)) throw new AuthBoundaryError("REFLECTION_TASK_TRANSITION_CONFLICT", 409);
    const updated = await this.tx.update(task).set({
      status: target, revision: sql`${task.revision} + 1`, updated_at: sql`CURRENT_TIMESTAMP`,
      started_at: action === "run-started" ? sql`COALESCE(${task.started_at}, CURRENT_TIMESTAMP)` : task.started_at,
      completed_at: action === "finalize" || action === "fatal-fail" ? sql`CURRENT_TIMESTAMP` : task.completed_at,
      error_summary: action === "finalize" || action === "fatal-fail" ? terminal!.errorSummary : task.error_summary,
    }).where(and(eq(task.id, row.id), eq(task.service_client_id, row.serviceClientId!), eq(task.revision, expectedRevision), inArray(task.status, expected))).returning(taskFields);
    if (!updated[0]) throw new AuthBoundaryError("REFLECTION_TASK_REVISION_CONFLICT", 409);
    return updated[0] as ReflectionTaskStorageRow;
  }

  async failPendingSections(taskId: string, summary: string) {
    await this.tx.update(taskSection).set({ status: "FAILED", error_summary: summary, result_count: 0, completed_at: sql`CURRENT_TIMESTAMP`, revision: sql`${taskSection.revision} + 1`, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(taskSection.task_id, taskId), inArray(taskSection.status, ["PENDING", "RUNNING"])));
  }

  async beginSection(taskId: string, sectionName: string, expectedRevision: number, canonicalUserId: string) {
    const current = (await this.tx.select(sectionFields).from(taskSection).where(and(eq(taskSection.task_id, taskId), eq(taskSection.section, sectionName))).limit(1).for("update"))[0] as ReflectionSectionStorageRow | undefined;
    if (!current) throw new AuthBoundaryError("REFLECTION_SECTION_NOT_FOUND", 404);
    if (current.status === "RUNNING" && current.threadId !== null) return current;
    if (current.status !== "PENDING" || current.revision !== expectedRevision) throw new AuthBoundaryError("REFLECTION_SECTION_STATE_CONFLICT", 409);
    const threadId = randomUUID();
    await this.tx.insert(thread).values({ id: threadId, user_id: sql`${decimalIdDto.parse(canonicalUserId)}::bigint` });
    const rows = await this.tx.update(taskSection).set({ thread_id: threadId, status: "RUNNING", started_at: sql`CURRENT_TIMESTAMP`, revision: sql`${taskSection.revision} + 1`, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(taskSection.task_id, taskId), eq(taskSection.section, sectionName), eq(taskSection.status, "PENDING"), eq(taskSection.revision, expectedRevision))).returning(sectionFields);
    if (!rows[0]) throw new AuthBoundaryError("REFLECTION_SECTION_STATE_CONFLICT", 409);
    return rows[0] as ReflectionSectionStorageRow;
  }

  async transcript(taskId: string, sectionName: string) {
    const bound = (await this.tx.select({ threadId: taskSection.thread_id }).from(taskSection).where(and(eq(taskSection.task_id, taskId), eq(taskSection.section, sectionName))).limit(1))[0];
    if (!bound?.threadId) throw new AuthBoundaryError("REFLECTION_SECTION_THREAD_NOT_READY", 409);
    return this.tx.select({
      id: message.id, role: message.role, parts: message.parts, metadata: message.metadata,
      created_at: sql<string | null>`${message.created_at}::text`, history_final_text: message.history_final_text,
      history_process_available: message.history_process_available, history_projection_version: message.history_projection_version,
    }).from(message).where(eq(message.thread_id, bound.threadId)).orderBy(sql`${message.created_at} ASC NULLS FIRST`, asc(message.id));
  }

  async finishSection(taskRow: ReflectionTaskStorageRow, sectionName: string, expectedRevision: number, outcome: { status: "COMPLETED"; results: readonly { title: string; description: string; related_session_ids: string[]; evidence: string; confidence: string }[] } | { status: "FAILED"; errorSummary: string }) {
    const current = (await this.tx.select(sectionFields).from(taskSection).where(and(eq(taskSection.task_id, taskRow.id), eq(taskSection.section, sectionName))).limit(1).for("update"))[0] as ReflectionSectionStorageRow | undefined;
    if (!current) throw new AuthBoundaryError("REFLECTION_SECTION_NOT_FOUND", 404);
    if (["COMPLETED", "FAILED"].includes(current.status)) throw new AuthBoundaryError("REFLECTION_SECTION_TERMINAL", 409);
    if (current.status !== "RUNNING" || current.revision !== expectedRevision) throw new AuthBoundaryError("REFLECTION_SECTION_STATE_CONFLICT", 409);
    if (outcome.status === "COMPLETED") {
      await this.tx.delete(result).where(and(eq(result.task_id, taskRow.id), eq(result.user_id, sql`${taskRow.userId}::bigint`), eq(result.section, sectionName)));
      if (outcome.results.length) await this.tx.insert(result).values(outcome.results.map(item => ({
        id: randomUUID(), task_id: taskRow.id, user_id: sql`${taskRow.userId}::bigint`, section: sectionName,
        title: item.title, description: item.description, related_session_ids: JSON.stringify(item.related_session_ids), evidence: item.evidence, confidence: item.confidence,
      })));
    }
    const count = outcome.status === "COMPLETED" ? outcome.results.length : 0;
    const rows = await this.tx.update(taskSection).set({
      status: outcome.status, result_count: count, error_summary: outcome.status === "FAILED" ? outcome.errorSummary : null,
      completed_at: sql`CURRENT_TIMESTAMP`, revision: sql`${taskSection.revision} + 1`, updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(and(eq(taskSection.task_id, taskRow.id), eq(taskSection.section, sectionName), eq(taskSection.status, "RUNNING"), eq(taskSection.revision, expectedRevision))).returning(sectionFields);
    if (!rows[0]) throw new AuthBoundaryError("REFLECTION_SECTION_STATE_CONFLICT", 409);
    return rows[0] as ReflectionSectionStorageRow;
  }

  async appendEvent(input: { event_id: string; task_id: string; sequence: number; event_type: string; payload_json: string; created_at: string }) {
    const matches = await this.tx.select({ id: event.id, taskId: event.task_id, sequence: event.sequence, type: event.event_type, payload: event.payload, createdAtMatches: sql<boolean>`${event.created_at} = ${input.created_at}::timestamptz` }).from(event).where(or(eq(event.id, input.event_id), and(eq(event.task_id, input.task_id), eq(event.sequence, input.sequence))));
    if (matches.length) {
      const existing = matches[0];
      if (matches.length !== 1 || existing.id !== input.event_id || existing.taskId !== input.task_id || existing.sequence !== input.sequence || existing.type !== input.event_type || existing.payload !== input.payload_json || !existing.createdAtMatches) throw new AuthBoundaryError("REFLECTION_EVENT_IDENTITY_CONFLICT", 409);
      return existing.id;
    }
    requireNextReflectionEventSequence(await this.lastEventSequence(input.task_id), input.sequence);
    await this.tx.insert(event).values({ id: input.event_id, task_id: input.task_id, sequence: input.sequence, event_type: input.event_type, payload: input.payload_json, created_at: input.created_at });
    return input.event_id;
  }

  async lastEventSequence(taskId: string) {
    const row = (await this.tx.select({ sequence: sql<number>`COALESCE(MAX(${event.sequence}), 0)::int` }).from(event).where(eq(event.task_id, taskId)))[0];
    if (!row || !Number.isInteger(row.sequence) || row.sequence < 0 || row.sequence > postgresInt4Max) throw new AuthBoundaryError("REFLECTION_EVENT_DATA_INVALID");
    return row.sequence;
  }

  async events(taskId: string, afterEventId: string | null) {
    const cursor = afterEventId === null ? null : (await this.tx.select({ sequence: event.sequence }).from(event).where(and(eq(event.id, afterEventId), eq(event.task_id, taskId))).limit(1))[0] ?? null;
    return this.tx.select({ id: event.id, taskId: event.task_id, sequence: event.sequence, type: event.event_type, payloadJson: event.payload, createdAt: sql<string | null>`${event.created_at}::text` })
      .from(event).where(and(eq(event.task_id, taskId), cursor === null ? undefined : sql`${event.sequence} > ${cursor.sequence}`)).orderBy(asc(event.sequence), asc(event.created_at), asc(event.id));
  }

  async reports(canonicalUserId: string, limit: number) {
    return this.tx.select({ id: sql<string>`${report.id}::text`, reportType: report.report_type, reportDataJson: report.report_data_json, createdAt: sql<string | null>`${report.created_at}::text` })
      .from(report).where(eq(report.user_id, sql`${decimalIdDto.parse(canonicalUserId)}::bigint`)).orderBy(desc(report.created_at), desc(report.id)).limit(limit);
  }

  async reportForTask(taskId: string) {
    return (await this.tx.select({ id: sql<string>`${report.id}::text`, reportType: report.report_type }).from(report).where(eq(report.reflection_task_id, taskId)).limit(1))[0] ?? null;
  }

  async insertReport(taskRow: ReflectionTaskStorageRow, reportType: string, reportDataJson: string) {
    const inserted = await this.tx.insert(report).values({ user_id: sql`${taskRow.userId}::bigint`, report_type: reportType, report_data_json: reportDataJson, all_notes_text: null, reflection_task_id: taskRow.id })
      .onConflictDoNothing().returning({ id: sql<string>`${report.id}::text`, reportType: report.report_type });
    return inserted[0] ?? await this.reportForTask(taskRow.id);
  }

  async saveAnalysisReport(canonicalUserId: string, reportType: string, reportDataJson: string, allNotesText: string | null) {
    await this.tx.insert(report).values({ user_id: sql`${decimalIdDto.parse(canonicalUserId)}::bigint`, report_type: reportType, report_data_json: reportDataJson, all_notes_text: allNotesText, reflection_task_id: null });
  }
}
