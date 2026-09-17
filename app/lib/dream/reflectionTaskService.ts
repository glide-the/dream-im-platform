// [Input] Verified OAuth owner or configured Reflections executor, closed command and existing Admin UOW.
// [Output] Validated task aggregate projection; task writes and receipts remain in the same transaction.
// [Pos] Registered Reflections service; no browser token retention, Agent, scheduler, EventBus, SSE or files.
// [Sync] 2026-09-15: return the persisted event high-water mark on every worker restore.
import { createHash } from "node:crypto";
import { isAbsolute, resolve, sep } from "node:path";
import { z } from "zod";
import { reflectionReportListCapacity } from "../../../config/reflection-task-policy";
import { AuthBoundaryError, requiredAuthValue, type DreamServiceClient } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { canonicalContractJson } from "./operationRegistry";
import { decodeChatMessage, pgTimestampToIso } from "./chatThreadDto";
import { inspectMemoryConfig } from "./deckContentCanonical";
import { ReceiptRepository } from "./receipts";
import { issueReflectionTaskAuthority, recoverReflectionTaskAuthority, renewReflectionTaskAuthority, revokeReflectionTaskAuthorities, revokeReflectionTaskAuthority } from "./reflectionTaskAuthorityService";
import { ReflectionTaskRepository, type ReflectionSectionStorageRow, type ReflectionTaskStorageRow } from "./reflectionTaskRepository";
import { reflectionTaskSchemaRequirement, reflectionTaskSchemaRequirements } from "./schemaRequirements";
import * as dto from "./reflectionTaskDto";

export { reflectionTaskSchemaRequirement, reflectionTaskSchemaRequirements };
export type ReflectionTaskOAuthActor = { principal: PrincipalDto; threadScope: null; editorSessionScope?: null; runScope?: null };
export type ReflectionTaskExecutionService = Pick<DreamServiceClient, "id"> & { backgroundScopes: readonly string[] };
export type ReflectionTaskExecutionPolicy = { launchSnapshotMaxBytes: number; workspaceRoot: string };

