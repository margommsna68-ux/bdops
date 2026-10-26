import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {validatePreflightProof,PREFLIGHT_OLD_BUILD,PREFLIGHT_OLD_MONITOR_HASH} from './engine/native-monitor-preflight.mjs';
const cli=await import('./reconcile-preflight.mjs').catch(()=>({}));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const serverUuid='00000000-0000-4000-8000-000000000001';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'gen2-preflight-cli-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const options={home:path.join(root,'home'),machineRoot:path.join(root,'machine'),priorIdleLog:path.join(root,'observations.jsonl')};
  const dir=path.join(options.machineRoot,'data','native-monitor');fs.mkdirSync(dir,{recursive:true});
  fs.mkdirSync(path.join(options.machineRoot,'data','autoscan'),{recursive:true});
  fs.writeFileSync(path.join(options.machineRoot,'data','autoscan','server-id.json'),JSON.stringify({serverId:serverUuid}));
  const source={schema:1,source:'AGENT',serverUuid,instanceUuid:'00000000-0000-4000-8000-000000000002',startedAt:'2026-10-26T09:40:39.840Z',seq:300,configVersion:1,
    observedAt:'2026-10-26T09:52:03.000Z',sourceAt:'2026-10-26T09:52:03.000Z',counts:{managed:0,inventory:0,guest:0,proxy:0,app:0},inventoryAt:null,inventoryReason:null,
    guestSlot:{state:'QUARANTINED',reason:'SOURCE_PERSIST_FAILED',observedAt:'2026-10-26T09:52:02.708Z'},samples:[]};
  const file=path.join(dir,'latest.json'),bytes=Buffer.from(JSON.stringify(source));fs.writeFileSync(file,bytes);
  const row={seq:299,sourceAt:'2026-10-26T09:51:53.390Z',guestSlot:{state:'IDLE',reason:null,observedAt:'2026-10-26T09:51:43.529Z'}};
  const raw='  '+JSON.stringify(row)+'  ';fs.writeFileSync(options.priorIdleLog,JSON.stringify({...row,seq:298,sourceAt:'2026-10-26T09:51:50.551Z'})+'\r\n'+raw+'\r\n');
  const deps={platform:'win32',now:()=>Date.parse('2026-10-26T10:00:00.000Z'),processCounts:()=>({genToolPro:0,guestControl:0}),
    inspectInstallation:async()=>({oldBuildFingerprint:PREFLIGHT_OLD_BUILD,oldMonitorHash:PREFLIGHT_OLD_MONITOR_HASH}),
    preflight:async()=>({validatePreflightProof,PREFLIGHT_OLD_BUILD,PREFLIGHT_OLD_MONITOR_HASH})};
  return {root,options,dir,file,bytes,source,row,raw,deps,proofFile:path.join(dir,'preflight-reconciliation.json')};
}
test('CLI accepts exactly three required absolute paths; rejects duplicates and unknown switches',()=>{
  assert.equal(typeof cli.parseArgs,'function');
  const args=['--home','C:\\GEN','--machine-root=C:\\machine','--prior-idle-log','C:\\observations.jsonl'];
  assert.deepEqual(cli.parseArgs(args),{home:'C:\\GEN',machineRoot:'C:\\machine',priorIdleLog:'C:\\observations.jsonl'});
  for(const bad of [[],args.concat('--force'),args.concat('--home=C:\\other'),['--home=x','--machine-root=C:\\m','--prior-idle-log=C:\\l']])assert.throws(()=>cli.parseArgs(bad));
});
test('writes real-validator-approved proof and immutable source audit; preserves exact row bytes hash and unknown attempted VM',async t=>{
  assert.equal(typeof cli.reconcilePreflight,'function');const f=fixture(t);const result=await cli.reconcilePreflight(f.options,f.deps);
  const proof=JSON.parse(fs.readFileSync(f.proofFile));assert.equal(result.ok,true);assert.equal(result.replay,false);
  assert.ok(validatePreflightProof(f.bytes,serverUuid,PREFLIGHT_OLD_BUILD,proof));assert.equal(proof.priorIdle.rowHash,hash(Buffer.from(f.raw)));
  assert.equal(proof.priorIdle.sourceAt,f.row.sourceAt);assert.equal(proof.attemptedVm,null);assert.equal(proof.attemptedVmKnown,false);
  assert.deepEqual(fs.readFileSync(f.file),f.bytes);
  const audit=JSON.parse(fs.readFileSync(path.join(f.dir,'preflight-reconciliation.audit',hash(f.bytes)+'.audit.json')));
  assert.equal(audit.priorInstanceRecorded,false);assert.equal(audit.priorInstanceBinding,'TIMESTAMP_WITHIN_SOURCE_EPOCH_ONLY');assert.equal(audit.guestExitProofClaimed,false);
  assert.deepEqual(fs.readFileSync(path.join(f.dir,'preflight-reconciliation.audit',hash(f.bytes)+'.source.json')),f.bytes);
  const first=fs.readFileSync(f.proofFile);const again=await cli.reconcilePreflight(f.options,{...f.deps,now:()=>f.deps.now()+5000});
  assert.equal(again.replay,true);assert.deepEqual(fs.readFileSync(f.proofFile),first);
});
test('busy, unavailable or non-Windows host gates refuse without publishing a proof',async t=>{
  assert.equal(typeof cli.reconcilePreflight,'function');
  for(const change of [{platform:'linux'},{processCounts:()=>({genToolPro:1,guestControl:0})},{processCounts:()=>({genToolPro:0,guestControl:1})},{processCounts:()=>({genToolPro:0})},{processCounts:()=>{throw Error('SECRET COMMAND LINE');}}]){
    const f=fixture(t);await assert.rejects(cli.reconcilePreflight(f.options,{...f.deps,...change}));assert.equal(fs.existsSync(f.proofFile),false);assert.deepEqual(fs.readFileSync(f.file),f.bytes);
  }
});
test('never reconciles guest uncertainty, wrong identity/build, missing clean evidence or out-of-epoch rows',async t=>{
  assert.equal(typeof cli.reconcilePreflight,'function');
  for(const mutate of [f=>{f.source.guestSlot.reason='GUEST_CLEANUP_UNVERIFIED';},f=>{f.source.serverUuid='00000000-0000-4000-8000-000000000099';},
    f=>{f.deps.inspectInstallation=async()=>({oldBuildFingerprint:'a'.repeat(64),oldMonitorHash:PREFLIGHT_OLD_MONITOR_HASH});},
    f=>{fs.writeFileSync(f.options.priorIdleLog,JSON.stringify({...f.row,sourceAt:'2026-10-26T09:39:00.000Z'}));},
    f=>{fs.writeFileSync(f.options.priorIdleLog,JSON.stringify({...f.row,sourceAt:'2026-10-26T09:50:00.000Z'}));},
    f=>{fs.writeFileSync(f.options.priorIdleLog,JSON.stringify({...f.row,ok:false}));}]){
    const f=fixture(t);mutate(f);fs.writeFileSync(f.file,JSON.stringify(f.source));await assert.rejects(cli.reconcilePreflight(f.options,f.deps));assert.equal(fs.existsSync(f.proofFile),false);
  }
});
test('input bounds, malformed JSONL and mismatching existing proof all fail closed',async t=>{
  assert.equal(typeof cli.reconcilePreflight,'function');
  for(const mutate of [f=>fs.writeFileSync(f.file,Buffer.alloc(1048577)),f=>fs.writeFileSync(f.options.priorIdleLog,Buffer.alloc(1048577)),
    f=>fs.appendFileSync(f.options.priorIdleLog,'{truncated'),f=>fs.writeFileSync(f.proofFile,'{"kind":"wrong"}')]){
    const f=fixture(t);mutate(f);const before=fs.existsSync(f.proofFile)?fs.readFileSync(f.proofFile):null;
    await assert.rejects(cli.reconcilePreflight(f.options,f.deps));if(before)assert.deepEqual(fs.readFileSync(f.proofFile),before);else assert.equal(fs.existsSync(f.proofFile),false);
  }
});
test('rechecks process absence and source bytes immediately before publication',async t=>{
  assert.equal(typeof cli.reconcilePreflight,'function');
  for(const race of ['process','source']){const f=fixture(t);let reads=0;
    f.deps.processCounts=()=>{reads++;if(reads===2){if(race==='process')return {genToolPro:1,guestControl:0};fs.appendFileSync(f.file,' ');}return {genToolPro:0,guestControl:0};};
    await assert.rejects(cli.reconcilePreflight(f.options,f.deps));assert.equal(fs.existsSync(f.proofFile),false);
  }
});
test('fixed CIM reader emits counts only and refuses unknown process-query output',()=>{
  assert.equal(typeof cli.readHostProcessCounts,'function');let calls=0;
  const result=cli.readHostProcessCounts({platform:'win32',execFileSync:(exe,args,options)=>{calls++;assert.equal(exe,'powershell.exe');assert.equal(options.windowsHide,true);assert.ok(options.timeout<=15000);
    const script=args.at(-1);assert.match(script,/Get-CimInstance Win32_Process/);assert.match(script,/GenToolPro\.exe/);assert.match(script,/VBoxManage\.exe/);assert.ok(!script.includes('Stop-Process'));return '{"genToolPro":0,"guestControl":0}';}});
  assert.deepEqual(result,{genToolPro:0,guestControl:0});assert.equal(calls,1);
  assert.throws(()=>cli.readHostProcessCounts({platform:'win32',execFileSync:()=>'{"genToolPro":0,"guestControl":0,"raw":"SECRET"}'}));
});

