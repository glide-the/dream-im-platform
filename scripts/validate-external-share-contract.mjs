#!/usr/bin/env node
// [Input] Canonical production repositories/handlers and a newly owned disposable PostgreSQL cluster.
// [Output] Forward/repeat/concurrent/drift/ACL, ownership, receipts and public revocation evidence.
// [Pos] Explicit isolated validation; never consumes ambient database credentials or normal accounts.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {mkdtemp, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {startEmbeddedPostgres} from '../packages/db/dist/embedded-postgres.js';
import {ExternalShareRepository} from '../app/lib/dream/externalShareRepository.ts';
import {externalShareOperations} from '../app/lib/dream/externalShareDto.ts';
import {handlePublicExternalShare} from '../app/lib/dream/externalShareHandler.ts';
import {ReceiptRepository} from '../app/lib/dream/receipts.ts';
const root=await mkdtemp(join(tmpdir(),'ink-external-share-validation-'));
const name='ink_external_share_test_'+randomBytes(6).toString('hex');
const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(done=>listener.close(done));
const contract=JSON.parse(await readFile('drizzle/contracts/dream-external-share-v1.json','utf8'));
const dist='.next-e2e-external-share-'+name.split('_').at(-1),tsconfigBefore=await readFile('tsconfig.json','utf8');
let cluster, owner, limited, httpServer, failed=false, stage='bootstrap';
const completed=[];
async function command(args, environment, expected=0) {
  const result=await new Promise((done,reject)=>{const child=spawn(process.execPath,args,{cwd:process.cwd(),env:environment,stdio:['ignore','pipe','pipe']});let stdout='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.resume();child.once('error',reject);child.once('exit',code=>done({code,stdout}));});
  assert.equal(result.code,expected,'ISOLATED_COMMAND_EXIT');return result.stdout;
}
try {
  cluster=await startEmbeddedPostgres({mode:'embedded-postgres',dataDir:join(root,'postgres'),port,user:'postgres',password:randomBytes(32).toString('base64url'),database:name,sharedBuffers:'32MB',maxConnections:16},{listenAddresses:'127.0.0.1'});
  owner=new pg.Pool({connectionString:cluster.connectionString,max:2});
  const identity=(await owner.query('SELECT current_database() AS name,current_user AS actor')).rows[0];
  assert(identity.name===name&&identity.actor==='postgres'&&/^ink_external_share_test_[a-f0-9]+$/.test(name),'ISOLATED_DATABASE_IDENTITY');
  const history=join(root,'history');await cp(resolve('drizzle'),history,{recursive:true,filter:path=>!path.endsWith('/0087_external_shares.sql')&&!path.endsWith('/0087_snapshot.json')});
  const journal=JSON.parse(await readFile(join(history,'meta/_journal.json'),'utf8'));const latest=journal.entries.pop();
  assert(latest.tag==='0087_external_shares','EXPECTED_FORWARD_MIGRATION');await writeFile(join(history,'meta/_journal.json'),JSON.stringify(journal));
  const environment={...process.env,MIGRATION_DATABASE_URL:cluster.connectionString,DATABASE_URL:cluster.connectionString,TEST_DATABASE_URL:cluster.connectionString,INK_MIGRATIONS_DIR:history,AI_CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString('hex'),AI_CREDENTIAL_ENCRYPTION_KEY_ID:'isolated-share-fixture',AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER:randomBytes(32).toString('base64url')};
  stage='fresh-prefix';await command(['scripts/migrate-provider-managed-accounts.mjs'],environment);
  const before=(await owner.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at')).rows;
  assert(before.length===journal.entries.length,'FRESH_PREFIX_LENGTH');completed.push('fresh-0086-prefix');
  const role='ink_share_data', password=randomBytes(32).toString('base64url');
  await owner.query(`CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}'`);
  await owner.query(`GRANT USAGE ON SCHEMA public,drizzle,dream TO ${role}; GRANT SELECT ON drizzle.schema_capabilities TO ${role}; GRANT SELECT,INSERT,UPDATE,DELETE ON chat_thread,user_sessions TO ${role}; GRANT SELECT,INSERT ON reflection_task_section TO ${role}; GRANT SELECT,INSERT,UPDATE ON dream.operation_receipts TO ${role}; GRANT INSERT ON admin_audit_logs TO ${role}`);
  stage='partial-drift';await owner.query('CREATE TABLE external_shares (id text PRIMARY KEY)');
  const target={...environment,INK_MIGRATIONS_DIR:resolve('drizzle')};
  await command(['packages/db/dist/migrate.js'],target,1);
  assert((await owner.query('SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations')).rows[0].count===before.length,'PARTIAL_DRIFT_COMMITTED');
  await owner.query('DROP TABLE external_shares');completed.push('partial-drift-rejected');
  stage='concurrent-upgrade';await Promise.all([command(['packages/db/dist/migrate.js'],target),command(['packages/db/dist/migrate.js'],target)]);
  await command(['scripts/migrate-provider-managed-accounts.mjs'],target);await command(['packages/db/dist/migrate.js','--check'],target);
  const after=(await owner.query('SELECT hash,created_at FROM drizzle.__drizzle_migrations ORDER BY created_at')).rows;
  assert(after.length===before.length+1&&JSON.stringify(after.slice(0,-1))===JSON.stringify(before),'IMMUTABLE_PREFIX_CHANGED');
  const capability=(await owner.query('SELECT version,contract_sha256 FROM drizzle.schema_capabilities WHERE capability=$1',[contract.capability])).rows[0];
  assert(capability.version===contract.version&&capability.contract_sha256===contract.contract_sha256,'CAPABILITY_MISMATCH');
  const rights=(await owner.query("SELECT has_table_privilege($1,'external_shares','SELECT') AS read,has_table_privilege($1,'external_shares','INSERT') AS create,has_table_privilege($1,'external_shares','UPDATE') AS update,has_table_privilege($1,'external_shares','DELETE') AS delete",[role])).rows[0];
  assert(rights.read&&rights.create&&rights.update&&!rights.delete,'DATA_ACL_MISMATCH');completed.push('0087-upgrade','concurrent-migrators','repeat-noop','immutable-prefix','limited-data-acl');
  const actorUrl=new URL(cluster.connectionString);actorUrl.username=role;actorUrl.password=password;
  limited=new pg.Pool({connectionString:actorUrl.href,max:2});const database=drizzle(limited);
  const users=(await owner.query("INSERT INTO users (email,password_hash) VALUES ('share-owner@example.invalid','fixture-only'),('share-other@example.invalid','fixture-only') RETURNING id")).rows;
  const first=String(users[0].id),other=String(users[1].id);
  const source='owned-note',foreign='other-note',thread='owned-chat';
  await owner.query('INSERT INTO user_sessions (id,user_id,editor_state_json) VALUES ($1,$2,$3),($4,$5,$3)',[source,first,'{}',foreign,other]);
  await owner.query('INSERT INTO chat_thread (id,user_id,title) VALUES ($1,$2,$3)',[thread,first,'Fixture chat']);
  const snapshot={kind:'note',title:'Fixture note',created_at:null,paragraphs:['Public fixture prose']};
  const input={kind:'note',source_id:source,snapshot};
  const repo=(id,action)=>database.transaction(tx=>action(new ExternalShareRepository(tx,id),tx));
  const key=randomUUID();const publish=body=>repo(first,(repository,tx)=>new ReceiptRepository(tx,'share-validation','fixture-actor').execute('external-share.create',key,body,externalShareOperations['external-share.create'].output,()=>repository.create(body)));
  stage='owner-publication';const published=await publish(input),again=await publish(input);
  assert(published.share.id===again.share.id,'PUBLICATION_RETRY_DUPLICATED');
  await assert.rejects(publish({...input,snapshot:{...snapshot,title:'Changed fixture'}}),error=>error.code==='OPERATION_REQUEST_CONFLICT','RECEIPT_CONFLICT_MISSING');
  await assert.rejects(repo(first,r=>r.create({...input,source_id:foreign})),error=>error.status===404,'FOREIGN_SOURCE_PUBLISHED');
  assert((await repo(other,r=>r.get(published.share.id))).share===null,'FOREIGN_RECORD_VISIBLE');
  await assert.rejects(repo(other,r=>r.revoke(published.share.id)),error=>error.status===404,'FOREIGN_REVOKE_ALLOWED');
  const second=await repo(first,r=>r.create(input));await repo(first,r=>r.create(input));
  await repo(first,r=>r.create({kind:'chat',source_id:thread,snapshot:{kind:'chat',title:'Fixture chat',created_at:null,messages:[{role:'user',content:'Fixture question'},{role:'assistant',content:'Fixture final answer'}]}}));
  completed.push('owner-source-and-record-isolation','receipt-idempotence-and-conflict','both-content-kinds');
  stage='keyset-list';const ids=[];let cursor=null;
  do {const page=await repo(first,r=>r.list({kind:'note',status:'active',limit:1,before:cursor}));ids.push(...page.shares.map(row=>row.id));cursor=page.next_cursor;assert(page.counts.note===3&&page.counts.chat===1,'CATEGORY_COUNTS');} while(cursor);
  assert(ids.length===3&&new Set(ids).size===3,'KEYSET_DUPLICATES_OR_GAPS');completed.push('keyset-pagination-and-counts');
  process.env.DREAM_DATA_DATABASE_URL=actorUrl.href;process.env.DREAM_DATA_PGPOOL_MAX='2';
  stage='public-reading';const token=published.share.path.split('/').at(-1);
  const httpListener=createServer();httpListener.listen(0,'127.0.0.1');await once(httpListener,'listening');const httpPort=httpListener.address().port;await new Promise(done=>httpListener.close(done));
  httpServer=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(httpPort)],{cwd:process.cwd(),env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',INK_ADMIN_E2E_DIST_DIR:dist},detached:true,stdio:['ignore','pipe','pipe']});httpServer.stdout.resume();httpServer.stderr.resume();
  const httpOrigin='http://127.0.0.1:'+httpPort,readyUntil=Date.now()+60_000;
  while(true) {try {const probe=await fetch(httpOrigin+'/api/public/shares/invalid-file-token',{signal:AbortSignal.timeout(2000)});await probe.body?.cancel();if(probe.status===404)break;}catch{/* The harness waits only for its own new HTTP listener. */}assert(Date.now()<readyUntil,'OWNED_HTTP_SERVER_NOT_READY');await new Promise(done=>setTimeout(done,250));}
  const httpCheck=status=>command(['node_modules/@playwright/test/cli.js','test','--config=tests/e2e/external-share-public.config.ts','--reporter=line'],{...process.env,EXTERNAL_SHARE_TEST_OWNED:'1',EXTERNAL_SHARE_TEST_URL:httpOrigin,EXTERNAL_SHARE_TEST_DB:name,EXTERNAL_SHARE_TEST_TOKEN:token,EXTERNAL_SHARE_TEST_STATUS:String(status)});
  await httpCheck(200);completed.push('playwright-active-http-2-passed');
  const publicRead=await handlePublicExternalShare(token);assert(publicRead.status===200&&isDeepStrictEqual(await publicRead.json(),snapshot),'PUBLIC_SNAPSHOT_OUTPUT');
  assert(publicRead.headers.get('cache-control')==='no-store','PUBLIC_CACHE_HEADER');
  await owner.query('DELETE FROM user_sessions WHERE id=$1',[source]);
  assert((await repo(first,r=>r.get(published.share.id))).share.source_available===false,'DELETED_SOURCE_FLAG');
  assert((await handlePublicExternalShare(token)).status===200,'SOURCE_DELETE_REMOVED_SNAPSHOT');completed.push('public-snapshot','source-delete-retains-share');
  stage='revocation';const revoked=await repo(first,r=>r.revoke(published.share.id)),repeat=await repo(first,r=>r.revoke(published.share.id));
  assert(revoked.share.status==='revoked'&&repeat.share.revoked_at===revoked.share.revoked_at,'REVOCATION_NOT_TERMINAL');
  assert((await handlePublicExternalShare(token)).status===404,'REVOKED_TOKEN_STILL_PUBLIC');
  await httpCheck(404);completed.push('playwright-revoked-http-2-passed');
  assert((await handlePublicExternalShare(second.share.path.split('/').at(-1))).status===200,'UNRELATED_SHARE_REVOKED');
  const page=await repo(first,r=>r.list({kind:'note',status:'revoked',limit:20,before:null}));assert(page.shares.length===1&&page.counts.note===2,'CONFIRMED_REVOCATION_COUNTS');
  await owner.query("UPDATE drizzle.schema_capabilities SET contract_sha256=repeat('0',64) WHERE capability=$1",[contract.capability]);
  assert((await handlePublicExternalShare(second.share.path.split('/').at(-1))).status===503,'CAPABILITY_FAILURE_OPEN');
  await owner.query('UPDATE drizzle.schema_capabilities SET contract_sha256=$1 WHERE capability=$2',[contract.contract_sha256,contract.capability]);
  completed.push('terminal-revocation','other-share-preserved','capability-failure-closed');
  console.log(JSON.stringify({status:'passed',database:name,migrations:after.length,checks:completed}));
} catch(error) {
  failed=true;console.error(JSON.stringify({status:'failed',stage,error:error?.name??'Error',code:error?.cause?.code??error?.code??null,message:/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:'REDACTED_DIAGNOSTIC'}));process.exitCode=1;
} finally {
  if(httpServer&&httpServer.exitCode===null){const stopped=once(httpServer,'exit');process.kill(-httpServer.pid,'SIGTERM');const deadline=setTimeout(()=>{try{process.kill(-httpServer.pid,'SIGKILL');}catch{/* Owned server already exited. */}},10_000);await stopped;clearTimeout(deadline);}
  const updated=JSON.parse(await readFile('tsconfig.json','utf8'));updated.include=updated.include.filter(path=>!path.startsWith(dist+'/'));
  if(isDeepStrictEqual(updated,JSON.parse(tsconfigBefore)))await writeFile('tsconfig.json',tsconfigBefore);else{failed=true;console.error('UNEXPECTED_TSCONFIG_CHANGE_RETAINED');}
  await rm(resolve(dist),{recursive:true,force:true});
  await globalThis.__ink_dream_data_pool?.end();delete globalThis.__ink_dream_data_pool;
  await limited?.end();await owner?.end();await cluster?.stop();await rm(root,{recursive:true,force:true});console.log('owned_share_cluster_cleaned');process.exitCode=failed?1:0;
}
