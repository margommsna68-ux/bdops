// Offline operator tool for one hash-pinned preflight branch. No guest exit
// proof is inferred from HOST process absence; the runtime must opt in separately.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sanitizeNativeSource} from './engine/native-monitor-wire.mjs';

const OLD_BUILD='edd656962da9070ecb7d8e82cfeed34fe1905026655ccf547fcfbaed81cea43f';
const OLD_MONITOR='5aa5edfd4d7fa073e4975c962987515db9bac2ae821c1275142b5a8cf1aee8d3';
const VERSION='3.1.18.2', LIMIT=1024*1024;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{safeCode:code});};
const iso=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);

export function parseArgs(args){
  const names={'--home':'home','--machine-root':'machineRoot','--prior-idle-log':'priorIdleLog'},out={};
  for(let i=0;i<args.length;i++){
    const arg=args[i],equals=arg.indexOf('='),key=equals<0?arg:arg.slice(0,equals);
    if(!Object.hasOwn(names,key)||Object.hasOwn(out,names[key]))fail('INVALID_ARGUMENTS');
    const value=equals<0?args[++i]:arg.slice(equals+1);
    if(typeof value!=='string'||!value||value.includes('\0')||!(path.isAbsolute(value)||path.win32.isAbsolute(value)))fail('INVALID_ARGUMENTS');
    out[names[key]]=value;
  }
  if(Object.keys(out).length!==3)fail('INVALID_ARGUMENTS');
  return out;
}

function readBounded(file){
  if(fs.lstatSync(file).isSymbolicLink())fail('UNSAFE_INPUT_FILE');
  const fd=fs.openSync(file,'r');
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.size>LIMIT)fail('INPUT_BOUND_EXCEEDED');
    const buffer=Buffer.alloc(LIMIT+1);let length=0,n;
    while(length<buffer.length&&(n=fs.readSync(fd,buffer,length,buffer.length-length,null))>0)length+=n;
    if(length>LIMIT)fail('INPUT_BOUND_EXCEEDED');
    return buffer.subarray(0,length);
  }finally{fs.closeSync(fd);}
}
function parse(bytes){try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail('INVALID_INPUT_JSON');}}
function countsValid(c){return c&&Object.keys(c).sort().join(',')==='genToolPro,guestControl'&&[c.genToolPro,c.guestControl].every(n=>Number.isSafeInteger(n)&&n>=0);}
const CIM_SCRIPT=`$ErrorActionPreference='Stop'
$g=@(Get-CimInstance Win32_Process -Filter "Name='GenToolPro.exe'")
$v=@(Get-CimInstance Win32_Process -Filter "Name='VBoxManage.exe'")
if(@($v | Where-Object {[string]::IsNullOrWhiteSpace($_.CommandLine)}).Count -gt 0){throw 'HOST_PROCESS_UNVERIFIED'}
$n=@($v | Where-Object {$_.CommandLine -match '(?i)(?:^|[\\s"])guestcontrol(?:[\\s"]|$)'}).Count
[pscustomobject]@{genToolPro=$g.Count;guestControl=$n} | ConvertTo-Json -Compress`;
export function readHostProcessCounts({platform=process.platform,execFileSync:execute=execFileSync}={}){
  if(platform!=='win32')fail('WINDOWS_REQUIRED');
  try{
    const c=JSON.parse(execute('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',CIM_SCRIPT],
      {encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536,stdio:['ignore','pipe','pipe']}).replace(/^\uFEFF/,''));
    if(!countsValid(c))fail('HOST_PROCESS_UNVERIFIED');
    return c;
  }catch{fail('HOST_PROCESS_UNVERIFIED');}
}

export async function inspectInstallation(home){
  const dir=path.join(home,'versions',VERSION),current=path.join(home,'current');
  const active=parse(readBounded(path.join(home,'active.json')));
  if(active.current!==VERSION||active.pendingBoot!==null||fs.realpathSync(current).toLowerCase()!==fs.realpathSync(dir).toLowerCase())fail('INSTALLATION_MISMATCH');
  const monitor=path.join(dir,'resources','app','engine','earnapp-monitor.mjs');
  if(hash(readBounded(monitor))!==OLD_MONITOR)fail('MONITOR_HASH_MISMATCH');
  // The pinned monitor is checked before importing the canonical local inspector.
  const {inspectBuild}=await import(pathToFileURL(path.join(dir,'resources','app','engine','build-identity.mjs')).href);
  for(const location of [dir,current]){
    const build=inspectBuild(location);
    if(build.ok!==true||build.codeIntegrity!=='VERIFIED'||build.version!==VERSION||build.codeFingerprint!==OLD_BUILD)fail('BUILD_MISMATCH');
  }
  return {oldBuildFingerprint:OLD_BUILD,oldMonitorHash:OLD_MONITOR};
}