test('rejects monitor drift, wrong validator pins, identity ambiguity and stale slot chronology',async t=>{
  for(const mutate of [
    f=>{f.deps.inspectInstallation=async()=>({oldBuildFingerprint:PREFLIGHT_OLD_BUILD,oldMonitorHash:'0'.repeat(64)});},
    f=>{f.deps.preflight=async()=>({validatePreflightProof,PREFLIGHT_OLD_BUILD:'0'.repeat(64),PREFLIGHT_OLD_MONITOR_HASH});},
    f=>{fs.writeFileSync(f.options.priorIdleLog,JSON.stringify({...f.row,instanceUuid:'00000000-0000-4000-8000-000000000099'}));},
    f=>{fs.writeFileSync(f.options.priorIdleLog,JSON.stringify({...f.row,guestSlot:{...f.row.guestSlot,observedAt:'2026-10-26T09:51:54.000Z'}}));},
    f=>{fs.writeFileSync(f.options.priorIdleLog,JSON.stringify(f.row)+'\n '+JSON.stringify(f.row));},
  ]){const f=fixture(t);mutate(f);await assert.rejects(cli.reconcilePreflight(f.options,f.deps));assert.equal(fs.existsSync(f.proofFile),false);}
});

test('conflicting audit never publishes proof; original audit and source remain untouched',async t=>{
  const f=fixture(t),auditDir=path.join(f.dir,'preflight-reconciliation.audit');fs.mkdirSync(auditDir);
  const auditFile=path.join(auditDir,hash(f.bytes)+'.source.json');fs.writeFileSync(auditFile,'conflict');
  await assert.rejects(cli.reconcilePreflight(f.options,f.deps));assert.equal(fs.existsSync(f.proofFile),false);
  assert.equal(fs.readFileSync(auditFile,'utf8'),'conflict');assert.deepEqual(fs.readFileSync(f.file),f.bytes);
});

test('canonical inspector refuses an unverified installation without launching any process',async t=>{
  const f=fixture(t);fs.mkdirSync(f.options.home);fs.writeFileSync(path.join(f.options.home,'active.json'),JSON.stringify({current:'3.1.18.2',pendingBoot:'pending'}));
  await assert.rejects(cli.inspectInstallation(f.options.home));
});
