"use client";
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,Loader2} from 'lucide-react';
import toast from 'react-hot-toast';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {VM_OPS,VM_OPS_STATUSES,NO_STATUS_LABEL,type VmOpsStatus} from '@/lib/vm-ops';
import {formatUsd} from '@/lib/money-input';
import type {ManagedVM} from '../shared';
import type {VmAccount} from './AccountCell';
import {PayoutFrame} from './PayoutFrame';
import {BalanceSection,LineView,requestLine} from './MoneyParts';
import {SdkTimeline} from './SdkCell';
import {shortCode} from './grid-model';
import {fullTime,relativeTime,vmMoneyState,type VmMoneyState} from '@/lib/vm-money';
export type OpsRow=inferRouterOutputs<AppRouter>['vmOps']['board']['vms'][number];
// payout = may prepare a request and record it sent / unknown (managers, or EARN_PAYOUT); writeMoney = every other money action.
// receipt = may record money received for a sent request (managers, or PAYPAL_RECEIPT_RECORD) through recordPayoutReceipt.
export type OpsRights={assign:boolean;money:boolean;writeMoney:boolean;payout?:boolean;receipt?:boolean;balanceRead?:boolean;balanceWrite?:boolean};
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
type Mode='recreate'|null;
// Tiền VM, then "Rút về PayPal" in ONE shared frame (owner 28/10/2026, PayoutFrame): Rút → Đã rút → Tiền đã về → "Chờ tạo lại". The
// milestone comes from the PayPal book; it cannot be picked by hand. Amounts only with the money rights.
export function PayoutCell({projectId,userId,vm,ops,account,rights,onDone,onBusy}:{projectId:string;userId?:string;vm:ManagedVM;ops:OpsRow|undefined;account:VmAccount|undefined;rights:OpsRights;onDone:()=>Promise<unknown>|void;onBusy:(vmId:string,busy:boolean)=>void}){
  const p=usePopover(),[mode,setMode]=useState<Mode>(null),r=ops?.request??null,cycle=ops?.cycle??1,sus=ops?.status==='SUSPENDED';
  const member=ops?.merge?.role==='MEMBER'?ops.merge:null,primary=ops?.merge?.role==='PRIMARY'?ops.merge:null;
  // A member is recreated with the merged payout (received in full, or the primary EarnApp SUS: the server checks which).
  const canRecreate=rights.assign&&(ops?.milestone==='RECREATE'||sus||!!member&&!member.consumed);
  const openWith=(next:Mode)=>{setMode(next);p.setOpen(true);};
  useEffect(()=>{if(!p.open)setMode(null);},[p.open]);
  // "Tiền VM" (owner brief 22/10/2026): the money seen on the machine for the VM's CURRENT SDK code (vm-money.ts), readable at the row
  // without an EarnApp account, then the payout status; the frame keeps the EarnApp balance and the payout flow apart from it.
  const cur=vm.sdks.find(s=>s.current)??null,vmMoney=vmMoneyState(cur?{code:cur.code,amount:cur.amount,observedAt:cur.amountObservedAt,failedAt:cur.amountFailedAt,moneyHidden:cur.moneyHidden,stored:cur.stored}:null),req=requestLine(ops);
  const face=<><VmMoneyFace s={vmMoney}/>{req&&<LineView line={req}/>}{!req&&sus&&<span className="vm-money vm-money-failed">SUS</span>}</>;
  const seen=vmMoney.kind==='OK'||vmMoney.kind==='STALE'?vmMoney.amount:null;
  void onBusy;
  const done=async()=>{await onDone();};
  return <div className="vm-payout" data-vm-money={vmMoney.kind}>
    <button ref={p.anchor} type="button" className="vm-payout-button" aria-haspopup="dialog" aria-expanded={p.open} aria-label={'Tiền trong VM '+vm.server+' / '+vm.code} onClick={()=>p.open?p.setOpen(false):openWith(null)}>{face}</button>
    {canRecreate&&!r&&sus&&<button type="button" className="pm-link text-xs" onClick={()=>openWith('recreate')}>Ghi nhận đã tạo lại (SUS)</button>}
    {p.open&&typeof document!=='undefined'&&createPortal(<div ref={p.pop} role="dialog" aria-label={'Tiền trong VM '+vm.server+' / '+vm.code} className="vm-status-pop vm-payout-pop" style={{top:p.pos?.top??-9999,left:p.pos?.left??-9999}}>
      <p className="vm-status-pop-title"><strong>{vm.server} / {vm.code}</strong> · lượt {cycle}{account?.earnApp?' · '+account.earnApp.login.email:''}</p>
      {mode==='recreate'?<RecreateForm projectId={projectId} vm={vm} cycle={cycle} sus={(sus||!!member)&&ops?.milestone!=='RECREATE'} lock={p.lock} onDone={async()=>{p.setOpen(false);await onDone();}}/>
      :<div className="space-y-2">
        <VmMoneySection projectId={projectId} s={vmMoney} source={cur?.amountSource??null} sdkId={cur?.recordId??null} cycle={cycle} vmId={vm.id}/>
        {ops&&!!ops.earnAppId&&<BalanceSection projectId={projectId} vmCode={vm.code} ops={ops} read={!!rights.balanceRead} write={!!rights.balanceWrite} onSaved={onDone}/>}
        <p className="font-semibold text-xs">Rút về PayPal</p>
        {primary&&r&&<MergedMembers projectId={projectId} request={r} members={primary.members} canEdit={!!(rights.writeMoney||rights.payout)} onDone={onDone}/>}
        <PayoutFrame projectId={projectId} userId={userId} vmId={vm.id} vmLabel={vm.server+' / '+vm.code} cycle={cycle} earnAppId={ops?.earnAppId??null} request={r} rights={rights} vmMoney={seen} vmRevision={vm.revision}
          readOnly={member?'SDK của VM này đã gộp vào tài khoản EarnApp của '+member.primaryWhere+'; lệnh rút và tiền về ghi ở VM đó.':null} onDone={done}/>
        {ops?.milestone==='RECREATE'&&<p className="text-xs text-emerald-600">Tiền đã về đủ PP. Tạo lại máy thật xong thì bấm “Ghi nhận đã tạo lại VM”.</p>}
        {ops?.milestone==='MONEY_REVIEW'&&<p className="text-xs text-amber-600">Tiền về khác số yêu cầu hoặc khác đồng tiền; cần đối chiếu ở Kho tài khoản.</p>}
        {canRecreate&&<button type="button" className={'vm-status-action'+(ops?.milestone==='RECREATE'?' primary':'')} onClick={()=>setMode('recreate')}>Ghi nhận đã tạo lại VM{ops?.milestone!=='RECREATE'?member&&!sus?' (EarnApp VM chính SUS)':' (SUS)':''}</button>}
      </div>}
    </div>,document.body)}
  </div>;
}
// The row: the figure large, the observation time (relative; full date-time in the title) under it. "Chưa kiểm tra" is never $0;
// "Kiểm tra lỗi" keeps the last good figure with its own time; "Số cũ" after 24 h; "Chưa rõ giờ" for money recorded without a time.
function VmMoneyFace({s}:{s:VmMoneyState}){
  const at=(iso:string|null,label='Kiểm tra')=>iso?<span className="vm-money-line text-xs" title={label+' lúc '+fullTime(iso)+(s.code?' · SDK '+s.code:'')}>{label} {relativeTime(iso)}</span>:null;
  if(s.kind==='UNCHECKED')return <span className="vm-money-amount vm-money-none" title={s.code?'SDK '+s.code+' chưa có số tiền kiểm tra ở lượt này':'VM chưa có SDK hiện hành ở lượt này'}>Chưa kiểm tra</span>;
  if(s.kind==='HIDDEN')return <span className="vm-money-amount vm-money-none" title="Tiền trong VM: cần quyền xem tiền (quyền tiền hoặc Ghi kiểm tra tiền EarnApp)">Ẩn</span>;
  if(s.kind==='FAILED')return <><span className="vm-money-head"><span className={'vm-money-amount'+(s.amount==null?' vm-money-none':'')}>{s.amount!=null?formatUsd(s.amount):'Chưa có số'}</span><span className="vm-money vm-money-failed">Kiểm tra lỗi</span></span>
    <span className="vm-money-line text-xs" title={'Lần đọc lỗi lúc '+fullTime(s.failedAt)+(s.at?' · số gần nhất lúc '+fullTime(s.at):'')+' · SDK '+s.code}>Lỗi {relativeTime(s.failedAt)}{s.at?' · số gần nhất '+relativeTime(s.at):''}</span></>;
  if(s.kind==='NO_TIME')return <><span className="vm-money-amount">{formatUsd(s.amount)}</span><span className="vm-money-line text-xs" title={'Tiền ghi trước khi có giờ quan sát · SDK '+s.code}>Chưa rõ giờ</span></>;
  return <><span className="vm-money-head"><span className="vm-money-amount">{formatUsd(s.amount)}</span>{s.kind==='STALE'&&<span className="vm-money vm-money-waiting">Số cũ</span>}</span>{at(s.at)}</>;
}
function VmMoneySection({projectId,s,source,sdkId,cycle,vmId}:{projectId:string;s:VmMoneyState;source:string|null;sdkId:string|null;cycle:number;vmId:string}){
  const [open,setOpen]=useState(false);
  return <div className="space-y-1 text-xs" data-testid="vm-money-section">
    <p className="font-semibold">Tiền trong VM (tiền tích luỹ của SDK đang chạy)</p>
    {s.kind==='UNCHECKED'&&!s.code?<p className="pm-muted">VM chưa có SDK hiện hành ở lượt {cycle}; tiền của lượt / mã trước nằm trong Kho SDK và lịch sử, không tính là tiền hiện tại.</p>
    :s.kind==='UNCHECKED'?<p>SDK <code>{shortCode(s.code!)}</code> · <span className="pm-muted">chưa kiểm tra ở lượt {cycle} trên VM này.</span>{s.stored?<><br/><span className="pm-muted">Mã này có số {formatUsd(s.stored.amount!)} đọc {s.stored.observedAt?'lúc '+fullTime(s.stored.observedAt):'(chưa rõ giờ)'}{s.stored.cycle?' ở lượt '+s.stored.cycle:''}{s.stored.vmId&&s.stored.vmId!==vmId?' trên VM khác':''}: giữ làm lịch sử, không tính là tiền lượt này.</span></>:null}</p>
    :s.kind==='HIDDEN'?<p className="pm-muted">Số tiền ẩn theo quyền (cần quyền tiền hoặc “Ghi kiểm tra tiền EarnApp”).</p>
    :<p>SDK <code>{shortCode(s.code)}</code> · <strong>{s.amount!=null?formatUsd(s.amount):'chưa có số'}</strong>
      {s.kind==='FAILED'?<> · <span className="text-red-600">kiểm tra lỗi lúc {fullTime(s.failedAt)}</span>{s.at?' · số gần nhất lúc '+fullTime(s.at):''}</>:s.kind==='NO_TIME'?' · chưa rõ giờ quan sát (tiền ghi trước khi có giờ)':<> · quan sát lúc {fullTime(s.at!)}{s.kind==='STALE'?' · số cũ (hơn 24 giờ)':''}</>}
      {source?<><br/><span className="pm-muted">Nguồn: {source}</span></>:null}</p>}
    <p className="pm-muted">Không phải số dư tài khoản EarnApp; các SDK dự phòng không được cộng vào.</p>
    {sdkId&&<details open={open} onToggle={e=>setOpen((e.target as HTMLDetailsElement).open)}><summary className="cursor-pointer">Lịch sử kiểm tra</summary>{open&&<SdkTimeline projectId={projectId} sdkId={sdkId}/>}</details>}
  </div>;
}
// The other VMs of a merged payout (27/10/2026), listed on the primary; "Bỏ gộp" only before the click on EarnApp (PREPARING).
function MergedMembers({projectId,request:r,members,canEdit,onDone}:{projectId:string;request:NonNullable<OpsRow['request']>;members:{vmId:string;where:string;share:string|null;consumed:boolean}[];canEdit:boolean;onDone:()=>Promise<unknown>|void}){
  const remove=trpc.vmOps.removePayoutMember.useMutation(),keyOf=useCommandKey(),[error,setError]=useState('');
  return <div className="text-xs space-y-1" aria-label="VM gộp vào lệnh rút"><p>Lệnh rút gộp {members.length+1} VM (VM này là VM chính):</p><ul className="space-y-1">{members.map(x=><li key={x.vmId} className="flex gap-2 items-center"><span>{x.where}</span>{x.share&&<span className="pm-muted">{formatUsd(x.share)}</span>}{x.consumed&&<span className="pm-muted">· đã tạo lại</span>}
    {canEdit&&r.submission==='PREPARING'&&r.state==='REQUESTED'&&<button type="button" className="pm-link" disabled={remove.isLoading} onClick={async()=>{const input={projectId,requestId:r.id,expectedRevision:r.revision,vmId:x.vmId};setError('');try{await remove.mutateAsync({...input,key:keyOf(input)});await onDone();}catch(e){setError(e instanceof Error?e.message:'Chưa bỏ gộp được');}}}>Bỏ gộp</button>}</li>)}</ul>
    {error&&<p className="pm-error" role="alert">{error}</p>}</div>;
}
type PickPaypalRow=inferRouterOutputs<AppRouter>['vmOps']['payoutPick']['paypals'][number];
type PayoutDaily={date:string;timeZone:string;limit:number;used:number;reserved:number;remaining:number};
// Optional only for older cached picker responses; a supplied allowance is always authoritative.
export type PickPaypal=Omit<PickPaypalRow,'daily'|'emails'>&{daily?:PayoutDaily;emails:(Omit<PickPaypalRow['emails'][number],'dailyAllowed'|'dailyOccupied'>&{dailyAllowed?:boolean;dailyOccupied?:boolean})[]};
export function payoutEmailAllowed(pp:PickPaypal,email:PickPaypal['emails'][number]){
  return email.dailyAllowed??(!pp.daily||pp.daily.remaining>0);
}
export function PayoutDailyInfo({paypal}:{paypal:PickPaypal}){
  const d=paypal.daily;
  return d?<span title={d.date+' · '+d.timeZone}>Hôm nay {d.used+d.reserved}/{d.limit} email · còn {d.remaining} · đang giữ {d.reserved}</span>:null;
}
function RecreateForm({projectId,vm,cycle,sus,lock,onDone}:{projectId:string;vm:ManagedVM;cycle:number;sus:boolean;lock:React.MutableRefObject<boolean>;onDone:()=>Promise<void>}){
  const save=trpc.vmOps.recreate.useMutation(),keyOf=useCommandKey(),[note,setNote]=useState(''),[error,setError]=useState('');
  const installed=vm.installed,blocked=vm.holds.some(h=>h.state==='BLOCKED');
  async function run(){
    if(lock.current)return;setError('');lock.current=true;
    const input={projectId,vmId:vm.id,expectedCycle:cycle,note:note.trim()||null};
    try{const r=await save.mutateAsync({...input,key:keyOf(input)});toast.success(r.where+': lượt '+r.cycle+' · Chưa cài · '+r.proxy,{duration:6000});await onDone();}catch(e){setError(message(e));}finally{lock.current=false;}
  }
  return <div className="space-y-2 text-sm">
    <p className="text-xs">Chỉ bấm khi máy thật <strong>đã được tạo lại</strong>{sus?' (EarnApp bị SUS vĩnh viễn)':''}. Web sẽ:</p>
    <ul className="text-xs list-disc pl-4 space-y-0.5">
      <li>Giữ id, server và mã <strong>{vm.code}</strong>; mở lượt {cycle+1} (Chưa cài), lưu lượt {cycle}.</li>
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
