"use client";
import {useEffect,useRef,useState} from 'react';
import {trpc} from '@/lib/trpc';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
// 2FA setup (owner decision 23/10/2026): Google Authenticator replaces the PIN. The secret and the QR come from the server for THIS
// session only (user.totpBegin); the first correct code confirms (user.totpConfirm) and the 8 backup codes are shown ONCE. Nothing is
// kept in the browser: a reload starts again from "Bắt đầu". Used by PinGate (forced / opt-in) and Thiết lập → Bảo mật.
export interface TotpSetupProps {
  /** The person cannot leave (ADMIN required 2FA): no cancel button. */
  forced?:boolean;
  /** Start the server call right away (opt-in from a button that already said "Bật 2FA"). */
  autoStart?:boolean;
  onDone:()=>void;
  onCancel?:()=>void;
}
export function TotpSetup({forced,autoStart,onDone,onCancel}:TotpSetupProps){
  const begin=trpc.user.totpBegin.useMutation(),confirm=trpc.user.totpConfirm.useMutation();
  const [setup,setSetup]=useState<{secret:string;otpauthUrl:string;qrDataUrl:string}|null>(null);
  const [code,setCode]=useState(''),[error,setError]=useState(''),[manual,setManual]=useState(false),[copied,setCopied]=useState<''|'secret'|'codes'>('');
  const [backup,setBackup]=useState<string[]|null>(null),[saved,setSaved]=useState(false);
  const started=useRef(false);
  async function start(){
    if(begin.isLoading)return;setError('');
    try{setSetup(await begin.mutateAsync());}
    catch(e){setError(e instanceof Error?e.message:'Không bắt đầu được cài 2FA');}
  }
  useEffect(()=>{if(autoStart&&!started.current){started.current=true;void start();}},[autoStart]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit(){
    if(confirm.isLoading||code.length!==6)return;setError('');
    try{const r=await confirm.mutateAsync({code});setBackup(r.backupCodes);setCode('');setSetup(null);}
    catch(e){setError(e instanceof Error?e.message:'Mã chưa đúng');setCode('');}
  }
  const copy=async(text:string,what:'secret'|'codes')=>{try{await navigator.clipboard?.writeText(text);setCopied(what);setTimeout(()=>setCopied(''),2000);}catch{setError('Không copy được; hãy chép tay');}};
  if(backup){
    return <div className="space-y-4" data-testid="totp-backup-codes">
      <div><h2 className="text-lg font-semibold text-gray-900">Đã bật 2FA</h2>
        <p className="text-sm text-gray-600 mt-1">8 mã dự phòng dưới đây <strong>chỉ hiện một lần</strong>. Mỗi mã dùng được một lần khi không có điện thoại. Lưu vào nơi an toàn, không gửi qua chat.</p></div>
      <ol className="grid grid-cols-2 gap-1.5 font-mono text-sm rounded-md border border-gray-200 bg-gray-50 p-3 text-gray-900" aria-label="Mã dự phòng">
        {backup.map(c=><li key={c} className="px-1">{c}</li>)}
      </ol>
      <div className="flex flex-wrap gap-2 items-center">
        <Button size="sm" variant="outline" onClick={()=>void copy(backup.join('\n'),'codes')}>{copied==='codes'?'Đã copy':'Copy tất cả'}</Button>
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-800"><input type="checkbox" className="mt-0.5" checked={saved} onChange={e=>setSaved(e.target.checked)}/><span>Tôi đã lưu mã dự phòng</span></label>
      {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
      <Button className="w-full" disabled={!saved} onClick={onDone}>Tiếp tục</Button>
    </div>;
  }
  if(!setup){
    return <div className="space-y-4" data-testid="totp-setup-start">
      <div><h2 className="text-lg font-semibold text-gray-900">{forced?'Cần bật xác thực 2 lớp (2FA)':'Bật xác thực 2 lớp (2FA)'}</h2>
        <p className="text-sm text-gray-600 mt-1">{forced?'ADMIN yêu cầu tài khoản của bạn dùng Google Authenticator. Bạn cần cài xong mới vào được MoneyToHome.':'Mã Google Authenticator thay cho PIN khi đăng nhập, mở khoá và các thao tác nhạy cảm.'}</p>
        <p className="text-xs text-gray-500 mt-2">Cần ứng dụng Google Authenticator (hoặc ứng dụng TOTP tương tự) trên điện thoại.</p></div>
      {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button className="flex-1" onClick={()=>void start()} disabled={begin.isLoading} autoFocus>{begin.isLoading?'Đang chuẩn bị…':'Bắt đầu'}</Button>
        {!forced&&onCancel&&<Button variant="outline" onClick={onCancel} disabled={begin.isLoading}>Để sau</Button>}
      </div>
    </div>;
  }
  return <div className="space-y-4" data-testid="totp-setup-scan">
    <div><h2 className="text-lg font-semibold text-gray-900">Quét mã bằng Google Authenticator</h2>
      <p className="text-sm text-gray-600 mt-1">Mở ứng dụng → thêm tài khoản → quét mã. Sau đó nhập 6 số ứng dụng hiện ra.</p></div>
    <div className="flex justify-center"><img src={setup.qrDataUrl} alt="Mã QR cài 2FA" width={200} height={200} className="rounded-md border border-gray-200 bg-white"/></div>
    <div className="space-y-1.5">
      <button type="button" className="text-xs text-blue-600 hover:underline" onClick={()=>setManual(v=>!v)}>{manual?'Ẩn khoá':'Nhập thủ công nếu không quét được'}</button>
      {manual&&<div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 break-all rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 font-mono text-sm text-gray-900" data-testid="totp-secret">{setup.secret.replace(/(.{4})/g,'$1 ').trim()}</code>
        <Button size="sm" variant="outline" onClick={()=>void copy(setup.secret,'secret')}>{copied==='secret'?'Đã copy':'Copy'}</Button>
      </div>}
      {manual&&<p className="text-xs text-gray-500">Loại: theo thời gian (TOTP), 6 số, 30 giây.</p>}
    </div>
    <label className="block space-y-1"><span className="text-xs text-gray-600">Mã 6 số trong ứng dụng</span>
      <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} aria-label="Mã 6 số" value={code} autoFocus
        onChange={e=>setCode(e.target.value.replace(/\D/g,'').slice(0,6))} onKeyDown={e=>{if(e.key==='Enter')void submit();}}
        className="text-center text-2xl tracking-[0.5em]"/></label>
    {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex gap-2">
      <Button className="flex-1" disabled={code.length!==6||confirm.isLoading} onClick={()=>void submit()}>{confirm.isLoading?'Đang kiểm tra…':'Xác nhận và bật 2FA'}</Button>
      {!forced&&onCancel&&<Button variant="outline" onClick={onCancel} disabled={confirm.isLoading}>Huỷ</Button>}
    </div>
    <p className="text-xs text-gray-500">Sau khi bật, PIN cũ không dùng nữa; đăng nhập và mở khoá đều hỏi mã trong ứng dụng.</p>
  </div>;
}
