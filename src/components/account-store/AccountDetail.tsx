"use client";
import React,{useEffect,useMemo,useRef,useState} from 'react';
import toast from 'react-hot-toast';
import {Copy,Eye,EyeOff,ExternalLink,Loader2,Lock,X} from 'lucide-react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {errorMessage} from '@/components/vm-management/shared';
type Login=inferRouterOutputs<AppRouter>['accountStore']['store']['logins'][number];
type Field='email'|'password'|'twoFa'|'token'|'recoveryEmail'|'twoFaLink'|'smsLink'|'phone'|'notes';
type Secrets={secret:string;twoFa:string|null;token:string|null;twoFaLink:string|null;smsLink:string|null;phone:string|null};
const LABEL:Record<Field,string>={email:'Email đăng nhập',password:'Mật khẩu',twoFa:'Mã 2FA (TOTP)',token:'Token',recoveryEmail:'Email khôi phục',twoFaLink:'Link lấy mã 2FA',smsLink:'Link SMS',phone:'Số điện thoại',notes:'Ghi chú'};
const SECRET:Field[]=['password','twoFa','token','twoFaLink','smsLink'];
const EMAIL=/^[^\s@|:\t]+@[^\s@|:\t]+\.[^\s@|:\t]+$/,PHONE=/^\+?[0-9][0-9 .()-]{2,39}$/,LINK=/^https?:\/\/\S+$/i;
// Khung chi tiết of one Gmail / Apple ID (owner brief 20/10/2026), opened from the email in the table, inside the page.
// - Apple ID (five-column list): Email đăng nhập, Mật khẩu, Link lấy mã 2FA, Link SMS, Số điện thoại, Ghi chú. An account recorded with
//   the older pattern shows what it stored (2FA TOTP, Email khôi phục, Token); empty secret kinds are never offered.
// - Secrets come only through the existing copy right + PIN (businessManagement.copyAccount), are kept in this component's memory while
//   it is open and are dropped on close; the password stays masked until Xem; the two links open only on a click.
// - Sửa: one Lưu, muted until something valid changed. Only changed fields are sent; a masked / not loaded secret box left empty keeps
//   the stored value; clearing a field is its own button ("Xoá trường này"). Errors show at the field and the draft stays.
export function AccountDetail({projectId,login,canEdit,canCopy,onSaved,onClose}:{projectId:string;login:Login;canEdit:boolean;canCopy:boolean;onSaved:()=>void;onClose:()=>void}){
  const has={password:login.has.password,twoFa:login.has.twoFa,token:login.has.token,twoFaLink:login.links.twoFa,smsLink:login.links.sms};
  const classic=!!(login.has.twoFa||login.has.token||login.recoveryEmail)||login.type!=='APPLE_ID';
  const shown:Field[]=classic?['email','password',...(login.has.twoFa||login.type==='GMAIL'?['twoFa' as Field]:[]),'recoveryEmail',...(login.has.token?['token' as Field]:[]),...(login.links.twoFa?['twoFaLink' as Field]:[]),...(login.links.sms?['smsLink' as Field]:[]),...(login.phone?['phone' as Field]:[]),'notes']:['email','password','twoFaLink','smsLink','phone','notes'];
  const copyAcc=trpc.businessManagement.copyAccount.useMutation(),save=trpc.accountStore.updateLogin.useMutation();
  const [secrets,setSecrets]=useState<Secrets|null>(null),[pin,setPin]=useState(''),[askPin,setAskPin]=useState(false),[pinError,setPinError]=useState(''),[reveal,setReveal]=useState<Partial<Record<Field,boolean>>>({});
  const pending=useRef<((s:Secrets)=>void)|undefined>(undefined);useEffect(()=>()=>{setSecrets(null);},[]);
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState<Partial<Record<Field,string>>>({}),[clear,setClear]=useState<Partial<Record<Field,boolean>>>({}),[errors,setErrors]=useState<Partial<Record<Field,string>>>({}),[general,setGeneral]=useState(''),keyRef=useRef<{sig:string;key:string}|null>(null);
  const original:Record<Field,string>={email:login.email,password:'',twoFa:'',token:'',recoveryEmail:login.recoveryEmail||'',twoFaLink:'',smsLink:'',phone:login.phone||'',notes:login.notes||''};
  useEffect(()=>{setDraft({});setClear({});setErrors({});setGeneral('');},[login.revision]);
  const copyText=(t:string,what:string)=>navigator.clipboard.writeText(t).then(()=>toast.success('Đã copy '+what),()=>toast.error('Trình duyệt chưa cho phép copy'));
  // Secret actions wait for the PIN once; the action runs right after the server answers.
  function withSecrets(run:(s:Secrets)=>void){if(secrets){run(secrets);return;}pending.current=run;setAskPin(true);setPinError('');}
  async function unlock(){setPinError('');try{const r=await copyAcc.mutateAsync({projectId,kind:'GMAIL',id:login.id,pin});const s:Secrets={secret:r.secret,twoFa:r.twoFa,token:r.token,twoFaLink:r.twoFaLink,smsLink:r.smsLink,phone:r.phone};setSecrets(s);setPin('');setAskPin(false);pending.current?.(s);pending.current=undefined;}catch(e){setPinError(errorMessage(e));}}
  const secretOf=(s:Secrets,f:Field)=>f==='password'?s.secret:(s[f as keyof Secrets] as string|null)||'';
  // What would be sent: changed plain fields, typed secrets, explicit clears. Checked here too so Lưu stays muted when invalid.
  const changes=useMemo(()=>{const c:Partial<Record<Field,string|null>>={},bad:Partial<Record<Field,string>>={};
    for(const f of shown){
      if(clear[f]){c[f]=null;continue;}
      const v=draft[f];if(v===undefined)continue;
      if(SECRET.includes(f)){if(v==='')continue;c[f]=f==='twoFaLink'||f==='smsLink'?v.trim():v;}
      else if(v.trim()!==original[f].trim()){if(!v.trim()){bad[f]='Để trống không phải là xoá; dùng "Xoá trường này"';continue;}c[f]=v.trim();}
      const n=c[f];if(typeof n==='string'){if((f==='email'||f==='recoveryEmail')&&!EMAIL.test(n.toLowerCase()))bad[f]='Email không hợp lệ';if((f==='twoFaLink'||f==='smsLink')&&!LINK.test(n))bad[f]='Phải là đường dẫn http:// hoặc https://';if(f==='phone'&&!PHONE.test(n))bad[f]='Chỉ gồm số, dấu + và khoảng trắng';}
    }
    return {c,bad,count:Object.keys(c).length,valid:!Object.keys(bad).length};
  },[draft,clear,shown.join(),login.revision]);// eslint-disable-line react-hooks/exhaustive-deps
  async function submit(){
    if(!changes.count||!changes.valid||save.isLoading)return;setGeneral('');setErrors({});
    const sig=JSON.stringify(changes.c),key=keyRef.current?.sig===sig?keyRef.current.key:crypto.randomUUID();keyRef.current={sig,key};
    try{const r=await save.mutateAsync({projectId,id:login.id,expectedRevision:login.revision,key,changes:changes.c});keyRef.current=null;
      toast.success(r.changed?r.message:'Không thay đổi');setSecrets(null);setReveal({});setEditing(false);onSaved();}
    catch(e){const m=errorMessage(e),f=(Object.keys(LABEL) as Field[]).find(k=>m.startsWith(LABEL[k]+':'));if(f)setErrors({[f]:m.slice(LABEL[f].length+1).trim()});else setGeneral(m);}
  }
  const field=(f:Field)=>{
    const secret=SECRET.includes(f),stored=secret?has[f as keyof typeof has]:!!original[f],cleared=!!clear[f],err=errors[f]||changes.bad[f];
    const view=secret?(!stored?<span className="pm-muted">Chưa có</span>:f==='twoFaLink'||f==='smsLink'?<span className="flex gap-2 items-center flex-wrap">
        {canCopy&&<button type="button" className="pm-button pm-button-sm" onClick={()=>withSecrets(s=>{const l=secretOf(s,f);if(l)window.open(l,'_blank','noopener,noreferrer');})}><ExternalLink size={14}/>{f==='twoFaLink'?'Lấy mã 2FA':'SMS'}</button>}
        {canCopy&&<button type="button" className="pm-icon-button" aria-label={'Copy '+LABEL[f]+' '+login.email} title={'Copy '+LABEL[f]} onClick={()=>withSecrets(s=>void copyText(secretOf(s,f),LABEL[f]))}><Copy size={14}/></button>}{!canCopy&&<span className="pm-muted text-xs">Có (cần quyền copy để mở)</span>}</span>
      :<span className="flex gap-2 items-center flex-wrap"><code className="acc-secret" data-masked={reveal[f]&&secrets?'0':'1'}>{reveal[f]&&secrets?secretOf(secrets,f):'••••••••'}</code>
        {canCopy&&<button type="button" className="pm-icon-button" aria-label={(reveal[f]?'Ẩn ':'Xem ')+LABEL[f]+' '+login.email} title={reveal[f]?'Ẩn':'Xem'} onClick={()=>reveal[f]?setReveal(r=>({...r,[f]:false})):withSecrets(()=>setReveal(r=>({...r,[f]:true})))}>{reveal[f]?<EyeOff size={14}/>:<Eye size={14}/>}</button>}
        {canCopy&&<button type="button" className="pm-icon-button" aria-label={'Copy '+LABEL[f]+' '+login.email} title={'Copy '+LABEL[f]} onClick={()=>withSecrets(s=>void copyText(secretOf(s,f),LABEL[f]))}><Copy size={14}/></button>}</span>)
      :original[f]?<span className="flex gap-2 items-center flex-wrap"><span className={f==='notes'?'whitespace-pre-wrap':''}>{original[f]}</span>{f!=='notes'&&<button type="button" className="pm-icon-button" aria-label={'Copy '+LABEL[f]+' '+login.email} title={'Copy '+LABEL[f]} onClick={()=>void copyText(original[f],LABEL[f])}><Copy size={14}/></button>}</span>:<span className="pm-muted">Chưa có</span>;
    const input=f==='notes'?<textarea className="pm-input" rows={2} aria-label={LABEL[f]} value={draft[f]??original[f]} disabled={cleared||save.isLoading} onChange={e=>{setDraft(d=>({...d,[f]:e.target.value}));setErrors({});}}/>
      :<input className="pm-input" aria-label={LABEL[f]} type={f==='password'||f==='twoFa'||f==='token'?'password':'text'} autoComplete={secret?'new-password':'off'} inputMode={f==='phone'?'tel':undefined} value={draft[f]??(secret?'':original[f])} placeholder={secret?(stored?'Giữ nguyên (đang ẩn) — gõ để thay':'Chưa có — gõ để thêm'):''} disabled={cleared||save.isLoading} onChange={e=>{setDraft(d=>({...d,[f]:e.target.value}));setErrors({});}}/>;
    return <div key={f} className="acc-detail-row" data-field={f}><span className="acc-detail-label">{LABEL[f]}</span><div className="acc-detail-value">
      {editing?<><div className="flex gap-2 items-center">{input}{f!=='email'&&stored&&<button type="button" className="pm-button pm-button-sm pm-button-quiet" aria-pressed={cleared} onClick={()=>{setClear(c=>({...c,[f]:!c[f]}));setDraft(d=>{const n={...d};delete n[f];return n;});}}>{cleared?'Huỷ xoá':'Xoá trường này'}</button>}</div>{cleared&&<p className="text-xs text-amber-700">Sẽ xoá {LABEL[f]} khi Lưu</p>}</>:view}
      {err&&<p className="vm-cell-error" role="alert">{err}</p>}</div></div>;
  };
  return <div className="acc-detail" role="group" aria-label={'Chi tiết '+login.email} data-account-id={login.id}>
    <div className="flex justify-between gap-2 items-center"><strong className="text-sm">{login.type==='APPLE_ID'?'Apple ID':'Gmail'} · {login.email}</strong>
      <div className="flex gap-2">{canEdit&&!editing&&<button type="button" className="pm-button pm-button-sm" onClick={()=>setEditing(true)}>Sửa</button>}<button type="button" className="pm-icon-button" aria-label="Đóng chi tiết" onClick={onClose}><X size={16}/></button></div></div>
    {askPin&&<form className="acc-detail-pin flex gap-2 items-center flex-wrap" onSubmit={e=>{e.preventDefault();void unlock();}}><Lock size={14}/><span className="text-xs">Nhập PIN để xem / copy thông tin bí mật</span><input autoFocus type="password" autoComplete="off" className="pm-input pm-input-sm w-28" aria-label="PIN" value={pin} onChange={e=>setPin(e.target.value)}/><button className="pm-button pm-button-sm" disabled={!pin||copyAcc.isLoading}>{copyAcc.isLoading?<Loader2 size={14} className="animate-spin"/>:null}Mở</button><button type="button" className="pm-button pm-button-sm pm-button-quiet" onClick={()=>{setAskPin(false);pending.current=undefined;}}>Huỷ</button>{pinError&&<span className="vm-cell-error" role="alert">{pinError}</span>}</form>}
    <div className="acc-detail-grid">{shown.map(field)}</div>
    {editing&&<div className="flex gap-2 justify-end items-center flex-wrap">{general&&<p role="alert" className="pm-error text-sm mr-auto">{general}</p>}<button type="button" className="pm-button pm-button-sm pm-button-quiet" disabled={save.isLoading} onClick={()=>{setEditing(false);setDraft({});setClear({});setErrors({});setGeneral('');}}>Huỷ sửa</button>
      <button type="button" className={'pm-button pm-button-sm'+(changes.count&&changes.valid?' pm-button-primary':'')} disabled={!changes.count||!changes.valid||save.isLoading} onClick={()=>void submit()}>{save.isLoading?'Đang lưu…':changes.count?`Lưu ${changes.count} trường`:'Lưu'}</button></div>}
  </div>;
}
