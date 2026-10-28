// @vitest-environment jsdom
import React,{act} from 'react';import {createRoot,type Root} from 'react-dom/client';import {beforeEach,afterEach,it,expect,vi} from 'vitest';
// "Chờ tạo lại" (owner 28/10/2026): "Tạo lại N VM" across servers behind one confirmation per server; fleet RECREATE_VM for enrolled
// servers, manual for the rest; "Ghi nhận đã tạo lại N VM" one vmOps.recreate per VM. Synthetic ids only.
const mock=vi.hoisted(()=>({servers:vi.fn(),control:vi.fn(),create:vi.fn(),recreate:vi.fn(),saved:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{useContext:()=>({fleetCommands:{control:{fetch:mock.control}}}),
  fleetCommands:{servers:{useQuery:()=>mock.servers()},create:{useMutation:()=>({mutateAsync:mock.create})}},
  vmOps:{recreate:{useMutation:()=>({mutateAsync:mock.recreate})}}}}));
import {RecreateBulkPanel} from '@/components/vm-management/vm-grid/RecreateBulkPanel';
let root:Root,host:HTMLDivElement;
const UUID='3aa28db5-f9bb-4c99-b70e-ff64941eb090';
const vm=(id:string,serverId:string,server:string)=>({id,code:'VM_'+id,server,serverId,revision:1,sdks:[]}) as never;
const vms=[vm('1','s1','MOON-01'),vm('2','s1','MOON-01'),vm('3','s2','MOON-02'),vm('4','s3','VT-01'),vm('5','s3','VT-01')];
const ops=(id:string)=>({vmId:id,cycle:3,milestone:id==='5'?'WAITING':'RECREATE',request:null}) as never;
const binding=(vmId:string,serverId:string)=>({projectId:'p',serverId,vmId,machineUuid:UUID,expectedCycle:3,expectedVmRevision:1,configurationId:null});
beforeEach(()=>{vi.stubGlobal('React',React);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);window.sessionStorage.clear();host=document.createElement('div');document.body.append(host);root=createRoot(host);
  for(const f of Object.values(mock))f.mockReset().mockResolvedValue({});
  mock.servers.mockReturnValue({isLoading:false,data:{serverIds:['s1','s2']}});
  mock.control.mockImplementation(async({vmId,serverId})=>({userId:'u',capability:{binding:binding(vmId,serverId),actions:['CHECK_HEALTH','RECREATE_VM']},items:[]}));});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const render=(rights={manage:true,assign:true},userId:string|null='u')=>act(async()=>root.render(<RecreateBulkPanel projectId="p" userId={userId??undefined} vms={vms} opsOf={ops} rights={rights} onSaved={mock.saved}/>));
