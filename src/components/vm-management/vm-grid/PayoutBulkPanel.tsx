"use client";
import {useEffect,useRef,useState} from 'react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {formatUsd} from '@/lib/money-input';
import {vmMoneyState} from '@/lib/vm-money';
import type {ManagedVM} from '../shared';
import {PayoutDailyInfo,payoutEmailAllowed,type PickPaypal,type OpsRow,type OpsRights} from './OpsCells';
import {defaultPayoutAmount,bangkokDay} from './payout-frame-model';
import {PayoutStatusBulk,type StatusBulkRow} from './PayoutStatusBulk';

// Selection → "Rút N VM" (owner 28/10/2026): one PREPARING request per VM, each holding its own email at once; then "Đã rút N dòng" and
// "Tiền đã về N dòng" (PayoutStatusBulk). Every row is its own command with its own key; a lost answer is retried with the same body.
type Pick=Omit<inferRouterOutputs<AppRouter>['vmOps']['payoutPick'],'paypals'>&{paypals:PickPaypal[]};
type Mode='REQUEST'|'SEND'|'RECEIVE';
type Command={action:'REQUEST';vmId:string;body:Record<string,unknown>;snapshot:{cycle:number;earnAppId:string|null;request:OpsRow['request']}};
type Row={vm:ManagedVM;cycle:number;earnAppId:string|null;request:OpsRow['request'];amount:string;email:string;pick?:Pick;error:string;loading:boolean;done:boolean;unknown:boolean;command?:Command};
const money=(s:string)=>/^\d+([.,]\d{1,2})?$/.test(s.trim())&&Number(s.replace(',','.'))>0;
const canonical=(s:string)=>s.trim().replace(',','.');
const label=(r:Row)=>r.vm.server+' / '+r.vm.code;
const journalKey=(project:string,user:string,id:string)=>'mth-payout-selection:'+JSON.stringify([project,user,id,'REQUEST']);
function readCommand(key:string):Command|undefined{try{const s=window.sessionStorage.getItem(key);return s?JSON.parse(s):undefined;}catch{return undefined;}}
function refused(e:unknown){const code=(e as {data?:{code?:string}})?.data?.code;return !!code&&['BAD_REQUEST','UNAUTHORIZED','FORBIDDEN','NOT_FOUND','CONFLICT','PRECONDITION_FAILED','TOO_MANY_REQUESTS','UNPROCESSABLE_CONTENT'].includes(code);}
function message(e:unknown){return e instanceof Error?e.message:'Không nhận được phản hồi hợp lệ';}
/** Tiền VM of the current SDK (as the Tiền VM cell shows it): the default amount of "Rút". */
function vmMoneyOf(vm:ManagedVM){const cur=vm.sdks.find(s=>s.current)??null,s=vmMoneyState(cur?{code:cur.code,amount:cur.amount,observedAt:cur.amountObservedAt,failedAt:cur.amountFailedAt,moneyHidden:cur.moneyHidden,stored:cur.stored}:null);return defaultPayoutAmount(s.kind==='OK'||s.kind==='STALE'?s.amount:null);}
/** Rows for "Đã rút N dòng" / "Tiền đã về N dòng" from the selected VMs and the board. */
export function statusRows(vms:ManagedVM[],opsOf:(id:string)=>OpsRow|undefined):StatusBulkRow[]{return vms.map(vm=>({vmId:vm.id,serverId:vm.serverId,server:vm.server,code:vm.code,label:vm.server+' / '+vm.code,ops:opsOf(vm.id)}));}

