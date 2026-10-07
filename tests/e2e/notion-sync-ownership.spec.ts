// [Input] Verified named disposable PostgreSQL plus confidential service/OAuth tokens prepared by the primary.
// [Output] Public Route/DTO concurrent ownership, interruption, atomicity and original-receipt evidence.
// [Pos] Provider-free technical validation; no Notion, normal user data, migration or destructive fixture setup.
// [Sync] 2026-10-07: cover one-owner sync journeys, context ABA, legacy closure and final audit lease expiry.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { notionSyncRunOutputDto } from "../../app/lib/dream/notionSyncRunDto";
import { notionConnectorDto } from "../../app/lib/dream/notionConnectorDto";
import { operationRequestKeyDigest } from "../../app/lib/dream/receipts";
import type { NotionRun } from "../../app/lib/dream/notionSyncRunState";

test.describe.configure({ mode: "serial" });
const fixturePath = process.env.NOTION_SYNC_VALIDATION_FIXTURE;
if (!fixturePath) throw Error("Explicit isolated fixture required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  databaseName: string; roles: Record<string, string>; env: Record<string, string>; port: number;
  observerUrl: string; observerRole: string; tokens: { service: string; otherService: string; limited: string; user: string; foreignUser: string }; legacyId: string;
};
if (!/^ink_notion_sync_ownership_test_[a-f0-9]+$/.test(fixture.databaseName)
  || new URL(fixture.env.DREAM_DATA_DATABASE_URL).pathname.slice(1) !== fixture.databaseName)
  throw Error("Disposable database identity required");
const base = `http://127.0.0.1:${fixture.port}`;
const pool = new Pool({ connectionString: fixture.observerUrl, max: 2 });
let api: APIRequestContext;
const tokens = fixture.tokens;
const headers = (user = false, token = tokens.service, foreign = false) => ({ "content-type": "application/json",
  ...(user ? { authorization: `Bearer ${foreign ? tokens.foreignUser : tokens.user}`, "x-ink-dream-service-authorization": `Bearer ${token}` }
    : { authorization: `Bearer ${token}` }) });
