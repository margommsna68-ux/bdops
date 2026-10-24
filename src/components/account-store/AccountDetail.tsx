"use client";
import React,{useEffect,useMemo,useRef,useState} from 'react';
import toast from 'react-hot-toast';
import {Copy,Eye,EyeOff,ExternalLink,Loader2,Lock,X} from 'lucide-react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {errorMessage} from '@/components/vm-management/shared';
import {isLoginIssueStatus,LOGIN_ISSUE_LABEL,type LoginIssueStatus} from '@/lib/login-issue';
type Login=inferRouterOutputs<AppRouter>['accountStore']['store']['logins'][number];
type Field='email'|'password'|'twoFa'|'token'|'recoveryEmail'|'twoFaLink'|'smsLink'|'phone'|'notes';
type Secrets={secret:string;twoFa:string|null;token:string|null;twoFaLink:string|null;smsLink:string|null;phone:string|null};
const LABEL:Record<Field,string>={email:'Email đăng nhập',password:'Mật khẩu',twoFa:'Mã 2FA (TOTP)',token:'Token',recoveryEmail:'Email khôi phục',twoFaLink:'Link lấy mã 2FA',smsLink:'Link SMS',phone:'Số điện thoại',notes:'Ghi chú'};
const SECRET:Field[]=['password','twoFa','token','twoFaLink','smsLink'];
const EMAIL=/^[^\s@|:\t]+@[^\s@|:\t]+\.[^\s@|:\t]+$/,PHONE=/^\+?[0-9][0-9 .()-]{2,39}$/,LINK=/^https?:\/\/\S+$/i;
export const LOGIN_ISSUE_DISPLAY_LABEL:Record<LoginIssueStatus,string>={APPLE_LOCKED:'Apple Locked',GOOGLE_VERIFY:'Google Verify',GOOGLE_DISABLED:'Google Disabled'};
/** Non-secret health metadata, shared by the stock row and expanded detail. */
export function LoginIssueBadge({status,loginIssueNote,loginIssueAt}:{status:string;loginIssueNote?:string|null;loginIssueAt?:string|null}){
  if(!isLoginIssueStatus(status))return null;
  const at=loginIssueAt?new Date(loginIssueAt):null,validAt=at&&Number.isFinite(at.getTime());
  const color=status==='GOOGLE_VERIFY'?'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300':'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300';
  return <div className="mt-1 max-w-xs space-y-1 text-xs whitespace-normal">
    <span data-login-issue={status} title={LOGIN_ISSUE_LABEL[status]} className={'inline-flex rounded border px-2 py-0.5 font-medium '+color}>{LOGIN_ISSUE_DISPLAY_LABEL[status]}</span>
    {loginIssueNote&&<p className="line-clamp-2 break-words pm-muted" title={loginIssueNote}>{loginIssueNote}</p>}
    {validAt&&<time className="block pm-muted" dateTime={loginIssueAt!} title={at.toLocaleString('vi-VN')}>Ghi nhận {at.toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</time>}
  </div>;
}
// Khung chi tiết of one Gmail / Apple ID (owner brief 20/10/2026), opened from the email in the table, inside the page.
// - Apple ID (five-column list): Email đăng nhập, Mật khẩu, Link lấy mã 2FA, Link SMS, Số điện thoại, Ghi chú. An account recorded with
//   the older pattern shows what it stored (2FA TOTP, Email khôi phục, Token); empty secret kinds are never offered.
// - Secrets come only through the existing copy right + PIN (businessManagement.copyAccount), are kept in this component's memory while
//   it is open and are dropped on close; the password stays masked until Xem; the two links open only on a click.
// - Sửa: one Lưu, muted until something valid changed. Only changed fields are sent; a masked / not loaded secret box left empty keeps
//   the stored value; clearing a field is its own button ("Xoá trường này"). Errors show at the field and the draft stays.
// - Review fix 20/10/2026: the draft belongs to the version the person started from (base). A newer version arriving in the background
//   never clears or re-bases it: the frame says so, shows the new values next to the fields, and Lưu waits for "Đối chiếu bản mới"
//   (an explicit click that keeps the draft). The draft is dropped only after its own save succeeded or on Huỷ sửa. Secrets read after the
//   PIN are tied to project + account + version + copy right; any change hides them and a late answer for another one is thrown away.
export function AccountDetail({projectId,login,canEdit,canCopy,onSaved,onClose}:{projectId:string;login:Login;canEdit:boolean;canCopy:boolean;onSaved:()=>void;onClose:()=>void}){
  const has={password:login.has.password,twoFa:login.has.twoFa,token:login.has.token,twoFaLink:login.links.twoFa,smsLink:login.links.sms};
  const classic=!!(login.has.twoFa||login.has.token||login.recoveryEmail)||login.type!=='APPLE_ID';
  const shown:Field[]=classic?['email','password',...(login.has.twoFa||login.type==='GMAIL'?['twoFa' as Field]:[]),'recoveryEmail',...(login.has.token?['token' as Field]:[]),...(login.links.twoFa?['twoFaLink' as Field]:[]),...(login.links.sms?['smsLink' as Field]:[]),...(login.phone?['phone' as Field]:[]),'notes']:['email','password','twoFaLink','smsLink','phone','notes'];
  const copyAcc=trpc.businessManagement.copyAccount.useMutation(),save=trpc.accountStore.updateLogin.useMutation();
  const tag=projectId+'|'+login.id+'|'+login.revision+'|'+(canCopy?'1':'0'),tagRef=useRef(tag);tagRef.current=tag;
  const [held,setHeld]=useState<{tag:string;values:Secrets}|null>(null),[pin,setPin]=useState(''),[askPin,setAskPin]=useState(false),[pinError,setPinError]=useState(''),[reveal,setReveal]=useState<Partial<Record<Field,boolean>>>({});
  const secrets=held&&held.tag===tag?held.values:null; // secrets of another account / version / right are never shown, copied or opened
  const pending=useRef<((s:Secrets)=>void)|undefined>(undefined);
  useEffect(()=>{setHeld(h=>h&&h.tag===tag?h:null);setReveal({});pending.current=undefined;setAskPin(false);setPin('');},[tag]);
  useEffect(()=>()=>{setHeld(null);},[]);
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState<Partial<Record<Field,string>>>({}),[clear,setClear]=useState<Partial<Record<Field,boolean>>>({}),[errors,setErrors]=useState<Partial<Record<Field,string>>>({}),[general,setGeneral]=useState(''),keyRef=useRef<{sig:string;key:string}|null>(null);
  const current:Record<Field,string>={email:login.email,password:'',twoFa:'',token:'',recoveryEmail:login.recoveryEmail||'',twoFaLink:'',smsLink:'',phone:login.phone||'',notes:login.notes||''};
  // The version the edit started from; comparisons and the expected revision use it until the person re-bases on purpose.
  const [base,setBase]=useState<{revision:number;values:Record<Field,string>}|null>(null);
  const original=editing&&base?base.values:current,stale=editing&&!!base&&base.revision!==login.revision;
  const startEdit=()=>{setBase({revision:login.revision,values:current});setEditing(true);};
  const stopEdit=()=>{setEditing(false);setBase(null);setDraft({});setClear({});setErrors({});setGeneral('');keyRef.current=null;};
  const copyText=(t:string,what:string)=>navigator.clipboard.writeText(t).then(()=>toast.success('Đã copy '+what),()=>toast.error('Trình duyệt chưa cho phép copy'));
  // Secret actions wait for the PIN once; the action runs right after the server answers.
  function withSecrets(run:(s:Secrets)=>void){if(secrets){run(secrets);return;}pending.current=run;setAskPin(true);setPinError('');}
  async function unlock(){setPinError('');const at=tag,run=pending.current;
    try{const r=await copyAcc.mutateAsync({projectId,kind:'GMAIL',id:login.id,pin});
      // The answer belongs to the account / version it was asked for; if that changed meanwhile it is dropped, never shown.
      if(tagRef.current!==at){setPinError('Tài khoản vừa thay đổi; mở lại để lấy thông tin hiện hành');return;}
      const s:Secrets={secret:r.secret,twoFa:r.twoFa,token:r.token,twoFaLink:r.twoFaLink,smsLink:r.smsLink,phone:r.phone};setHeld({tag:at,values:s});setPin('');setAskPin(false);
      if(pending.current===run){run?.(s);pending.current=undefined;}}
    catch(e){if(tagRef.current===at)setPinError(errorMessage(e));}}
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
  },[draft,clear,shown.join(),editing,base]);// eslint-disable-line react-hooks/exhaustive-deps
  async function submit(){
    if(!changes.count||!changes.valid||save.isLoading||stale||!base)return;setGeneral('');setErrors({});
    // One request = one key: a retry after a lost answer sends exactly the same body (revision included) with the same key.
    const body={id:login.id,expectedRevision:base.revision,changes:changes.c},sig=JSON.stringify(body),key=keyRef.current?.sig===sig?keyRef.current.key:crypto.randomUUID();keyRef.current={sig,key};
    try{const r=await save.mutateAsync({projectId,...body,key});
      toast.success(r.changed?r.message:'Không thay đổi');setHeld(null);setReveal({});stopEdit();onSaved();}
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
      {stale&&!secret&&current[f]!==original[f]&&<p className="text-xs pm-muted">Bản mới: {current[f]||'(trống)'}</p>}{stale&&secret&&<p className="text-xs pm-muted">Có thể đã đổi ở bản mới</p>}
      {err&&<p className="vm-cell-error" role="alert">{err}</p>}</div></div>;
  };
  return <div className="acc-detail" role="group" aria-label={'Chi tiết '+login.email} data-account-id={login.id}>
    <div className="flex justify-between gap-2 items-center"><strong className="text-sm">{login.type==='APPLE_ID'?'Apple ID':'Gmail'} · {login.email}</strong>
      <div className="flex gap-2">{canEdit&&!editing&&<button type="button" className="pm-button pm-button-sm" onClick={startEdit}>Sửa</button>}<button type="button" className="pm-icon-button" aria-label="Đóng chi tiết" onClick={onClose}><X size={16}/></button></div></div>
    <LoginIssueBadge {...login}/>
    {askPin&&<form className="acc-detail-pin flex gap-2 items-center flex-wrap" onSubmit={e=>{e.preventDefault();void unlock();}}><Lock size={14}/><span className="text-xs">Nhập PIN để xem / copy thông tin bí mật</span><input autoFocus type="password" autoComplete="off" className="pm-input pm-input-sm w-28" aria-label="PIN" value={pin} onChange={e=>setPin(e.target.value)}/><button className="pm-button pm-button-sm" disabled={!pin||copyAcc.isLoading}>{copyAcc.isLoading?<Loader2 size={14} className="animate-spin"/>:null}Mở</button><button type="button" className="pm-button pm-button-sm pm-button-quiet" onClick={()=>{setAskPin(false);pending.current=undefined;}}>Huỷ</button>{pinError&&<span className="vm-cell-error" role="alert">{pinError}</span>}</form>}
    {stale&&<div className="pm-review text-sm flex gap-2 items-center flex-wrap" role="status">Tài khoản vừa được cập nhật ở nơi khác. Nội dung bạn đang sửa vẫn giữ; giá trị mới hiện dưới từng ô.
      <button type="button" className="pm-button pm-button-sm" onClick={()=>{setBase({revision:login.revision,values:current});keyRef.current=null;}}>Đối chiếu bản mới</button></div>}
    <div className="acc-detail-grid">{shown.map(field)}</div>
    {editing&&<div className="flex gap-2 justify-end items-center flex-wrap">{general&&<p role="alert" className="pm-error text-sm mr-auto">{general}</p>}<button type="button" className="pm-button pm-button-sm pm-button-quiet" disabled={save.isLoading} onClick={stopEdit}>Huỷ sửa</button>
      <button type="button" className={'pm-button pm-button-sm'+(changes.count&&changes.valid&&!stale?' pm-button-primary':'')} disabled={!changes.count||!changes.valid||save.isLoading||stale} onClick={()=>void submit()}>{save.isLoading?'Đang lưu…':changes.count?`Lưu ${changes.count} trường`:'Lưu'}</button></div>}
  </div>;
}
