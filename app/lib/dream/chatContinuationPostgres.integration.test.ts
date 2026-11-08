// [Input] Explicitly named, migrated and owned disposable PostgreSQL.
// [Output] Production continuation service proofs for origin, owner, snapshot, CAS and no replay.
// [Pos] Provider-free contract; preparation/migration and cleanup belong to the primary harness.
// [Sync] 2026-11-04: concurrent execution ends share one Thread/session and durable query phase.
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {runChatThreadOperation,type ChatThreadActor} from './chatThreadService';
import {continuationSnapshotDto,queueEntryResultDto,threadCreateResultDto} from './chatThreadDto';
const url=process.env.CHAT_CONTINUATION_TEST_DATABASE_URL;
const name=url?new URL(url).pathname.slice(1):'';
const enabled=process.env.CHAT_CONTINUATION_TEST_OWNED==='1'&&/^ink_chat_continuation_test_[a-f0-9]+$/.test(name);
describe.skipIf(!enabled)('cross-platform continuation PostgreSQL',()=>{
 const pool=new Pool({connectionString:url,max:8}),db=drizzle(pool);
 const actor:ChatThreadActor={principal:{subject:'continuation-subject',canonical_user_id:'1',client_id:'continuation-fixture',scopes:['dream:read','dream:write'],status:'active'},threadScope:null};
 const call=(operation:Parameters<typeof runChatThreadOperation>[0],input:unknown,who=actor)=>db.transaction(tx=>runChatThreadOperation(operation,input,who,tx));
 beforeAll(async()=>{
  expect((await pool.query('SELECT current_database() AS name')).rows[0].name).toBe(name);
  expect((await pool.query('SELECT count(*)::int AS count FROM users')).rows[0].count).toBe(0);
  await pool.query("INSERT INTO users(id,email,password_hash) VALUES(1,'continuation@example.invalid','fixture'),(2,'other-continuation@example.invalid','fixture')");
 });
 afterAll(async()=>{await pool.end();});
 async function fixture(){
  const created=threadCreateResultDto.parse(await call('chat-thread.create-with-origin',{deck_id:null,voice_id:null,title:'Cross-platform fixture',created_execution_origin:'mobile_ios'}));
  const id=created.thread_id,sid=randomUUID(),mid=randomUUID();
  await call('chat-thread.update-session',{thread_id:id,claude_session_id:sid,agent_contract_version:'v1'});
  const snapshot=continuationSnapshotDto.parse(await call('chat-message.resume-snapshot',{thread_id:id,message_id:mid,dispatch_turn_id:null}));
  const input={thread_id:id,message_id:mid,parts_json:'[{"type":"text","text":"Continue once"}]',metadata_json:null,title_candidate:'Continue once',history_digest:snapshot.history_digest,claude_session_id:sid,owner:randomUUID(),dispatch_turn_id:randomUUID()};
  return {id,sid,snapshot,input};
 }
 it('stores immutable creation origin and enforces owner on snapshots',async()=>{
  const f=await fixture();expect((await pool.query('SELECT created_execution_origin FROM chat_thread WHERE id=$1',[f.id])).rows[0].created_execution_origin).toBe('mobile_ios');
  const other={...actor,principal:{...actor.principal,canonical_user_id:'2'}};
  await expect(call('chat-message.resume-snapshot',{thread_id:f.id,message_id:null,dispatch_turn_id:null},other)).rejects.toMatchObject({code:'CHAT_THREAD_NOT_FOUND'});
 });
 it('allows one claimant, excludes the current input and prevents armed replay',async()=>{
  const f=await fixture();
  const concurrent=await Promise.allSettled([call('chat-input.claim-continuation',f.input),call('chat-input.claim-continuation',{...f.input,owner:randomUUID()})]);
  expect(concurrent.filter(v=>v.status==='fulfilled')).toHaveLength(1);
  const accepted=concurrent.find(v=>v.status==='fulfilled') as PromiseFulfilledResult<unknown>;
  let entry=queueEntryResultDto.parse(accepted.value).entry;
  const owner=(await pool.query('SELECT continuation_owner AS owner FROM chat_input_queue WHERE message_id=$1',[f.input.message_id])).rows[0].owner;
  const progress={thread_id:f.id,message_id:entry.message_id,owner,dispatch_turn_id:entry.dispatch_turn_id!,expected_revision:entry.revision,action:'arm_query'};
  entry=queueEntryResultDto.parse(await call('chat-input.continuation-progress',progress)).entry;
  await expect(call('chat-input.continuation-progress',progress)).rejects.toMatchObject({code:'CHAT_CONTINUATION_CLAIM_CONFLICT'});
  await expect(call('chat-input.transition',{thread_id:f.id,message_id:entry.message_id,expected_revision:entry.revision,dispatch_turn_id:entry.dispatch_turn_id,action:'consume'})).rejects.toMatchObject({code:'CHAT_CONTINUATION_REQUIRED'});
  await call('chat-input.continuation-progress',{...progress,expected_revision:entry.revision,action:'mark_unknown'});
  await expect(call('chat-message.resume-snapshot',{thread_id:f.id,message_id:null,dispatch_turn_id:null})).rejects.toMatchObject({code:'CHAT_CONTINUATION_BUSY'});
  expect((await pool.query('SELECT count(*)::int AS count FROM chat_message WHERE thread_id=$1',[f.id])).rows[0].count).toBe(1);
 });
 it('rejects stale history before persistence and requires a committed assistant before release',async()=>{
  const f=await fixture();
  await expect(call('chat-input.claim-continuation',{...f.input,message_id:'stale',history_digest:'0'.repeat(64)})).rejects.toMatchObject({code:'CHAT_CONTINUATION_HISTORY_CHANGED'});
  expect((await pool.query('SELECT count(*)::int AS count FROM chat_message WHERE thread_id=$1',[f.id])).rows[0].count).toBe(0);
  const input={...f.input,message_id:randomUUID()};let entry=queueEntryResultDto.parse(await call('chat-input.claim-continuation',input)).entry;
  entry=queueEntryResultDto.parse(await call('chat-input.continuation-progress',{thread_id:f.id,message_id:input.message_id,owner:input.owner,dispatch_turn_id:input.dispatch_turn_id,expected_revision:entry.revision,action:'arm_query'})).entry;
  const p={thread_id:f.id,message_id:input.message_id,owner:input.owner,dispatch_turn_id:input.dispatch_turn_id,expected_revision:entry.revision,action:'complete'};
  await expect(call('chat-input.continuation-progress',p)).rejects.toMatchObject({code:'CHAT_CONTINUATION_RESULT_UNKNOWN'});
  await call('chat-message.persist',{thread_id:f.id,message_id:randomUUID(),role:'assistant',parts:[{type:'text',text:'Saved answer'}],metadata:{turnId:input.dispatch_turn_id,turnStatus:'completed'},history_final_text:null,history_process_available:false,history_projection_version:null});
  entry=queueEntryResultDto.parse(await call('chat-input.continuation-progress',p)).entry;expect(entry.status).toBe('consumed');
  const final=continuationSnapshotDto.parse(await call('chat-message.resume-snapshot',{thread_id:f.id,message_id:null,dispatch_turn_id:null}));expect(final.messages).toHaveLength(2);expect(final.thread.claude_session_id).toBe(f.sid);
 });
 it('retries a proven pre-query failure under the same message without duplicate persistence',async()=>{
  const f=await fixture();let entry=queueEntryResultDto.parse(await call('chat-input.claim-continuation',f.input)).entry;
  entry=queueEntryResultDto.parse(await call('chat-input.continuation-progress',{thread_id:f.id,message_id:f.input.message_id,owner:f.input.owner,dispatch_turn_id:f.input.dispatch_turn_id,expected_revision:entry.revision,action:'fail_before_query'})).entry;
  const retried=queueEntryResultDto.parse(await call('chat-input.claim-continuation',{...f.input,owner:randomUUID(),dispatch_turn_id:randomUUID()})).entry;
  expect(retried.revision).toBeGreaterThan(entry.revision);
  expect((await pool.query('SELECT count(*)::int AS count FROM chat_message WHERE thread_id=$1',[f.id])).rows[0].count).toBe(1);
 });
 it('keeps acknowledged stopped input and permits a later message without replaying that input',async()=>{
  const f=await fixture();let entry=queueEntryResultDto.parse(await call('chat-input.claim-continuation',f.input)).entry;
  const p={thread_id:f.id,message_id:f.input.message_id,owner:f.input.owner,dispatch_turn_id:f.input.dispatch_turn_id,expected_revision:entry.revision,action:'arm_query'};
  entry=queueEntryResultDto.parse(await call('chat-input.continuation-progress',p)).entry;
  entry=queueEntryResultDto.parse(await call('chat-input.continuation-progress',{...p,expected_revision:entry.revision,action:'fail_after_query'})).entry;
  expect(entry.status).toBe('failed');
  const snapshot=continuationSnapshotDto.parse(await call('chat-message.resume-snapshot',{thread_id:f.id,message_id:null,dispatch_turn_id:null}));
  expect(snapshot.messages).toHaveLength(1);
  await expect(call('chat-input.claim-continuation',{...f.input,owner:randomUUID(),dispatch_turn_id:randomUUID()})).rejects.toMatchObject({code:'CHAT_CONTINUATION_ALREADY_CLAIMED'});
  const next=queueEntryResultDto.parse(await call('chat-input.claim-continuation',{...f.input,message_id:randomUUID(),owner:randomUUID(),dispatch_turn_id:randomUUID(),history_digest:snapshot.history_digest})).entry;
  expect(next.status).toBe('dispatching');
 });

});