async function post(operation: string, input: unknown, user = false, requestId: string = randomUUID(), token = tokens.service, extra: Record<string, string> = {}, foreign = false) {
  return api.post(`${base}/api/internal/dream/v1/operations/${operation}`, { headers: { ...headers(user, token, foreign), ...extra }, data: { request_id: requestId, input } });
}
async function successful(operation: string, input: unknown, user = false, requestId: string = randomUUID()) {
  const response = await post(operation, input, user, requestId);
  const body = await response.json(); expect(response.status(), body.error?.code).toBe(200); return body.data;
}
async function denial(operation: string, input: unknown, code: string, status = 409, user = false, requestId: string = randomUUID(), token = tokens.service, foreign = false) {
  const response = await post(operation, input, user, requestId, token, {}, foreign);
  expect(response.status()).toBe(status);expect((await response.json()).error.code).toBe(code);
}
async function connector() {
  const value = await successful("notion.connector.create", { authority: null, name: "Isolated sync", platform: "notion", config: {} }, true);
  const c = notionConnectorDto.parse(value.connector);
  await successful("notion.auth-state.save", { authority: null, connector_id: c.id, auth_status: "authenticated", config_patch: {} }, true);
  await select(c.id, "database-A"); return c.id;
}
async function select(id: string, externalId: string | null) {
  return successful("notion.resources.replace", { authority: null, connector_id: id,
    databases: externalId ? [{ external_id: externalId, title: externalId, metadata: {} }] : [], pages: [] }, true);
}
async function claim(id: string, manual = false, requestId: string = randomUUID()) {
  const value = await successful(manual ? "notion.sync-run.request" : "notion.sync-run.claim",
    { ...(manual ? { authority: null } : {}), connector_id: id, worker_id: randomUUID() }, manual, requestId);
  return notionSyncRunOutputDto.parse(value);
}
function key(id: string, run: NotionRun) { return { connector_id: id, worker_id: run.worker_id, run_id: run.run_id, fence_epoch: run.fence_epoch }; }
function snapshot(id: string, version: string = randomUUID(), databaseId = "database-A") {
  const page={page_id:"page-1",title:"Page metadata",url:"",created_time:"2026-10-07T00:00:00Z",last_edited_time:"2026-10-07T00:01:00Z",last_edited:"2026-10-07T00:01:00Z"};
  const metadata={workspace_id:id,resource_connector_id:id,snapshot_version:version,source_revision:`source-${version}`,sync_cursor:`cursor-${version}`,fetched_at:new Date().toISOString(),state:"snapshot_ready"};
  return {metadata,connector:{id,name:"Isolated sync",platform:"notion",auth_status:"authenticated",last_synced_at:null,selected_databases:[databaseId],selected_pages:[]},
    index:[page],databases:[{database_id:databaseId,title:databaseId,page_count:1,properties_schema:{},last_edited:"",url:""}],database_pages:{[databaseId]:[page]},pages:{},
    identity:{workspace_id:id,resource_connector_id:id,snapshot_version:version,source_revision:metadata.source_revision,sync_cursor:metadata.sync_cursor}};
}
function done(id: string, run: NotionRun, version: string = randomUUID()) {
  return { ...key(id, run), outcome: { status: "succeeded", workspace_id: id, snapshot: snapshot(id, version), synced_resources: [{ resource_type: "notion_database", external_id: "database-A" }] } };
}
async function state(id: string) {
  const result = await pool.query("SELECT config_json,current_snapshot_version,current_source_revision,last_synced_at FROM resource_connectors WHERE id=$1", [id]);
  return { ...result.rows[0], config: JSON.parse(result.rows[0].config_json) };
}
async function counts(id: string, requestId: string) {
  return (await pool.query(`SELECT
    (SELECT count(*)::integer FROM connector_snapshots WHERE connector_id=$1) AS snapshots,
    (SELECT count(*)::integer FROM dream.operation_receipts WHERE request_id=$2 AND actor=$4) AS receipts,
    (SELECT count(*)::integer FROM admin_audit_logs WHERE request_id=$2 AND resource_id=$3) AS audits`,
    [id, requestId, operationRequestKeyDigest(JSON.parse(fixture.env.DREAM_DATA_SERVICE_CLIENTS)[0].id, `notion-sync:${id}`, "notion.sync-run.finish", requestId), `notion-sync:${id}`])).rows[0];
}
test.beforeAll(async ({ playwright }) => {
  api = await playwright.request.newContext();
  const identity = (await pool.query("SELECT current_database() AS db,current_user AS actor")).rows[0];
  expect(identity.db).toBe(fixture.databaseName);expect(identity.actor).toBe(fixture.observerRole);
});
test.afterAll(async () => { await api.dispose();await pool.end(); });

test("concurrent claim has one owner; manual keeps active lease; exact service/worker scope", async () => {
  const id = await connector();
  const [a,b] = await Promise.all([claim(id),claim(id)]);
  expect([a.status,b.status].sort()).toEqual(["busy","claimed"]);
  const owner = (a.run ?? b.run)!;
  const busy = await claim(id,true);expect(busy.status).toBe("busy");expect(busy.run).toBeNull();
  expect(busy.retry_at).toBe(owner.lease_expires_at);
  expect(busy.connector.config.snapshot_sync_execution).toBeUndefined();
  await denial("notion.sync-run.renew",{...key(id,owner),worker_id:randomUUID()},"NOTION_SYNC_RUN_INVALID");
  await denial("notion.sync-run.renew",key(id,owner),"NOTION_SYNC_RUN_INVALID",409,false,randomUUID(),tokens.otherService);
  await denial("notion.sync-run.claim",{connector_id:id,worker_id:randomUUID()},"DREAM_SERVICE_SCOPE_REQUIRED",403,false,randomUUID(),tokens.limited);
  await denial("notion.sync-run.request",{authority:null,connector_id:id,worker_id:randomUUID()},"NOTION_CONNECTOR_NOT_FOUND",404,true,randomUUID(),tokens.service,true);
  const renewed = notionSyncRunOutputDto.parse(await successful("notion.sync-run.renew",key(id,owner)));
  expect(Date.parse(renewed.run!.lease_expires_at)).toBeGreaterThanOrEqual(Date.parse(owner.lease_expires_at));
  await successful("notion.sync-run.finish",{...key(id,owner),outcome:{status:"cancelled",error_code:"NOTION_SYNC_CANCELLED"}});
});

