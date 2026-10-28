"use client";
import {useEffect,useRef,useState} from 'react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {formatUsd,formatLedger} from '@/lib/money-input';
import {vmMoneyState} from '@/lib/vm-money';
import type {ManagedVM} from '../shared';
import {PayoutDailyInfo,payoutEmailAllowed,type PickPaypal,type OpsRow,type OpsRights} from './OpsCells';

// Rút gộp (owner brief 27/10/2026): the SDKs of several selected VMs were merged into ONE EarnApp account (the VM chính) to withdraw
// once. One request on the VM chính carries the other VMs as members; money is the request's, counted once. Default = PREPARING.
// If the VM chính already has an open request (EarnApp is often clicked before the web is written), the other VMs are attached to it.
type Pick=Omit<inferRouterOutputs<AppRouter>['vmOps']['payoutPick'],'paypals'>&{paypals:PickPaypal[]};
type Command={kind:'CREATE'|'ATTACH';body:Record<string,unknown>};
const day=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const money=(s:string)=>/^\d+([.,]\d{1,2})?$/.test(s.trim())&&Number(s.replace(',','.'))>0;
const canonical=(s:string)=>s.trim().replace(',','.');
const label=(vm:ManagedVM)=>vm.server+' / '+vm.code;
const journalKey=(project:string,user:string,primary:string)=>'mth-payout-merge:'+JSON.stringify([project,user,primary]);
function readCommand(key:string):Command|undefined{try{const s=window.sessionStorage.getItem(key);return s?JSON.parse(s):undefined;}catch{return undefined;}}
function refused(e:unknown){const code=(e as {data?:{code?:string}})?.data?.code;return !!code&&['BAD_REQUEST','UNAUTHORIZED','FORBIDDEN','NOT_FOUND','CONFLICT','PRECONDITION_FAILED','TOO_MANY_REQUESTS','UNPROCESSABLE_CONTENT'].includes(code);}
function message(e:unknown){return e instanceof Error?e.message:'Không nhận được phản hồi hợp lệ';}
/** The current SDK's money read on this VM in this round (the reference share), or null. */
export function shareOf(vm:ManagedVM){
  const cur=vm.sdks.find(s=>s.current)??null,s=vmMoneyState(cur?{code:cur.code,amount:cur.amount,observedAt:cur.amountObservedAt,failedAt:cur.amountFailedAt,moneyHidden:cur.moneyHidden,stored:cur.stored}:null);
  return s.kind==='OK'||s.kind==='STALE'||s.kind==='NO_TIME'?s.amount:s.kind==='FAILED'?s.amount:null;
}
const openRequest=(o:OpsRow|undefined)=>o?.request&&o.request.state==='REQUESTED'?o.request:null;
export function MergePayoutPanel({projectId,userId,vms,opsOf,rights,onSaved,onBusy}:{projectId:string;userId:string;vms:ManagedVM[];opsOf:(id:string)=>OpsRow|undefined;rights:OpsRights;onSaved:()=>Promise<unknown>|void;onBusy:(busy:boolean)=>void}){
  const utils=trpc.useContext(),create=trpc.vmOps.requestPayout.useMutation(),attach=trpc.vmOps.addPayoutMembers.useMutation();
  // The selection and identities are captured when the frame opens; a reload never retargets the draft.
  const [rows]=useState(()=>vms.map(vm=>({vm,ops:opsOf(vm.id)})));
  const candidates=rows.filter(r=>!!r.ops?.earnAppId&&r.ops.merge?.role!=='MEMBER');
  const [primaryId,setPrimary]=useState(()=>{for(const r of candidates)if(readCommand(journalKey(projectId,userId,r.vm.id)))return r.vm.id;return candidates.length===1?candidates[0].vm.id:'';});
  const [command,setCommand]=useState<Command|undefined>(()=>primaryId?readCommand(journalKey(projectId,userId,primaryId)):undefined);
  const [pick,setPick]=useState<Pick|null>(null),[pickError,setPickError]=useState('');
  const [amount,setAmount]=useState(()=>command?.kind==='CREATE'?String(command.body.amount):''),[email,setEmail]=useState(()=>command?.kind==='CREATE'?String(command.body.paypalEmailId):''),[date,setDate]=useState(day);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
  const running=useRef(false);
  const primary=rows.find(r=>r.vm.id===primaryId)??null,existing=openRequest(primary?.ops),members=rows.filter(r=>r.vm.id!==primaryId);
  const memberWhy=(r:typeof rows[number])=>r.ops?.merge?.role==='MEMBER'?'Đã gộp vào lệnh rút của '+r.ops.merge.primaryWhere:openRequest(r.ops)?'Đang có lệnh rút riêng':r.ops?.merge?.role==='PRIMARY'?'Đang là VM chính của lệnh gộp khác':'';
  const blocked=members.filter(r=>memberWhy(r));
  useEffect(()=>{setPick(null);setPickError('');if(!primaryId||existing)return;let live=true;
    void utils.vmOps.payoutPick.fetch({projectId,vmId:primaryId}).then(p=>{if(!live)return;setPick(p as Pick);const own=(p as Pick).paypals.flatMap(x=>x.emails).find(e=>e.own);setEmail(old=>old||own?.id||'');}).catch(e=>{if(live)setPickError(message(e));});
    return ()=>{live=false;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[primaryId]);
  const shares=[...(primary?[primary]:[]),...members].map(r=>shareOf(r.vm)),total=shares.every(s=>s!==null)?shares.reduce((a,s)=>a+Math.round(Number(s)*100),0)/100:null;
  const ownEmail=pick?.earnApp?.emailId??pick?.paypals.flatMap(p=>p.emails).find(e=>e.own)?.id??null;
  const chosen=pick?.paypals.flatMap(p=>p.emails.map(e=>({p,e}))).find(x=>x.e.id===email)??null;
  const why=!primary?'Chọn VM chính (VM có tài khoản EarnApp nhận tiền)':!members.length?'Chọn thêm ít nhất 1 VM để gộp':blocked.length?'Bỏ chọn các VM đang trong lệnh rút khác':existing?'':!pick?pickError||'Đang tải email PayPal…':!email?'Chọn mã PP và email nhận':!chosen||!payoutEmailAllowed(chosen.p,chosen.e)||!chosen.p.usable?'Email / PayPal không dùng được hôm nay':!money(amount)?'Nhập số tiền thực rút trên EarnApp':'';
  async function send(){
    if(running.current||!primary)return;running.current=true;setBusy(true);onBusy(true);setError('');
    const storage=journalKey(projectId,userId,primary.vm.id);
    const memberBody=members.map(r=>({vmId:r.vm.id,expectedCycle:r.ops?.cycle??1,expectedVmRevision:r.vm.revision}));
    const cmd:Command=command??(existing?{kind:'ATTACH',body:{projectId,key:crypto.randomUUID(),requestId:existing.id,expectedRevision:existing.revision,members:memberBody}}
      :{kind:'CREATE',body:{projectId,key:crypto.randomUUID(),vmId:primary.vm.id,expectedCycle:primary.ops?.cycle??1,expectedVmRevision:primary.vm.revision,earnAppId:primary.ops!.earnAppId,paypalEmailId:email,amount:canonical(amount),currency:'USD',date,submission:'PREPARING',members:memberBody}});
    try{window.sessionStorage.setItem(storage,JSON.stringify(cmd));}catch{setError('Không lưu được mã chống lặp trong tab; chưa gửi lệnh.');running.current=false;setBusy(false);onBusy(false);return;}
    setCommand(cmd);
    try{
      if(cmd.kind==='ATTACH')await attach.mutateAsync(cmd.body as Parameters<typeof attach.mutateAsync>[0]);else await create.mutateAsync(cmd.body as Parameters<typeof create.mutateAsync>[0]);
      try{window.sessionStorage.removeItem(storage);}catch{/* A retained original key is safe to replay. */}
      setCommand(undefined);setDone(cmd.kind==='ATTACH'?'Đã gộp '+members.length+' VM vào lệnh rút của '+label(primary.vm):'Đã ghi chuẩn bị rút gộp '+(members.length+1)+' VM');
      try{await onSaved();}catch{setDone(d=>d+'; chưa tải lại được bảng. Không gửi lại.');}
    }catch(e){const uncertain=!refused(e);setError(uncertain?'Chưa xác định kết quả. Thử lại đúng lệnh cũ: '+message(e):message(e));if(!uncertain){try{window.sessionStorage.removeItem(storage);}catch{/* Retained key remains safe. */}setCommand(undefined);}}
    finally{running.current=false;setBusy(false);onBusy(false);}
  }
  if(!(rights.writeMoney||rights.payout))return <p className="text-xs pm-muted">Rút gộp cần quyền ghi Tiền vào PayPal hoặc quyền “Chuẩn bị rút EarnApp”.</p>;
  const locked=busy||!!command||!!done;
  return <div className="space-y-3" aria-label="Rút gộp về PayPal">
    <p className="text-xs pm-muted">Dùng khi SDK của các VM đã được nối vào MỘT tài khoản EarnApp để rút một lần. Tiền về PayPal ghi một lần trên lệnh của VM chính; các VM khác hiện “Đã gộp vào …”. Ghi nhận trên web, việc rút thật làm trên EarnApp.</p>
    <fieldset className="space-y-1" disabled={locked}><legend className="font-semibold text-xs">VM chính (có tài khoản EarnApp)</legend>
      {rows.map(r=>{const ok=candidates.includes(r);return <label key={r.vm.id} className="text-xs flex gap-2 items-center"><input type="radio" name="merge-primary" aria-label={'VM chính '+label(r.vm)} value={r.vm.id} checked={primaryId===r.vm.id} disabled={!ok} onChange={()=>{setPrimary(r.vm.id);setEmail('');}}/>{label(r.vm)}{!r.ops?.earnAppId?<span className="pm-muted">· Chưa có tài khoản</span>:r.ops.merge?.role==='MEMBER'?<span className="pm-muted">· đã gộp vào VM khác</span>:null}</label>;})}
    </fieldset>
    {primary&&<>
      {existing?<p className="text-xs">VM chính đã có lệnh rút {existing.submission==='PREPARING'?'đang chuẩn bị':existing.submission==='SENT'?'đã gửi':'chưa rõ kết quả'} ({existing.paypal} · {existing.email}{existing.money?' · '+formatLedger(existing.money.amount,existing.money.currency):''}); gắn thêm các VM còn lại vào lệnh này.</p>:null}
      <table className="text-xs w-full"><thead><tr><th className="text-left">VM</th><th className="text-left">SDK hiện tại</th><th className="text-right">Đóng góp tham khảo</th></tr></thead><tbody>
        {[primary,...members].map(r=>{const cur=r.vm.sdks.find(s=>s.current),share=shareOf(r.vm),w=r===primary?'':memberWhy(r);return <tr key={r.vm.id} data-merge-row={r.vm.id}><td>{label(r.vm)}{r===primary?' (chính)':''}{w&&<span className="pm-error block">{w}</span>}{r!==primary&&r.ops?.earnAppId&&!w&&<span className="pm-muted block">VM có tài khoản riêng: giữ nguyên</span>}</td><td>{cur?<code>{cur.code.length>12?cur.code.slice(0,4)+'…'+cur.code.slice(-4):cur.code}</code>:<span className="pm-muted">Chưa có</span>}</td><td className="text-right">{share!==null?formatUsd(share):<span className="pm-muted">Chưa kiểm tra</span>}</td></tr>;})}
      </tbody></table>
      <p className="text-xs">{total!==null?<>Tổng gợi ý <strong>{formatUsd(total.toFixed(2))}</strong></>:'Tổng gợi ý: còn VM chưa kiểm tra tiền'} · chỉ để tham khảo, không phải tiền về.</p>
      {!existing&&<>
        <label className="pm-label text-xs">Số tiền thực rút trên EarnApp ($)<input className="pm-input" inputMode="decimal" aria-label="Số tiền thực rút trên EarnApp" value={amount} disabled={locked} onChange={e=>setAmount(e.target.value)}/></label>
        <label className="pm-label text-xs">Ngày yêu cầu<input type="date" className="pm-input" value={date} disabled={locked} onChange={e=>setDate(e.target.value)}/></label>
        <label className="pm-label text-xs">PayPal / email nhận (của VM chính)<select className="pm-input" aria-label="Email PP rút gộp" value={email} disabled={locked||!pick||!!ownEmail} onChange={e=>setEmail(e.target.value)}><option value="">Chọn mã PP và email</option>{pick?.paypals.flatMap(p=>p.emails.map(e=><option key={e.id} value={e.id} disabled={!payoutEmailAllowed(p,e)||!p.usable}>{p.code} · {e.email}{p.daily?' · Hôm nay '+(p.daily.used+p.daily.reserved)+'/'+p.daily.limit+' email':''}</option>))}</select></label>
        {chosen&&<p className="text-xs pm-muted"><PayoutDailyInfo paypal={chosen.p}/></p>}
        {ownEmail&&<p className="text-xs pm-muted">Email đã gắn với EarnApp của VM chính được giữ cố định.</p>}
        <p className="text-xs pm-muted">Lưu ở bước Chuẩn bị (giữ email). Bấm rút trên EarnApp xong thì xác nhận “Đã gửi” ở ô tiền của VM chính; lúc đó SDK của các VM gộp được ghi Đã dùng.</p>
      </>}
    </>}
    {why&&!done&&!command&&<p className="text-xs pm-muted" role="status">{why}</p>}
    {error&&<p className="pm-error text-xs" role="alert">{error}</p>}
    {done&&<p className="text-xs" role="status">{done}</p>}
    {command?<button type="button" className="pm-button pm-button-primary" disabled={busy} onClick={()=>void send()}>{busy?'Đang lưu…':'Thử lại lệnh chưa rõ'}</button>
    :!done&&<button type="button" className="pm-button pm-button-primary" disabled={busy||!!why} onClick={()=>void send()}>{busy?'Đang lưu…':existing?`Gộp ${members.length} VM vào lệnh rút`:`Lưu chuẩn bị rút gộp ${members.length+1} VM`}</button>}
  </div>;
}
