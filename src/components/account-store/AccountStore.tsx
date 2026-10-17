"use client";
import {useMemo,useState} from 'react';
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import toast from 'react-hot-toast';
import {Copy,Search} from 'lucide-react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {errorMessage} from '@/components/vm-management/shared';
import {AccountCopy} from '@/components/business-management/AccountsWorkspace';
import {ImportPanel,type AppendTarget,type StockKind} from './ImportPanel';
type Store=inferRouterOutputs<AppRouter>['accountStore']['store'];
type Login=Store['logins'][number];type Paypal=Store['paypals'][number];type Batch=Store['batches'][number];
type Tab='login'|'paypal'|'batch'|'review';
const STATE_LABEL:Record<string,string>={NEW:'NEW · chưa gán',ASSIGNED:'Đã gán',USED:'Đã dùng · chưa gán',BLOCKED:'Lỗi / ngừng dùng'};
const LOGIN_STATUS:Record<string,string>={ACTIVE:'Dùng được',SUSPENDED:'Bị khoá tạm',NEEDS_RECOVERY:'Cần khôi phục',NEEDS_2FA_UPDATE:'Cần cập nhật 2FA',BLOCKED:'Bị chặn',DISABLED:'Ngừng dùng'};
const PP_STATUS:Record<string,string>={ACTIVE:'Dùng được',LIMITED:'Bị limit',SUSPENDED:'Bị suspend',CLOSED:'Đã đóng',PENDING_VERIFY:'Chờ xác minh'};
const TYPE:Record<string,string>={GMAIL:'Gmail',APPLE_ID:'Apple ID'};
const money=(v:string|null|undefined)=>v?v.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''):'';
const vmHref=(p:{serverId:string;vmId:string})=>`/infrastructure/servers/${p.serverId}?vm=${p.vmId}&tab=account`;
// Kho tài khoản: Gmail / Apple ID login stock, PayPal stock (the same PayPal records as before), purchase batches and a review list
// of old data that conflicts with the new rules. Stock state (NEW / Đã gán / Đã dùng / Lỗi) is computed from the current EarnApp
// links. Assigning to VMs happens in Server/VM (cell, bulk, Dán bảng); this page receives, checks and maintains the stock.
export function AccountStore({projectId,initialTab}:{projectId:string;initialTab?:Tab}){
  const params=useSearchParams(),router=useRouter(),path=usePathname(),store=trpc.accountStore.store.useQuery({projectId}),utils=trpc.useUtils();
  const tab=(['login','paypal','batch','review'].includes(params.get('tab')||'')?params.get('tab'):initialTab||'login') as Tab;
  const q=params.get('q')||'',type=params.get('type')||'',state=params.get('state')||'',batch=params.get('batch')||'';
  const [importing,setImporting]=useState<{kind:StockKind;append?:AppendTarget}|null>(params.get('import')?{kind:tab==='paypal'?'PAYPAL':'LOGIN'}:null),[selected,setSelected]=useState<Set<string>>(new Set()),[copy,setCopy]=useState<Login|null>(null);
  const go=(patch:Record<string,string>)=>{const next=new URLSearchParams(params.toString());for(const [k,v] of Object.entries(patch)){if(v)next.set(k,v);else next.delete(k);}next.delete('import');router.replace(path+(next.toString()?'?'+next:''),{scroll:false});setSelected(new Set());};
  const refresh=()=>Promise.all([utils.accountStore.invalidate(),utils.businessManagement.invalidate()]);
  const data=store.data,rights=data?.rights,needle=q.trim().toLowerCase();
  const logins=useMemo(()=>(data?.logins||[]).filter(l=>(!type||l.type===type)&&(!state||l.state===state)&&(!batch||l.batch===batch)&&(!needle||[l.email,l.notes,l.batch,l.place?.server,l.place?.vm,l.earnApp?.paypal].join(' ').toLowerCase().includes(needle))),[data,type,state,batch,needle]);
  const paypals=useMemo(()=>(data?.paypals||[]).filter(p=>(!state||p.state===state)&&(!batch||p.batch===batch)&&(!needle||[p.code,p.email,p.notes,p.batch,p.place?.server,p.place?.vm,p.earnAppLogin].join(' ').toLowerCase().includes(needle))),[data,state,batch,needle]);
  const counts=(rows:{state:string}[])=>Object.fromEntries(['NEW','ASSIGNED','USED','BLOCKED'].map(s=>[s,rows.filter(r=>r.state===s).length]));
  const base=tab==='paypal'?data?.paypals||[]:(data?.logins||[]).filter(l=>!type||l.type===type),stateCounts=counts(base);
  if(store.error)return <p role="alert" className="pm-error">{store.error.message}</p>;
  return <div className="proxy-workspace space-y-4">
    <div className="pm-heading"><div><h1>Kho tài khoản</h1><p className="pm-muted">Gmail / Apple ID NEW chưa dùng đăng ký EarnApp và PayPal nhận tiền. Gán cho VM ngay tại bảng <Link className="underline" href="/infrastructure/servers">Server / VM</Link>; một VM một tài khoản EarnApp, một PayPal riêng.</p></div>
      <div className="flex gap-2 flex-wrap">{tab!=='paypal'&&rights?.writeLogins&&<button className="pm-button pm-button-primary" onClick={()=>setImporting({kind:'LOGIN'})}>Nhập Gmail / Apple ID</button>}{(tab==='paypal'||tab==='batch')&&rights?.writePaypals&&<button className="pm-button pm-button-primary" onClick={()=>setImporting({kind:'PAYPAL'})}>Nhập PayPal</button>}</div></div>
    <div className="vm-kind-tabs" role="tablist" aria-label="Nhóm tài khoản">{([['login','Gmail / Apple ID',data?.logins.length],['paypal','PayPal',data?.paypals.length],['batch','Lô nhập',data?.batches.length],['review','Cần kiểm tra',data?.review.length]] as [Tab,string,number|undefined][]).filter(([k])=>k!=='login'||rights?.logins!==false).map(([k,label,n])=><button key={k} type="button" role="tab" aria-selected={tab===k} className={tab===k?'active':''} onClick={()=>go({tab:k,state:'',type:'',batch:''})}>{label}{n!==undefined?` (${n})`:''}</button>)}</div>
    {importing&&<ImportPanel key={importing.kind+(importing.append?.id||'')} projectId={projectId} kind={importing.kind} append={importing.append} canCost={!!rights?.writeCosts} onDone={()=>void refresh()} onClose={()=>setImporting(null)}/>}
    {(tab==='login'||tab==='paypal')&&<div className="pm-surface">
      <div className="pm-actions flex-wrap gap-2">
        <label className="pm-search vm-search"><Search size={16}/><input aria-label="Tìm tài khoản" placeholder={tab==='paypal'?'Tìm mã PP, email, VM…':'Tìm email, lô, VM, PayPal…'} value={q} onChange={e=>go({q:e.target.value})}/></label>
        {tab==='login'&&<div className="vm-chips">{['','GMAIL','APPLE_ID'].map(t=><button key={t} type="button" className={'vm-chip'+(type===t?' active':'')} onClick={()=>go({type:t})}>{t?TYPE[t]:'Tất cả loại'}</button>)}</div>}
        <div className="vm-chips">{['','NEW','ASSIGNED','USED','BLOCKED'].map(s=><button key={s} type="button" className={'vm-chip'+(state===s?' active':'')} onClick={()=>go({state:s})}>{s?STATE_LABEL[s]:'Tất cả'}{s?<strong>{stateCounts[s]}</strong>:null}</button>)}</div>
        {batch&&<button className="vm-chip active" onClick={()=>go({batch:''})}>Lô {batch} ✕</button>}
      </div>
      {tab==='login'?<LoginTable projectId={projectId} rows={logins} store={data} selected={selected} setSelected={setSelected} onCopy={setCopy} onBatch={b=>go({batch:b})} onSaved={()=>void refresh()}/>:<PaypalTable projectId={projectId} rows={paypals} store={data} selected={selected} setSelected={setSelected} onBatch={b=>go({batch:b})} onSaved={()=>void refresh()}/>}
    </div>}
    {tab==='batch'&&<BatchTable projectId={projectId} rows={data?.batches||[]} store={data} onContinue={b=>setImporting({kind:b.kind as StockKind,append:{id:b.id,code:b.code,type:b.type}})} onOpen={b=>go({tab:b.kind==='PAYPAL'?'paypal':'login',batch:b.code})} onSaved={()=>void refresh()}/>}
    {tab==='review'&&<div className="pm-surface p-4 space-y-2"><p className="text-sm pm-muted">Dữ liệu cũ mâu thuẫn với quy tắc mới (một VM một tài khoản, một PayPal một EarnApp). Web không tự ghép hay xoá; người vận hành kiểm tra và gán lại tại bảng Server / VM.</p>
      {data?.review.length?<ul className="space-y-1">{data.review.map((r,i)=><li key={i} className="text-sm">{r.message}{r.place&&<> · <Link className="underline" href={vmHref(r.place)}>{r.place.server} / {r.place.vm}</Link></>}</li>)}</ul>:<p className="text-sm">{store.isLoading?'Đang tải…':'Không có dữ liệu cần kiểm tra.'}</p>}</div>}
    {copy&&<AccountCopy projectId={projectId} kind="GMAIL" row={copy as never} onClose={()=>setCopy(null)}/>}
  </div>;
}
function StateCell({state,place,extra}:{state:string;place:{serverId:string;vmId:string;server:string;vm:string}|null;extra?:string|null}){
  return <span className="flex flex-col gap-1 items-start"><span className={'acc-state '+state}>{STATE_LABEL[state]}</span>{place&&<Link className="text-xs underline whitespace-nowrap" href={vmHref(place)}>{place.server} / {place.vm}</Link>}{extra&&<span className="text-xs pm-muted">{extra}</span>}</span>;
}
// Status saves on pick (same value = nothing written). Many rows: select them and apply one status.
function useStatus(projectId:string,kind:'LOGIN'|'PAYPAL',onSaved:()=>void){
  const m=trpc.accountStore.setStatus.useMutation();
  return {busy:m.isLoading,save:async(items:{id:string;revision:number}[],status:string)=>{try{const r=await m.mutateAsync({projectId,kind,status,items:items.map(i=>({id:i.id,expectedRevision:i.revision})),key:crypto.randomUUID()});const bad=r.rows.filter(x=>x.outcome==='ERROR');if(bad.length)toast.error(bad.length+' dòng chưa lưu: '+bad[0].message);else if(r.applied)toast.success('Đã lưu '+r.applied+' tài khoản');onSaved();}catch(e){toast.error(errorMessage(e));}}};
}
function BulkStatus({count,options,busy,onApply}:{count:number;options:Record<string,string>;busy:boolean;onApply:(s:string)=>void}){
  const [s,setS]=useState('');if(!count)return null;
  return <div className="pm-actions gap-2 flex-wrap"><span className="text-sm">{count} đã chọn</span><select className="pm-input w-auto" aria-label="Tình trạng cho các dòng đã chọn" value={s} onChange={e=>setS(e.target.value)}><option value="">Đổi tình trạng…</option>{Object.entries(options).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><button className="pm-button" disabled={!s||busy} onClick={()=>onApply(s)}>Áp dụng</button></div>;
}
function useSelection(rows:{id:string}[],selected:Set<string>,setSelected:(s:Set<string>)=>void){
  const all=rows.length>0&&rows.every(r=>selected.has(r.id));
  return {all,toggleAll:()=>setSelected(all?new Set():new Set(rows.map(r=>r.id))),toggle:(id:string)=>{const n=new Set(selected);if(n.has(id))n.delete(id);else n.add(id);setSelected(n);}};
}
function LoginTable({projectId,rows,store,selected,setSelected,onCopy,onBatch,onSaved}:{projectId:string;rows:Login[];store:Store|undefined;selected:Set<string>;setSelected:(s:Set<string>)=>void;onCopy:(l:Login)=>void;onBatch:(b:string)=>void;onSaved:()=>void}){
  const status=useStatus(projectId,'LOGIN',onSaved),sel=useSelection(rows,selected,setSelected),write=!!store?.rights.writeLogins,shown=rows.slice(0,500);
  return <><BulkStatus count={selected.size} options={LOGIN_STATUS} busy={status.busy} onApply={s=>void status.save(rows.filter(r=>selected.has(r.id)),s).then(()=>setSelected(new Set()))}/>
    <div className="pm-table-scroll"><table className="pm-table"><thead><tr>{write&&<th><input type="checkbox" aria-label="Chọn tất cả" checked={sel.all} onChange={sel.toggleAll}/></th>}<th>Tài khoản</th><th>Loại</th><th>Kho / VM</th><th>PayPal của EarnApp</th><th>Tình trạng</th><th>Lô</th>{store?.rights.money&&<th>Giá phân bổ</th>}<th>Ghi chú</th></tr></thead>
      <tbody>{shown.map(l=><tr key={l.id}>{write&&<td><input type="checkbox" aria-label={'Chọn '+l.email} checked={selected.has(l.id)} onChange={()=>sel.toggle(l.id)}/></td>}
        <td className="whitespace-nowrap"><span className="inline-flex items-center gap-1"><strong>{l.email}</strong>{store?.rights.copy&&l.credentialsAvailable&&<button type="button" className="vm-cell-icon" aria-label={'Copy đăng nhập '+l.email} title="Copy đăng nhập (cần PIN)" onClick={()=>onCopy(l)}><Copy size={13}/></button>}</span></td>
        <td>{l.type?TYPE[l.type]:<span className="text-red-600 text-xs">Chưa chọn loại</span>}</td>
        <td><StateCell state={l.state} place={l.place} extra={l.earnApp?.registeredAt?'Đã ghi đăng ký EarnApp':null}/></td>
        <td>{l.earnApp?.paypal||<span className="pm-muted">—</span>}</td>
        <td>{write?<select className="pm-input acc-status-select" aria-label={'Tình trạng '+l.email} value={l.status} disabled={status.busy} onChange={e=>void status.save([l],e.target.value)}>{Object.entries(LOGIN_STATUS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>:LOGIN_STATUS[l.status]}</td>
        <td className="whitespace-nowrap">{l.batch?<button className="underline text-xs" onClick={()=>onBatch(l.batch!)}>{l.batch}</button>:<span className="pm-muted">—</span>}</td>
        {store?.rights.money&&<td className="text-xs">{l.price?`${money(l.price.amount)} ${l.price.currency}`:<span className="pm-muted">Chưa ghi chi phí</span>}</td>}
        <td className="max-w-xs text-xs whitespace-pre-wrap">{l.notes||''}</td></tr>)}
        {!rows.length&&<tr><td colSpan={9} className="pm-empty">{store?'Chưa có tài khoản trong bộ lọc này.':'Đang tải…'}</td></tr>}</tbody></table></div>
    {rows.length>shown.length&&<p className="pm-muted text-xs p-3">Hiện 500 / {rows.length} dòng; dùng ô tìm hoặc bộ lọc để thu hẹp.</p>}
    {store?.rights.money&&<p className="pm-muted text-xs p-3">Giá phân bổ chỉ để tham khảo: tiền thực trả đã ghi một lần trong Chi phí theo lô, không cộng thêm vào lợi nhuận.</p>}</>;
}
function PaypalTable({projectId,rows,store,selected,setSelected,onBatch,onSaved}:{projectId:string;rows:Paypal[];store:Store|undefined;selected:Set<string>;setSelected:(s:Set<string>)=>void;onBatch:(b:string)=>void;onSaved:()=>void}){
  const status=useStatus(projectId,'PAYPAL',onSaved),sel=useSelection(rows,selected,setSelected),write=!!store?.rights.writePaypals,shown=rows.slice(0,500);
  return <><BulkStatus count={selected.size} options={PP_STATUS} busy={status.busy} onApply={s=>void status.save(rows.filter(r=>selected.has(r.id)),s).then(()=>setSelected(new Set()))}/>
    <div className="pm-table-scroll"><table className="pm-table"><thead><tr>{write&&<th><input type="checkbox" aria-label="Chọn tất cả" checked={sel.all} onChange={sel.toggleAll}/></th>}<th>Mã PP</th><th>Email nhận tiền</th><th>Kho / VM</th><th>Tình trạng</th><th>Lô</th>{store?.rights.money&&<th>Giá phân bổ</th>}<th>Ghi chú</th></tr></thead>
      <tbody>{shown.map(p=><tr key={p.id}>{write&&<td><input type="checkbox" aria-label={'Chọn '+p.code} checked={selected.has(p.id)} onChange={()=>sel.toggle(p.id)}/></td>}
        <td className="whitespace-nowrap"><strong>{p.code}</strong></td><td className="whitespace-nowrap">{p.email}</td>
        <td><StateCell state={p.state} place={p.place} extra={p.earnAppLogin?'EarnApp: '+p.earnAppLogin:null}/></td>
        <td>{write?<select className="pm-input acc-status-select" aria-label={'Tình trạng '+p.code} value={p.status} disabled={status.busy} onChange={e=>void status.save([p],e.target.value)}>{Object.entries(PP_STATUS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>:PP_STATUS[p.status]}</td>
        <td className="whitespace-nowrap">{p.batch?<button className="underline text-xs" onClick={()=>onBatch(p.batch!)}>{p.batch}</button>:<span className="pm-muted">—</span>}</td>
        {store?.rights.money&&<td className="text-xs">{p.price?`${money(p.price.amount)} ${p.price.currency}`:<span className="pm-muted">Chưa ghi chi phí</span>}</td>}
        <td className="max-w-xs text-xs whitespace-pre-wrap">{p.notes||''}</td></tr>)}
        {!rows.length&&<tr><td colSpan={8} className="pm-empty">{store?'Chưa có PayPal trong bộ lọc này.':'Đang tải…'}</td></tr>}</tbody></table></div></>;
}
function BatchTable({projectId,rows,store,onContinue,onOpen,onSaved}:{projectId:string;rows:Batch[];store:Store|undefined;onContinue:(b:Batch)=>void;onOpen:(b:Batch)=>void;onSaved:()=>void}){
  const [costFor,setCostFor]=useState<Batch|null>(null);
  return <div className="pm-surface"><div className="pm-table-scroll"><table className="pm-table"><thead><tr><th>Lô</th><th>Loại</th><th>Nguồn · ngày mua</th><th>SL thực mua · đã nhận</th>{store?.rights.money&&<th>Tiền thực trả</th>}<th>Chi phí</th><th></th></tr></thead>
    <tbody>{rows.map(b=><tr key={b.id}><td><button className="underline pm-code" onClick={()=>onOpen(b)}>{b.code}</button></td><td>{b.kind==='PAYPAL'?'PayPal':TYPE[b.type||'']||'Tài khoản'}</td><td>{b.source||'—'} · {b.purchasedAt}</td><td className="whitespace-nowrap" title={b.lineCount+' dòng dán lần đầu'}>{b.paidQuantity??'—'} · {b.received}</td>
      {store?.rights.money&&<td className="text-xs">{b.money?<>{money(b.money.total)} {b.money.currency}{b.money.unit&&b.paidQuantity?` (${b.paidQuantity} × ${money(b.money.unit)})`:''}{b.money.usdt?<div className="pm-muted">≈ {money(b.money.usdt)} USDT</div>:null}</>:'—'}</td>}
      <td>{b.cost==='RECORDED'?<span className="acc-state NEW">Đã ghi chi phí</span>:b.cost==='VOIDED'?<span className="acc-state BLOCKED">Khoản chi đã thu hồi</span>:<span className="acc-state USED">Chưa ghi chi phí</span>}</td>
      <td><div className="flex gap-1 flex-wrap">{(b.kind==='PAYPAL'?store?.rights.writePaypals:store?.rights.writeLogins)&&<button className="pm-button pm-button-quiet" onClick={()=>onContinue(b)}>Nhập bổ sung</button>}{b.cost!=='RECORDED'&&store?.rights.writeCosts&&<button className="pm-button pm-button-quiet" onClick={()=>setCostFor(b)}>Ghi chi phí</button>}{b.cost==='RECORDED'&&store?.rights.money&&<Link className="pm-button pm-button-quiet" href="/costs">Xem ở Chi phí</Link>}</div></td></tr>)}
      {!rows.length&&<tr><td colSpan={7} className="pm-empty">Chưa có lô nhập.</td></tr>}</tbody></table></div>
    {costFor&&<BatchCostForm projectId={projectId} batch={costFor} onClose={()=>setCostFor(null)} onSaved={()=>{setCostFor(null);onSaved();}}/>}</div>;
}
// Payment of a batch received without a price: recorded once (the total actually paid, or unit price × quantity actually bought).
function BatchCostForm({projectId,batch,onClose,onSaved}:{projectId:string;batch:Batch;onClose:()=>void;onSaved:()=>void}){
  const [mode,setMode]=useState<'UNIT'|'TOTAL'>('TOTAL'),[amount,setAmount]=useState(''),[quantity,setQuantity]=useState(batch.paidQuantity?String(batch.paidQuantity):''),[currency,setCurrency]=useState('USDT'),[rate,setRate]=useState(''),[date,setDate]=useState(batch.purchasedAt),save=trpc.accountStore.batchCost.useMutation();
  return <form className="acc-import m-3" onSubmit={e=>{e.preventDefault();save.mutate({projectId,batchId:batch.id,expectedRevision:batch.revision,priceMode:mode,amount,quantity:mode==='UNIT'&&quantity?Number(quantity):null,currency,rate:currency==='USDT'?null:rate,date,key:crypto.randomUUID()},{onSuccess:()=>{toast.success('Đã ghi chi phí lô '+batch.code);onSaved();}});}}>
    <h3 className="text-sm font-semibold">Ghi chi phí lô {batch.code} ({batch.received} đã nhận)</h3>
    <div className="acc-import-grid"><label className="pm-label">Cách tính<select className="pm-input" value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="TOTAL">Tổng tiền thực trả</option><option value="UNIT">Giá mỗi tài khoản</option></select></label>
      {mode==='UNIT'&&<label className="pm-label">Số lượng thực mua<input className="pm-input" required inputMode="numeric" value={quantity} onChange={e=>setQuantity(e.target.value.replace(/\D/g,''))}/></label>}
      <label className="pm-label">{mode==='UNIT'?'Giá / tài khoản':'Tổng đã trả'}<input className="pm-input" required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value.replace(',','.'))}/></label>
      <label className="pm-label">Đồng tiền<select className="pm-input" value={currency} onChange={e=>setCurrency(e.target.value)}>{['USDT','VND','USD'].map(c=><option key={c}>{c}</option>)}</select></label>
      {currency!=='USDT'&&<label className="pm-label">1 USDT = ? {currency}<input className="pm-input" required inputMode="decimal" value={rate} onChange={e=>setRate(e.target.value.replace(',','.'))}/></label>}
      <label className="pm-label">Ngày chi<input type="date" className="pm-input" value={date} onChange={e=>setDate(e.target.value)}/></label></div>
    {mode==='UNIT'&&Number(quantity)>0&&Number(amount)>0&&<p className="text-xs" aria-live="polite"><strong>{quantity} × {amount} = {(Number(quantity)*Number(amount)).toFixed(8).replace(/\.?0+$/,'')} {currency}</strong></p>}
    {save.error&&<p role="alert" className="pm-error text-sm">{save.error.message}</p>}
    <div className="flex gap-2 justify-end"><button type="button" className="pm-button pm-button-quiet" onClick={onClose}>Đóng</button><button className="pm-button pm-button-primary" disabled={save.isLoading}>{save.isLoading?'Đang ghi…':'Ghi chi phí một lần'}</button></div>
  </form>;
}