function selectIdle(bytes,s){
  let best=null;
  // Hash physical row bytes including whitespace, excluding the CRLF separator.
  let start=0;
  for(let end=0;end<=bytes.length;end++){
    if(end<bytes.length&&bytes[end]!==10)continue;
    let raw=bytes.subarray(start,end);start=end+1;
    if(raw.at(-1)===13)raw=raw.subarray(0,-1);
    if(!raw.toString('utf8').trim())continue;
    const r=parse(raw);
    if(!r||typeof r!=='object'||Array.isArray(r))fail('INVALID_OBSERVATION_ROW');
    const q=r.guestSlot,t=Date.parse(r.sourceAt),failure=Date.parse(s.guestSlot.observedAt);
    if(r.ok===false||r.success===false||r.error!=null||q?.state!=='IDLE'||q.reason!==null||!iso(r.sourceAt)||!iso(q.observedAt)
      ||Date.parse(q.observedAt)>t||t<Date.parse(s.startedAt)||t>=failure||failure-t>120000
      ||!Number.isSafeInteger(r.seq)||r.seq<1||r.seq>=s.seq
      ||(r.instanceUuid!==undefined&&r.instanceUuid!==s.instanceUuid)||(r.serverUuid!==undefined&&r.serverUuid!==s.serverUuid))continue;
    const candidate={seq:r.seq,sourceAt:r.sourceAt,slotObservedAt:q.observedAt,rowHash:hash(raw)};
    if(best&&t===Date.parse(best.priorIdle.sourceAt)&&r.seq===best.priorIdle.seq&&candidate.rowHash!==best.priorIdle.rowHash)fail('AMBIGUOUS_IDLE_EVIDENCE');
    if(!best||t>Date.parse(best.priorIdle.sourceAt)||(t===Date.parse(best.priorIdle.sourceAt)&&r.seq>best.priorIdle.seq))
      best={priorIdle:candidate,priorInstanceRecorded:r.instanceUuid!==undefined};
  }
  if(!best)fail('PRIOR_IDLE_REQUIRED');
  return best;
}

function atomicCreate(file,bytes){
  const temp=path.join(path.dirname(file),`.preflight-${crypto.randomUUID()}.tmp`);
  let fd;
  try{
    fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    // link is atomic and refuses replacement, unlike Windows rename-over-existing.
    try{fs.linkSync(temp,file);}catch(e){if(e.code!=='EEXIST'||!readBounded(file).equals(bytes))fail('AUDIT_OR_PROOF_CONFLICT');}
  }finally{if(fd!==undefined)fs.closeSync(fd);fs.unlinkSync(temp);}
}

