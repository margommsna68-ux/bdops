"use client";
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import Link from 'next/link';
import {ChevronDown,Loader2} from 'lucide-react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {LOGIN_STATUS_LABEL} from '@/lib/login-issue';
import {errorMessage,type ManagedVM} from '../shared';
export type VmAccount=inferRouterOutputs<AppRouter>['accountStore']['vmAccounts'][number];
type Store=inferRouterOutputs<AppRouter>['accountStore']['store'];
export const TYPE_LABEL:Record<string,string>={GMAIL:'Gmail',APPLE_ID:'Apple ID'};
// Tài khoản EarnApp at the cell: login (Gmail / Apple ID) and the receiving PayPal email (Mã PP → Email) of this VM, chosen in a popover next to the cell. One
// save sends both (the server keeps or refuses the row as a whole). Held accounts are not offered; the server re-checks anyway.
// face: what the button shows instead of the account (the Tiền / Rút cell of a VM without an account opens the same picker).
export function AccountCell({projectId,vm,link,focus,canAssign,face,onSaved,onBusy,dataState='READY'}:{projectId:string;vm:ManagedVM;link:VmAccount|undefined;focus:'login'|'paypal';canAssign:boolean;face?:React.ReactNode;onSaved:()=>void;onBusy:(vmId:string,busy:boolean)=>void;dataState?:'READY'|'LOADING'|'ERROR'}){
  const e=link?.earnApp,[open,setOpen]=useState(false),button=useRef<HTMLButtonElement>(null),pop=useRef<HTMLDivElement>(null),[pos,setPos]=useState<{top:number;left:number}|null>(null);
  const close=()=>{setOpen(false);button.current?.focus({preventScroll:true});};const closeRef=useRef(close);closeRef.current=close;
  useLayoutEffect(()=>{if(!open)return;const place=()=>{const r=button.current?.getBoundingClientRect();if(!r)return;const h=pop.current?.offsetHeight||360,up=r.bottom+h+8>window.innerHeight&&r.top>h;const next={top:up?r.top-h-6:r.bottom+6,left:Math.max(8,Math.min(r.left,window.innerWidth-372))};setPos(p=>p&&p.top===next.top&&p.left===next.left?p:next);};
    place();const raf=requestAnimationFrame(place),timer=setTimeout(place,400);window.addEventListener('scroll',place,true);window.addEventListener('resize',place);return ()=>{cancelAnimationFrame(raf);clearTimeout(timer);window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);};},[open]);
  useEffect(()=>{if(!open)return;const down=(ev:MouseEvent)=>{if(!pop.current?.contains(ev.target as Node)&&!button.current?.contains(ev.target as Node))setOpen(false);};const key=(ev:KeyboardEvent)=>{if(ev.key==='Escape'){ev.stopPropagation();closeRef.current();}};
    document.addEventListener('mousedown',down);document.addEventListener('keydown',key,true);return ()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key,true);};},[open]);
  const view=focus==='login'?(e?<span className="vm-account-view"><span className="vm-ellipsis" title={e.login.email}>{e.login.email}</span><span className="pm-badge pm-badge-muted vm-type-badge">{TYPE_LABEL[e.login.type||'']||'?'}</span>{e.login.status!=='ACTIVE'&&<span className={e.login.status==='GOOGLE_VERIFY'?'pm-badge pm-badge-amber':'pm-badge pm-badge-red'} title={[e.login.loginIssueNote,e.login.loginIssueAt].filter(Boolean).join(' · ')}>{LOGIN_STATUS_LABEL[e.login.status as keyof typeof LOGIN_STATUS_LABEL]||e.login.status}</span>}</span>
      :link?.legacyGmail?<span className="flex flex-col min-w-0 gap-1"><span className="pm-muted">Chưa có tài khoản</span><span className="pm-muted vm-ellipsis" title="Gmail cũ trước quy tắc mới; chưa có tài khoản EarnApp">Cũ: {link.legacyGmail}</span></span>:<span className="pm-muted">Chưa có tài khoản</span>)
    :(e?.paypal?<span className="vm-ellipsis" title={e.paypal.code+' · '+(e.paypal.email||'chưa xác định email')}>{e.paypal.code} · {e.paypal.email||<span className="pm-muted">chưa rõ email</span>}</span>:<span className="pm-muted">{e&&canAssign?'Chọn PayPal':'—'}</span>);
  if(dataState!=='READY')return <span className="pm-muted text-xs" role="status">{dataState==='ERROR'?'Chưa tải được tài khoản':'Đang tải tài khoản…'}</span>;
  if(vm.archivedAt)return <span className="pm-muted vm-ellipsis">{focus==='login'?e?.login.email||'—':e?.paypal?.code||'—'}</span>;
  return <div className="vm-status">
    <button ref={button} type="button" className="vm-link-cell vm-account-button" aria-haspopup="dialog" aria-expanded={open} aria-label={(focus==='login'?'Tài khoản EarnApp ':'PayPal nhận tiền ')+vm.code} onClick={()=>setOpen(o=>!o)}>{face??(focus==='login'&&e?<span className="flex flex-col min-w-0 gap-1">{view}<span className="text-xs pm-muted" title={e.registeredAt?'Đã gán và đã ghi đăng ký EarnApp trên web':'Đã gán trên web; chưa xác nhận đăng ký EarnApp'}>Có tài khoản</span></span>:view)}{canAssign&&<ChevronDown size={11} className="shrink-0 pm-muted"/>}</button>
    {open&&typeof document!=='undefined'&&createPortal(<div ref={pop} role="dialog" aria-label={`Tài khoản ${vm.server} / ${vm.code}`} className="vm-status-pop vm-account-pop" style={{top:pos?.top??-9999,left:pos?.left??-9999}}>
      <AccountPicker projectId={projectId} vm={vm} link={link} focus={focus} canAssign={canAssign} onBusy={onBusy} onDone={()=>{onSaved();setOpen(false);}}/>
    </div>,document.body)}
  </div>;
}
// Shared by the cell popover and the side panel: pick login and PayPal, save both at once, unassign, record registration.
export function AccountPicker({projectId,vm,link,focus='login',canAssign,onBusy,onDone}:{projectId:string;vm:ManagedVM;link:VmAccount|undefined;focus?:'login'|'paypal';canAssign:boolean;onBusy?:(vmId:string,busy:boolean)=>void;onDone:()=>void}){
  const e=link?.earnApp,store=trpc.accountStore.store.useQuery({projectId},{enabled:canAssign,staleTime:15000}),apply=trpc.accountStore.linkApply.useMutation(),mark=trpc.accountStore.markRegistered.useMutation(),utils=trpc.useUtils();
  // PayPal is chosen in two steps: Mã PP, then one of its emails that may still be given (the email is what the EarnApp receives on).
  const [login,setLogin]=useState(e?.login.id||''),[pp,setPp]=useState(e?.paypal?.id||''),[paypal,setPaypal]=useState(e?.paypal?.emailId||''),[q,setQ]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),busyRef=useRef(false);
  const firstInput=useRef<HTMLInputElement>(null),ppSelect=useRef<HTMLSelectElement>(null);
  useEffect(()=>{requestAnimationFrame(()=>(focus==='paypal'&&e?ppSelect.current:firstInput.current)?.focus({preventScroll:true}));},[focus,e]);
  const logins=useMemo(()=>pickLogins(store.data,e?.login.id,q),[store.data,e,q]),paypals=useMemo(()=>pickPaypals(store.data,e?.paypal?.id),[store.data,e]),emails=useMemo(()=>pickEmails(store.data,pp,e?.paypal?.emailId??null),[store.data,pp,e]);
  const chosen=paypals.find(p=>p.id===pp),chosenEmail=emails.find(m=>m.id===paypal);
  const changed=login!==(e?.login.id||'')||paypal!==(e?.paypal?.emailId||'')||!paypal&&!pp&&!!e?.paypal;
  async function run(fn:()=>Promise<unknown>){
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');onBusy?.(vm.id,true);
    try{await fn();await Promise.all([utils.accountStore.invalidate(),utils.vmManagement.workspace.invalidate()]);onDone();}catch(x){setError(errorMessage(x));}
    finally{busyRef.current=false;setBusy(false);onBusy?.(vm.id,false);}
  }
  const save=(item:{login?:string|null;paypalEmail?:string|null})=>run(async()=>{const r=await apply.mutateAsync({projectId,key:crypto.randomUUID(),items:[{line:1,vmId:vm.id,expectedRevision:vm.revision,...item}]});const row=r.rows[0];if(row?.outcome==='ERROR')throw new Error(row.message);});
  return <div className="space-y-2">
    <p className="vm-status-pop-title"><strong>{vm.server} / {vm.code}</strong> · Tài khoản EarnApp</p>
    {e?<p className="text-xs">{e.login.email} <span className="pm-muted">({TYPE_LABEL[e.login.type||'']||'chưa chọn loại'})</span> · PayPal {e.paypal?<strong>{e.paypal.code} · {e.paypal.email||'chưa xác định email'}</strong>:<span className="pm-muted">chưa có</span>} · {e.registeredAt?<span className="text-green-700">đã ghi đăng ký EarnApp</span>:<span className="pm-muted">chưa ghi đăng ký EarnApp</span>}</p>
      :<p className="text-xs pm-muted">{link?.legacyGmail?'Gmail cũ: '+link.legacyGmail+' (trước quy tắc mới). Chọn lại tài khoản nếu đúng.':'VM chưa có tài khoản EarnApp. Có thể để trống và bổ sung sau.'}</p>}
    {!canAssign?<p className="text-xs pm-muted">Chỉ xem: tài khoản này chưa có quyền gán.</p>:<>
      <label className="pm-label text-xs">Tài khoản đăng nhập (Gmail / Apple ID)
        <input ref={firstInput} className="pm-input" placeholder="Tìm email…" value={q} disabled={busy} onChange={x=>setQ(x.target.value)}/></label>
      <select className="pm-input" aria-label="Chọn tài khoản" size={Math.min(6,Math.max(3,logins.length+1))} value={login} disabled={busy} onChange={x=>{const v=x.target.value;setLogin(v);const same=v===(e?.login.id||'');setPp(same?(e?.paypal?.id||''):'');setPaypal(same?(e?.paypal?.emailId||''):'');}}>
        <option value="">— Không có tài khoản —</option>{logins.map(l=><option key={l.id} value={l.id}>{l.email} · {TYPE_LABEL[l.type||'']||'?'}{l.id===e?.login.id?' (đang dùng)':l.state==='USED'?' · đã dùng':' · NEW'}</option>)}</select>
      {store.data&&!logins.some(l=>l.state==='NEW')&&<p className="text-xs pm-muted">Kho hết tài khoản NEW. <Link className="underline" href="/gmails?tab=login&import=1">Nhập kho</Link></p>}
      <div className="grid grid-cols-2 gap-2">
        <label className="pm-label text-xs">Mã PP
          <select ref={ppSelect} className="pm-input" aria-label="Chọn mã PayPal" value={pp} disabled={busy||!login} onChange={x=>{setPp(x.target.value);const m=pickEmails(store.data,x.target.value,e?.paypal?.emailId??null);setPaypal(m.length===1?m[0].id:'');}}><option value="">— Chưa có PayPal —</option>{paypals.map(p=><option key={p.id} value={p.id}>{p.code} · còn {p.counts.NEW} email{p.id===e?.paypal?.id?' (đang dùng)':''}</option>)}</select></label>
        <label className="pm-label text-xs">Email nhận tiền
          <select className="pm-input" aria-label="Chọn email PayPal" value={paypal} disabled={busy||!login||!pp} onChange={x=>setPaypal(x.target.value)}><option value="">{pp?'— Chọn email —':'—'}</option>{emails.map(m=><option key={m.id} value={m.id}>{m.email}{m.id===e?.paypal?.emailId?' (đang dùng)':''}</option>)}</select></label>
      </div>
      <p className="text-xs" aria-live="polite">{chosen?<>Đã chọn: <strong>{chosen.code} · {chosenEmail?.email||'chưa chọn email'}</strong></>:<span className="pm-muted">Mỗi email PayPal chỉ nhận cho một EarnApp; email đã dùng không cấp lại.</span>}</p>
      {store.isLoading&&<p className="text-xs pm-muted"><Loader2 size={12} className="inline animate-spin"/> Đang tải kho…</p>}
      <div className="flex gap-2 flex-wrap justify-end">
        {e&&<button type="button" className="pm-button pm-button-quiet" disabled={busy} onClick={()=>void save({login:null})}>Bỏ gán khỏi VM</button>}
        {e&&<button type="button" className="pm-button pm-button-quiet" disabled={busy} onClick={()=>void run(()=>mark.mutateAsync({projectId,vmId:vm.id,registered:!e.registeredAt,expectedRevision:e.revision,key:crypto.randomUUID()}))}>{e.registeredAt?'Bỏ ghi đã đăng ký':'Ghi đã đăng ký EarnApp'}</button>}
        <button type="button" className="pm-button pm-button-primary" disabled={busy||!changed||!login&&!e||!!pp&&!paypal} onClick={()=>void save(login?{login,paypalEmail:paypal||null}:{login:null})}>{busy?'Đang lưu…':!login&&e?'Bỏ gán':'Lưu'}</button>
      </div>
      <p className="text-xs pm-muted">Gán tài khoản không có nghĩa là đã đăng ký EarnApp hay máy đang chạy. Bỏ gán không đưa tài khoản về NEW.</p>
    </>}
    {error&&<p role="alert" className="vm-status-error">{error}</p>}
  </div>;
}
// Offered logins: the current one, NEW stock, and used ones that are not on another VM (moving an EarnApp account is explicit).
function pickLogins(store:Store|undefined,current:string|undefined,q:string){
  const needle=q.trim().toLowerCase();
  return (store?.logins||[]).filter(l=>l.id===current||l.state==='NEW'||l.state==='USED').filter(l=>!needle||l.email.includes(needle)).sort((a,b)=>Number(b.id===current)-Number(a.id===current)||Number(b.state==='NEW')-Number(a.state==='NEW')||a.email.localeCompare(b.email)).slice(0,200);
}
// Offered PayPals: the current one and active ones that still have an unused email (one assigned email does not use up a PayPal).
function pickPaypals(store:Store|undefined,current:string|undefined){
  return (store?.paypals||[]).filter(p=>p.id===current||p.status==='ACTIVE'&&p.counts.NEW>0).sort((a,b)=>a.code.localeCompare(b.code,'en',{numeric:true}));
}
// Emails of the chosen PayPal that may be given: never used and not held, plus the email this EarnApp already receives on.
function pickEmails(store:Store|undefined,paypalId:string,current:string|null){
  const p=store?.paypals.find(x=>x.id===paypalId);return (p?.emails||[]).filter(m=>m.id===current||p!.status==='ACTIVE'&&m.state==='NEW');
}