test("database lease expiry allows higher fence; every old outcome and renew is rejected", async () => {
  const id=await connector();const first=await claim(id);
  const expiry = await pool.query("SELECT clock_timestamp()::text AS now");
  expect(Date.parse(first.server_now)).toBeLessThanOrEqual(Date.parse(expiry.rows[0].now));
  await new Promise(resolve=>setTimeout(resolve,3200));
  await denial("notion.sync-run.renew",key(id,first.run!),"NOTION_SYNC_LEASE_EXPIRED");
  const second=await claim(id);expect(second.status).toBe("claimed");expect(second.run!.fence_epoch).toBeGreaterThan(first.run!.fence_epoch);
  await denial("notion.sync-run.renew",key(id,first.run!),"NOTION_SYNC_RUN_INVALID");
  for (const outcome of [{status:"succeeded",workspace_id:id,snapshot:snapshot(id),synced_resources:[]},
    {status:"failed",error_code:"NOTION_SYNC_FAILED"},{status:"cancelled",error_code:"NOTION_SYNC_CANCELLED"}])
    await denial("notion.sync-run.finish",{...key(id,first.run!),outcome},"NOTION_SYNC_RUN_INVALID");
  await successful("notion.sync-run.finish",done(id,second.run!,"accepted-new"));
  expect((await state(id)).current_snapshot_version).toBe("accepted-new");
});

test("selection and authorization ABA invalidate every old run; source delete clears final identity", async () => {
  const id=await connector();const first=await claim(id);
  await select(id,"database-B");await select(id,"database-A");
  await denial("notion.sync-run.finish",done(id,first.run!),"NOTION_SYNC_CONTEXT_CHANGED");
  const second=await claim(id,true);
  await successful("notion.auth-state.save",{authority:null,connector_id:id,auth_status:"pending",config_patch:{}},true);
  await successful("notion.auth-state.save",{authority:null,connector_id:id,auth_status:"authenticated",config_patch:{}},true);
  await denial("notion.sync-run.renew",key(id,second.run!),"NOTION_SYNC_CONTEXT_CHANGED");
  const third=await claim(id,true);await successful("notion.sync-run.finish",done(id,third.run!));
  const loaded=await successful("notion.connector.get",{authority:null,connector_id:id},true);
  const source=notionConnectorDto.parse(loaded.connector).sources[0];
  await successful("notion.resource.delete",{authority:null,connector_id:id,resource_id:source.id},true);
  const final=await state(id);expect(final.current_snapshot_version).toBeNull();expect(final.last_synced_at).toBeNull();
  expect(final.config.selected_databases).toEqual([]);
  await denial("notion.sync-run.request",{authority:null,connector_id:id,worker_id:randomUUID()},"NOTION_SYNC_SOURCES_REQUIRED",409,true);
});

test("latest disabled policy survives finish; automatic skips while manual remains usable", async () => {
  const id=await connector();const initial=await claim(id);
  const rule={enabled:false,interval_minutes:60,revision:2};
  await successful("notion.connector.patch",{authority:null,connector_id:id,patch:{config_patch:{snapshot_sync_policy:{schema_version:1,desired:rule,effective:rule,status:"disabled",last_success_at:"2001-01-01T00:00:00Z"}}}},true);
  await successful("notion.sync-run.finish",done(id,initial.run!));
  const current=await state(id);expect(current.config.snapshot_sync_policy.effective).toEqual(rule);expect(current.config.snapshot_sync_policy.status).toBe("disabled");
  expect((await claim(id)).status).toBe("not_due");
  expect((await claim(id,true)).status).toBe("claimed");
});

