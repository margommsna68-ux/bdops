"use client";
import {useEffect,useRef,useState} from 'react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {formatUsd,formatLedger} from '@/lib/money-input';
import type {ManagedVM} from '../shared';
import {PayoutDailyInfo,payoutEmailAllowed,type PickPaypal,type OpsRow,type OpsRights} from './OpsCells';

type Pick=Omit<inferRouterOutputs<AppRouter>['vmOps']['payoutPick'],'paypals'>&{paypals:PickPaypal[]};
type Action='REQUEST'|'SENT'|'RECEIPT';
type Command={action:Action;vmId:string;body:Record<string,unknown>;snapshot:{cycle:number;earnAppId:string|null;request:OpsRow['request']}};
type Row={vm:ManagedVM;cycle:number;earnAppId:string|null;request:OpsRow['request'];amount:string;actual:string;email:string;txid:string;pick?:Pick;error:string;loading:boolean;done:boolean;unknown:boolean;command?:Command};
const day=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const money=(s:string)=>/^\d+([.,]\d{1,2})?$/.test(s.trim())&&Number(s.replace(',','.'))>0;
const canonical=(s:string)=>s.trim().replace(',','.');
const label=(r:Row)=>r.vm.server+' / '+r.vm.code;
const journalKey=(project:string,user:string,id:string,mode:Action)=>'mth-payout-selection:'+JSON.stringify([project,user,id,mode]);
function readCommand(key:string):Command|undefined{try{const s=window.sessionStorage.getItem(key);return s?JSON.parse(s):undefined;}catch{return undefined;}}
function refused(e:unknown){const code=(e as {data?:{code?:string}})?.data?.code;return !!code&&['BAD_REQUEST','UNAUTHORIZED','FORBIDDEN','NOT_FOUND','CONFLICT','PRECONDITION_FAILED','TOO_MANY_REQUESTS','UNPROCESSABLE_CONTENT'].includes(code);}
function message(e:unknown){return e instanceof Error?e.message:'Không nhận được phản hồi hợp lệ';}

