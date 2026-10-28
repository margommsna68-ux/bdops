// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,it,expect,vi} from 'vitest';
// One payout frame (owner 28/10/2026): one-click actions, the exact PayPal amount, and the lost-answer journal. Synthetic ids only.
const mock=vi.hoisted(()=>({update:vi.fn(),void:vi.fn(),receipt:vi.fn(),edit:vi.fn(),unsend:vi.fn(),sus:vi.fn(),request:vi.fn(),pick:vi.fn(),done:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{useContext:()=>({vmOps:{payoutPick:{fetch:mock.pick}}}),vmOps:{
  requestPayout:{useMutation:()=>({mutateAsync:mock.request})},updatePayout:{useMutation:()=>({mutateAsync:mock.update})},editPayout:{useMutation:()=>({mutateAsync:mock.edit})},
  unsendPayout:{useMutation:()=>({mutateAsync:mock.unsend})},voidPayout:{useMutation:()=>({mutateAsync:mock.void})},suspendEarnApp:{useMutation:()=>({mutateAsync:mock.sus})},
  payoutReceipt:{useMutation:()=>({mutateAsync:mock.receipt})},payoutPick:{useQuery:()=>({data:undefined})}}}}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}));
import {PayoutFrame,type VmOpsRequestView} from '@/components/vm-management/vm-grid/PayoutFrame';
let root:Root,host:HTMLDivElement;
const all={assign:true,money:true,writeMoney:true,payout:true,receipt:true};
const request=(o:Partial<VmOpsRequestView>={}):VmOpsRequestView=>({id:'req',revision:3,cycle:2,earnAppId:'ea',state:'REQUESTED',submission:'PREPARING',submittedAt:null,stateNote:null,phase:'WAITING',paypalId:'pp',paypal:'PP1',email:'mail@example.invalid',emailId:'em',requestedAt:'2026-10-28',reference:null,settled:false,
  money:{lost:null,amount:'10.00',currency:'USD',received:'0.00',pendingLinked:'0.00',remaining:'10.00',shortfall:null,settleNote:null},...o});
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);window.sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);
  for(const f of Object.values(mock))f.mockReset().mockResolvedValue({});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=(r:VmOpsRequestView|null,rights=all,extra:Partial<React.ComponentProps<typeof PayoutFrame>>={})=>act(async()=>root.render(<PayoutFrame projectId="p" userId="u" vmId="vm" cycle={2} earnAppId="ea" request={r} rights={rights} onDone={mock.done} {...extra}/>));