test("LKG is retained for failure/cancel; snapshot version is immutable and pages remain metadata-only", async () => {
  const id=await connector();const first=await claim(id);await successful("notion.sync-run.finish",done(id,first.run!,"immutable-LKG"));
  for (const outcome of [{status:"failed",error_code:"NOTION_UPSTREAM_UNAVAILABLE"},{status:"cancelled",error_code:"NOTION_SYNC_CANCELLED"}]) {
    const next=await claim(id,true);await successful("notion.sync-run.finish",{...key(id,next.run!),outcome});
    expect((await state(id)).current_snapshot_version).toBe("immutable-LKG");
  }
  const next=await claim(id,true);
  await denial("notion.sync-run.finish",done(id,next.run!,"immutable-LKG"),"NOTION_SNAPSHOT_VERSION_CONFLICT");
  const invalid=done(id,next.run!);invalid.outcome.snapshot.pages={"page-1":"body"} as unknown as typeof invalid.outcome.snapshot.pages;
  await denial("notion.sync-run.finish",invalid,"INPUT_INVALID",400);
  for(const mutate of [(value:Record<string,unknown>)=>{value.index="broken";},(value:Record<string,unknown>)=>{value.databases=42;},
    (value:Record<string,unknown>)=>{value.index=[];},
    (value:Record<string,unknown>)=>{value.connector=null;},(value:Record<string,unknown>)=>{value.config={snapshot_sync_execution:{}};},
    (value:Record<string,unknown>)=>{(value.identity as Record<string,unknown>).snapshot_version="wrong";},
    (value:Record<string,unknown>)=>{((value.database_pages as Record<string,Record<string,unknown>[]>)["database-A"][0]).body="正文";}]) {
    const payload=done(id,next.run!);mutate(payload.outcome.snapshot as unknown as Record<string,unknown>);
    await denial("notion.sync-run.finish",payload,"INPUT_INVALID",400);
  }
  expect((await state(id)).current_snapshot_version).toBe("immutable-LKG");
});

test("snapshot, receipt and audit faults roll back complete commit; final audit delay expires lease", async () => {
  for (const fault of ["fault-snapshot","fault-receipt","fault-audit","fault-lease-after-audit"]) {
    const id=await connector();const claimed=await claim(id);const before=await state(id);
    const response=await post("notion.sync-run.finish",done(id,claimed.run!,fault==="fault-snapshot"?fault:randomUUID()),false,fault);
    expect(response.status()).toBe(fault==="fault-lease-after-audit"?409:503);
    if(fault==="fault-lease-after-audit") expect((await response.json()).error.code).toBe("NOTION_SYNC_LEASE_EXPIRED");
    expect(await counts(id,fault)).toEqual({snapshots:0,receipts:0,audits:0});
    expect((await state(id)).config).toEqual(before.config);expect((await state(id)).current_snapshot_version).toBeNull();
  }
});

test("lost successful HTTP response is recovered from original receipt; replay never commits again", async () => {
  const id=await connector();const claimed=await claim(id);const requestId="lost-finish";const input=done(id,claimed.run!,"receipt-LKG");
  let lost=false;try{await post("notion.sync-run.finish",input,false,requestId,tokens.service,{"x-harness-drop-response":"after-commit"});}catch{lost=true;}
  expect(lost).toBe(true);
  const response=await api.get(`${base}/api/internal/dream/v1/receipts/${requestId}?operation=notion.sync-run.finish&connector_id=${id}`,{headers:headers()});
  expect(response.status()).toBe(200);const original=await response.json();expect(original.data.status).toBe("committed");
  const replay=await successful("notion.sync-run.finish",input,false,requestId);expect(replay).toEqual(original.data.result);
  expect(await counts(id,requestId)).toEqual({snapshots:1,receipts:1,audits:1});
  await denial("notion.sync-run.finish",input,"DREAM_SERVICE_SCOPE_REQUIRED",403,false,requestId,tokens.limited);
  await denial("notion.sync-run.finish",{...input,outcome:{...input.outcome,snapshot:snapshot(id,"different")}},"OPERATION_REQUEST_CONFLICT",409,false,requestId);
});

