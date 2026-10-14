import {expect,it,vi} from 'vitest';
import {vmView,summarizeVMs,submitAllocation,installationTarget} from '@/components/vm-management/workflow';
const blank={archivedAt:null,slotState:'BLANK',desired:null,installed:null,holds:[]};
it('only a literal empty unoccupied slot is missing; unresolved and source conflicts need review',()=>{
  expect(vmView(blank)).toBe('MISSING');
  for(const slotState of ['FORMULA','PLACEHOLDER','UNRESOLVED'])expect(vmView({...blank,slotState})).toBe('REVIEW');
  expect(vmView({...blank,holds:[{role:'UNCERTAIN',owner:'SELF',state:'NEW'}]})).toBe('REVIEW');
  expect(vmView({...blank,holds:[{role:'DESIRED',owner:'GENJY',state:'NEW'}]})).toBe('REVIEW');
});
it('installed versus desired remains visible while waiting and failed or blocked requires attention',()=>{
  const a={id:'a',status:'CONFIRMED'},b={id:'b',status:'PLANNED'};
  expect(vmView({...blank,slotState:'FULL',installed:a,desired:b})).toBe('PENDING');
  expect(vmView({...blank,slotState:'FULL',installed:a,desired:a})).toBe('INSTALLED');
  expect(vmView({...blank,desired:{...b,status:'FAILED'}})).toBe('REVIEW');
  expect(vmView({...blank,desired:a,installed:a,holds:[{role:'INSTALLED',owner:'SELF',state:'BLOCKED'}]})).toBe('REVIEW');
  expect(summarizeVMs([blank,{...blank,archivedAt:'2026-10-14'}])).toEqual({total:1,missing:1,pending:0,installed:0,review:0});
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
