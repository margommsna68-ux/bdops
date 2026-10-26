import {describe,it,expect} from 'vitest';
import {businessPulse,type PulseInput} from '@/lib/business-pulse';
const now=new Date('2026-10-26T10:00:00Z');
const vm=(x:Partial<PulseInput>={}):PulseInput=>({id:'v1',serverId:'s1',server:'moon1',code:'VM_001',cycle:1,status:'OK',hasAccount:false,hasPaypal:false,payout:false,money:{amount:'10',observedAt:'2026-10-26T09:00:00Z',failedAt:null},points:[],health:null,...x});
describe('business pulse evidence, not inferred machine success',()=>{
 it('does not turn a stored OK, proxy or amount into a healthy machine; separates deliberate pauses',()=>{
  const p=businessPulse([vm(),vm({id:'off',status:'OFF'}),vm({id:'new',status:'NEW_VM'}),vm({id:'yes',health:{at:'2026-10-26T09:00:00Z',earning:true,problem:null}})],true,now);
  expect(p.health).toEqual({total:4,active:2,good:1,error:0,unknown:1,paused:1,new:1});
 });
 it('requires fresh evidence and keeps proxy failures distinct from EarnApp blocked',()=>{
  const p=businessPulse([vm({health:{at:'2026-10-24T09:00:00Z',earning:true,problem:null}}),vm({id:'e',health:{at:'2026-10-26T09:00:00Z',earning:false,problem:'PROXY_AUTH'}})],true,now);
  expect(p.health).toMatchObject({good:0,error:1,unknown:1});expect(p.rows[1].problem).toBe('PROXY_AUTH');
 });
 it('uses $8 and $10 exactly, only current fresh money; failure and paused are separate',()=>{
  const p=businessPulse(['7.99','8','9.99','10','10.01'].map((amount,i)=>vm({id:String(i),money:{amount,observedAt:'2026-10-26T09:00:00Z',failedAt:null}})),true,now);
  expect(p.withdrawal).toMatchObject({soon:2,enough:2,amount:'20.01'});
  expect(businessPulse([vm({status:'OFF'}),vm({money:{amount:'100',observedAt:'2026-10-24T09:00:00Z',failedAt:null}})],true,now).withdrawal?.enough).toBe(0);
 });
 it('computes only evidenced today intervals, does not turn drops into flat money or estimated income',()=>{
  const points=[{at:'2026-10-26T00:00:00Z',amount:'1.01'},{at:'2026-10-26T09:00:00Z',amount:'1.11'}];
  const p=businessPulse([vm({points}),vm({id:'flat',points:points.map(p=>({...p,amount:'0'}))}),vm({id:'drop',payout:true,points:[points[1],{at:'2026-10-26T09:30:00Z',amount:'0'}]}),vm({id:'one',points:[points[0]]})],true,now);
  expect(p.growth).toMatchObject({amount:'0.1',increasing:1,flat:1,decreased:1,unknown:1,covered:2});
  expect(p.rows.find(r=>r.id==='drop')?.trend).toBe('DECREASED');
 });
 it('uses Vietnam day boundary; stale / failed money has no current growth conclusion',()=>{
  const points=[{at:'2026-10-25T16:59:59Z',amount:'1'},{at:'2026-10-25T17:00:00Z',amount:'2'},{at:'2026-10-26T09:00:00Z',amount:'3'}];
  expect(businessPulse([vm({points})],true,now).growth?.amount).toBe('1');
  expect(businessPulse([vm({points,money:{amount:'3',observedAt:points[2].at,failedAt:'2026-10-26T09:30:00Z'}})],true,now).growth?.unknown).toBe(1);
 });
 it('does not net out a decrease hidden between the first and last reading',()=>{
  const points=[{at:'2026-10-26T01:00:00Z',amount:'10'},{at:'2026-10-26T02:00:00Z',amount:'0'},{at:'2026-10-26T09:00:00Z',amount:'12'}];
  expect(businessPulse([vm({points})],true,now).growth).toMatchObject({amount:null,decreased:1,covered:0});
 });
 it('does not return any amount, threshold or trend data without money permission',()=>{
  const p=businessPulse([vm({points:[{at:'2026-10-26T09:00:00Z',amount:'731.25'}]})],false,now);
  expect(p.growth).toBeNull();expect(p.withdrawal).toBeNull();expect(p.rows[0].amount).toBeNull();expect(p.rows[0].trend).toBeNull();expect(JSON.stringify(p)).not.toContain('731.25');
 });
});
