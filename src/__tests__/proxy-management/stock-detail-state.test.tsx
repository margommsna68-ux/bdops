import React,{act} from 'react';
import {beforeAll,beforeEach,afterEach,afterAll,expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
// Independent review 20/10/2026 (.runtime/review-stock-detail-state-20261020.test.tsx made official) + lost answers and late secrets.
// Component lifecycle only: no browser, database, network or real credentials (synthetic values).
const mock=vi.hoisted(()=>({copy:vi.fn(),update:vi.fn(),preview:vi.fn(),commit:vi.fn(),clipboard:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{
  user:{securityStatus:{useQuery:()=>({data:{unlocked:false,totpEnabled:false}})}},
  businessManagement:{copyAccount:{useMutation:()=>({mutateAsync:mock.copy,isLoading:false})}},
  accountStore:{updateLogin:{useMutation:()=>({mutateAsync:mock.update,isLoading:false})}},
  proxyManagement:{catalog:{useQuery:()=>({data:[],refetch:()=>{}})},groups:{useQuery:()=>({data:[],refetch:()=>{}})},
    preview:{useMutation:()=>({mutateAsync:mock.preview,isLoading:false})},commit:{useMutation:()=>({mutateAsync:mock.commit,isLoading:false})}},
}}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}));
vi.mock('@/components/ui/dialog',()=>({Dialog:({children}:{children:React.ReactNode})=><div>{children}</div>,DialogContent:({children}:{children:React.ReactNode})=><div>{children}</div>,
  DialogHeader:({children}:{children:React.ReactNode})=><header>{children}</header>,DialogTitle:({children}:{children:React.ReactNode})=><h2>{children}</h2>,DialogDescription:({children}:{children:React.ReactNode})=><p>{children}</p>}));
