"use client";
import {useEffect,useRef,useState} from 'react';
import toast from 'react-hot-toast';
import {Copy} from 'lucide-react';
import {trpc} from '@/lib/trpc';
import {formatLedger} from '@/lib/money-input';
import type {OpsRights} from './OpsCells';
import {PayoutDailyInfo,payoutEmailAllowed} from './OpsCells';
import {payoutActions,requestHasReceipts,pickPayoutEmail,defaultPayoutAmount,receiptCheck,frameJournalKey,readFrameCommand,refusedAnswer,bangkokDay,requestLabel,unchangedMessage,
  type VmOpsRequestView,type FrameAction,type FrameCommand,type FrameCommandAction} from './payout-frame-model';
import {receiptBody} from './payout-bulk-model';
// One payout frame (owner 28/10/2026) for the Tiền VM cell, the VM panel and the "Rút EarnApp" report: Rút (one click, email held),
// Đã rút, Bỏ, Sửa, Bỏ "Đã rút", Tiền đã về (exact PayPal amount), EarnApp bị SUS, Thất bại, Gửi lại. Every command keeps its key and
// exact body in this tab before sending; a lost answer is retried with the same key and body (pattern of PayoutBulkPanel).
export type {VmOpsRequestView} from './payout-frame-model';
const ACTION_LABEL:Record<FrameCommandAction,string>={REQUEST:'Rút',SEND:'Đã rút',DROP:'Bỏ',EDIT:'Sửa',UNSEND:'Bỏ "Đã rút"',RECEIPT:'Tiền đã về',SETTLE:'Chốt nhận thiếu',SUS:'EarnApp bị SUS',FAIL:'Thất bại',RETRY:'Gửi lại',VOID:'Xoá ghi nhầm'};
const DONE:Record<FrameCommandAction,string>={REQUEST:'Đã giữ email, đang rút',SEND:'Đã ghi "Đã rút"',DROP:'Đã bỏ yêu cầu rút, email trả kho',EDIT:'Đã sửa yêu cầu rút',UNSEND:'Đã bỏ "Đã rút"',RECEIPT:'Đã ghi tiền về PayPal',SETTLE:'Đã chốt nhận thiếu',SUS:'Đã ghi EarnApp bị SUS',FAIL:'Đã ghi thất bại',RETRY:'Đã ghi gửi lại',VOID:'Đã xoá do ghi nhầm'};
const message=(e:unknown)=>e instanceof Error?e.message:'Không nhận được phản hồi hợp lệ';
const ymd=(d:string)=>d.split('-').reverse().join('/');
const tone=(label:string)=>label==='Đã về'||label==='Về thiếu (đã chốt)'?'recreate':label==='Mất do SUS'||label==='Thất bại'||label==='Đã huỷ'||label==='Chưa rõ đã rút chưa'?'failed':label==='Cần đối chiếu tiền'?'money_review':'waiting';
type Form='EDIT'|'RECEIPT'|'SUS'|'FAIL'|'SETTLE'|null;
export interface PayoutFrameProps {projectId:string;userId?:string;vmId:string;cycle:number;earnAppId:string|null;request:VmOpsRequestView|null;rights:OpsRights;
  /** Tiền VM of the current SDK: the default amount of "Rút". */vmMoney?:string|null;vmRevision?:number;vmLabel?:string;
  /** A merged member: the request belongs to the primary VM and is acted on there. */readOnly?:string|null;onDone():Promise<unknown>|void}