const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text);
const click=(text:string)=>act(async()=>button(text)!.click());
async function type(el:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
const identity={projectId:'p',requestId:'req',expectedRevision:3,vmId:'vm',expectedCycle:2,earnAppId:'ea'};

it('PREPARING: email + Copy, "Đã rút" sends SENT at once (no evidence checkbox), then refreshes',async()=>{
  await render(request());
  expect(host.textContent).toContain('Đang rút, chưa xác nhận');expect(host.textContent).toContain('mail@example.invalid');
  expect(host.querySelector('button[aria-label="Copy email mail@example.invalid"]')).toBeTruthy();
  expect(['Đã rút','Bỏ','Sửa','EarnApp bị SUS'].every(t=>!!button(t))).toBe(true);expect(button('Tiền đã về')).toBeUndefined();
  expect(host.querySelector('input[type=checkbox]')).toBeNull();
  await click('Đã rút');
  expect(mock.update).toHaveBeenCalledTimes(1);expect(mock.update.mock.calls[0][0]).toMatchObject({...identity,action:'SENT'});
  expect(typeof mock.update.mock.calls[0][0].key).toBe('string');expect(mock.done).toHaveBeenCalledTimes(1);
  expect(window.sessionStorage.length).toBe(0);
});
it('"Bỏ" removes the unsent request with the fixed reason',async()=>{
  await render(request());await click('Bỏ');
  expect(mock.void.mock.calls[0][0]).toMatchObject({...identity,reason:'Bỏ trước khi rút'});
});
it('a lost answer keeps key + body in the tab; after reopening, "Thử lại đúng lệnh" sends exactly the same command',async()=>{
  mock.update.mockRejectedValueOnce(new Error('Mất kết nối'));
  await render(request());await click('Đã rút');
  const first=mock.update.mock.calls[0][0];expect(host.textContent).toContain('Chưa xác định kết quả');expect(button('Đã rút')!.disabled).toBe(true);
  await act(async()=>root.render(<div/>));await render(request());
  expect(host.textContent).toContain('chưa rõ kết quả');await click('Thử lại đúng lệnh');
  expect(mock.update.mock.calls[1][0]).toEqual(first);expect(mock.done).toHaveBeenCalledTimes(1);expect(window.sessionStorage.length).toBe(0);
});
it('a definite refusal of a first send records nothing and keeps no command; a refused retry keeps the uncertain one',async()=>{
  mock.update.mockRejectedValueOnce(Object.assign(new Error('Yêu cầu vừa được sửa'),{data:{code:'CONFLICT'}}));
  await render(request());await click('Đã rút');
  expect(window.sessionStorage.length).toBe(0);expect(button('Thử lại đúng lệnh')).toBeUndefined();
  mock.update.mockRejectedValueOnce(new Error('Mất kết nối')).mockRejectedValueOnce(Object.assign(new Error('Bị thu hồi quyền'),{data:{code:'FORBIDDEN'}}));
  await click('Đã rút');const first=mock.update.mock.calls[1][0];await click('Thử lại đúng lệnh');
  expect(window.sessionStorage.length).toBe(1);await click('Thử lại đúng lệnh');expect(mock.update.mock.calls[3][0]).toEqual(first);
});
it('"Tiền đã về": empty required exact amount, live fee, settle ticked by default → one receipt command with settleRemainder',async()=>{
  await render(request({submission:'SENT'}));
  expect(['Tiền đã về','Sửa','Bỏ "Đã rút"','EarnApp bị SUS','Thất bại'].every(t=>!!button(t))).toBe(true);
  await click('Tiền đã về');
  const input=Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.startsWith('Số tiền chính xác trong PayPal'))!.querySelector('input')!;
  expect(input.value).toBe('');expect(button('Ghi tiền đã về')!.disabled).toBe(true);
  await type(input,'9,62');
  expect(host.textContent).toMatch(/Phí \(rút − thực nhận\): \$0[,.]38/);
  const settle=Array.from(host.querySelectorAll('label')).find(l=>l.textContent==='Chốt luôn, phần thiếu là phí')!.querySelector('input')!;expect(settle.checked).toBe(true);
  await click('Ghi tiền đã về');
  expect(mock.receipt.mock.calls[0][0]).toMatchObject({projectId:'p',requestId:'req',expectedRequestRevision:3,amount:'9.62',currency:'USD',transactionId:null,settleRemainder:true});
});
it('the receipt right alone: Tiền đã về and its settle box, never Sửa / Bỏ "Đã rút" / Thất bại',async()=>{
  await render(request({submission:'SENT'}),{assign:false,money:true,writeMoney:false,payout:false,receipt:true});
  expect(button('Tiền đã về')).toBeTruthy();for(const t of ['Sửa','Bỏ "Đã rút"','Thất bại','EarnApp bị SUS','Gửi lại'])expect(button(t)).toBeUndefined();
  await click('Tiền đã về');await type(Array.from(host.querySelectorAll('label')).find(l=>l.textContent?.startsWith('Số tiền chính xác'))!.querySelector('input')!,'5');
  expect(host.textContent).toContain('Chốt luôn, phần thiếu là phí');
});
it('"Thất bại" needs a note; SUS asks for a short note and sends the VM round',async()=>{
  await render(request({submission:'SENT'}),all,{vmRevision:7});
  await click('Thất bại');expect(button('Ghi thất bại')!.disabled).toBe(true);
  await act(async()=>{const t=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(t,'EarnApp từ chối');t.dispatchEvent(new Event('input',{bubbles:true}));});
  await click('Ghi thất bại');expect(mock.update.mock.calls[0][0]).toMatchObject({...identity,action:'FAILED',note:'EarnApp từ chối'});
  await click('EarnApp bị SUS');await click('Ghi EarnApp bị SUS');
  expect(mock.sus.mock.calls[0][0]).toMatchObject({projectId:'p',vmId:'vm',expectedCycle:2,expectedVmRevision:7});
});
it('no request: "Rút" picks the suggestion and holds it as PREPARING with the Tiền VM amount cut to cents',async()=>{
  mock.pick.mockResolvedValue({earnApp:{id:'ea',emailId:null},paypals:[{id:'pp',code:'PP1',usable:true,emails:[{id:'e1',email:'a@example.invalid',own:false,dailyAllowed:true,dailyOccupied:false}]}],suggestion:{paypalId:'pp',why:'x'}});
  await render(null,all,{vmMoney:'12.349'});
  expect((host.querySelector('input[aria-label="Số tiền rút"]') as HTMLInputElement).value).toBe('12.34');
  await click('Rút');
  expect(mock.pick.mock.calls[0][0]).toMatchObject({projectId:'p',vmId:'vm',amount:'12.34'});
  expect(mock.request.mock.calls[0][0]).toMatchObject({projectId:'p',vmId:'vm',expectedCycle:2,earnAppId:'ea',paypalEmailId:'e1',amount:'12.34',currency:'USD',submission:'PREPARING'});
});
it('FAILED: only "Gửi lại"; a merged member is read-only',async()=>{
  await render(request({submission:'SENT',state:'FAILED',phase:'FAILED'}));
  expect(Array.from(host.querySelectorAll('button')).map(b=>b.textContent).filter(t=>t!=='Copy')).toEqual(['Gửi lại']);
  await render(request(),all,{readOnly:'Đã gộp vào VM chính'});
  expect(button('Đã rút')).toBeUndefined();expect(host.textContent).toContain('Đã gộp vào VM chính');
});
it('a short receipt already in: "Chốt nhận thiếu" (money write, note required) sends SETTLE on the same request',async()=>{
  const short=request({submission:'SENT',money:{lost:null,amount:'10.00',currency:'USD',received:'4.00',pendingLinked:'0.00',remaining:'6.00',shortfall:null,settleNote:null}});
  await render(short);
  expect(['Tiền đã về','Chốt nhận thiếu','EarnApp bị SUS'].every(t=>!!button(t))).toBe(true);for(const t of ['Sửa','Thất bại','Bỏ "Đã rút"'])expect(button(t)).toBeUndefined();
  await click('Chốt nhận thiếu');const go=()=>Array.from(host.querySelectorAll('button')).filter(b=>b.textContent==='Chốt nhận thiếu').at(-1)!;
  expect(go().disabled).toBe(true);
  await act(async()=>{const t=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(t,'Phí PayPal');t.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>go().click());
  expect(mock.update.mock.calls[0][0]).toMatchObject({...identity,action:'SETTLE',note:'Phí PayPal'});
  await render(short,{assign:false,money:true,writeMoney:false,payout:true,receipt:true});expect(button('Chốt nhận thiếu')).toBeUndefined();
});
it('REVIEW: a reconcile hint and only "Thất bại"',async()=>{
  await render(request({submission:'SENT',phase:'REVIEW'}));
  expect(host.textContent).toContain('Cần đối chiếu tiền về ở Kho tài khoản / Tiền vào PayPal');
  expect(Array.from(host.querySelectorAll('button')).map(b=>b.textContent).filter(t=>t!=='Copy')).toEqual(['Thất bại']);
});
it('a refused retry offers "Bỏ lệnh chưa rõ (đã đối chiếu)"; only a confirmed drop clears the command and unlocks the frame',async()=>{
  mock.update.mockRejectedValueOnce(new Error('Mất kết nối')).mockRejectedValueOnce(Object.assign(new Error('Yêu cầu vừa được sửa'),{data:{code:'CONFLICT'}}));
  await render(request());await click('Đã rút');
  expect(button('Bỏ lệnh chưa rõ (đã đối chiếu)')).toBeUndefined(); // still unknown: no drop
  await click('Thử lại đúng lệnh');
  expect(button('Bỏ lệnh chưa rõ (đã đối chiếu)')).toBeTruthy();expect(button('Đã rút')!.disabled).toBe(true);
  const confirm=vi.spyOn(window,'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  await click('Bỏ lệnh chưa rõ (đã đối chiếu)');expect(window.sessionStorage.length).toBe(1);
  await click('Bỏ lệnh chưa rõ (đã đối chiếu)');expect(confirm).toHaveBeenCalledTimes(2);
  expect(window.sessionStorage.length).toBe(0);expect(button('Thử lại đúng lệnh')).toBeUndefined();expect(button('Đã rút')!.disabled).toBe(false);
});
it('no signed-in user yet: no mutating action and no journal',async()=>{
  await act(async()=>root.render(<PayoutFrame projectId="p" vmId="vm" cycle={2} earnAppId="ea" request={request()} rights={all} onDone={mock.done}/>));
  expect(button('Đã rút')).toBeUndefined();
  await act(async()=>root.render(<PayoutFrame projectId="p" vmId="vm" cycle={2} earnAppId="ea" request={null} rights={all} onDone={mock.done}/>));
  expect(button('Rút')).toBeUndefined();expect(host.textContent).toContain('Đang tải phiên đăng nhập');
});
it('the "Rút" amount follows the latest Tiền VM until the person edits it',async()=>{
  await render(null,all,{vmMoney:'5'});const input=()=>host.querySelector('input[aria-label="Số tiền rút"]') as HTMLInputElement;
  expect(input().value).toBe('5.00');await render(null,all,{vmMoney:'7.129'});expect(input().value).toBe('7.12');
  await type(input(),'6');await render(null,all,{vmMoney:'9'});expect(input().value).toBe('6');
});
