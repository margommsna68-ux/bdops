import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import type {Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({pick:vi.fn(),request:vi.fn(),attach:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{useContext:()=>({vmOps:{payoutPick:{fetch:mock.pick}}}),vmOps:{requestPayout:{useMutation:()=>({mutateAsync:mock.request})},addPayoutMembers:{useMutation:()=>({mutateAsync:mock.attach})}}}}));
import {MergePayoutPanel} from '@/components/vm-management/vm-grid/MergePayoutPanel';
import {requestLine} from '@/components/vm-management/vm-grid/MoneyParts';
// Rút gộp (27/10/2026): synthetic rows only.
let dom:JSDOM,root:Root,host:HTMLDivElement,props:any;
const now=new Date().toISOString();
const vm=(id:string,amount:string|null)=>({id,code:'VM_00'+id,server:'An-01',revision:2,sdks:amount===null?[]:[{current:true,code:'sdk-'+id+'-0000000000',amount,amountObservedAt:now,amountFailedAt:null,moneyHidden:false,stored:{amount,observedAt:now,cycle:1,vmId:id}}]});
const ops=(id:string,o:Record<string,unknown>={})=>({vmId:id,cycle:1,earnAppId:id==='1'?'acc1':null,request:null,merge:null,...o});
const pick={vm:{id:'1',where:'An-01 / VM_001'},earnApp:{id:'acc1',login:'l',emailId:'e1',email:'one@example.invalid'},paypals:[{id:'p1',code:'PP1',status:'ACTIVE',usable:true,daily:{date:'2026-10-27',timeZone:'Asia/Ho_Chi_Minh',limit:2,used:0,reserved:0,remaining:2},emails:[{id:'e1',email:'one@example.invalid',own:true,dailyAllowed:true,dailyOccupied:false}],unused:0,balanceUsd:null,pendingUsd:null,heldUsd:'0.00'}],suggestion:null,rights:{money:true,balance:false,prepareOnly:false}};
beforeEach(async()=>{dom=new JSDOM('<html><body></body></html>',{url:'https://example.invalid'});for(const [k,v]of Object.entries({React,window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true}))vi.stubGlobal(k,v);const {createRoot}=await import('react-dom/client');host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);
  mock.pick.mockReset().mockResolvedValue(pick);mock.request.mockReset().mockResolvedValue({id:'r1',members:[{vmId:'3'}]});mock.attach.mockReset().mockResolvedValue({added:[{vmId:'3'}]});
  props={projectId:'p',userId:'u',vms:[vm('1','8.71'),vm('3','11.83')],opsOf:(id:string)=>ops(id),rights:{writeMoney:true,payout:true,receipt:true,assign:true},onSaved:vi.fn(),onBusy:vi.fn()};});
afterEach(async()=>{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals();});
const render=()=>act(async()=>{root.render(<MergePayoutPanel {...props}/>)});
async function change(label:string,value:string){const el=host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;expect(el).toBeTruthy();await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(x=>x.textContent===text);
it('only a VM with an EarnApp account can be the primary; the total is the sum of the shares',async()=>{
  await render();
  expect((host.querySelector('[aria-label="VM chính An-01 / VM_003"]') as HTMLInputElement).disabled).toBe(true);
  expect((host.querySelector('[aria-label="VM chính An-01 / VM_001"]') as HTMLInputElement).checked).toBe(true);
  expect(host.textContent).toContain('Chưa có tài khoản');
  expect(host.textContent).toMatch(/Tổng gợi ý \$20[.,]54/);
});
it('saves one preparation on the primary with the members and no actual payout call',async()=>{
  await render();await change('Số tiền thực rút trên EarnApp','20.54');
  await act(async()=>button('Lưu chuẩn bị rút gộp 2 VM')!.click());
  expect(mock.request).toHaveBeenCalledTimes(1);
  expect(mock.request.mock.calls[0][0]).toMatchObject({vmId:'1',earnAppId:'acc1',paypalEmailId:'e1',amount:'20.54',submission:'PREPARING',members:[{vmId:'3',expectedCycle:1,expectedVmRevision:2}]});
  expect(host.textContent).toContain('Đã ghi chuẩn bị rút gộp 2 VM');expect(props.onSaved).toHaveBeenCalled();
});
it('primary with an open request: attaches the other VMs to it',async()=>{
  props.opsOf=(id:string)=>ops(id,id==='1'?{request:{id:'r9',revision:5,state:'REQUESTED',submission:'SENT',paypal:'PP1',email:'one@example.invalid',money:{amount:'20.54',currency:'USD'}}}:{});
  await render();expect(host.textContent).toContain('gắn thêm các VM còn lại vào lệnh này');
  await act(async()=>button('Gộp 1 VM vào lệnh rút')!.click());
  expect(mock.attach.mock.calls[0][0]).toMatchObject({requestId:'r9',expectedRevision:5,members:[{vmId:'3',expectedCycle:1}]});expect(mock.request).not.toHaveBeenCalled();
});
it('a selected VM already in another request blocks the save',async()=>{
  props.opsOf=(id:string)=>ops(id,id==='3'?{request:{id:'rX',revision:1,state:'REQUESTED',submission:'PREPARING'}}:{});
  await render();await change('Số tiền thực rút trên EarnApp','20.54');
  expect(host.textContent).toContain('Đang có lệnh rút riêng');expect(button('Lưu chuẩn bị rút gộp 2 VM')!.disabled).toBe(true);
});
it('an unknown answer keeps the original command; retry sends the same key and body',async()=>{
  mock.request.mockRejectedValueOnce(new Error('502')).mockResolvedValueOnce({replay:true});
  await render();await change('Số tiền thực rút trên EarnApp','20.54');await act(async()=>button('Lưu chuẩn bị rút gộp 2 VM')!.click());
  expect(host.textContent).toContain('Chưa xác định kết quả');
  await act(async()=>button('Thử lại lệnh chưa rõ')!.click());
  expect(mock.request).toHaveBeenCalledTimes(2);expect(mock.request.mock.calls[1][0]).toEqual(mock.request.mock.calls[0][0]);
});
it('member money cell says which VM it was merged into',()=>{
  const line=requestLine({milestone:'WAITING',merge:{role:'MEMBER',primaryVmId:'1',primaryWhere:'An-01 / VM_001',consumed:false},request:{phase:'WAITING',paypal:'PP1',email:'one@example.invalid',money:{amount:'20.54',received:'0.00',remaining:'20.54',currency:'USD'}}} as never);
  expect(line?.sub).toContain('Đã gộp vào An-01 / VM_001');
  const p=requestLine({milestone:'WAITING',merge:{role:'PRIMARY',members:[{vmId:'3',where:'An-01 / VM_003',share:null,consumed:false}]},request:{phase:'WAITING',paypal:'PP1',email:'one@example.invalid',money:{amount:'20.54',received:'0.00',remaining:'20.54',currency:'USD'}}} as never);
  expect(p?.text).toContain('gộp 2 VM');
});
