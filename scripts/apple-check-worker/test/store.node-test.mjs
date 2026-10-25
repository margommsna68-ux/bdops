import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,symlink,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';

test('journal persists only allowlisted identity and terminal result; cleanup is ownership bounded',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'apple-worker-'));
  const store=await Store.open(root); const profile=await store.createProfile();
  await store.save({jobId:'job',profileId:profile.id,phase:'SUBMITTING',password:'secret',leaseToken:'capability',email:'private'});
  const disk=await readFile(path.join(root,'pending.json'),'utf8');
  assert.equal(disk.includes('secret'),false); assert.equal(disk.includes('private'),false);
  assert.deepEqual(await store.load(),{jobId:'job',leaseToken:'capability',profileId:profile.id,phase:'SUBMITTING'});
  await writeFile(path.join(profile.path,'cookies'),'private');
  await store.cleanup(profile.id); await assert.rejects(access(profile.path));
  await assert.rejects(store.cleanup('../outside'),/PROFILE/);
});
test('cleanup refuses symlinks and wrong markers without touching foreign files',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'apple-worker-'));
  const outside=await mkdtemp(path.join(os.tmpdir(),'apple-foreign-'));
  await writeFile(path.join(outside,'keep'),'safe');
  const store=await Store.open(root);const p=await store.createProfile();
  await symlink(outside,path.join(p.path,'link'),'junction');
  await assert.rejects(store.cleanup(p.id),/LINK/);
  assert.equal(await readFile(path.join(outside,'keep'),'utf8'),'safe');
  const p2=await store.createProfile();await writeFile(path.join(p2.path,'.owner'),'foreign');
  await assert.rejects(store.cleanup(p2.id),/OWNER/);
});
test('root symlinks and nested symlink ancestors are refused',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'apple-link-'));
  const real=path.join(root,'real');await mkdir(real);await symlink(real,path.join(root,'alias'),'junction');
  await assert.rejects(Store.open(path.join(root,'alias','child')),/LINK/);
});
test('exclusive lock prevents a second worker and does not silently steal a stale lock',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'apple-lock-'));const a=await Store.open(root);const b=await Store.open(root);
  const unlock=await a.lock();await assert.rejects(b.lock(),/LOCKED/);await unlock();await (await b.lock())();
});
test('partial Windows cleanup failure preserves ownership marker for a safe retry',{skip:process.platform!=='win32'},async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'apple-partial-'));const store=await Store.open(root);const p=await store.createProfile();
  const locked=path.join(p.path,'z-locked');await writeFile(locked,'fixture');
  const script=`$f=[IO.File]::Open('${locked.replaceAll("'","''")}','Open','Read','None');[Console]::WriteLine('READY');[void][Console]::ReadLine();$f.Dispose()`;
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.once('exit',()=>reject(new Error('LOCK_FIXTURE_EXITED')));});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  try{await assert.rejects(store.cleanup(p.id));assert.equal(await readFile(path.join(p.path,'.owner'),'utf8'),p.id);}
  finally{child.stdin.end('\n');await exited;}
  await store.cleanup(p.id);await assert.rejects(access(p.path));
});