const button=(text:string)=>Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text) as HTMLButtonElement|undefined;
const click=(text:string)=>act(async()=>{const b=button(text);expect(b,text).toBeTruthy();b!.click();});
it('"Tạo lại N VM" asks once with VM counts per server, then sends one RECREATE_VM per enrolled VM; manual VMs are listed',async()=>{
  await render();
  expect(host.textContent).toContain('Tạo tay 1 VM');expect(host.textContent).toContain('VT-01 / VM_4 — Tạo lại trên máy rồi bấm Ghi nhận đã tạo lại');
  expect(host.textContent).toContain('VT-01 / VM_5');
  await click('Tạo lại 3 VM');expect(mock.create).not.toHaveBeenCalled();
  const dialog=host.querySelector('[role="alertdialog"]')!;expect(dialog.textContent).toContain('MOON-01: 2 VM');expect(dialog.textContent).toContain('MOON-02: 1 VM');expect(dialog.textContent).not.toContain('VT-01');
  await click('Xác nhận tạo lại 3 VM');
  expect(mock.create).toHaveBeenCalledTimes(3);
  expect(mock.create.mock.calls[0][0]).toMatchObject({...binding('1','s1'),action:'RECREATE_VM',ttlSeconds:300});
  expect(new Set(mock.create.mock.calls.map(c=>c[0].operationId)).size).toBe(3);
  expect(window.sessionStorage.length).toBe(0);expect(mock.saved).toHaveBeenCalledTimes(1);
});
it('a refused VM (recreate rule / revision) does not stop the others; a VM without control capability is reported, not sent',async()=>{
  mock.control.mockImplementation(async({vmId,serverId})=>({userId:'u',capability:vmId==='2'?null:{binding:binding(vmId,serverId),actions:['RECREATE_VM']},items:[]}));
  mock.create.mockRejectedValueOnce(Object.assign(new Error('Revision VM đã đổi'),{data:{code:'CONFLICT'}}));
  await render();await click('Tạo lại 3 VM');await click('Xác nhận tạo lại 3 VM');
  expect(mock.create).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('Revision VM đã đổi');expect(host.textContent).toContain('Máy chưa sẵn sàng điều khiển');
  expect(host.textContent).toContain('Đã gửi lệnh tạo lại');expect(window.sessionStorage.length).toBe(0);
});
it('a lost answer keeps the fleet command under the VM panel key; the retry sends the same body',async()=>{
  mock.create.mockRejectedValueOnce(new Error('502'));
  await render();await click('Tạo lại 3 VM');await click('Xác nhận tạo lại 3 VM');
  const first=mock.create.mock.calls[0][0];expect(window.sessionStorage.getItem('mth-fleet:u:p:s1:1')).toBe(JSON.stringify(first));
  window.confirm=()=>true;await click('Thử lại lệnh chưa rõ');expect(mock.create.mock.calls[3][0]).toEqual(first);expect(window.sessionStorage.length).toBe(0);
});
it('"Ghi nhận đã tạo lại N VM": only "Chờ tạo lại" VMs of servers without control (the worker records enrolled ones), after confirming',async()=>{
  await render({manage:false,assign:true});
  expect(button('Tạo lại 3 VM')).toBeUndefined();
  expect(host.textContent).toContain('3 VM thuộc server có điều khiển: web tự ghi nhận');
  await click('Ghi nhận đã tạo lại 1 VM');const d=host.querySelector('[role="alertdialog"]')!;expect(d.textContent).toContain('VT-01: 1 VM');expect(d.textContent).not.toContain('MOON-01');
  await click('Xác nhận ghi nhận đã tạo lại 1 VM');
  expect(mock.recreate).toHaveBeenCalledTimes(1);expect(mock.recreate.mock.calls[0][0]).toMatchObject({projectId:'p',vmId:'4',expectedCycle:3});
});
it('never offers "Ghi nhận" for a VM with a fleet command kept in this tab, nor for one this panel just sent',async()=>{
  mock.servers.mockReturnValue({isLoading:false,data:{serverIds:[]}});
  window.sessionStorage.setItem('mth-fleet:u:p:s3:4',JSON.stringify({action:'RECREATE_VM'}));
  await render();
  expect(host.textContent).toContain('VT-01 / VM_4 — VM có lệnh tạo lại qua điều khiển đang chờ');
  await click('Ghi nhận đã tạo lại 3 VM');await click('Xác nhận ghi nhận đã tạo lại 3 VM');
  expect(mock.recreate.mock.calls.map(c=>c[0].vmId)).toEqual(['1','2','3']);
});
it('another fleet action kept under the VM panel key is never resent or dropped here: only "Đối chiếu trong khung VM"',async()=>{
  const other=JSON.stringify({...binding('1','s1'),action:'START_VM',operationId:'0b6f3c1e-7d43-4b8e-9a51-2f1c5e7d9a10',ttlSeconds:300});
  window.sessionStorage.setItem('mth-fleet:u:p:s1:1',other);
  await render();
  expect(host.textContent).toContain('Đối chiếu trong khung VM');expect(button('Bỏ lệnh chưa rõ (đã đối chiếu)')).toBeUndefined();expect(button('Thử lại lệnh chưa rõ')).toBeUndefined();
  await click('Tạo lại 2 VM');await click('Xác nhận tạo lại 2 VM');
  expect(mock.create.mock.calls.map(c=>c[0].vmId)).toEqual(['2','3']);expect(window.sessionStorage.getItem('mth-fleet:u:p:s1:1')).toBe(other);
});
it('"Thử lại lệnh chưa rõ" for RECREATE_VM asks before re-sending',async()=>{
  mock.create.mockRejectedValueOnce(new Error('502'));
  await render();await click('Tạo lại 3 VM');await click('Xác nhận tạo lại 3 VM');
  const confirm=vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);vi.stubGlobal('confirm',confirm);window.confirm=confirm;
  await click('Thử lại lệnh chưa rõ');expect(confirm).toHaveBeenCalledTimes(1);expect(mock.create).toHaveBeenCalledTimes(3);
  await click('Thử lại lệnh chưa rõ');expect(mock.create).toHaveBeenCalledTimes(4);expect(mock.create.mock.calls[3][0]).toEqual(mock.create.mock.calls[0][0]);
});
it('without the session user nothing is shown or sent',async()=>{await render({manage:true,assign:true},null);expect(host.textContent).toContain('Đang tải phiên đăng nhập');expect(mock.control).not.toHaveBeenCalled();});
it('fleet read failure: every VM is treated as manual (nothing sent to machines)',async()=>{
  mock.servers.mockReturnValue({isLoading:false,error:{message:'down'},data:undefined});
  await render();expect(host.textContent).toContain('Tạo tay 4 VM');expect(button('Ghi nhận đã tạo lại 4 VM')).toBeTruthy();expect(button('Tạo lại 0 VM')!.disabled).toBe(true);
});