export async function reconcilePreflight(options,deps={}){
  const platform=deps.platform??process.platform;
  if(platform!=='win32')fail('WINDOWS_REQUIRED');
  // Validate programmatic entry points too; no CLI option can replace a guard.
  parseArgs(['--home',options.home,'--machine-root',options.machineRoot,'--prior-idle-log',options.priorIdleLog]);
  const processCounts=deps.processCounts??(()=>readHostProcessCounts());
  async function gate(){let c;try{c=await processCounts();}catch{fail('HOST_PROCESS_UNVERIFIED');}if(!countsValid(c))fail('HOST_PROCESS_UNVERIFIED');if(c.genToolPro!==0||c.guestControl!==0)fail('NORMAL_EXIT_REQUIRED');}
  await gate();
  const inspect=deps.inspectInstallation??inspectInstallation;
  const checkBuild=async()=>{const b=await inspect(options.home);if(b.oldBuildFingerprint!==OLD_BUILD||b.oldMonitorHash!==OLD_MONITOR)fail('BUILD_MISMATCH');return b;};
  await checkBuild();
  const validation=await (deps.preflight??(()=>import('./engine/native-monitor-preflight.mjs')))();
  if(validation.PREFLIGHT_OLD_BUILD!==OLD_BUILD||validation.PREFLIGHT_OLD_MONITOR_HASH!==OLD_MONITOR||typeof validation.validatePreflightProof!=='function')fail('VALIDATOR_MISMATCH');
  const identityFile=path.join(options.machineRoot,'data','autoscan','server-id.json'),identityBytes=readBounded(identityFile);
  const serverUuid=parse(identityBytes).serverId;
  const dir=path.join(options.machineRoot,'data','native-monitor'),sourceFile=path.join(dir,'latest.json');
  const sourceBytes=readBounded(sourceFile),source=sanitizeNativeSource(parse(sourceBytes));
  if(!source||source.serverUuid!==serverUuid||source.guestSlot?.state!=='QUARANTINED'||source.guestSlot.reason!=='SOURCE_PERSIST_FAILED')fail('SOURCE_NOT_RECONCILABLE');
  const logBytes=readBounded(options.priorIdleLog),selected=selectIdle(logBytes,source);
  const proofFile=path.join(dir,'preflight-reconciliation.json');
  let existing=null;
  try{existing=parse(readBounded(proofFile));}catch(e){if(e.code!=='ENOENT')throw e;}
  const proof={version:1,kind:'NO_GUEST_STARTED_PREFLIGHT',sourceHash:hash(sourceBytes),serverUuid,instanceUuid:source.instanceUuid,sourceSeq:source.seq,
    oldBuildFingerprint:OLD_BUILD,oldMonitorHash:OLD_MONITOR,normalExitVerified:true,hostGuestControlChildren:0,priorIdle:selected.priorIdle,
    at:existing?.at??new Date((deps.now??Date.now)()).toISOString(),attemptedVm:null,attemptedVmKnown:false};
  if(existing&&canonical(existing)!==canonical(proof))fail('EXISTING_PROOF_CONFLICT');
  if(!iso(proof.at)||!validation.validatePreflightProof(sourceBytes,serverUuid,OLD_BUILD,proof))fail('PROOF_REJECTED');
  const audit={version:1,...proof,priorInstanceRecorded:selected.priorInstanceRecorded,
    priorInstanceBinding:selected.priorInstanceRecorded?'EXPLICIT_INSTANCE_AND_SOURCE_EPOCH':'TIMESTAMP_WITHIN_SOURCE_EPOCH_ONLY',guestExitProofClaimed:false};
  const auditDir=path.join(dir,'preflight-reconciliation.audit');
  await checkBuild();await gate();
  if(!readBounded(sourceFile).equals(sourceBytes)||!readBounded(identityFile).equals(identityBytes)||!readBounded(options.priorIdleLog).equals(logBytes))fail('EVIDENCE_CHANGED');
  fs.mkdirSync(auditDir,{recursive:true,mode:0o700});
  if(fs.lstatSync(auditDir).isSymbolicLink())fail('UNSAFE_AUDIT_DIRECTORY');
  atomicCreate(path.join(auditDir,proof.sourceHash+'.source.json'),sourceBytes);
  atomicCreate(path.join(auditDir,proof.sourceHash+'.audit.json'),Buffer.from(JSON.stringify(audit,null,2)+'\n'));
  if(!readBounded(sourceFile).equals(sourceBytes))fail('EVIDENCE_CHANGED');
  // Idempotent repeats retain the original at and original proof bytes.
  if(!existing)atomicCreate(proofFile,Buffer.from(JSON.stringify(proof,null,2)+'\n'));
  else if(canonical(parse(readBounded(proofFile)))!==canonical(proof))fail('EXISTING_PROOF_CONFLICT');
  return {ok:true,replay:existing!==null,sourceHash:proof.sourceHash,serverUuid,instanceUuid:source.instanceUuid,sourceSeq:source.seq,
    priorIdleSeq:proof.priorIdle.seq,at:proof.at,attemptedVm:null,attemptedVmKnown:false,guestExitProofClaimed:false};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await reconcilePreflight(parseArgs(process.argv.slice(2)))));}
  catch(e){console.error(JSON.stringify({ok:false,error:e.safeCode??'PREFLIGHT_RECONCILIATION_REFUSED'}));process.exitCode=1;}
}
