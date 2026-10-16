import {describe, expect, it} from 'vitest';
import {decideNew, decideBlock, decideReplacement, findConflict} from '@/server/proxy-management/policy';
import type {EndpointFact, IdentityFact, ProxyContext, ReplacementContext} from '@/server/proxy-management/types';
const endpoint:EndpointFact={id:'old',identityId:'identity',projectId:'p',proxy:{ip:'192.0.2.1',port:80,username:'u',password:'p',format:'FULL'},inventoryState:'BLOCKED',revision:1,vmKeys:[]};
const base=():ReplacementContext=>({old:{...endpoint},oldIdentity:{id:'identity',ip:'192.0.2.1',owner:'GENJY',subgroup:null,revision:1,allocationMode:'SINGLE_IP'},oldCandidates:1,next:{ip:'198.51.100.1',port:80,username:'u',password:'p',format:'FULL'},nextEvidence:[{sourceRef:'hidden!A1',ip:'198.51.100.1',owner:'GENJY',subgroup:null,format:'BARE',hasFullCredentials:false,hasManualMetadata:false}],nextIdentities:[],nextConflict:null,exactReceiptReplay:false,sourceScanSucceeded:true});
const source={id:'s',sourceKey:'g',hash:'x',fetchedAt:'2026-10-14T00:00:00Z',scanSucceeded:true};
const empty=():ProxyContext=>({identities:[],endpoints:[],evidence:[],history:[],receipts:[],source});
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
    if(risk==='vm'||risk==='inventory') c.nextConflict={code:'CURRENT_IP',message:'IP mới đã có'};
    if(risk==='history') c.nextConflict={code:'HISTORICAL_IP',message:'Đã xuất hiện'};
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
    const ctx=empty();
    expect(decideNew(endpoint.proxy,'SELF',ctx).outcome).toBe('READY');
    ctx.endpoints=[endpoint];expect(decideNew(endpoint.proxy,'SELF',ctx).code).toBe('CURRENT_IP');
    ctx.endpoints=[];ctx.history=[{ip:endpoint.proxy.ip,kind:'REPLACED',occurredAt:null,recordedAt:'2026-10-14T00:00:00Z'}];expect(decideNew(endpoint.proxy,'SELF',ctx).code).toBe('HISTORICAL_IP');
    ctx.history=[];ctx.evidence=[{...base().nextEvidence[0],ip:endpoint.proxy.ip}];expect(decideNew(endpoint.proxy,'SELF',ctx).code).toBe('GENJY_RESERVED');
  });
  it('conflicts name the state, position and history of the existing IP without leaking other projects',()=>{
    const identity:IdentityFact={id:'identity',ip:'192.0.2.1',owner:'SELF',subgroup:null,revision:1,allocationMode:'SINGLE_IP'};
    const ctx=empty();ctx.identities=[identity];ctx.endpoints=[{...endpoint,inventoryState:'LIVE',vmKeys:['An-01/VM_001']}];
    let c=findConflict(endpoint.proxy,'SELF',ctx,'p')!;expect(c.code).toBe('CURRENT_IP');expect(c.message).toContain('An-01/VM_001');expect(c.existing).toMatchObject({identityId:'identity',state:'LIVE',locations:['An-01/VM_001'],foreign:false});
    ctx.endpoints=[{...endpoint,projectId:'other',proxy:{...endpoint.proxy,username:null,password:null,format:'BARE'},vmKeys:[]}];
    c=findConflict(endpoint.proxy,'SELF',ctx,'p')!;expect(c.code).toBe('CURRENT_IP');expect(c.message).toContain('dự án khác');expect(c.existing).toMatchObject({foreign:true,locations:[]});
    ctx.endpoints=[{...endpoint,inventoryState:'RETIRED',retiredAt:'2026-10-15T00:00:00Z'}];
    c=findConflict(endpoint.proxy,'SELF',ctx,'p')!;expect(c.code).toBe('HISTORICAL_IP');expect(c.message).toContain('ngừng quản lý');
    ctx.endpoints=[{...endpoint,inventoryState:'REPLACED',retiredAt:'2026-10-15T00:00:00Z'}];ctx.receipts=[{oldIp:'192.0.2.1',newIp:'198.51.100.9',status:'APPLIED'}];
    c=findConflict(endpoint.proxy,'SELF',ctx,'p')!;expect(c.code).toBe('HISTORICAL_IP');expect(c.message).toContain('198.51.100.9');
    ctx.endpoints=[{...endpoint,inventoryState:'VOID',retiredAt:'2026-10-15T00:00:00Z'}];ctx.receipts=[];
    expect(findConflict(endpoint.proxy,'SELF',ctx,'p')!.message).toContain('hoàn tác');
    ctx.endpoints=[];ctx.history=[{ip:'192.0.2.1',kind:'BLOCKED',occurredAt:null,recordedAt:'2026-10-14T00:00:00Z'}];
    expect(findConflict(endpoint.proxy,'SELF',ctx,'p')!.message).toContain('BLOCKED');
  });
  it('approved port streams accept a new port of the same owner only; same port, other owner or single-IP identities stay duplicates',()=>{
    const stream:IdentityFact={id:'identity',ip:'192.0.2.1',owner:'SELF',subgroup:null,revision:1,allocationMode:'APPROVED_PORT_STREAM'};
    const ctx=empty();ctx.identities=[stream];ctx.endpoints=[{...endpoint,inventoryState:'LIVE'}];ctx.history=[{ip:'192.0.2.1',kind:'RECEIVED',occurredAt:null,recordedAt:'2026-10-14T00:00:00Z'}];
    const other={...endpoint.proxy,port:81};
    expect(decideNew(other,'SELF',ctx)).toMatchObject({outcome:'READY',message:expect.stringContaining('nhiều cổng')});
    expect(decideNew(endpoint.proxy,'SELF',ctx).code).toBe('CURRENT_IP');
    expect(decideNew(other,'OTHER',ctx).code).toBe('CURRENT_IP');
    expect(decideNew({...other,port:null,username:null,password:null,format:'BARE'},'SELF',ctx).code).toBe('INVALID_INPUT');
    ctx.endpoints=[{...endpoint,inventoryState:'LIVE'},{...endpoint,id:'retired81',proxy:other,inventoryState:'RETIRED',retiredAt:'2026-10-15T00:00:00Z'}];
    expect(decideNew(other,'SELF',ctx).code).toBe('HISTORICAL_IP');
    ctx.identities=[{...stream,allocationMode:'SINGLE_IP'}];ctx.endpoints=[{...endpoint,inventoryState:'LIVE'}];
    expect(decideNew(other,'SELF',ctx).code).toBe('CURRENT_IP');
  });
});
