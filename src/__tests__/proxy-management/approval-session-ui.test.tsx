// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,it,expect,vi} from 'vitest';
// Phê duyệt (28/10/2026): "Phiên duyệt" block — open sessions, "Khóa phiên ngay" (confirm, no 2FA), "Mở phiên 15 phút" (token + own
// TOTP), "Duyệt tất cả đang chờ" (one TOTP). Synthetic ids only.
const mock=vi.hoisted(()=>({sessions:vi.fn(),open:vi.fn(),close:vi.fn(),all:vi.fn(),invalidate:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{useUtils:()=>({opsApproval:{invalidate:mock.invalidate}}),opsApproval:{sessions:{useQuery:(...a:unknown[])=>mock.sessions(...a)},
  openSession:{useMutation:()=>({mutateAsync:mock.open,isLoading:false})},closeSession:{useMutation:()=>({mutateAsync:mock.close,isLoading:false})},approveAll:{useMutation:()=>({mutateAsync:mock.all,isLoading:false})}}}}));
import {ApprovalSessionBlock} from '@/components/approvals/ApprovalSessionBlock';
let root:Root,host:HTMLDivElement;
const NOW=new Date('2026-10-28T03:00:00.000Z').getTime();
const data=(sessions=[{id:'s1',tokenId:'t1',token:'AI codex (mth_abc)',approvedBy:'Tut',via:'WEB',openedAt:'2026-10-28T02:55:00.000Z',expiresAt:'2026-10-28T03:10:00.000Z'}])=>({sessions,tokens:[{id:'t1',name:'AI codex',prefix:'mth_abc',user:'codexcli'},{id:'t2',name:'Apple',prefix:'mth_xyz',user:'apple'}]});
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(NOW);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  for(const f of Object.values(mock))f.mockReset();mock.sessions.mockReturnValue({data:data(),error:null,isLoading:false});
  mock.open.mockResolvedValue({sessionId:'s2',expiresAt:'2026-10-28T03:15:00.000Z',approvedPending:2});mock.close.mockResolvedValue({closed:1});mock.all.mockResolvedValue({approved:3});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
const render=(pending=3)=>act(async()=>root.render(<ApprovalSessionBlock projectId="p" pending={pending}/>));
const btn=(text:string,scope:ParentNode=document)=>Array.from(scope.querySelectorAll('button')).find(b=>b.textContent===text) as HTMLButtonElement|undefined;
const click=(text:string)=>act(async()=>{const b=btn(text);expect(b,text).toBeTruthy();b!.click();});
const type=(el:HTMLInputElement|HTMLSelectElement,value:string)=>act(async()=>{const proto=el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new Event(el instanceof HTMLSelectElement?'change':'input',{bubbles:true}));});
const hhmm=(iso:string)=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));
it('lists open sessions with token, opener, end time and minutes left, refreshing on its own',async()=>{
  await render();const t=host.textContent!;
  expect(t).toContain('Phiên duyệt');expect(t).toContain('AI codex (mth_abc)');expect(t).toContain('Tut');
  expect(t).toContain('hết hạn lúc '+hhmm('2026-10-28T03:10:00.000Z'));expect(t).toContain('còn 10 phút');expect(btn('Khóa mọi phiên')).toBeUndefined();
  expect(mock.sessions.mock.calls[0][0]).toEqual({projectId:'p'});expect(mock.sessions.mock.calls[0][1]).toMatchObject({refetchInterval:expect.any(Number)});
});
it('no session: says so, still offers "Mở phiên 15 phút"',async()=>{
  mock.sessions.mockReturnValue({data:data([]),error:null,isLoading:false});await render();
  expect(host.textContent).toContain('Không có phiên duyệt nào đang mở');expect(btn('Khóa phiên ngay')).toBeUndefined();expect(btn('Mở phiên 15 phút')).toBeTruthy();
});
it('"Khóa phiên ngay" asks first, then closes that session without a code',async()=>{
  await render();await click('Khóa phiên ngay');expect(mock.close).not.toHaveBeenCalled();
  const dialog=document.querySelector('[role="dialog"]')!;expect(dialog.textContent).toContain('AI codex (mth_abc)');expect(dialog.querySelector('input')).toBeNull();
  await act(async()=>btn('Khóa phiên',dialog)!.click());
  expect(mock.close).toHaveBeenCalledWith({projectId:'p',sessionId:'s1'});expect(mock.invalidate).toHaveBeenCalled();
});
it('"Khóa mọi phiên" closes every session of the project after confirming',async()=>{
  const d=data();mock.sessions.mockReturnValue({data:{...d,sessions:[...d.sessions,{...d.sessions[0],id:'s2',tokenId:'t2',token:'Apple (mth_xyz)'}]},error:null,isLoading:false});
  await render();expect(btn('Khóa mọi phiên')).toBeTruthy();expect(Array.from(host.querySelectorAll('button')).filter(b=>b.textContent==='Khóa phiên ngay')).toHaveLength(2);
  await click('Khóa mọi phiên');const dialog=document.querySelector('[role="dialog"]')!;expect(dialog.textContent).toContain('mọi phiên');
  await act(async()=>btn('Khóa mọi phiên',dialog)!.click());expect(mock.close).toHaveBeenCalledWith({projectId:'p'});
});
it('"Mở phiên 15 phút": pick a token, type the own code, shows the result',async()=>{
  await render();await click('Mở phiên 15 phút');const dialog=document.querySelector('[role="dialog"]')!;
  const select=dialog.querySelector('select') as HTMLSelectElement;expect(Array.from(select.options).map(o=>o.textContent)).toEqual(expect.arrayContaining(['AI codex (mth_abc) · codexcli','Apple (mth_xyz) · apple']));
  const submit=()=>btn('Mở phiên',dialog)!;expect(submit().disabled).toBe(true);
  await type(select,'t2');await type(dialog.querySelector('input') as HTMLInputElement,'123456');expect(submit().disabled).toBe(false);
  await act(async()=>submit().click());
  expect(mock.open).toHaveBeenCalledWith({projectId:'p',tokenId:'t2',code:'123456'});
  expect(host.textContent).toContain('Đã mở phiên đến '+hhmm('2026-10-28T03:15:00.000Z'));expect(host.textContent).toContain('2 lệnh');
});
it('a wrong code keeps the dialog open with the message and clears the code',async()=>{
  mock.open.mockRejectedValue(new Error('Mã không đúng'));await render();await click('Mở phiên 15 phút');const dialog=document.querySelector('[role="dialog"]')!;
  await type(dialog.querySelector('select') as HTMLSelectElement,'t1');const code=dialog.querySelector('input') as HTMLInputElement;await type(code,'654321');
  await act(async()=>btn('Mở phiên',dialog)!.click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Mã không đúng');expect((document.querySelector('[role="dialog"] input') as HTMLInputElement).value).toBe('');
});
it('"Duyệt tất cả đang chờ" with one code shows how many were approved; disabled with nothing waiting',async()=>{
  await render(3);await click('Duyệt tất cả đang chờ (3)');const dialog=document.querySelector('[role="dialog"]')!;
  await type(dialog.querySelector('input') as HTMLInputElement,'111222');await act(async()=>btn('Duyệt tất cả',dialog)!.click());
  expect(mock.all).toHaveBeenCalledWith({projectId:'p',code:'111222'});expect(host.textContent).toContain('Đã duyệt 3 lệnh');
  await render(0);expect(btn('Duyệt tất cả đang chờ')!.disabled).toBe(true);
});
