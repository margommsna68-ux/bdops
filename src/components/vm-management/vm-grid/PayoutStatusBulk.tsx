"use client";
import {useEffect,useRef,useState} from 'react';
import {trpc} from '@/lib/trpc';
import {formatLedger} from '@/lib/money-input';
import {receiptCheck,bangkokDay,type VmOpsRequestView} from './payout-frame-model';
import {bulkPlan,runSequential,runJournaled,readJournal,receiptBody,type BulkRow} from './payout-bulk-model';
// "Đã rút N dòng" and "Tiền đã về N dòng" (owner 28/10/2026) for the Server / VM selection and the "Rút EarnApp" report. The rows are
// captured when the frame opens; each row is one command with its own key, sent one after the other with a result per row. A row
// refused (revision changed, rights…) never stops the others; a lost answer keeps its exact command in this tab for the same retry.
export type StatusBulkKind='SEND'|'RECEIVE';
export interface StatusBulkRow extends BulkRow {label:string;ops:{cycle:number;milestone?:string|null;merge?:{role:string}|null;request:VmOpsRequestView|null}|undefined}
type Command={projectId:string;key:string}&Record<string,unknown>;
type Line={row:StatusBulkRow;req:VmOpsRequestView;entered:string;txid:string;acceptSurplus?:boolean;status:''|'done'|'unknown'|'stuck';error:string;command?:Command};
const message=(e:unknown)=>e instanceof Error?e.message:'Không nhận được phản hồi hợp lệ';
const store=()=>{try{return window.sessionStorage;}catch{return null;}};
export const statusJournalKey=(projectId:string,userId:string,kind:StatusBulkKind,requestId:string)=>'mth-payout-bulk:'+JSON.stringify([projectId,userId,kind,requestId]);
export function PayoutStatusBulk({projectId,userId,kind,rows,liveOf,onSaved,onBusy}:{projectId:string;userId?:string;kind:StatusBulkKind;rows:StatusBulkRow[];liveOf?:(vmId:string)=>StatusBulkRow['ops'];onSaved:()=>Promise<unknown>|void;onBusy?:(busy:boolean)=>void}){
  if(!userId)return <p className="pm-muted text-xs">Đang tải phiên đăng nhập…</p>;
  return <Queue key={projectId+':'+userId+':'+kind} projectId={projectId} userId={userId} kind={kind} rows={rows} liveOf={liveOf} onSaved={onSaved} onBusy={onBusy}/>;
}
function Queue({projectId,userId,kind,rows,liveOf,onSaved,onBusy}:{projectId:string;userId:string;kind:StatusBulkKind;rows:StatusBulkRow[];liveOf?:(vmId:string)=>StatusBulkRow['ops'];onSaved:()=>Promise<unknown>|void;onBusy?:(busy:boolean)=>void}){
  const update=trpc.vmOps.updatePayout.useMutation(),receipt=trpc.vmOps.payoutReceipt.useMutation();
  // The plan and the identities are taken once, at opening: a background reload may block a row, never retarget it.
  const [plan]=useState(()=>bulkPlan(rows,kind));
  const [lines,setLines]=useState<Line[]>(()=>plan.ready.map(row=>{const req=row.ops!.request!,command=readJournal<Command>(store(),statusJournalKey(projectId,userId,kind,req.id))??undefined;
    return {row,req,entered:command&&typeof command.amount==='string'?command.amount:'',txid:command&&typeof command.transactionId==='string'?command.transactionId:'',status:command?'unknown':'',error:command?'Lệnh trước chưa rõ kết quả; thử lại đúng lệnh cũ.':'',command};}));
  const [date,setDate]=useState(bangkokDay),[settle,setSettle]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const state=useRef(lines);state.current=lines;const lock=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const patch=(id:string,p:Partial<Line>)=>setLines(old=>old.map(l=>l.req.id===id?{...l,...p}:l));
  const today=bangkokDay();
  const stale=(l:Line)=>{if(!liveOf)return false;const o=liveOf(l.row.vmId),q=o?.request;return !q||q.id!==l.req.id||q.revision!==l.req.revision;};
  const check=(l:Line)=>l.req.money?receiptCheck({...l.req.money,phase:l.req.phase},l.entered):null;
  const sendable=(l:Line)=>{if(l.status||stale(l))return false;if(kind==='SEND')return true;const c=check(l);return !!c?.valid&&!!date&&(!c.surplusConfirm||!!l.acceptSurplus);};
  const ready=lines.filter(sendable),pending=lines.filter(l=>l.status==='unknown'||l.status==='stuck');
  function build(l:Line):Command|null{
    const key=crypto.randomUUID();
    if(kind==='SEND')return {projectId,key,requestId:l.req.id,expectedRevision:l.req.revision,vmId:l.row.vmId,expectedCycle:l.req.cycle,earnAppId:l.req.earnAppId,action:'SENT',note:null};
    const c=check(l),b=c&&l.req.money?receiptBody(c,{currency:l.req.money.currency,date,today,txid:l.txid,settle,acceptSurplus:!!l.acceptSurplus}):null;
    return b?{projectId,key,requestId:l.req.id,expectedRequestRevision:l.req.revision,...b}:null;
  }
  async function run(retry:boolean){
    if(lock.current)return;lock.current=true;setBusy(true);onBusy?.(true);setNotice('');let saved=0;
    try{
      const targets=state.current.filter(l=>retry?l.status==='unknown'||l.status==='stuck':sendable(l)).map(l=>l.req.id);
      await runSequential(targets,async id=>{
        const l=state.current.find(x=>x.req.id===id)!;
        const command=l.command??build(l);if(!command)return;
        const out=await runJournaled(store(),statusJournalKey(projectId,userId,kind,id),command,!!l.command,()=>kind==='SEND'?update.mutateAsync(command as never):receipt.mutateAsync(command as never));
        if(out.outcome==='DONE'){saved++;patch(id,{status:'done',error:'',command:undefined});}
        else if(out.outcome==='NOSTORE')patch(id,{error:'Không lưu được mã chống lặp trong tab; chưa gửi lệnh.'});
        else if(out.outcome==='REFUSED')patch(id,{status:'',error:message(out.error),command:undefined});
        else if(out.outcome==='STUCK')patch(id,{status:'stuck',command,error:'Thử lại bị từ chối: '+message(out.error)+'. Đối chiếu yêu cầu (Lịch sử VM / EarnApp / PayPal) trước khi bỏ lệnh cũ.'});
        else patch(id,{status:'unknown',command,error:'Chưa xác định kết quả. Thử lại đúng lệnh cũ: '+message(out.error)});
      },()=>!mounted.current);
      if(!mounted.current)return;
      setNotice('Đã lưu '+saved+' dòng. Các dòng chưa lưu vẫn giữ nội dung.');
      if(saved)try{await onSaved();}catch{setNotice('Đã lưu '+saved+' dòng; chưa tải lại được bảng. Không gửi lại dòng đã lưu.');}
    }finally{lock.current=false;if(mounted.current)setBusy(false);onBusy?.(false);}
  }
  function drop(l:Line){
    if(!window.confirm('Bỏ lệnh chưa rõ kết quả của '+l.row.label+'? Chỉ bỏ khi đã đối chiếu: lệnh cũ sẽ không được gửi lại.'))return;
    try{store()?.removeItem(statusJournalKey(projectId,userId,kind,l.req.id));}catch{/* nothing stored */}
    patch(l.req.id,{status:'',command:undefined,error:''});
  }
  const result=(l:Line)=>l.status==='done'?<span className="text-emerald-600">{kind==='SEND'?'Đã ghi "Đã rút"':'Đã ghi tiền về'}</span>
    :<>{stale(l)&&!l.status&&<span className="pm-muted">Yêu cầu vừa đổi ở nơi khác; đóng và mở lại khung.</span>}{l.error&&<span className="pm-error" role="alert">{l.error}</span>}
      {l.status==='stuck'&&<button type="button" className="pm-button pm-button-sm" disabled={busy} onClick={()=>drop(l)}>Bỏ lệnh chưa rõ (đã đối chiếu)</button>}</>;
  const label=kind==='SEND'?`Đã rút ${ready.length} dòng`:`Tiền đã về ${ready.length} dòng`;
  return <div className="space-y-3" aria-label={kind==='SEND'?'Danh sách Đã rút':'Danh sách Tiền đã về'}>
    {kind==='SEND'?<p className="text-xs pm-muted">Rút trên EarnApp xong thì bấm “{label}”: mỗi yêu cầu đang rút được ghi “Đã rút” (một lệnh riêng mỗi dòng).</p>
    :<><p className="text-xs pm-muted">Nhập đúng số tiền thấy trong PayPal cho từng dòng (dòng để trống không ghi); phí = số rút − số thực nhận; số lớn hơn vẫn ghi đúng (hiện “Dư”).</p>
      <div className="flex gap-3 items-end flex-wrap"><label className="pm-label text-xs">Ngày tiền về<input type="date" className="pm-input" value={date} max={today} disabled={busy||pending.length>0} onChange={e=>setDate(e.target.value)}/></label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={settle} disabled={busy||pending.length>0} onChange={e=>setSettle(e.target.checked)}/>Chốt luôn, phần thiếu là phí</label></div></>}
    {lines.length>0&&<div className="overflow-x-auto"><table className="vm-bulk-table text-xs w-full"><thead><tr><th className="text-left">VM</th><th className="text-left">PayPal nhận</th><th className="text-right">Đã rút</th>
      {kind==='RECEIVE'&&<><th className="text-left">Số tiền chính xác trong PayPal</th><th className="text-right">Phí</th><th className="text-left">Mã giao dịch</th></>}<th className="text-left">Kết quả</th></tr></thead>
      <tbody>{lines.map(l=>{const m=l.req.money,c=kind==='RECEIVE'?check(l):null,locked=busy||!!l.status||stale(l);return <tr key={l.req.id} aria-label={l.row.label}>
        <td><strong>{l.row.label}</strong></td><td>{l.req.paypal} · <span className="break-all">{l.req.email}</span></td><td className="text-right">{m?formatLedger(m.amount,m.currency):'—'}</td>
        {kind==='RECEIVE'&&<><td><input className="pm-input" inputMode="decimal" required aria-required aria-label={'Số tiền chính xác trong PayPal '+l.row.label} aria-invalid={!!c?.error} value={l.entered} disabled={locked} onChange={e=>patch(l.req.id,{entered:e.target.value,error:'',acceptSurplus:false})}/>{c?.error&&<span className="pm-error block">{c.error}</span>}
            {c?.surplusConfirm&&c.surplus&&m&&<label className="flex items-center gap-1 mt-1"><input type="checkbox" aria-label={'Xác nhận nhận dư '+formatLedger(c.surplus,m.currency)+' (lớn hơn mức thường) '+l.row.label} checked={!!l.acceptSurplus} disabled={locked} onChange={e=>patch(l.req.id,{acceptSurplus:e.target.checked})}/>{'Xác nhận nhận dư '+formatLedger(c.surplus,m.currency)+' (lớn hơn mức thường)'}</label>}</td>
          <td className="text-right" aria-label={'Phí '+l.row.label}>{c?.fee!==null&&c?.fee!==undefined&&m?formatLedger(c.fee,m.currency):c?.surplus&&m?'Dư '+formatLedger(c.surplus,m.currency):'—'}</td>
          <td><input className="pm-input" maxLength={100} aria-label={'Mã giao dịch '+l.row.label} value={l.txid} disabled={locked} onChange={e=>patch(l.req.id,{txid:e.target.value})}/></td></>}
        <td className="space-y-1">{result(l)}</td></tr>;})}</tbody></table></div>}
    {plan.skipped.length>0&&<div className="text-xs"><p className="font-semibold">Bỏ qua {plan.skipped.length} dòng</p><ul className="space-y-1">{plan.skipped.map(s=><li key={s.row.vmId}><strong>{(s.row as StatusBulkRow).label}</strong> — {s.why}</li>)}</ul></div>}
    {notice&&<p className="text-xs" role="status">{notice}</p>}
    {pending.length>0&&<button type="button" className="pm-button" disabled={busy} onClick={()=>void run(true)}>Thử lại lệnh chưa rõ</button>}
    <button type="button" className="pm-button pm-button-primary" disabled={busy||!ready.length} onClick={()=>void run(false)}>{busy?'Đang lưu…':label}</button>
  </div>;
}