export function PayoutFrame({projectId,userId,vmId,cycle,earnAppId,request:r,rights,vmMoney,vmRevision,vmLabel,readOnly,onDone}:PayoutFrameProps){
  const utils=trpc.useContext();
  const m={REQUEST:trpc.vmOps.requestPayout.useMutation(),UPDATE:trpc.vmOps.updatePayout.useMutation(),EDIT:trpc.vmOps.editPayout.useMutation(),UNSEND:trpc.vmOps.unsendPayout.useMutation(),VOID:trpc.vmOps.voidPayout.useMutation(),SUS:trpc.vmOps.suspendEarnApp.useMutation(),RECEIPT:trpc.vmOps.payoutReceipt.useMutation()};
  const vmTarget='vm:'+vmId+':'+cycle,target=r?'req:'+r.id:vmTarget,storage=frameJournalKey(projectId,userId??'',target);
  // The journal is per signed-in user: until the session is known nothing is read, written or sent (no shared anonymous keys).
  const read=()=>{if(!userId)return null;try{return readFrameCommand(window.sessionStorage.getItem(storage),projectId,target);}catch{return null;}};
  const [pending,setPending]=useState<FrameCommand|null>(read),[form,setForm]=useState<Form>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[amount,setAmount]=useState(()=>defaultPayoutAmount(vmMoney)),[edited,setEdited]=useState(false),[stuck,setStuck]=useState(false);
  const lock=useRef(false);
  // The default amount follows the latest Tiền VM of the board until the person types an amount.
  useEffect(()=>{if(!edited)setAmount(defaultPayoutAmount(vmMoney));},[vmMoney,edited]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{setPending(read());setError('');setStuck(false);},[storage]);
  // A request is on the VM now: an earlier "Rút" of this round landed (or another one did); never send that one again.
  useEffect(()=>{if(r&&userId)try{window.sessionStorage.removeItem(frameJournalKey(projectId,userId,vmTarget));}catch{/* nothing to clear */}},[r,projectId,userId,vmTarget]);
  const actions=readOnly||!r||!userId?[]:payoutActions({phase:r.phase,submission:r.submission,state:r.state,hasReceipts:requestHasReceipts(r.money),consumed:false,rights});
  async function send(c:FrameCommand){
    const b=c.body as never;
    switch(c.action){
      case 'REQUEST':return m.REQUEST.mutateAsync(b);
      case 'SEND':case 'FAIL':case 'RETRY':case 'SETTLE':return m.UPDATE.mutateAsync(b);
      case 'EDIT':return m.EDIT.mutateAsync(b);
      case 'UNSEND':return m.UNSEND.mutateAsync(b);
      case 'DROP':case 'VOID':return m.VOID.mutateAsync(b);
      case 'SUS':return m.SUS.mutateAsync(b);
      case 'RECEIPT':return m.RECEIPT.mutateAsync(b);
    }
  }
  /** One intended action = one key; the exact body is journaled first, a retry sends it again unchanged. */
  async function run(action:FrameCommandAction,body:Record<string,unknown>|null){
    if(lock.current||!userId)return false;lock.current=true;setBusy(true);setError('');
    const retry=!!pending,command:FrameCommand=pending??{action,target,body:{...body,projectId,key:crypto.randomUUID()}};
    try{
      if(!retry){try{window.sessionStorage.setItem(storage,JSON.stringify(command));}catch{setError('Không lưu được mã chống lặp trong tab; chưa gửi lệnh.');return false;}setPending(command);}
      let answer:unknown;
      try{answer=await send(command);}catch(e){
        // A definite refusal of a first send recorded nothing; a refused retry cannot settle an earlier lost answer.
        if(!retry&&refusedAnswer(e)){try{window.sessionStorage.removeItem(storage);}catch{/* retained key is safe */}setPending(null);setError(message(e));}
        // A refused retry is an answer about the CURRENT state, not about the lost first send: keep the command, but let the person
        // drop it once they have reconciled (otherwise the frame would stay locked forever).
        else if(retry&&refusedAnswer(e)){setStuck(true);setError('Thử lại bị từ chối: '+message(e)+'. Đối chiếu yêu cầu (Lịch sử VM / EarnApp / PayPal) trước khi bỏ lệnh cũ.');}
        else{setStuck(false);setError('Chưa xác định kết quả. Thử lại đúng lệnh cũ: '+message(e));}
        return false;
      }
      try{window.sessionStorage.removeItem(storage);}catch{/* a retained key only replays */}
      setPending(null);setStuck(false);setForm(null);toast.success((unchangedMessage(command.action,answer)??DONE[command.action])+(vmLabel?' · '+vmLabel:''));
      try{await onDone();}catch{setError('Đã lưu; chưa tải lại được bảng. Không bấm lại.');}
      return true;
    }finally{lock.current=false;setBusy(false);}
  }
  const id=r?{requestId:r.id,expectedRevision:r.revision,vmId,expectedCycle:r.cycle,earnAppId:r.earnAppId}:null;
  async function withdraw(){
    if(!earnAppId||lock.current)return;
    const a=amount.trim().replace(',','.');if(!/^\d+(\.\d{1,2})?$/.test(a)||Number(a)<=0){setError('Số tiền là số dương, tối đa 2 chữ số thập phân');return;}
    setError('');setBusy(true);
    let emailId:string;
    try{const pick=await utils.vmOps.payoutPick.fetch({projectId,vmId,amount:a});
      if(pick.earnApp&&pick.earnApp.id!==earnAppId){setError('VM đã đổi tài khoản EarnApp; tải lại rồi rút.');return;}
      const chosen=pickPayoutEmail(pick);if('error' in chosen){setError(chosen.error);return;}emailId=chosen.emailId;}
    catch(e){setError(message(e));return;}finally{setBusy(false);}
    await run('REQUEST',{vmId,expectedCycle:cycle,...(vmRevision!==undefined?{expectedVmRevision:vmRevision}:{}),earnAppId,paypalEmailId:emailId,amount:a,currency:'USD',date:bangkokDay(),submission:'PREPARING'});
  }
  function dropPending(){
    if(!pending||!window.confirm('Bỏ lệnh “'+ACTION_LABEL[pending.action]+'” chưa rõ kết quả? Chỉ bỏ khi đã đối chiếu: lệnh cũ sẽ không được gửi lại.'))return;
    try{window.sessionStorage.removeItem(storage);}catch{/* nothing stored */}setPending(null);setStuck(false);setError('');
  }
  const copy=(text:string)=>{void navigator.clipboard?.writeText(text).then(()=>toast.success('Đã copy email'),()=>toast.error('Trình duyệt chưa cho phép copy'));};
  const can=(a:FrameAction)=>actions.includes(a),locked=busy||!!pending;
  const label=r?requestLabel(r):'',money=r?.money??null;
  return <div className="space-y-2 text-xs" data-payout-frame={r?.id??vmTarget} aria-label="Rút về PayPal">
    {pending&&<div className="vm-status-error space-y-1" role="alert"><p>Lệnh “{ACTION_LABEL[pending.action]}” chưa rõ kết quả. Thử lại gửi đúng lệnh cũ (cùng mã), không tạo lệnh mới.</p>
      <button type="button" className="pm-button pm-button-primary pm-button-sm" disabled={busy} onClick={()=>void run(pending.action,null)}>{busy?'Đang gửi…':'Thử lại đúng lệnh'}</button>
      {stuck&&<button type="button" className="pm-button pm-button-sm" disabled={busy} onClick={dropPending}>Bỏ lệnh chưa rõ (đã đối chiếu)</button>}</div>}
    {!r?<>
      {readOnly?<p className="pm-muted">{readOnly}</p>:!userId?<p className="pm-muted">Đang tải phiên đăng nhập…</p>:!earnAppId?<p className="pm-muted">VM chưa có tài khoản EarnApp ở lượt này.</p>
      :rights.writeMoney||rights.payout?<div className="flex gap-2 items-end flex-wrap">
        <label className="pm-label text-xs">Số tiền rút ($)<input className="pm-input" inputMode="decimal" aria-label="Số tiền rút" value={amount} disabled={locked} onChange={e=>{setAmount(e.target.value);setEdited(true);setError('');}}/></label>
        <button type="button" className="pm-button pm-button-primary" disabled={locked||!amount.trim()} onClick={()=>void withdraw()}>{busy?'Đang rút…':'Rút'}</button>
        <p className="pm-muted w-full">Bấm “Rút” giữ ngay một email PayPal theo gợi ý; rút trên EarnApp rồi bấm “Đã rút”.</p></div>
      :<p className="pm-muted">Rút cần quyền ghi Tiền vào PayPal hoặc quyền “Chuẩn bị rút EarnApp”.</p>}
    </>:<>
      <p className="flex items-center gap-2 flex-wrap"><span className={'vm-money vm-money-'+tone(label)}>{label}</span><span className="pm-muted">Ngày rút {ymd(r.requestedAt)}</span></p>
      <p className="flex items-center gap-1 flex-wrap"><strong>{r.paypal}</strong> · <span className="break-all">{r.email}</span>
        <button type="button" className="pm-button pm-button-quiet pm-button-sm" aria-label={'Copy email '+r.email} onClick={()=>copy(r.email)}><Copy size={12}/>Copy</button></p>
      {money?<p>Đã rút <strong>{formatLedger(money.amount,money.currency)}</strong>{money.received!=='0.00'?<> · đã về <strong>{formatLedger(money.received,money.currency)}</strong></>:null}{r.phase==='WAITING'&&money.received!=='0.00'?' · còn chờ '+formatLedger(money.remaining,money.currency):''}
        {money.shortfall&&money.shortfall!=='0.00'?' · phí / thiếu '+formatLedger(money.shortfall,money.currency):''}{money.lost?' · mất '+formatLedger(money.lost,money.currency):''}</p>:<p className="pm-muted">Số tiền chỉ hiện cho người có quyền tiền.</p>}
      {r.reference&&<p className="pm-muted">Mã tham chiếu {r.reference}</p>}
      {r.stateNote&&r.state!=='REQUESTED'&&<p className="pm-muted">{r.stateNote}</p>}
      {readOnly&&<p className="pm-muted">{readOnly}</p>}
      {r.phase==='REVIEW'&&<p className="pm-muted">Cần đối chiếu tiền về ở Kho tài khoản / Tiền vào PayPal.</p>}
      {actions.length>0&&<div className="flex gap-2 flex-wrap">
        {can('SEND')&&<button type="button" className="pm-button pm-button-primary pm-button-sm" disabled={locked} onClick={()=>void run('SEND',{...id,action:'SENT',note:null})}>Đã rút</button>}
        {can('RECEIPT')&&<button type="button" className={'pm-button pm-button-sm'+(form==='RECEIPT'?'':' pm-button-primary')} disabled={locked} onClick={()=>setForm(form==='RECEIPT'?null:'RECEIPT')}>Tiền đã về</button>}
        {can('DROP')&&<button type="button" className="pm-button pm-button-sm" disabled={locked} onClick={()=>void run('DROP',{...id,reason:'Bỏ trước khi rút'})}>Bỏ</button>}
        {can('EDIT')&&<button type="button" className="pm-button pm-button-sm" disabled={locked} aria-pressed={form==='EDIT'} onClick={()=>setForm(form==='EDIT'?null:'EDIT')}>Sửa</button>}
        {can('UNSEND')&&<button type="button" className="pm-button pm-button-sm" disabled={locked} onClick={()=>void run('UNSEND',{...id,note:null})}>{ACTION_LABEL.UNSEND}</button>}
        {can('SETTLE')&&<button type="button" className="pm-button pm-button-sm" disabled={locked} aria-pressed={form==='SETTLE'} onClick={()=>setForm(form==='SETTLE'?null:'SETTLE')}>Chốt nhận thiếu</button>}
        {can('RETRY')&&<button type="button" className="pm-button pm-button-sm" disabled={locked} onClick={()=>void run('RETRY',{...id,action:'RETRY',note:null})}>Gửi lại</button>}
        {can('FAIL')&&<button type="button" className="pm-button pm-button-sm" disabled={locked} aria-pressed={form==='FAIL'} onClick={()=>setForm(form==='FAIL'?null:'FAIL')}>Thất bại</button>}
        {can('SUS')&&<button type="button" className="pm-button pm-button-sm" disabled={locked} aria-pressed={form==='SUS'} onClick={()=>setForm(form==='SUS'?null:'SUS')}>EarnApp bị SUS</button>}
      </div>}
      {form==='RECEIPT'&&r&&<ReceiptForm request={r} busy={locked} onSubmit={b=>run('RECEIPT',{requestId:r.id,expectedRequestRevision:r.revision,...b})} onCancel={()=>setForm(null)}/>}
      {form==='EDIT'&&r&&id&&<EditForm projectId={projectId} vmId={vmId} request={r} busy={locked} onSubmit={b=>run('EDIT',{...id,...b})} onCancel={()=>setForm(null)}/>}
      {form==='SETTLE'&&r&&id&&<NoteForm title={'Chốt đã nhận '+(r.money?formatLedger(r.money.received,r.money.currency)+', phần còn lại '+formatLedger(r.money.remaining,r.money.currency):'một phần')+' là phí / thiếu.'} label="Lý do / phí (bắt buộc)" submit="Chốt nhận thiếu" required busy={locked} onSubmit={note=>run('SETTLE',{...id,action:'SETTLE',note})} onCancel={()=>setForm(null)}/>}
      {form==='FAIL'&&r&&id&&<NoteForm title="Ghi yêu cầu rút thất bại (vẫn là lượt rút duy nhất; gửi lại trên cùng yêu cầu)." label="Lý do (bắt buộc)" submit="Ghi thất bại" required busy={locked} onSubmit={note=>run('FAIL',{...id,action:'FAILED',note})} onCancel={()=>setForm(null)}/>}
    </>}
    {form==='SUS'&&<NoteForm title="EarnApp bị SUS: VM chuyển SUS; yêu cầu chưa gửi bị xoá, phần còn chờ ghi “Mất do SUS”; email PayPal của EarnApp này rời kho, không cấp lại." label="Ghi chú ngắn" submit="Ghi EarnApp bị SUS" busy={locked} onSubmit={note=>run('SUS',{vmId,expectedCycle:cycle,...(vmRevision!==undefined?{expectedVmRevision:vmRevision}:{}),note})} onCancel={()=>setForm(null)}/>}
    {!r&&!readOnly&&userId&&earnAppId&&rights.assign&&form!=='SUS'&&<button type="button" className="pm-button pm-button-quiet pm-button-sm" disabled={locked} onClick={()=>setForm('SUS')}>EarnApp bị SUS</button>}
    {error&&<p role="alert" className="vm-status-error">{error}</p>}
  </div>;
}
function NoteForm({title,label,submit,required,busy,onSubmit,onCancel}:{title:string;label:string;submit:string;required?:boolean;busy:boolean;onSubmit:(note:string|null)=>Promise<boolean>;onCancel:()=>void}){
  const [note,setNote]=useState('');
  return <div className="space-y-2"><p>{title}</p>
    <label className="pm-label text-xs">{label}<textarea className="pm-input" rows={2} maxLength={500} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/></label>
    <div className="flex gap-2 justify-end"><button type="button" className="pm-button pm-button-quiet pm-button-sm" disabled={busy} onClick={onCancel}>Quay lại</button>
      <button type="button" className="pm-button pm-button-primary pm-button-sm" disabled={busy||!!required&&!note.trim()} onClick={()=>void onSubmit(note.trim()||null)}>{busy?'Đang lưu…':submit}</button></div></div>;
}
// "Tiền đã về": the exact amount seen in PayPal (empty, required), the withdrawn amount and the fee next to it, today (Bangkok) by
// default, an optional PayPal transaction id, and "Chốt luôn, phần thiếu là phí" ticked while the amount is below what is open.
function ReceiptForm({request:r,busy,onSubmit,onCancel}:{request:VmOpsRequestView;busy:boolean;onSubmit:(b:Record<string,unknown>)=>Promise<boolean>;onCancel:()=>void}){
  const [entered,setEntered]=useState(''),[date,setDate]=useState(bangkokDay),[txid,setTx]=useState(''),[settle,setSettle]=useState(true);
  const m=r.money;
  if(!m)return <p className="pm-muted">Ghi tiền về cần quyền xem số tiền của yêu cầu.</p>;
  const c=receiptCheck({...m,phase:r.phase},entered),cur=m.currency,today=bangkokDay();
  const submit=()=>{const b=receiptBody(c,{currency:cur,date,today,txid,settle});if(b)void onSubmit(b);};
  return <div className="space-y-2">
    <p>Tiền về <strong>{r.paypal}</strong> qua <strong>{r.email}</strong>. Đã rút <strong>{formatLedger(m.amount,cur)}</strong>{m.received!=='0.00'?' · đã về '+formatLedger(m.received,cur):''} · còn chờ {formatLedger(c.open,cur)}</p>
    <div className="grid grid-cols-2 gap-2">
      <label className="pm-label text-xs">Số tiền chính xác trong PayPal<input className="pm-input" inputMode="decimal" required aria-required value={entered} disabled={busy} aria-invalid={!!c.error} onChange={e=>setEntered(e.target.value)}/></label>
      <label className="pm-label text-xs">Ngày<input type="date" className="pm-input" value={date} max={today} disabled={busy} onChange={e=>setDate(e.target.value)}/></label></div>
    <p aria-live="polite">{c.fee!==null?<>Phí (rút − thực nhận): <strong>{formatLedger(c.fee,cur)}</strong></>:<span className="pm-muted">Nhập đúng số tiền thấy trong PayPal; phí tự tính.</span>}</p>
    <label className="pm-label text-xs">Mã giao dịch PayPal (nếu có)<input className="pm-input" maxLength={100} value={txid} disabled={busy} onChange={e=>setTx(e.target.value)}/></label>
    {c.showSettle&&<label className="flex items-center gap-1"><input type="checkbox" checked={settle} disabled={busy} onChange={e=>setSettle(e.target.checked)}/>Chốt luôn, phần thiếu là phí</label>}
    {c.error&&<p role="alert" className="vm-status-error">{c.error}</p>}
    <div className="flex gap-2 justify-end"><button type="button" className="pm-button pm-button-quiet pm-button-sm" disabled={busy} onClick={onCancel}>Quay lại</button>
      <button type="button" className="pm-button pm-button-primary pm-button-sm" disabled={busy||!c.valid||!date} onClick={submit}>{busy?'Đang lưu…':'Ghi tiền đã về'}</button></div>
  </div>;
}
// "Sửa": email (Đổi email), amount, withdrawal day, reference; only changed fields are sent. A reason is required once sent or with money.
function EditForm({projectId,vmId,request:r,busy,onSubmit,onCancel}:{projectId:string;vmId:string;request:VmOpsRequestView;busy:boolean;onSubmit:(b:Record<string,unknown>)=>Promise<boolean>;onCancel:()=>void}){
  const pick=trpc.vmOps.payoutPick.useQuery({projectId,vmId,amount:null},{retry:false});
  const [emailId,setEmail]=useState(r.emailId),[amount,setAmount]=useState(r.money?.amount??''),[day,setDay]=useState(r.requestedAt),[reference,setRef]=useState(r.reference??''),[note,setNote]=useState('');
  const needNote=r.submission!=='PREPARING'||requestHasReceipts(r.money);
  const a=amount.trim().replace(',','.'),amountOk=!r.money||/^\d+(\.\d{1,2})?$/.test(a)&&Number(a)>0;
  const body:Record<string,unknown>={};
  if(emailId!==r.emailId)body.paypalEmailId=emailId;
  if(r.money&&amountOk&&Number(a).toFixed(2)!==r.money.amount)body.amount=Number(a).toFixed(2);
  if(day&&day!==r.requestedAt)body.requestedAt=day;
  if(r.money&&reference.trim()!==(r.reference??''))body.reference=reference.trim()||null;
  const changed=Object.keys(body).length>0,ready=changed&&amountOk&&(!needNote||!!note.trim());
  const options=(pick.data?.paypals??[]).flatMap(p=>p.emails.filter(e=>e.id===r.emailId||payoutEmailAllowed(p,e)&&p.usable).map(e=>({p,e})));
  const chosen=options.find(o=>o.e.id===emailId);
  return <div className="space-y-2">
    <label className="pm-label text-xs">Đổi email<select className="pm-input" value={emailId} disabled={busy||!pick.data} onChange={e=>setEmail(e.target.value)}>
      {!options.some(o=>o.e.id===r.emailId)&&<option value={r.emailId}>{r.paypal} · {r.email}</option>}
      {options.map(o=><option key={o.e.id} value={o.e.id}>{o.p.code} · {o.e.email}{o.e.id===r.emailId?' (đang dùng)':''}</option>)}</select></label>
    {pick.error&&<p role="alert" className="vm-status-error">{pick.error.message}</p>}
    {chosen&&chosen.e.id!==r.emailId&&<p className="pm-muted"><PayoutDailyInfo paypal={chosen.p}/> · email cũ trả kho khi chưa nhận tiền.</p>}
    <div className="grid grid-cols-2 gap-2">
      {r.money&&<label className="pm-label text-xs">Số tiền rút ($)<input className="pm-input" inputMode="decimal" value={amount} disabled={busy} aria-invalid={!amountOk} onChange={e=>setAmount(e.target.value)}/></label>}
      <label className="pm-label text-xs">Ngày rút<input type="date" className="pm-input" value={day} disabled={busy} onChange={e=>setDay(e.target.value)}/></label></div>
    {r.money&&<label className="pm-label text-xs">Mã tham chiếu<input className="pm-input" maxLength={200} value={reference} disabled={busy} onChange={e=>setRef(e.target.value)}/></label>}
    <label className="pm-label text-xs">{needNote?'Lý do sửa (bắt buộc khi đã rút)':'Ghi chú (nếu có)'}<textarea className="pm-input" rows={2} maxLength={500} value={note} disabled={busy} onChange={e=>setNote(e.target.value)}/></label>
    {!amountOk&&<p role="alert" className="vm-status-error">Số tiền là số dương, tối đa 2 chữ số thập phân</p>}
    <div className="flex gap-2 justify-end"><button type="button" className="pm-button pm-button-quiet pm-button-sm" disabled={busy} onClick={onCancel}>Quay lại</button>
      <button type="button" className="pm-button pm-button-primary pm-button-sm" disabled={busy||!ready} onClick={()=>void onSubmit({...body,note:note.trim()||null})}>{busy?'Đang lưu…':'Lưu sửa'}</button></div>
  </div>;
}
/** The report page opens the same frame for one request: it reads the VM's current row; an old / consumed request is history only. */
export function PayoutFrameForVm({projectId,userId,vmId,requestId,onDone}:{projectId:string;userId?:string;vmId:string;requestId:string;onDone():Promise<unknown>|void}){
  const board=trpc.vmOps.board.useQuery({projectId},{retry:false});
  if(board.error)return <p role="alert" className="pm-error">{board.error.message}</p>;
  if(!board.data)return <p className="pm-muted">Đang tải…</p>;
  const row=board.data.vms.find(v=>v.vmId===vmId),rights=board.data.rights;
  if(!row||row.request?.id!==requestId||row.merge?.role==='MEMBER')return <p className="pm-muted">Yêu cầu cũ hoặc đã chốt: mở Lịch sử của VM để đối chiếu.</p>;
  return <PayoutFrame projectId={projectId} userId={userId} vmId={vmId} cycle={row.cycle} earnAppId={row.earnAppId} request={row.request} rights={{assign:rights.assign,money:rights.money,writeMoney:rights.writeMoney,payout:rights.payout,receipt:rights.receipt}} onDone={async()=>{await Promise.all([board.refetch(),onDone()]);}}/>;
}
