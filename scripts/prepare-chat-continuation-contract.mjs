#!/usr/bin/env node
// [Input] Built DB runtime, repository Drizzle history and a runner-owned disposable cluster.
// [Output] Migrated ink_chat_continuation_test_* database plus a private validation env file.
// [Pos] Primary-owned migration harness; deterministic tests run separately through Luna.
// [Sync] 2026-11-04: never consumes ambient database credentials; stdin stop cleans owned resources.
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {once} from 'node:events';
import pg from 'pg';
import {spawn} from 'node:child_process';
import {startEmbeddedPostgres} from '../packages/db/dist/embedded-postgres.js';
const root=await mkdtemp(join(tmpdir(),'ink-chat-continuation-contract-'));
const name='ink_chat_continuation_test_'+randomBytes(6).toString('hex');
const listener=createServer();listener.listen(0,'127.0.0.1');await once(listener,'listening');const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
let database;
try {
 database=await startEmbeddedPostgres({mode:'embedded-postgres',dataDir:join(root,'postgres'),port,user:'postgres',password:randomBytes(32).toString('base64url'),database:name,sharedBuffers:'32MB',maxConnections:16},{listenAddresses:'127.0.0.1'});
 const pool=new pg.Pool({connectionString:database.connectionString,max:1});
 try {
  const identity=(await pool.query('SELECT current_database() AS name,current_user AS actor')).rows[0];
  if(identity.name!==name||identity.actor!=='postgres'||!/^ink_chat_continuation_test_[a-f0-9]+$/.test(name))throw Error('ISOLATED_DATABASE_IDENTITY_MISMATCH');
  await new Promise((resolveRun,reject)=>{
    const child=spawn(process.execPath,['scripts/migrate-provider-managed-accounts.mjs'],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:database.connectionString,TEST_DATABASE_URL:database.connectionString,MIGRATION_DATABASE_URL:database.connectionString,INK_MIGRATIONS_DIR:resolve('drizzle'),AI_CREDENTIAL_ENCRYPTION_KEY:randomBytes(32).toString('hex'),AI_CREDENTIAL_ENCRYPTION_KEY_ID:'continuation-fixture',AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER:randomBytes(32).toString('base64url')},stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',v=>{output+=v;});child.stderr.on('data',v=>{output+=v;});
    child.once('error',reject);child.once('exit',code=>{if(code===0)resolveRun();else{console.error(output);reject(Error('OWNED_MIGRATION_FAILED'));}});
  });
  const capability=(await pool.query("SELECT version FROM drizzle.schema_capabilities WHERE capability='dream.chat-continuation.v1'")).rows[0];
  if(capability?.version!==1)throw Error('CONTINUATION_MIGRATION_NOT_READY');
 } finally {await pool.end();}
 const file=join(root,'validation.env');
 await writeFile(file,`CHAT_CONTINUATION_TEST_DATABASE_URL=${database.connectionString}\nCHAT_CONTINUATION_TEST_OWNED=1\n`,{mode:0o600});
 console.log(JSON.stringify({ready:true,database:name,env_file:file}));
 process.stdin.resume();await Promise.race([once(process.stdin,'data'),once(process,'SIGTERM'),once(process,'SIGINT')]);
} finally {
 process.stdin.pause();
 await database?.stop();await rm(root,{recursive:true,force:true});console.log('owned_cluster_cleaned');
}
