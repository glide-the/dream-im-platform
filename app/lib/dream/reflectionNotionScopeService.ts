// [Input] OAuth actor or Reflections service, existing task/section and connector ownership.
// [Output] Frozen metadata scope, current read authorization and first-read page evidence.
// [Pos] Reflections source evidence in the existing Admin transaction and JSON storage.
// [Sync] 2026-10-23: create without remote bodies; fence every read to task/section/current connector scope.
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { reflection_task as task } from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { NotionConnectorRepository } from "./notionConnectorRepository";
import { ReceiptRepository } from "./receipts";
import { ReflectionTaskRepository } from "./reflectionTaskRepository";
import { configuredReflectionTaskExecutionPolicy, runReflectionTaskUserOperation, type ReflectionTaskOAuthActor, type ReflectionTaskExecutionService } from "./reflectionTaskService";
import { validateReflectionAnalysisSelection, canonicalNotionPageId } from "./reflectionAnalysisContentService";
import * as dto from "./reflectionNotionScopeDto";
import { notionLightSnapshotDto } from "./notionLightSnapshotDto";
import { reflectionTaskGetOutputDto } from "./reflectionTaskDto";
export const reflectionScopeContractVersion = "reflections-analysis-content-v2";
export async function readReflectionScopeInput(tx: DataTransaction, taskId: string) {
  const row = (await tx.select({ content: task.analysis_content_json }).from(task).where(eq(task.id, taskId)).limit(1))[0];
  if (!row?.content) throw new AuthBoundaryError("REFLECTION_ANALYSIS_INPUT_MISSING", 409);
  try { return dto.reflectionScopeSnapshotDto.parse(JSON.parse(row.content)); }
  catch { throw new AuthBoundaryError("REFLECTION_ANALYSIS_INPUT_INVALID", 503); }
}
async function acceptedScope(tx: DataTransaction, userId: string, selection: z.infer<typeof dto.reflectionNotionScopeSelectionDto>) {
  const repository = new NotionConnectorRepository(tx, userId);
  const connector = await repository.requireConnector(selection.connector_id, { lock: true });
  if (connector.auth_status !== "authenticated") throw new AuthBoundaryError("NOTION_AUTH_REQUIRED", 409);
  if (connector.current_snapshot_version !== selection.snapshot_version) throw new AuthBoundaryError("NOTION_SNAPSHOT_CHANGED", 409);
  const rawSnapshot = await repository.snapshot(connector.id, selection.snapshot_version);
  if (!rawSnapshot) throw new AuthBoundaryError("NOTION_SNAPSHOT_UNAVAILABLE", 409);
  const snapshot = notionLightSnapshotDto.parse(rawSnapshot);
  for (const [kind, ids] of [["notion_page", snapshot.connector.selected_pages], ["notion_database", snapshot.connector.selected_databases]] as const) {
    const current = new Set(connector.sources.filter(source => source.resource_type === kind).map(source => canonicalNotionPageId(source.external_id)));
    if (ids.length !== current.size || ids.some(id => !current.has(canonicalNotionPageId(id)))) throw new AuthBoundaryError("NOTION_ANALYSIS_SCOPE_CHANGED", 409);
  }
  return snapshot;
}
export async function runReflectionScopeUserOperation(name: dto.ReflectionNotionScopeOperation, raw: unknown, actor: ReflectionTaskOAuthActor, tx: DataTransaction, serviceId: string, requestId: string) {
  const principal = principalDto.parse(actor.principal);
  const scope = name === "reflection-task.v2.create-with-content" ? "dream:write" : "dream:read";
  if (!principal.scopes.includes(scope) || actor.threadScope !== null || actor.editorSessionScope != null || actor.runScope != null) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
  if (name === "reflection-task.v2.analysis-content") {
    const { task_id } = dto.reflectionNotionScopeOperations[name].input.parse(raw);
    const row = await new ReflectionTaskRepository(tx).readOwned(principal.canonical_user_id, task_id);
    if (!row) throw new AuthBoundaryError("REFLECTION_TASK_NOT_FOUND", 404);
    return { analysis_content: row.agentContractVersion === reflectionScopeContractVersion ? dto.reflectionScopeSummary(await readReflectionScopeInput(tx, task_id)) : null };
  }
  if (name !== "reflection-task.v2.create-with-content") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const input = dto.reflectionScopeCreateDto.parse(raw);
  return new ReceiptRepository(tx, serviceId, principal.subject).execute(name, requestId, input, dto.reflectionNotionScopeOperations[name].output, async () => {
    const agent = (await validateReflectionAnalysisSelection({ ...input.analysis_content, notion: null }, principal.canonical_user_id, tx)).agent;
    const selected = input.analysis_content.notion;
    const content = dto.reflectionScopeSnapshotDto.parse({ ...input.analysis_content, agent,
      notion: selected ? { ...selected, snapshot: await acceptedScope(tx, principal.canonical_user_id, selected), pages: [], empty_page_ids: [] } : null });
    if (Buffer.byteLength(JSON.stringify(content), "utf8") > configuredReflectionTaskExecutionPolicy().launchSnapshotMaxBytes) throw new AuthBoundaryError("REFLECTION_LAUNCH_SNAPSHOT_TOO_LARGE", 413);
    const created = reflectionTaskGetOutputDto.parse(await runReflectionTaskUserOperation("reflection-task.create", { sections: input.sections, input_snapshot: input.input_snapshot }, actor, tx, serviceId, requestId));
    await tx.update(task).set({ analysis_content_json: JSON.stringify(content), agent_contract_version: reflectionScopeContractVersion }).where(eq(task.id, created.task.task_id));
    return { ...created, task: { ...created.task, agent_contract_version: reflectionScopeContractVersion } };
  });
}
export async function runReflectionScopeBackgroundOperation(name: dto.ReflectionNotionScopeOperation, raw: unknown, service: ReflectionTaskExecutionService, tx: DataTransaction) {
  if (!service.backgroundScopes.includes("reflections:execute")) throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
  const input = dto.reflectionNotionScopeOperations[name].input.parse(raw);
  if (!("task_id" in input)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const store = new ReflectionTaskRepository(tx);
  const row = await store.readForService(input.task_id, service.id, true);
  if (!row || row.agentContractVersion !== reflectionScopeContractVersion) throw new AuthBoundaryError("REFLECTION_TASK_NOT_FOUND", 404);
  const content = await readReflectionScopeInput(tx, row.id);
  if (name === "reflection-task.v2.analysis-content-load") return { analysis_content: content };
  const binding = dto.reflectionNotionReadContextDto.parse(name === "reflection-task.v2.notion-evidence" ? (() => { const { page: _page, ...rest } = dto.reflectionNotionEvidenceInputDto.parse(raw); return rest; })() : raw);
  const section = (await store.sections(row.id, true)).find(item => item.section === binding.section);
  if (!section || section.status !== "RUNNING" || section.threadId !== binding.thread_id || section.revision !== binding.section_revision || row.status !== "RUNNING") throw new AuthBoundaryError("REFLECTION_SECTION_CONFLICT", 409);
  const notion = content.notion;
  const indexed = notion?.snapshot.index.find(page => canonicalNotionPageId(page.page_id) === canonicalNotionPageId(binding.page_id));
  if (!notion || !indexed || (indexed as { archived?: boolean }).archived) throw new AuthBoundaryError("REFLECTION_NOTION_REFERENCE_DENIED", 403);
  const current = await new NotionConnectorRepository(tx, row.userId).requireConnector(notion.connector_id, { lock: true });
  if (current.auth_status !== "authenticated" || !current.current_snapshot_version) throw new AuthBoundaryError("NOTION_AUTH_REQUIRED", 409);
  const live = await acceptedScope(tx, row.userId, { connector_id: current.id, snapshot_version: current.current_snapshot_version });
  if (!live.index.some(page => canonicalNotionPageId(page.page_id) === canonicalNotionPageId(binding.page_id))) throw new AuthBoundaryError("REFLECTION_NOTION_REFERENCE_DENIED", 403);
  const existing = notion.pages.find(page => page.page_id === binding.page_id) ?? null;
  if (name === "reflection-task.v2.notion-context" || existing) return { page: existing };
  const { page } = dto.reflectionNotionEvidenceInputDto.parse(raw);
  if (page.page_id !== binding.page_id || page.title !== indexed.title || (page.url !== null && page.url !== indexed.url)
    || createHash("sha256").update(page.markdown, "utf8").digest("hex") !== page.content_sha256) throw new AuthBoundaryError("NOTION_ANALYSIS_INPUT_INVALID", 400);
  notion.pages.push(page);
  if (Buffer.byteLength(JSON.stringify(content), "utf8") > configuredReflectionTaskExecutionPolicy().launchSnapshotMaxBytes) throw new AuthBoundaryError("REFLECTION_LAUNCH_SNAPSHOT_TOO_LARGE", 413);
  await tx.update(task).set({ analysis_content_json: JSON.stringify(content) }).where(eq(task.id, row.id));
  return { page };
}
