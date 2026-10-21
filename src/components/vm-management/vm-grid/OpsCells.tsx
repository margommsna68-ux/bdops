"use client";
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,Loader2} from 'lucide-react';
import toast from 'react-hot-toast';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {VM_OPS,VM_OPS_STATUSES,NO_STATUS_LABEL,MILESTONE_LABEL,PP_STATUS_LABEL,gatherOf,gatherText,type VmOpsStatus} from '@/lib/vm-ops';
import {formatLedger,formatUsd} from '@/lib/money-input';
import {viMoney} from '@/components/account-store/batch-format';
import type {ManagedVM} from '../shared';
import {AccountCell,type VmAccount} from './AccountCell';
import {BalanceSection,LineView,balanceLine,requestLine} from './MoneyParts';
export type OpsRow=inferRouterOutputs<AppRouter>['vmOps']['board']['vms'][number];
// payout = may prepare a request and record it sent / unknown (managers, or EARN_PAYOUT); writeMoney = every other money action.
// receipt = may record money received for a sent request (managers, or PAYPAL_RECEIPT_RECORD) through recordPayoutReceipt.
export type OpsRights={assign:boolean;money:boolean;writeMoney:boolean;payout?:boolean;receipt?:boolean;balanceRead?:boolean;balanceWrite?:boolean};
const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const message=(e:unknown)=>e instanceof Error?e.message:'Chưa lưu được';
// Tình trạng (operating state) at the cell: pick → saved at once. The same value writes nothing. While saving the cell is locked;
// an error is shown under it and the picked value stays so the person sees what did not save.
export function OpsStatusCell({vm,ops,canEdit,onSet}:{vm:ManagedVM;ops:{status:VmOpsStatus|null;cycle:number}|undefined;canEdit:boolean;onSet:(vm:ManagedVM,status:VmOpsStatus,cycle:number)=>Promise<void>}){
  const status=ops?.status??null,[picked,setPicked]=useState<VmOpsStatus|null>(null),[saving,setSaving]=useState(false),[error,setError]=useState('');
  useEffect(()=>{setPicked(null);setError('');},[status,ops?.cycle]);
  const shown=picked??status,tone=shown?VM_OPS[shown].tone:'none';
  async function pick(next:VmOpsStatus){
    if(next===status){setPicked(null);setError('');return;}
    setPicked(next);setSaving(true);setError('');
    try{await onSet(vm,next,ops?.cycle??1);}catch(e){setError(message(e));}finally{setSaving(false);}
  }
  // Work in hand on the real machine (21/10/2026): who / which token, until when; nothing to click.
  const job=vm.job?<span className="vm-job-mark" title={'Việc '+vm.job.kind+(vm.job.step?' · bước '+vm.job.step:'')+' · giữ đến '+new Date(vm.job.expiresAt).toLocaleString('vi-VN')}>{(vm.job.token?'AI':'Đang')+' xử lý · '+(vm.job.token??vm.job.by??'')+' · đến '+new Date(vm.job.expiresAt).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}</span>:null;
  if(!canEdit)return <div className="vm-ops-cell"><span className={'vm-ops vm-ops-'+tone} title={shown?VM_OPS[shown].hint:'Chưa ghi tình trạng'}>{shown?VM_OPS[shown].label:NO_STATUS_LABEL}</span>{job}</div>;
  return <div className="vm-ops-cell">
    <span className={'vm-ops vm-ops-'+tone+' vm-ops-pick'}>{saving&&<Loader2 size={11} className="animate-spin"/>}
      <select aria-label={'Tình trạng '+vm.server+' / '+vm.code} title={shown?VM_OPS[shown].hint:'Chưa ghi tình trạng; bấm để chọn'} value={shown??''} disabled={saving} onChange={e=>void pick(e.target.value as VmOpsStatus)}>
        {!shown&&<option value="" disabled>{NO_STATUS_LABEL}</option>}
        {VM_OPS_STATUSES.map(s=><option key={s} value={s}>{VM_OPS[s].label}</option>)}
      </select><ChevronDown size={11} aria-hidden/></span>
    {job}{error&&<span role="alert" className="vm-cell-error">{error}</span>}
  </div>;
}
// Small popover anchored to a cell, rendered in a portal (never clipped by the table scroll), closed by Escape / click outside.
function usePopover(){
  const [open,setOpen]=useState(false),anchor=useRef<HTMLButtonElement>(null),pop=useRef<HTMLDivElement>(null),[pos,setPos]=useState<{top:number;left:number}|null>(null),lock=useRef(false);
  useLayoutEffect(()=>{if(!open)return;const place=()=>{const r=anchor.current?.getBoundingClientRect();if(!r)return;const h=Math.min(pop.current?.offsetHeight||300,window.innerHeight-16),up=r.bottom+h+8>window.innerHeight&&r.top>h;
      // Below the cell when it fits, above when that fits, otherwise moved up just enough to stay inside the window (never cut off).
      setPos({top:up?r.top-h-6:Math.max(8,Math.min(r.bottom+6,window.innerHeight-h-8)),left:Math.max(8,Math.min(r.left,window.innerWidth-392))});};
    place();const ro=typeof ResizeObserver!=='undefined'&&pop.current?new ResizeObserver(place):null;if(ro&&pop.current)ro.observe(pop.current);window.addEventListener('scroll',place,true);window.addEventListener('resize',place);return ()=>{ro?.disconnect();window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);};},[open]);
  useEffect(()=>{if(!open)return;const down=(e:MouseEvent)=>{if(lock.current)return;if(!pop.current?.contains(e.target as Node)&&!anchor.current?.contains(e.target as Node))setOpen(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!lock.current){e.stopPropagation();setOpen(false);anchor.current?.focus({preventScroll:true});}};
    document.addEventListener('mousedown',down);document.addEventListener('keydown',key,true);return ()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key,true);};},[open]);
  return {open,setOpen,anchor,pop,pos,lock};
}
// One command key per prepared content: a retry of the same content (lost answer) replays; changed content is a new request.
function useCommandKey(){const ref=useRef<{sig:string;key:string}|null>(null);return (content:unknown)=>{const sig=JSON.stringify(content);if(ref.current?.sig!==sig)ref.current={sig,key:crypto.randomUUID()};return ref.current.key;};}
type Mode='request'|'receive'|'fail'|'cancel'|'settle'|'retry'|'recreate'|'sent'|'unknown'|null;
// Rút tiền of the current round: request → waiting for money on the PayPal → received in full → "Cần tạo lại VM". The milestone
// comes from the PayPal book; it cannot be picked by hand. Amounts only with the money rights.
export function PayoutCell({projectId,vm,ops,account,rights,onDone,onBusy}:{projectId:string;vm:ManagedVM;ops:OpsRow|undefined;account:VmAccount|undefined;rights:OpsRights;onDone:()=>Promise<unknown>|void;onBusy:(vmId:string,busy:boolean)=>void}){
  const p=usePopover(),[mode,setMode]=useState<Mode>(null),r=ops?.request??null,m=r?.money??null,cycle=ops?.cycle??1,sus=ops?.status==='SUSPENDED';
  const canRecreate=rights.assign&&(ops?.milestone==='RECREATE'||sus);
  const openWith=(next:Mode)=>{setMode(next);p.setOpen(true);};
  useEffect(()=>{if(!p.open)setMode(null);},[p.open]);
  // An action form opened on a request stays open (locked, with its note) if a reload drops that request.
  const actionOpen=useRef(false);actionOpen.current=!!mode&&mode!=='request'&&mode!=='recreate'&&(actionOpen.current||!!r);
  // The request was saved (here or by someone else) while the form was open: show that request, never a second request form.
  useEffect(()=>{if(r&&mode==='request')setMode(null);},[r,mode]);
  const hasEarnApp=!!account?.earnApp;
  // "Tiền / Rút" (owner brief 20/10/2026): the balance read on EarnApp, then the payout request; both when both exist.
  const bal=balanceLine(ops,!!rights.balanceRead),req=requestLine(ops);
  let face:React.ReactNode;
  // No account yet (20/10/2026): say so; who may assign opens the existing account picker from here. Never $0, never the SDK money.
  if(!hasEarnApp&&!r&&!canRecreate)return <div className="vm-payout">{rights.assign?<AccountCell projectId={projectId} vm={vm} link={account} focus="login" canAssign face={<span className="pm-muted text-xs">Chưa gán tài khoản</span>} onSaved={()=>void onDone()} onBusy={onBusy}/>:<span className="pm-muted text-xs">Chưa gán tài khoản</span>}</div>;
  if(!hasEarnApp&&!r)face=<span className="pm-muted text-xs">{sus?'SUS · ':''}Chưa gán tài khoản</span>;
  else face=<>{bal&&<LineView line={bal}/>}{req&&<LineView line={req}/>}{!bal&&!req&&<span className="pm-muted text-xs">Chưa kiểm tra</span>}{bal?.text==='Chưa kiểm tra'&&!req&&rights.balanceWrite&&<span className="vm-money-line text-xs">Bấm để ghi số dư</span>}</>;
  void m;void MILESTONE_LABEL;void formatLedger;
  const clickable=hasEarnApp||!!r||canRecreate;
  return <div className="vm-payout">
    {clickable?<button ref={p.anchor} type="button" className="vm-payout-button" aria-haspopup="dialog" aria-expanded={p.open} aria-label={'Tiền / Rút '+vm.server+' / '+vm.code} onClick={()=>p.open?p.setOpen(false):openWith(null)}>{face}</button>:<div className="vm-payout-face">{face}</div>}
    {canRecreate&&!r&&sus&&<button type="button" className="pm-link text-xs" onClick={()=>openWith('recreate')}>Ghi nhận đã tạo lại (SUS)</button>}
    {p.open&&typeof document!=='undefined'&&createPortal(<div ref={p.pop} role="dialog" aria-label={'Tiền / Rút '+vm.server+' / '+vm.code} className="vm-status-pop vm-payout-pop" style={{top:p.pos?.top??-9999,left:p.pos?.left??-9999}}>
      <p className="vm-status-pop-title"><strong>{vm.server} / {vm.code}</strong> · lượt {cycle}{account?.earnApp?' · '+account.earnApp.login.email:''}</p>
      {mode==='request'?<RequestForm projectId={projectId} vm={vm} cycle={cycle} earnAppId={ops?ops.earnAppId:undefined} lock={p.lock} onDone={async()=>{p.setOpen(false);await onDone();}}/>
      :mode==='recreate'?<RecreateForm projectId={projectId} vm={vm} cycle={cycle} sus={sus&&ops?.milestone!=='RECREATE'} lock={p.lock} onDone={async()=>{p.setOpen(false);await onDone();}}/>
      :mode&&(r||actionOpen.current)?<RequestAction projectId={projectId} vm={vm} mode={mode} request={r} narrow={!rights.writeMoney} lock={p.lock} onDone={async()=>{p.setOpen(false);await onDone();}} onBack={()=>setMode(null)}/>
      :<div className="space-y-2">
        {ops&&hasEarnApp&&<BalanceSection projectId={projectId} vmCode={vm.code} ops={ops} read={!!rights.balanceRead} write={!!rights.balanceWrite} onSaved={onDone}/>}
        <p className="font-semibold text-xs">Rút về PayPal</p>
        {r?<RequestSummary request={r} milestone={ops?.milestone||''}/>:<p className="text-xs pm-muted">{hasEarnApp?'Chưa ghi yêu cầu rút cho EarnApp này.':'VM chưa có tài khoản EarnApp ở lượt này.'}</p>}
        <div className="flex flex-col gap-1">
          {!r&&hasEarnApp&&(rights.writeMoney||rights.payout)&&<button type="button" className="vm-status-action primary" onClick={()=>setMode('request')}>{rights.writeMoney?'Ghi yêu cầu rút':'Chuẩn bị rút (giữ email)'}</button>}
          {r&&(rights.writeMoney||rights.payout)&&r.state==='REQUESTED'&&r.submission!=='SENT'&&<><button type="button" className="vm-status-action primary" onClick={()=>setMode('sent')}>Đã gửi trên EarnApp (xác nhận)</button>{r.submission==='PREPARING'&&<button type="button" className="vm-status-action" onClick={()=>setMode('unknown')}>Chưa xác định kết quả</button>}</>}
          {r&&(rights.writeMoney||rights.receipt)&&r.state==='REQUESTED'&&r.submission==='SENT'&&r.phase==='WAITING'&&<button type="button" className="vm-status-action primary" onClick={()=>setMode('receive')}>Ghi tiền về PP</button>}
          {canRecreate&&<button type="button" className={'vm-status-action'+(ops?.milestone==='RECREATE'?' primary':'')} onClick={()=>setMode('recreate')}>Ghi nhận đã tạo lại VM{ops?.milestone!=='RECREATE'?' (SUS)':''}</button>}
          {r&&rights.writeMoney&&r.state==='REQUESTED'&&r.phase==='WAITING'&&m&&m.received!=='0.00'&&<button type="button" className="vm-status-action" onClick={()=>setMode('settle')}>Chốt nhận thiếu (ghi phí / chênh lệch)</button>}
          {r&&rights.writeMoney&&r.state!=='REQUESTED'&&<button type="button" className="vm-status-action" onClick={()=>setMode('retry')}>Gửi lại (cùng lượt rút)</button>}
          {r&&rights.writeMoney&&r.state==='REQUESTED'&&r.phase!=='RECEIVED'&&<><button type="button" className="vm-status-action" onClick={()=>setMode('fail')}>Đánh dấu thất bại</button><button type="button" className="vm-status-action" onClick={()=>setMode('cancel')}>Huỷ yêu cầu</button></>}
        </div>
        {!rights.writeMoney&&<p className="text-xs pm-muted">{rights.receipt?'Thất bại, huỷ, gửi lại, chốt thiếu cần quyền ghi Tiền vào PayPal.':rights.payout?'Ghi tiền về, thất bại, huỷ, gửi lại cần quyền ghi Tiền vào PayPal.':'Ghi tiền cần quyền ghi Tiền vào PayPal.'}</p>}
      </div>}
    </div>,document.body)}
  </div>;
}
function RequestSummary({request:r,milestone}:{request:NonNullable<OpsRow['request']>;milestone:string}){
  const m=r.money;
  return <div className="text-xs space-y-1">
    <p>Yêu cầu ngày {r.requestedAt.split('-').reverse().join('/')} · <strong>{r.paypal}</strong> · {r.email}{r.reference?' · mã '+r.reference:''}</p>
    {r.submission==='PREPARING'&&<p className="text-amber-600">Đang chuẩn bị: email đang được giữ, chưa gửi trên EarnApp. Bấm rút trên EarnApp rồi xác nhận theo lịch sử EarnApp.</p>}
    {r.submission==='UNKNOWN'&&<p className="text-red-600">Chưa xác định kết quả: kiểm tra lịch sử rút trên EarnApp trước; không bấm rút thêm, không đổi email.</p>}
    {m?<p>Yêu cầu <strong>{formatLedger(m.amount,m.currency)}</strong> · đã về PP <strong>{formatLedger(m.received,m.currency)}</strong>{m.pendingLinked!=='0.00'?' · chờ nhận '+formatLedger(m.pendingLinked,m.currency):''}{r.phase==='WAITING'?' · còn chờ '+formatLedger(m.remaining,m.currency):''}{m.shortfall?' · chốt thiếu '+formatLedger(m.shortfall,m.currency)+' ('+m.settleNote+')':''}</p>:<p className="pm-muted">Số tiền chỉ hiện cho người có quyền tiền.</p>}
    {r.state!=='REQUESTED'&&<p className="text-amber-600">{r.state==='FAILED'?'Thất bại':'Đã huỷ'}{r.stateNote?': '+r.stateNote:''}</p>}
    {milestone==='RECREATE'&&<p className="text-emerald-600">Tiền đã về đủ PP. Tạo lại máy thật xong thì bấm “Ghi nhận đã tạo lại VM”.</p>}
    {milestone==='MONEY_REVIEW'&&<p className="text-amber-600">Tiền về khác số yêu cầu hoặc khác đồng tiền; cần đối chiếu ở Kho tài khoản.</p>}
  </div>;
}
type PickPaypal=inferRouterOutputs<AppRouter>['vmOps']['payoutPick']['paypals'][number];
type Sort='NEAR'|'REACHED'|'BALANCE';
function RequestForm({projectId,vm,cycle,earnAppId,lock,onDone}:{projectId:string;vm:ManagedVM;cycle:number;earnAppId:string|null|undefined;lock:React.MutableRefObject<boolean>;onDone:()=>Promise<void>}){
  const [ppId,setPp]=useState(''),[emailId,setEmail]=useState(''),[amount,setAmount]=useState(''),[prepare,setPrepare]=useState(false),[date,setDate]=useState(today()),[reference,setRef]=useState(''),[onlyUsable,setOnlyUsable]=useState(true),[sort,setSort]=useState<Sort>('NEAR'),[error,setError]=useState('');
  const amountReady=/^\d+([.,]\d{1,2})?$/.test(amount.trim())?amount.trim().replace(',','.'):null;
  const pick=trpc.vmOps.payoutPick.useQuery({projectId,vmId:vm.id,amount:amountReady},{retry:false,keepPreviousData:true}),save=trpc.vmOps.requestPayout.useMutation(),keyOf=useCommandKey();
  const data=pick.data,own=data?.earnApp?.emailId??null;
  // The form belongs to the round and EarnApp it opened with (review fix 20/10/2026): a reload showing another account or round
  // keeps the draft, says so and locks Lưu; it never sends the draft for the new account.
  const [bound,setBound]=useState<{cycle:number;earnAppId:string}|null>(null);
  useEffect(()=>{if(!bound&&data?.earnApp)setBound({cycle,earnAppId:data.earnApp.id});},[bound,data,cycle]);
  const moved=!!bound&&(bound.cycle!==cycle||(earnAppId!==undefined&&earnAppId!==bound.earnAppId)||(!!data&&data.earnApp?.id!==bound.earnAppId));
  const list=useMemo(()=>{
    const g=(x:PickPaypal)=>x.balanceUsd===null?null:gatherOf(x.balanceUsd,x.pendingUsd);
    const rows=(data?.paypals||[]).filter(x=>!onlyUsable||x.emails.some(e=>e.own)||x.usable&&x.unused>0);
    const key=(x:PickPaypal)=>{const s=g(x);if(!s)return 0;const b=Number(x.balanceUsd);return sort==='BALANCE'?-b:sort==='REACHED'?(s.state==='REACHED'?0:1)*1e9-b:(s.state==='REACHED'?1e9:Number(s.missingAfterPending));};
    return [...rows].sort((a,b)=>Number(b.emails.some(e=>e.own))-Number(a.emails.some(e=>e.own))||key(a)-key(b)||a.code.localeCompare(b.code,'en',{numeric:true}));
  },[data,onlyUsable,sort]);
  useEffect(()=>{if(!data||ppId)return;const mine=data.paypals.find(x=>x.emails.some(e=>e.own));if(mine){setPp(mine.id);setEmail(mine.emails.find(e=>e.own)!.id);}},[data,ppId]);
  const pp=list.find(x=>x.id===ppId)||data?.paypals.find(x=>x.id===ppId),amountOk=/^\d+([.,]\d{1,2})?$/.test(amount.trim())&&Number(amount.replace(',','.'))>0;
  const g=pp&&pp.balanceUsd!==null?gatherOf(pp.balanceUsd,pp.pendingUsd,amountOk?amount.replace(',','.'):'0'):null;
  async function submit(){
    if(lock.current||!bound||moved)return;setError('');
    const input={projectId,vmId:vm.id,expectedCycle:bound.cycle,earnAppId:bound.earnAppId,paypalEmailId:emailId,amount:amount.trim().replace(',','.'),currency:'USD',reference:reference.trim()||null,date,submission:prepare||data?.rights.prepareOnly?'PREPARING' as const:'SENT' as const};
    lock.current=true;try{const r=await save.mutateAsync({...input,key:keyOf(input)});toast.success((r.replay?'Đã có yêu cầu rút ':prepare?'Đã chuẩn bị rút (giữ email) ':'Đã ghi yêu cầu rút ')+vm.code);await onDone();}catch(e){setError(message(e));}finally{lock.current=false;}
  }
  if(pick.error)return <p role="alert" className="vm-status-error">{pick.error.message}</p>;
  if(!data)return <p className="text-xs pm-muted">Đang tải PayPal…</p>;
  if(!data.earnApp&&!bound)return <p className="text-xs pm-muted">VM chưa có tài khoản EarnApp; gán tài khoản trước.</p>;
  return <div className="space-y-2 text-sm">
    <div className="flex gap-2 items-center flex-wrap"><label className="text-xs flex items-center gap-1"><input type="checkbox" checked={onlyUsable} onChange={e=>setOnlyUsable(e.target.checked)}/>PP dùng được, còn email</label>
      {data.rights.balance&&<select aria-label="Sắp xếp PP" className="pm-input w-auto text-xs" value={sort} onChange={e=>setSort(e.target.value as Sort)}><option value="NEAR">Gần đạt $100 trước</option><option value="REACHED">Đã đạt $100 trước</option><option value="BALANCE">Số dư cao trước</option></select>}</div>
    {data.suggestion&&<div className="vm-pp-info text-xs" aria-live="polite"><span>Gợi ý: <strong>{data.paypals.find(x=>x.id===data.suggestion!.paypalId)?.code}</strong> — {data.suggestion.why}</span>{ppId!==data.suggestion.paypalId&&<button type="button" className="pm-link" onClick={()=>{const x=data.paypals.find(y=>y.id===data.suggestion!.paypalId);setPp(data.suggestion!.paypalId);setEmail(x?.emails.find(m=>m.own)?.id||x?.emails[0]?.id||'');}}>Dùng gợi ý</button>}</div>}
    <label className="pm-label text-xs">Mã PP<select className="pm-input" value={ppId} disabled={save.isLoading} onChange={e=>{setPp(e.target.value);const x=data.paypals.find(y=>y.id===e.target.value);setEmail(x?.emails.find(m=>m.own)?.id||x?.emails[0]?.id||'');}}>
      <option value="">Chọn mã PP</option>{list.map(x=><option key={x.id} value={x.id}>{x.code} · {PP_STATUS_LABEL[x.status]||x.status}{x.balanceUsd!==null?' · số dư '+formatUsd(x.balanceUsd):''} · {x.unused} email trống{x.emails.some(e=>e.own)?' · đang dùng':''}</option>)}</select></label>
    {pp&&<div className="vm-pp-info text-xs" aria-live="polite">
      <span>Tình trạng <strong className={pp.usable?'':'text-amber-600'}>{PP_STATUS_LABEL[pp.status]||pp.status}</strong></span>
      {g?<><span>Số dư USD <strong>{formatUsd(pp.balanceUsd!)}</strong></span><span>Chờ về <strong>{formatUsd(pp.pendingUsd!)}</strong></span><span>Thiếu đến $100,00 <strong>{formatUsd(g.missing)}</strong></span><span>Sau khoản này <strong>{formatUsd(g.projectedWith)}</strong></span><span className="vm-gather">{gatherText(g)}</span></>:<span className="pm-muted">Số dư cần quyền xem tiền vào và tiền ra</span>}
      <span>Email chưa dùng còn <strong>{pp.unused}</strong></span></div>}
    {pp&&<label className="pm-label text-xs">Email nhận<select className="pm-input" value={emailId} disabled={save.isLoading} onChange={e=>setEmail(e.target.value)}>{pp.emails.map(e=><option key={e.id} value={e.id}>{e.email}{e.own?' (đang giữ cho EarnApp này)':''}</option>)}</select>
      {emailId&&emailId!==own&&data.earnApp&&<span className="text-xs pm-muted">Email mới sẽ được giữ riêng cho {data.earnApp.login} khi lưu; email đã gán không cấp cho EarnApp khác.</span>}</label>}
    <div className="grid grid-cols-2 gap-2"><label className="pm-label text-xs">Số tiền (USD)<input className="pm-input" inputMode="decimal" value={amount} disabled={save.isLoading} aria-invalid={!!amount&&!amountOk} onChange={e=>setAmount(e.target.value)}/></label><label className="pm-label text-xs">Ngày yêu cầu<input type="date" className="pm-input" value={date} disabled={save.isLoading} onChange={e=>setDate(e.target.value)}/></label></div>
    {amount&&!amountOk&&<span className="text-xs text-red-600" role="alert">Số tiền là số dương, tối đa 2 chữ số thập phân</span>}
    <label className="pm-label text-xs">Mã tham chiếu (nếu có)<input className="pm-input" value={reference} maxLength={200} disabled={save.isLoading} onChange={e=>setRef(e.target.value)}/></label>
    {data.rights.prepareOnly?<p className="text-xs pm-muted">Chuẩn bị: giữ email, chưa bấm rút trên EarnApp (quyền «Chuẩn bị rút EarnApp»).</p>:<label className="text-xs flex items-center gap-1"><input type="checkbox" checked={prepare} onChange={e=>setPrepare(e.target.checked)}/>Chỉ chuẩn bị (giữ email, chưa bấm rút trên EarnApp)</label>}
    <p className="text-xs pm-muted">Mỗi EarnApp chỉ một lượt rút. Yêu cầu chưa phải tiền về; tiền về ghi ở bước sau. Ghi yêu cầu trên web không chứng minh EarnApp đã nhận.</p>
    {moved&&<p role="alert" className="vm-status-error">VM đã đổi tài khoản EarnApp hoặc sang lượt mới từ khi mở form. Nháp giữ nguyên, không lưu cho tài khoản mới; kiểm tra lại thực tế rồi đóng khung và ghi lần mới.</p>}
    {error&&<p role="alert" className="vm-status-error">{error}</p>}
    <button type="button" className="pm-button pm-button-primary w-full" disabled={save.isLoading||!emailId||!amountOk||moved||!bound} onClick={()=>void submit()}>{save.isLoading?'Đang lưu…':prepare||data.rights.prepareOnly?'Lưu chuẩn bị rút (giữ email)':'Lưu yêu cầu rút (đã gửi trên EarnApp)'}</button>
  </div>;
}
// narrow: the member records money with PAYPAL_RECEIPT_RECORD only — recordPayoutReceipt (confirmed, this request, no "khoản riêng").
function RequestAction({projectId,vm,mode,request:live,narrow,lock,onDone,onBack}:{projectId:string;vm:ManagedVM;mode:Exclude<Mode,'request'|'recreate'|null>;request:NonNullable<OpsRow['request']>|null;narrow?:boolean;lock:React.MutableRefObject<boolean>;onDone:()=>Promise<void>;onBack:()=>void}){
  // The action belongs to the request it was opened on (review fix 20/10/2026); a reload with another request / account keeps the
  // form, says so and locks Lưu.
  const [r]=useState(live!),moved=!live||live.id!==r.id||live.earnAppId!==r.earnAppId||live.cycle!==r.cycle;
  const update=trpc.vmOps.updatePayout.useMutation(),receipt=trpc.accountStore.receiptRecord.useMutation(),own=trpc.vmOps.payoutReceipt.useMutation(),keyOf=useCommandKey();
  const [note,setNote]=useState(''),[amount,setAmount]=useState(r.money&&mode==='receive'?r.money.remaining:''),[status,setStatus]=useState<'RECEIVED'|'PENDING'>('RECEIVED'),[txid,setTx]=useState(''),[date,setDate]=useState(today()),[distinct,setDistinct]=useState(false),[error,setError]=useState(''),[suspect,setSuspect]=useState('');
  const busy=update.isLoading||receipt.isLoading||own.isLoading;
  async function run(){
    if(lock.current||moved)return;setError('');lock.current=true;
    try{
      if(mode==='receive'&&narrow){
        const input={projectId,requestId:r.id,expectedRequestRevision:r.revision,amount:amount.trim().replace(',','.'),currency:r.money?.currency||'USD',receivedAt:date===today()?new Date().toISOString():date+'T12:00:00+07:00',transactionId:txid.trim()||null};
        await own.mutateAsync({...input,key:keyOf(input)});toast.success('Đã ghi tiền về '+r.paypal+' · '+vm.code);
      }else if(mode==='receive'){
        // The same book as Kho tài khoản → Ghi tiền vào: one line for this request's email; the server links it to the request.
        const input={projectId,paypalId:r.paypalId,date,currency:r.money?.currency||'USD',status,text:`${r.email} | ${amount.trim().replace(',','.')}${txid.trim()?' | '+txid.trim():''}`,distinct:distinct?[1]:[]};
        const out=await receipt.mutateAsync({...input,key:keyOf(input)});const row=out.rows[0];
        if(!out.saved){if(row?.outcome==='SUSPECT'){setSuspect(row.message);return;}throw new Error(row?.message||'Chưa ghi được');}
        toast.success('Đã ghi '+(status==='RECEIVED'?'tiền về ':'khoản chờ nhận ')+r.paypal+' · '+vm.code);
      }else{
        const action=mode==='fail'?'FAILED':mode==='cancel'?'CANCELLED':mode==='retry'?'RETRY':mode==='sent'?'SENT':mode==='unknown'?'UNKNOWN':'SETTLE',input={projectId,requestId:r.id,expectedRevision:r.revision,vmId:vm.id,expectedCycle:r.cycle,earnAppId:r.earnAppId,action:action as 'FAILED',note:note.trim()||null};
        const out=await update.mutateAsync({...input,key:keyOf(input)});toast.success(out.changed===false?'Không thay đổi':'Đã lưu yêu cầu rút '+vm.code);
      }
      await onDone();
    }catch(e){setError(message(e));}finally{lock.current=false;}
  }
  const needNote=mode!=='retry'&&mode!=='receive'&&mode!=='sent'&&mode!=='unknown';
  return <div className="space-y-2 text-sm">
    {mode==='receive'?<>
      <p className="text-xs">Tiền về <strong>{r.paypal}</strong> qua <strong>{r.email}</strong>. Ghi vào sổ PayPal (Tiền vào), gắn với yêu cầu này.</p>
      <div className="grid grid-cols-2 gap-2"><label className="pm-label text-xs">Số tiền ({r.money?.currency||'USD'})<input className="pm-input" inputMode="decimal" value={amount} disabled={busy} onChange={e=>{setAmount(e.target.value);setSuspect('');}}/></label><label className="pm-label text-xs">Ngày<input type="date" className="pm-input" value={date} disabled={busy} onChange={e=>setDate(e.target.value)}/></label></div>
      {!narrow&&<div className="flex gap-2" role="radiogroup" aria-label="Trạng thái khoản tiền">{([['RECEIVED','Đã nhận'],['PENDING','Chờ nhận']] as const).map(([k,v])=><button key={k} type="button" role="radio" aria-checked={status===k} className={'pm-button'+(status===k?' pm-button-primary':'')} disabled={busy} onClick={()=>setStatus(k)}>{v}</button>)}</div>}
      <label className="pm-label text-xs">Mã giao dịch PayPal (nếu có)<input className="pm-input" value={txid} disabled={busy} onChange={e=>{setTx(e.target.value);setSuspect('');}}/></label>
      <p className="text-xs pm-muted">Trạng thái PAID bên EarnApp hay giờ trong ngày không phải bằng chứng tiền vào PP. Nhận thiếu: ghi đúng số thật; phần còn lại vẫn là tiền chờ.</p>
      {suspect&&<div className="vm-status-error">{suspect}<label className="flex items-center gap-1 mt-1"><input type="checkbox" checked={distinct} onChange={e=>setDistinct(e.target.checked)}/>Đây là khoản riêng</label></div>}
    </>:<>
      <p className="text-xs">{mode==='sent'?'Xác nhận EarnApp đã nhận yêu cầu rút (thấy trong lịch sử rút của EarnApp). Email '+r.email+' thành email nhận của EarnApp này, dùng vĩnh viễn.':mode==='unknown'?'Đã bấm rút nhưng chưa biết kết quả (mất kết nối…). Email vẫn được giữ; kiểm tra lịch sử EarnApp trước khi làm tiếp, không bấm thêm.':mode==='fail'?'Đánh dấu yêu cầu thất bại (vẫn là lượt rút duy nhất của EarnApp này; gửi lại trên cùng yêu cầu).':mode==='cancel'?'Huỷ yêu cầu rút. EarnApp không được ghi yêu cầu thứ hai.':mode==='retry'?'Gửi lại trên cùng yêu cầu rút (không tạo lượt rút mới; email nhận giữ nguyên).':'Chốt đã nhận '+(r.money?viMoney(r.money.received)+' '+r.money.currency+', thiếu '+viMoney(r.money.remaining):'một phần')+'. Ghi rõ phí / chênh lệch.'}</p>
      <label className="pm-label text-xs">{needNote?'Căn cứ / lý do (bắt buộc)':'Ghi chú (nếu có)'}<textarea className="pm-input" rows={2} maxLength={500} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/></label>
    </>}
    {moved&&<p role="alert" className="vm-status-error">VM đã đổi tài khoản EarnApp hoặc sang lượt mới; yêu cầu này thuộc tài khoản cũ. Không lưu ở đây; đối chiếu ở Lịch sử của VM.</p>}
    {error&&<p role="alert" className="vm-status-error">{error}</p>}
    <div className="flex gap-2 justify-end"><button type="button" className="pm-button pm-button-quiet" disabled={busy} onClick={onBack}>Quay lại</button>
      <button type="button" className="pm-button pm-button-primary" disabled={busy||moved||(needNote&&!note.trim())||(mode==='receive'&&(!/^\d+([.,]\d{1,2})?$/.test(amount.trim())||!!suspect&&!distinct))} onClick={()=>void run()}>{busy?'Đang lưu…':mode==='receive'?'Ghi tiền':'Lưu'}</button></div>
  </div>;
}
function RecreateForm({projectId,vm,cycle,sus,lock,onDone}:{projectId:string;vm:ManagedVM;cycle:number;sus:boolean;lock:React.MutableRefObject<boolean>;onDone:()=>Promise<void>}){
  const save=trpc.vmOps.recreate.useMutation(),keyOf=useCommandKey(),[note,setNote]=useState(''),[error,setError]=useState('');
  const installed=vm.installed,blocked=vm.holds.some(h=>h.state==='BLOCKED');
  async function run(){
    if(lock.current)return;setError('');lock.current=true;
    const input={projectId,vmId:vm.id,expectedCycle:cycle,note:note.trim()||null};
    try{const r=await save.mutateAsync({...input,key:keyOf(input)});toast.success(r.where+': lượt '+r.cycle+' · New VM · '+r.proxy,{duration:6000});await onDone();}catch(e){setError(message(e));}finally{lock.current=false;}
  }
  return <div className="space-y-2 text-sm">
    <p className="text-xs">Chỉ bấm khi máy thật <strong>đã được tạo lại</strong>{sus?' (EarnApp bị SUS vĩnh viễn)':''}. Web sẽ:</p>
    <ul className="text-xs list-disc pl-4 space-y-0.5">
      <li>Giữ id, server và mã <strong>{vm.code}</strong>; mở lượt {cycle+1} (New VM), lưu lượt {cycle}.</li>
      <li>Đóng EarnApp cũ: tài khoản và email không về NEW, không cấp lại.</li>
      <li>{vm.sdks.length?vm.sdks.length+' SDK vẫn nằm trong danh sách của VM ('+vm.sdks.filter(s=>s.state!=='LINKED').length+' chưa dùng, dùng được cho tài khoản mới; mã đã dùng giữ dấu đã dùng, không cấp lại).':'VM chưa có SDK nào; ghi mã thật sau khi cài.'}</li>
      <li>{blocked?'Proxy đang BLOCKED: vẫn ở vị trí và vẫn phải thay (bấm ô Proxy).':installed?'Giữ proxy '+(installed.ip||'')+' cho vị trí ở lượt mới (gán là xong, không có bước cài).':'Không có proxy để giữ.'}</li>
      {sus&&<li>Yêu cầu rút và tiền chờ của lượt cũ giữ nguyên để đối chiếu; mã PP không bị đóng.</li>}
    </ul>
    <label className="pm-label text-xs">Ghi chú (nếu có)<input className="pm-input" maxLength={500} value={note} disabled={save.isLoading} onChange={e=>setNote(e.target.value)}/></label>
    {error&&<p role="alert" className="vm-status-error">{error}</p>}
    <button type="button" className="pm-button pm-button-primary w-full" disabled={save.isLoading} onClick={()=>void run()}>{save.isLoading?'Đang lưu…':'Ghi nhận đã tạo lại VM'}</button>
  </div>;
}
