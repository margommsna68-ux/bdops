"use client";
import {useEffect,useRef,useState} from 'react';
import {useSession} from 'next-auth/react';
import {Copy,Eye,EyeOff,Loader2} from 'lucide-react';
import toast from 'react-hot-toast';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {usePinAction} from '@/components/PinVerify';
import type {ManagedVM} from '../shared';
import type {VmAccount} from './AccountCell';
type Values=inferRouterOutputs<AppRouter>['businessManagement']['copyVmAccount'];
type Field='secret'|'twoFa'|'twoFaLink'|'smsLink';
const LABEL:Record<Field,string>={secret:'Mật khẩu',twoFa:'2FA',twoFaLink:'Link lấy mã 2FA',smsLink:'Link SMS'};
/** Human shortcut: bound VM/account read, existing own-factor gate, fresh server check on every secret copy. */
export function VmLoginCredentials({projectId,vm,account,canCopy}:{projectId:string;vm:ManagedVM;account:NonNullable<VmAccount['earnApp']>;canCopy:boolean}){
 const session=useSession(),security=trpc.user.securityStatus.useQuery(undefined,{enabled:canCopy,retry:false,refetchInterval:30000,refetchOnWindowFocus:true}),read=trpc.businessManagement.copyVmAccount.useMutation(),{requirePin,PinDialog}=usePinAction();
 const tag=[(session.data?.user as {id?:string}|undefined)?.id,projectId,vm.id,vm.revision,vm.cycle,account.id,account.login.id,account.login.revision,canCopy].join('|');
 const gate=security.error?'ERROR':!security.data?'UNKNOWN':security.data.unlocked?'OPEN':'LOCKED',mode=String(security.data?.totpEnabled);
 const guard=useRef({tag,gate,mode,generation:0});
 // A lock->unlock upgrade by this person's PIN dialog is allowed. Relock/error/identity changes invalidate held and in-flight data.
 if(guard.current.tag!==tag||guard.current.mode!==mode||(gate!=='OPEN'&&guard.current.gate!==gate)||(guard.current.gate==='ERROR'&&gate!=='ERROR'))guard.current={tag,gate,mode,generation:guard.current.generation+1};
 else guard.current={...guard.current,gate};
 const generation=guard.current.generation,mounted=useRef(true),inFlight=useRef(false);
 const [held,setHeld]=useState<{tag:string;generation:number;values:Values}|null>(null),[shown,setShown]=useState<Partial<Record<Field,boolean>>>({}),[manual,setManual]=useState<{label:string;value:string;tag:string;generation:number}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const current=canCopy&&!security.error&&held?.tag===tag&&held.generation===generation?held.values:null;
 useEffect(()=>{setHeld(null);setShown({});setManual(null);setError('');},[generation]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;guard.current.generation++;};},[]);
 const valid=(at:string,epoch:number)=>mounted.current&&guard.current.tag===at&&guard.current.generation===epoch;
 const copy=async(value:string,label:string,at=tag,epoch=generation)=>{if(!valid(at,epoch))return;try{await navigator.clipboard.writeText(value);if(valid(at,epoch)){setManual(null);toast.success('Đã copy '+label);}}catch{if(valid(at,epoch))setManual({label,value,tag:at,generation:epoch});}};
 function request(field:Field|'ALL',action:'show'|'copy'){
  if(!canCopy||security.error||!security.data||inFlight.current)return;const at=tag,epoch=generation,email=account.login.email;
  requirePin(()=>{if(!valid(at,epoch)||inFlight.current)return;void(async()=>{inFlight.current=true;setBusy(true);setError('');setManual(null);
   try{const values=await read.mutateAsync({projectId,id:account.login.id,vmBinding:{vmId:vm.id,expectedVmRevision:vm.revision,expectedCycle:vm.cycle,earnAppId:account.id,expectedLoginRevision:account.login.revision}});
    if(!valid(at,epoch))return;if(values.email!==email)throw new Error('Tài khoản đã thay đổi; mở lại thông tin hiện hành');
    setHeld({tag:at,generation:epoch,values});if(action==='copy'&&field!=='ALL')await copy(values[field]||'',LABEL[field],at,epoch);else setShown(old=>field==='ALL'?{secret:true,twoFa:true,twoFaLink:true,smsLink:true}:{...old,[field]:true});
   }catch(e){if(valid(at,epoch)){setHeld(null);setShown({});setManual(null);setError(e instanceof Error?e.message:'Chưa đọc được thông tin đăng nhập');}}
   finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  })();},'Xem thông tin đăng nhập của VM','Dùng mã Google Authenticator / PIN của chính bạn để xem và copy');
 }
 const has=account.login.has??{password:true,twoFa:true,twoFaLink:false,smsLink:false,token:false};
 const fields:Field[]=['secret',...(has.twoFa?['twoFa' as const]:[]),...(has.twoFaLink?['twoFaLink' as const]:[]),...(has.smsLink?['smsLink' as const]:[])];
 const present=(f:Field)=>f==='secret'?has.password:f==='twoFa'?has.twoFa:f==='twoFaLink'?has.twoFaLink:has.smsLink;
 return <section className="vm-login-credentials space-y-2" aria-label="Thông tin đăng nhập VM">
  <div className="flex items-center justify-between gap-2"><strong className="text-xs">Đăng nhập {account.login.type==='APPLE_ID'?'Apple ID':account.login.type==='GMAIL'?'Gmail':'tài khoản đã gán'}</strong>{canCopy&&<button type="button" className="pm-button pm-button-sm" disabled={busy||!!security.error||!security.data} onClick={()=>current&&Object.values(shown).some(Boolean)?(setHeld(null),setShown({}),setManual(null)):request('ALL','show')}>{busy?<Loader2 size={12} className="animate-spin"/>:null}{current&&Object.values(shown).some(Boolean)?'Ẩn thông tin':'Xem thông tin đăng nhập'}</button>}</div>
  <div className="vm-login-field"><span className="text-xs pm-muted">Email</span><span className="vm-login-value">{account.login.email}</span><button type="button" className="pm-icon-button" aria-label="Copy Email" title="Copy Email" onClick={()=>void copy(account.login.email,'Email')}><Copy size={14}/></button></div>
  {!canCopy?<p className="pm-muted text-xs">Cần quyền xem/copy thông tin đăng nhập để lấy mật khẩu và 2FA.</p>:fields.map(f=><div className="vm-login-field" key={f}><span className="text-xs pm-muted">{LABEL[f]}</span><code className="vm-login-value" data-masked={shown[f]&&current?'0':'1'}>{!present(f)?'Chưa ghi':shown[f]&&current?current[f]||'Chưa ghi':'••••••••'}</code><span className="flex gap-1">{present(f)&&<><button type="button" className="pm-icon-button" aria-label={(shown[f]&&current?'Ẩn ':'Xem ')+LABEL[f]} title={shown[f]&&current?'Ẩn':'Xem'} disabled={busy||!!security.error||!security.data} onClick={()=>shown[f]&&current?setShown(s=>({...s,[f]:false})):request(f,'show')}>{shown[f]&&current?<EyeOff size={14}/>:<Eye size={14}/>}</button><button type="button" className="pm-icon-button" aria-label={'Copy '+LABEL[f]} title={'Copy '+LABEL[f]} disabled={busy||!!security.error||!security.data} onClick={()=>request(f,'copy')}><Copy size={14}/></button></>}</span></div>)}
  {has.twoFa&&<p className="text-xs pm-muted">2FA là nội dung đã lưu của tài khoản, không phải mã xác nhận của người quản trị web.</p>}
  {manual&&manual.tag===tag&&manual.generation===generation&&<label className="pm-label text-xs">Trình duyệt chặn clipboard — chọn và copy {manual.label}<input readOnly className="pm-input" aria-label={'Copy thủ công '+manual.label} value={manual.value} onFocus={e=>e.target.select()}/></label>}
  {(error||security.error)&&<p className="vm-status-error text-xs" role="alert">{error||security.error?.message}</p>}{PinDialog}
 </section>;
}
