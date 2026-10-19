"use client";
import {Fragment,useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {Copy} from 'lucide-react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {links} from '@/lib/links';
import {errorMessage} from '@/components/vm-management/shared';
import {viMoney as viAmount} from './batch-format';
import {transferDraft} from '@/lib/paypal-transfer';
import {formatLedger,formatUsd} from '@/lib/money-input';
import {gatherText} from '@/lib/vm-ops';
import type {AccountUrl,PaypalShow} from './account-url';
type Store=inferRouterOutputs<AppRouter>['accountStore']['store'];
type Paypal=Store['paypals'][number];
type Ledger=inferRouterOutputs<AppRouter>['accountStore']['ledger'];
type Cur=Ledger['paypals'][number]['currencies'][number];
const PP_STATUS:Record<string,string>={ACTIVE:'Dùng được',LIMITED:'Bị limit',SUSPENDED:'Bị suspend',CLOSED:'Đã đóng',PENDING_VERIFY:'Chờ xác minh'};
const EMAIL_STATE:Record<string,string>={NEW:'Chưa dùng',ASSIGNED:'Đang gán',USED:'Đã dùng',HOLD:'Tạm giữ đối chiếu'};
// A PayPal's state is about its emails: NEW = at least one email still unused (the PayPal may already serve other EarnApps).
const PP_STATE:Record<string,string>={NEW:'Còn email chưa dùng',ASSIGNED:'Hết email chưa dùng · có email đang gán',USED:'Hết email chưa dùng',BLOCKED:'Khoá / ngừng dùng'};
const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const CURRENCIES=['USD','USDT','EUR','VND'];
const vmHref=(p:{serverId:string;vmId:string})=>links.vms({serverId:p.serverId,vm:p.vmId,tab:'account'});
const moneyLines=(cs:Cur[],pick:(c:Cur)=>string|null)=>cs.map(c=>({currency:c.currency,value:pick(c)})).filter(x=>x.value!==null&&(Number(x.value)!==0||cs.length===1));
// Kho PayPal: one row per PayPal code. Emails open under the row (each with its own use and money received). Money in / out /
// balance come from the one PayPal book (Tiền vào PayPal and Rút / chuyển rows); clicking an amount lists the rows behind it.
// The balance is the book's, per currency, up to the end of the chosen month; it is shown only to members who may read both sides.
export function PaypalStock({projectId,rows,store,url,go,write,status,selected,setSelected,onSaved}:{projectId:string;rows:Paypal[];store:Store|undefined;url:AccountUrl;go:(u:AccountUrl,mode?:'push'|'replace')=>void;write:boolean;status:{busy:boolean;save:(items:{id:string;revision:number}[],status:string)=>Promise<void>};selected:Set<string>|null;setSelected:(s:Set<string>)=>void;onSaved:()=>void}){
  const toggle=(id:string)=>{if(!selected)return;const n=new Set(selected);if(n.has(id))n.delete(id);else n.add(id);setSelected(n);};
  const ledger=trpc.accountStore.ledger.useQuery({projectId,month:url.month||null,asOf:url.month?null:url.asof||null},{keepPreviousData:true}),l=ledger.data,r=l?.rights;
  const money=new Map((l?.paypals||[]).map(p=>[p.paypalId,p])),received=new Map((l?.emails||[]).map(e=>[e.emailId,e.received]));
  // Gathering label (USD, book balance up to today + money still to come from payout requests / pending receipts). Not the month.
  const gather=trpc.vmOps.gather.useQuery({projectId},{retry:false}),gatherOf=new Map((gather.data?.paypals||[]).map(g=>[g.paypalId,g]));
  // Recomputed with the book: every time the ledger is read again (after a receipt, transfer or opening), the label is too.
  const gatherRefetch=gather.refetch;useEffect(()=>{if(ledger.dataUpdatedAt)void gatherRefetch();},[ledger.dataUpdatedAt,gatherRefetch]);
  const [form,setForm]=useState<{pp:string;kind:'receipt'|'transfer'|'emails'}|null>(null);
  // Opening the rows behind an amount keeps that amount's cut-off day in the URL (?asof, when no month), so reload / Back / Forward
  // show the same number and the same rows even on another day; closing returns to today.
  const open=(p:Paypal,show:PaypalShow)=>{const close=url.pp===p.code&&url.show===show,money=show==='in'||show==='out';go({...url,pp:close?'':p.code,show:close?'':show,asof:!close&&money&&!url.month?url.asof||l?.asOf||'':''});};
  const showMoney=!!(r?.funds||r?.withdrawals),cols=4+(showMoney?3:0);
  const refresh=()=>{void ledger.refetch();onSaved();};
  return <>
    {showMoney&&<div className="pm-actions flex-wrap gap-2 pt-0">
      <label className="text-sm flex items-center gap-2">Tiền theo tháng<input type="month" className="pm-input w-auto" aria-label="Tháng tiền PayPal" value={url.month||''} onChange={e=>go({...url,month:e.target.value})}/></label>
      {url.month&&<button type="button" className="pm-link text-sm" onClick={()=>go({...url,month:''})}>Toàn bộ</button>}
      {!url.month&&url.asof&&l?.asOf&&l.asOf!==today()&&<button type="button" className="pm-link text-sm" onClick={()=>go({...url,asof:''})}>Tính đến hôm nay</button>}
      <span className="pm-muted text-xs">{l?.asOf?<>Còn lại theo sổ đến hết ngày {l.asOf.split('-').reverse().join('/')}{url.month?' (gồm số dư trước tháng)':''}. Là số dư theo sổ, không phải số trên website PayPal.</>:ledger.isLoading?'Đang tải tiền…':''}</span>
      {l?.totals?.earnApp&&Object.keys(l.totals.earnApp).length>0&&<span className="text-xs">Thu EarnApp{url.month?' trong tháng':''}: <strong>{Object.entries(l.totals.earnApp).map(([c,v])=>viAmount(v)+' '+c).join(' · ')}</strong>{l.totals.internal&&Object.keys(l.totals.internal).length?<span className="pm-muted"> (không gồm chuyển nội bộ)</span>:null}</span>}
    </div>}
    {ledger.error&&<p role="alert" className="pm-error text-sm mx-4">Chưa tải được tiền PayPal: {ledger.error.message}</p>}
    <div className="pm-table-scroll"><table className="pm-table acc-pp-table"><thead><tr><th>Mã PP</th><th>Email đã dùng / còn dùng được</th>{showMoney&&<><th className="num">Tiền vào</th><th className="num">Tiền ra</th><th className="num">Còn lại theo sổ</th></>}<th>Tình trạng</th><th>Thao tác</th></tr></thead>
      <tbody>{rows.slice(0,500).map(p=>{const m=money.get(p.id),cs=m?.currencies||[],isOpen=url.pp===p.code,canIn=!!r?.writeFunds,canOut=!!r?.writeWithdrawals;
        return <Fragment key={p.id}><tr data-pp={p.code} className={isOpen?'pm-row-focus':undefined}>
          <td data-label="Mã PP" className="whitespace-nowrap">{selected&&<input type="checkbox" className="mr-2" aria-label={'Chọn '+p.code} checked={selected.has(p.id)} onChange={()=>toggle(p.id)}/>}<strong>{p.code}</strong>{p.batch&&<div className="text-xs pm-muted">Lô {p.batch}</div>}</td>
          <td data-label="Email"><button type="button" className="pm-link acc-pp-emails" aria-expanded={isOpen&&url.show==='emails'} onClick={()=>open(p,'emails')}><strong>{p.counts.total-p.counts.NEW}</strong> đã dùng / <strong>{p.counts.NEW}</strong> còn dùng được</button>
            <div className="text-xs pm-muted">{p.counts.ASSIGNED} đang gán{p.counts.HOLD?` · ${p.counts.HOLD} tạm giữ`:''}{p.unknownLinks.length?` · ${p.unknownLinks.length} liên kết cũ chưa rõ email`:''}</div></td>
          {showMoney&&<>
            <td data-label="Tiền vào" className="num">{r?.funds||r?.withdrawals?<MoneyButtons lines={moneyLines(cs,c=>c.in??c.receipts)} onClick={()=>open(p,'in')} label={'Xem tiền vào '+p.code}/>:null}{m?.unknownEmail&&Object.keys(m.unknownEmail).length?<div className="text-xs pm-muted">gồm {Object.entries(m.unknownEmail).map(([c,v])=>viAmount(v)+' '+c).join(', ')} chưa xác định email</div>:null}{r&&!r.withdrawals&&<div className="text-xs pm-muted">chỉ tiền nhận</div>}</td>
            <td data-label="Tiền ra" className="num">{r?.withdrawals?<MoneyButtons lines={moneyLines(cs,c=>c.out)} onClick={()=>open(p,'out')} label={'Xem tiền ra '+p.code}/>:<span className="pm-muted text-xs">Không có quyền xem</span>}{m?.review?<div className="text-xs text-amber-600">{m.review} khoản cũ cần đối chiếu</div>:null}</td>
            <td data-label="Còn lại theo sổ" className="num">{!r?<span className="pm-muted text-xs">{ledger.error?'Không tải được sổ':'Đang tải…'}</span>:r.funds&&r.withdrawals?moneyLines(cs,c=>c.balance).map(x=><div key={x.currency} className={'font-semibold'+(Number(x.value)<0?' text-red-600':'')}>{formatLedger(x.value!,x.currency)}</div>):<span className="pm-muted text-xs">Cần quyền tiền vào và tiền ra</span>}{!cs.length&&r?.funds&&r.withdrawals?<span className="font-semibold">{formatUsd('0')}</span>:null}{(()=>{const g=gatherOf.get(p.id);if(!g)return null;const other=Object.entries(g.pending).filter(([c])=>c!=='USD');return <div className="text-xs">{g.pendingUsd!=='0.00'&&<div className="pm-muted">Chờ về {formatUsd(g.pendingUsd)}</div>}{other.map(([c,v])=><div key={c} className="pm-muted">Chờ về {formatLedger(v,c)}</div>)}{g.gather&&<span className={'acc-gather acc-gather-'+g.gather.state.toLowerCase()} title={g.gather.state==='REACHED'?'Số dư USD theo sổ (đến hôm nay) từ $100,00 trở lên':g.gather.state==='PROJECTED'?'Số dư USD chưa đủ $100,00 (thiếu '+formatUsd(g.gather.missing)+'); cộng tiền còn chờ thì đạt':'Số dư USD cộng tiền còn chờ vẫn dưới $100,00'}>{gatherText(g.gather)}</span>}</div>;})()}</td></>}
          <td data-label="Tình trạng"><div className="flex flex-col gap-1 items-start">{write?<select className="pm-input acc-status-select" aria-label={'Tình trạng '+p.code} value={p.status} disabled={status.busy} onChange={e=>void status.save([p],e.target.value)}>{Object.entries(PP_STATUS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>:PP_STATUS[p.status]}<span className={'acc-state '+p.state}>{PP_STATE[p.state]}</span></div></td>
          <td data-label="Thao tác"><div className="acc-batch-actions">{canIn&&<button type="button" className="pm-button pm-button-quiet" onClick={()=>setForm(form?.pp===p.id&&form.kind==='receipt'?null:{pp:p.id,kind:'receipt'})}>Ghi tiền vào</button>}{canOut&&<button type="button" className="pm-button pm-button-quiet" onClick={()=>setForm(form?.pp===p.id&&form.kind==='transfer'?null:{pp:p.id,kind:'transfer'})}>Ghi chuyển / rút</button>}{write&&<button type="button" className="pm-button pm-button-quiet" onClick={()=>setForm(form?.pp===p.id&&form.kind==='emails'?null:{pp:p.id,kind:'emails'})}>Bổ sung email</button>}</div></td></tr>
          {form?.pp===p.id&&<tr className="acc-batch-detail"><td colSpan={cols}>{form.kind==='receipt'?<ReceiptForm projectId={projectId} pp={p} onClose={()=>setForm(null)} onSaved={refresh}/>:form.kind==='transfer'?<TransferForm projectId={projectId} pp={p} store={store} onClose={()=>setForm(null)} onSaved={refresh}/>:<AddEmails projectId={projectId} pp={p} onClose={()=>setForm(null)} onSaved={refresh}/>}</td></tr>}
          {isOpen&&url.show==='emails'&&<tr className="acc-batch-detail"><td colSpan={cols}><EmailList p={p} received={received} showMoney={!!r?.funds} unknown={m?.unknownEmail||null}/></td></tr>}
          {isOpen&&(url.show==='in'||url.show==='out')&&<tr className="acc-batch-detail"><td colSpan={cols}><Entries projectId={projectId} p={p} direction={url.show==='in'?'IN':'OUT'} month={url.month||null} asOf={url.month?null:url.asof||l?.asOf||null} onClose={()=>open(p,url.show!)}/></td></tr>}
        </Fragment>;})}
        {!rows.length&&<tr><td colSpan={cols} className="pm-empty">{store?'Chưa có PayPal trong bộ lọc này.':'Đang tải…'}</td></tr>}</tbody></table></div>
    {rows.length>500&&<p className="pm-muted text-xs p-3">Hiện 500 / {rows.length} PP; tìm theo mã hoặc email để thu hẹp.</p>}
  </>;
}
function MoneyButtons({lines,onClick,label}:{lines:{currency:string;value:string|null}[];onClick:()=>void;label:string}){
  if(!lines.length)return <span className="pm-muted">{formatUsd('0')}</span>;
  return <button type="button" className="pm-link acc-money-link" aria-label={label} onClick={onClick}>{lines.map(x=><span key={x.currency} className="block">{formatLedger(x.value!,x.currency)}</span>)}</button>;
}
function EmailList({p,received,showMoney,unknown}:{p:Paypal;received:Map<string,Record<string,string>>;showMoney:boolean;unknown:Record<string,string>|null}){
  const copy=async(email:string)=>{try{await navigator.clipboard.writeText(email);toast.success('Đã copy '+email);}catch{toast.error('Không copy được; chọn và copy tay: '+email);}};
  return <div className="space-y-2"><table className="pm-table acc-email-table"><thead><tr><th>Email</th><th>EarnApp / Server / VM</th><th>Tình trạng sử dụng</th>{showMoney&&<th className="num">Tiền đã nhận</th>}</tr></thead><tbody>
    {p.emails.map(e=><tr key={e.id}><td className="whitespace-nowrap"><span className="inline-flex items-center gap-1">{e.email}<button type="button" className="vm-cell-icon" aria-label={'Copy '+e.email} title="Copy email" onClick={()=>void copy(e.email)}><Copy size={13}/></button></span></td>
      <td>{e.earnAppLogin?<>{e.earnAppLogin}{e.place?<> · <Link className="underline" href={vmHref(e.place)}>{e.place.server} / {e.place.vm}</Link></>:<span className="pm-muted"> · chưa trên VM</span>}</>:<span className="pm-muted">—</span>}</td>
      <td><span className={'acc-state '+(e.state==='HOLD'?'BLOCKED':e.state)}>{EMAIL_STATE[e.state]}</span>{e.note&&<div className="text-xs pm-muted">{e.note}</div>}</td>
      {showMoney&&<td className="num">{Object.entries(received.get(e.id)||{}).map(([c,v])=><div key={c}>{viAmount(v)} {c}</div>)}{!received.get(e.id)&&<span className="pm-muted">0</span>}</td>}</tr>)}
    {p.unknownLinks.map((u,i)=><tr key={'u'+i}><td className="pm-muted">Chưa xác định email</td><td>{u.earnAppLogin}{u.place?<> · <Link className="underline" href={vmHref(u.place)}>{u.place.server} / {u.place.vm}</Link></>:null}</td><td><span className="acc-state USED">Liên kết cũ (trước 18/10)</span></td>{showMoney&&<td/>}</tr>)}
    {showMoney&&unknown&&Object.keys(unknown).length>0&&<tr><td className="pm-muted">Chưa xác định email</td><td/><td className="text-xs pm-muted">Khoản nhận cũ không ghi email; tính vào PP, không gắn sang email nào</td><td className="num">{Object.entries(unknown).map(([c,v])=><div key={c}>{viAmount(v)} {c}</div>)}</td></tr>}
  </tbody></table><p className="text-xs pm-muted">Mỗi email nhận cho một EarnApp. Email đã dùng không cấp lại cho EarnApp khác (bỏ gán không đưa về Chưa dùng) nhưng vẫn nhận tiền nhiều lần.</p></div>;
}
function Entries({projectId,p,direction,month,asOf,onClose}:{projectId:string;p:Paypal;direction:'IN'|'OUT';month:string|null;asOf:string|null;onClose:()=>void}){
  // Same range as the number that was clicked (server ledgerRange): the month, or everything up to the cut-off day.
  const q=trpc.accountStore.ledgerEntries.useQuery({projectId,paypalId:p.id,direction,month,asOf:month?null:asOf}),d=q.data;
  const KIND={RECEIPT:'Tiền nhận',OPENING:'Số dư đầu',INTERNAL_IN:'Chuyển nội bộ vào',OUT:'PP bị trừ'} as const,vd=(x:string)=>x.split('-').reverse().join('/');
  const label=direction==='IN'?'Tiền vào':'Tiền ra',skipped=(d?.rows||[]).filter(r=>!r.counted).length;
  return <div className="space-y-2"><div className="flex justify-between items-center gap-2"><strong>{label} · {p.code}{month?' · tháng '+vd(month):d?.asOf?' · đến hết ngày '+vd(d.asOf):''}</strong><button type="button" className="pm-link text-sm" onClick={onClose}>Đóng</button></div>
    {q.error&&<p role="alert" className="pm-error text-sm">{q.error.message}</p>}
    {d&&<p className="text-sm" role="status">Cộng các khoản được tính: <strong>{Object.keys(d.totals).length?Object.entries(d.totals).map(([c,v])=>viAmount(v)+' '+c).join(' · '):'0'}</strong> = số {label} đang xem.{skipped?<span className="pm-muted"> {skipped} khoản chỉ để đối chiếu, không cộng (ghi ở cột Tình trạng).</span>:null}{d.later?<span className="pm-muted"> {d.later} khoản ghi ngày sau {d.asOf?vd(d.asOf):'ngày chốt'} không thuộc phạm vi này.</span>:null}</p>}
    <div className="pm-table-scroll"><table className="pm-table"><thead><tr><th>Ngày</th><th>Loại</th><th className="num">Số tiền</th><th>{direction==='IN'?'Email / VM · từ PP':'Sang PP'}</th>{direction==='OUT'&&<><th className="num">Phí (trong tổng)</th><th>Bên nhận thực nhận</th></>}<th>Tình trạng</th><th>Mã GD</th></tr></thead><tbody>
      {(d?.rows||[]).map(r=><tr key={r.kind+r.id} data-counted={r.counted?'1':'0'} className={r.counted?undefined:'pm-muted'}><td className="whitespace-nowrap">{vd(r.date)}</td><td>{KIND[r.kind]}</td><td className="num">{r.counted?null:<span className="text-xs">(không cộng) </span>}{viAmount(r.amount)} {r.currency}</td>
        <td>{r.email||r.other||<span className="pm-muted">{r.kind==='RECEIPT'?'Chưa xác định email':'—'}</span>}{r.place&&<div className="text-xs pm-muted">{r.place}</div>}</td>
        {direction==='OUT'&&<><td className="num">{r.fee?r.fee.replace(/^[\d.]+/,v=>viAmount(v)):'—'}</td><td className="whitespace-nowrap">{r.received?r.received.replace(/^[\d.]+/,v=>viAmount(v)):'—'}</td></>}
        <td>{r.status}{r.role&&<div className="text-xs">{r.role}</div>}{r.review&&<div className="text-xs text-amber-600">{r.review}</div>}</td><td className="text-xs">{r.transactionId||<span className="pm-muted">không có</span>}</td></tr>)}
      {d&&!d.rows.length&&<tr><td colSpan={8} className="pm-empty">Không có giao dịch.</td></tr>}{q.isLoading&&<tr><td colSpan={8} className="pm-empty">Đang tải…</td></tr>}
    </tbody></table></div><p className="text-xs pm-muted">Chỉ khoản Đã nhận, chưa thu hồi được cộng; số dư đầu kỳ tính ở Còn lại theo sổ. Sửa hoặc thu hồi ở <Link className="underline" href={direction==='IN'?links.paypalIn():links.originalWithdrawals(true)}>{direction==='IN'?'Tiền vào PayPal':'Rút / chuyển gốc'}</Link>; mọi nơi đọc cùng sổ.</p></div>;
}
// Ghi tiền vào: choose day, currency and status once, paste "Email | Số tiền | Mã giao dịch"; lines are checked while typing (no
// write), errors and possible duplicates stay at their line, one click records the valid ones. The request key belongs to the
// content; an unanswered save keeps key and content until retried.
function ReceiptForm({projectId,pp,onClose,onSaved}:{projectId:string;pp:Paypal;onClose:()=>void;onSaved:()=>void}){
  const [date,setDate]=useState(today()),[currency,setCurrency]=useState('USD'),[statusV,setStatus]=useState<'RECEIVED'|'PENDING'>('RECEIVED'),[text,setText]=useState(''),[distinct,setDistinct]=useState<number[]>([]);
  const [opening,setOpening]=useState(false),[openAmount,setOpenAmount]=useState('');
  const check=trpc.accountStore.receiptCheck.useMutation(),record=trpc.accountStore.receiptRecord.useMutation(),open=trpc.accountStore.openingRecord.useMutation();
  type Checked=inferRouterOutputs<AppRouter>['accountStore']['receiptCheck'];
  const input={projectId,paypalId:pp.id,date,currency,status:statusV,text,distinct};const sig=JSON.stringify(input);
  const [result,setResult]=useState<{sig:string;data:Checked}|null>(null),[err,setErr]=useState(''),[keyFor,setKeyFor]=useState<{sig:string;key:string}|null>(null),[uncertain,setUncertain]=useState(false),seq=useRef(0);
  useEffect(()=>{if(uncertain)return;setErr('');if(!text.trim()){setResult(null);return;}const n=++seq.current,t=setTimeout(async()=>{try{const d=await check.mutateAsync(JSON.parse(sig));if(n===seq.current)setResult({sig,data:d});}catch(e){if(n===seq.current){setResult(null);setErr(errorMessage(e));}}},350);return ()=>clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sig,uncertain]);
  const fresh=result?.sig===sig?result.data:null;
  async function save(){
    if(!fresh||!fresh.ready)return;const key=keyFor?.sig===sig?keyFor.key:crypto.randomUUID();setKeyFor({sig,key});
    try{const r=await record.mutateAsync({...JSON.parse(sig),key});setUncertain(false);setKeyFor(null);
      toast.success(`Đã ghi ${r.saved} khoản vào ${r.code}`+(r.suspect||r.errors?` · còn ${r.suspect+r.errors} dòng cần xem`:''));
      const keep=new Set(r.rows.filter(x=>x.outcome!=='APPLIED').map(x=>x.line));setText(text.replace(/\r/g,'').split('\n').filter((_,i)=>keep.has(i+1)).join('\n'));setDistinct([]);onSaved();}
    catch(e){setUncertain(true);setErr(errorMessage(e)+' · Chưa rõ đã ghi hay chưa. Bấm "Thử lại" (cùng yêu cầu, không ghi hai lần).');}
  }
  return <div className="space-y-2" aria-label={'Ghi tiền vào '+pp.code}>
    <div className="flex justify-between items-center gap-2 flex-wrap"><strong>Ghi tiền vào · {pp.code}</strong><button type="button" className="pm-link text-sm" onClick={()=>setOpening(!opening)}>{opening?'Ghi tiền nhận':'Ghi số dư đầu kỳ'}</button></div>
    <div className="flex gap-2 flex-wrap items-end">
      <label className="pm-label text-xs">Ngày<input type="date" className="pm-input" value={date} disabled={uncertain} onChange={e=>setDate(e.target.value)}/></label>
      <label className="pm-label text-xs">Đồng tiền<input className="pm-input w-24" list="pp-currencies" value={currency} disabled={uncertain} onChange={e=>setCurrency(e.target.value.toUpperCase().slice(0,5))}/><datalist id="pp-currencies">{CURRENCIES.map(c=><option key={c}>{c}</option>)}</datalist></label>
      {!opening&&<label className="pm-label text-xs">Tình trạng<select className="pm-input" value={statusV} disabled={uncertain} onChange={e=>setStatus(e.target.value as typeof statusV)}><option value="RECEIVED">Đã nhận (cộng vào tiền vào)</option><option value="PENDING">Chờ nhận (chưa cộng)</option></select></label>}
      {opening&&<label className="pm-label text-xs">Số dư đầu<input className="pm-input w-32" inputMode="decimal" value={openAmount} onChange={e=>setOpenAmount(e.target.value)}/></label>}
    </div>
    {opening?<><p className="text-xs pm-muted">Số tiền đã có trên PP khi bắt đầu ghi sổ. Tính vào số dư, không tính là thu EarnApp. Một số dư đầu cho mỗi đồng tiền.</p>
      <div className="flex gap-2 justify-end"><button type="button" className="pm-button pm-button-quiet" onClick={onClose}>Đóng</button><button type="button" className="pm-button pm-button-primary" disabled={open.isLoading||!openAmount.trim()} onClick={()=>void open.mutateAsync({projectId,paypalId:pp.id,date,currency,amount:openAmount.trim(),key:crypto.randomUUID()}).then(()=>{toast.success('Đã ghi số dư đầu '+pp.code);setOpenAmount('');onSaved();},e=>toast.error(errorMessage(e)))}>Ghi số dư đầu</button></div></>
    :<><textarea className="pm-input pm-paste" rows={4} aria-label={'Danh sách tiền nhận '+pp.code} disabled={uncertain} value={text} placeholder={(pp.emails[0]?.email||'email@example.invalid')+' | 24 | 5JX12345AB'} onChange={e=>{setText(e.target.value);setDistinct([]);}}/>
    <p className="text-xs pm-muted">Mỗi dòng: Email | Số tiền PP thực nhận | Mã giao dịch (nếu có). Email phải thuộc {pp.code}. Ghi tiền không tự gán tài khoản hay xác nhận đăng ký EarnApp.</p>
    {text.trim()&&!fresh&&!uncertain&&!err&&<p className="text-sm pm-muted" role="status">Đang kiểm tra…</p>}
    {fresh&&<><p className="text-sm" role="status"><strong>{fresh.ready}</strong> hợp lệ · tổng <strong>{viAmount(fresh.total)} {fresh.currency}</strong>{fresh.suspect?<> · <span className="text-amber-600">{fresh.suspect} nghi trùng</span></>:null} · <span className={fresh.errors?'text-red-600':''}>{fresh.errors} cần sửa</span></p>
      <div className="vm-bulk-table"><table className="pm-table"><thead><tr><th>Dòng</th><th>Email</th><th className="num">Số tiền</th><th>Kết quả</th></tr></thead><tbody>{fresh.rows.map(x=><tr key={x.line} className={x.outcome==='ERROR'?'pm-row-blocked':''}><td className="pm-muted">{x.line}</td><td>{x.email}</td><td className="num">{x.amount?viAmount(x.amount):'—'}</td>
        <td className={x.outcome==='ERROR'?'text-red-600':x.outcome==='SUSPECT'?'text-amber-600':'text-green-700'}>{x.message}{x.outcome==='SUSPECT'&&<> <button type="button" className="pm-button pm-button-quiet" onClick={()=>setDistinct([...distinct,x.line])}>Khoản riêng</button></>}</td></tr>)}</tbody></table></div></>}
    {err&&<p role="alert" className="pm-error text-sm">{err}</p>}
    <div className="flex gap-2 justify-end"><button type="button" className="pm-button pm-button-quiet" disabled={record.isLoading} onClick={onClose}>Đóng</button>
      {uncertain?<button type="button" className="pm-button pm-button-primary" disabled={record.isLoading} onClick={()=>void save()}>{record.isLoading?'Đang gửi lại…':'Thử lại'}</button>
      :<button type="button" className="pm-button pm-button-primary" disabled={record.isLoading||!fresh?.ready} onClick={()=>void save()}>{record.isLoading?'Đang ghi…':fresh?.ready?`Ghi ${fresh.ready} khoản (${viAmount(fresh.total)} ${fresh.currency})`:'Ghi tiền vào'}</button>}</div></>}
  </div>;
}
// Ghi chuyển / rút from this PayPal: "PP bị trừ" is the total debited, fee included (never subtracted again). The amounts follow the
// one rule shared with the server (lib/paypal-transfer.ts): received = round((debited − fee) × rate, 2) − receiver fee. While the
// person has not typed the received amount it is computed live from the other fields (never a stale number); once typed it is
// theirs and is only checked, the error at the field says what it should be. No confirm dialog; the content stays on error.
function TransferForm({projectId,pp,store,onClose,onSaved}:{projectId:string;pp:Paypal;store:Store|undefined;onClose:()=>void;onSaved:()=>void}){
  const [type,setType]=useState<'EXCHANGE'|'MIXING'>('EXCHANGE'),[date,setDate]=useState(today()),[currency,setCurrency]=useState('USD'),[debited,setDebited]=useState(''),[fee,setFee]=useState(''),[dest,setDest]=useState(''),[received,setReceived]=useState(''),[auto,setAuto]=useState(true),[recvCur,setRecvCur]=useState(''),[rate,setRate]=useState(''),[recvFee,setRecvFee]=useState(''),[txid,setTxid]=useState(''),[notes,setNotes]=useState(''),[distinct,setDistinct]=useState(false);
  const save=trpc.accountStore.transferRecord.useMutation(),[err,setErr]=useState(''),[keyFor,setKeyFor]=useState<{sig:string;key:string}|null>(null),[uncertain,setUncertain]=useState(false);
  const destCode=store?.paypals.find(x=>x.id===dest)?.code;
  const {rc,same,computed,autoOn,shown,sent,errors:e,payload}=transferDraft({type,currency,recvCur,debited,fee,rate,recvFee,received,auto}),hasErr=Object.keys(e).length>0;
  const input={projectId,paypalId:pp.id,type,date,currency,debited:debited.trim(),fee:fee.trim()||null,destPaypalId:type==='MIXING'?dest||null:null,...payload,transactionId:txid.trim()||null,notes:notes.trim()||null,distinct};const sig=JSON.stringify(input);
  async function run(){
    if(hasErr)return;const key=keyFor?.sig===sig?keyFor.key:crypto.randomUUID();setKeyFor({sig,key});setErr('');
    try{await save.mutateAsync({...input,key});toast.success('Đã ghi '+(type==='MIXING'?'chuyển nội bộ':'rút / chuyển')+' từ '+pp.code);setUncertain(false);onSaved();onClose();}
    catch(x){const m=errorMessage(x),code=(x as {data?:{code?:string}})?.data?.code,known=!!code&&code!=='INTERNAL_SERVER_ERROR'&&code!=='TIMEOUT';setUncertain(!known);setErr(m+(known?'':' · Chưa rõ đã ghi hay chưa; bấm Lưu lại với cùng nội dung (không ghi hai lần).'));}
  }
  const lock=save.isLoading||uncertain,fe=(k:keyof typeof e,show=true)=>show&&e[k]?<span className="text-xs text-red-600" role="alert">{e[k]}</span>:null;
  const typedReceived=!autoOn&&!!received.trim();
  return <div className="space-y-2" aria-label={'Ghi chuyển / rút '+pp.code}><strong>Ghi chuyển / rút · từ {pp.code}</strong>
    <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Loại">{([['EXCHANGE','Rút / chuyển ra ngoài'],['MIXING','Chuyển nội bộ sang PP khác']] as const).map(([k,v])=><button key={k} type="button" role="radio" aria-checked={type===k} disabled={lock} className={'pm-button'+(type===k?' pm-button-primary':'')} onClick={()=>setType(k)}>{v}</button>)}</div>
    <div className="acc-import-grid">
      <label className="pm-label text-xs">Ngày<input type="date" className="pm-input" value={date} disabled={lock} onChange={x=>setDate(x.target.value)}/></label>
      <label className="pm-label text-xs">Đồng tiền PP nguồn<input className="pm-input" list="pp-currencies" value={currency} disabled={lock} onChange={x=>setCurrency(x.target.value.toUpperCase().slice(0,5))}/></label>
      <label className="pm-label text-xs">Tổng PP bị trừ (gồm phí)<input className="pm-input" inputMode="decimal" aria-invalid={!!debited&&!!e.debited} value={debited} disabled={lock} onChange={x=>setDebited(x.target.value)}/>{fe('debited',!!debited)}</label>
      <label className="pm-label text-xs">Phí nguồn (đã nằm trong tổng, {currency})<input className="pm-input" inputMode="decimal" placeholder="0" aria-invalid={!!e.fee} value={fee} disabled={lock} onChange={x=>setFee(x.target.value)}/>{fe('fee')}</label>
      {type==='MIXING'&&<label className="pm-label text-xs">PP nhận<select className="pm-input" value={dest} disabled={lock} onChange={x=>setDest(x.target.value)}><option value="">Chọn PP nhận</option>{(store?.paypals||[]).filter(x=>x.id!==pp.id).map(x=><option key={x.id} value={x.id}>{x.code}</option>)}</select></label>}
      <label className="pm-label text-xs">Đồng tiền bên nhận<input className="pm-input" list="pp-currencies" value={recvCur||currency} disabled={lock} onChange={x=>setRecvCur(x.target.value.toUpperCase().slice(0,5))}/></label>
      {!same&&<label className="pm-label text-xs">Tỷ giá thực dùng: 1 {currency} = ? {rc}<input className="pm-input" inputMode="decimal" aria-invalid={!!e.rate} value={rate} disabled={lock} onChange={x=>setRate(x.target.value)}/>{fe('rate',!!rate||sent||(type==='MIXING'||!!recvFee.trim())&&!!debited&&!e.debited)}</label>}
      {same&&fe('rate')}
      <label className="pm-label text-xs">Phí bên nhận (nếu có, {rc})<input className="pm-input" inputMode="decimal" placeholder="0" aria-invalid={!!e.receiverFee} value={recvFee} disabled={lock} onChange={x=>setRecvFee(x.target.value)}/>{fe('receiverFee')}</label>
      <label className="pm-label text-xs">{type==='MIXING'?'Bên nhận thực nhận':'Bên nhận thực nhận (nếu biết)'}<input className="pm-input" inputMode="decimal" aria-label="Bên nhận thực nhận" aria-invalid={!!e.received&&(sent||!!debited)} value={shown} disabled={lock} onChange={x=>{setReceived(x.target.value);setAuto(!x.target.value.trim());}}/>
        {autoOn&&computed?<span className="text-xs pm-muted">Tự tính từ tổng − phí{same?'':' × tỷ giá'}{recvFee.trim()?' − phí bên nhận':''}; gõ số khác nếu thực nhận khác</span>:null}
        {fe('received',sent||(type==='MIXING'||!!recvFee.trim())&&!!debited&&!e.debited)}
        {typedReceived&&computed&&received.trim()!==computed&&e.received?<button type="button" className="pm-link text-xs self-start" disabled={lock} onClick={()=>{setReceived('');setAuto(true);}}>Dùng số tính được ({viAmount(computed)} {rc})</button>:null}</label>
      <label className="pm-label text-xs">Mã giao dịch (nếu có)<input className="pm-input" value={txid} disabled={lock} onChange={x=>setTxid(x.target.value)}/></label>
      <label className="pm-label text-xs">Ghi chú<input className="pm-input" value={notes} disabled={lock} onChange={x=>setNotes(x.target.value)}/></label>
    </div>
    <p className="text-sm" aria-live="polite">{debited&&!e.debited?<>{pp.code} bị trừ <strong>{viAmount(debited.replace(',','.'))} {currency}</strong>{fee&&!e.fee?<> (gồm phí {viAmount(fee.replace(',','.'))})</>:null}{sent&&!e.received?<> · {type==='MIXING'?destCode||'PP nhận':'bên nhận'} nhận <strong>{viAmount(shown.replace(',','.'))} {rc}</strong></>:null}. Số dư {pp.code} giảm đúng một lần số bị trừ.</>:'Nhập tổng PP bị trừ.'}</p>
    {err&&<p role="alert" className="pm-error text-sm">{err}{/khoản riêng/.test(err)&&!distinct&&<> <button type="button" className="pm-button pm-button-quiet" onClick={()=>{setDistinct(true);setErr('');}}>Đây là khoản riêng</button></>}</p>}
    <p className="text-xs pm-muted">PP đã bị trừ không có nghĩa collector / team đã nhận; nhận về team ghi ở Nhận USDT về team.</p>
    <div className="flex gap-2 justify-end"><button type="button" className="pm-button pm-button-quiet" disabled={save.isLoading} onClick={onClose}>Đóng</button><button type="button" className="pm-button pm-button-primary" disabled={save.isLoading||hasErr||type==='MIXING'&&!dest} onClick={()=>void run()}>{save.isLoading?'Đang lưu…':uncertain?'Lưu lại (cùng yêu cầu)':'Lưu'}</button></div>
  </div>;
}
// Bổ sung email: more receiving emails for this PayPal. Not a purchase: no batch, no cost. Same emails again change nothing.
function AddEmails({projectId,pp,onClose,onSaved}:{projectId:string;pp:Paypal;onClose:()=>void;onSaved:()=>void}){
  const [text,setText]=useState(''),add=trpc.accountStore.addEmails.useMutation(),[rows,setRows]=useState<{email:string;outcome:string;message:string}[]|null>(null),[keyFor,setKeyFor]=useState<{sig:string;key:string}|null>(null);
  const emails=useMemo(()=>[...new Set(text.split(/[\s|,;]+/).map(s=>s.trim().toLowerCase()).filter(Boolean))],[text]),bad=emails.filter(e=>!/^[^\s@|:\t]+@[^\s@|:\t]+\.[^\s@|:\t]+$/.test(e)),sig=emails.join(' ');
  async function run(){const key=keyFor?.sig===sig?keyFor.key:crypto.randomUUID();setKeyFor({sig,key});
    try{const r=await add.mutateAsync({projectId,paypalId:pp.id,emails,key});setRows(r.rows);toast.success(`Đã bổ sung ${r.applied} email vào ${pp.code}`+(r.errors?` · ${r.errors} bị chặn`:''));setText(r.rows.filter(x=>x.outcome==='ERROR').map(x=>x.email).join('\n'));setKeyFor(null);onSaved();}
    catch(e){toast.error(errorMessage(e)+' · bấm lại với cùng nội dung để thử, không thêm hai lần');}}
  return <div className="space-y-2" aria-label={'Bổ sung email '+pp.code}><strong>Bổ sung email · {pp.code}</strong>
    <textarea className="pm-input pm-paste" rows={3} aria-label={'Email bổ sung cho '+pp.code} value={text} disabled={add.isLoading} placeholder="email1@example.invalid email2@example.invalid" onChange={e=>{setText(e.target.value);setRows(null);}}/>
    <p className="text-xs" role="status">{emails.length?<>{emails.length-bad.length} email hợp lệ{bad.length?<span className="text-red-600"> · sai: {bad.slice(0,3).join(', ')}</span>:null}. Email đã thuộc PP khác hoặc dự án khác bị chặn khi lưu. Không tạo lần mua hay chi phí.</>:<span className="pm-muted">Dán các email nhận tiền của {pp.code}, cách nhau bằng khoảng trắng hoặc xuống dòng.</span>}</p>
    {rows&&<ul className="text-xs">{rows.map(x=><li key={x.email} className={x.outcome==='ERROR'?'text-red-600':x.outcome==='SKIP'?'pm-muted':'text-green-700'}>{x.email}: {x.message}</li>)}</ul>}
    <div className="flex gap-2 justify-end"><button type="button" className="pm-button pm-button-quiet" onClick={onClose}>Đóng</button><button type="button" className="pm-button pm-button-primary" disabled={add.isLoading||!emails.length||bad.length>0} onClick={()=>void run()}>{add.isLoading?'Đang lưu…':`Bổ sung ${emails.length} email`}</button></div>
  </div>;
}