export function configuredReflectionTaskExecutionPolicy(): ReflectionTaskExecutionPolicy {
  const launchSnapshotMaxBytes = Number(requiredAuthValue("DREAM_REFLECTIONS_LAUNCH_SNAPSHOT_MAX_BYTES"));
  const workspaceRoot = resolve(requiredAuthValue("DREAM_REFLECTIONS_WORKSPACE_ROOT"));
  if (!Number.isSafeInteger(launchSnapshotMaxBytes) || launchSnapshotMaxBytes < 1 || !isAbsolute(workspaceRoot)) throw new AuthBoundaryError("REFLECTION_TASK_POLICY_INVALID");
  return { launchSnapshotMaxBytes, workspaceRoot };
}
function reflectionWorkspacePath(policy: ReflectionTaskExecutionPolicy, taskId: string) {
  const root = resolve(policy.workspaceRoot), path = resolve(root, dto.reflectionTaskIdDto.parse(taskId), "memory");
  if (!path.startsWith(`${root}${sep}`)) throw new AuthBoundaryError("REFLECTION_TASK_POLICY_INVALID");
  return path;
}
export function reflectionTaskReceiptActor(taskId: string) { return `reflection-task:${dto.reflectionTaskIdDto.parse(taskId)}`; }
function requireExecutionScope(service: ReflectionTaskExecutionService) {
  if (!(service.backgroundScopes as readonly string[]).includes("reflections:execute")) throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
}
function parseJson(raw: string, code: string): unknown {
  try { return JSON.parse(raw); } catch { throw new AuthBoundaryError(code); }
}
function timestamp(raw: string | null) {
  try { return pgTimestampToIso(raw); } catch { throw new AuthBoundaryError("REFLECTION_TASK_DATA_INVALID"); }
}
function projectSection(row: ReflectionSectionStorageRow) {
  const parsed = dto.reflectionSectionStateDto.safeParse({
    section: row.section, status: row.status, result_count: row.resultCount, revision: row.revision,
    started_at: timestamp(row.startedAt), completed_at: timestamp(row.completedAt), error_summary: row.errorSummary,
  });
  if (!parsed.success) throw new AuthBoundaryError("REFLECTION_TASK_DATA_INVALID");
  return parsed.data;
}
async function projectTask(store: ReflectionTaskRepository, row: ReflectionTaskStorageRow) {
  const sections = dto.reflectionTaskDto.shape.sections.safeParse(parseJson(row.sectionsJson, "REFLECTION_TASK_DATA_INVALID"));
  const input = dto.reflectionTaskPublicInputDto.safeParse(parseJson(row.inputSnapshotJson, "REFLECTION_TASK_DATA_INVALID"));
  if (!sections.success || !input.success) throw new AuthBoundaryError("REFLECTION_TASK_DATA_INVALID");
  const sectionRows = await store.sections(row.id);
  const byName = new Map(sectionRows.map(item => [item.section, item]));
  const ordered = sections.data.flatMap(section => byName.has(section) ? [projectSection(byName.get(section)!)] : []);
  const projected = dto.reflectionTaskDto.safeParse({
    id: row.id, task_id: row.id, status: row.status, sections: sections.data, input_snapshot: input.data,
    workspace_path: row.workspacePath, agent_contract_version: row.agentContractVersion, error_summary: row.errorSummary,
    revision: row.revision, created_at: timestamp(row.createdAt), started_at: timestamp(row.startedAt),
    completed_at: timestamp(row.completedAt), updated_at: timestamp(row.updatedAt), section_states: ordered,
  });
  if (!projected.success) throw new AuthBoundaryError("REFLECTION_TASK_DATA_INVALID");
  return projected.data;
}
function projectResults(rows: Awaited<ReturnType<ReflectionTaskRepository["results"]>>) {
  try {
    return rows.map(row => dto.reflectionResultDto.parse({
      id: row.id, task_id: row.taskId, section: row.section, title: row.title, description: row.description,
      related_session_ids: JSON.parse(row.relatedSessionIdsJson || "[]"), evidence: row.evidence ?? "", confidence: row.confidence,
      created_at: timestamp(row.createdAt),
    }));
  } catch { throw new AuthBoundaryError("REFLECTION_TASK_DATA_INVALID"); }
}
async function taskAndResults(store: ReflectionTaskRepository, row: ReflectionTaskStorageRow) {
  return dto.reflectionTaskGetOutputDto.parse({ task: await projectTask(store, row), results: projectResults(await store.results(row.id, row.userId)) });
}
function assertOAuth(actor: ReflectionTaskOAuthActor, scope: "dream:read" | "dream:write") {
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(scope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null || (actor.editorSessionScope ?? null) !== null || (actor.runScope ?? null) !== null) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
  return principal;
}

