import {describe,expect,it} from 'vitest';
import {checkSdkSurvey} from '../../../scripts/ops-client.mjs';
// ops-client `sdk-check` / `sdk-observe` (22/10/2026): the survey is checked on the operator's machine before anything is sent.
describe('checkSdkSurvey',()=>{
  const vm=(vmId:string,sdks:unknown[])=>({projectId:'p',vmId,expectedCycle:1,expectedVmRevision:0,observedAt:'2026-10-21T00:00:00Z',source:'AE Mini Tool',sdks});
  it('two files with the same code on one machine are one SDK; the same code on two VMs is reported',()=>{
    const r=checkSdkSurvey([vm('a',[{code:'SDKAAAA0001',amountUsd:'1.5'},{code:'SDKAAAA0001'}]),vm('b',[{code:'SDKAAAA0001',amountUsd:'1.5'},{code:'SDKBBBB0002',amountRead:false}])]);
    expect(r.vms[0].sdks).toEqual([{code:'SDKAAAA0001',amountUsd:'1.5'}]);
    expect(r.problems).toEqual([{code:'SDKAAAA0001',vms:['a','b'],issue:'cùng mã SDK ở nhiều VM'}]);
  });
  it('stops on two amounts for one code, malformed money, unreadable with an amount and two current codes',()=>{
    const r=checkSdkSurvey(vm('a',[{code:'SDKAAAA0001',amountUsd:'1'},{code:'SDKAAAA0001',amountUsd:'2'},{code:'SDKCCCC0003',amountUsd:'1,5'},{code:'SDKDDDD0004',amountUsd:'2',amountRead:false,current:true},{code:'SDKEEEE0005',current:true},{code:'bad'}]));
    expect(r.problems.map((p:{issue:string})=>p.issue).sort()).toEqual(['amountRead=false nhưng có amountUsd','cùng mã hai số tiền khác nhau trên một máy','mã SDK không hợp lệ','nhiều hơn một mã current','tiền USD không đúng dạng "12.345"'].sort());
  });
});
