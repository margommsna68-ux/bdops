import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawn} from 'node:child_process';
import {atomicJson} from '../src/store.mjs';

test('Windows transient file sharing lock does not lose the next journal version',{skip:process.platform!=='win32'},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'apple-atomic-lock-')),file=path.join(dir,'claim.json');await writeFile(file,JSON.stringify({version:1}));
 const script=`$f=[IO.File]::Open('${file.replaceAll("'","''")}',[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read);try{[Console]::WriteLine('READY');Start-Sleep -Milliseconds 600}finally{$f.Dispose()}`;
 const child=spawn(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 const done=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',c=>c===0?resolve():reject(Error('LOCK_HELPER_FAILED')))});
 try{
  await new Promise((resolve,reject)=>{let text='';child.stdout.on('data',s=>{text+=s;if(text.includes('READY'))resolve()});child.once('exit',()=>reject(Error('NO_LOCK_SIGNAL')));child.once('error',reject)});
  await atomicJson(file,{version:2});assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{version:2});
 }finally{await done;}
});
