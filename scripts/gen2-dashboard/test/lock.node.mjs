import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { acquireLock } from '../io.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const record=pid=>JSON.stringify({pid,startedAt:'2026-10-26T01:00:00.000Z'});
const missing=()=>Object.assign(new Error('not running'),{code:'ESRCH'});
async function fixture(t) {
 const root=await fs.mkdtemp(path.join(here,'.tmp-lock-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 return {root,file:path.join(root,'bridge.lock')};
}
async function deadPid() {
 const child=spawn(process.execPath,['-e','process.exit(0)'],{stdio:'ignore',windowsHide:true});
 await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
 assert.throws(()=>process.kill(child.pid,0),{code:'ESRCH'});
 return child.pid;
}

test('recovers a valid dead-PID lock and preserves pending journal bytes',async t=>{
 const {root,file}=await fixture(t);await fs.writeFile(file,record(await deadPid()));
 const journal=JSON.stringify({pending:{key:'original-key',body:{amount:'8.25'}}});
 await fs.writeFile(path.join(root,'state.json'),journal);
 const release=await acquireLock(root);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).pid,process.pid);
 assert.equal(await fs.readFile(path.join(root,'state.json'),'utf8'),journal);
 await release();assert.equal(await fs.readFile(path.join(root,'state.json'),'utf8'),journal);
});

test('current PID lock is never reclaimed',async t=>{
 const {root,file}=await fixture(t),bytes=record(process.pid);await fs.writeFile(file,bytes);
 await assert.rejects(()=>acquireLock(root),/LOCK_HELD_OR_UNAVAILABLE/);
 assert.equal(await fs.readFile(file,'utf8'),bytes);
});

test('malformed or differently shaped locks are never probed or reclaimed',async t=>{
 const {root,file}=await fixture(t);
 const probe=t.mock.method(process,'kill',()=>{throw new Error('must not probe invalid lock');});
 for(const bytes of ['{','null','[]',record(0),record(-1),record(1.2),JSON.stringify({pid:123}),JSON.stringify({pid:123,startedAt:'yesterday'}),JSON.stringify({pid:123,startedAt:'2026-10-26T01:00:00.000Z',other:true})]) {
  await fs.writeFile(file,bytes);await assert.rejects(()=>acquireLock(root),/LOCK_HELD_OR_UNAVAILABLE/);
  assert.equal(await fs.readFile(file,'utf8'),bytes);
 }
 assert.equal(probe.mock.callCount(),0);
});

test('EPERM is unknown ownership and never permits recovery',async t=>{
 const {root,file}=await fixture(t),bytes=record(123);await fs.writeFile(file,bytes);
 t.mock.method(process,'kill',()=>{throw Object.assign(new Error('permission denied'),{code:'EPERM'});});
 await assert.rejects(()=>acquireLock(root),/LOCK_HELD_OR_UNAVAILABLE/);
 assert.equal(await fs.readFile(file,'utf8'),bytes);
});

test('changed bytes after dead-PID check prevent removal even when JSON is equivalent',async t=>{
 const {root,file}=await fixture(t),original=record(123),replacement=original+'\n';await fs.writeFile(file,original);
 t.mock.method(process,'kill',(pid,signal)=>{assert.equal(pid,123);assert.equal(signal,0);writeFileSync(file,replacement);throw missing();});
 await assert.rejects(()=>acquireLock(root),/LOCK_HELD_OR_UNAVAILABLE/);
 assert.equal(await fs.readFile(file,'utf8'),replacement);
});

test('competing recoveries result in only one lock owner',async t=>{
 const {root,file}=await fixture(t);await fs.writeFile(file,record(await deadPid()));
 const results=await Promise.allSettled([acquireLock(root),acquireLock(root)]);
 const owners=results.filter(r=>r.status==='fulfilled');assert.equal(owners.length,1);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).pid,process.pid);
 await owners[0].value();
});