export async function runReflectionTaskUserOperation(name: dto.ReflectionTaskUserOperation, rawInput: unknown, actor: ReflectionTaskOAuthActor, tx: DataTransaction, serviceId: string, requestId: string) {
  const contract = dto.reflectionTaskOperationContracts[name];
  if (!contract || contract.audience !== "oauth") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const input = contract.input.safeParse(rawInput);
  if (!input.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = assertOAuth(actor, contract.userScope);
  const store = new ReflectionTaskRepository(tx);
  const action = async () => {
    if (name === "reflection-task.create") {
      const value = dto.reflectionTaskCreateInputDto.parse(input.data);
      const taskId = await store.create(principal.canonical_user_id, principal.subject, serviceId, value.sections, value.input_snapshot);
      return taskAndResults(store, (await store.readOwned(principal.canonical_user_id, taskId))!);
    }
    if (name === "reflection-task.start") {
      const value = dto.reflectionTaskLookupDto.parse(input.data);
      const original = await store.readOwned(principal.canonical_user_id, value.task_id, true);
      if (!original) throw new AuthBoundaryError("REFLECTION_TASK_NOT_FOUND", 404);
      const sections = dto.reflectionTaskDto.shape.sections.safeParse(parseJson(original.sectionsJson, "REFLECTION_TASK_DATA_INVALID"));
      if (!sections.success) throw new AuthBoundaryError("REFLECTION_TASK_DATA_INVALID");
      await store.insertMissingSections(original, sections.data);
      const row = await store.adoptOwned(value.task_id, principal.canonical_user_id, principal.subject, serviceId);
      const terminal = dto.reflectionTerminalStatusDto.safeParse(row.status).success;
      return dto.reflectionTaskStartOutputDto.parse({ task: await projectTask(store, row), terminal, report_missing: terminal && await store.reportForTask(row.id) === null });
    }
    if (name === "reflection-task.get") {
      const value = dto.reflectionTaskLookupDto.parse(input.data), row = await store.readOwned(principal.canonical_user_id, value.task_id);
      if (!row) throw new AuthBoundaryError("REFLECTION_TASK_NOT_FOUND", 404);
      return taskAndResults(store, row);
    }
    if (name === "reflection-task.latest") {
      const latest = await store.latestOwned(principal.canonical_user_id), terminal = await store.latestTerminalOwned(principal.canonical_user_id);
      return dto.reflectionTaskLatestOutputDto.parse({ task: latest ? await projectTask(store, latest) : null, results: terminal ? projectResults(await store.results(terminal.id, principal.canonical_user_id)) : [] });
    }
    if (name === "reflection-task.events") {
      const value = dto.reflectionEventListInputDto.parse(input.data), row = await store.readOwned(principal.canonical_user_id, value.task_id);
      if (!row) throw new AuthBoundaryError("REFLECTION_TASK_NOT_FOUND", 404);
      const events = (await store.events(value.task_id, value.after_event_id)).map(item => {
        const parsed = dto.reflectionEventDto.safeParse({ id: item.id, task_id: item.taskId, sequence: item.sequence, type: item.type, created_at: timestamp(item.createdAt), payload: parseJson(item.payloadJson, "REFLECTION_EVENT_DATA_INVALID") });
        if (!parsed.success) throw new AuthBoundaryError("REFLECTION_EVENT_DATA_INVALID");
        return parsed.data;
      });
      return dto.reflectionEventListOutputDto.parse({ events });
    }
    if (name === "analysis-report.list") {
      const value = dto.analysisReportListInputDto.parse(input.data);
      if (value.limit > reflectionReportListCapacity()) throw new AuthBoundaryError("REFLECTION_REPORT_LIMIT_EXCEEDED", 400);
      const rows = await store.reports(principal.canonical_user_id, value.limit);
      const reports = rows.map(row => {
        return dto.analysisReportDto.parse({ id: row.id, report_type: row.reportType, report_data_json: row.reportDataJson, created_at: timestamp(row.createdAt) });
      });
      return dto.analysisReportListOutputDto.parse({ reports });
    }
    if (name === "analysis-report.save") {
      const value = dto.analysisReportSaveInputDto.parse(input.data);
      await store.saveAnalysisReport(principal.canonical_user_id, value.report_type, value.report_data_json, value.all_notes_text);
      return dto.analysisReportSaveOutputDto.parse({ success: true });
    }
    throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  };
  return contract.kind === "read" ? action() : new ReceiptRepository(tx, serviceId, principal.subject).execute(name, requestId, input.data, contract.output as z.ZodType, action);
}

function labels(raw: string | null) {
  try { const value: unknown = raw ? JSON.parse(raw) : []; return Array.isArray(value) ? value.map(item => String(item)).filter(item => item.trim()) : []; } catch { return []; }
}
function sessionText(raw: string) {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || !("cells" in value) || !Array.isArray(value.cells)) return { firstLine: "", text: "" };
    const texts = value.cells.flatMap(cell => cell && typeof cell === "object" && "type" in cell && cell.type === "text" && "content" in cell && typeof cell.content === "string" && cell.content.trim() ? [cell.content.trim()] : []);
    const text = texts.join("\n\n").trim();
    return { firstLine: Array.from(text.split("\n")[0] ?? "").slice(0, 30).join(""), text };
  } catch { return { firstLine: "", text: "" }; }
}
async function buildLaunchSnapshot(store: ReflectionTaskRepository, row: ReflectionTaskStorageRow, sections: readonly z.infer<typeof dto.reflectionSectionDto>[]) {
  const input = dto.reflectionTaskPublicInputDto.parse(parseJson(row.inputSnapshotJson, "REFLECTION_TASK_DATA_INVALID"));
  const source = await store.sourceSessions(row.userId, input);
  const sessions = source.map(item => {
    const text = sessionText(item.stateJson);
    return dto.reflectionSessionSnapshotDto.parse({ id: item.id, name: item.name, created_at: timestamp(item.createdAt), updated_at: timestamp(item.updatedAt), labels: labels(item.labelsJson), first_line: text.firstLine, text: text.text });
  });
  const prompts = new Map((await store.customPrompts(row.userId, sections)).map(item => [item.section, item.promptFilesJson]));
  const customPrompts = [];
  for (const section of sections) {
    const raw = prompts.get(section) ?? null;
    const promptFilesJson = raw !== null && (await inspectMemoryConfig(raw)).is_object ? raw : null;
    customPrompts.push({ section, prompt_files_json: promptFilesJson });
  }
  const days = new Set(sessions.map(item => (item.created_at ?? item.updated_at ?? "").slice(0, 10)).filter(Boolean)).size;
  const words = sessions.reduce((total, item) => total + item.text.split(/\s+/u).filter(Boolean).length, 0);
  return dto.reflectionLaunchSnapshotDto.parse({ schema_version: 1, task_id: row.id, language: input.language, sessions, custom_prompts: customPrompts, stats: { days, entries: sessions.length, words } });
}
function parseLaunchSnapshot(row: ReflectionTaskStorageRow) {
  if (row.launchSnapshotJson === null) throw new AuthBoundaryError("REFLECTION_LAUNCH_SNAPSHOT_MISSING");
  const parsed = dto.reflectionLaunchSnapshotDto.safeParse(parseJson(row.launchSnapshotJson, "REFLECTION_LAUNCH_SNAPSHOT_INVALID"));
  if (!parsed.success || parsed.data.task_id !== row.id) throw new AuthBoundaryError("REFLECTION_LAUNCH_SNAPSHOT_INVALID");
  return parsed.data;
}
function snapshotDigest(snapshot: dto.ReflectionLaunchSnapshot) { return createHash("sha256").update(canonicalContractJson(snapshot)).digest("hex"); }
const workerReceiptOutputDto = z.strictObject({ task_id: dto.reflectionTaskIdDto, revision: z.number().int().positive().safe(), snapshot_sha256: z.string().regex(/^[0-9a-f]{64}$/) });
const sectionBeginReceiptOutputDto = z.strictObject({ section: dto.reflectionSectionDto, thread_id: dto.reflectionTaskIdDto, status: z.literal("RUNNING"), revision: z.number().int().positive().safe(), authority_token_sha256: z.string().regex(/^[0-9a-f]{64}$/) });
function requireServiceTask(store: ReflectionTaskRepository, taskId: string, serviceId: string) {
  return store.readForService(taskId, serviceId, true).then(row => {
    if (!row) throw new AuthBoundaryError("REFLECTION_TASK_NOT_FOUND", 404);
    return row;
  });
}

