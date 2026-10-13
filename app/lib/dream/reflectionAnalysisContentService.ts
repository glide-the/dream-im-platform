// [Input] Owner/service-scoped task, existing Deck/Notion repositories and strict content DTOs.
// [Output] Transactional immutable task input, safe owner summary and task-bound worker reads.
// [Pos] Additive Reflections input service; no provider, credential, model or Runtime settings.
// [Sync] 2026-10-13: validate full indexed scope and resolve Agent instructions only inside Admin.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { reflection_task as task } from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto, principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { DeckChatContextRepository } from "./deckChatContextRepository";
import { NotionConnectorRepository } from "./notionConnectorRepository";
import { ReceiptRepository } from "./receipts";
import { reflectionTaskGetOutputDto } from "./reflectionTaskDto";
import { ReflectionTaskRepository } from "./reflectionTaskRepository";
import { configuredReflectionTaskExecutionPolicy, runReflectionTaskUserOperation, type ReflectionTaskOAuthActor, type ReflectionTaskExecutionService } from "./reflectionTaskService";
import * as dto from "./reflectionAnalysisContentDto";

export const reflectionAnalysisContractVersion = "reflections-analysis-content-v1";
export { reflectionAnalysisSchemaRequirement } from "./schemaRequirements";

export function canonicalNotionPageId(id: string) {
  return /^[0-9a-f-]{32,36}$/i.test(id) && id.replaceAll("-", "").length === 32 ? id.replaceAll("-", "").toLowerCase() : id;
}
export async function validateReflectionAnalysisSelection(input: z.infer<typeof dto.reflectionAnalysisSelectionDto>, canonicalUserId: string, tx: DataTransaction) {
  let agent: z.infer<typeof dto.reflectionAgentSnapshotDto> | null = null;
  if (input.agent !== null) {
    const context = await new DeckChatContextRepository(tx, canonicalUserId).resolve({ deck_id: input.agent.deck_id, voice_id: input.agent.agent_id });
    const voice = context.voices.find(item => item.id === input.agent!.agent_id && item.enabled === true);
    if (context.deck.enabled !== true || !voice) throw new AuthBoundaryError("REFLECTION_AGENT_UNAVAILABLE", 409);
    agent = { ...input.agent, deck_name: context.deck.name, agent_name: voice.name, system_prompt: voice.system_prompt };
  }
  if (input.notion !== null) {
    const repository = new NotionConnectorRepository(tx, canonicalUserId);
    const connector = await repository.requireConnector(input.notion.connector_id, { lock: true });
    if (connector.auth_status !== "authenticated") throw new AuthBoundaryError("NOTION_AUTH_REQUIRED", 409);
    if (connector.current_snapshot_version !== input.notion.snapshot_version) throw new AuthBoundaryError("NOTION_SNAPSHOT_CHANGED", 409);
    const snapshot = await repository.snapshot(connector.id, input.notion.snapshot_version);
    if (snapshot === null) throw new AuthBoundaryError("NOTION_SNAPSHOT_UNAVAILABLE", 409);
    const mounted = z.object({ selected_pages: z.array(z.string()), selected_databases: z.array(z.string()) }).parse(snapshot.connector);
    for (const [kind, ids] of [["notion_page", mounted.selected_pages], ["notion_database", mounted.selected_databases]] as const) {
      const current = new Set(connector.sources.filter(source => source.resource_type === kind).map(source => canonicalNotionPageId(source.external_id)));
      if (ids.length !== current.size || ids.some(id => !current.has(canonicalNotionPageId(id)))) throw new AuthBoundaryError("NOTION_ANALYSIS_SCOPE_CHANGED", 409);
    }
    const indexedPages = z.array(z.object({ page_id: z.string(), title: z.string(), url: z.string(),
      archived: z.boolean().optional(), in_trash: z.boolean().optional() })).parse(snapshot.index)
      .filter(page => page.archived !== true && page.in_trash !== true);
    const expected = new Set(indexedPages.map(page => canonicalNotionPageId(page.page_id)));
    const actual = [...input.notion.pages.map(page => canonicalNotionPageId(page.page_id)), ...input.notion.empty_page_ids.map(canonicalNotionPageId)];
    if (new Set(actual).size !== actual.length || actual.length !== expected.size || actual.some(id => !expected.has(id))) throw new AuthBoundaryError("NOTION_ANALYSIS_SCOPE_CHANGED", 409);
    for (const page of input.notion.pages) {
      const index = indexedPages.find(item => canonicalNotionPageId(item.page_id) === canonicalNotionPageId(page.page_id));
      if (!index || page.title !== index.title || (page.url !== null && page.url !== index.url)) throw new AuthBoundaryError("NOTION_ANALYSIS_INPUT_INVALID", 400);
      if (!page.markdown.trim() || createHash("sha256").update(page.markdown, "utf8").digest("hex") !== page.content_sha256) throw new AuthBoundaryError("NOTION_ANALYSIS_INPUT_INVALID", 400);
    }
  }
  return dto.reflectionAnalysisSnapshotDto.parse({ notion: input.notion, agent, diary_session_ids: input.diary_session_ids });
}

