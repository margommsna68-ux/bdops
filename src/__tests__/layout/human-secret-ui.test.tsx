import React,{act} from 'react';
import type {Root} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mock=vi.hoisted(()=>({security:{data:{totpEnabled:true,hasPin:false,unlocked:false},error:null as Error|null,isLoading:false},verify:vi.fn(),copy:vi.fn(),clipboard:vi.fn(),action:vi.fn(),close:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{
  useUtils:()=>({user:{securityStatus:{invalidate:vi.fn()}}}),
  user:{securityStatus:{useQuery:()=>mock.security},hasPin:{useQuery:()=>({data:{hasPin:false}})},verifyPin:{useMutation:()=>({mutateAsync:mock.verify,isLoading:false})}},
  businessManagement:{copyAccount:{useMutation:(options:any)=>({isLoading:false,reset:vi.fn(),mutate:(input:any)=>{void mock.copy(input).then((r:any)=>options?.onSuccess?.(r,input));},mutateAsync:mock.copy})}},
  accountStore:{updateLogin:{useMutation:()=>({isLoading:false,mutateAsync:vi.fn()})}},
}}));
vi.mock('@/components/ui/dialog',()=>({Dialog:({children,open}:any)=>open?<div>{children}</div>:null,DialogContent:({children}:any)=><div>{children}</div>,DialogHeader:({children}:any)=><header>{children}</header>,DialogTitle:({children}:any)=><h2>{children}</h2>,DialogDescription:({children}:any)=><p>{children}</p>}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}));
import {PinVerifyDialog,usePinAction} from '@/components/PinVerify';
import {AccountCopy} from '@/components/business-management/AccountsWorkspace';
import {AccountDetail} from '@/components/account-store/AccountDetail';
const account={id:'synthetic-account',email:'synthetic@example.invalid',revision:2};
function Action(){const {requirePin,PinDialog}=usePinAction();return <><button onClick={()=>requirePin(mock.action)}>Reveal</button>{PinDialog}</>;}
let dom:JSDOM,root:Root,host:HTMLDivElement;
beforeEach(async()=>{dom=new JSDOM('<html><body></body></html>',{url:'http://localhost'});for(const [k,v] of Object.entries({React,window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true}))vi.stubGlobal(k,v);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:mock.clipboard}});host=document.createElement('div');document.body.appendChild(host);const {createRoot}=await import('react-dom/client');root=createRoot(host);vi.clearAllMocks();mock.security.error=null;mock.security.data={totpEnabled:true,hasPin:false,unlocked:false};mock.verify.mockResolvedValue({valid:true});mock.copy.mockResolvedValue({email:account.email,secret:'SyntheticPassword!',twoFa:null,token:null,twoFaLink:null,smsLink:null,phone:null});mock.clipboard.mockResolvedValue(undefined);});
afterEach(async()=>{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals();});
const render=async(node:React.ReactNode)=>act(async()=>root.render(node));
const button=(text:string)=>{const b=Array.from(host.querySelectorAll('button')).find(b=>b.textContent===text);if(!b)throw Error('Missing button '+text);return b;};
const click=async(text:string)=>act(async()=>button(text).click());
async function fill(value:string){await act(async()=>{const el=host.querySelector('input')!;Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
it('uses securityStatus instead of the retired hasPin flag, and reuses an unlocked server session',async()=>{
  await render(<Action/>);await click('Reveal');expect(mock.action).not.toHaveBeenCalled();
  await fill('123456');await click('Verify');expect(mock.verify).toHaveBeenCalledWith({pin:'123456'});expect(mock.action).toHaveBeenCalledTimes(1);
  mock.security.data={totpEnabled:true,hasPin:false,unlocked:true};await render(<Action/>);await click('Reveal');expect(mock.action).toHaveBeenCalledTimes(2);expect(mock.verify).toHaveBeenCalledTimes(1);
});
it('rejects partial TOTP locally and accepts a full pasted backup code without browser truncation',async()=>{
  await render(<PinVerifyDialog open onClose={mock.close} onVerified={mock.action}/>);
  await fill('1234');expect(button('Verify').disabled).toBe(true);
  await act(async()=>host.querySelector('input')!.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(mock.verify).not.toHaveBeenCalled();
  expect(host.querySelector('input')!.maxLength).toBeGreaterThanOrEqual(13);
  await fill('abcde - abcde');expect(button('Verify').disabled).toBe(false);await click('Verify');expect(mock.verify).toHaveBeenCalledWith({pin:'abcde-abcde'});
});
it('keeps own 4-6 digit PIN support without making the user prove an already unlocked session again',async()=>{
  mock.security.data={totpEnabled:false,hasPin:true,unlocked:false};await render(<PinVerifyDialog open onClose={mock.close} onVerified={mock.action}/>);await fill('1234');await click('Verify');expect(mock.verify).toHaveBeenCalledWith({pin:'1234'});
});
it('account copy labels the factor as the signed-in person’s own PIN/Google code and validates input before sending',async()=>{
  await render(<React.StrictMode><AccountCopy projectId="allowed-project" kind="GMAIL" row={account as never} onClose={mock.close}/></React.StrictMode>);
  expect(host.textContent).toContain('của bạn');expect(host.textContent).toContain('Google Authenticator');
  await fill('12');expect(button('Copy').disabled).toBe(true);expect(mock.copy).not.toHaveBeenCalled();
  await fill('123456');await act(async()=>host.querySelector('form')!.requestSubmit());expect(mock.copy).toHaveBeenCalledWith({projectId:'allowed-project',kind:'GMAIL',id:account.id,pin:'123456'});
});
it('clipboard rejection leaves a manual copy result and never resends an account request with a consumed TOTP',async()=>{
  mock.clipboard.mockRejectedValue(new Error('NotAllowedError'));
  await render(<AccountCopy projectId="allowed-project" kind="GMAIL" row={account as never} onClose={mock.close}/>);await fill('123456');await act(async()=>host.querySelector('form')!.requestSubmit());
  expect((host.querySelector('textarea[aria-label="Thông tin đăng nhập để copy"]') as HTMLTextAreaElement)?.value).toBe(account.email+'\tSyntheticPassword!');
  expect(mock.copy).toHaveBeenCalledTimes(1);await click('Copy lại');expect(mock.copy).toHaveBeenCalledTimes(1);expect(mock.clipboard).toHaveBeenCalledTimes(2);
});
it('verified HTTP-session account copy sends no PIN or client-trust flag',async()=>{
  mock.security.data={totpEnabled:true,hasPin:false,unlocked:true};
  await render(<AccountCopy projectId="allowed-project" kind="GMAIL" row={account as never} onClose={mock.close}/>);
  expect(host.querySelector('input')).toBeNull();await act(async()=>host.querySelector('form')!.requestSubmit());
  expect(mock.copy).toHaveBeenCalledWith({projectId:'allowed-project',kind:'GMAIL',id:account.id});
});
const detailRow={...account,type:'GMAIL',status:'ACTIVE',notes:null,recoveryEmail:null,phone:null,has:{password:true,twoFa:false,token:false},links:{twoFa:false,sms:false}};
const detail=()=> <AccountDetail projectId="allowed-project" login={detailRow as never} canEdit={false} canCopy onSaved={()=>{}} onClose={mock.close}/>;
const reveal=async()=>act(async()=>(host.querySelector('[aria-label="Xem Mật khẩu synthetic@example.invalid"]') as HTMLButtonElement).click());
it('immediate session-based detail failures stay visible, with no code recheck',async()=>{
  mock.security.data={totpEnabled:true,hasPin:false,unlocked:true};mock.copy.mockRejectedValue(new Error('Không có quyền trên server này'));
  await render(detail());await reveal();expect(host.querySelector('[role="alert"]')?.textContent).toBe('Không có quyền trên server này');
  expect(mock.copy).toHaveBeenCalledWith({projectId:'allowed-project',kind:'GMAIL',id:account.id});
});
it('detail drops held credentials and reveal state when the session locks',async()=>{
  mock.security.data={totpEnabled:true,hasPin:false,unlocked:true};await render(detail());await reveal();expect(host.textContent).toContain('SyntheticPassword!');
  mock.security.data={totpEnabled:true,hasPin:false,unlocked:false};await render(detail());expect(host.textContent).not.toContain('SyntheticPassword!');expect(host.querySelector('[data-masked="1"]')).not.toBeNull();
});
const allowed=()=>{mock.security.data={totpEnabled:true,hasPin:false,unlocked:true};mock.security.error=null;};
const revoke=(why:'lock'|'error')=>{if(why==='lock')mock.security.data={totpEnabled:true,hasPin:false,unlocked:false};else mock.security.error=new Error('Security status unavailable');};
const copyDialog=()=> <AccountCopy projectId="allowed-project" kind="GMAIL" row={account as never} onClose={mock.close}/>;
const response={email:account.email,secret:'LateSyntheticPassword!',twoFa:null,token:null,twoFaLink:null,smsLink:null,phone:null};
it('P2 detail clears displayed secrets on security-query error even if stale unlocked data remains',async()=>{
  allowed();await render(detail());await reveal();expect(host.textContent).toContain('SyntheticPassword!');
  revoke('error');await render(detail());expect(host.textContent).not.toContain('SyntheticPassword!');expect(host.querySelector('[role="alert"]')?.textContent).toContain('Security status unavailable');
  await reveal();expect(mock.copy).toHaveBeenCalledTimes(1);expect(mock.clipboard).not.toHaveBeenCalled();
  allowed();await render(detail());expect(host.textContent).not.toContain('SyntheticPassword!');
});
it.each(['lock','error'] as const)('P2 detail discards an in-flight response after %s and recovery, and never runs its pending copy',async why=>{
  allowed();let finish!:(result:typeof response)=>void;mock.copy.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await render(detail());await act(async()=>(host.querySelector('[aria-label="Copy Mật khẩu synthetic@example.invalid"]') as HTMLButtonElement).click());
  revoke(why);await render(detail());allowed();await render(detail());
  await act(async()=>finish(response));expect(host.textContent).not.toContain('LateSyntheticPassword!');expect(mock.clipboard).not.toHaveBeenCalled();
  await reveal();expect(mock.copy).toHaveBeenCalledTimes(2);expect(host.textContent).toContain('SyntheticPassword!');
});
it('P2 account copy purges its manual-copy cache on security error and blocks copying stale data',async()=>{
  allowed();mock.clipboard.mockRejectedValue(new Error('NotAllowedError'));await render(copyDialog());await act(async()=>host.querySelector('form')!.requestSubmit());
  expect(host.querySelector('textarea')).not.toBeNull();revoke('error');await render(copyDialog());
  expect(host.querySelector('textarea')).toBeNull();expect(host.querySelector('[role="alert"]')?.textContent).toContain('Security status unavailable');
  expect(button('Copy').disabled).toBe(true);allowed();await render(copyDialog());expect(host.querySelector('textarea')).toBeNull();expect(mock.copy).toHaveBeenCalledTimes(1);
});
it.each(['lock','error'] as const)('P2 account copy discards an in-flight response after %s and recovery before any clipboard write',async why=>{
  allowed();let finish!:(result:typeof response)=>void;mock.copy.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  await render(copyDialog());await act(async()=>host.querySelector('form')!.requestSubmit());revoke(why);await render(copyDialog());allowed();await render(copyDialog());
  await act(async()=>finish(response));expect(mock.clipboard).not.toHaveBeenCalled();expect(mock.close).not.toHaveBeenCalled();expect(host.querySelector('textarea')).toBeNull();
});
it('P2 account copy removes a held secret link on relock and does not restore it after unlock',async()=>{
  allowed();mock.copy.mockResolvedValueOnce({...response,twoFaLink:'https://example.invalid/private-code'});
  const dialog=()=> <AccountCopy projectId="allowed-project" kind="GMAIL" row={account as never} initialField="twoFaLink" onClose={mock.close}/>;
  await render(dialog());await act(async()=>host.querySelector('form')!.requestSubmit());expect(host.querySelector('[data-testid="account-link"]')).not.toBeNull();
  revoke('lock');await render(dialog());expect(host.querySelector('[data-testid="account-link"]')).toBeNull();allowed();await render(dialog());expect(host.textContent).not.toContain('https://example.invalid/private-code');
});
