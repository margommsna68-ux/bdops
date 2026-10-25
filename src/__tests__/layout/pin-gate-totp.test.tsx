import React,{act} from 'react';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
// 2FA gate (owner decision 23/10/2026). Component lifecycle only: no browser, database or network; the security status is a mocked
// answer of user.securityStatus, exactly what the server would decide.
const mock=vi.hoisted(()=>({status:{data:undefined as unknown,isLoading:false,refetch:vi.fn()},verify:vi.fn(),setPin:vi.fn(),begin:vi.fn(),confirm:vi.fn(),heartbeat:vi.fn(),invalidate:vi.fn(),setOwnPassword:vi.fn()}));
vi.mock('@/lib/trpc',()=>({trpc:{
  useUtils:()=>({invalidate:mock.invalidate}),
  user:{
    securityStatus:{useQuery:()=>mock.status},
    verifyPin:{useMutation:()=>({mutateAsync:mock.verify,isLoading:false})},
    setPin:{useMutation:()=>({mutateAsync:mock.setPin,isLoading:false})},
    totpBegin:{useMutation:()=>({mutateAsync:mock.begin,isLoading:false})},
    totpConfirm:{useMutation:()=>({mutateAsync:mock.confirm,isLoading:false})},
    heartbeat:{useMutation:()=>({mutate:mock.heartbeat})},
    setOwnPassword:{useMutation:()=>({mutateAsync:mock.setOwnPassword,isLoading:false})},
  },
}}));
import {PinGate} from '@/components/PinGate';
import {personalItems,visibleMenu,type NavItem,type NavLinkItem} from '@/components/layout/nav';
import {countdown,summaryPairs} from '@/lib/approvals-ui';
type Root={render:(n:React.ReactNode)=>void;unmount:()=>void};
let dom:JSDOM,container:HTMLDivElement,root:Root,createRoot:(c:Element)=>Root;
const saved=new Map<string,PropertyDescriptor|undefined>();
beforeAll(async()=>{
  dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost/'});
  for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,sessionStorage:dom.window.sessionStorage,React,IS_REACT_ACT_ENVIRONMENT:true})){saved.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});}
  ({createRoot}=await import('react-dom/client') as unknown as {createRoot:(c:Element)=>Root});
});
beforeEach(()=>{vi.clearAllMocks();mock.status.data=undefined;container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();});
afterAll(()=>{dom.window.close();for(const [k,d] of saved){if(d)Object.defineProperty(globalThis,k,d);else Reflect.deleteProperty(globalThis,k);}});
const base={totpEnabled:false,totpRequired:false,setupStarted:false,hasPin:true,unlocked:false,backupCodesLeft:0,passwordResetRequired:false};
const gate=async(status:Partial<typeof base>)=>{mock.status.data={...base,...status};await act(async()=>root.render(<PinGate><div data-testid="app">APP</div></PinGate>));};
const button=(name:string)=>{const b=Array.from(container.querySelectorAll('button')).find(e=>e.textContent===name);if(!b)throw new Error('Missing button '+name);return b as HTMLButtonElement;};
const click=async(name:string)=>act(async()=>button(name).click());
async function fill(el:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});}
describe('PinGate with 2FA',()=>{
  it('does not open the app from a successful verification unless the refetched server session is unlocked',async()=>{
    await gate({totpEnabled:true,hasPin:false});mock.verify.mockResolvedValue({valid:true});mock.status.refetch.mockResolvedValue({data:{...base,totpEnabled:true,hasPin:false,unlocked:false}});
    await fill(container.querySelector('[aria-label="Mã Google Authenticator"]') as HTMLInputElement,'123456');await click('Mở khoá');
    expect(container.querySelector('[data-testid="app"]')).toBeNull();expect(container.textContent).toContain('Phiên chưa được mở khoá');
    mock.status.refetch.mockResolvedValue({data:{...base,totpEnabled:true,hasPin:false,unlocked:true}});
    await fill(container.querySelector('[aria-label="Mã Google Authenticator"]') as HTMLInputElement,'234567');await click('Mở khoá');expect(container.querySelector('[data-testid="app"]')).not.toBeNull();
  });
  it('does not send partial TOTP on Enter and accepts formatted backup-code paste without truncation',async()=>{
    await gate({totpEnabled:true,hasPin:false});const input=container.querySelector('[aria-label="Mã Google Authenticator"]') as HTMLInputElement;
    expect(input.maxLength).toBeGreaterThanOrEqual(13);await fill(input,'1234');expect(button('Mở khoá').disabled).toBe(true);
    await act(async()=>input.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(mock.verify).not.toHaveBeenCalled();
    await fill(input,'abcde - abcde');expect(input.value).toBe('abcde-abcde');expect(button('Mở khoá').disabled).toBe(false);
  });
  it('after an ADMIN reset the person must choose their own password first (before any PIN / 2FA prompt)',async()=>{
    await gate({passwordResetRequired:true,totpEnabled:true});
    expect(container.querySelector('[data-testid="pin-gate-password"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="password-reset-form"]')).not.toBeNull();
    const inputs=Array.from(container.querySelectorAll('input')) as HTMLInputElement[];
    await fill(inputs[0],'MatKhauMoi-2026');await fill(inputs[1],'MatKhauMoi-2026');
    mock.setOwnPassword.mockResolvedValue({success:true});
    await click('Lưu mật khẩu và tiếp tục');
    expect(mock.setOwnPassword).toHaveBeenCalledWith({newPassword:'MatKhauMoi-2026'});
    expect(mock.status.refetch).toHaveBeenCalled();
  });
  it('forces the 2FA setup when an ADMIN required it and the person has not set it up (no PIN prompt, no way to skip)',async()=>{
    await gate({totpRequired:true,totpEnabled:false,hasPin:true});
    expect(container.querySelector('[data-testid="pin-gate-setup2fa"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="totp-setup-start"]')).not.toBeNull();
    expect(container.textContent).toContain('Cần bật xác thực 2 lớp');
    expect(container.querySelector('[aria-label="PIN"]')).toBeNull();
    expect(Array.from(container.querySelectorAll('button')).map(b=>b.textContent)).not.toContain('Để sau');
    expect(container.querySelector('[data-testid="app"]')).toBeNull();
    // Bắt đầu → QR + secret from the server; the first code confirms; the backup codes are shown once behind the "đã lưu" checkbox.
    mock.begin.mockResolvedValue({secret:'SYNTHETICSECRETBASE32XX',otpauthUrl:'otpauth://totp/x',qrDataUrl:'data:image/png;base64,AAAA'});
    await click('Bắt đầu');
    expect((container.querySelector('img') as HTMLImageElement).getAttribute('src')).toBe('data:image/png;base64,AAAA');
    await click('Nhập thủ công nếu không quét được');expect(container.querySelector('[data-testid="totp-secret"]')?.textContent?.replace(/\s/g,'')).toBe('SYNTHETICSECRETBASE32XX');
    mock.confirm.mockResolvedValue({backupCodes:['aaaaa-11111','bbbbb-22222'],totpVersion:1});
    await fill(container.querySelector('[aria-label="Mã 6 số"]') as HTMLInputElement,'123456');await click('Xác nhận và bật 2FA');
    expect(mock.confirm).toHaveBeenCalledWith({code:'123456'});
    expect(container.textContent).toContain('aaaaa-11111');expect(button('Tiếp tục').disabled).toBe(true);
    await act(async()=>{(container.querySelector('input[type="checkbox"]') as HTMLInputElement).click();});
    expect(button('Tiếp tục').disabled).toBe(false);
  });
  it('asks for the Google Authenticator code when 2FA is on and this session is not unlocked; the code goes to user.verifyPin',async()=>{
    await gate({totpEnabled:true,unlocked:false,hasPin:false});
    expect(container.querySelector('[data-testid="pin-gate-code"]')).not.toBeNull();
    expect(container.textContent).toContain('Nhập mã Google Authenticator');
    expect(container.querySelector('[data-testid="app"]')).toBeNull();
    mock.verify.mockRejectedValueOnce(new Error('PIN_LOCKED: Sai mã 3 lần; thử lại sau 30 phút'));
    await fill(container.querySelector('[aria-label="Mã Google Authenticator"]') as HTMLInputElement,'000000');await click('Mở khoá');
    expect(mock.verify).toHaveBeenCalledWith({pin:'000000'});
    expect(container.textContent).toContain('Sai mã 3 lần; thử lại sau 30 phút');expect(container.textContent).not.toContain('PIN_LOCKED');
    // A backup code is accepted by the input as well (letters and the dash).
    await fill(container.querySelector('[aria-label="Mã Google Authenticator"]') as HTMLInputElement,'abcde-23456');
    expect((container.querySelector('[aria-label="Mã Google Authenticator"]') as HTMLInputElement).value).toBe('abcde-23456');
    expect(button('Mở khoá').disabled).toBe(false);
  });
  it('keeps the PIN prompt (with the opt-in link) when 2FA is neither on nor required, and lets the app through once unlocked',async()=>{
    await gate({totpEnabled:false,totpRequired:false,hasPin:true,unlocked:false});
    expect(container.querySelector('[data-testid="pin-gate-verify"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="PIN"]')).not.toBeNull();
    expect(container.textContent).toContain('Bật 2FA (khuyên dùng)');
    await click('Bật 2FA (khuyên dùng)');expect(container.querySelector('[data-testid="totp-setup-start"]')).not.toBeNull();expect(container.textContent).toContain('Để sau');
    await click('Để sau');expect(container.querySelector('[data-testid="pin-gate-verify"]')).not.toBeNull();
    // No PIN yet → the legacy setup; unlocked → children render, no overlay.
    await gate({hasPin:false});expect(container.querySelector('[data-testid="pin-gate-setup"]')).not.toBeNull();
    await gate({hasPin:true,unlocked:true});expect(container.querySelector('[data-testid="app"]')).not.toBeNull();expect(container.querySelector('.mth-pin-backdrop')).toBeNull();
  });
});
describe('Phê duyệt menu and helpers',()=>{
  const hrefs=(items:NavItem[])=>items.filter((i):i is NavLinkItem=>!('type' in i)).map(i=>i.href);
  it('shows /approvals to the ADMIN of the project only',()=>{
    expect(hrefs(visibleMenu(personalItems(true),{role:'ADMIN',modules:[]}))).toContain('/approvals');
    expect(hrefs(visibleMenu(personalItems(true),{role:'MODERATOR',modules:['INFRASTRUCTURE'],canManageUsers:true}))).not.toContain('/approvals');
    expect(hrefs(visibleMenu(personalItems(true),{role:'USER',modules:['INFRASTRUCTURE']}))).not.toContain('/approvals');
  });
  it('renders the allowed summary fields as label / value pairs and counts down to the expiry',()=>{
    expect(summaryPairs({action:'SDK_REVEAL',label:'x',sdk:'sdk-…9f2a',vm:'moon01 / VM_001'})).toEqual([{key:'vm',label:'VM',value:'moon01 / VM_001'},{key:'sdk',label:'Mã SDK (che)',value:'sdk-…9f2a'}]);
    expect(countdown('2026-10-23T10:15:00.000Z',Date.parse('2026-10-23T10:13:30.000Z'))).toBe('còn 1 phút 30 giây');
    expect(countdown('2026-10-23T10:15:00.000Z',Date.parse('2026-10-23T10:15:00.000Z'))).toBe('Hết hạn');
  });
});
