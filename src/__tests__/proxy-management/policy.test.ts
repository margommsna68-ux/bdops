import {describe, expect, it} from 'vitest';
import {decideNew, decideBlock, decideReplacement} from '@/server/proxy-management/policy';
import type {EndpointFact, ProxyContext, ReplacementContext} from '@/server/proxy-management/types';
const endpoint:EndpointFact={id:'old',identityId:'identity',projectId:'p',proxy:{ip:'192.0.2.1',port:80,username:'u',password:'p',format:'FULL'},inventoryState:'BLOCKED',revision:1,vmKeys:[]};
const base=():ReplacementContext=>({old:{...endpoint},oldIdentity:{id:'identity',ip:'192.0.2.1',owner:'GENJY',subgroup:null,revision:1,allocationMode:'SINGLE_IP'},oldCandidates:1,next:{ip:'198.51.100.1',port:80,username:'u',password:'p',format:'FULL'},nextEvidence:[{sourceRef:'hidden!A1',ip:'198.51.100.1',owner:'GENJY',subgroup:null,format:'BARE',hasFullCredentials:false,hasManualMetadata:false}],nextIdentities:[],nextInInventory:false,nextInVmOrReservation:false,nextHistory:[],exactReceiptReplay:false,sourceScanSucceeded:true});
describe('owner and history policy',()=>{
  it('allows only bare evidence completion within same Genjy subgroup',()=>{
    expect(decideReplacement(base()).outcome).toBe('READY');
    const c=base(); c.oldIdentity!.subgroup='PC_CHUNG'; expect(decideReplacement(c).outcome).toBe('ERROR');
    c.nextEvidence[0].subgroup='PC_CHUNG'; expect(decideReplacement(c).outcome).toBe('READY');
  });
  it.each(['manual','full','vm','inventory','history','failed','owner','unknown','live','ambiguous'])('rejects %s risk without broadening Genjy exception',(risk)=>{
    const c=base();
    if(risk==='manual') c.nextEvidence[0].hasManualMetadata=true;
    if(risk==='full') c.nextEvidence[0].hasFullCredentials=true;
    if(risk==='vm') c.nextInVmOrReservation=true;
    if(risk==='inventory') c.nextInInventory=true;
    if(risk==='history') c.nextHistory=[{ip:c.next.ip,kind:'VOID',occurredAt:null,recordedAt:'2026-10-14T00:00:00Z'}];
    if(risk==='failed') c.sourceScanSucceeded=false;
    if(risk==='owner') c.nextEvidence[0].owner='SELF';
    if(risk==='unknown') c.oldIdentity!.owner='UNKNOWN';
    if(risk==='live') c.old!.inventoryState='LIVE';
    if(risk==='ambiguous') c.oldCandidates=2;
    expect(decideReplacement(c).outcome).toBe('ERROR');
  });
  it('exact receipt replay skips after old proxy is retired',()=>{const c=base();c.old!.inventoryState='REPLACED';c.exactReceiptReplay=true;expect(decideReplacement(c).outcome).toBe('SKIP');});
  it('blocked repeats skip and ambiguity does not choose arbitrary endpoint',()=>{
    expect(decideBlock([endpoint]).outcome).toBe('SKIP');
    expect(decideBlock([{...endpoint,inventoryState:'LIVE'}]).outcome).toBe('READY');
    expect(decideBlock([endpoint,{...endpoint,id:'other'}]).code).toBe('AMBIGUOUS_OLD');
  });
  it('new stock rejects current/history IP and Genjy reservation',()=>{
    const ctx:ProxyContext={identities:[],endpoints:[],evidence:[],history:[],receipts:[],source:{id:'s',sourceKey:'g',hash:'x',fetchedAt:'2026-10-14T00:00:00Z',scanSucceeded:true}};
    expect(decideNew(endpoint.proxy,'SELF',ctx).outcome).toBe('READY');
    ctx.endpoints=[endpoint];expect(decideNew(endpoint.proxy,'SELF',ctx).code).toBe('CURRENT_IP');
    ctx.endpoints=[];ctx.history=[{ip:endpoint.proxy.ip,kind:'REPLACED',occurredAt:null,recordedAt:'2026-10-14T00:00:00Z'}];expect(decideNew(endpoint.proxy,'SELF',ctx).code).toBe('HISTORICAL_IP');
    ctx.history=[];ctx.evidence=[{...base().nextEvidence[0],ip:endpoint.proxy.ip}];expect(decideNew(endpoint.proxy,'SELF',ctx).code).toBe('GENJY_RESERVED');
  });
});