/** Selected identities are captured once. Live reloads may block new writes, never retarget a draft. The session user is required. */
export function PayoutBulkPanel({projectId,userId,vms,opsOf,rights,onSaved,onAssign,onBusy}:{projectId:string;userId?:string;vms:ManagedVM[];opsOf:(id:string)=>OpsRow|undefined;rights:OpsRights;onSaved:()=>Promise<unknown>|void;onAssign?:()=>void;onBusy:(busy:boolean)=>void}){
 const payout=!!(rights.writeMoney||rights.payout),receipt=!!(rights.writeMoney||rights.receipt),first:Mode=payout?'REQUEST':'RECEIVE';
 const [mode,setMode]=useState<Mode>(first),[visited,setVisited]=useState<Mode[]>([first]),[saving,setSaving]=useState(false),[version,setVersion]=useState(0);
 const changeMode=(next:Mode)=>{setVisited(old=>old.includes(next)?old:[...old,next]);setMode(next);};
 const changedBusy=(value:boolean)=>{setSaving(value);onBusy(value);};
 if(!userId)return <p className="pm-muted text-xs">Đang tải phiên đăng nhập…</p>;
 const tab=(m:Mode,text:string)=><button type="button" role="tab" disabled={saving} aria-selected={mode===m} className={'pm-button'+(mode===m?' pm-button-primary':'')} onClick={()=>changeMode(m)}>{text}</button>;
 // Keep visited queues mounted so changing tabs cannot discard a draft or an uncertain command.
 return <div className="space-y-3"><div className="flex gap-2 flex-wrap" role="tablist" aria-label="Rút tiền các VM đã chọn">
  {payout&&tab('REQUEST','Rút')}{payout&&tab('SEND','Đã rút')}{receipt&&tab('RECEIVE','Tiền đã về')}
 </div><p className="text-xs pm-muted">Ghi nhận trên web. Việc rút thật thực hiện trên EarnApp; chỉ ghi tiền về khi đã thấy PayPal nhận tiền.</p>
 <button type="button" className="pm-button pm-button-quiet" disabled={saving} onClick={()=>setVersion(v=>v+1)}>Nạp yêu cầu mới / bỏ nháp chưa gửi</button>
 {visited.map(m=><div key={m+version} hidden={mode!==m}>
  {m==='REQUEST'?payout&&<PayoutQueue projectId={projectId} userId={userId} active={mode==='REQUEST'} vms={vms} opsOf={opsOf} onSaved={onSaved} onAssign={onAssign} onBusy={changedBusy}/>
  :(m==='SEND'?payout:receipt)&&<PayoutStatusBulk projectId={projectId} userId={userId} kind={m} rows={statusRows(vms,opsOf)} liveOf={opsOf} onSaved={onSaved} onBusy={changedBusy}/>}
 </div>)}
 </div>;
}
// "Rút N VM": each selected VM gets one PREPARING request that holds its email in the same command (amount = Tiền VM, editable). The
// email is pre-picked (the EarnApp's own email, else a free email of the suggested PayPal not taken by an earlier row); never two
// rows on one email, never past a PayPal's 2 emails a day.
function PayoutQueue({projectId,userId,active,vms,opsOf,onSaved,onAssign,onBusy}:{projectId:string;userId:string;active:boolean;vms:ManagedVM[];opsOf:(id:string)=>OpsRow|undefined;onSaved:()=>Promise<unknown>|void;onAssign?:()=>void;onBusy:(busy:boolean)=>void}){
 const utils=trpc.useContext(),create=trpc.vmOps.requestPayout.useMutation();
 const [date]=useState(bangkokDay),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [rows,setRows]=useState<Row[]>(()=>vms.map(vm=>{const o=opsOf(vm.id),command=readCommand(journalKey(projectId,userId,vm.id));
  const valid=command?.action==='REQUEST'&&command.vmId===vm.id&&command.body.projectId===projectId&&!!command.snapshot;
  return {vm,cycle:valid?command.snapshot.cycle:o?.cycle??1,earnAppId:valid?command.snapshot.earnAppId:o?.earnAppId??null,request:valid?command.snapshot.request:o?.request??null,amount:valid?String(command.body.amount):vmMoneyOf(vm),email:valid?String(command.body.paypalEmailId):'',loading:!!o?.earnAppId&&!o.request&&!valid,error:'',done:false,unknown:!!valid,command:valid?command:undefined};}));
 const state=useRef(rows);state.current=rows;const running=useRef(false);const latest=useRef({opsOf,vms});latest.current={opsOf,vms};
 const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const patch=(id:string,p:Partial<Row>)=>setRows(old=>old.map(r=>r.vm.id===id?{...r,...p}:r));
 useEffect(()=>{let mounted=true;const pending=rows.filter(r=>r.loading),taken=new Set(rows.filter(r=>r.email).map(r=>r.email));void(async()=>{for(const r of pending){try{const pick=await utils.vmOps.payoutPick.fetch({projectId,vmId:r.vm.id});if(!mounted)return;
   const own=pick.paypals.flatMap(p=>p.emails).find(e=>e.own)?.id??'';
   const pp=pick.suggestion?pick.paypals.find(p=>p.id===pick.suggestion!.paypalId):undefined;
   const free=!own&&pp?.usable?pp.emails.find(e=>!e.own&&!taken.has(e.id)&&payoutEmailAllowed(pp,e)&&e.dailyOccupied!==true)?.id??'':'';
   const email=own||free;if(email)taken.add(email);patch(r.vm.id,{pick,email,loading:false});}catch(e){if(mounted)patch(r.vm.id,{error:message(e),loading:false});}}})();return()=>{mounted=false;};
 // The queue is tied to the identities at opening, not query/background refreshes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 const stale=(r:Row)=>{const o=latest.current.opsOf(r.vm.id),vm=latest.current.vms.find(v=>v.id===r.vm.id);return !vm||!o||o.cycle!==r.cycle||o.earnAppId!==r.earnAppId||vm.revision!==r.vm.revision||(!r.request&&!!o.request);};
 const reason=(r:Row)=>{if(r.done||r.unknown)return '';if(!r.earnAppId)return 'Chưa gán tài khoản EarnApp';if(stale(r))return 'VM đã đổi lượt hoặc tài khoản / phiên bản. Đóng khung và kiểm tra lại.';
  if(r.request)return 'Đã có yêu cầu rút; theo dõi tại ô tiền của VM, không tạo thêm.';if(r.loading)return 'Đang tải email PayPal…';if(!r.pick)return r.error||'Chưa tải được danh sách PayPal';if(r.pick.earnApp?.id!==r.earnAppId)return 'VM đã đổi lượt hoặc tài khoản';return '';};
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
 const valid=(r:Row)=>!r.done&&!r.unknown&&!reason(r)&&money(r.amount)&&!!r.email&&!selectionReason(r,r.email);
 const ready=rows.filter(valid),unknown=rows.filter(r=>r.unknown);
 async function send(retry=false){if(running.current)return;running.current=true;setBusy(true);onBusy(true);setNotice('');let saved=0;
  try{const targets=state.current.filter(r=>retry?r.unknown:valid(r));for(const initial of targets){if(!mounted.current)break;const r=state.current.find(x=>x.vm.id===initial.vm.id)!;if(!retry&&!valid(r))continue;
   const storage=journalKey(projectId,userId,r.vm.id);const command:Command=r.command??{action:'REQUEST',vmId:r.vm.id,snapshot:{cycle:r.cycle,earnAppId:r.earnAppId,request:r.request},body:{projectId,key:crypto.randomUUID(),vmId:r.vm.id,expectedCycle:r.cycle,expectedVmRevision:r.vm.revision,earnAppId:r.earnAppId,paypalEmailId:r.email,amount:canonical(r.amount),currency:'USD',date,submission:'PREPARING'}};
   try{window.sessionStorage.setItem(storage,JSON.stringify(command));}catch{patch(r.vm.id,{error:'Không lưu được mã chống lặp trong tab; chưa gửi lệnh.'});continue;}
   patch(r.vm.id,{command,error:''});
   try{await create.mutateAsync(command.body as Parameters<typeof create.mutateAsync>[0]);
    patch(r.vm.id,{done:true,unknown:false,error:'',command:undefined});saved++;try{window.sessionStorage.removeItem(storage);}catch{/* A retained original key is safe to replay. */}
   }catch(e){const uncertain=r.unknown||!refused(e);patch(r.vm.id,{unknown:uncertain,error:uncertain?'Chưa xác định kết quả. Thử lại đúng lệnh cũ: '+message(e):message(e),command:uncertain?command:undefined});if(!uncertain)try{window.sessionStorage.removeItem(storage);}catch{/* Retained key remains safe. */}}
  }setNotice('Đã lưu '+saved+' VM. Các dòng chưa lưu vẫn giữ nội dung.');if(saved)try{await onSaved();}catch{setNotice('Đã lưu '+saved+' VM; chưa tải lại được bảng. Không gửi lại dòng đã lưu.');}
  }finally{running.current=false;setBusy(false);onBusy(false);}
 }
 const change=(r:Row,p:Partial<Row>)=>patch(r.vm.id,{...p,error:''});
 return <div className="space-y-3" aria-label="Danh sách yêu cầu rút">
  <p className="text-xs pm-muted">“Rút” giữ ngay email PayPal riêng cho từng EarnApp (yêu cầu “Đang rút, chưa xác nhận”). Rút trên EarnApp xong thì bấm “Đã rút”.</p>
  <p className="text-xs pm-muted">Mỗi PP tối đa 2 email khác nhau mỗi ngày theo giờ Việt Nam (00:00–24:00). Bản nháp tính thêm các email đã chọn trong đợt này. Máy chủ kiểm tra lại từng dòng khi lưu.</p>
  <p className="text-xs pm-muted">Đang xử lý {rows.length} VM đã chọn lúc mở khung. Đổi lựa chọn: đóng và mở lại khung.</p>
  {rows.map(r=>{const why=reason(r),locked=busy||r.done||r.unknown||!!why,selectionError=selectionReason(r,r.email),selectedPaypal=r.pick?.paypals.find(p=>p.emails.some(e=>e.id===r.email));return <section key={r.vm.id} className="vm-payout-bulk-row space-y-2" aria-label={label(r)}>
   <strong className="text-sm">{label(r)}</strong>
   {r.done?<p className="text-xs">Đã giữ email, đang rút</p>:<>
    {why&&<p className="text-xs pm-muted">{why}</p>}
    {!why&&<><label className="pm-label text-xs">PayPal / email nhận<select className="pm-input" aria-label={'Email PP '+label(r)} disabled={locked||!!ownEmail(r)} value={r.email} onChange={e=>{if(!ownEmail(r)&&!selectionReason(r,e.target.value))change(r,{email:e.target.value});}}><option value="">Chọn mã PP và email</option>{r.pick?.paypals.flatMap(p=>p.emails.map(e=><option key={e.id} value={e.id} disabled={!!selectionReason(r,e.id)}>{p.code} · {e.email}{p.balanceUsd!==null?' · '+formatUsd(p.balanceUsd):''}{p.daily?' · Hôm nay '+(p.daily.used+p.daily.reserved)+'/'+p.daily.limit+' email':''}{!payoutEmailAllowed(p,e)?' · hết lượt email hôm nay':!p.usable?' · không dùng được':''}</option>))}</select></label>
     {selectedPaypal&&<p className="text-xs pm-muted" aria-live="polite"><PayoutDailyInfo paypal={selectedPaypal}/></p>}
     {ownEmail(r)&&<p className="text-xs pm-muted">Email đã gắn với EarnApp này được giữ cố định, không tự đổi email.</p>}
     {selectionError&&<p className="pm-error text-xs" role="alert">{selectionError}</p>}
     <label className="pm-label text-xs">Số tiền rút ($)<input className="pm-input" inputMode="decimal" aria-label={'Số tiền '+label(r)} value={r.amount} disabled={locked} onChange={e=>change(r,{amount:e.target.value})}/></label></>}
    {r.error&&r.error!==why&&<p className="pm-error text-xs" role="alert">{r.error}</p>}
   </>}
  </section>})}
  {onAssign&&rows.some(r=>!r.earnAppId)&&<button type="button" className="pm-button" disabled={busy} onClick={onAssign}>Gán tài khoản cho VM đã chọn</button>}
  {notice&&<p className="text-xs" role="status">{notice}</p>}
  {unknown.length>0&&<p className="text-xs pm-muted">Lệnh chưa rõ được giữ trong tab này. Không tạo yêu cầu mới; mở lại đúng VM và dùng Thử lại.</p>}
  {unknown.length>0&&<button type="button" className="pm-button pm-button-primary" disabled={busy||!active} onClick={()=>void send(true)}>Thử lại lệnh chưa rõ</button>}
  <button type="button" className="pm-button pm-button-primary" disabled={busy||!active||!ready.length} onClick={()=>void send()}>{busy?'Đang lưu…':`Rút ${ready.length} VM`}</button>
 </div>;
}
