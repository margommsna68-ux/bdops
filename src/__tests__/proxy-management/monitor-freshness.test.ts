import {describe,it,expect} from 'vitest';
import {businessPulse,type PulseInput} from '@/lib/business-pulse';
import {MONITOR_POLICY,MonitorObservation,monitorFreshness,monitorProjection} from '@/lib/monitor-policy';
const now=new Date('2026-10-26T10:00:00Z');
const vm=(age:number):PulseInput=>({id:'v',serverId:'s',server:'canary',code:'VM_001',cycle:1,status:'OK',hasAccount:false,hasPaypal:false,payout:false,money:null,points:[],health:{at:new Date(now.getTime()-age*1000).toISOString(),earning:true,problem:null}});
describe('independent monitor freshness',()=>{
 it.each(['ABORTED','POWERED_OFF','PAUSED','STARTING','STOPPING'] as const)('fresh native %s contradicts earning=true and prevents GOOD',state=>{
  const at=now.toISOString(),monitor={configVersion:1,vmState:{observedAt:at,state}};
  const row=businessPulse([{...vm(0),health:{at,earning:true,problem:null,monitor}}],false,now).rows[0];
  expect(row.health).toBe('UNKNOWN');expect(row.earning).toBeNull();
 });
 it('does not treat stale native state as a current contradiction of legacy earning proof',()=>{
  const at=now.toISOString(),observedAt=new Date(now.getTime()-1200000).toISOString();
  const row=businessPulse([{...vm(0),health:{at,earning:true,problem:null,monitor:{configVersion:1,vmState:{observedAt,state:'ABORTED'}}}}],false,now).rows[0];
  expect(row.health).toBe('GOOD');expect(row.monitor.vmState).toBe('STALE');
 });
 it('expires health exactly at 1200 seconds independently of the 24 hour money rule',()=>{
  expect(businessPulse([vm(1199)],false,now).health.good).toBe(1);
  expect(businessPulse([vm(1200)],false,now).health.good).toBe(0);
  expect(businessPulse([vm(3600)],false,now).health.unknown).toBe(1);
 });
 it('keeps each health axis independent, HOST evidence and process success never imply guest health or earning',()=>{
  const at=now.toISOString(),m=MonitorObservation.parse({configVersion:1,vmState:{observedAt:at,state:'RUNNING'},network:{observedAt:at,provenance:'HOST',ncsi:'NONE',https:'OK'},app:{observedAt:at,earnApp:'RUNNING',sdk:'RUNNING',connection:'NOT_OBSERVED'}});
  const p=businessPulse([{...vm(0),health:{at,earning:null,problem:null,monitor:m}}],false,now);
  expect(p.rows[0]).toMatchObject({health:'UNKNOWN',earning:null,monitor:{running:true,guest:'UNKNOWN',guestNetworkVerified:false,guestProxyVerified:false,appConnectionVerified:false}});
  expect(monitorProjection({...m,configVersion:2},now)).toMatchObject({vmState:'UNSUPPORTED',running:false});
  expect(monitorProjection({...m,guest:{observedAt:new Date(now.getTime()-1200000).toISOString(),additions:'UNKNOWN',response:'AUTH_FAILED'}},now).guest).toBe('STALE');
 });
 it('uses source time for heartbeat expiry and rejects unbounded/secret telemetry',()=>{
  expect(MONITOR_POLICY).toMatchObject({version:1,inventorySeconds:60,guestSeconds:600,proxySeconds:600,healthStaleSeconds:1200,heartbeatSeconds:60,heartbeatStaleSeconds:180,startupGraceSeconds:120,recheckSeconds:30});
  expect(MONITOR_POLICY.guestTimeoutSeconds).toBeLessThanOrEqual(45);expect(MONITOR_POLICY.proxyTimeoutSeconds).toBeLessThanOrEqual(8);
  for(const [age,state] of [[179,'FRESH'],[180,'STALE']] as const)expect(monitorFreshness(new Date(now.getTime()-age*1000).toISOString(),now,180)).toBe(state);
  expect(monitorFreshness(new Date(now.getTime()+1000).toISOString(),now)).toBe('UNKNOWN');
  for(const m of [{configVersion:1,error:'secret'},{configVersion:1,guest:{observedAt:now.toISOString(),additions:'ABSENT',response:'wrong password'}}])expect(MonitorObservation.safeParse(m).success).toBe(false);
 });
});

it('expires one-minute VM inventory after two missed intervals without expiring ten-minute guest evidence',()=>{const observedAt=new Date(now.getTime()-120000).toISOString();const p=monitorProjection({configVersion:1,vmState:{observedAt,state:'RUNNING'},guest:{observedAt,additions:'PRESENT',response:'RESPONSIVE'}},now);expect(p.vmState).toBe('STALE');expect(p.running).toBe(false);expect(p.guest).toBe('FRESH');});
