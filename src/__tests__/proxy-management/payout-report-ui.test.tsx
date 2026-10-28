// @vitest-environment jsdom
import React,{act} from 'react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {createRoot,type Root} from 'react-dom/client';
const mock=vi.hoisted(()=>({voided:vi.fn(),query:vi.fn(),replace:vi.fn(),params:new URLSearchParams(),board:vi.fn(),receipt:vi.fn(),update:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({replace:mock.replace}),useSearchParams:()=>mock.params}));
vi.mock('next/link',()=>({default:({children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a {...props}>{children}</a>}));
vi.mock('@/components/vm-management/vm-grid/PayoutFrame',()=>({PayoutFrameForVm:()=> <div data-testid="status-editor">Rút về PayPal</div>}));
vi.mock('@/lib/trpc',()=>({trpc:{vmOps:{payoutVoided:{useQuery:mock.voided},payoutReport:{useQuery:mock.query},board:{useQuery:mock.board},updatePayout:{useMutation:()=>({mutateAsync:mock.update})},payoutReceipt:{useMutation:()=>({mutateAsync:mock.receipt})}}}}));
import {PayoutReportWorkspace} from '@/components/business-management/PayoutReportWorkspace';
let root:Root,host:HTMLDivElement;
const report=()=>({rights:{manage:true,markSubmission:true,userId:'u'},total:1,page:1,pages:1,updatedAt:'2026-10-26T08:00:00.000Z',servers:[{id:'s',code:'moon1'}],paypals:[{id:'p',code:'pp-tut32'}],summary:[{currency:'USD',prepared:'16.94',sent:'10.00',waiting:'4.00',received:'6.00',unknown:'0.00'}],rows:[{id:'r',revision:1,current:true,consumed:false,earnAppId:'ea',vmId:'v',serverId:'s',server:'moon1',vm:'VM_001',cycle:1,login:'a@example.invalid',paypalId:'p',paypal:'pp-tut32',email:'receive@example.invalid',requestedAt:'2026-10-26',submittedAt:'2026-10-26T07:00:00Z',amount:'10.00',currency:'USD',received:'6.00',remaining:'4.00',shortfall:null,status:'PARTIAL',reference:'ref-1',receipts:[{id:'f',date:'2026-10-26',amount:'6.00',currency:'USD',status:'RECEIVED',transactionId:'tx-1'}]}]});
beforeEach(()=>{mock.voided.mockReset().mockReturnValue({data:{total:0,page:1,pages:1,money:true,rows:[]},error:null,isLoading:false});vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);mock.params=new URLSearchParams();mock.replace.mockReset();mock.query.mockReset().mockReturnValue({data:report(),isLoading:false,error:null,isFetching:false,refetch:vi.fn()});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=()=>act(async()=>root.render(<PayoutReportWorkspace projectId="project"/>));
it('shows request identity, separate sent/received/open totals and historical VM drilldown',async()=>{await render();expect(host.textContent).toContain('Rút EarnAp');expect(host.textContent).toContain('$16.94');expect(host.textContent).toContain('$6.00');expect(host.textContent).toContain('$4.00');expect(host.textContent).toContain('pp-tut32');expect(host.textContent).toContain('receive@example.invalid');expect(host.querySelector('button[aria-label="Xem yêu cầu moon1 / VM_001"]')).toBeTruthy();});
it('opens one accessible panel with receipts and status actions directly, without expanding the table',async()=>{await render();const before=host.querySelectorAll('tr').length;const button=host.querySelector('button[aria-label="Xem yêu cầu moon1 / VM_001"]') as HTMLButtonElement;expect(button).toBeTruthy();await act(async()=>button.click());const panel=document.querySelector('[role="dialog"]')!;expect(panel).toBeTruthy();expect(panel.textContent).toContain('tx-1');expect(panel.textContent).toContain('a@example.invalid');expect(panel.querySelector('[data-testid="status-editor"]')).toBeTruthy();expect(panel.querySelector('a[href*="vm=v"]')).toBeTruthy();expect(host.querySelectorAll('tr').length).toBe(before);expect(document.body.textContent).not.toContain('Thu gọn');await act(async()=>(panel.querySelector('button[aria-label="Đóng yêu cầu rút"]') as HTMLButtonElement).click());expect(document.querySelector('[role="dialog"]')).toBeNull();});
it('removes an open panel and its money on permission error',async()=>{await render();await act(async()=>(host.querySelector('button[aria-label="Xem yêu cầu moon1 / VM_001"]') as HTMLButtonElement).click());expect(document.querySelector('[role="dialog"]')).toBeTruthy();mock.query.mockReturnValue({data:report(),error:{message:'Không có quyền'},isLoading:false});await render();expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.body.textContent).not.toContain('tx-1');});
it('passes URL filters and changes server without dropping other conditions or retaining old page',async()=>{mock.params=new URLSearchParams('q=receive&status=WAITING&page=3');await render();expect(mock.query.mock.calls[0][0]).toMatchObject({q:'receive',status:'WAITING',page:3});const el=host.querySelector('select[aria-label="Server"]') as HTMLSelectElement;await act(async()=>{el.value='s';el.dispatchEvent(new Event('change',{bubbles:true}));});const target=mock.replace.mock.calls.at(-1)![0] as string;expect(target).toContain('server=s');expect(target).toContain('q=receive');expect(target).toContain('status=WAITING');expect(target).not.toContain('page=3');});
it('hides cached financial data after permission error',async()=>{mock.query.mockReset().mockReturnValue({data:report(),error:{message:'Không có quyền'},isLoading:false});await render();expect(host.textContent).toContain('Không có quyền');expect(host.textContent).not.toContain('receive@example.invalid');expect(host.textContent).not.toContain('$6.00');});
it('empty report does not invent zero receipts or requests',async()=>{mock.query.mockReturnValue({data:{...report(),rows:[],summary:[],total:0},error:null,isLoading:false});await render();expect(host.textContent).toContain('Chưa có yêu cầu rút');});

it('invalid date filters can be cleared without exposing cached money',async()=>{mock.params=new URLSearchParams('from=2026-10-27&to=2026-10-26');mock.query.mockReturnValue({data:report(),error:{message:'Bộ lọc báo cáo rút tiền chưa hợp lệ'},isLoading:false});await render();const reset=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Xoá bộ lọc');expect(reset).toBeTruthy();await act(async()=>reset!.click());expect(mock.replace).toHaveBeenCalledWith('/earnapp-withdrawals',{scroll:false});expect(host.textContent).not.toContain('$6.00');});

it('closes panel when selected row leaves filter and restores focus to page title',async()=>{await render();const button=host.querySelector('button[aria-label="Xem yêu cầu moon1 / VM_001"]') as HTMLButtonElement;await act(async()=>button.click());mock.query.mockReturnValue({data:{...report(),rows:[],total:0},error:null,isLoading:false});await render();await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.activeElement).toBe(host.querySelector('h1'));});

it('daily receipt drilldown shows only receipts on its day, preserving lifetime detail',async()=>{mock.params=new URLSearchParams('view=RECEIVED_TODAY&day=2026-10-26&server=s');const d=report();mock.query.mockReturnValue({data:{...d,focus:{view:'RECEIVED_TODAY',day:'2026-10-26',vms:1,requests:1,amounts:[{currency:'USD',amount:'2.00'}]},summary:[{...d.summary[0],received:'2.00'}],rows:[{...d.rows[0],receivedInView:[{currency:'USD',amount:'2.00'}]}]},error:null});await render();expect(mock.query.mock.calls[0][0]).toMatchObject({view:'RECEIVED_TODAY',day:'2026-10-26',serverId:'s'});expect(host.querySelector('.pr-focus')?.textContent).toContain('$2.00');expect(host.querySelector('.pr-table tbody tr')?.textContent).toContain('$2.00');expect(host.querySelector('.pr-table tbody tr')?.textContent).not.toContain('$6.00');expect(host.querySelector('[aria-label="Ngày yêu cầu từ"]')).toBeNull();expect(host.querySelector('[aria-label="Ngày thực nhận"]')).toBeTruthy();await act(async()=>(host.querySelector('button[aria-label="Xem yêu cầu moon1 / VM_001"]') as HTMLButtonElement).click());expect(document.querySelector('[role="dialog"]')?.textContent).toContain('$6.00');});

it('clears dashboard view without clearing server or other independent filters',async()=>{mock.params=new URLSearchParams('view=WAITING&server=s&paypal=p&q=receive&page=2');mock.query.mockReturnValue({data:{...report(),focus:{view:'WAITING',day:'2026-10-26',vms:1,requests:1,amounts:[{currency:'USD',amount:'4.00'}]}},error:null});await render();const b=host.querySelector<HTMLButtonElement>('[aria-label="Bỏ nhóm từ dashboard"]');expect(b).toBeTruthy();await act(async()=>b!.click());const target=mock.replace.mock.calls.at(-1)![0];expect(target).toContain('server=s');expect(target).toContain('paypal=p');expect(target).toContain('q=receive');expect(target).not.toMatch(/view=|day=|page=/);});

it('selected rows: "Tiền đã về N dòng" opens one bulk panel on the VMs current requests and records the exact PayPal amount',async()=>{
  mock.receipt.mockReset().mockResolvedValue({});
  mock.board.mockReturnValue({data:{rights:{writeMoney:false,payout:false,receipt:true,assign:false,money:true},vms:[{vmId:'v',cycle:1,milestone:'WAITING',merge:null,request:{id:'r',revision:1,cycle:1,earnAppId:'ea',state:'REQUESTED',submission:'SENT',phase:'WAITING',paypal:'pp-tut32',email:'receive@example.invalid',money:{lost:null,amount:'10.00',currency:'USD',received:'6.00',pendingLinked:'0.00',remaining:'4.00',shortfall:null,settleNote:null}}}]},error:null,refetch:vi.fn()});
  await render();
  const box=host.querySelector('input[aria-label="Chọn moon1 / VM_001"]') as HTMLInputElement;expect(box).toBeTruthy();
  await act(async()=>box.click());
  const open=Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Tiền đã về 1 dòng')!;expect(open.disabled).toBe(false);
  expect((Array.from(host.querySelectorAll('button')).find(b=>b.textContent==='Đã rút 0 dòng') as HTMLButtonElement).disabled).toBe(true);
  await act(async()=>open.click());
  const input=document.querySelector('[aria-label="Số tiền chính xác trong PayPal moon1 / VM_001"]') as HTMLInputElement;expect(input).toBeTruthy();
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'3.5');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Tiền đã về 1 dòng' && b.closest('[role="dialog"]')) as HTMLButtonElement).click());
  expect(mock.receipt).toHaveBeenCalledTimes(1);expect(mock.receipt.mock.calls[0][0]).toMatchObject({projectId:'project',requestId:'r',expectedRequestRevision:1,amount:'3.50',settleRemainder:true});
});

it('shows the "Mất do SUS" total per currency only when the report has lost money',async()=>{
  mock.query.mockReturnValue({data:{...report(),lost:{USD:'12.50'}},error:null,isLoading:false});await render();
  const tile=host.querySelector('.pr-total-lost');expect(tile?.textContent).toContain('Mất do SUS');expect(tile?.textContent).toContain('$12.50');
  mock.query.mockReturnValue({data:{...report(),lost:{}},error:null,isLoading:false});await render();
  expect(host.querySelector('.pr-total-lost')).toBeNull();
});
it('"Đã xoá do ghi nhầm" is collapsed with its count and lists the voided requests when opened, on the report server filter',async()=>{
  mock.params=new URLSearchParams('server=s');
  mock.voided.mockReturnValue({data:{total:1,page:1,pages:1,money:true,rows:[{id:'v1',requestId:'r9',vmId:'v',serverId:'s',server:'moon1',vm:'VM_007',cycle:2,paypal:'pp-tut40',email:'x@example.invalid',voidedAt:'2026-10-28T03:00:00.000Z',voidedBy:'Tut',reason:'Ghi nhầm VM',amount:'9.00',currency:'USD'}]},error:null,isLoading:false});
  await render();
  expect(mock.voided.mock.calls[0][0]).toMatchObject({projectId:'project',serverId:'s'});
  const toggle=Array.from(host.querySelectorAll('button')).find(b=>b.textContent?.includes('Đã xoá do ghi nhầm'))!;
  expect(toggle.textContent).toContain('1');expect(toggle.getAttribute('aria-expanded')).toBe('false');expect(host.textContent).not.toContain('VM_007');
  await act(async()=>toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  for(const t of ['VM_007','moon1','pp-tut40','x@example.invalid','Ghi nhầm VM','$9.00','Tut'])expect(host.textContent).toContain(t);
});
