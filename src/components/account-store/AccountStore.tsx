"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import toast from 'react-hot-toast';
import {AlertTriangle,ArrowLeft,Copy,History,Search} from 'lucide-react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {links} from '@/lib/links';
import {errorMessage} from '@/components/vm-management/shared';
import {AccountCopy} from '@/components/business-management/AccountsWorkspace';
import {ImportPanel,appendToBatch,discardDraft,importDraft,type StockKind} from './ImportPanel';
import {openView,readAccountUrl,sameQuery,switchKind,writeAccountUrl,type AccountKind,type AccountUrl} from './account-url';
type Store=inferRouterOutputs<AppRouter>['accountStore']['store'];
type Login=Store['logins'][number];type Paypal=Store['paypals'][number];type Batch=Store['batches'][number];
type ReviewItem=Store['review'][number];
type Tab='login'|'paypal'|'batch'|'review';
const STATE_LABEL:Record<string,string>={NEW:'NEW · chưa gán',ASSIGNED:'Đã gán',USED:'Đã dùng · chưa gán',BLOCKED:'Lỗi / ngừng dùng'};
const LOGIN_STATUS:Record<string,string>={ACTIVE:'Dùng được',SUSPENDED:'Bị khoá tạm',NEEDS_RECOVERY:'Cần khôi phục',NEEDS_2FA_UPDATE:'Cần cập nhật 2FA',BLOCKED:'Bị chặn',DISABLED:'Ngừng dùng'};
const PP_STATUS:Record<string,string>={ACTIVE:'Dùng được',LIMITED:'Bị limit',SUSPENDED:'Bị suspend',CLOSED:'Đã đóng',PENDING_VERIFY:'Chờ xác minh'};
const TYPE:Record<string,string>={GMAIL:'Gmail',APPLE_ID:'Apple ID'};
const PRICE_EMPTY={NONE:'Chưa ghi chi phí',VOIDED:'Khoản chi đã thu hồi',RECORDED:'—'} as const;
const money=(v:string|null|undefined)=>v?v.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''):'';
const vmHref=(p:{serverId:string;vmId:string})=>links.vms({serverId:p.serverId,vm:p.vmId,tab:'account'});
// Kho tài khoản: two kinds of account, Gmail / Apple ID and PayPal (the same PayPal records as before), as the two tabs. Inside the
// kind being looked at: Lịch sử nhập kho (one row per purchase) and Cần đối chiếu (old data against the new rules, shown only when there
// is some). Stock state (NEW / Đã gán / Đã dùng / Lỗi) is computed from the current EarnApp links. Assigning to VMs happens in Server/VM
// (cell, bulk, Dán bảng); this page receives, checks and maintains the stock.
// Everything a person can see here is in the URL (account-url.ts): tab and view changes are history entries, typing a search replaces.
// The import panel, its preview and the row selection belong to one kind and are never carried to the other (drafts: ImportPanel).
export function AccountStore({projectId,initialTab}:{projectId:string;initialTab?:Tab}){
  const params=useSearchParams(),router=useRouter(),path=usePathname(),store=trpc.accountStore.store.useQuery({projectId}),utils=trpc.useUtils();
  const initial:AccountKind=initialTab==='paypal'?'paypal':'login',url=readAccountUrl(params,initial);
  // A member with only the PayPal right (no Server / VM module) works on the PayPal tab of the same store; the backend decides.
  const kind:AccountKind=url.tab==='login'&&store.data&&!store.data.rights.logins?'paypal':url.tab,stock:StockKind=kind==='paypal'?'PAYPAL':'LOGIN';
  const {q,type,state,batch,view}=url;
  const go=(next:AccountUrl,mode:'push'|'replace'='push')=>{const href=path+writeAccountUrl(next,initial);if(mode==='push')router.push(href,{scroll:false});else router.replace(href,{scroll:false});};
  // Old links (?tab=batch / ?tab=review / ?import=1) and a login tab a PayPal-only member cannot have: shown as their canonical URL.
  const wantImport=useRef(params.get('import')==='1');
  const search=params.toString();
  useEffect(()=>{const canonical=writeAccountUrl({...readAccountUrl(new URLSearchParams(search),initial),tab:kind},initial);if(!sameQuery(canonical,search))router.replace(path+canonical,{scroll:false});},[search,kind,initial,path,router]);
  // Typing a search replaces the URL (no history entry per key), a moment after the last key.
  const [typed,setTyped]=useState(q);useEffect(()=>{setTyped(q);},[q]);
  useEffect(()=>{if(typed===q)return;const t=setTimeout(()=>go({...readAccountUrl(new URLSearchParams(window.location.search),initial),tab:kind,q:typed},'replace'),250);return()=>clearTimeout(t);});
  const [open,setOpenState]=useState(()=>({LOGIN:importDraft(projectId,'LOGIN').open,PAYPAL:importDraft(projectId,'PAYPAL').open}));
  const [nonce,setNonce]=useState(0),bump=()=>setNonce(n=>n+1);
  const setOpen=(k:StockKind,v:boolean)=>{importDraft(projectId,k).open=v;setOpenState(o=>({...o,[k]:v}));};
  useEffect(()=>{if(wantImport.current&&store.data){wantImport.current=false;setOpen(stock,true);}});
  const [selected,setSelected]=useState<Set<string>>(new Set()),[copy,setCopy]=useState<Login|null>(null);
  // A new kind, view or filter starts with nothing selected (selection never crosses from PayPal to Gmail or the other way).
  const resultKey=JSON.stringify([kind,view,type,state,batch,q]);useEffect(()=>{setSelected(new Set());},[resultKey]);
  const refresh=()=>Promise.all([utils.accountStore.invalidate(),utils.businessManagement.invalidate()]);
  const data=store.data,rights=data?.rights,needle=q.trim().toLowerCase();
  const logins=useMemo(()=>(data?.logins||[]).filter(l=>(!type||l.type===type)&&(!state||l.state===state)&&(!batch||l.batch===batch)&&(!needle||[l.email,l.notes,l.batch,l.place?.server,l.place?.vm,l.earnApp?.paypal].join(' ').toLowerCase().includes(needle))),[data,type,state,batch,needle]);
  const paypals=useMemo(()=>(data?.paypals||[]).filter(p=>(!state||p.state===state)&&(!batch||p.batch===batch)&&(!needle||[p.code,p.email,p.notes,p.batch,p.place?.server,p.place?.vm,p.earnAppLogin].join(' ').toLowerCase().includes(needle))),[data,state,batch,needle]);
  const counts=(rows:{state:string}[])=>Object.fromEntries(['NEW','ASSIGNED','USED','BLOCKED'].map(s=>[s,rows.filter(r=>r.state===s).length]));
  const base=kind==='paypal'?data?.paypals||[]:(data?.logins||[]).filter(l=>!type||l.type===type),stateCounts=counts(base);
  const batches=(data?.batches||[]).filter(b=>b.kind===stock),review=(data?.review||[]).filter(r=>r.group===stock);
  const kindLabel=kind==='paypal'?'PayPal':'Gmail / Apple ID',canWrite=kind==='paypal'?!!rights?.writePaypals:!!rights?.writeLogins;
  // Import a new purchase of the kind being looked at; from a sub-view this returns to the kind's list first.
  const startImport=()=>{setOpen(stock,true);if(view)go(openView(url,''));};
  const continueBatch=(b:Batch)=>{const k:StockKind=b.kind==='PAYPAL'?'PAYPAL':'LOGIN';appendToBatch(importDraft(projectId,k),{id:b.id,code:b.code,type:b.type});setOpen(k,true);bump();go({...switchKind(url,k==='PAYPAL'?'paypal':'login'),batch:b.code});};
  const openReview=(r:ReviewItem)=>{if(r.open.type==='vm')router.push(vmHref(r.open.place));else if(r.open.type==='batch')go(openView(url,'history',r.open.code));else go({...switchKind(url,kind),q:r.open.q});};
  if(store.error)return <p role="alert" className="pm-error">{store.error.message}</p>;
  return <div className="proxy-workspace space-y-4">
    <div className="pm-heading"><div><h1>Kho tài khoản</h1><p className="pm-muted">Gmail / Apple ID NEW chưa dùng đăng ký EarnApp và PayPal nhận tiền. Gán cho VM ngay tại bảng <Link className="underline" href={links.vms()}>Server / VM</Link>; một VM một tài khoản EarnApp, một PayPal riêng.</p></div>
      <div className="flex gap-2 flex-wrap">{canWrite&&<button className="pm-button pm-button-primary" onClick={startImport}>{kind==='paypal'?'Nhập PayPal':'Nhập Gmail / Apple ID'}</button>}</div></div>
    <div className="vm-kind-tabs" role="tablist" aria-label="Loại tài khoản">{([['login','Gmail / Apple ID',data?.logins.length],['paypal','PayPal',data?.paypals.length]] as [AccountKind,string,number|undefined][]).filter(([k])=>k!=='login'||rights?.logins!==false).map(([k,label,n])=><button key={k} type="button" role="tab" aria-selected={kind===k} className={kind===k?'active':''} onClick={()=>{if(k!==kind||view||q||type||state||batch)go(switchKind(url,k));}}>{label}{n!==undefined?` (${n})`:''}</button>)}</div>
    <div className="acc-subnav">{view?<button type="button" className="pm-link inline-flex items-center gap-1" onClick={()=>go(openView(url,''))}><ArrowLeft size={14}/> Về danh sách {kindLabel}</button>
      :<><button type="button" className="pm-button pm-button-quiet" onClick={()=>go(openView(url,'history'))}><History size={14}/> Lịch sử nhập kho{data?` (${batches.length})`:''}</button>
        {review.length>0&&<button type="button" className="acc-review-alert" onClick={()=>go(openView(url,'review'))}><AlertTriangle size={14}/> Cần đối chiếu ({review.length})</button>}</>}</div>
    {(['LOGIN','PAYPAL'] as StockKind[]).map(k=>open[k]&&<div key={k} hidden={k!==stock||!!view}><ImportPanel key={k+':'+importDraft(projectId,k).nonce+':'+nonce} projectId={projectId} kind={k} canCost={!!rights?.writeCosts} onDone={()=>void refresh()} onClose={()=>setOpen(k,false)} onDiscard={()=>{discardDraft(importDraft(projectId,k));bump();}}/></div>)}
    {!view&&<div className="pm-surface">
      <div className="pm-actions flex-wrap gap-2">
        <label className="pm-search vm-search"><Search size={16}/><input aria-label="Tìm tài khoản" placeholder={kind==='paypal'?'Tìm mã PP, email, VM…':'Tìm email, lô, VM, PayPal…'} value={typed} onChange={e=>setTyped(e.target.value)}/></label>
        {kind==='login'&&<div className="vm-chips">{['','GMAIL','APPLE_ID'].map(t=><button key={t} type="button" className={'vm-chip'+(type===t?' active':'')} onClick={()=>go({...url,tab:kind,type:t})}>{t?TYPE[t]:'Tất cả loại'}</button>)}</div>}
        <div className="vm-chips">{['','NEW','ASSIGNED','USED','BLOCKED'].map(s=><button key={s} type="button" className={'vm-chip'+(state===s?' active':'')} onClick={()=>go({...url,tab:kind,state:s})}>{s?STATE_LABEL[s]:'Tất cả'}{s?<strong>{stateCounts[s]}</strong>:null}</button>)}</div>
        {batch&&<span className="pm-filter-chip" role="status">Đợt nhập <strong className="pm-code">{batch}</strong> · {(kind==='paypal'?paypals:logins).length} {kind==='paypal'?'PayPal':'tài khoản'} <button type="button" className="pm-link" onClick={()=>go({...url,tab:kind,batch:''})}>Bỏ lọc đợt</button> · <button type="button" className="pm-link" onClick={()=>go(openView(url,'history',batch))}>Xem đợt trong lịch sử</button></span>}
      </div>
      {kind==='login'?<LoginTable projectId={projectId} rows={logins} store={data} selected={selected} setSelected={setSelected} onCopy={setCopy} onBatch={b=>go({...url,tab:kind,batch:b})} onSaved={()=>void refresh()}/>:<PaypalTable projectId={projectId} rows={paypals} store={data} selected={selected} setSelected={setSelected} onBatch={b=>go({...url,tab:kind,batch:b})} onSaved={()=>void refresh()}/>}
    </div>}
    {view==='history'&&<BatchTable projectId={projectId} kindLabel={kindLabel} rows={batches} focus={batch} store={data} onContinue={continueBatch} onOpen={b=>go({...switchKind(url,kind),batch:b.code})} onSaved={()=>void refresh()}/>}
    {view==='review'&&<div className="pm-surface p-4 space-y-3"><h2 className="font-semibold">Cần đối chiếu · {kindLabel}</h2>
      <p className="text-sm pm-muted">Dữ liệu cũ mâu thuẫn với quy tắc mới (một VM một tài khoản, một PayPal một EarnApp, tiền mua ghi một lần). Web không tự đoán loại, sửa tiền, ghép hay thay liên kết; người vận hành mở từng mục để xử lý. Tài khoản bị khoá, PayPal limit hoặc ngừng dùng là tình trạng tài khoản, xem ở lọc <button type="button" className="pm-link" onClick={()=>go({...switchKind(url,kind),state:'BLOCKED'})}>{STATE_LABEL.BLOCKED}</button>.</p>
      {review.length?<ul className="acc-review-list">{review.map((r,i)=><li key={i}><div><strong>{r.subject}</strong><p className="text-sm">{r.reason}</p></div><button type="button" className="pm-button pm-button-quiet" onClick={()=>openReview(r)}>{r.open.type==='vm'?`Mở VM ${r.open.place.server} / ${r.open.place.vm}`:r.open.type==='batch'?'Mở đợt nhập':kind==='paypal'?'Mở PayPal':'Mở tài khoản'}</button></li>)}</ul>:<p className="text-sm">{store.isLoading?'Đang tải…':'Không còn mục cần đối chiếu.'}</p>}</div>}
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
        {store?.rights.money&&<td className="text-xs">{l.price?`${money(l.price.amount)} ${l.price.currency}`:<span className="pm-muted">{PRICE_EMPTY[l.priceState]}</span>}</td>}
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
        {store?.rights.money&&<td className="text-xs">{p.price?`${money(p.price.amount)} ${p.price.currency}`:<span className="pm-muted">{PRICE_EMPTY[p.priceState]}</span>}</td>}
        <td className="max-w-xs text-xs whitespace-pre-wrap">{p.notes||''}</td></tr>)}
        {!rows.length&&<tr><td colSpan={8} className="pm-empty">{store?'Chưa có PayPal trong bộ lọc này.':'Đang tải…'}</td></tr>}</tbody></table></div></>;
}
// Lịch sử nhập kho of one kind: one row per purchase (source, date, quantity bought / received, money paid once). Nhập bổ sung continues
// that purchase without money; a new purchase is a new row. ?batch= highlights one purchase (from a link or Cần đối chiếu).
function BatchTable({projectId,kindLabel,rows,focus,store,onContinue,onOpen,onSaved}:{projectId:string;kindLabel:string;rows:Batch[];focus:string;store:Store|undefined;onContinue:(b:Batch)=>void;onOpen:(b:Batch)=>void;onSaved:()=>void}){
  const [costFor,setCostFor]=useState<Batch|null>(null),focusMissing=!!focus&&!!store&&!rows.some(b=>b.code===focus);
  useEffect(()=>{if(focus&&store)document.querySelector(`[data-batch="${CSS.escape(focus)}"]`)?.scrollIntoView({block:'center'});},[focus,store]);
  return <div className="pm-surface"><div className="px-4 pt-3"><h2 className="font-semibold">Lịch sử nhập kho · {kindLabel}</h2><p className="pm-muted text-xs">Mỗi dòng là một đợt mua / nhận hàng. Nhập bổ sung vào đợt không tạo đợt mới và không ghi tiền thêm.</p>{focusMissing&&<p className="pm-review text-xs mt-1">Không có đợt {focus} trong {kindLabel}.</p>}</div><div className="pm-table-scroll"><table className="pm-table"><thead><tr><th>Đợt nhập</th><th>Loại</th><th>Nguồn · ngày mua</th><th>SL thực mua · đã nhận</th>{store?.rights.money&&<th>Tiền thực trả</th>}<th>Chi phí</th><th></th></tr></thead>
    <tbody>{rows.map(b=><tr key={b.id} data-batch={b.code} aria-current={b.code===focus||undefined} className={b.code===focus?'pm-row-focus':undefined}><td><button className="underline pm-code" title="Xem tài khoản của đợt này" onClick={()=>onOpen(b)}>{b.code}</button></td><td>{b.kind==='PAYPAL'?'PayPal':TYPE[b.type||'']||'Tài khoản'}</td><td>{b.source||'—'} · {b.purchasedAt}</td><td className="whitespace-nowrap" title={b.lineCount+' dòng dán lần đầu'}>{b.paidQuantity??'—'} · {b.received}</td>
      {store?.rights.money&&<td className="text-xs"><BatchMoney b={b}/></td>}
      <td>{b.cost==='RECORDED'?<span className="acc-state NEW">Đã ghi chi phí</span>:b.cost==='VOIDED'?<span className="acc-state BLOCKED">Khoản chi đã thu hồi</span>:<span className="acc-state USED">Chưa ghi chi phí</span>}</td>
      <td><div className="flex gap-1 flex-wrap"><button className="pm-button pm-button-quiet" onClick={()=>onOpen(b)}>Xem tài khoản ({b.received})</button>{(b.kind==='PAYPAL'?store?.rights.writePaypals:store?.rights.writeLogins)&&<button className="pm-button pm-button-quiet" onClick={()=>onContinue(b)}>Nhập bổ sung</button>}{b.cost!=='RECORDED'&&store?.rights.writeCosts&&<button className="pm-button pm-button-quiet" onClick={()=>setCostFor(b)}>Ghi chi phí</button>}{b.costLink&&<Link className="pm-button pm-button-quiet" href={`/costs?cost=${b.costLink.id}&month=${b.costLink.month}`}>Xem ở Chi phí</Link>}</div></td></tr>)}
      {!rows.length&&<tr><td colSpan={7} className="pm-empty">{store?'Chưa có đợt nhập '+kindLabel+'.':'Đang tải…'}</td></tr>}</tbody></table></div>
    {costFor&&<BatchCostForm projectId={projectId} batch={costFor} onClose={()=>setCostFor(null)} onSaved={()=>{setCostFor(null);onSaved();}}/>}</div>;
}
// Money of a batch as the cost ledger holds it now (total, currency, rate, USDT). The unit × quantity formula shows only while it
// still equals the ledger total; after an adjustment or void the first price stays visible as history.
function BatchMoney({b}:{b:Batch}){
  const m=b.money;if(!m)return <>—</>;
  const first=m.original?`${money(m.original.total)} ${m.original.currency||''}${m.original.unit&&m.original.quantity?` (${m.original.quantity} × ${money(m.original.unit)})`:''}`:'';
  return <>{m.total?<>{money(m.total)} {m.currency}{m.unit&&b.paidQuantity?` (${b.paidQuantity} × ${money(m.unit)})`:''}
    {m.currency!=='USDT'&&m.rate?<div className="pm-muted">1 USDT = {money(m.rate)} {m.currency}</div>:null}{m.usdt&&m.currency!=='USDT'?<div className="pm-muted">≈ {money(m.usdt)} USDT</div>:null}</>:null}
    {first&&<div className="pm-muted">{m.total?'Đã điều chỉnh ở Chi phí · ban đầu ':'Giá ban đầu '}{first}</div>}</>;
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