vi.mock('@/components/proxy-management/RegistryEdit',()=>({GroupChoiceSelect:()=>null}));
vi.mock('@/components/proxy-management/HistoryPanel',()=>({HistoryPanel:()=>null}));
import {AccountDetail} from '@/components/account-store/AccountDetail';
import {BatchDialog} from '@/components/proxy-management/BatchDialog';
type Root={render:(n:React.ReactNode)=>void;unmount:()=>void};
let dom:JSDOM,container:HTMLDivElement,root:Root,createRoot:(c:Element)=>Root;
const saved=new Map<string,PropertyDescriptor|undefined>();
beforeAll(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'});
  for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true})){saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});}
  Object.defineProperty(dom.window.navigator,'clipboard',{configurable:true,value:{writeText:mock.clipboard}});
  ({createRoot}=await import('react-dom/client') as unknown as {createRoot:(c:Element)=>Root});
});
const OLD={secret:'OldSyntheticSecret!',twoFa:null,token:null,twoFaLink:'https://example.invalid/2fa',smsLink:'https://example.invalid/sms',phone:'0123456789'};
beforeEach(()=>{vi.clearAllMocks();mock.copy.mockResolvedValue(OLD);mock.clipboard.mockResolvedValue(undefined);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
afterAll(()=>{dom.window.close();for(const [k,d] of saved){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}});
const login={id:'synthetic-login',email:'apple@example.invalid',type:'APPLE_ID',status:'ACTIVE',state:'NEW',deletedAt:null,revision:3,notes:null,recoveryEmail:null,createdAt:'',batch:null,batchId:null,price:null,priceState:'NONE',credentialsAvailable:true,phone:'0123456789',links:{twoFa:true,sms:true},has:{password:true,twoFa:false,token:false},earnApp:null,place:null,legacyVmCount:0};
const detail=async(changes:object={},props:object={})=>act(async()=>root.render(<AccountDetail projectId="synthetic-project" login={{...login,...changes} as never} canEdit canCopy onSaved={()=>{}} onClose={()=>{}} {...props}/>));
const button=(name:string)=>{const b=Array.from(container.querySelectorAll('button')).find(e=>e.getAttribute('aria-label')===name||e.textContent===name);if(!b)throw new Error('Missing button '+name);return b as HTMLButtonElement;};
const click=async(name:string)=>act(async()=>button(name).click());
const input=(label:string)=>container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
async function fill(el:HTMLInputElement|HTMLTextAreaElement,value:string){await act(async()=>{const proto=el.tagName==='TEXTAREA'?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
const submitPin=async()=>{await fill(input('PIN'),'123456');await act(async()=>container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));};
it('a background revision keeps the unsaved edit and its base; Lưu waits for an explicit "Đối chiếu bản mới", then sends the new revision',async()=>{
  await detail();await click('Sửa');await fill(input('Số điện thoại'),'+84 900 000 002');expect(button('Lưu 1 trường').disabled).toBe(false);
  await detail({revision:4,notes:'Another operator updated notes'});
  expect(input('Số điện thoại').value).toBe('+84 900 000 002');expect(container.textContent).toContain('vừa được cập nhật ở nơi khác');expect(container.textContent).toContain('Bản mới: Another operator updated notes');
  expect(button('Lưu 1 trường').disabled).toBe(true);
  await click('Đối chiếu bản mới');expect(input('Số điện thoại').value).toBe('+84 900 000 002');
  mock.update.mockResolvedValue({changed:true,message:'Đã lưu Số điện thoại',fields:['Số điện thoại'],revision:5});
  await click('Lưu 1 trường');expect(mock.update).toHaveBeenCalledWith(expect.objectContaining({expectedRevision:4,changes:{phone:'+84 900 000 002'}}));
});
it('a lost answer keeps the draft; the retry sends the same body with the same key',async()=>{
  await detail();await click('Sửa');await fill(input('Số điện thoại'),'+84 900 000 003');
  mock.update.mockRejectedValueOnce(new Error('Failed to fetch'));await click('Lưu 1 trường');
  expect(input('Số điện thoại').value).toBe('+84 900 000 003');expect(container.textContent).toContain('Failed to fetch');
  mock.update.mockResolvedValueOnce({changed:true,message:'Đã lưu Số điện thoại',fields:['Số điện thoại'],revision:4});await click('Lưu 1 trường');
  const [a,b]=mock.update.mock.calls.map(c=>c[0]);expect(b).toEqual(a);expect(a.key).toEqual(expect.any(String));
  expect(container.querySelector('[aria-label="Số điện thoại"]')).toBeNull(); // saved → out of edit mode, draft dropped
});
it('a changed revision hides the cached password; a new PIN reads the current one',async()=>{
  await detail();await click('Xem Mật khẩu apple@example.invalid');await submitPin();expect(container.textContent).toContain('OldSyntheticSecret!');
  mock.copy.mockResolvedValue({...OLD,secret:'NewSyntheticSecret!'});await detail({revision:4});
  expect(container.textContent).not.toContain('OldSyntheticSecret!');
  await click('Xem Mật khẩu apple@example.invalid');await submitPin();expect(container.textContent).toContain('NewSyntheticSecret!');
});
it('a late secret answer for an older version, another account or a lost copy right is thrown away',async()=>{
  let resolve:(v:unknown)=>void=()=>{};mock.copy.mockReturnValue(new Promise(r=>{resolve=r;}));
  await detail();await click('Copy Mật khẩu apple@example.invalid');await fill(input('PIN'),'123456');
  await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));}); // the answer is still on its way
  await detail({revision:4});await act(async()=>{resolve(OLD);await Promise.resolve();});
  expect(mock.clipboard).not.toHaveBeenCalled();expect(container.textContent).not.toContain('OldSyntheticSecret!');
  // Shown for one account, then another account in the same frame: nothing of the first one stays.
  mock.copy.mockResolvedValue(OLD);await click('Xem Mật khẩu apple@example.invalid');await submitPin();expect(container.textContent).toContain('OldSyntheticSecret!');
  await detail({revision:4,id:'other-login',email:'other@example.invalid'});expect(container.textContent).not.toContain('OldSyntheticSecret!');
  await detail({revision:4,id:'other-login',email:'other@example.invalid'},{canCopy:false});expect(container.textContent).not.toContain('OldSyntheticSecret!');
});
it('a partial NEW proxy import keeps the refused line editable with its reason; fixing it and saving closes the dialog',async()=>{
  const rows=[{row:1,outcome:'READY',newIp:'203.0.113.10',message:'Hợp lệ',sourceRefs:[],owner:'SELF'},{row:2,outcome:'ERROR',message:'Sai định dạng',sourceRefs:[]}];
  mock.preview.mockResolvedValue({token:'synthetic-preview',kind:'NEW',rows,ready:1,skipped:0,errors:1,duplicates:0,expiresAt:'2026-10-20'});
  mock.commit.mockResolvedValue({batchId:'synthetic-batch',rows,applied:1,skipped:0,errors:1,replay:false});
  const onClose=vi.fn(),onImported=vi.fn();
  await act(async()=>root.render(<BatchDialog projectId="synthetic-project" kind="NEW" onClose={onClose} onSaved={()=>{}} onImported={onImported}/>));
  await fill(container.querySelector('textarea')!,'203.0.113.10:5432:fake:fake\nbad line');
  await click('Kiểm tra và lưu');await click('Lưu 1 dòng hợp lệ');
  expect(mock.commit).toHaveBeenCalledTimes(1);expect(container.querySelector('textarea')?.value).toBe('bad line');expect(container.textContent).toContain('Sai định dạng');expect(container.textContent).toContain('Còn 1 dòng cần sửa');
  // The fixed line is checked and saved on its own (never the saved line again); a lost answer keeps it for the retry.
  const fixed=[{row:1,outcome:'READY',newIp:'203.0.113.11',message:'Hợp lệ',sourceRefs:[],owner:'SELF'}];
  mock.preview.mockResolvedValue({token:'p2',kind:'NEW',rows:fixed,ready:1,skipped:0,errors:0,duplicates:0,expiresAt:'2026-10-20'});
  await fill(container.querySelector('textarea')!,'203.0.113.11:5432:fake:fake');
  mock.commit.mockRejectedValueOnce(new Error('Failed to fetch'));await click('Kiểm tra và lưu');
  expect(container.querySelector('textarea')?.value).toBe('203.0.113.11:5432:fake:fake');expect(mock.preview.mock.calls.at(-1)![0].text).toBe('203.0.113.11:5432:fake:fake');
  const lostKey=mock.commit.mock.calls.at(-1)![0].idempotencyKey;
  mock.commit.mockResolvedValueOnce({batchId:'synthetic-batch-2',rows:fixed,applied:1,skipped:0,errors:0,replay:false});await click('Lưu 1 dòng hợp lệ');
  expect(mock.commit.mock.calls.at(-1)![0]).toEqual({projectId:'synthetic-project',token:'p2',idempotencyKey:lostKey});
  expect(onImported).toHaveBeenCalledWith({applied:1,batchId:'synthetic-batch-2'});expect(onClose).toHaveBeenCalled();
});