export async function runReflectionTaskBackgroundOperation(name: dto.ReflectionTaskBackgroundOperation, rawInput: unknown, service: ReflectionTaskExecutionService, tx: DataTransaction, requestId: string, policy = configuredReflectionTaskExecutionPolicy()) {
  requireExecutionScope(service);
  const contract = dto.reflectionTaskOperationContracts[name];
  if (!contract || contract.audience !== "background") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const input = contract.input.safeParse(rawInput);
  if (!input.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const taskId = dto.reflectionTaskIdDto.parse(input.data.task_id), store = new ReflectionTaskRepository(tx);
  let row = await requireServiceTask(store, taskId, service.id);
  const receipts = new ReceiptRepository(tx, service.id, reflectionTaskReceiptActor(taskId));

  if (name === "reflection-section.transcript") {
    const value = dto.reflectionSectionTranscriptInputDto.parse(input.data);
    const messages = (await store.transcript(taskId, value.section)).map(item => decodeChatMessage(item, "canonical"));
    return dto.reflectionSectionTranscriptOutputDto.parse({ section: value.section, messages });
  }
  if (name === "reflection-task.worker-load") {
    const receipt = await receipts.execute(name, requestId, input.data, workerReceiptOutputDto, async () => {
      const sections = dto.reflectionTaskDto.shape.sections.safeParse(parseJson(row.sectionsJson, "REFLECTION_TASK_DATA_INVALID"));
      if (!sections.success) throw new AuthBoundaryError("REFLECTION_TASK_DATA_INVALID");
      await store.insertMissingSections(row, sections.data);
      let snapshot = row.launchSnapshotJson === null ? await buildLaunchSnapshot(store, row, sections.data) : parseLaunchSnapshot(row);
      const bytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
      if (bytes > policy.launchSnapshotMaxBytes) throw new AuthBoundaryError("REFLECTION_LAUNCH_SNAPSHOT_TOO_LARGE", 413);
      if (row.launchSnapshotJson === null) {
        const publicInput = dto.reflectionTaskPublicInputDto.parse({ ...JSON.parse(row.inputSnapshotJson), session_count: snapshot.sessions.length });
        row = await store.materializeLaunchSnapshot(row, JSON.stringify(snapshot), JSON.stringify(publicInput), reflectionWorkspacePath(policy, taskId));
        snapshot = parseLaunchSnapshot(row);
      } else {
        row = await store.ensureWorkspacePath(row, reflectionWorkspacePath(policy, taskId));
      }
      return { task_id: row.id, revision: row.revision, snapshot_sha256: snapshotDigest(snapshot) };
    });
    row = await requireServiceTask(store, taskId, service.id);
    const snapshot = parseLaunchSnapshot(row);
    if (receipt.snapshot_sha256 !== snapshotDigest(snapshot)) throw new AuthBoundaryError("REFLECTION_LAUNCH_SNAPSHOT_INVALID");
    return dto.reflectionWorkerLoadOutputDto.parse({ task: await projectTask(store, row), launch_snapshot: snapshot, last_event_sequence: await store.lastEventSequence(taskId) });
  }
  if (name === "reflection-task.advance") {
    const value = dto.reflectionTaskAdvanceInputDto.parse(input.data);
    return receipts.execute(name, requestId, value, dto.reflectionTaskAdvanceOutputDto, async () => {
      let terminal: { status: string; errorSummary: string | null } | undefined;
      if (value.action === "fatal-fail") {
        await store.failPendingSections(taskId, value.error_summary);
        await revokeReflectionTaskAuthorities(tx, taskId);
        terminal = { status: "FAILED", errorSummary: value.error_summary };
      } else if (value.action === "finalize") {
        if (value.error_summary !== null) await store.failPendingSections(taskId, value.error_summary);
        const sectionRows = await store.sections(taskId, true);
        if (!sectionRows.length || sectionRows.some(item => !["COMPLETED", "FAILED"].includes(item.status))) throw new AuthBoundaryError("REFLECTION_SECTIONS_NOT_TERMINAL", 409);
        const completed = sectionRows.filter(item => item.status === "COMPLETED"), failed = sectionRows.filter(item => item.status === "FAILED");
        terminal = { status: completed.length === sectionRows.length ? "COMPLETED" : completed.length ? "PARTIAL_FAILED" : "FAILED", errorSummary: failed.length ? value.error_summary ?? `Failed sections: ${failed.map(item => item.section).join(", ")}` : null };
        await revokeReflectionTaskAuthorities(tx, taskId);
      }
      row = await store.advance(row, value.action, value.expected_revision, terminal);
      return { status: dto.reflectionTaskStatusDto.parse(row.status), revision: row.revision };
    });
  }
  if (name === "reflection-section.begin") {
    const value = dto.reflectionSectionBeginInputDto.parse(input.data);
    const stored = await receipts.execute(name, requestId, value, sectionBeginReceiptOutputDto, async () => {
      if (row.status !== "RUNNING") throw new AuthBoundaryError("REFLECTION_TASK_NOT_RUNNING", 409);
      const section = await store.beginSection(taskId, value.section, value.expected_revision, row.userId);
      const issued = await issueReflectionTaskAuthority(tx, row, section, service.id, requestId);
      return { section: value.section, thread_id: section.threadId!, status: "RUNNING" as const, revision: section.revision, authority_token_sha256: issued.tokenHash };
    });
    const section = (await store.sections(taskId, true)).find(item => item.section === value.section);
    if (!section || section.threadId !== stored.thread_id || section.revision !== stored.revision) throw new AuthBoundaryError("REFLECTION_AUTHORITY_BINDING_CONFLICT", 409);
    const authority = await recoverReflectionTaskAuthority(tx, stored.authority_token_sha256, row, section, service.id);
    return dto.reflectionSectionBeginOutputDto.parse({ section: stored.section, thread_id: stored.thread_id, status: stored.status, revision: stored.revision, authority });
  }
  if (name === "reflection-section.authority-renew") {
    const value = dto.reflectionSectionAuthorityInputDto.parse(input.data);
    return receipts.execute(name, requestId, value, dto.reflectionSectionAuthorityRenewOutputDto, async () => {
      const section = (await store.sections(taskId, true)).find(item => item.section === value.section);
      if (!section) throw new AuthBoundaryError("REFLECTION_SECTION_NOT_FOUND", 404);
      return renewReflectionTaskAuthority(tx, row, section, service.id);
    });
  }
  if (name === "reflection-section.authority-revoke") {
    const value = dto.reflectionSectionAuthorityInputDto.parse(input.data);
    return receipts.execute(name, requestId, value, dto.reflectionSectionAuthorityRevokeOutputDto, async () => {
      await revokeReflectionTaskAuthority(tx, taskId, value.section); return { revoked: true as const };
    });
  }
  if (name === "reflection-section.finish") {
    const value = dto.reflectionSectionFinishInputDto.parse(input.data);
    return receipts.execute(name, requestId, value, dto.reflectionSectionFinishOutputDto, async () => {
      if (row.status !== "RUNNING") throw new AuthBoundaryError("REFLECTION_TASK_NOT_RUNNING", 409);
      if (value.outcome === "completed") {
        const allowed = new Set(parseLaunchSnapshot(row).sessions.map(item => item.id));
        if (value.results.some(item => item.related_session_ids.some(id => !allowed.has(id)))) throw new AuthBoundaryError("REFLECTION_RESULT_SESSION_DENIED", 400);
      }
      const section = await store.finishSection(row, value.section, value.expected_revision, value.outcome === "completed" ? { status: "COMPLETED", results: value.results } : { status: "FAILED", errorSummary: value.error_summary });
      await revokeReflectionTaskAuthority(tx, taskId, value.section);
      return { section: value.section, status: section.status as "COMPLETED" | "FAILED", result_count: section.resultCount, revision: section.revision };
    });
  }
  if (name === "reflection-event.append") {
    const value = dto.reflectionEventAppendInputDto.parse(input.data), payloadJson = canonicalContractJson(value.payload);
    return receipts.execute(name, requestId, value, dto.reflectionEventAppendOutputDto, async () => {
      await store.appendEvent({ event_id: value.event_id, task_id: taskId, sequence: value.sequence, event_type: value.event_type, payload_json: payloadJson, created_at: value.created_at });
      return { event_id: value.event_id, accepted: true as const };
    });
  }
  if (name === "reflection-report.ensure") {
    return receipts.execute(name, requestId, input.data, dto.reflectionReportEnsureOutputDto, async () => {
      if (!dto.reflectionTerminalStatusDto.safeParse(row.status).success) throw new AuthBoundaryError("REFLECTION_TASK_NOT_TERMINAL", 409);
      const existing = await store.reportForTask(taskId);
      if (existing) return { report_id: existing.id, report_type: existing.reportType, created: false };
      const snapshot = parseLaunchSnapshot(row), sections = await store.sections(taskId), persisted = projectResults(await store.results(taskId, row.userId));
      const completed = sections.filter(item => item.status === "COMPLETED").map(item => dto.reflectionSectionDto.parse(item.section));
      if (!persisted.length || !completed.length) return { report_id: null, report_type: null, created: false };
      const bySection = Object.fromEntries(dto.reflectionSectionDto.options.map(section => [section, persisted.filter(item => item.section === section)]));
      const reportType = new Set(completed).size === dto.reflectionSectionDto.options.length ? "full_analysis" : completed.length === 1 ? `reflections_${completed[0]}` : "reflections_partial";
      const inserted = await store.insertReport(row, reportType, canonicalContractJson({ ...bySection, stats: snapshot.stats }));
      if (!inserted) throw new AuthBoundaryError("REFLECTION_REPORT_WRITE_FAILED");
      return { report_id: inserted.id, report_type: inserted.reportType, created: true };
    });
  }
  throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
}

export async function readOriginalReflectionTaskBackgroundReceipt(name: dto.ReflectionTaskBackgroundOperation, taskId: string, originalRequestId: string, service: ReflectionTaskExecutionService, tx: DataTransaction) {
  requireExecutionScope(service);
  const contract = dto.reflectionTaskOperationContracts[name];
  if (!contract || contract.audience !== "background" || contract.kind !== "write" || name === "reflection-section.transcript") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  dto.reflectionTaskIdDto.parse(taskId);
  const store = new ReflectionTaskRepository(tx), row = await requireServiceTask(store, taskId, service.id);
  const receipt = await new ReceiptRepository(tx, service.id, reflectionTaskReceiptActor(taskId)).find(name, originalRequestId);
  if (!receipt) return null;
  if (!/^[0-9a-f]{64}$/.test(receipt.inputSha256) || receipt.threadScope !== null || receipt.editorSessionScope !== null || receipt.runScope !== null) throw new AuthBoundaryError("REFLECTION_RECEIPT_DATA_INVALID");
  if (name === "reflection-task.worker-load") {
    const stored = workerReceiptOutputDto.safeParse(receipt.result), snapshot = parseLaunchSnapshot(row);
    if (!stored.success || stored.data.task_id !== taskId || stored.data.snapshot_sha256 !== snapshotDigest(snapshot)) throw new AuthBoundaryError("REFLECTION_RECEIPT_DATA_INVALID");
    return dto.reflectionWorkerLoadOutputDto.parse({ task: await projectTask(store, row), launch_snapshot: snapshot, last_event_sequence: await store.lastEventSequence(taskId) });
  }
  if (name === "reflection-section.begin") {
    const stored = sectionBeginReceiptOutputDto.safeParse(receipt.result), section = (await store.sections(taskId, true)).find(item => item.section === (stored.success ? stored.data.section : ""));
    if (!stored.success || !section || section.threadId !== stored.data.thread_id || section.revision !== stored.data.revision) throw new AuthBoundaryError("REFLECTION_RECEIPT_DATA_INVALID");
    const authority = await recoverReflectionTaskAuthority(tx, stored.data.authority_token_sha256, row, section, service.id);
    return dto.reflectionSectionBeginOutputDto.parse({ section: stored.data.section, thread_id: stored.data.thread_id, status: stored.data.status, revision: stored.data.revision, authority });
  }
  const parsed = contract.output.safeParse(receipt.result);
  if (!parsed.success) throw new AuthBoundaryError("REFLECTION_RECEIPT_DATA_INVALID");
  return parsed.data;
}
