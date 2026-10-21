import {describe,expect,it} from 'vitest';
import {checkSdkSurvey,prepareSurvey,surveyBody} from '../../../scripts/ops-client.mjs';
// ops-client survey checks (22/10/2026; independent review fix): the web identity of a VM (round, VM revision, revisions of its SDK
// codes) is captured BEFORE the machine is read (sdk-prepare) and travels with the survey; nothing is read at send time, so an old
// survey is never rebound to the VM as it is now.
const cap={projectId:'p',capturedAt:'2026-10-21T00:00:00Z',expectedCycle:1,expectedVmRevision:0,knownSdks:{}};
const vm=(vmId:string,sdks:unknown[],extra:Record<string,unknown>={})=>({...cap,vmId,observedAt:'2026-10-21T01:00:00Z',source:'AE Mini Tool',sdks,...extra});
const issues=(r:{problems:{issue:string}[]})=>r.problems.map(p=>p.issue);
describe('checkSdkSurvey',()=>{
  it('two files with the same code on one machine are one SDK; the same code on two VMs is reported',()=>{
    const r=checkSdkSurvey([vm('a',[{code:'SDKAAAA0001',amountUsd:'1.5'},{code:'SDKAAAA0001'}]),vm('b',[{code:'SDKAAAA0001',amountUsd:'1.5'},{code:'SDKBBBB0002',amountRead:false}])]);
    expect(r.vms[0].sdks).toEqual([{code:'SDKAAAA0001',expectedSdkRevision:null,amountUsd:'1.5'}]);
    expect(r.problems).toEqual([{code:'SDKAAAA0001',vms:['a','b'],issue:'cùng mã SDK ở nhiều VM'}]);
  });
  it('stops on two amounts for one code, malformed money, unreadable with an amount and two current codes',()=>{
    const r=checkSdkSurvey(vm('a',[{code:'SDKAAAA0001',amountUsd:'1'},{code:'SDKAAAA0001',amountUsd:'2'},{code:'SDKCCCC0003',amountUsd:'1,5'},{code:'SDKDDDD0004',amountUsd:'2',amountRead:false,current:true},{code:'SDKEEEE0005',current:true},{code:'bad'}]));
    expect(issues(r).sort()).toEqual(['amountRead=false nhưng có amountUsd','cùng mã hai số tiền khác nhau trên một máy','mã SDK không hợp lệ','nhiều hơn một mã current','tiền USD không đúng dạng "12.345"'].sort());
  });
  it('an entry without its capture, or read before the capture, is refused ("đối chiếu / khảo sát lại"); nothing is derived',()=>{
    const r=checkSdkSurvey({projectId:'p',vmId:'a',observedAt:'2026-10-21T01:00:00Z',source:'x',sdks:[{code:'SDKAAAA0001'}]});
    for(const field of ['capturedAt','expectedCycle','expectedVmRevision','knownSdks'])expect(issues(r).some(i=>i.includes(field)&&/khảo sát lại/.test(i)),field).toBe(true);
    const early=checkSdkSurvey(vm('a',[{code:'SDKAAAA0001'}],{observedAt:'2026-10-20T23:00:00Z'}));
    expect(issues(early)).toEqual([expect.stringMatching(/observedAt trước capturedAt/)]);
  });
  it('expectedSdkRevision comes from the capture (knownSdks); an explicit value that differs is refused, never corrected',()=>{
    const r=checkSdkSurvey(vm('a',[{code:'SDKAAAA0001'},{code:'SDKBBBB0002'}],{knownSdks:{SDKAAAA0001:4}}));
    expect(r.problems).toEqual([]);expect(r.vms[0].sdks).toEqual([{code:'SDKAAAA0001',expectedSdkRevision:4},{code:'SDKBBBB0002',expectedSdkRevision:null}]);
    const bad=checkSdkSurvey(vm('a',[{code:'SDKAAAA0001',expectedSdkRevision:5}],{knownSdks:{SDKAAAA0001:4}}));
    expect(issues(bad)).toEqual([expect.stringMatching(/khác bản chụp/)]);
  });
});
describe('surveyBody / prepareSurvey',()=>{
  it('surveyBody sends exactly the captured identity and reads nothing; a missing identity throws',async()=>{
    const p=await surveyBody(vm('a',[{code:'SDKAAAA0001',amountUsd:'0.21',current:true}],{knownSdks:{SDKAAAA0001:2},evidence:'ảnh 1'}));
    expect(p).toEqual({path:'vms/a/sdk-observations',body:{projectId:'p',expectedCycle:1,expectedVmRevision:0,observedAt:'2026-10-21T01:00:00Z',source:'AE Mini Tool',evidence:'ảnh 1',sdks:[{code:'SDKAAAA0001',expectedSdkRevision:2,amountUsd:'0.21',current:true}]}});
    await expect(surveyBody({projectId:'p',vmId:'a',observedAt:'2026-10-21T01:00:00Z',source:'x',sdks:[{code:'SDKAAAA0001'}]})).rejects.toThrow(/thiếu định danh/);
  });
  it('prepareSurvey captures round, VM revision and the revisions of the VM codes (+ --code extras) with capturedAt and an empty survey',async()=>{
    const calls:string[]=[];
    const read=async(path:string)=>{calls.push(path);
      if(path.startsWith('vms/resolve'))return {id:'vmX'};
      if(path.startsWith('vms/'))return {id:'vmX',serverCode:'S1',code:'VM_01',expectedCycle:3,revision:9,currentSdk:'SDKLIST0001',sdk:{items:[{code:'SDKLIST0001',revision:4}]}};
      return {items:[{code:'SDKSTORE001',found:true,revision:1},{code:'SDKNONE0001',found:false,revision:null}]};};
    const [c]=await prepareSurvey('p',['S1/VM_01'],['SDKSTORE001','SDKNONE0001'],read);
    expect(c).toMatchObject({projectId:'p',vmId:'vmX',serverCode:'S1',vmCode:'VM_01',expectedCycle:3,expectedVmRevision:9,knownSdks:{SDKLIST0001:4,SDKSTORE001:1},currentSdkOnWeb:'SDKLIST0001',observedAt:null,source:null,sdks:[]});
    expect(Date.parse(c.capturedAt)).not.toBeNaN();expect(calls.map(x=>x.split('?')[0])).toEqual(['vms/resolve','vms/vmX','sdks']);
  });
});
