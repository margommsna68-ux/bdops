"use client";
import React,{useState} from 'react';
import toast from 'react-hot-toast';
import {trpc} from '@/lib/trpc';
import {balanceState,WITHDRAWABLE_LABEL,MILESTONE_LABEL,type Withdrawable} from '@/lib/vm-ops';
import {formatLedger,parseMoneyNumber} from '@/lib/money-input';
import type {OpsRow} from './OpsCells';
// "Tiền / Rút" at the VM (owner brief 20/10/2026): the EarnApp balance read on the account (with when it was read) and, separately,
// the payout request against the PayPal book. Both are shown when both exist; the balance is never reduced by the waiting money.
// Tones reuse the money chips (all four themes): green = có thể rút / đã về, amber = chờ, red = cần xử lý, grey = chưa có.
const TZ='Asia/Ho_Chi_Minh';
export function when(iso:string){const d=new Date(iso),t=d.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',timeZone:TZ}),day=d.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',timeZone:TZ}),today=new Date().toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',timeZone:TZ});return day===today?t:day+' '+t;}
const money=(a:string|null|undefined,c:string)=>a==null?'':formatLedger(a,c);
// lead: a recorded balance shown as a readable amount on its own (larger than the status chip), then the chip and the second line.
export type MoneyLine={lead?:string;text:string;sub:string;tone:''|'recreate'|'waiting'|'failed'|'money_review'};
export function balanceLine(ops:OpsRow|undefined,read:boolean):MoneyLine|null{
  if(!ops?.earnAppId)return null;
  const b=balanceState(ops.balance);
  if(b.kind==='UNCHECKED')return {text:'Chưa kiểm tra',sub:'',tone:''};
  if(b.kind==='FAILED')return {text:'Kiểm tra lỗi '+when(b.at),sub:b.last?(read&&b.last.amount!=null?'gần nhất '+money(b.last.amount,b.last.currency)+' · ':'có số trước · ')+when(b.last.checkedAt):'chưa có số',tone:'failed'};
  const cond=WITHDRAWABLE_LABEL[b.withdrawable],tone=b.withdrawable==='YES'&&!b.stale?'recreate' as const:b.stale?'waiting' as const:'';
  // Unknown condition: the amount alone on the first line, the missing condition said on the second (fits the column).
  const time='Kiểm tra '+when(b.at)+(b.stale?' · số cũ, kiểm tra lại':''),unknown=b.withdrawable==='UNKNOWN',sub=unknown?cond+' · '+time:time;
  if(read&&b.amount!=null)return {lead:money(b.amount,b.currency),text:unknown?'':cond,sub,tone};
  return {text:unknown?'Đã kiểm tra':'Đã kiểm tra · '+cond,sub,tone};
}
// Merged payout (27/10/2026): a member VM shows the request it was merged into; the primary says how many VMs are in it.
export function requestLine(ops:OpsRow|undefined):MoneyLine|null{
  const line=baseLine(ops),g=ops?.merge;if(!line||!g)return line;
  return g.role==='MEMBER'?{...line,sub:'Đã gộp vào '+g.primaryWhere+(line.sub?' · '+line.sub:'')}:{...line,text:line.text+' · gộp '+(g.members.length+1)+' VM'};
}
function baseLine(ops:OpsRow|undefined):MoneyLine|null{
  const r=ops?.request;if(!r)return null;const m=r.money,who=r.paypal+' · '+r.email;
  if(ops!.milestone==='PREPARING')return {text:MILESTONE_LABEL.PREPARING+(m?' '+money(m.amount,m.currency):''),sub:who+' · chưa gửi trên EarnApp',tone:'waiting'};
  if(ops!.milestone==='UNKNOWN')return {text:'Chưa xác định kết quả rút',sub:'Đối chiếu lịch sử EarnApp trước khi làm tiếp',tone:'failed'};
  if(!m)return {text:ops!.milestone?MILESTONE_LABEL[ops!.milestone as keyof typeof MILESTONE_LABEL]:'Đã yêu cầu',sub:r.paypal,tone:ops!.milestone==='WAITING'?'waiting':ops!.milestone==='RECREATE'?'recreate':ops!.milestone?'failed':''};
  if(r.phase==='WAITING')return m.received!=='0.00'?{text:'Đã về '+money(m.received,m.currency)+' · còn chờ '+money(m.remaining,m.currency),sub:who,tone:'waiting'}:{text:'Chờ về PP '+money(m.amount,m.currency),sub:who,tone:'waiting'};
  // Closed = received in full or settled short with a stated gap: the label is the money really received (review fix 20/10/2026).
  if(r.phase==='RECEIVED'){const gap=m.shortfall&&m.shortfall!=='0.00'?'Đã chốt thiếu '+money(m.shortfall,m.currency):'';return {text:'Đã về PP '+money(m.received,m.currency),sub:[gap,ops!.milestone==='RECREATE'?'Chờ tạo lại':gap?'':who].filter(Boolean).join(' · '),tone:'recreate'};}
  // Lost to SUS (28/10/2026): never waiting, never received; shown as its own line with what was lost (money rights only).
  if(r.phase==='LOST')return {text:'Mất do SUS'+(m.lost?' '+money(m.lost,m.currency):''),sub:who,tone:'failed'};
  if(r.phase==='REVIEW')return {text:'Cần đối chiếu tiền',sub:who,tone:'money_review'};
  return {text:r.phase==='FAILED'?'Rút thất bại':'Đã huỷ yêu cầu rút',sub:who,tone:'failed'};
}
export function LineView({line}:{line:MoneyLine}){
  const chip=line.text&&<span className={'vm-money'+(line.tone?' vm-money-'+line.tone:'')}>{line.text}</span>;
  return <>{line.lead?<span className="vm-money-head"><span className="vm-money-amount">{line.lead}</span>{chip}</span>:chip}{line.sub&&<span className="vm-money-line text-xs vm-ellipsis">{line.sub}</span>}</>;
}
// Balance part of the frame: what was read last, the observed condition, a quick new check (Enter or Lưu), and the history.
const nowLocal=()=>{const d=new Date(Date.now()-new Date().getTimezoneOffset()*60e3);return d.toISOString().slice(0,16);};
export function BalanceSection({projectId,vmCode,ops,read,write,onSaved}:{projectId:string;vmCode:string;ops:OpsRow;read:boolean;write:boolean;onSaved:()=>Promise<unknown>|void}){
  const save=trpc.vmOps.balanceRecord.useMutation(),history=trpc.vmOps.balanceHistory.useQuery({projectId,vmId:ops.vmId},{retry:false});
  const [amount,setAmount]=useState(''),[currency,setCurrency]=useState('USD'),[w,setW]=useState<Withdrawable>('UNKNOWN'),[cond,setCond]=useState(''),[at,setAt]=useState(nowLocal),[failed,setFailed]=useState(false),[reason,setReason]=useState(''),[evidence,setEvidence]=useState(''),[error,setError]=useState('');
  const [key,setKey]=useState<{sig:string;key:string}|null>(null);
  // A draft belongs to the project, VM, round and EarnApp seen when typing started (review fix 20/10/2026). If a reload shows another
  // round or account, the draft is kept, Lưu is locked and the old figure is never sent for the new account; a new check for the
  // new account starts only with "Ghi lần mới" (empty form).
  const [bound,setBound]=useState<{projectId:string;vmId:string;cycle:number;earnAppId:string}|null>(null);
  const touch=()=>{if(!bound&&ops.earnAppId)setBound({projectId,vmId:ops.vmId,cycle:ops.cycle,earnAppId:ops.earnAppId});};
  const moved=!!bound&&(bound.projectId!==projectId||bound.vmId!==ops.vmId||bound.cycle!==ops.cycle||bound.earnAppId!==ops.earnAppId);
  const reset=()=>{setAmount('');setCond('');setReason('');setEvidence('');setFailed(false);setW('UNKNOWN');setAt(nowLocal());setKey(null);setBound(null);setError('');};
  const parsed=amount.trim()?parseMoneyNumber(amount,{fraction:2}):{value:null,error:null},amountOk=!failed&&!!parsed.value&&!parsed.error,dirty=failed?!!reason.trim():amountOk;
  const b=balanceState(ops.balance);
  async function submit(){
    if(!dirty||save.isLoading||!bound||moved)return;setError('');
    const item={vmId:bound.vmId,expectedCycle:bound.cycle,earnAppId:bound.earnAppId,checkedAt:new Date(at).toISOString(),outcome:failed?'FAILED' as const:'OK' as const,amount:failed?null:parsed.value,currency,withdrawable:failed?null:w,condition:cond.trim()||null,failure:failed?reason.trim():null,evidence:evidence.trim()||null};
    // One request = one key (a retry after a lost answer replays); a new check is a new key even with the same amount.
    const sig=JSON.stringify(item),k=key?.sig===sig?key.key:crypto.randomUUID();setKey({sig,key:k});
    try{const r=await save.mutateAsync({projectId:bound.projectId,key:k,source:'CELL',items:[item]});const row=r.rows[0];
      if(row?.outcome==='ERROR'){setError(row.message);return;}
      toast.success(vmCode+': '+(row?.message||'Đã ghi'));reset();await onSaved();void history.refetch();}
    catch(e){setError(e instanceof Error?e.message:'Chưa lưu được');}
  }
  const keys=(e:React.KeyboardEvent)=>{if(e.nativeEvent.isComposing)return;if(e.key==='Enter'){e.preventDefault();void submit();}};
  return <div className="vm-balance space-y-2 text-xs" data-vm-id={ops.vmId} data-cycle={ops.cycle} data-earnapp-id={ops.earnAppId??undefined}>
    <p className="font-semibold">Số dư EarnApp</p>
    {b.kind==='UNCHECKED'?<p className="pm-muted">Chưa kiểm tra tài khoản EarnApp ở lượt {ops.cycle}.</p>
      :b.kind==='FAILED'?<p className="text-red-600">Kiểm tra lỗi {when(b.at)}{b.failure?': '+b.failure:b.hidden?' (lý do ẩn theo quyền)':''}. {b.last?'Số gần nhất '+(read&&b.last.amount!=null?formatLedger(b.last.amount,b.last.currency):'(ẩn)')+' lúc '+when(b.last.checkedAt)+'.':'Chưa có số nào.'}</p>
      :<p><strong>{read&&b.amount!=null?formatLedger(b.amount,b.currency):'(ẩn theo quyền)'}</strong> · {WITHDRAWABLE_LABEL[b.withdrawable]} · kiểm tra {when(b.at)}{b.stale?' · số cũ, nên kiểm tra lại':''}{b.condition?<><br/><span className="pm-muted">Điều kiện quan sát: {b.condition}</span></>:null}</p>}
    {write&&ops.earnAppId&&<div className="vm-balance-form space-y-1" data-sdk-edit>
      <div className="flex gap-1 items-center flex-wrap" role="radiogroup" aria-label="Kết quả kiểm tra"><button type="button" role="radio" aria-checked={!failed} className={'pm-button pm-button-sm'+(!failed?' pm-button-primary':'')} onClick={()=>{touch();setFailed(false);}}>Đọc được số dư</button><button type="button" role="radio" aria-checked={failed} className={'pm-button pm-button-sm'+(failed?' pm-button-primary':'')} onClick={()=>{touch();setFailed(true);}}>Kiểm tra thất bại</button></div>
      {!failed?<div className="grid grid-cols-3 gap-1">
        <label className="pm-label text-xs col-span-2">Số dư<input className="pm-input" inputMode="decimal" aria-label={'Số dư EarnApp '+vmCode} placeholder="ví dụ 10.50 (0 là hợp lệ)" value={amount} onChange={e=>{touch();setAmount(e.target.value);setError('');}} onKeyDown={keys} aria-invalid={!!parsed.error}/></label>
        <label className="pm-label text-xs">Đồng tiền<input className="pm-input" value={currency} maxLength={5} onChange={e=>{touch();setCurrency(e.target.value.toUpperCase());}} onKeyDown={keys}/></label>
        <label className="pm-label text-xs col-span-3">Điều kiện rút trên EarnApp<select className="pm-input" aria-label="Điều kiện rút" value={w} onChange={e=>{touch();setW(e.target.value as Withdrawable);}}><option value="UNKNOWN">Chưa kiểm tra điều kiện rút</option><option value="YES">Có thể rút (EarnApp cho rút)</option><option value="NO">Chưa đủ điều kiện rút</option></select></label>
        <label className="pm-label text-xs col-span-3">Điều kiện quan sát (nếu có)<input className="pm-input" maxLength={300} value={cond} onChange={e=>{touch();setCond(e.target.value);}} onKeyDown={keys}/></label></div>
        :<label className="pm-label text-xs">Lý do thất bại (giữ số gần nhất, không ghi 0)<input className="pm-input" aria-label="Lý do kiểm tra thất bại" maxLength={300} value={reason} onChange={e=>{touch();setReason(e.target.value);}} onKeyDown={keys}/></label>}
      <div className="grid grid-cols-2 gap-1"><label className="pm-label text-xs">Thời điểm kiểm tra<input type="datetime-local" className="pm-input" value={at} onChange={e=>{touch();setAt(e.target.value);}}/></label><label className="pm-label text-xs">Căn cứ (tên ảnh / ghi chú, không ghi mật khẩu)<input className="pm-input" maxLength={300} value={evidence} onChange={e=>{touch();setEvidence(e.target.value);}}/></label></div>
      {moved&&<p className="vm-status-error" role="alert">VM đã đổi tài khoản EarnApp hoặc sang lượt mới từ khi bắt đầu nhập; nháp giữ cho tài khoản cũ, không lưu. Kiểm tra lại thực tế rồi bấm “Ghi lần mới”.</p>}
      {parsed.error&&<p className="vm-status-error" role="alert">{parsed.error}</p>}{error&&<p className="vm-status-error" role="alert">{error}</p>}
      <div className="flex justify-end gap-1">{moved&&<button type="button" className="pm-button pm-button-sm" onClick={reset}>Ghi lần mới</button>}<button type="button" className={'pm-button pm-button-sm'+(dirty&&!moved?' pm-button-primary':'')} disabled={!dirty||save.isLoading||moved} onClick={()=>void submit()}>{save.isLoading?'Đang lưu…':'Lưu kiểm tra'}</button></div>
    </div>}
    {!write&&<p className="pm-muted">Ghi số dư cần quyền ghi Server / VM (quản lý) hoặc quyền “Ghi kiểm tra tiền EarnApp”.</p>}
    {history.data&&history.data.rows.length>0&&<details><summary className="cursor-pointer">Lịch sử kiểm tra ({history.data.rows.length})</summary><ul className="vm-balance-history">{history.data.rows.slice(0,20).map(h=><li key={h.id}><span>{when(h.checkedAt)}</span> · <span>{h.outcome==='OK'?(h.amount!=null?formatLedger(h.amount,h.currency):'(ẩn)')+' · '+WITHDRAWABLE_LABEL[h.withdrawable]:'Lỗi'+(h.failure?': '+h.failure:h.noteHidden?' (lý do ẩn theo quyền)':'')}</span> · <span className="pm-muted">lượt {h.cycle} · {h.by} · {({CELL:'tại ô',PASTE:'dán bảng',AI:'AI',OTHER:'khác'} as Record<string,string>)[h.source]||h.source}</span></li>)}</ul></details>}
  </div>;
}
