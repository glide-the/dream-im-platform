// [Input] Disposable synthetic release trees, without services, credentials or dependencies.
// [Output] Manifest closure, config exclusion and symlink escape protection evidence.
// [Pos] Provider-free release packaging contract.
// [Sync] 2026-11-08: cover complete workspace links and closed private config boundary.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {releaseEntries} from './package-admin-release.mjs';
function fixture(action){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ink-admin-package-contract-'));try{for(const name of ['.next','packages/db/dist','packages/db/node_modules','node_modules'])fs.mkdirSync(path.join(root,name),{recursive:true});return action(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('complete dependency and workspace links are registered, env and cache excluded',()=>fixture(root=>{
 for(const name of ['.env.local','.env.example','.next/BUILD_ID','packages/db/dist/index.js','node_modules/index.js'])fs.writeFileSync(path.join(root,name),'synthetic');
 fs.mkdirSync(path.join(root,'.next/cache'));fs.writeFileSync(path.join(root,'.next/cache/private'),'excluded');
 fs.symlinkSync('../dist/index.js',path.join(root,'packages/db/node_modules/local'));
 const entries=releaseEntries(root,['.env.local','.env.example']);
 assert.deepEqual(entries.map(e=>e.path),['.next/BUILD_ID','node_modules/index.js','packages/db/dist/index.js','packages/db/node_modules/local']);
 assert.equal(entries.at(-1).link,'../dist/index.js');assert.match(entries[0].sha256,/^[a-f0-9]{64}$/);
}));
test('absolute external dependency links are rejected',()=>fixture(root=>{
 fs.symlinkSync('/etc/hosts',path.join(root,'node_modules/escape'));
 assert.throws(()=>releaseEntries(root,[]),/escapes checkout/);
}));
