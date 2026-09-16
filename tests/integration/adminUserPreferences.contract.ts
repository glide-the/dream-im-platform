// [Input] Primary-prepared named isolated PG, restricted pools, OAuth owners and one Thread grant.
// [Output] Both public preference operations, original concurrent merge/NULL/precision/receipt boundaries.
// [Pos] Provider-free public harness; all owner database queries are SELECT and no fixture/fault is executed.
// [Sync] 2026-09-17: require delegated user OAuth plus a short-lived client_credentials service access token.
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { z } from "zod";
import { POST } from "../../app/api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../app/api/internal/dream/v1/receipts/[requestId]/route";
import { userPreferencesOperationContracts as contracts, type UserPreferencesOperation } from "../../app/lib/dream/userPreferencesDto";
const text=z.string().min(1);
const fixtureDto=z.strictObject({database:text,port:z.number().int().positive(),data_directory:text,target_verification_url:text,issuer:text,service_id:text,service_access_token:text,user_id:text,other_user_id:text,tokens:z.strictObject({user:text,other:text,read_only:text,thread:text}),raw_voice:text,raw_state:text,system_config:text});
const path=process.env.INK_AUTH_USER_PREFERENCES_FIXTURE;assert(path,"Explicit primary-prepared private fixture required");assert.equal((await stat(path)).mode&0o777,0o600);
const parsed=fixtureDto.safeParse(JSON.parse(await readFile(path,"utf8")));assert(parsed.success,"Strict private fixture required");const f=parsed.data;
assert(f.database.startsWith("ink_auth_data_codex_test_")&&f.port!==5433&&f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"));
const dsn=new URL(f.target_verification_url);assert(["postgres:","postgresql:"].includes(dsn.protocol)&&decodeURIComponent(dsn.pathname.slice(1))===f.database);
const verification=new Client({connectionString:f.target_verification_url});await verification.connect();
const proof=await verification.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_setting('data_directory') AS root");assert.deepEqual(proof.rows[0],{name:f.database,port:f.port,root:f.data_directory});
const origin=f.issuer.replace(/\/api\/auth$/,""),empty={voice_configs_json:null,meta_prompt:null,state_config_json:null,selected_state:null,timezone:null};let assertions=0;
const id=()=>`preferences_${randomUUID()}`;
function headers(token:string,requestId:string){return {authorization:`Bearer ${token}`,"content-type":"application/json","x-request-id":requestId,"x-ink-dream-service-authorization":`Bearer ${f.service_access_token}`};}
async function call(name:UserPreferencesOperation,input:unknown,options:{token?:string;status?:number;requestId?:string}={}){
 const requestId=options.requestId??id(),response=await POST(new Request(`${origin}/api/internal/dream/v1/operations/${name}`,{method:"POST",headers:headers(options.token??f.tokens.user,requestId),body:JSON.stringify({request_id:requestId,input})}),{params:Promise.resolve({operation:name})});const body=await response.json();
 const code=typeof body.error?.code==="string"&&/^[A-Z0-9_]{1,100}$/.test(body.error.code)?body.error.code:"NO_PUBLIC_ERROR_CODE";assert.equal(response.status,options.status??200,`${name} public status (${code})`);assert.equal(body.request_id,requestId);assertions+=2;
 return response.ok?contracts[name].output.parse(body.data):null;
}
async function snapshot(userId:string){const r=await verification.query("SELECT voice_configs_json,meta_prompt,state_config_json,selected_state,timezone,first_login_completed,system_config_json,updated_at::text FROM public.user_preferences WHERE user_id=$1::bigint",[userId]);return r.rows[0]??null;}
async function recovery(requestId:string,token=f.tokens.user,status=200){const response=await GET(new Request(`${origin}/api/internal/dream/v1/receipts/${requestId}?operation=user-preferences.save`,{headers:headers(token,requestId)}),{params:Promise.resolve({requestId})});const body=await response.json();assert.equal(response.status,status);assert.equal(body.request_id,requestId);assertions+=2;return body.data;}
try{
 const initial=await snapshot(f.user_id);assert(initial&&initial.first_login_completed===1&&initial.system_config_json===f.system_config);assertions++;
 assert.deepEqual(await call("user-preferences.get",{},{token:f.tokens.other}),{preferences:null});assert.equal(await snapshot(f.other_user_id),null);assertions+=2;
 const original=id(),merge={...empty,voice_configs_json:f.raw_voice,state_config_json:f.raw_state,meta_prompt:"",timezone:"Asia/Shanghai"};
 assert.deepEqual(await call("user-preferences.save",merge,{requestId:original}),{success:true});assertions++;
 const saved=await snapshot(f.user_id);assert(saved);assert.equal(saved.voice_configs_json,f.raw_voice);assert.equal(saved.state_config_json,f.raw_state);assert.equal(saved.meta_prompt,"");assert.equal(saved.selected_state,initial.selected_state);assert.equal(saved.first_login_completed,1);assert.equal(saved.system_config_json,f.system_config);assertions+=6;
 await call("user-preferences.save",merge,{requestId:original});assert.deepEqual(await snapshot(f.user_id),saved);assertions++;
 await call("user-preferences.save",{...merge,timezone:"different"},{requestId:original,status:409});assert.deepEqual(await snapshot(f.user_id),saved);assertions++;
 const projection=await call("user-preferences.get",{});assert(projection&&"preferences"in projection&&projection.preferences);assert.equal(projection.preferences.voice_configs_json,f.raw_voice);assert.equal(projection.preferences.state_config_json,f.raw_state);assert.equal(projection.preferences.first_login_completed,1);assert(!Object.hasOwn(projection.preferences,"system_config_json"));assertions+=4;
 const denied=id();await call("user-preferences.save",{...empty,state_config_json:"[]",timezone:"must-not-save"},{requestId:denied,status:400});assert.deepEqual(await snapshot(f.user_id),saved);assert.equal((await recovery(denied)).status,"absent");assertions+=2;
 await call("user-preferences.save",{...empty,first_login_completed:0},{status:400});await call("user-preferences.save",{...empty,system_config_json:"caller"},{status:400});await call("user-preferences.save",{...empty,user_id:f.other_user_id},{status:400});await call("user-preferences.get",{user_id:f.other_user_id},{status:400});
 await call("user-preferences.save",empty,{token:f.tokens.read_only,status:403});await call("user-preferences.get",{},{token:f.tokens.thread,status:403});await call("user-preferences.save",empty,{token:f.tokens.thread,status:403});await call("user-preferences.get",{},{token:"",status:401});assert.deepEqual(await snapshot(f.user_id),saved);assertions++;
 const a=id(),b=id();await Promise.all([call("user-preferences.save",{...empty,meta_prompt:"first concurrent field"},{token:f.tokens.other,requestId:a}),call("user-preferences.save",{...empty,timezone:"concurrent timezone"},{token:f.tokens.other,requestId:b})]);
 const inserted=await snapshot(f.other_user_id);assert(inserted);assert.equal(inserted.meta_prompt,"first concurrent field");assert.equal(inserted.timezone,"concurrent timezone");assert.equal(inserted.first_login_completed,0);assert.equal(inserted.system_config_json,null);assertions+=4;
 const update=id();await Promise.all([call("user-preferences.save",{...empty,selected_state:"selected"},{token:f.tokens.other,requestId:update}),call("user-preferences.save",{...empty,selected_state:"selected"},{token:f.tokens.other,requestId:update})]);const updated=await snapshot(f.other_user_id);assert(updated);assert.equal(updated.selected_state,"selected");assert.equal(updated.meta_prompt,inserted.meta_prompt);assert.equal(updated.timezone,inserted.timezone);assertions+=3;
 await call("user-preferences.save",{...empty,selected_state:"selected"},{token:f.tokens.other,requestId:update});assert.deepEqual(await snapshot(f.other_user_id),updated);assertions++;
 const recovered=await recovery(original);assert.equal(recovered.status,"committed");assert.deepEqual(recovered.result,{success:true});assertions+=2;await recovery(original,f.tokens.thread,403);
 const wrongOwner=await recovery(original,f.tokens.other);assert.equal(wrongOwner.status,"absent");assertions++;
 const counts=await verification.query("SELECT (SELECT count(*)::int FROM dream.operation_receipts WHERE operation='user-preferences.save' AND request_id=$1) AS receipts,(SELECT count(*)::int FROM public.admin_audit_logs WHERE action='dream.user-preferences.save' AND request_id=$1) AS audits",[original]);assert.deepEqual(counts.rows[0],{receipts:1,audits:1});assertions++;
 const otherCounts=await verification.query("SELECT (SELECT count(*)::int FROM dream.operation_receipts WHERE operation='user-preferences.save' AND request_id=$1) AS receipts,(SELECT count(*)::int FROM public.admin_audit_logs WHERE action='dream.user-preferences.save' AND request_id=$1) AS audits",[update]);assert.deepEqual(otherCounts.rows[0],{receipts:1,audits:1});assertions++;
 console.log(JSON.stringify({result:"PASS",operations:2,assertions,fixture:"provider-free-isolated-restricted-roles",semantics:"five closed fields; NULL merge; raw config bytes; concurrent first insert; server first-login/system config isolated; receipt/audit recovery"}));
}finally{await verification.end();const g=globalThis as typeof globalThis&{__ink_auth_pool?:{end():Promise<void>};__ink_dream_data_pool?:{end():Promise<void>}};await g.__ink_auth_pool?.end();await g.__ink_dream_data_pool?.end();}
