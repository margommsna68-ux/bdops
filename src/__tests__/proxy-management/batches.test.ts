import {expect,it} from 'vitest';
import {planBatch,parseReceivedDate} from '@/server/proxy-management/batches';
import type {ProxyContext,SheetSnapshot} from '@/server/proxy-management/types';
const ctx:ProxyContext={identities:[],endpoints:[],evidence:[],history:[],receipts:[],source:{id:'s',sourceKey:'GENJY',hash:'x',fetchedAt:'2026-10-14T00:00:00Z',scanSucceeded:true}};
const catalog=[{id:'c',code:'fixture-account',username:'u',password:'secret'}];
it('preview does not expose full credentials and separates unknown packages',()=>{
  const planned=planBatch({kind:'NEW',text:'192.0.2.80:80:u:secret\n192.0.2.81:80:unknown:secret',owner:'SELF',idempotencyKey:'key'},ctx,catalog);
  expect(planned.rows.map(r=>r.outcome)).toEqual(['READY','READY']);expect(planned.items[1].state).toBe('QUARANTINED');
  expect(JSON.stringify(planned.rows)).not.toContain('secret');expect(planned.items[0].next?.password).toBe('secret');
});
it('source failure blocks new receives but does not block existing BLOCKED reporting',()=>{
  const failed={...ctx,source:{...ctx.source,scanSucceeded:false}};
  expect(planBatch({kind:'NEW',text:'192.0.2.80:80:u:secret',idempotencyKey:'k'},failed,catalog).rows[0].code).toBe('SOURCE_UNAVAILABLE');
  const endpoint={id:'e',projectId:'p',identityId:'i',proxy:{ip:'192.0.2.80',port:80,username:'u',password:'secret',format:'FULL' as const},inventoryState:'LIVE' as const,revision:1,vmKeys:[]};
  expect(planBatch({kind:'BLOCKED',text:'192.0.2.80',idempotencyKey:'k'},{...failed,endpoints:[endpoint]},catalog,'p').rows[0].outcome).toBe('READY');
});
it('received date is nullable date-only and invalid calendar dates are rejected',()=>{
  expect(parseReceivedDate(null)).toBeNull();expect(parseReceivedDate('2026-10-14')?.toISOString()).toBe('2026-10-14T00:00:00.000Z');
  for(const value of ['2026-02-30','2026-13-01','14/10/2026','today']) expect(()=>parseReceivedDate(value)).toThrow('INVALID_INPUT');
});
it('only an exact endpoint receipt is a replay; changed credentials do not count as the old receipt',()=>{
  const old={id:'old',projectId:'p',identityId:'i',proxy:{ip:'192.0.2.91',port:80,username:'u',password:'secret',format:'FULL' as const},inventoryState:'REPLACED' as const,revision:2,vmKeys:[]};
  const next={...old,id:'next',identityId:'n',proxy:{...old.proxy,ip:'198.51.100.91'},inventoryState:'NEW' as const};
  const facts={...ctx,identities:[{id:'i',ip:old.proxy.ip,owner:'SELF' as const,subgroup:null,revision:1,allocationMode:'SINGLE_IP' as const}],endpoints:[old,next],receipts:[{oldIp:old.proxy.ip,newIp:next.proxy.ip,status:'APPLIED' as const}]};
  const input={kind:'REPLACE' as const,removedText:old.proxy.ip,addedText:next.proxy.ip+':80:u:other-password',idempotencyKey:'k'};
  expect(planBatch(input,facts,catalog,'p').rows[0].outcome).toBe('ERROR');
});
it('Sheet tracks full Genjy inventory without treating it as a new provider receipt',()=>{
  const proxy={ip:'192.0.2.92',port:80,username:'u',password:'secret',format:'FULL' as const};
  const sheet:SheetSnapshot={snapshots:[],rows:[{sourceRef:'final!A1',rawValue:'192.0.2.92:80:u:secret',proxy,kind:'CURRENT_INVENTORY',owner:'GENJY',subgroup:'PC_CHUNG',vmKey:null,valueState:'FULL'}]};
  const facts={...ctx,identities:[{id:'g',ip:proxy.ip,owner:'GENJY' as const,subgroup:'PC_CHUNG' as const,revision:1,allocationMode:'SINGLE_IP' as const}]};
  const planned=planBatch({kind:'SHEET',snapshotIds:['s'],idempotencyKey:'k'},facts,catalog,'p',sheet);
  expect(planned.rows[0]).toMatchObject({outcome:'READY',owner:'GENJY',subgroup:'PC_CHUNG'});
  expect(planned.items[0].state).toBe('LIVE');
  expect(planBatch({kind:'NEW',text:'192.0.2.92:80:u:secret',owner:'GENJY',idempotencyKey:'k'},facts,catalog,'p').rows[0].outcome).toBe('ERROR');
  expect(JSON.stringify(planned.rows)).not.toContain('secret');
});
it('Sheet cannot revive a retired IP or silently skip changed current credentials',()=>{
  const proxy={ip:'192.0.2.93',port:80,username:'u',password:'secret',format:'FULL' as const};
  const sheet:SheetSnapshot={snapshots:[],rows:[{sourceRef:'final!A1',rawValue:'192.0.2.93:80:u:secret',proxy,kind:'CURRENT_INVENTORY',owner:'SELF',subgroup:null,vmKey:null,valueState:'FULL'}]};
  const historical={...ctx,identities:[{id:'i',ip:proxy.ip,owner:'SELF' as const,subgroup:null,revision:1,allocationMode:'SINGLE_IP' as const}],history:[{ip:proxy.ip,kind:'REPLACED' as const,occurredAt:null,recordedAt:'2026-10-14T00:00:00Z'}]};
  expect(planBatch({kind:'SHEET',idempotencyKey:'k'},historical,catalog,'p',sheet).rows[0]).toMatchObject({outcome:'ERROR',code:'HISTORICAL_IP'});
  const changed={...ctx,endpoints:[{id:'e',projectId:'p',identityId:'i',proxy:{...proxy,password:'different'},inventoryState:'LIVE' as const,revision:1,vmKeys:[]}]};
  expect(planBatch({kind:'SHEET',idempotencyKey:'k'},changed,catalog,'p',sheet).rows[0]).toMatchObject({outcome:'ERROR',code:'CURRENT_IP'});
});