export async function readReflectionAnalysisInput(tx: DataTransaction, taskId: string) {
  const row = (await tx.select({ content: task.analysis_content_json }).from(task).where(eq(task.id, taskId)).limit(1))[0];
  if (!row || row.content === null) throw new AuthBoundaryError("REFLECTION_ANALYSIS_INPUT_MISSING", 409);
  try { return dto.reflectionAnalysisSnapshotDto.parse(JSON.parse(row.content)); }
  catch { throw new AuthBoundaryError("REFLECTION_ANALYSIS_INPUT_INVALID", 503); }
}

export async function runReflectionAnalysisUserOperation(name: Exclude<dto.ReflectionAnalysisOperation, "reflection-task.analysis-content-load">, raw: unknown, actor: ReflectionTaskOAuthActor, tx: DataTransaction, serviceId: string, requestId: string) {
  const contract = dto.reflectionAnalysisContentOperations[name], principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope) || actor.threadScope !== null || actor.editorSessionScope != null || actor.runScope != null) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
  const repository = new ReflectionTaskRepository(tx);
  if (name === "reflection-task.analysis-content") {
    const { task_id } = dto.reflectionAnalysisContentOperations[name].input.parse(raw);
    const row = await repository.readOwned(principal.canonical_user_id, task_id);
    if (!row) throw new AuthBoundaryError("REFLECTION_TASK_NOT_FOUND", 404);
    return dto.reflectionAnalysisSummaryOutputDto.parse({ analysis_content: row.agentContractVersion === reflectionAnalysisContractVersion ? dto.reflectionAnalysisSummary(await readReflectionAnalysisInput(tx, task_id)) : null });
  }
  const input = dto.reflectionAnalysisCreateDto.parse(raw);
  return new ReceiptRepository(tx, serviceId, principal.subject).execute(name, requestId, input, dto.reflectionAnalysisContentOperations[name].output, async () => {
    const content = await validateReflectionAnalysisSelection(input.analysis_content, principal.canonical_user_id, tx);
    if (Buffer.byteLength(JSON.stringify(content), "utf8") > configuredReflectionTaskExecutionPolicy().launchSnapshotMaxBytes) throw new AuthBoundaryError("REFLECTION_LAUNCH_SNAPSHOT_TOO_LARGE", 413);
    const created = reflectionTaskGetOutputDto.parse(await runReflectionTaskUserOperation("reflection-task.create", { sections: input.sections, input_snapshot: input.input_snapshot }, actor, tx, serviceId, requestId));
    // The old service call and this write share the outer UOW; neither can commit alone.
    await tx.update(task).set({ analysis_content_json: JSON.stringify(content), agent_contract_version: reflectionAnalysisContractVersion })
      .where(and(eq(task.id, created.task.task_id), eq(task.user_id, sql`${decimalIdDto.parse(principal.canonical_user_id)}::bigint`)));
    return { ...created, task: { ...created.task, agent_contract_version: reflectionAnalysisContractVersion } };
  });
}

export async function runReflectionAnalysisBackgroundOperation(raw: unknown, service: ReflectionTaskExecutionService, tx: DataTransaction) {
  if (!service.backgroundScopes.includes("reflections:execute")) throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
  const { task_id } = dto.reflectionAnalysisContentOperations["reflection-task.analysis-content-load"].input.parse(raw);
  const row = await new ReflectionTaskRepository(tx).readForService(task_id, service.id);
  if (!row) throw new AuthBoundaryError("REFLECTION_TASK_NOT_FOUND", 404);
  if (row.agentContractVersion !== reflectionAnalysisContractVersion) throw new AuthBoundaryError("REFLECTION_ANALYSIS_INPUT_MISSING", 409);
  return dto.reflectionAnalysisLoadOutputDto.parse({ analysis_content: await readReflectionAnalysisInput(tx, task_id) });
}
