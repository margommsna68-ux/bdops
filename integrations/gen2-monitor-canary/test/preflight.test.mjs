import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {readGuestQuarantine} from '../engine/native-monitor-source.mjs';
import {validatePreflightProof} from '../engine/native-monitor-preflight.mjs';
import './support.mjs';
const {CANARY_POLICY}=await import('../.work/engine/native-monitor-canary.mjs');
const oldBuild='edd656962da9070ecb7d8e82cfeed34fe1905026655ccf547fcfbaed81cea43f',oldMonitor='5aa5edfd4d7fa073e4975c962987515db9bac2ae821c1275142b5a8cf1aee8d3';
function fixture(){const dir=fs.mkdtempSync(path.resolve(import.meta.dirname,'../.work/preflight-')),file=path.join(dir,'latest.json'),serverUuid='00000000-0000-4000-8000-000000000001';
 const source={schema:1,source:'AGENT',serverUuid,instanceUuid:'00000000-0000-4000-8000-000000000002',startedAt:'2026-10-26T09:40:00.000Z',seq:2,configVersion:1,observedAt:'2026-10-26T09:53:00.000Z',sourceAt:'2026-10-26T09:53:00.000Z',counts:{managed:0,inventory:0,guest:0,app:0,proxy:0},policy:CANARY_POLICY,guestSlot:{state:'QUARANTINED',reason:'SOURCE_PERSIST_FAILED',observedAt:'2026-10-26T09:52:02.000Z'},inventoryAt:null,inventoryReason:null,samples:[]};
 const bytes=Buffer.from(JSON.stringify(source));fs.writeFileSync(file,bytes);const proof={version:1,kind:'NO_GUEST_STARTED_PREFLIGHT',sourceHash:crypto.createHash('sha256').update(bytes).digest('hex'),serverUuid,instanceUuid:source.instanceUuid,sourceSeq:2,oldBuildFingerprint:oldBuild,oldMonitorHash:oldMonitor,normalExitVerified:true,hostGuestControlChildren:0,priorIdle:{seq:1,sourceAt:'2026-10-26T09:51:53.000Z',slotObservedAt:'2026-10-26T09:51:52.000Z',rowHash:'a'.repeat(64)},at:'2026-10-26T09:54:00.000Z',attemptedVm:null,attemptedVmKnown:false};
 const save=()=>fs.writeFileSync(path.join(dir,'preflight-reconciliation.json'),JSON.stringify(proof));save();return {source,bytes,proof,file,serverUuid,save,opts:{reconcilePreflight:true,previousBuildFingerprint:oldBuild}};
}
test('explicit audit-bound preflight recovery is single-source only; default remains quarantined',()=>{const f=fixture();assert.equal(readGuestQuarantine(f.file,f.serverUuid),true);let recovered;
 assert.equal(readGuestQuarantine(f.file,f.serverUuid,{...f.opts,onPreflightRecovered:p=>{recovered=p;}}),false);assert.equal(recovered.sourceHash,f.proof.sourceHash);
 fs.writeFileSync(f.file,JSON.stringify({...f.source,seq:3}));assert.equal(readGuestQuarantine(f.file,f.serverUuid,f.opts),true,'old proof cannot clear a different source sequence/hash');
});
test('preflight reconciliation refuses missing proof, old build mismatch, guest uncertainty and conflicting clean-state evidence',()=>{
 for(const mutate of [f=>{f.opts.previousBuildFingerprint='b'.repeat(64);},f=>{f.proof.hostGuestControlChildren=1;},f=>{f.proof.normalExitVerified=false;},f=>{f.proof.priorIdle.sourceAt='2026-10-26T09:52:03.000Z';},f=>{f.proof.priorIdle.sourceAt='2026-10-26T09:39:00.000Z';},f=>{f.proof.instanceUuid='00000000-0000-4000-8000-000000000003';},f=>{f.source.guestSlot.reason='GUEST_CLEANUP_UNVERIFIED';fs.writeFileSync(f.file,JSON.stringify(f.source));f.proof.sourceHash=crypto.createHash('sha256').update(fs.readFileSync(f.file)).digest('hex');}]){
  const f=fixture();mutate(f);f.save();assert.equal(readGuestQuarantine(f.file,f.serverUuid,f.opts),true);
 }
});

test('known preflight branch permits a complete responsive core result between the observer row and failed next admission',()=>{
 const f=fixture(),at='2026-10-26T09:51:54.000Z';
 f.source.counts={managed:1,inventory:1,guest:1,app:1,proxy:0};
 f.source.samples=[{machineUuid:'00000000-0000-4000-8000-000000000004',vmCode:'VM_008',observedAt:f.source.observedAt,unknowns:{service:'UNKNOWN',ncsi:'UNKNOWN',guestHttps:'UNKNOWN',guestAppliedProxy:'UNKNOWN',earning:'UNKNOWN'},monitor:{configVersion:1,
  vmState:{observedAt:at,state:'RUNNING'},guest:{observedAt:at,additions:'PRESENT',response:'RESPONSIVE'},
  app:{observedAt:at,earnApp:'RUNNING',sdk:'RUNNING',connection:'NOT_OBSERVED'},network:{observedAt:at,provenance:'GUEST',ncsi:'UNKNOWN',https:'UNKNOWN'}}}];
 const check=()=>{const bytes=Buffer.from(JSON.stringify(f.source));return validatePreflightProof(bytes,f.serverUuid,oldBuild,{...f.proof,sourceHash:crypto.createHash('sha256').update(bytes).digest('hex')});};
 assert.equal(check(),true,'a later completed responsive read is not an unresolved guest');
 const m=f.source.samples[0].monitor;
 for(const [key,value] of [['response','UNKNOWN'],['additions','UNKNOWN']]){const old=m.guest[key];m.guest[key]=value;assert.equal(check(),false);m.guest[key]=old;}
 m.app.observedAt='2026-10-26T09:51:55.000Z';assert.equal(check(),false);m.app.observedAt=at;
 for(const key of ['guest','app','network'])m[key].observedAt=f.source.guestSlot.observedAt;
 assert.equal(check(),false,'a result at admission failure cannot establish a completed earlier read');
 for(const key of ['guest','app','network'])m[key].observedAt=at;
 delete m.network;assert.equal(check(),false);
});
