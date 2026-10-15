import {describe,expect,it} from 'vitest';
import {dueState,nextDueAfterPayment,compareCodes,sortRegistryRows} from '@/server/proxy-management/package-terms';
import type {RegistryRow} from '@/server/proxy-management/types';
const today=new Date('2026-10-16T05:00:00.000Z');
describe('dueState',()=>{
  it('classifies missing, overdue, due soon (7 days) and ok with signed days left',()=>{
    expect(dueState(null,today)).toEqual({state:'NONE',daysLeft:null});
    expect(dueState(new Date('2026-10-15T00:00:00.000Z'),today)).toEqual({state:'OVERDUE',daysLeft:-1});
    expect(dueState(new Date('2026-10-16T00:00:00.000Z'),today)).toEqual({state:'DUE_SOON',daysLeft:0});
    expect(dueState(new Date('2026-10-23T00:00:00.000Z'),today)).toEqual({state:'DUE_SOON',daysLeft:7});
    expect(dueState(new Date('2026-10-24T00:00:00.000Z'),today)).toEqual({state:'OK',daysLeft:8});
  });
});
describe('nextDueAfterPayment',()=>{
  it('adds the cycle to the later of current due date and payment date, clamping month ends',()=>{
    expect(nextDueAfterPayment(new Date('2026-10-20T00:00:00.000Z'),new Date('2026-10-16T00:00:00.000Z'),1).toISOString().slice(0,10)).toBe('2026-11-20');
    expect(nextDueAfterPayment(new Date('2026-09-01T00:00:00.000Z'),new Date('2026-10-16T00:00:00.000Z'),1).toISOString().slice(0,10)).toBe('2026-11-16');
    expect(nextDueAfterPayment(null,new Date('2026-01-31T00:00:00.000Z'),1).toISOString().slice(0,10)).toBe('2026-02-28');
    expect(nextDueAfterPayment(null,new Date('2026-10-16T00:00:00.000Z'),3).toISOString().slice(0,10)).toBe('2027-01-16');
  });
});
describe('compareCodes',()=>{
  it('orders codes by natural numbers and case-insensitively',()=>{
    expect(['VM_10','VM_2','vm_1','M-010','M-002'].sort(compareCodes)).toEqual(['M-002','M-010','vm_1','VM_2','VM_10']);
  });
});
const row=(o:Partial<RegistryRow>):RegistryRow=>({identityId:o.ip||'i',endpointId:o.endpointId===undefined?'e-'+(o.ip||'i'):o.endpointId,ip:'10.0.0.1',port:80,owner:'SELF',subgroup:null,packageCode:null,state:'LIVE',revision:1,sourceRefs:[],vmRefs:[],statusAt:null,...o});
describe('sortRegistryRows',()=>{
  const rows=[
    row({ip:'10.0.0.9',packageCode:'240292',vmRefs:['moon1/M-010 · Đã cài'],statusAt:'2026-10-01T00:00:00.000Z'}),
    row({ip:'10.0.0.2',packageCode:null,vmRefs:['An-01/VM_002 · Đã cài'],statusAt:'2026-10-05T00:00:00.000Z'}),
    row({ip:'10.0.0.3',packageCode:'231243',vmRefs:['moon1/M-002 · Đã cài'],statusAt:null}),
    row({ip:'10.0.0.1',packageCode:'231243',vmRefs:[],statusAt:'2026-10-09T00:00:00.000Z'}),
    row({ip:'10.0.0.4',packageCode:'VietPhe account',vmRefs:['vt-03/VM_001 · Đã cài'],statusAt:'2026-10-03T00:00:00.000Z'}),
  ];
  const ips=(mode:Parameters<typeof sortRegistryRows>[1])=>sortRegistryRows([...rows],mode).map(r=>r.ip);
  it('PACKAGE: numeric packages first, then names, unknown last; inside a package server/VM then IP, unassigned last',()=>{
    expect(ips('PACKAGE')).toEqual(['10.0.0.3','10.0.0.1','10.0.0.9','10.0.0.4','10.0.0.2']);
  });
  it('SERVER: server then VM naturally, unassigned last',()=>{
    expect(ips('SERVER')).toEqual(['10.0.0.2','10.0.0.3','10.0.0.9','10.0.0.4','10.0.0.1']);
  });
  it('STATUS: newest recorded status first, unknown dates last',()=>{
    expect(ips('STATUS')).toEqual(['10.0.0.1','10.0.0.2','10.0.0.4','10.0.0.9','10.0.0.3']);
  });
  it('IP: numeric address order',()=>{
    expect(ips('IP')).toEqual(['10.0.0.1','10.0.0.2','10.0.0.3','10.0.0.4','10.0.0.9']);
  });
});
