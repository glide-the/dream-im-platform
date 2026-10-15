// [Input] Verified report owner/service, canonical documents and closed policy DTOs.
// [Output] Fenced memory publication, recoverable canonical bytes and revisioned owner settings.
// [Pos] Admin memory persistence; Dream cannot create shared tables or choose actors.
// [Sync] 2026-10-15: preserve v1 publications and append v2 from frozen registered sources.
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql, getTableColumns, type SQL } from "drizzle-orm";
import { memory_artifact as artifacts, memory_behavior_settings as settings } from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import type { DataTransaction } from "./database";
import type { DreamServiceClient } from "../auth/config";
import { pgTimestampToIso } from "./chatThreadDto";
import { ReceiptRepository } from "./receipts";
import * as dto from "./memoryDto";
import { canonicalContractJson } from "./canonicalContractJson";
import legacyPolicy from "../../../config/memory-policy.json";
import currentPolicy from "../../../config/memory-policy-v2.json";
import classificationContract from "../../../drizzle/contracts/dream-memory-classification-v2.json";
import contract from "../../../drizzle/contracts/dream-memory-v1.json";
export const memorySchemaRequirement = { capability: "dream.memory.v1", version: 1, contractSha256: contract.contract_sha256 } as const;
export const memoryClassificationRequirement = { capability: "dream.memory.classification.v2", version: 1, contractSha256: classificationContract.contract_sha256 } as const;
export function memoryRequirements(name: string) { return name.startsWith("memory.v2.") ? [memorySchemaRequirement, memoryClassificationRequirement] : [memorySchemaRequirement]; }
const memoryColumns = { ...getTableColumns(artifacts), created_at_text:sql<string>`${artifacts.created_at}::text` };
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function capacity() {
  const batch = Number(process.env.DREAM_MEMORY_BATCH_SIZE ?? 20), lease = Number(process.env.DREAM_MEMORY_LEASE_SECONDS ?? 120);
  if (![batch,lease].every(v => Number.isSafeInteger(v) && v > 0)) throw new AuthBoundaryError("MEMORY_POLICY_INVALID");
  return { batch, lease };
}
function project(row: typeof artifacts.$inferSelect & {created_at_text?:string}, content=true, v2=false) {
  return (v2 ? dto.artifactV2Dto : dto.artifactDto).parse({ artifact_id: row.id, revision: row.revision, report_id: row.report_id.toString(), state: row.state, theme_state: row.theme_state, created_at: row.created_at_text ? pgTimestampToIso(row.created_at_text) : row.created_at.toISOString(), source_sha256: row.source_sha256, conversion_revision: row.conversion_revision,
    document: content ? row.document : null, document_sha256: row.document_sha256, body_sha256: row.body_sha256, byte_length: row.byte_length,
    theme_document: content ? row.theme_document : null, theme_sha256: row.theme_sha256, metadata: row.metadata_json === "{}" ? null : JSON.parse(row.metadata_json), error_code: row.error_code });
}
function validateDocument(document:string, row:typeof artifacts.$inferSelect, bodySha:string|null, theme=false) {
  try {
    const policy = row.conversion_revision === currentPolicy.revision ? currentPolicy : legacyPolicy;
    if (![legacyPolicy.revision,currentPolicy.revision].includes(row.conversion_revision)) throw new Error();
    if (!document.startsWith("---\n")) throw new Error();
    const end=document.indexOf("\n---\n",4);
    if (end<0) throw new Error();
    const header=JSON.parse(document.slice(4,end)), body=document.slice(end+5);
    if (header.report_digest!==JSON.parse(row.source_json).report_sha256 || header.schema_version!==1 || header.artifact_id!==row.id || header.revision!==row.revision || header.report_id!==row.report_id.toString() || header.source_sha256!==row.source_sha256 || header.conversion_revision!==row.conversion_revision || header.execution_mode!==policy.execution_mode || header.body_sha256!==digest(body)) throw new Error();
    if (theme ? header.source_body_sha256!==bodySha || header.source_distillation_id!==row.id || header.source_distillation_revision!==row.revision || header.taxonomy_revision!==policy.revision : header.body_sha256!==bodySha) throw new Error();
  } catch { throw new AuthBoundaryError("MEMORY_DOCUMENT_INVALID",400); }
}
export async function runMemoryBackground(operationName: dto.AnyMemoryOperation, input: unknown, tx: DataTransaction, service: DreamServiceClient) {
  if (!(service.backgroundScopes as readonly string[]).includes("reflections:execute")) throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED",403);
  const name=dto.baseMemoryOperation(operationName), v2=operationName.startsWith("memory.v2.");
  const policy=v2 ? currentPolicy : legacyPolicy;
  const { batch, lease } = capacity();
  if (name === "memory.artifacts.discover") {
    const reports = await tx.execute<{ id: string; owner: string; body: string; task_id: string; created_at: string; input: string; completed: string[]; frozen: string|null }>(sql`
      SELECT r.id::text AS id, r.user_id::text AS owner, r.report_data_json AS body, r.reflection_task_id AS task_id, r.created_at::text AS created_at, t.input_snapshot AS input, ARRAY(SELECT section FROM reflection_task_section WHERE task_id=t.id AND status='COMPLETED' ORDER BY section) AS completed, (SELECT a.source_json FROM memory_artifact a WHERE a.report_id=r.id AND a.service_client_id=${service.id} AND a.conversion_revision=${legacyPolicy.revision} AND ${v2} ORDER BY a.created_at,a.id LIMIT 1) AS frozen
      FROM analysis_reports r JOIN reflection_task t ON t.id = r.reflection_task_id
      WHERE t.service_client_id = ${service.id} AND (r.created_at >= (SELECT applied_at FROM drizzle.schema_capabilities WHERE capability=${v2 ? memoryClassificationRequirement.capability : memorySchemaRequirement.capability}) OR (${v2} AND EXISTS (SELECT 1 FROM memory_artifact previous WHERE previous.report_id=r.id AND previous.service_client_id=${service.id} AND previous.conversion_revision=${legacyPolicy.revision})))
      AND NOT EXISTS (SELECT 1 FROM memory_artifact a WHERE a.report_id=r.id AND a.conversion_revision=${policy.revision})
      ORDER BY r.created_at,r.id LIMIT ${batch}`);
    let count = 0;
    for (const r of reports.rows) {
      const liveSource=()=>{
        const raw=JSON.parse(r.body), input=JSON.parse(r.input);
        return { analysis_content:raw.analysis_content??null,task_id:r.task_id,report_id:r.id,report_sha256:digest(r.body),created_at:pgTimestampToIso(r.created_at),start_date:input.start_date??null,end_date:input.end_date??null,completed_sections:r.completed,echoes:r.completed.includes("echoes") ? raw.echoes ?? [] : [],traits:r.completed.includes("traits") ? raw.traits ?? [] : [],patterns:r.completed.includes("patterns") ? raw.patterns ?? [] : [],failed_sections:raw.failed_sections ?? [] };
      };
      const source = dto.memorySourceDto.parse(r.frozen ? JSON.parse(r.frozen) : liveSource());
      const sourceJson = canonicalContractJson(source);
      const inserted = await tx.insert(artifacts).values({ id:randomUUID(),revision:1,user_id:BigInt(r.owner),report_id:BigInt(r.id),service_client_id:service.id,source_json:sourceJson,source_sha256:digest(sourceJson),conversion_revision:policy.revision }).onConflictDoNothing().returning({ id:artifacts.id });
      count += inserted.length;
    }
    return { discovered:count };
  }
  if (name === "memory.artifacts.claim") {
    const candidates = await tx.select(memoryColumns).from(artifacts).where(sql`${artifacts.service_client_id}=${service.id} AND ${artifacts.conversion_revision}=${policy.revision} AND (${artifacts.state}='pending' OR ((${artifacts.state} IN ('running','publishing','failed') OR (${artifacts.state}='ready' AND ${artifacts.theme_state}='failed')) AND ${artifacts.claim_expires_at}<now()))`).orderBy(artifacts.created_at).limit(1).for("update",{ skipLocked:true });
    if (!candidates[0]) return { artifact:null,claim_token:null,source:null };
    const row = candidates[0], token = randomUUID();
    const updated = await tx.update(artifacts).set({ claim_token:token,claim_expires_at:sql`now()+${lease} * interval '1 second'`,state:row.state==="ready" ? "ready" : row.document !== null || row.metadata_json !== "{}" ? "publishing" : "running",updated_at:new Date() }).where(and(eq(artifacts.id,row.id),eq(artifacts.revision,row.revision))).returning(memoryColumns);
    return { artifact:project(updated[0],true,v2),claim_token:token,source:dto.memorySourceDto.parse(JSON.parse(row.source_json)) };
  }
  const common = dto.memoryOperations[name].input.parse(input) as { artifact_id:string;revision:number;claim_token:string };
  const rows = await tx.select(memoryColumns).from(artifacts).where(and(eq(artifacts.id,common.artifact_id),eq(artifacts.revision,common.revision),eq(artifacts.service_client_id,service.id),eq(artifacts.conversion_revision,policy.revision))).for("update");
  const row=rows[0];
  if (!row || row.claim_token !== common.claim_token || !row.claim_expires_at || row.claim_expires_at.getTime() <= Date.now()) throw new AuthBoundaryError("MEMORY_CLAIM_EXPIRED",409);
  let patch: Omit<Partial<typeof artifacts.$inferInsert>,"claim_expires_at"> & { claim_expires_at?:Date|SQL|null } = { updated_at:new Date() };
  if (name === "memory.artifacts.stage") {
    const v=dto.memoryOperations[name].input.parse(input);
    if (row.state !== "running" && row.state !== "publishing" && row.state !== "ready") throw new AuthBoundaryError("MEMORY_STATE_CONFLICT",409);
    if (v.metadata.report_id !== row.report_id.toString() || v.metadata.task_id !== JSON.parse(row.source_json).task_id || (v.document===null)!==(v.metadata.item_count===0)) throw new AuthBoundaryError("MEMORY_SOURCE_MISMATCH",409);
    if (v.document!==null) validateDocument(v.document,row,v.body_sha256);
    if (v.theme_document!==null) validateDocument(v.theme_document,row,v.body_sha256,true);
    if (v.document===null && (v.theme_document!==null || v.body_sha256!==null)) throw new AuthBoundaryError("MEMORY_DOCUMENT_INVALID",400);
    const documentSha=v.document===null ? null : digest(v.document);
    if (row.document !== null && row.document_sha256 !== documentSha) throw new AuthBoundaryError("MEMORY_DOCUMENT_CONFLICT",409);
    patch={ ...patch,state:row.state==="ready" ? "ready" : "publishing",document:v.document,document_sha256:documentSha,body_sha256:v.body_sha256,byte_length:v.document===null ? null : Buffer.byteLength(v.document,"utf8"),theme_document:v.theme_document,theme_sha256:v.theme_document===null ? null : digest(v.theme_document),theme_state:v.theme_error_code ? "failed" : v.theme_document===null ? "empty" : "pending",metadata_json:canonicalContractJson(v.metadata),error_code:v.theme_error_code };
  } else if (name === "memory.artifacts.publish") {
    const v=dto.memoryOperations[name].input.parse(input);
    if ((row.state!=="publishing" && row.state!=="ready") || row.document_sha256!==v.document_sha256 || (v.theme_published ? row.theme_sha256!==v.theme_sha256 || v.theme_error_code!==null : v.theme_sha256!==null || (row.theme_document!==null && v.theme_error_code===null))) throw new AuthBoundaryError("MEMORY_DOCUMENT_CONFLICT",409);
    patch={...patch,state:row.document===null ? "empty" : "ready",theme_state:v.theme_error_code!==null ? "failed" : row.theme_document===null ? "empty" : "ready",error_code:v.theme_error_code};
  } else if (name === "memory.artifacts.fail") {
    const v=dto.memoryOperations[name].input.parse(input);
    patch={...patch,state:v.retryable ? (row.metadata_json!=="{}" ? "publishing" : "pending") : "failed",claim_expires_at:sql`now()+${lease} * interval '1 second'`,error_code:v.error_code};
  } else throw new AuthBoundaryError("OPERATION_UNAVAILABLE",404);
  const saved=await tx.update(artifacts).set(patch).where(and(eq(artifacts.id,row.id),eq(artifacts.revision,row.revision))).returning(memoryColumns);
  return project(saved[0],true,v2);
}
export async function runMemoryUser(operationName:dto.AnyMemoryOperation,input:unknown,tx:DataTransaction,owner:string,serviceId:string,requestId:string) {
  const name=dto.baseMemoryOperation(operationName), v2=operationName.startsWith("memory.v2.");
  const policy=v2 ? currentPolicy : legacyPolicy;
  const versionFilter=v2 ? sql`${artifacts.conversion_revision} IN (${legacyPolicy.revision},${currentPolicy.revision})` : eq(artifacts.conversion_revision,legacyPolicy.revision);
  if (name==="memory.distillations.list") {
    const v=dto.memoryOperations[name].input.parse(input);
    const cursor=v.before ? sql`(${artifacts.created_at},${artifacts.id})<(${v.before.created_at}::timestamptz,${v.before.artifact_id})` : sql`true`;
    const rows=await tx.select(memoryColumns).from(artifacts).where(and(eq(artifacts.user_id,BigInt(owner)),versionFilter,cursor)).orderBy(desc(artifacts.created_at),desc(artifacts.id)).limit(v.limit+1);
    const page=rows.slice(0,v.limit),last=page.at(-1);
    return { artifacts:page.map(r=>project(r,false,v2)),next_cursor:rows.length>v.limit&&last ? { created_at:pgTimestampToIso(last.created_at_text),artifact_id:last.id } : null };
  }
  if (name==="memory.distillations.read") {
    const v=dto.memoryOperations[name].input.parse(input);
    const rows=await tx.select(memoryColumns).from(artifacts).where(and(eq(artifacts.user_id,BigInt(owner)),eq(artifacts.id,v.artifact_id),eq(artifacts.revision,v.revision),versionFilter)).limit(1);
    if (!rows[0]) throw new AuthBoundaryError("MEMORY_NOT_FOUND",404);
    const result=project(rows[0],true,v2);
    return { ...result, document:result.state==="ready" ? result.document : null, theme_document:result.theme_state==="ready" ? result.theme_document : null };
  }
  const read=async()=>{
    const rows=await tx.select().from(settings).where(eq(settings.user_id,BigInt(owner))).limit(1);
    const row=rows[0];
    return (v2 ? dto.settingsV2Dto : dto.settingsDto).parse({ owner_id:owner,catalog:policy.themes.map(({id,label,actions,default_action})=>({id,label,actions,default_action})),revision:row?.revision??0,taxonomy_revision:policy.revision,default:dto.defaultDesired,desired:row ? JSON.parse(row.desired_json) : dto.defaultDesired,updated_at:row?.updated_at.toISOString()??null });
  };
  if (name==="memory.behavior.get") return read();
  if (name==="memory.behavior.save") {
    const v=dto.memoryOperations[name].input.parse(input);
    return new ReceiptRepository(tx,serviceId,owner).execute(operationName,requestId,v,v2 ? dto.settingsV2Dto : dto.settingsDto,async()=>{
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`memory-behavior:${owner}`},0))`);
      const current=await read();
      if (current.revision!==v.expected_revision) throw new AuthBoundaryError("MEMORY_SETTINGS_CONFLICT",409);
      if (canonicalContractJson(current.desired)===canonicalContractJson(v.desired)) return current;
      await tx.insert(settings).values({ user_id:BigInt(owner),revision:current.revision+1,desired_json:canonicalContractJson(v.desired) }).onConflictDoUpdate({ target:settings.user_id,set:{ revision:current.revision+1,desired_json:canonicalContractJson(v.desired),updated_at:new Date() } });
      return read();
    });
  }
  throw new AuthBoundaryError("OPERATION_UNAVAILABLE",404);
}