/** Selected identities are captured once. Live reloads may block new writes, never retarget a draft. */
export function PayoutBulkPanel({projectId,userId,vms,opsOf,rights,onSaved,onAssign,onBusy}:{projectId:string;userId:string;vms:ManagedVM[];opsOf:(id:string)=>OpsRow|undefined;rights:OpsRights;onSaved:()=>Promise<unknown>|void;onAssign?:()=>void;onBusy:(busy:boolean)=>void}){
 const [mode,setMode]=useState<Action>(rights.writeMoney||rights.payout?'REQUEST':'RECEIPT');
 const [visited,setVisited]=useState<Action[]>([rights.writeMoney||rights.payout?'REQUEST':'RECEIPT']);
 const changeMode=(next:Action)=>{setVisited(old=>old.includes(next)?old:[...old,next]);setMode(next);};
 const [saving,setSaving]=useState(false);
 const [version,setVersion]=useState(0);
 const changedBusy=(value:boolean)=>{setSaving(value);onBusy(value);};
 // Keep visited queues mounted so changing tabs cannot discard a draft or an uncertain command.
 return <div className="space-y-3"><div className="flex gap-2 flex-wrap" role="tablist" aria-label="Rút tiền các VM đã chọn">
  {(rights.writeMoney||rights.payout)&&<button type="button" role="tab" disabled={saving} aria-selected={mode==='REQUEST'} className={'pm-button'+(mode==='REQUEST'?' pm-button-primary':'')} onClick={()=>changeMode('REQUEST')}>Yêu cầu rút</button>}
  {(rights.writeMoney||rights.payout)&&<button type="button" role="tab" disabled={saving} aria-selected={mode==='SENT'} className={'pm-button'+(mode==='SENT'?' pm-button-primary':'')} onClick={()=>changeMode('SENT')}>Xác nhận đã gửi</button>}
  {(rights.writeMoney||rights.receipt)&&<button type="button" role="tab" disabled={saving} aria-selected={mode==='RECEIPT'} className={'pm-button'+(mode==='RECEIPT'?' pm-button-primary':'')} onClick={()=>changeMode('RECEIPT')}>Ghi tiền về PP</button>}
 </div><p className="text-xs pm-muted">Ghi nhận trên web. Việc rút thật thực hiện trên EarnApp; chỉ ghi tiền về khi đã thấy PayPal nhận tiền.</p>
 <button type="button" className="pm-button pm-button-quiet" disabled={saving} onClick={()=>setVersion(v=>v+1)}>Nạp yêu cầu mới / bỏ nháp chưa gửi</button>
 {visited.map(action=><div key={action+version} hidden={mode!==action}>{(action!=='RECEIPT'?(rights.writeMoney||rights.payout):(rights.writeMoney||rights.receipt))&&<PayoutQueue projectId={projectId} userId={userId} action={action} active={mode===action} vms={vms} opsOf={opsOf} rights={rights} onSaved={onSaved} onAssign={onAssign} onBusy={changedBusy}/>}</div>)}
 </div>;
}
function PayoutQueue({projectId,userId,action,active,vms,opsOf,rights,onSaved,onAssign,onBusy}:{projectId:string;userId:string;action:Action;active:boolean;vms:ManagedVM[];opsOf:(id:string)=>OpsRow|undefined;rights:OpsRights;onSaved:()=>Promise<unknown>|void;onAssign?:()=>void;onBusy:(busy:boolean)=>void}){
 const utils=trpc.useContext(),create=trpc.vmOps.requestPayout.useMutation(),receipt=trpc.vmOps.payoutReceipt.useMutation(),update=trpc.vmOps.updatePayout.useMutation();
 const [date,setDate]=useState(day),[sent,setSent]=useState(false),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [rows,setRows]=useState<Row[]>(()=>vms.map(vm=>{const o=opsOf(vm.id),command=readCommand(journalKey(projectId,userId,vm.id,action));
  const valid=command?.action===action&&command.vmId===vm.id&&command.body.projectId===projectId&&!!command.snapshot;
  return {vm,cycle:valid?command.snapshot.cycle:o?.cycle??1,earnAppId:valid?command.snapshot.earnAppId:o?.earnAppId??null,request:valid?command.snapshot.request:o?.request??null,amount:valid&&action==='REQUEST'?String(command.body.amount):'',actual:valid&&action==='RECEIPT'?String(command.body.amount):'',email:valid&&action==='REQUEST'?String(command.body.paypalEmailId):'',txid:valid&&action==='RECEIPT'?String(command.body.transactionId||''):'',loading:action==='REQUEST'&&!!o?.earnAppId&&!o.request&&!valid,error:'',done:false,unknown:!!valid,command:valid?command:undefined};}));
 const state=useRef(rows);state.current=rows;const running=useRef(false);const latest=useRef({opsOf,vms});latest.current={opsOf,vms};
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const patch=(id:string,p:Partial<Row>)=>setRows(old=>old.map(r=>r.vm.id===id?{...r,...p}:r));
 useEffect(()=>{if(action!=='REQUEST')return;let mounted=true;const pending=rows.filter(r=>r.loading);void(async()=>{for(const r of pending){try{const pick=await utils.vmOps.payoutPick.fetch({projectId,vmId:r.vm.id});if(mounted){const own=pick.paypals.flatMap(p=>p.emails).find(e=>e.own);patch(r.vm.id,{pick,email:own?.id||'',loading:false});}}catch(e){if(mounted)patch(r.vm.id,{error:message(e),loading:false});}}})();return()=>{mounted=false;};
 // The queue is tied to the identities at opening, not query/background refreshes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 const stale=(r:Row)=>{const o=latest.current.opsOf(r.vm.id),vm=latest.current.vms.find(v=>v.id===r.vm.id);return !vm||!o||o.cycle!==r.cycle||o.earnAppId!==r.earnAppId||(action==='REQUEST'?vm.revision!==r.vm.revision||(!r.request&&!!o.request):!o.request||o.request.id!==r.request?.id||o.request.revision!==r.request?.revision);};
 const reason=(r:Row)=>{if(r.done||r.unknown)return '';if(!r.earnAppId)return 'Chưa gán tài khoản EarnApp';if(stale(r))return 'VM đã đổi lượt hoặc tài khoản / phiên bản. Đóng khung và kiểm tra lại.';
  if(action==='REQUEST'){if(r.request)return 'Đã có yêu cầu rút; theo dõi tại ô tiền của VM, không tạo thêm.';if(r.loading)return 'Đang tải email PayPal…';if(!r.pick)return r.error||'Chưa tải được danh sách PayPal';if(r.pick.earnApp?.id!==r.earnAppId)return 'VM đã đổi lượt hoặc tài khoản';}
  else{if(!r.request)return 'Chưa có yêu cầu rút';if(action==='SENT'){if(r.request.state!=='REQUESTED')return 'Yêu cầu đã huỷ / thất bại; xử lý trên yêu cầu cũ';if(r.request.submission==='SENT')return 'Đã xác nhận gửi trên EarnApp';return '';}
   if(r.request.state!=='REQUESTED'||r.request.submission!=='SENT')return 'Cần xác nhận đã gửi trên EarnApp trước';if(r.request.phase!=='WAITING')return 'Yêu cầu không còn tiền chờ nhận';if(!r.request.money)return 'Cần quyền xem số tiền của yêu cầu';}return '';};
 const quotaKey=(p:PickPaypal)=>JSON.stringify([p.id,p.daily?.date??'']);
 const hasCommand=(r:Row)=>r.done||r.unknown||!!r.command;
 // Recheck live eligibility on every render, including refreshes with unchanged drafts.
 // A command already sent/in flight may occupy a slot even when its VM is now stale.
 // Build the index once per render, not once per option across every VM's picker.
 const preview=(()=>{
  const occupying=new Set(rows.filter(r=>hasCommand(r)||!stale(r)).map(r=>r.vm.id));
  const byRow=new Map<string,Map<string,{paypal:PickPaypal;email:PickPaypal['emails'][number]}>>();
  const own=new Map<string,string>(),owners=new Map<string,Set<string>>(),selected=new Map<string,Set<string>>(),remaining=new Map<string,number>();
  for(const r of rows){
   const choices=new Map<string,{paypal:PickPaypal;email:PickPaypal['emails'][number]}>();
   for(const p of r.pick?.paypals??[]){
    const key=quotaKey(p);remaining.set(key,Math.min(remaining.get(key)??Infinity,p.daily?.remaining??2));
    for(const e of p.emails){choices.set(e.id,{paypal:p,email:e});if(e.own)own.set(r.vm.id,e.id);}
   }
   byRow.set(r.vm.id,choices);if(r.pick?.earnApp?.emailId)own.set(r.vm.id,r.pick.earnApp.emailId);
   if(r.email&&occupying.has(r.vm.id)){const ids=owners.get(r.email)??new Set<string>();ids.add(r.vm.id);owners.set(r.email,ids);}
  }
  // Fixed own emails may prefill more rows than today's capacity. Admit in row order,
  // retaining the remaining drafts; completed/sending/uncertain rows have first claim.
  for(const r of [...rows].sort((a,b)=>Number(hasCommand(b))-Number(hasCommand(a)))){
   if(!occupying.has(r.vm.id))continue;
   const choice=byRow.get(r.vm.id)?.get(r.email);
   // Completed and uncertain commands keep occupying local capacity: their picker
   // snapshot predates the write. Server-occupied emails are already in daily counts.
   if(choice&&choice.paypal.usable&&payoutEmailAllowed(choice.paypal,choice.email)&&choice.email.dailyOccupied!==true){
    const emails=selected.get(choice.paypal.id)??new Set<string>();
    if(emails.size<(remaining.get(quotaKey(choice.paypal))??2))emails.add(r.email);
    selected.set(choice.paypal.id,emails);
   }
  }
  return {byRow,own,owners,selected,remaining};
 })();
 const ownEmail=(r:Row)=>preview.own.get(r.vm.id);
 const selectionReason=(r:Row,id:string)=>{
  if(!id)return '';
  const choice=preview.byRow.get(r.vm.id)?.get(id),p=choice?.paypal,e=choice?.email;
  if(!p||!e)return 'Email đã chọn không còn trong danh sách; nháp vẫn giữ nguyên.';
  if(ownEmail(r)&&id!==ownEmail(r))return 'Email đã gắn với EarnApp này được giữ cố định.';
  if(!payoutEmailAllowed(p,e))return 'PayPal đã hết lượt email hôm nay; nháp vẫn giữ nguyên.';
  if(!p.usable)return 'PayPal không dùng được; nháp vẫn giữ nguyên.';
  const owners=preview.owners.get(id);
  if(owners&&(owners.size>1||!owners.has(r.vm.id)))return 'Email đã chọn cho VM khác.';
  if(e.dailyOccupied===true)return '';
  const selected=preview.selected.get(p.id);
  const otherCount=(selected?.size??0)-(selected?.has(r.email)&&preview.owners.get(r.email)?.size===1?1:0);
  // Fetches are sequential: another operator can reserve a slot between two rows.
  // Use the tightest same-day snapshot so an earlier row cannot spend stale capacity.
  const remaining=preview.remaining.get(quotaKey(p))??2;
  if(otherCount>=remaining)return ownEmail(r)?'Các dòng trước đã đủ lượt email của PayPal hôm nay. Email cố định và số tiền nháp vẫn giữ nguyên; chưa lưu dòng này.':'Các email đã chọn trong đợt này đã đủ lượt của PayPal hôm nay. Bỏ chọn một email để chọn email khác; số tiền nháp vẫn giữ nguyên.';
  return '';
 };
 const valid=(r:Row)=>!r.done&&!r.unknown&&!reason(r)&&(action==='SENT'||money(action==='REQUEST'?r.amount:r.actual))&&(action!=='REQUEST'||!!r.email&&!selectionReason(r,r.email))&&(action!=='RECEIPT'||Number(canonical(r.actual))<=Number(r.request!.money!.remaining));
 const ready=rows.filter(valid),unknown=rows.filter(r=>r.unknown);
 async function send(retry=false){if(running.current)return;running.current=true;setBusy(true);onBusy(true);setNotice('');let saved=0;
  try{const targets=state.current.filter(r=>retry?r.unknown:valid(r));for(const initial of targets){if(!mounted.current)break;const r=state.current.find(x=>x.vm.id===initial.vm.id)!;if(!retry&&(!valid(r)||(sent||action==='SENT')&&!confirmed))continue;
   const storage=journalKey(projectId,userId,r.vm.id,action);const command=r.command??{action,vmId:r.vm.id,snapshot:{cycle:r.cycle,earnAppId:r.earnAppId,request:r.request},body:action==='REQUEST'?{projectId,key:crypto.randomUUID(),vmId:r.vm.id,expectedCycle:r.cycle,expectedVmRevision:r.vm.revision,earnAppId:r.earnAppId,paypalEmailId:r.email,amount:canonical(r.amount),currency:'USD',date,submission:sent&&rights.writeMoney?'SENT':'PREPARING'}:action==='SENT'?{projectId,key:crypto.randomUUID(),requestId:r.request!.id,expectedRevision:r.request!.revision,vmId:r.vm.id,expectedCycle:r.cycle,earnAppId:r.earnAppId,action:'SENT'}:{projectId,key:crypto.randomUUID(),requestId:r.request!.id,expectedRequestRevision:r.request!.revision,amount:canonical(r.actual),currency:r.request!.money!.currency,receivedAt:date+'T00:00:00+07:00',transactionId:r.txid.trim()||null}};
   try{window.sessionStorage.setItem(storage,JSON.stringify(command));}catch{patch(r.vm.id,{error:'Không lưu được mã chống lặp trong tab; chưa gửi lệnh.'});continue;}
   patch(r.vm.id,{command,error:''});
   try{if(action==='REQUEST')await create.mutateAsync(command.body as Parameters<typeof create.mutateAsync>[0]);else if(action==='SENT')await update.mutateAsync(command.body as Parameters<typeof update.mutateAsync>[0]);else await receipt.mutateAsync(command.body as Parameters<typeof receipt.mutateAsync>[0]);
    patch(r.vm.id,{done:true,unknown:false,error:'',command:undefined});saved++;try{window.sessionStorage.removeItem(storage);}catch{/* A retained original key is safe to replay. */}
   }catch(e){const uncertain=r.unknown||!refused(e);patch(r.vm.id,{unknown:uncertain,error:uncertain?'Chưa xác định kết quả. Thử lại đúng lệnh cũ: '+message(e):message(e),command:uncertain?command:undefined});if(!uncertain)try{window.sessionStorage.removeItem(storage);}catch{/* Retained key remains safe. */}}
  }setNotice('Đã lưu '+saved+' VM. Các dòng chưa lưu vẫn giữ nội dung.');if(saved)try{await onSaved();}catch{setNotice('Đã lưu '+saved+' VM; chưa tải lại được bảng. Không gửi lại dòng đã lưu.');}
  }finally{running.current=false;setBusy(false);onBusy(false);}
 }
 const change=(r:Row,p:Partial<Row>)=>patch(r.vm.id,{...p,error:''});
 return <div className="space-y-3" aria-label={action==='REQUEST'?'Danh sách yêu cầu rút':action==='SENT'?'Danh sách xác nhận gửi':'Danh sách tiền thực nhận'}>
  {action!=='SENT'&&<label className="pm-label text-xs">{action==='REQUEST'?'Ngày yêu cầu':'Ngày tiền thực về PP'}<input type="date" className="pm-input" value={date} disabled={busy||unknown.length>0} onChange={e=>setDate(e.target.value)}/></label>}
  {action==='SENT'&&<label className="text-xs flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Tôi đã thấy yêu cầu rút trong lịch sử EarnApp của từng VM đang xác nhận</label>}
  {action==='REQUEST'&&rights.writeMoney&&<><label className="text-xs flex gap-2"><input type="checkbox" checked={sent} disabled={busy||unknown.length>0} onChange={e=>{setSent(e.target.checked);setConfirmed(false);}}/>Ghi yêu cầu đã gửi trên EarnApp</label>{sent&&<label className="text-xs flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>Tôi đã kiểm tra lịch sử EarnApp của từng VM đang ghi</label>}</>}
  {action==='REQUEST'&&!sent&&<p className="text-xs pm-muted">Mặc định chỉ chuẩn bị, giữ email riêng cho từng EarnApp; chưa đánh dấu đã dùng.</p>}
  {action==='REQUEST'&&<p className="text-xs pm-muted">Mỗi PP tối đa 2 email khác nhau mỗi ngày theo giờ Việt Nam (00:00–24:00). Chuẩn bị và chưa rõ kết quả vẫn giữ lượt. Bản nháp tính thêm các email đã chọn trong đợt này; đổi ngày yêu cầu không tăng hạn mức. Máy chủ kiểm tra lại từng dòng khi lưu.</p>}
  <p className="text-xs pm-muted">Đang xử lý {rows.length} VM đã chọn lúc mở khung. Đổi lựa chọn: đóng và mở lại khung.</p>
  {rows.map(r=>{const why=reason(r),locked=busy||r.done||r.unknown||!!why,selectionError=action==='REQUEST'?selectionReason(r,r.email):'',selectedPaypal=r.pick?.paypals.find(p=>p.emails.some(e=>e.id===r.email));return <section key={r.vm.id} className="vm-payout-bulk-row space-y-2" aria-label={label(r)}>
   <strong className="text-sm">{label(r)}</strong>
   {r.done?<p className="text-xs">Đã lưu {action==='REQUEST'?'yêu cầu':action==='SENT'?'xác nhận gửi':'tiền thực nhận'}{action!=='REQUEST'&&r.request?' · '+r.request.paypal+' · '+r.request.email:''}</p>:<>
    {why&&<p className="text-xs pm-muted">{why}</p>}
    {action==='SENT'&&r.request&&<p className="text-xs">{r.request.paypal} · {r.request.email}</p>}
    {action==='REQUEST'&&!why&&<><label className="pm-label text-xs">PayPal / email nhận<select className="pm-input" aria-label={'Email PP '+label(r)} disabled={locked||!!ownEmail(r)} value={r.email} onChange={e=>{if(!ownEmail(r)&&!selectionReason(r,e.target.value))change(r,{email:e.target.value});}}><option value="">Chọn mã PP và email</option>{r.pick?.paypals.flatMap(p=>p.emails.map(e=><option key={e.id} value={e.id} disabled={!!selectionReason(r,e.id)}>{p.code} · {e.email}{p.balanceUsd!==null?' · '+formatUsd(p.balanceUsd):''}{p.daily?' · Hôm nay '+(p.daily.used+p.daily.reserved)+'/'+p.daily.limit+' email':''}{!payoutEmailAllowed(p,e)?' · hết lượt email hôm nay':!p.usable?' · không dùng được':''}</option>))}</select></label>
     {selectedPaypal&&<p className="text-xs pm-muted" aria-live="polite"><PayoutDailyInfo paypal={selectedPaypal}/></p>}
     {ownEmail(r)&&<p className="text-xs pm-muted">Email đã gắn với EarnApp này được giữ cố định, không tự đổi email.</p>}
     {selectionError&&<p className="pm-error text-xs" role="alert">{selectionError}</p>}
     <label className="pm-label text-xs">Số tiền rút ($)<input className="pm-input" inputMode="decimal" aria-label={'Số tiền '+label(r)} value={r.amount} disabled={locked} onChange={e=>change(r,{amount:e.target.value})}/></label></>}
    {action==='RECEIPT'&&r.request&&<><p className="text-xs">{r.request.paypal} · {r.request.email}{r.request.money&&' · còn chờ '+formatLedger(r.request.money.remaining,r.request.money.currency)}</p>{!why&&<><label className="pm-label text-xs">Tiền thực nhận ({r.request.money?.currency})<input className="pm-input" inputMode="decimal" aria-label={'Thực nhận '+label(r)} value={r.actual} disabled={locked} onChange={e=>change(r,{actual:e.target.value})}/></label><label className="pm-label text-xs">Mã giao dịch PP (nếu có)<input className="pm-input" aria-label={'Mã giao dịch '+label(r)} value={r.txid} maxLength={100} disabled={locked} onChange={e=>change(r,{txid:e.target.value})}/></label>{money(r.actual)&&Number(canonical(r.actual))>Number(r.request.money!.remaining)&&<p className="pm-error text-xs">Số thực nhận vượt phần còn chờ; kiểm tra lại.</p>}</>}</>}
    {r.error&&r.error!==why&&<p className="pm-error text-xs" role="alert">{r.error}</p>}
   </>}
  </section>})}
  {onAssign&&rows.some(r=>!r.earnAppId)&&<button type="button" className="pm-button" disabled={busy} onClick={onAssign}>Gán tài khoản cho VM đã chọn</button>}
  {notice&&<p className="text-xs" role="status">{notice}</p>}
  {unknown.length>0&&<p className="text-xs pm-muted">Lệnh chưa rõ được giữ trong tab này. Không tạo yêu cầu mới; mở lại đúng VM và dùng Thử lại.</p>}
  {unknown.length>0&&<button type="button" className="pm-button pm-button-primary" disabled={busy||!active} onClick={()=>void send(true)}>Thử lại lệnh chưa rõ</button>}
  <button type="button" className="pm-button pm-button-primary" disabled={busy||!active||!ready.length||!date||(action==='SENT'||action==='REQUEST'&&sent)&&!confirmed} onClick={()=>void send()}>{busy?'Đang lưu…':action==='RECEIPT'?`Ghi thực nhận ${ready.length} VM`:action==='SENT'?`Xác nhận đã gửi ${ready.length} VM`:sent?`Ghi đã gửi ${ready.length} VM`:`Lưu chuẩn bị ${ready.length} VM`}</button>
 </div>;
}