test("legacy writes and all reserved-field injections fail; legacy owner is unresolved", async () => {
  const id=await connector();
  await denial("notion.snapshot.save",{authority:null,connector_id:id,workspace_id:id,snapshot:snapshot(id),synced_resources:[]},"NOTION_SYNC_LEGACY_WRITE_FORBIDDEN",409,true);
  await denial("notion.sync-snapshot.save",{connector_id:id,workspace_id:id,snapshot:snapshot(id),synced_resources:[]},"NOTION_SYNC_LEGACY_WRITE_FORBIDDEN");
  await denial("notion.sync-connector.patch",{connector_id:id,patch:{auth_status:"authenticated"}},"NOTION_SYNC_LEGACY_WRITE_FORBIDDEN");
  await denial("notion.connector.patch",{authority:null,connector_id:id,patch:{current_snapshot_version:"forged"}},"NOTION_SYNC_LEGACY_WRITE_FORBIDDEN",409,true);
  for (const reserved of ["snapshot_sync_execution","selected_databases","selected_pages"]) {
    await denial("notion.connector.create",{authority:null,name:"Injection",platform:"notion",config:{[reserved]:{}}},"NOTION_SYNC_RESERVED_CONFIG",400,true);
    await denial("notion.connector.patch",{authority:null,connector_id:id,patch:{config_patch:{[reserved]:{}}}},"NOTION_SYNC_RESERVED_CONFIG",400,true);
    await denial("notion.auth-state.save",{authority:null,connector_id:id,auth_status:"authenticated",config_patch:{[reserved]:{}}},"NOTION_SYNC_RESERVED_CONFIG",400,true);
  }
  await denial("notion.sync-run.claim",{connector_id:fixture.legacyId,worker_id:randomUUID()},"NOTION_SYNC_LEGACY_OWNER_UNRESOLVED");
  expect((await state(fixture.legacyId)).config.snapshot_sync_policy.status).toBe("syncing");
  await select(fixture.legacyId,"database-B");await select(fixture.legacyId,"database-A");
  await successful("notion.auth-state.save",{authority:null,connector_id:fixture.legacyId,auth_status:"authenticated",config_patch:{}},true);
  const rule={enabled:false,interval_minutes:60,revision:2};
  await successful("notion.connector.patch",{authority:null,connector_id:fixture.legacyId,patch:{config_patch:{snapshot_sync_policy:{schema_version:1,desired:rule,effective:rule,status:"disabled"}}}},true);
  await denial("notion.sync-run.request",{authority:null,connector_id:fixture.legacyId,worker_id:randomUUID()},"NOTION_SYNC_LEGACY_OWNER_UNRESOLVED",409,true);
  expect((await state(fixture.legacyId)).config.snapshot_sync_execution.legacy_owner_unresolved).toBe(true);
});

test("published capability and four exact operation hashes match the actual route inventory", async () => {
  const response=await api.get(`${base}/api/internal/dream/v1/capabilities`,{headers:headers()});expect(response.status()).toBe(200);
  const value=(await response.json()).data;
  const contract=JSON.parse(readFileSync(new URL("../../drizzle/contracts/dream-notion-sync-ownership-v1.json",import.meta.url),"utf8"));
  expect(value.schema_capabilities).toContainEqual(expect.objectContaining({capability:contract.capability,version:1,contract_sha256:contract.contract_sha256}));
  const artifact=JSON.parse(readFileSync(new URL("../../docs/architecture/admin-dream-operation-contracts.json",import.meta.url),"utf8"));
  for(const operation of artifact.slice(-4)) expect(value.operations).toContainEqual(operation.capability);
});
