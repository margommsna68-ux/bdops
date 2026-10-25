import React,{act} from 'react';
import type {Root} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({query:'',data:null as any,status:vi.fn(),push:vi.fn(),replace:vi.fn(),importPanel:vi.fn(),draftOpen:false,appleOverview:vi.fn(),appleRequest:vi.fn(),storeQuery:vi.fn()}));
vi.mock('next/navigation',()=>({usePathname:()=>'/gmails',useSearchParams:()=>new URLSearchParams(mock.query),useRouter:()=>({push:mock.push,replace:mock.replace})}));
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('@/lib/trpc',()=>{const mutation=()=>({useMutation:()=>({isLoading:false,mutateAsync:mock.status})});return {trpc:{
  useUtils:()=>({accountStore:{invalidate:vi.fn()},businessManagement:{invalidate:vi.fn()},appleCheck:{overview:{invalidate:vi.fn()}}}),
  appleCheck:{overview:{useQuery:mock.appleOverview},request:{useMutation:()=>({mutateAsync:mock.appleRequest})},cancel:mutation()},
  user:{securityStatus:{useQuery:()=>({data:{unlocked:false,totpEnabled:false}})}},
  accountStore:{store:{useQuery:()=>{mock.storeQuery();return {data:mock.data,isLoading:false};}},setStatus:mutation(),deleteStock:mutation(),restoreStock:mutation(),setNote:mutation(),updateLogin:mutation(),batchCost:mutation()},
  proxyManagement:{undo:mutation()},businessManagement:{copyAccount:mutation()},
}};});
vi.mock('react-hot-toast',()=>({default:Object.assign(vi.fn(),{success:vi.fn(),error:vi.fn()})}));
vi.mock('@/components/business-management/shared',()=>({useBusinessKey:()=>()=> 'synthetic-key'}));
vi.mock('@/components/vm-management/shared',()=>({errorMessage:(e:Error)=>e.message}));
vi.mock('@/components/business-management/AccountsWorkspace',()=>({AccountCopy:()=>null}));
vi.mock('@/components/account-store/NoteCell',()=>({useNoteWidth:()=>[280,vi.fn()],NoteHeader:()=> <th>Ghi chú</th>,NoteCell:()=> <td/>}));
vi.mock('@/components/account-store/ImportPanel',()=>({ImportPanel:mock.importPanel,importDraft:()=>({open:mock.draftOpen,nonce:0}),appendToBatch:vi.fn(),discardDraft:vi.fn(),finishDraft:vi.fn()}));
vi.mock('@/components/account-store/PaypalStock',()=>({PaypalStock:({rows}:any)=><div data-testid="paypal-list">{rows.map((r:any)=>r.code).join(',')}</div>}));
import {AccountStore} from '@/components/account-store/AccountStore';
const row=(id:string,status='ACTIVE',type='GMAIL',extra:object={})=>({id,email:id+'@example.invalid',type,status,state:'NEW',deletedAt:null,revision:3,notes:null,recoveryEmail:null,createdAt:'2026-10-24T01:00:00Z',batch:null,batchId:null,price:null,priceState:'NONE',credentialsAvailable:true,phone:null,links:{twoFa:false,sms:false},has:{password:true,twoFa:false,token:false},earnApp:null,place:null,legacyVmCount:0,loginIssueNote:null,loginIssueAt:null,...extra});
let dom:JSDOM,root:Root,host:HTMLDivElement;
beforeEach(async()=>{
  dom=new JSDOM('<html><body></body></html>',{url:'http://localhost/gmails'});
  for(const [key,value] of Object.entries({React,window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true}))vi.stubGlobal(key,value);
  host=document.createElement('div');document.body.appendChild(host);const {createRoot}=await import('react-dom/client');root=createRoot(host);
  mock.query='';mock.push.mockReset();mock.replace.mockReset();mock.status.mockReset();mock.status.mockResolvedValue({rows:[],applied:1});mock.draftOpen=false;mock.importPanel.mockReset();mock.importPanel.mockReturnValue(null);
  mock.storeQuery.mockReset();mock.appleOverview.mockReset();mock.appleOverview.mockReturnValue({data:{canManage:false,canCheck:true,groups:[],worker:{id:'w',name:'Central',enabled:true,online:true,state:'IDLE',proxyGroupId:'g',lastSeenAt:null},jobs:[]}});mock.appleRequest.mockReset();mock.appleRequest.mockResolvedValue({id:'j',accountId:'apple',accountRevision:3,phase:'QUEUED',result:null,createdAt:'2026-10-25T02:00:00Z',observedAt:null,stale:false,cancelRequested:false,cleanup:null,reasonCode:null});
  const navigate=(href:string)=>{mock.query=href.split('?')[1]||'';window.history.pushState({},'',href);};mock.push.mockImplementation(navigate);mock.replace.mockImplementation(navigate);
  mock.data={rights:{logins:true,paypals:true,writeLogins:true,writePaypals:false,admin:false,copy:false,money:false,writeCosts:false},logins:[row('normal'),row('apple','APPLE_LOCKED','APPLE_ID',{loginIssueNote:'Apple account locked on sign in',loginIssueAt:'2026-10-24T03:00:00Z'}),row('verify','GOOGLE_VERIFY','GMAIL',{loginIssueNote:'Verification requested',loginIssueAt:'2026-10-24T06:00:00Z'}),row('disabled','GOOGLE_DISABLED')],paypals:[{id:'pp',code:'PP-TEST',state:'NEW',batch:null,notes:null,emails:[]}],batches:[],review:[]};
});
afterEach(async()=>{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals();});
const render=async()=>act(async()=>root.render(<AccountStore projectId="local-issue-project"/>));
const select=(name:string)=>{const el=host.querySelector(`select[aria-label="${name}"]`);if(!el)throw Error('Missing select '+name);return el as HTMLSelectElement;};
const change=async(el:HTMLSelectElement,value:string)=>{await act(async()=>{el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});await render();};
const click=async(el:HTMLElement)=>{await act(async()=>el.click());await render();};
const ids=()=>Array.from(host.querySelectorAll('tr[data-account-id]')).map(el=>el.getAttribute('data-account-id'));
it('offers a check only in Apple rows through one shared overview and keeps Locked filtering',async()=>{
  await render();expect(mock.appleOverview).toHaveBeenCalledTimes(mock.storeQuery.mock.calls.length);
  const checks=host.querySelectorAll('button');const check=Array.from(checks).filter(b=>b.textContent==='Check Apple ID');expect(check).toHaveLength(1);expect(check[0].closest('tr')?.getAttribute('data-account-id')).toBe('apple');
  await click(check[0]);expect(mock.appleRequest.mock.calls[0][0]).toMatchObject({projectId:'local-issue-project',accountId:'apple',expectedRevision:3});expect(mock.status).not.toHaveBeenCalled();
  await change(select('Lọc tình trạng đăng nhập'),'APPLE_LOCKED');expect(ids()).toEqual(['apple']);
});
it('renders coloured issue labels, compact reason/time, and only type-valid issue choices per individual account',async()=>{
  await render();
  const apple=host.querySelector('tr[data-account-id="apple"]')!;
  expect(apple.textContent).toContain('Apple Locked');expect(apple.textContent).toContain('Apple account locked on sign in');expect(apple.querySelector('time')?.dateTime).toBe('2026-10-24T03:00:00Z');
  expect(apple.querySelector('[data-login-issue="APPLE_LOCKED"]')?.className).toMatch(/red/);
  expect(host.querySelector('[data-login-issue="GOOGLE_VERIFY"]')?.className).toMatch(/amber/);
  expect(host.querySelector('[data-login-issue="GOOGLE_DISABLED"]')?.className).toMatch(/red/);
  expect(Array.from(select('Tình trạng apple@example.invalid').options).map(o=>o.value)).toContain('APPLE_LOCKED');
  expect(Array.from(select('Tình trạng apple@example.invalid').options).map(o=>o.value)).not.toContain('GOOGLE_VERIFY');
  expect(Array.from(select('Tình trạng verify@example.invalid').options).map(o=>o.value)).toEqual(expect.arrayContaining(['GOOGLE_VERIFY','GOOGLE_DISABLED']));
  expect(Array.from(select('Tình trạng verify@example.invalid').options).map(o=>o.value)).not.toContain('APPLE_LOCKED');
  expect(mock.status).not.toHaveBeenCalled();expect(host.querySelector('[aria-label^="Xoá khỏi kho"]')).toBeNull();
});
it('keeps the individual write contract and includes all three statuses for mixed bulk selection',async()=>{
  await render();await change(select('Tình trạng normal@example.invalid'),'GOOGLE_VERIFY');
  expect(mock.status.mock.calls[0][0]).toMatchObject({kind:'LOGIN',status:'GOOGLE_VERIFY',items:[{id:'normal',expectedRevision:3}]});
  await click(host.querySelector('input[aria-label="Chọn apple@example.invalid"]')!);await click(host.querySelector('input[aria-label="Chọn verify@example.invalid"]')!);
  const bulk=select('Tình trạng cho các dòng đã chọn');expect(Array.from(bulk.options).map(o=>o.value)).toEqual(expect.arrayContaining(['APPLE_LOCKED','GOOGLE_VERIFY','GOOGLE_DISABLED']));
  await change(bulk,'APPLE_LOCKED');await click(Array.from(host.querySelectorAll('button')).find(el=>el.textContent==='Áp dụng')!);
  expect(mock.status.mock.calls[1][0]).toMatchObject({status:'APPLE_LOCKED',items:[{id:'apple',expectedRevision:3},{id:'verify',expectedRevision:3}]});
});
it('filters exact login status and sorts before pagination, persisting both controls on reload/back',async()=>{
  mock.data.logins=[...Array.from({length:100},(_,i)=>row('normal-'+i)),row('last-issue','GOOGLE_VERIFY')];await render();
  expect(ids()).not.toContain('last-issue');await change(select('Sắp xếp tài khoản'),'ERRORS_FIRST');expect(ids()[0]).toBe('last-issue');
  await change(select('Lọc tình trạng đăng nhập'),'GOOGLE_VERIFY');expect(ids()).toEqual(['last-issue']);expect(mock.query).toContain('status=GOOGLE_VERIFY');expect(mock.query).toContain('sort=ERRORS_FIRST');
  await render();expect(select('Lọc tình trạng đăng nhập').value).toBe('GOOGLE_VERIFY');expect(select('Sắp xếp tài khoản').value).toBe('ERRORS_FIRST');
  mock.query='status=GOOGLE_VERIFY&sort=LATEST_ISSUE';await render();expect(select('Sắp xếp tài khoản').value).toBe('LATEST_ISSUE');expect(ids()).toEqual(['last-issue']);
});
it('keeps current created order until chosen, orders latest issue/email, and clears login filters on PayPal',async()=>{
  await render();expect(ids()).toEqual(['normal','apple','verify','disabled']);
  await change(select('Sắp xếp tài khoản'),'LATEST_ISSUE');expect(ids()[0]).toBe('verify');
  await change(select('Sắp xếp tài khoản'),'EMAIL');expect(ids()).toEqual(['apple','disabled','normal','verify']);
  await change(select('Lọc tình trạng đăng nhập'),'APPLE_LOCKED');
  await click(Array.from(host.querySelectorAll('[role="tab"]')).find(el=>el.textContent?.startsWith('PayPal')) as HTMLElement);
  expect(mock.query).not.toMatch(/status=|sort=/);expect(host.querySelector('select[aria-label="Lọc tình trạng đăng nhập"]')).toBeNull();expect(host.querySelector('[data-testid="paypal-list"]')?.textContent).toBe('PP-TEST');
});
it('shows issue metadata in the expanded detail without fetching or revealing secrets',async()=>{
  await render();await click(host.querySelector('[aria-label="Mở chi tiết apple@example.invalid"]')!);
  const detail=host.querySelector('[aria-label="Chi tiết apple@example.invalid"]')!;expect(detail.textContent).toContain('Apple Locked');expect(detail.textContent).toContain('Apple account locked on sign in');expect(detail.querySelector('time')?.dateTime).toBe('2026-10-24T03:00:00Z');
  expect(detail.textContent).toContain('••••••••');expect(mock.status).not.toHaveBeenCalled();
});
it('scoped read-only login view never mounts retained import drafts or offers PayPal/history/review/write controls',async()=>{
  mock.draftOpen=true;mock.data.rights={logins:true,paypals:false,writeLogins:false,writePaypals:false,copy:true,money:false,writeCosts:false,admin:false};
  mock.query='tab=paypal&view=history&import=1';await render();await render();
  expect(mock.importPanel).not.toHaveBeenCalled();
  expect(Array.from(host.querySelectorAll('[role="tab"]')).map(t=>t.textContent)).toEqual(['Gmail / Apple ID (4)']);
  expect(host.textContent).not.toContain('Lịch sử nhập kho');expect(host.textContent).not.toContain('Cần đối chiếu');expect(host.textContent).not.toContain('Nhập Gmail / Apple ID');
  expect(host.querySelector('select[aria-label="Tình trạng normal@example.invalid"]')).toBeNull();expect(host.querySelector('[aria-label^="Xoá khỏi kho"]')).toBeNull();
  expect(ids()).toEqual(['normal','apple','verify','disabled']);expect(mock.query).not.toMatch(/tab=paypal|view=history|import=1/);
});
