// [Input] Primary-prepared named disposable PG, limited AUTH/DATA roles and private short-lived OAuth fixture.
// [Output] Actual public Deck/Voice/version routes, strict DTO/permission/atomic receipt/revision/CAS evidence.
// [Pos] Isolated provider-free contract harness; no raw SQL mutations, DDL, Runtime or real-account acceptance.
// [Sync] 2026-09-15: verify all19 operations through existing production handlers; verification SQL is read-only.
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {readFile,stat} from "node:fs/promises";
import {Client} from "pg";
import {POST} from "../../app/api/internal/dream/v1/operations/[operation]/route";
import {GET} from "../../app/api/internal/dream/v1/receipts/[requestId]/route";
import {deckVoiceOperationContracts,type DeckVoiceOperation} from "../../app/lib/dream/deckVoiceDto";
import {canonicalBusinessJson} from "../../app/lib/dream/deckContentCanonical";
const path=process.env.INK_AUTH_DECK_FIXTURE;
assert(path,"Explicit primary-prepared private fixture required");assert.equal((await stat(path)).mode&0o777,0o600);
const f=JSON.parse(await readFile(path,"utf8"));
assert(f.database.startsWith("ink_auth_data_codex_test_")&&f.port!==5433&&f.data_directory.startsWith("/private/tmp/ink-auth-data-migration-"));
const verification=new Client({connectionString:f.target_verification_url});await verification.connect();
const proof=(await verification.query("SELECT current_database() AS name,current_setting('port')::int AS port,current_setting('data_directory') AS root")).rows[0];
assert.deepEqual(proof,{name:f.database,port:f.port,root:f.data_directory});
for(const key of ["AUTH_DATABASE_URL","DREAM_DATA_DATABASE_URL"])assert.notEqual(new URL(process.env[key]??"").username,new URL(f.target_verification_url).username,"Production pool must use limited role");
const origin=f.issuer.replace(/\/api\/auth$/,""),visited=new Set<string>();let assertions=0;
const id=(prefix:string)=>prefix+"_"+randomUUID();
function headers(requestId:string,token=f.access_token){return {"x-request-id":requestId,"content-type":"application/json","x-ink-dream-service":f.service_id,"x-ink-dream-credential":f.service_secret,authorization:"Bearer "+token};}
async function invoke(name:DeckVoiceOperation,input:unknown,requestId:string,token=f.access_token){const response=await POST(new Request(origin+"/api/internal/dream/v1/operations/"+name,{method:"POST",headers:headers(requestId,token),body:JSON.stringify({request_id:requestId,input})}),{params:Promise.resolve({operation:name})});const body=await response.json();assert.equal(body.request_id,requestId);assertions++;visited.add(name);if(response.ok)deckVoiceOperationContracts[name].output.parse(body.data);return {status:response.status,body};}
async function call(name:DeckVoiceOperation,input:unknown,options:{token?:string;requestId?:string;status?:number}={}){const result=await invoke(name,input,options.requestId??id("deck_contract"),options.token);const code=typeof result.body.error?.code==="string"&&/^[A-Z0-9_]{1,100}$/.test(result.body.error.code)?result.body.error.code:"NO_PUBLIC_ERROR_CODE";assert.equal(result.status,options.status??200,name+" unexpected public status ("+code+")");assertions++;return result.body;}
async function receipt(operation:string,requestId:string,token=f.access_token){const response=await GET(new Request(origin+"/api/internal/dream/v1/receipts/"+requestId+"?operation="+encodeURIComponent(operation),{headers:headers(requestId,token)}),{params:Promise.resolve({requestId})});assert.equal(response.status,200);const body=await response.json();assert.equal(body.request_id,requestId);assertions+=2;return body.data;}
const state=async(deckId:string)=>(await call("deck-content.state",{deck_id:deckId})).data;
const detail=async(deckId:string,token=f.access_token)=>(await call("deck.detail",{deck_id:deckId},{token})).data.deck;
const createInput=(name:string)=>({name,name_zh:null,name_en:null,description:null,description_zh:null,description_en:null,icon:null,color:null,order_index:null,default_plugin_evidence:f.default_plugin_evidence});
try{
 await call("deck.list",{community:false});const community=(await call("deck.list",{community:true})).data.decks;assert(community.some((row:{id:string})=>row.id===f.system_deck_id));assertions++;
 assert.equal(await detail(f.other_deck_id),null);assertions++;
 const badId=id("bad_default"),badName=id("bad_name");await call("deck.create",{...createInput(badName),default_plugin_evidence:{...f.default_plugin_evidence,artifact_digest:"sha256:"+"0".repeat(64)}},{requestId:badId,status:409});
 assert.equal((await verification.query("SELECT count(*)::int AS n FROM public.decks WHERE name=$1",[badName])).rows[0].n,0);assert.equal((await receipt("deck.create",badId)).status,"absent");assertions+=2;
 await call("deck.create",{...createInput("external actor"),owner_id:"1"},{status:400});await call("deck.create",createInput("readonly"),{token:f.read_only_token,status:403});
 const createId=id("create"),input=createInput(id("working_deck"));const created=await Promise.all([call("deck.create",input,{requestId:createId}),call("deck.create",input,{requestId:createId})]);const deck=created[0].data.deck_id;assert.equal(created[1].data.deck_id,deck);assertions++;
 await call("deck.create",{...input,name:"different"},{requestId:createId,status:409});assert.equal((await receipt("deck.create",createId)).status,"committed");assert.equal((await receipt("deck.create",createId,f.other_access_token)).status,"absent");assertions+=2;
 const physical=await verification.query("SELECT (SELECT count(*)::int FROM public.deck_claude_plugin_refs WHERE deck_id=$1) AS refs,(SELECT count(*)::int FROM dream.operation_receipts WHERE request_id=$2) AS receipts,(SELECT count(*)::int FROM public.admin_audit_logs WHERE request_id=$2) AS audit",[deck,createId]);assert.deepEqual(physical.rows[0],{refs:1,receipts:1,audit:1});assertions++;
 assert.equal((await detail(deck)).owner_id,f.canonical_user_id);assert.equal(await detail(deck,f.other_access_token),null);assertions+=2;
 await call("deck.update",{deck_id:deck,updates:{name:"foreign"}},{token:f.other_access_token});assert.equal((await detail(deck)).name,input.name);assertions++;
 const initial=await state(deck);await call("deck.update",{deck_id:deck,updates:{}});assert.deepEqual(await state(deck),initial);assertions++;
 await call("deck.update",{deck_id:deck,updates:{enabled:false}});const disabled=await state(deck);assert.equal(disabled.draft_revision,initial.draft_revision+1);assert.equal((await detail(deck)).has_local_changes,false);assertions+=2;
 await call("deck.update",{deck_id:deck,updates:{name:"working edited"}});assert.equal((await detail(deck)).has_local_changes,true);assertions++;
 const raw='{"value":1.0,"big":9007199254740993,"zero":-0.0}',voice=(await call("voice.create",{deck_id:deck,name:"Working role",system_prompt:"",name_zh:null,name_en:null,icon:null,color:null,memory_workspace_config_json:raw,order_index:null})).data.voice_id;
 assert.equal((await detail(deck)).voices.find((row:{id:string})=>row.id===voice).memory_workspace_config_json,raw);assertions++;
 const afterVoice=await state(deck);await call("voice.update",{voice_id:voice,updates:{memory_workspace_config_json:raw}});assert.deepEqual(await state(deck),afterVoice);assertions++;
 await call("voice.update",{voice_id:voice,updates:{thread_id:f.thread_id}});assert.deepEqual(await state(deck),afterVoice);assertions++;
 await call("voice.update",{voice_id:voice,updates:{thread_id:f.other_thread_id}},{status:404});assert.equal((await detail(deck)).voices.find((row:{id:string})=>row.id===voice).thread_id,f.thread_id);assertions++;
 await call("voice.collect",{voice_id:f.private_voice_id,target_deck_id:deck},{status:404});await call("voice.collect",{voice_id:f.system_voice_id,target_deck_id:deck});
 const disposableVoice=(await call("voice.create",{deck_id:deck,name:"Delete role",system_prompt:"",name_zh:null,name_en:null,icon:null,color:null,memory_workspace_config_json:null,order_index:null})).data.voice_id;
 await call("voice.delete",{voice_id:disposableVoice},{token:f.other_access_token});assert((await detail(deck)).voices.some((row:{id:string})=>row.id===disposableVoice));assertions++;
 const voiceDeleteId=id("voice_delete");await call("voice.delete",{voice_id:disposableVoice},{requestId:voiceDeleteId});assert.equal((await call("voice.delete",{voice_id:disposableVoice},{requestId:voiceDeleteId})).data.changed,true);assert(!(await detail(deck)).voices.some((row:{id:string})=>row.id===disposableVoice));assertions+=2;
 const parentCount=(await verification.query("SELECT install_count FROM public.decks WHERE id=$1",[f.system_deck_id])).rows[0].install_count;
 const collected=(await call("deck.collect",{deck_id:f.system_deck_id})).data.deck_id;assert.equal((await detail(collected)).voices.length,1);assert.equal((await verification.query("SELECT install_count FROM public.decks WHERE id=$1",[f.system_deck_id])).rows[0].install_count,parentCount+1);assertions+=2;
 await call("deck.collect",{deck_id:deck},{status:409});await call("deck.collect",{deck_id:f.other_deck_id},{status:404});
 const provision=(await call("deck.provision-default",{default_plugin_evidence:f.default_plugin_evidence})).data.deck_id;
 assert.equal((await detail(provision)).parent_id,f.system_deck_id);assert.equal((await detail(provision)).publish_block_reason,"default_initialized");assertions+=2;await call("deck.toggle-publication",{deck_id:provision},{status:409});
 const reconciled=(await call("deck.reconcile-default",{default_plugin_evidence:f.default_plugin_evidence})).data;assert.equal(reconciled.deck_id,collected);assert.equal(reconciled.reason,"missing_ref");assertions+=2;
 assert.equal((await call("deck.reconcile-default",{default_plugin_evidence:f.default_plugin_evidence})).data.reason,"refs_preserved");assertions++;
 const defaults=await Promise.all([call("deck.reconcile-default",{default_plugin_evidence:f.default_plugin_evidence},{token:f.other_access_token}),call("deck.reconcile-default",{default_plugin_evidence:f.default_plugin_evidence},{token:f.other_access_token})]);assert.equal(defaults[0].data.deck_id,defaults[1].data.deck_id);assert.deepEqual(defaults.map(row=>row.data.reason).sort(),["default_created","refs_preserved"]);assertions+=2;
 const publishId=id("publish"),published=await Promise.all([call("deck.toggle-publication",{deck_id:deck},{requestId:publishId}),call("deck.toggle-publication",{deck_id:deck},{requestId:publishId})]);assert(published.every(row=>row.data.published===true));assert.equal((await detail(deck)).published,true);assertions+=2;
 await call("deck.toggle-publication",{deck_id:deck});assert.equal((await detail(deck)).published,false);assertions++;await call("deck.toggle-publication",{deck_id:deck});
 const fork=(await call("deck.collect",{deck_id:deck},{token:f.other_access_token})).data.deck_id;assert.equal((await detail(fork,f.other_access_token)).voices.length,(await detail(deck)).voices.length);assertions++;
 const forkRefs=(await verification.query("SELECT plugin_installation_id FROM public.deck_claude_plugin_refs WHERE deck_id=$1 ORDER BY plugin_installation_id",[fork])).rows;
 await call("deck.update",{deck_id:fork,updates:{enabled:false,order_index:99}},{token:f.other_access_token});await call("deck.update",{deck_id:deck,updates:{name:"parent next"}});
 const synced=(await call("deck.sync-parent",{deck_id:fork},{token:f.other_access_token})).data;const syncedDeck=await detail(fork,f.other_access_token);assert.equal(syncedDeck.name,"parent next");assert.equal(syncedDeck.enabled,false);assert.equal(syncedDeck.order_index,99);assert.equal(synced.synced_voices,(await detail(deck)).voices.length);assert.deepEqual((await verification.query("SELECT plugin_installation_id FROM public.deck_claude_plugin_refs WHERE deck_id=$1 ORDER BY plugin_installation_id",[fork])).rows,forkRefs);assertions+=5;
 const blocked=(await call("deck.delete",{deck_id:deck},{status:409})).error;assert.equal(blocked.details.reason,"child_decks");assert.equal((await verification.query("SELECT count(*)::int AS n FROM public.deck_claude_plugin_refs WHERE deck_id=$1",[deck])).rows[0].n,1);assertions+=2;
 const s=await state(deck),base={deck_id:deck,expected_draft_revision:s.draft_revision,expected_base_version:s.latest_version};const preview=(await call("deck-content.preview",base)).data;assert(preview.changes.some((row:{scope:string})=>row.scope==="agents"));assertions++;
 const commitId=id("commit"),commits=await Promise.all([call("deck-content.commit",{...base,description:"😀".repeat(200)},{requestId:commitId}),call("deck-content.commit",{...base,description:"😀".repeat(200)},{requestId:commitId})]);assert.equal(commits[0].data.version.version,1);assert.deepEqual(commits[0].data,commits[1].data);assertions+=2;
 const committed=await state(deck);assert.equal(committed.status,"published");assert.equal(committed.dirty,false);assertions+=2;
 const unchangedId=id("nochange");await call("deck-content.commit",{deck_id:deck,expected_draft_revision:committed.draft_revision,expected_base_version:committed.latest_version,description:null},{requestId:unchangedId,status:409});assert.equal((await receipt("deck-content.commit",unchangedId)).status,"absent");assertions++;
 const history=(await call("deck-content.history",{deck_id:deck,limit:100})).data;assert.equal(history.versions.length,1);assertions++;
 const version=(await call("deck-content.detail",{deck_id:deck,version:1})).data;assert(version.snapshot_json.includes("9007199254740993"));assert(version.snapshot_json.includes("1.0"));assert.equal((await canonicalBusinessJson(version.snapshot_json)).content_hash,version.content_hash);assert.equal(version.created_by,f.canonical_user_id);assertions+=4;
 await call("voice.update",{voice_id:voice,updates:{system_prompt:"changed"}});const nextState=await state(deck);const stale=(await call("deck-content.commit",{...base,description:null},{status:409})).error;assert.deepEqual(stale.details,{current_draft_revision:nextState.draft_revision,current_version:1});assertions++;
 const nextBase={deck_id:deck,expected_draft_revision:nextState.draft_revision,expected_base_version:1,description:null};const concurrent=await Promise.all([invoke("deck-content.commit",nextBase,id("race_commit")),invoke("deck-content.commit",nextBase,id("race_commit"))]);assert.deepEqual(concurrent.map(row=>row.status).sort(),[200,409]);assert.equal((await call("deck-content.history",{deck_id:deck,limit:100})).data.versions.length,2);assertions+=2;
 await call("deck.toggle-publication",{deck_id:fork},{token:f.other_access_token});const forkVoice=(await detail(fork,f.other_access_token)).voices[0].id;
 const reciprocal=await Promise.all([call("voice.collect",{voice_id:forkVoice,target_deck_id:deck}),call("voice.collect",{voice_id:voice,target_deck_id:fork},{token:f.other_access_token})]);assert(reciprocal.every(row=>typeof row.data.voice_id==="string"));assertions++;
 const disposable=(await call("deck.create",createInput("Delete owned"))).data.deck_id;const deleteId=id("delete");await call("deck.delete",{deck_id:disposable},{token:f.other_access_token});assert.notEqual(await detail(disposable),null);assertions++;
 await call("deck.delete",{deck_id:disposable},{requestId:deleteId});assert.equal((await call("deck.delete",{deck_id:disposable},{requestId:deleteId})).data.changed,true);assert.equal(await detail(disposable),null);assert.equal((await verification.query("SELECT count(*)::int AS n FROM public.deck_claude_plugin_refs WHERE deck_id=$1",[disposable])).rows[0].n,0);assertions+=3;
 assert.deepEqual([...visited].sort(),Object.keys(deckVoiceOperationContracts).sort());assertions++;
 console.log(`PUBLIC DECK VOICE CONTRACT PASS: operations=${visited.size}; assertions=${assertions}; restricted-pools/DTO/owner/atomic-default/fork/sync/revision/CAS/raw-numeric-hash/receipt; provider-free`);
}finally{const g=globalThis as typeof globalThis&{__ink_dream_data_pool?:{end():Promise<void>};__ink_auth_pool?:{end():Promise<void>}};await g.__ink_dream_data_pool?.end();await g.__ink_auth_pool?.end();await verification.end();}
