import React,{act} from 'react';
import {JSDOM} from 'jsdom';
import type {Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({pick:vi.fn(),request:vi.fn(),receipt:vi.fn(),update:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{useContext:()=>({vmOps:{payoutPick:{fetch:mock.pick}}}),vmOps:{requestPayout:{useMutation:()=>({mutateAsync:mock.request})},payoutReceipt:{useMutation:()=>({mutateAsync:mock.receipt})},updatePayout:{useMutation:()=>({mutateAsync:mock.update})}}}}));
import {PayoutBulkPanel} from '@/components/vm-management/vm-grid/PayoutBulkPanel';
// Selection → "Rút N VM" (PREPARING, email held per row), "Đã rút N dòng", "Tiền đã về N dòng" (owner 28/10/2026). Synthetic ids only.
let dom:JSDOM,root:Root,host:HTMLDivElement,props:any;
const vm=(id:string)=>({id,code:'VM_'+id,server:'An-01',serverId:'s1',revision:2,sdks:[]});
const ops=(id:string)=>({vmId:id,cycle:1,earnAppId:'acc'+id,request:null});
const money={lost:null,amount:'10.00',currency:'USD',received:'0.00',pendingLinked:'0.00',remaining:'10.00',shortfall:null,settleNote:null};
const request=(o:Record<string,unknown>={})=>({id:'r1',revision:4,earnAppId:'acc1',cycle:1,state:'REQUESTED',submission:'SENT',phase:'WAITING',paypal:'PP1',email:'one@example.invalid',money,...o});
beforeEach(async()=>{dom=new JSDOM('<html><body></body></html>',{url:'https://example.invalid'});for(const [k,v]of Object.entries({React,window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true}))vi.stubGlobal(k,v);const {createRoot}=await import('react-dom/client');host=document.createElement('div');document.body.append(host);root=createRoot(host);props={projectId:'p',userId:'u',vms:[vm('1'),vm('2')],opsOf:ops,rights:{writeMoney:true,payout:true,receipt:true},onSaved:vi.fn(),onAssign:vi.fn(),onBusy:vi.fn()};mock.pick.mockReset().mockImplementation(async({vmId})=>({earnApp:{id:'acc'+vmId},paypals:[{id:'pp',code:'PP1',usable:true,balanceUsd:'55.00',emails:[{id:'e1',email:'one@example.invalid'},{id:'e2',email:'two@example.invalid'}]}]}));mock.request.mockReset().mockResolvedValue({});mock.receipt.mockReset().mockResolvedValue({});mock.update.mockReset().mockResolvedValue({});});
afterEach(async()=>{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals();});
const render=()=>act(async()=>{root.render(<PayoutBulkPanel {...props}/>)});
async function change(label:string,value:string){const el=host.querySelector(`[aria-label="${label}"]`) as HTMLInputElement|HTMLSelectElement;expect(el).toBeTruthy();await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});}
const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(x=>x.textContent===text) as HTMLButtonElement|undefined;
async function click(text:string){const b=button(text);expect(b).toBeTruthy();await act(async()=>b!.click());}
it('"Rút N VM" creates PREPARING requests with distinct emails and correct identities',async()=>{await render();await change('Số tiền An-01 / VM_1','10');await change('Email PP An-01 / VM_1','e1');await change('Số tiền An-01 / VM_2','12');await change('Email PP An-01 / VM_2','e2');await click('Rút 2 VM');expect(mock.request).toHaveBeenCalledTimes(2);expect(mock.request.mock.calls[0][0]).toMatchObject({vmId:'1',expectedCycle:1,expectedVmRevision:2,earnAppId:'acc1',paypalEmailId:'e1',amount:'10',submission:'PREPARING'});expect(mock.request.mock.calls[1][0].paypalEmailId).toBe('e2');expect(mock.receipt).not.toHaveBeenCalled();});
it('pre-picks a different free email of the suggested PayPal for each row and the amount from Tiền VM',async()=>{
  mock.pick.mockImplementation(async({vmId})=>({earnApp:{id:'acc'+vmId,emailId:null},suggestion:{paypalId:'pp'},paypals:[{id:'pp',code:'PP1',usable:true,balanceUsd:'0.00',emails:[{id:'e1',email:'one@example.invalid'},{id:'e2',email:'two@example.invalid'}]}]}));
  props.vms=[{...vm('1'),sdks:[{current:true,code:'c1',amount:'12.345',amountObservedAt:new Date().toISOString(),amountFailedAt:null,moneyHidden:false,stored:null}]},vm('2')];
  await render();
  expect((host.querySelector('[aria-label="Email PP An-01 / VM_1"]') as HTMLSelectElement).value).toBe('e1');
  expect((host.querySelector('[aria-label="Email PP An-01 / VM_2"]') as HTMLSelectElement).value).toBe('e2');
  expect((host.querySelector('[aria-label="Số tiền An-01 / VM_1"]') as HTMLInputElement).value).toBe('12.34');
});
it('without the session user nothing is read or sent (no anonymous journal)',async()=>{props.userId=undefined;await render();expect(host.textContent).toContain('Đang tải phiên đăng nhập');expect(mock.pick).not.toHaveBeenCalled();});
it('shows missing-account reason and assignment action instead of hiding withdrawal',async()=>{props.opsOf=()=>({cycle:1,earnAppId:null,request:null});await render();expect(host.textContent).toContain('Chưa gán tài khoản EarnApp');await click('Gán tài khoản cho VM đã chọn');expect(props.onAssign).toHaveBeenCalled();expect(mock.pick).not.toHaveBeenCalled();});
it('blocks stale account/cycle drafts after live refresh',async()=>{await render();await change('Số tiền An-01 / VM_1','10');await change('Email PP An-01 / VM_1','e1');props={...props,opsOf:(id:string)=>({...ops(id),cycle:2})};await render();expect(host.textContent).toContain('VM đã đổi lượt hoặc tài khoản');expect((Array.from(host.querySelectorAll('button')).find(x=>x.textContent?.startsWith('Rút ')) as HTMLButtonElement).disabled).toBe(true);expect(mock.request).not.toHaveBeenCalled();});
it('unknown response freezes original command and retry reuses its exact key/body',async()=>{props.vms=[vm('1')];mock.request.mockRejectedValueOnce(new Error('502')).mockResolvedValueOnce({replay:true});await render();await change('Số tiền An-01 / VM_1','10');await change('Email PP An-01 / VM_1','e1');await click('Rút 1 VM');expect(host.textContent).toContain('Chưa xác định kết quả');expect((host.querySelector('[aria-label="Số tiền An-01 / VM_1"]') as HTMLInputElement).disabled).toBe(true);await click('Thử lại lệnh chưa rõ');expect(mock.request.mock.calls[1][0]).toEqual(mock.request.mock.calls[0][0]);});
it('does not offer one receiving email to two selected VMs',async()=>{await render();await change('Email PP An-01 / VM_1','e1');const select=host.querySelector('[aria-label="Email PP An-01 / VM_2"]') as HTMLSelectElement;expect(Array.from(select.options).find(o=>o.value==='e1')?.disabled).toBe(true);});
it('keeps an uncertain command across closing/reopening and a refused retry',async()=>{props.vms=[vm('1')];mock.request.mockRejectedValueOnce(new Error('502')).mockRejectedValueOnce(Object.assign(new Error('revoked'),{data:{code:'UNAUTHORIZED'}})).mockResolvedValueOnce({replay:true});await render();await change('Số tiền An-01 / VM_1','10');await change('Email PP An-01 / VM_1','e1');await click('Rút 1 VM');const original=mock.request.mock.calls[0][0];await act(async()=>root.unmount());const {createRoot}=await import('react-dom/client');root=createRoot(host);props={...props,opsOf:(id:string)=>({...ops(id),cycle:2,earnAppId:'replacement'})};await render();await click('Thử lại lệnh chưa rõ');expect(mock.request.mock.calls[1][0]).toEqual(original);expect(host.textContent).toContain('Chưa xác định kết quả');await click('Thử lại lệnh chưa rõ');expect(mock.request.mock.calls[2][0]).toEqual(original);});
it('continues valid rows after a definitive row refusal without repeating successful rows',async()=>{mock.request.mockRejectedValueOnce(Object.assign(new Error('email held elsewhere'),{data:{code:'CONFLICT'}})).mockResolvedValue({});await render();for(const [id,email] of [['1','e1'],['2','e2']]){await change('Số tiền An-01 / VM_'+id,'10');await change('Email PP An-01 / VM_'+id,email);}await click('Rút 2 VM');expect(mock.request).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('email held elsewhere');expect(host.textContent).toContain('Đã giữ email, đang rút');await click('Rút 1 VM');expect(mock.request).toHaveBeenCalledTimes(3);expect(mock.request.mock.calls[2][0].vmId).toBe('1');});
it('"Rút" never offers a SENT shortcut: no checkbox, always PREPARING',async()=>{props.vms=[vm('1')];await render();expect(host.querySelector('input[type="checkbox"]')).toBeNull();await change('Số tiền An-01 / VM_1','10');await change('Email PP An-01 / VM_1','e1');await click('Rút 1 VM');expect(mock.request.mock.calls[0][0].submission).toBe('PREPARING');});
it('"Đã rút N dòng": PREPARING rows get SENT at once on their original requests; other rows are skipped with a reason',async()=>{
  props.opsOf=(id:string)=>({...ops(id),request:request(id==='1'?{submission:'PREPARING'}:{id:'r2',earnAppId:'acc2'})});
  await render();await click('Đã rút');
  expect(host.textContent).toContain('Bỏ qua 1 dòng');expect(host.textContent).toContain('Đã rút (đã ghi trước đó)');
  expect(host.querySelector('[aria-label="Danh sách Đã rút"] input[type="checkbox"]')).toBeNull();
  await click('Đã rút 1 dòng');
  expect(mock.update).toHaveBeenCalledTimes(1);expect(mock.update.mock.calls[0][0]).toMatchObject({projectId:'p',requestId:'r1',expectedRevision:4,vmId:'1',expectedCycle:1,earnAppId:'acc1',action:'SENT'});
  expect(mock.request).not.toHaveBeenCalled();expect(mock.receipt).not.toHaveBeenCalled();
});
it('"Tiền đã về N dòng": exact PayPal amount per row (empty, required), fee per row, settle ticked by default',async()=>{
  props.opsOf=(id:string)=>({...ops(id),request:request({id:'r'+id,earnAppId:'acc'+id,email:id+'@example.invalid'})});
  await render();await click('Tiền đã về');
  const a=host.querySelector('[aria-label="Số tiền chính xác trong PayPal An-01 / VM_1"]') as HTMLInputElement;expect(a.value).toBe('');
  expect(button('Tiền đã về 0 dòng')!.disabled).toBe(true);
  const settle=Array.from(host.querySelectorAll('label')).find(l=>l.textContent==='Chốt luôn, phần thiếu là phí')!.querySelector('input')!;expect(settle.checked).toBe(true);
  await change('Số tiền chính xác trong PayPal An-01 / VM_1','9.62');await change('Số tiền chính xác trong PayPal An-01 / VM_2','10');
  expect(host.querySelector('[aria-label="Phí An-01 / VM_1"]')!.textContent).toMatch(/0[,.]38/);
  await click('Tiền đã về 2 dòng');
  expect(mock.receipt).toHaveBeenCalledTimes(2);
  expect(mock.receipt.mock.calls[0][0]).toMatchObject({projectId:'p',requestId:'r1',expectedRequestRevision:4,amount:'9.62',currency:'USD',transactionId:null,settleRemainder:true});
  expect(mock.receipt.mock.calls[1][0]).toMatchObject({requestId:'r2',amount:'10.00'});expect(mock.receipt.mock.calls[1][0]).not.toHaveProperty('settleRemainder');
  expect(mock.receipt.mock.calls[0][0].key).not.toBe(mock.receipt.mock.calls[1][0].key);
});
it('a revision conflict on one receipt row does not stop the next; the failed row keeps its amount and is never sent twice',async()=>{
  mock.receipt.mockRejectedValueOnce(Object.assign(new Error('Yêu cầu vừa được sửa'),{data:{code:'CONFLICT'}}));
  props.opsOf=(id:string)=>({...ops(id),request:request({id:'r'+id,earnAppId:'acc'+id})});
  await render();await click('Tiền đã về');
  await change('Số tiền chính xác trong PayPal An-01 / VM_1','9');await change('Số tiền chính xác trong PayPal An-01 / VM_2','9');
  await click('Tiền đã về 2 dòng');
  expect(mock.receipt).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('Yêu cầu vừa được sửa');expect(host.textContent).toContain('Đã ghi tiền về');
  expect((host.querySelector('[aria-label="Số tiền chính xác trong PayPal An-01 / VM_1"]') as HTMLInputElement).value).toBe('9');
  expect(window.sessionStorage.length).toBe(0);
});
it('does not resubmit a completed receipt when table refresh fails',async()=>{props.vms=[vm('1')];props.onSaved=vi.fn().mockRejectedValue(new Error('refresh lost'));props.opsOf=()=>({...ops('1'),request:request()});await render();await click('Tiền đã về');await change('Số tiền chính xác trong PayPal An-01 / VM_1','6');await click('Tiền đã về 1 dòng');expect(mock.receipt).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('chưa tải lại được bảng');expect(button('Tiền đã về 0 dòng')!.disabled).toBe(true);});
it('a lost receipt answer keeps the exact command; reopening retries it unchanged',async()=>{
  props.vms=[vm('1')];props.opsOf=()=>({...ops('1'),request:request()});mock.receipt.mockRejectedValueOnce(new Error('502'));
  await render();await click('Tiền đã về');await change('Số tiền chính xác trong PayPal An-01 / VM_1','6');await click('Tiền đã về 1 dòng');
  const first=mock.receipt.mock.calls[0][0];expect(host.textContent).toContain('Chưa xác định kết quả');
  await act(async()=>root.unmount());const {createRoot}=await import('react-dom/client');root=createRoot(host);await render();await click('Tiền đã về');
  expect((host.querySelector('[aria-label="Số tiền chính xác trong PayPal An-01 / VM_1"]') as HTMLInputElement).value).toBe('6.00');
  await click('Thử lại lệnh chưa rõ');expect(mock.receipt.mock.calls[1][0]).toEqual(first);expect(window.sessionStorage.length).toBe(0);
});
