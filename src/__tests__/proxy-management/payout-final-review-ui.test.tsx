// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,it,expect,vi} from 'vitest';
// Final whole-branch review (28/10/2026): the frame never claims "Đã ghi" for an answer that changed nothing, and the VM history shows
// requests removed as mistaken ("Đã xoá do ghi nhầm") and the LOST phase ("Mất do SUS"). Synthetic ids only.
const mock=vi.hoisted(()=>({update:vi.fn(),void:vi.fn(),receipt:vi.fn(),edit:vi.fn(),unsend:vi.fn(),sus:vi.fn(),request:vi.fn(),pick:vi.fn(),done:vi.fn(),history:vi.fn(),toast:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{useContext:()=>({vmOps:{payoutPick:{fetch:mock.pick}}}),vmOps:{
  requestPayout:{useMutation:()=>({mutateAsync:mock.request})},updatePayout:{useMutation:()=>({mutateAsync:mock.update})},editPayout:{useMutation:()=>({mutateAsync:mock.edit})},
  unsendPayout:{useMutation:()=>({mutateAsync:mock.unsend})},voidPayout:{useMutation:()=>({mutateAsync:mock.void})},suspendEarnApp:{useMutation:()=>({mutateAsync:mock.sus})},
  payoutReceipt:{useMutation:()=>({mutateAsync:mock.receipt})},payoutPick:{useQuery:()=>({data:undefined})},history:{useQuery:()=>mock.history()}}}}));
vi.mock('react-hot-toast',()=>({default:{success:mock.toast,error:vi.fn()}}));
import {PayoutFrame,type VmOpsRequestView} from '@/components/vm-management/vm-grid/PayoutFrame';
import {OpsHistory} from '@/components/vm-management/vm-grid/VmSidePanel';
let root:Root,host:HTMLDivElement;
const all={assign:true,money:true,writeMoney:true,payout:true,receipt:true};
const request=(o:Partial<VmOpsRequestView>={}):VmOpsRequestView=>({id:'req',revision:3,cycle:2,earnAppId:'ea',state:'REQUESTED',submission:'SENT',submittedAt:null,stateNote:null,phase:'WAITING',paypalId:'pp',paypal:'PP1',email:'mail@example.invalid',emailId:'em',requestedAt:'2026-10-28',reference:null,settled:false,
  money:{lost:null,amount:'10.00',currency:'USD',received:'0.00',pendingLinked:'0.00',remaining:'10.00',shortfall:null,settleNote:null},...o});
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);window.sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);
  for(const f of Object.values(mock))f.mockReset().mockResolvedValue({});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text);
const click=(text:string)=>act(async()=>button(text)!.click());
const frame=()=>act(async()=>root.render(<PayoutFrame projectId="p" userId="u" vmId="vm" cycle={2} earnAppId="ea" request={request()} rights={all} onDone={mock.done}/>));

it('"EarnApp bị SUS" answered changed:false says nothing changed, never "Đã ghi"',async()=>{
  mock.sus.mockResolvedValueOnce({vmId:'vm',cycle:2,changed:false,request:{id:'req',outcome:null,lostAmount:null},archivedEmailIds:[]});
  await frame();await click('EarnApp bị SUS');await click('Ghi EarnApp bị SUS');
  expect(mock.sus).toHaveBeenCalledTimes(1);
  const said=String(mock.toast.mock.calls[0][0]);expect(said).toMatch(/không có gì thay đổi/);expect(said).not.toMatch(/^Đã ghi/);
});
it('"EarnApp bị SUS" that closed something keeps the done message',async()=>{
  mock.sus.mockResolvedValueOnce({vmId:'vm',cycle:2,changed:true,request:{id:'req',outcome:'LOST',lostAmount:'10.00'},archivedEmailIds:['em']});
  await frame();await click('EarnApp bị SUS');await click('Ghi EarnApp bị SUS');
  expect(String(mock.toast.mock.calls[0][0])).toBe('Đã ghi EarnApp bị SUS');
});
const history=(o:Record<string,unknown>={})=>({data:{rights:{writeMoney:true},cycles:[],events:[],requests:[{id:'r1',cycle:1,login:'login@example.invalid',paypal:'PP1',email:'mail@example.invalid',requestedAt:'2026-10-20',phase:'LOST',state:'LOST_SUS',submission:'SENT',consumed:false,reviewAfterRecreate:false,old:false,money:null,history:[]}],
  voided:[{id:'v1',requestId:'r0',cycle:1,at:'2026-10-21T03:00:00.000Z',by:'Chủ',reason:'Ghi nhầm email',paypal:'PP2',email:'wrong@example.invalid',amount:'12.50',currency:'USD'},
    {id:'v2',requestId:'r9',cycle:1,at:'2026-10-22T03:00:00.000Z',by:'Nhân viên',reason:null,paypal:'PP3',email:'other@example.invalid',amount:null,currency:null}],...o},error:null,refetch:vi.fn()});
it('VM history shows LOST as "Mất do SUS" and every voided request (reason / amount only when provided)',async()=>{
  mock.history.mockReturnValue(history());
  await act(async()=>root.render(<OpsHistory projectId="p" vmId="vm"/>));
  expect(host.textContent).toContain('Mất do SUS');
  expect(host.textContent).toContain('Đã xoá do ghi nhầm');
  const rows=Array.from(host.querySelectorAll('[data-voided]'));expect(rows.map(r=>r.getAttribute('data-voided'))).toEqual(['r0','r9']);
  expect(rows[0].textContent).toContain('Chủ');expect(rows[0].textContent).toContain('PP2 · wrong@example.invalid');expect(rows[0].textContent).toContain('Ghi nhầm email');expect(rows[0].textContent).toMatch(/12,50/);
  expect(rows[1].textContent).toContain('Nhân viên');expect(rows[1].textContent).toContain('PP3 · other@example.invalid');expect(rows[1].textContent).not.toMatch(/\$|USD|null/);
});
it('no voided request: no "Đã xoá do ghi nhầm" section',async()=>{
  mock.history.mockReturnValue(history({voided:[]}));
  await act(async()=>root.render(<OpsHistory projectId="p" vmId="vm"/>));
  expect(host.textContent).not.toContain('Đã xoá do ghi nhầm');
});
