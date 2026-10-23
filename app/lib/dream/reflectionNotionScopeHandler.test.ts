// [Input] Production v2 handler/registry and injected service, OAuth and transaction boundaries.
// [Output] Exact descriptors, audience separation, capability gates and closed input contracts.
// [Pos] Provider-free Reflections v2 ingress regression; no database or model calls.
// [Sync] 2026-10-23: verify all five scope/evidence operations and forbidden caller overrides.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({service:vi.fn(),principal:vi.fn(),transaction:vi.fn(),user:vi.fn(),worker:vi.fn()}));
vi.mock("../auth/serviceIdentity", async original => ({...await original<typeof import("../auth/serviceIdentity")>(),requireDreamService:mocks.service}));
vi.mock("../auth/serviceAccessToken",()=>({principalForServiceToken:mocks.principal}));
vi.mock("./database",()=>({withDataTransaction:mocks.transaction}));
vi.mock("./reflectionNotionScopeService", async original => ({...await original<typeof import("./reflectionNotionScopeService")>(),runReflectionScopeUserOperation:mocks.user,runReflectionScopeBackgroundOperation:mocks.worker}));
import { handleReflectionAnalysisOperation, isReflectionAnalysisOperation } from "./reflectionAnalysisContentHandler";
import { reflectionAnalysisSchemaRequirement } from "./schemaRequirements";
import { dreamOperations } from "./operationRegistry";
const task_id="11111111-1111-4111-8111-111111111111";
const service={id:"fixture-service",backgroundScopes:["reflections:execute"]};
const principal={subject:"fixture-subject",canonical_user_id:"7001",client_id:"browser",scopes:["dream:read","dream:write"],status:"active"};
function request(input:unknown,user=false){return new Request("https://fixture.test/api/internal/dream/v1/operations/reflection-scope",{
  method:"POST",headers:{"content-type":"application/json",authorization:user?"Bearer fixture-user":"Bearer fixture-service",...(user?{"x-ink-dream-service-authorization":"Bearer fixture-service"}:{})},
  body:JSON.stringify({request_id:"fixture-scope-request",input})});}
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES","65536");mocks.service.mockResolvedValue(service);mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async(_requirements,run)=>run({fixture:true}));mocks.user.mockResolvedValue({analysis_content:null});mocks.worker.mockResolvedValue({page:null});});
afterEach(()=>vi.unstubAllEnvs());
it("advertises five exact additive descriptors at the original ingress",()=>{
  const expected={
    "reflection-task.v2.create-with-content":"5516077992d083e644147ccf4e93decaded32d8aeef55e643c42b68d64d9cd7a",
    "reflection-task.v2.analysis-content":"967c136b6a167f9c23cfdff476a8a4228fd12096163eb2a2b54a4d120626f375",
    "reflection-task.v2.analysis-content-load":"143383a872a963218d9ce6a1bd3d1d984980084011067e83904853c8a09a1527",
    "reflection-task.v2.notion-context":"a86c7edebd90944ee16ca6a0ca9418fb57d084cf72b36a83bf626ff3e92a4440",
    "reflection-task.v2.notion-evidence":"4e2fad42990db960b92aedd74fdfc3b1dbba5d605e47b9b858515f39bdd84517"};
  for(const[name,hash]of Object.entries(expected)){
    expect(isReflectionAnalysisOperation(name)).toBe(true);
    const matches=dreamOperations.filter(op=>op.capability.name===name);
    expect(matches).toHaveLength(1);expect(matches[0].capability.contract_sha256).toBe(hash);
  }
});
it("keeps the owner summary on OAuth read and the published content schema",async()=>{
  const response=await handleReflectionAnalysisOperation(request({task_id},true),"reflection-task.v2.analysis-content");
  expect(response.status).toBe(200);expect(mocks.principal.mock.calls[0][3]).toBe("dream:read");
  expect(mocks.transaction.mock.calls[0][0]).toContainEqual(reflectionAnalysisSchemaRequirement);
  expect(mocks.user).toHaveBeenCalledOnce();expect(mocks.worker).not.toHaveBeenCalled();
});
it("denies delegated browser credentials on task-bound page reads",async()=>{
  const input={task_id,section:"echoes",thread_id:"fixture-thread",section_revision:2,page_id:"fixture-page"};
  expect((await handleReflectionAnalysisOperation(request(input),"reflection-task.v2.notion-context")).status).toBe(200);
  expect((await handleReflectionAnalysisOperation(request(input,true),"reflection-task.v2.notion-context")).status).toBe(400);
  expect(mocks.worker).toHaveBeenCalledOnce();expect(mocks.principal).not.toHaveBeenCalled();
});
it("rejects create-time bodies and identity, prompt or path selectors before the transaction",async()=>{
  const input={sections:["echoes"],input_snapshot:{session_ids:[],start_date:null,end_date:null,language:"en",language_label:"English"},
    analysis_content:{diary_session_ids:[],notion:{connector_id:task_id,snapshot_version:"fixture-v1"},agent:null}};
  for(const extra of [{markdown:"body"},{user_id:"other"},{notion_home:"/elsewhere"}]){
    expect((await handleReflectionAnalysisOperation(request({...input,analysis_content:{...input.analysis_content,notion:{...input.analysis_content.notion,...extra}}},true),"reflection-task.v2.create-with-content")).status).toBe(400);
  }
  expect(mocks.transaction).not.toHaveBeenCalled();
});
