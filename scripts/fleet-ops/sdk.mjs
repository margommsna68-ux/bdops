import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {AeError} from './ae.mjs';
// Full SDK code of one running VM, read in the guest by the Central read-only helper (C:\AVC-SECRETS\codex-tools\mth-machine-read.ps1 -Mode Sdk).
// The helper prints a MASKED answer and writes the full capture (ACL: current user + SYSTEM) under C:\AVC-SECRETS\codex-runtime.
// We read that capture once and delete it. The code never goes to logs, AE evidence or the fleet journal — only to the web API.
const SDK=/^sdk-win-[0-9a-f]{32}$/,UUID=/^[0-9a-f-]{36}$/i;
export function captureFile(dir,uuid,since,list=fs.readdirSync){
 const prefix='sdk-capture-'+uuid.toLowerCase()+'-';
 const files=list(dir).filter(f=>f.toLowerCase().startsWith(prefix)&&f.endsWith('.json')).map(f=>path.join(dir,f)).filter(f=>fs.statSync(f).mtimeMs>=since-1000).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
 return files[0]??null;
}
export function codeFromCapture(json){
 const files=json?.guest?.candidateFiles;
 if(!Array.isArray(files)||!files.length)return null;
 const codes=[...new Set(files.map(f=>String(f.code||'').toLowerCase()).filter(c=>SDK.test(c)))];
 return codes.length===1?codes[0]:null;
}
export function createSdkReader({helper='C:/AVC-SECRETS/codex-tools/mth-machine-read.ps1',runtimeDir='C:/AVC-SECRETS/codex-runtime',powershell='C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',exec=execFile,readFile=fs.readFileSync,unlink=fs.unlinkSync}={}){
 return {
  /** @returns {Promise<{code:string,tail:string}|null>} null when the guest has no single SDK file (no EarnApp installed) */
  async read({host,vm,uuid}){
   if(!UUID.test(uuid)||!/^(VM_|m_)\d{1,4}$/.test(vm)||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(host))throw new AeError('BAD_ARGS');
   const since=Date.now();
   const out=await new Promise((resolve,reject)=>exec(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-Server',host,'-Mode','Sdk','-VmUuid',uuid,'-VmName',vm],{shell:false,windowsHide:true,timeout:120000,maxBuffer:1024*1024,encoding:'utf8'},(e,stdout)=>e&&!stdout?reject(new AeError('SDK_READ_UNKNOWN',String(e.code||e.message))):resolve(stdout)));
   let answer;try{answer=JSON.parse(String(out).trim().split(/\r?\n/).filter(Boolean).at(-1));}catch{throw new AeError('SDK_READ_PROTOCOL');}
   if(answer.ok===false)throw new AeError('SDK_READ_FAILED',String(answer.error||''));
   const file=captureFile(runtimeDir,uuid,since);
   if(!file)throw new AeError('SDK_CAPTURE_MISSING');
   let code;try{code=codeFromCapture(JSON.parse(readFile(file,'utf8')));}finally{try{unlink(file);}catch{/* ACL-protected leftover is acceptable */}}
   return code?{code,tail:code.slice(-4)}:null;
  }
 };
}
