import React,{act} from 'react';
import type {Root} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({query:'',data:null as any,status:vi.fn(),push:vi.fn(),replace:vi.fn(),importPanel:vi.fn(),draftOpen:false,appleOverview:vi.fn(),appleRequest:vi.fn(),appleBatch:vi.fn(),storeQuery:vi.fn()}));
vi.mock('next/navigation',()=>({usePathname:()=>'/gmails',useSearchParams:()=>new URLSearchParams(mock.query),useRouter:()=>({push:mock.push,replace:mock.replace})}));
vi.mock('next/link',()=>({default:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
vi.mock('@/lib/trpc',()=>{const mutation=()=>({useMutation:()=>({isLoading:false,mutateAsync:mock.status})});return {trpc:{
  useUtils:()=>({accountStore:{invalidate:vi.fn()},businessManagement:{invalidate:vi.fn()},appleCheck:{overview:{invalidate:vi.fn()}}}),
  appleCheck:{overview:{useQuery:mock.appleOverview},request:{useMutation:()=>({mutateAsync:mock.appleRequest})},requestBatch:{useMutation:()=>({mutateAsync:mock.appleBatch})},cancel:mutation()},
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
  mock.appleBatch.mockReset();mock.appleBatch.mockImplementation(async({accounts}:any)=>({jobs:accounts.map((a:any)=>({id:'j-'+a.accountId,accountId:a.accountId,accountRevision:a.expectedRevision,phase:'QUEUED',result:null,createdAt:'2026-10-25T02:00:00Z',observedAt:null,stale:false,cancelRequested:false,cleanup:null,reasonCode:null}))}));
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
const batchButton=()=>host.querySelector<HTMLButtonElement>('button[aria-label="Check Apple ID đã chọn"]')!;
const choose=async(id:string)=>click(host.querySelector<HTMLInputElement>(`input[aria-label="Chọn ${id}@example.invalid"]`)!);
it('places check metadata in its own account-status column and the bulk action above the table',async()=>{
  await render();const headers=Array.from(host.querySelectorAll('thead th')).map(th=>th.textContent),column=headers.indexOf('Tình trạng acc');
  expect(column).toBeGreaterThan(-1);const apple=host.querySelector('tr[data-account-id="apple"]')!;
  expect(apple.children[column].querySelector('[aria-label="Check Apple ID"]')).not.toBeNull();expect(apple.children[1].textContent).not.toContain('Chưa kiểm tra');
  expect(host.querySelector('tr[data-account-id="normal"]')!.children[column].textContent).toBe('—');
  expect(batchButton()).not.toBeNull();expect(batchButton().closest('table')).toBeNull();expect(batchButton().compareDocumentPosition(host.querySelector('table')!)&dom.window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(host.textContent).toContain('tối đa 5 mỗi đợt, lần lượt');expect(batchButton().disabled).toBe(true);
});
it('submits exactly five selected accounts with revisions in one batch and suppresses rapid double clicks',async()=>{
  mock.data.logins=Array.from({length:6},(_,i)=>row('a'+i,'ACTIVE','APPLE_ID',{revision:i+10}));await render();
  for(let i=0;i<5;i++)await choose('a'+i);
  const b=batchButton();await act(async()=>{b.click();b.click();});
  expect(mock.appleBatch).toHaveBeenCalledTimes(1);expect(mock.appleRequest).not.toHaveBeenCalled();
  expect(mock.appleBatch.mock.calls[0][0]).toEqual({projectId:'local-issue-project',accounts:Array.from({length:5},(_,i)=>({accountId:'a'+i,expectedRevision:i+10,key:expect.any(String)}))});
  expect(host.querySelector('tr[data-account-id="a5"]')?.textContent).toContain('Chưa kiểm tra');expect(batchButton().disabled).toBe(true);
});
it('rejects six selected accounts explicitly without truncating or sending requests',async()=>{
  mock.data.logins=Array.from({length:6},(_,i)=>row('a'+i,'ACTIVE','APPLE_ID'));await render();for(let i=0;i<6;i++)await choose('a'+i);
  await click(batchButton());expect(host.querySelector('[role="alert"]')?.textContent).toContain('Tối đa 5 Apple ID mỗi đợt');expect(mock.appleBatch).not.toHaveBeenCalled();expect(mock.appleRequest).not.toHaveBeenCalled();
});
it('rejects a mixed selection rather than silently dropping Gmail rows',async()=>{
  await render();await choose('apple');await choose('normal');await click(batchButton());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Chỉ chọn tài khoản Apple ID');expect(mock.appleBatch).not.toHaveBeenCalled();
});
it('retries an uncertain batch only on click using the exact same payload and keys',async()=>{
  mock.appleBatch.mockRejectedValueOnce(Error('Lost response'));await render();await choose('apple');await click(batchButton());
  expect(mock.appleBatch).toHaveBeenCalledTimes(1);expect(host.textContent).toContain('Chưa rõ yêu cầu');await click(batchButton());
  expect(mock.appleBatch).toHaveBeenCalledTimes(2);expect(mock.appleBatch.mock.calls[1][0]).toEqual(mock.appleBatch.mock.calls[0][0]);
});
it('does not offer a bulk check for deleted stock, PayPal, or users without check rights',async()=>{
  mock.query='state=DELETED';await render();expect(batchButton()).toBeNull();
  mock.query='tab=paypal';await render();expect(batchButton()).toBeNull();
  mock.query='';mock.appleOverview.mockReturnValue({data:{canManage:false,canCheck:false,groups:[],worker:null,jobs:[]}});await render();expect(batchButton()).toBeNull();
});
it.each([
  {enabled:false,online:false,state:'OFFLINE',disabled:true},
  {enabled:true,online:true,state:'CLEANUP_FAILED',disabled:true},
  {enabled:true,online:false,state:'OFFLINE',disabled:false},
  {enabled:true,online:true,state:'WAITING_DESKTOP',disabled:false},
])('respects bulk worker availability: $state enabled=$enabled',async({disabled,...worker})=>{
  Object.assign(mock.appleOverview.getMockImplementation()!().data.worker,worker);await render();await choose('apple');expect(batchButton().disabled).toBe(disabled);
  await click(batchButton());expect(mock.appleBatch).toHaveBeenCalledTimes(disabled?0:1);
});
it('fails closed for bulk checks when the overview errors',async()=>{
  const overview=mock.appleOverview.getMockImplementation()!();mock.appleOverview.mockReturnValue({...overview,error:Error('Offline')});
  await render();await choose('apple');expect(batchButton().disabled).toBe(true);await click(batchButton());expect(mock.appleBatch).not.toHaveBeenCalled();
});
it('uses selections across pages and rejects a sixth account on another page',async()=>{
  mock.data.logins=Array.from({length:101},(_,i)=>row('a'+i,'ACTIVE','APPLE_ID'));await render();for(let i=0;i<5;i++)await choose('a'+i);
  await click(host.querySelector('[aria-label="Trang sau"]')!);await choose('a100');await click(batchButton());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Tối đa 5 Apple ID mỗi đợt');expect(mock.appleBatch).not.toHaveBeenCalled();
  await choose('a100');await click(batchButton());expect(mock.appleBatch.mock.calls[0][0].accounts.map((a:any)=>a.accountId)).toEqual(['a0','a1','a2','a3','a4']);
});
it('keeps uncertain batch revisions stable and creates new keys after a definite rejection',async()=>{
  mock.appleBatch.mockRejectedValueOnce(Error('Lost response')).mockRejectedValueOnce({data:{code:'CONFLICT'}});await render();await choose('apple');await click(batchButton());const first=mock.appleBatch.mock.calls[0][0];
  mock.data.logins.find((l:any)=>l.id==='apple').revision=9;await render();await click(batchButton());expect(mock.appleBatch.mock.calls[1][0]).toEqual(first);
  expect(host.textContent).toContain('Yêu cầu bị từ chối');await click(batchButton());expect(mock.appleBatch.mock.calls[2][0].accounts[0]).toMatchObject({accountId:'apple',expectedRevision:9});expect(mock.appleBatch.mock.calls[2][0].accounts[0].key).not.toBe(first.accounts[0].key);
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
