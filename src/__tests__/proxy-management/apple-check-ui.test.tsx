import React,{act} from 'react';
import type {Root} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({overview:vi.fn(),request:vi.fn(),batch:vi.fn(),cancel:vi.fn(),configure:vi.fn(),disable:vi.fn(),invalidate:vi.fn(),reset:vi.fn(),unlocked:true}));
vi.mock('@/lib/trpc',()=>({trpc:{useUtils:()=>({appleCheck:{overview:{invalidate:mock.invalidate}},accountStore:{invalidate:mock.invalidate}}),user:{securityStatus:{useQuery:()=>({data:{unlocked:mock.unlocked,totpEnabled:true}})}},appleCheck:{overview:{useQuery:mock.overview},request:{useMutation:()=>({mutateAsync:mock.request,isLoading:false})},requestBatch:{useMutation:()=>({mutateAsync:mock.batch})},cancel:{useMutation:()=>({mutateAsync:mock.cancel,isLoading:false})},configure:{useMutation:()=>({mutateAsync:mock.configure,isLoading:false,reset:mock.reset})},disable:{useMutation:()=>({mutateAsync:mock.disable,isLoading:false})}}}}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}));
import {AppleCheckProvider,AppleCheck,AppleCheckConfiguration} from '@/components/account-store/AppleCheck';
const job={id:'job-1',accountId:'apple',accountRevision:3,phase:'QUEUED',result:null as string|null,reasonCode:null as string|null,cleanup:null as string|null,createdAt:'2026-10-25T02:00:00Z',observedAt:null as string|null,stale:false,cancelRequested:false};
let data:{canManage:boolean;canCheck:boolean;groups:{id:string;name:string}[];worker:null|{id:string;name:string;enabled:boolean;online:boolean;state:string;proxyGroupId:string;lastSeenAt:string|null};jobs:typeof job[]};
let dom:JSDOM,root:Root,host:HTMLDivElement;
beforeEach(async()=>{
  vi.clearAllMocks();mock.unlocked=true;
  dom=new JSDOM('<html><body></body></html>',{url:'https://example.invalid'});
  for(const [key,value] of Object.entries({React,window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true}))vi.stubGlobal(key,value);
  Object.defineProperty(navigator,'clipboard',{value:{writeText:vi.fn().mockResolvedValue(undefined)},configurable:true});
  host=document.createElement('div');document.body.append(host);root=(await import('react-dom/client')).createRoot(host);
  data={canManage:true,canCheck:true,groups:[{id:'dedicated',name:'Apple riêng'}],worker:{id:'w',name:'Central',enabled:true,online:true,state:'IDLE',proxyGroupId:'dedicated',lastSeenAt:null},jobs:[]};
  mock.overview.mockImplementation(()=>({data}));mock.request.mockResolvedValue(job);mock.cancel.mockResolvedValue({...job,cancelRequested:true});mock.configure.mockResolvedValue({workerId:'w',token:'one-time-worker-secret'});
});
afterEach(async()=>{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals();});
async function render(projectId='p'){await act(async()=>root.render(<AppleCheckProvider projectId={projectId}><AppleCheckConfiguration/><AppleCheck accountId="apple" revision={3}/><AppleCheck accountId="apple-2" revision={4}/></AppleCheckProvider>));}
const button=(text:string)=>{const b=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text);if(!b)throw Error('Missing button '+text);return b;};
async function click(el:HTMLElement){await act(async()=>el.click());}
it('shows an explicit unchecked state until a job is recorded',async()=>{
  await render();expect(host.querySelector('[aria-label="Check Apple ID"]')?.textContent).toContain('Chưa kiểm tra');
  await click(button('Check Apple ID'));expect(host.querySelector('[aria-label="Check Apple ID"]')?.textContent).not.toContain('Chưa kiểm tra');
});
it('shares overview polling and sends the account revision once despite rapid clicks',async()=>{
  await render();expect(mock.overview).toHaveBeenCalledWith({projectId:'p'},expect.objectContaining({refetchInterval:5000}));expect(mock.overview).toHaveBeenCalledTimes(1);
  const b=button('Check Apple ID');await act(async()=>{b.click();b.click();});
  expect(mock.request).toHaveBeenCalledTimes(1);expect(mock.request.mock.calls[0][0]).toMatchObject({projectId:'p',accountId:'apple',expectedRevision:3,key:expect.any(String)});
  expect(host.textContent).toContain('Đang chờ');expect(b.disabled).toBe(true);
});
it('keeps the same request key after a lost response and never retries automatically',async()=>{
  mock.request.mockRejectedValueOnce(Error('Lost answer'));await render();await click(button('Check Apple ID'));expect(mock.request).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Chưa rõ');
  await click(button('Gửi lại yêu cầu'));expect(mock.request.mock.calls[1][0]).toEqual(mock.request.mock.calls[0][0]);
});
it('refreshes a rejected stale revision without trapping the row in an uncertain retry',async()=>{
  mock.request.mockRejectedValueOnce({data:{code:'CONFLICT'}});await render();await click(button('Check Apple ID'));
  expect(host.textContent).toContain('Yêu cầu bị từ chối');expect(mock.invalidate).toHaveBeenCalled();expect(Array.from(host.querySelectorAll('button')).some(b=>b.textContent==='Gửi lại yêu cầu')).toBe(false);
  await click(button('Check Apple ID'));expect(mock.request.mock.calls[1][0].key).not.toBe(mock.request.mock.calls[0][0].key);
});
it('shows unknown and stale history separately and allows cancellation only for active jobs',async()=>{
  data.jobs=[{...job,phase:'FINISHED',result:'UNKNOWN',stale:true},{...job,id:'job-2',createdAt:'2026-10-25T03:00:00Z',phase:'SUBMITTING'}];await render();
  await click(button('Lịch sử check (2)'));expect(host.textContent).toContain('Chưa rõ kết quả');expect(host.textContent).toContain('Phiên bản cũ');expect(host.querySelectorAll('time')).toHaveLength(3);
  await click(button('Huỷ check'));expect(mock.cancel).toHaveBeenCalledWith({projectId:'p',jobId:'job-2'});expect(host.textContent).toContain('Đang chờ huỷ');
});
it.each([
  {online:false,state:'OFFLINE',message:'Worker ngoại tuyến',progress:'Đang chờ máy'},
  {online:true,state:'WAITING_DESKTOP',message:'Worker chờ desktop',progress:'Đang chờ máy'},
  {online:true,state:'WAITING_RESOURCES',message:'Worker chờ tài nguyên',progress:'Đang chờ tài nguyên'},
])('queues a check while an enabled worker is $state',async({online,state,message,progress})=>{
  Object.assign(data.worker!,{online,state});await render();expect(button('Check Apple ID').disabled).toBe(false);expect(host.textContent).toContain(message);expect(host.textContent).not.toContain(state);
  await click(button('Check Apple ID'));expect(mock.request).toHaveBeenCalledWith(expect.objectContaining({projectId:'p',accountId:'apple',expectedRevision:3}));expect(host.textContent).toContain(progress);expect(button('Check Apple ID').disabled).toBe(true);
});
it('blocks disabled or quarantined workers and respects check permissions',async()=>{
  data.worker!.enabled=false;await render();expect(button('Check Apple ID').disabled).toBe(true);
  data.worker!.enabled=true;data.worker!.state='CLEANUP_FAILED';await render();expect(button('Check Apple ID').disabled).toBe(true);
  data.canCheck=false;data.canManage=false;await render();expect(host.querySelector('button')).toBeNull();
});
it('marks the latest stale outcome as needing another check',async()=>{
  data.jobs=[{...job,phase:'DONE',result:'LOGIN_SUCCESS',cleanup:'OK',stale:true}];await render();
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Cần kiểm tra lại · kết quả phiên bản cũ');
});
it.each([
  ['LOGIN_SUCCESS','Live đăng nhập'],
  ['LIVE_2FA','Live · yêu cầu 2FA'],
  ['APPLE_LOCKED','Locked'],
  ['INVALID_CREDENTIALS','Sai mật khẩu'],
  ['CHALLENGE_REQUIRED','Cần xác minh · đã dừng'],
])('displays the distinct %s outcome in the cell and history',async(result,label)=>{
  data.jobs=[{...job,phase:'DONE',result,reasonCode:result,cleanup:'OK'}];await render();
  expect(host.querySelector('[role="status"] > span')?.textContent).toBe(label);
  if(['LIVE_2FA','LOGIN_SUCCESS'].includes(result))expect(host.querySelector('[role="status"] > span')?.className).toMatch(/green/);
  else expect(host.querySelector('[role="status"]')?.textContent).not.toContain('Live');
  await click(button('Lịch sử check (1)'));expect(host.querySelector('ol')?.textContent).toContain(label);
});
it.each(['LOGIN_SUCCESS','LIVE_2FA'])('keeps stale %s out of the current Live status and green pill',async(result)=>{
  data.jobs=[{...job,phase:'DONE',result,reasonCode:result,cleanup:'OK',stale:true}];await render();
  const status=host.querySelector('[role="status"]')!;expect(status.querySelector('span')?.textContent).toBe('Cần kiểm tra lại · kết quả phiên bản cũ');expect(status.textContent).not.toContain('Live');expect(status.querySelector('[class*="green"]')).toBeNull();
  await click(button('Lịch sử check (1)'));expect(host.querySelector('ol')?.textContent).toContain('Phiên bản cũ (chỉ lịch sử)');
});
it.each([
  ['EMAIL_FORM_MISSING','Không tìm thấy ô email'],
  ['PASSWORD_FORM_MISSING','Không tìm thấy ô mật khẩu'],
  ['SUBMIT_BUTTON_MISSING','Không tìm thấy nút đăng nhập'],
  ['RESPONSE_UNRECOGNIZED','Không nhận diện được phản hồi'],
  ['BROWSER_INTERRUPTED','Trình duyệt bị gián đoạn'],
  ['CREDENTIAL_DELIVERY_FAILED','Không nhận được thông tin đăng nhập'],
  ['EMAIL_ENTRY_FAILED','Không hoàn tất bước nhập email'],
  ['PASSWORD_SUBMIT_FAILED','Không gửi được bước mật khẩu'],
  ['RESPONSE_READ_FAILED','Không đọc được phản hồi Apple'],
])('explains UNKNOWN %s without implying a live account',async(reasonCode,label)=>{
  data.jobs=[{...job,phase:'DONE',result:'UNKNOWN',reasonCode,cleanup:'OK'}];await render();
  const status=host.querySelector('[role="status"]')!;
  expect(status.textContent).toContain('Chưa rõ kết quả');expect(status.textContent).toContain(label);expect(status.textContent).not.toContain('Live');
  await click(button('Lịch sử check (1)'));expect(host.querySelector('ol')?.textContent).toContain(label);
});
it('clears accepted jobs and request keys when the provider project prop changes',async()=>{
  await render();await click(button('Check Apple ID'));expect(host.textContent).toContain('Lịch sử check (1)');const firstKey=mock.request.mock.calls[0][0].key;
  await render('next');expect(host.textContent).not.toContain('Lịch sử check');expect(button('Check Apple ID').disabled).toBe(false);
  mock.request.mockRejectedValueOnce(Error('Lost response'));await click(button('Check Apple ID'));expect(host.textContent).toContain('Gửi lại yêu cầu');expect(mock.request.mock.calls[1][0]).toMatchObject({projectId:'next'});expect(mock.request.mock.calls[1][0].key).not.toBe(firstKey);
  await render('third');expect(host.textContent).not.toContain('Gửi lại yêu cầu');expect(host.textContent).not.toContain('Chưa rõ yêu cầu');
  await click(button('Check Apple ID'));expect(mock.request.mock.calls[2][0]).toMatchObject({projectId:'third'});expect(mock.request.mock.calls[2][0].key).not.toBe(mock.request.mock.calls[1][0].key);
});
it('drops an old project response and permits a new project request while it is pending',async()=>{
  let resolve:(value:typeof job)=>void=()=>{};mock.request.mockReturnValueOnce(new Promise<typeof job>(r=>{resolve=r;}));await render();await click(button('Check Apple ID'));
  await render('next');expect(host.textContent).not.toContain('Đang gửi…');expect(button('Check Apple ID').disabled).toBe(false);await click(button('Check Apple ID'));expect(mock.request.mock.calls[1][0]).toMatchObject({projectId:'next',accountId:'apple'});
  await act(async()=>resolve({...job,id:'old-job',phase:'DONE',result:'UNKNOWN',cleanup:'OK'}));expect(host.textContent).not.toContain('Chưa rõ kết quả');expect(host.textContent).toContain('Lịch sử check (1)');
});
it('keeps a completed login with failed cleanup unavailable for another submission',async()=>{
  data.jobs=[{...job,phase:'DONE',result:'LOGIN_SUCCESS',cleanup:'FAILED'}];await render();expect(button('Check Apple ID').disabled).toBe(true);
  await click(button('Lịch sử check (1)'));expect(host.textContent).toContain('Live đăng nhập');expect(host.textContent).toContain('Thất bại');expect(host.textContent).toContain('Tiến trình: Đã kết thúc');
});
it('uses the cancel response immediately when the queued job is already cancelled',async()=>{
  data.jobs=[{...job}];mock.cancel.mockResolvedValue({...job,phase:'DONE',result:'CANCELLED',cleanup:'OK',cancelRequested:true});await render();await click(button('Lịch sử check (1)'));await click(button('Huỷ check'));
  expect(host.textContent).toContain('Đã huỷ');expect(host.textContent).not.toContain('Đang chờ huỷ');
});
it('configures a custom group and holds the token once in memory until hidden or security locks',async()=>{
  await render();const summary=host.querySelector('summary')!;await click(summary);
  const input=host.querySelector('input')!;await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,'moon-01');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  const select=host.querySelector('select')!;await act(async()=>{select.value='dedicated';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await click(button('Lưu cấu hình / tạo token'));expect(mock.configure).toHaveBeenCalledWith({projectId:'p',name:'moon-01',proxyGroupId:'dedicated'});
  expect(host.textContent).toContain('one-time-worker-secret');expect(mock.reset).toHaveBeenCalled();await click(button('Copy token'));expect(navigator.clipboard.writeText).toHaveBeenCalledWith('one-time-worker-secret');
  mock.unlocked=false;await render();expect(host.textContent).not.toContain('one-time-worker-secret');mock.unlocked=true;await render();expect(host.textContent).not.toContain('one-time-worker-secret');
  expect(localStorageAvailable()).toBe(false);
});
it('allows configuring the built-in TUT pool without any custom proxy groups',async()=>{
  data.groups=[{id:'TUT',name:'TUT · proxy NEW chưa gán'}];data.worker!.proxyGroupId='TUT';await render();await click(host.querySelector('summary')!);
  const selector=Array.from(host.querySelectorAll('label')).find(label=>label.textContent?.startsWith('Nhóm proxy cho phép kiểm tra'))?.querySelector('select');
  expect(selector?.value).toBe('TUT');await click(button('Lưu cấu hình / tạo token'));
  expect(mock.configure).toHaveBeenCalledWith({projectId:'p',name:'Central',proxyGroupId:'TUT'});
});
it('hides a saved token, clears it across projects, and disables the worker through the scoped command',async()=>{
  await render();await click(host.querySelector('summary')!);await click(button('Lưu cấu hình / tạo token'));
  expect(host.textContent).toContain('one-time-worker-secret');await click(button('Đã lưu · Ẩn token'));expect(host.textContent).not.toContain('one-time-worker-secret');
  await click(button('Lưu cấu hình / tạo token'));expect(host.textContent).toContain('one-time-worker-secret');await render('another-project');expect(host.textContent).not.toContain('one-time-worker-secret');
  await click(button('Tắt worker'));expect(mock.disable).toHaveBeenCalledWith({projectId:'another-project'});
});
it('drops a late configuration token after the configuration panel has closed',async()=>{
  let resolve:(value:{workerId:string;token:string})=>void=()=>{};
  mock.configure.mockReturnValue(new Promise<{workerId:string;token:string}>(r=>{resolve=r;}));await render();await click(host.querySelector('summary')!);await click(button('Lưu cấu hình / tạo token'));
  const details=host.querySelector('details')!;await act(async()=>{details.open=false;details.dispatchEvent(new dom.window.Event('toggle'));});
  await act(async()=>resolve({workerId:'w',token:'late-secret'}));expect(host.textContent).not.toContain('late-secret');expect(localStorageAvailable()).toBe(false);
});
it('fails closed on overview errors while retaining non-secret history',async()=>{
  data.jobs=[{...job,phase:'DONE',result:'APPLE_LOCKED',cleanup:'OK'}];mock.overview.mockImplementation(()=>({data,error:Error('Network unavailable')}));await render();
  expect(button('Check Apple ID').disabled).toBe(true);expect(host.textContent).toContain('Locked');expect(host.textContent).toContain('Không tải được trạng thái');
  expect(button('Lưu cấu hình / tạo token').disabled).toBe(true);
});
function localStorageAvailable(){return window.localStorage.length>0||window.sessionStorage.length>0;}
