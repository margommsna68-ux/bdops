import {expect,it,vi} from 'vitest';
import {vmView,summarizeVMs,submitAllocation,installationTarget} from '@/components/vm-management/workflow';
const blank={archivedAt:null,slotState:'BLANK',desired:null,installed:null,holds:[]};
it('only a literal empty unoccupied slot is missing; unresolved and source conflicts need review',()=>{
  expect(vmView(blank)).toBe('MISSING');
  for(const slotState of ['FORMULA','PLACEHOLDER','UNRESOLVED'])expect(vmView({...blank,slotState})).toBe('REVIEW');
  expect(vmView({...blank,holds:[{role:'UNCERTAIN',owner:'SELF',state:'NEW'}]})).toBe('REVIEW');
  expect(vmView({...blank,holds:[{role:'DESIRED',owner:'GENJY',state:'NEW'}]})).toBe('REVIEW');
});
// Owner decision 19/10/2026: the assigned proxy is the VM's proxy (no Chờ cài / Đã cài); two different older positions are kept for review.
it('one clear position is the current proxy; a Blocked current proxy is its own view; two different positions need review',()=>{
  const a={id:'a',endpointId:'ea'},b={id:'b',endpointId:'eb'},hold=(endpointId:string,state='LIVE',role='DESIRED')=>({role,owner:'SELF',state,endpointId});
  expect(vmView({...blank,slotState:'FULL',desired:b,holds:[hold('eb')]})).toBe('ASSIGNED');
  expect(vmView({...blank,slotState:'FULL',installed:a,holds:[hold('ea','LIVE','INSTALLED')]})).toBe('ASSIGNED');
  expect(vmView({...blank,slotState:'FULL',installed:a,desired:b,holds:[hold('ea','LIVE','INSTALLED'),hold('eb')]})).toBe('REVIEW');
  expect(vmView({...blank,slotState:'FULL',desired:b,holds:[hold('eb','BLOCKED')]})).toBe('BLOCKED');
  expect(vmView({...blank,slotState:'FULL',desired:b,holds:[hold('eb','REPLACED')]})).toBe('REVIEW');
  expect(summarizeVMs([blank,{...blank,archivedAt:'2026-10-14'}])).toEqual({total:1,missing:1,assigned:0,blocked:0,review:0});
});
it('a shortage stops autofill for explicit partial approval; retry preserves the checked token',async()=>{
  const input={mode:'AUTO' as const,idempotencyKey:'fixed-retry-key'},commit=vi.fn(),onPreview=vi.fn();
  const review={token:'checked',rows:[],ready:1,errors:1,skipped:0};
  expect((await submitAllocation(input,async()=>review,commit,onPreview)).phase).toBe('REVIEW');expect(commit).not.toHaveBeenCalled();
  commit.mockRejectedValue(new Error('Lost response'));
  await expect(submitAllocation(input,async()=>({...review,errors:0}),commit,onPreview)).rejects.toThrow('Lost response');
  expect(commit).toHaveBeenCalledWith({token:'checked',idempotencyKey:'fixed-retry-key'});expect(onPreview).toHaveBeenCalled();
});
it('an install action selects the exact endpoint, even when two ports share the same IP',()=>{
  const a={endpointId:'a',ip:'192.0.2.1',port:8001,state:'BLOCKED'},b={endpointId:'b',ip:'192.0.2.1',port:8002,state:'NEW'};
  expect(installationTarget({desired:{endpointId:'b'},holds:[a,b]})).toEqual(b);
});
