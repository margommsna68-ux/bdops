"use client";
import {Input} from '@/components/ui/input';
// The ADMIN's own Google Authenticator code (or a backup code): shared by "Duyệt" / "Từ chối" of one row, "Mở phiên 15 phút" and
// "Duyệt tất cả đang chờ". Only digits, letters and '-' are kept; Enter submits.
export function TotpCodeInput({value,onChange,onSubmit,autoFocus=true}:{value:string;onChange:(v:string)=>void;onSubmit:()=>void;autoFocus?:boolean}){
  return <label className="block space-y-1 text-sm"><span className="text-xs text-gray-600">Mã Google Authenticator của bạn</span>
    <Input inputMode="numeric" autoComplete="one-time-code" maxLength={11} aria-label="Mã Google Authenticator của bạn" value={value} autoFocus={autoFocus} placeholder="000000"
      onChange={e=>onChange(e.target.value.replace(/[^0-9a-zA-Z-]/g,''))} onKeyDown={e=>{if(e.key==='Enter')onSubmit();}} className="text-center text-xl tracking-[0.3em]"/></label>;
}
