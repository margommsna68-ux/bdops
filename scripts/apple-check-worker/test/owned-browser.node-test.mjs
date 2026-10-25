import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../src/store.mjs';
import * as platform from '../src/platform.mjs';

const target='C:\\Worker State\\profiles\\12345678-1234-4123-8123-123456789abc';
const proc=(pid,parentPid,commandLine,creationTime=String(1000+pid))=>({pid,parentPid,creationTime,name:'chrome.exe',commandLine});
const root=(p=target)=>proc(10,1,`"C:\\Cloak\\chrome.exe" --user-data-dir="${p}"`);
const child=(pid=11,parentPid=10)=>proc(pid,parentPid,'chrome.exe --type=renderer');
test('ownership selection requires exact user-data-dir and never a prefix, URL, or foreign subtree',()=>{
 const rows=[root(),child(),proc(12,11,'chrome.exe --type=utility'),proc(20,1,`chrome.exe --user-data-dir="${target}-foreign"`),
  proc(21,20,'chrome.exe --type=renderer'),proc(30,10,'chrome.exe --user-data-dir=C:\\foreign --type=renderer'),child(31,30),
  {...child(40,10),name:'other.exe'},child(41,40),proc(50,1,`chrome.exe https://example.invalid/${target}`)];
 assert.deepEqual(platform.selectOwnedBrowserProcesses(target,rows).map(p=>p.pid),[10,11,12]);
});
test('selection handles canonical Windows case, slash, and separated argument spelling',()=>{
 const rows=[proc(10,1,`chrome.exe --user-data-dir "${target.toUpperCase().replaceAll('\\','/')}"`),child()];
 assert.deepEqual(platform.selectOwnedBrowserProcesses(target,rows).map(p=>p.pid),[10,11]);
});
test('unknown commands, duplicate profile flags, child-only matches, and reused parents prove no ownership',()=>{
 assert.deepEqual(platform.selectOwnedBrowserProcesses(target,[{...root(),commandLine:null},child()]),[]);
 assert.deepEqual(platform.selectOwnedBrowserProcesses(target,[proc(10,1,`chrome.exe --user-data-dir="${target}" --user-data-dir=C:\\foreign`),child()]),[]);
 assert.deepEqual(platform.selectOwnedBrowserProcesses(target,[proc(10,1,`chrome.exe --type=renderer --user-data-dir="${target}"`)]),[]);
 assert.deepEqual(platform.selectOwnedBrowserProcesses(target,[root(),{...child(),creationTime:'1'}]).map(p=>p.pid),[10]);
});
async function fixture(t){
 const dir=await mkdtemp(path.join(os.tmpdir(),'owned-browser-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=await Store.open(dir),profile=await store.createProfile();return profile;
}
test('termination revalidates identity, kills children first, and leaves foreign Chrome alone',async t=>{
 const p=await fixture(t);let rows=[root(p.path),child(),proc(30,1,'chrome.exe --user-data-dir=C:\\foreign')];const killed=[];
 const clean=await platform.terminateOwnedBrowser(p.path,{inspect:async()=>structuredClone(rows),terminate:async current=>{killed.push(current.pid);rows=rows.filter(p=>p.pid!==current.pid);}});
 assert.equal(clean,true);assert.deepEqual(killed,[11,10]);assert.deepEqual(rows.map(p=>p.pid),[30]);
});
test('wrong owner marker rejects before any process inspection or termination',async t=>{
 const p=await fixture(t);await writeFile(path.join(p.path,'.owner'),'foreign');let touched=false;
 await assert.rejects(platform.terminateOwnedBrowser(p.path,{inspect:async()=>{touched=true;return [];},terminate:async()=>{touched=true;}}),/PROFILE_OWNER/);
 assert.equal(touched,false);
});
test('PID reuse after selection is refused without terminating the replacement',async t=>{
 const p=await fixture(t);let inspections=0;const killed=[];
 await assert.rejects(platform.terminateOwnedBrowser(p.path,{inspect:async()=>++inspections===1?[root(p.path),child()]:[root(p.path),{...child(),creationTime:'99999'}],terminate:async current=>killed.push(current.pid)}),/BROWSER_IDENTITY_CHANGED/);
 assert.deepEqual(killed,[]);
});
test('root reuse or changed ancestry refuses terminating a previously selected descendant',async t=>{
 const p=await fixture(t);let inspections=0;const killed=[];
 await assert.rejects(platform.terminateOwnedBrowser(p.path,{inspect:async()=>++inspections===1?[root(p.path),child()]:[{...root(p.path),creationTime:'1'},child()],terminate:async current=>killed.push(current.pid)}),/BROWSER_IDENTITY_CHANGED/);
 assert.deepEqual(killed,[]);
});
test('failed termination or surviving owned processes never reports clean',async t=>{
 const p=await fixture(t);
 await assert.rejects(platform.terminateOwnedBrowser(p.path,{inspect:async()=>[root(p.path)],terminate:async()=>{throw new Error('native detail');}}),/OWNED_BROWSER_CLEANUP_FAILED/);
 await assert.rejects(platform.terminateOwnedBrowser(p.path,{inspect:async()=>[root(p.path)],terminate:async()=>{}}),/OWNED_BROWSER_UNRESOLVED/);
});
test('unknown command lines are never terminated and prevent a clean verification',async t=>{
 const p=await fixture(t);const killed=[];
 await assert.rejects(platform.terminateOwnedBrowser(p.path,{inspect:async()=>[{...root(p.path),commandLine:null}],terminate:async current=>killed.push(current.pid)}),/OWNED_BROWSER_UNRESOLVED/);
 assert.deepEqual(killed,[]);
});
test('a child appearing during root termination cannot be mistaken for clean orphaned Chrome',async t=>{
 const p=await fixture(t);let rows=[root(p.path)];
 await assert.rejects(platform.terminateOwnedBrowser(p.path,{inspect:async()=>structuredClone(rows),terminate:async()=>{rows=[child()];}}),/OWNED_BROWSER_UNRESOLVED/);
});
