"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {ChevronDown,ChevronRight,ClipboardPaste,Copy,Loader2,Search,X} from 'lucide-react';
import toast from 'react-hot-toast';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {amountInput,canonicalAmount,formatSdkAmount,parseSdkAmount,SDK_NOTE_MAX,SDK_STATE_LABEL} from '@/lib/sdk-money';
import {localDate} from '@/components/proxy-management/HistoryPanel';
import {errorMessage,useVMRefresh} from '../shared';
import {useBusinessKey} from '@/components/business-management/shared';
import {pageOf,type SdkPlaceFilter,type SdkSort,type SdkStateFilter,type SdkStoreUrl} from './grid-model';
import {SdkTimeline,placeText,stateClass,type StoreSdk} from './SdkCell';
type Preview=inferRouterOutputs<AppRouter>['vmManagement']['sdkStorePreview'];
type ApplyResult=inferRouterOutputs<AppRouter>['vmManagement']['sdkStoreApply'];
const PAGE=50;
const STATE_CHIPS:{key:SdkStateFilter;label:string}[]=[{key:'FREE',label:'Chưa nối'},{key:'UNCONFIRMED',label:'Chưa xác nhận'},{key:'LINKED',label:'Đã nối (lịch sử)'},{key:'ALL',label:'Tất cả'}];
const matchState=(r:StoreSdk,f:SdkStateFilter)=>f==='ALL'||(f==='FREE'?r.state==='UNLINKED':r.state===f);
const matchPlace=(r:StoreSdk,f:SdkPlaceFilter)=>f==='ALL'||(f==='STORE'?!r.vm:!!r.vm);
function sortRows(rows:StoreSdk[],sort:SdkSort){
  const amount=(r:StoreSdk)=>r.amount===null?null:Number(r.amount);
  return [...rows].sort((a,b)=>{
    if(sort==='CODE')return a.code.localeCompare(b.code,'en',{numeric:true});
    if(sort==='UPDATED')return b.updatedAt.localeCompare(a.updatedAt)||a.code.localeCompare(b.code);
    const x=amount(a),y=amount(b);if(x===null&&y===null)return a.code.localeCompare(b.code);if(x===null)return 1;if(y===null)return -1; // not recorded is never 0: always last
    return (sort==='AMOUNT_DESC'?y-x:x-y)||a.code.localeCompare(b.code);
  });
}
const pasteKey=(projectId:string)=>'mth.sdk-store.paste.'+projectId;
// Kho SDK: every code of the project (all servers). Default view: never-linked codes, the ones that may be reused. Search, filters, sort
// and page are applied to the whole list before paging and live in the URL. Paste SDK | Tiền tích luỹ USD | Ghi chú: checked while
// typing (no write), one "Lưu N SDK" for the valid lines; a lost answer keeps the same key so a retry never writes twice.
export function SdkStorePanel({projectId,url,onUrl,canEdit,maxHeight,onClose,onOpenVm}:{projectId:string;url:SdkStoreUrl;onUrl:(patch:Partial<SdkStoreUrl>,mode?:'push'|'replace')=>void;canEdit:boolean;maxHeight:number;onClose:()=>void;onOpenVm:(vmId:string)=>void}){
  const store=trpc.vmManagement.sdkStore.useQuery({projectId}),[q,setQ]=useState(url.q),[open,setOpen]=useState<string|null>(null),[pasting,setPasting]=useState(false);
  useEffect(()=>{setQ(url.q);},[url.q]);
  useEffect(()=>{if(q===url.q)return;const t=setTimeout(()=>onUrl({q,page:1},'replace'),250);return ()=>clearTimeout(t);},[q,url.q,onUrl]);
  const all=useMemo(()=>store.data||[],[store.data]),needle=url.q.trim().toLowerCase();
  const searched=useMemo(()=>all.filter(r=>!needle||(r.code+' '+(r.vm?r.vm.server+' '+r.vm.code:'trong kho')+' '+(r.note||'')).toLowerCase().includes(needle)),[all,needle]);
  const inPlace=searched.filter(r=>matchPlace(r,url.place)),rows=useMemo(()=>sortRows(inPlace.filter(r=>matchState(r,url.state)),url.sort),[inPlace,url.state,url.sort]);
  const paged=pageOf(rows,url.page,PAGE),hasDraft=useHasPasteDraft(projectId);
  return <div className="vm-sdk-store" style={{maxHeight}}>
    <div className="vm-sdk-store-head"><div><h2>Kho SDK</h2><p className="pm-muted text-xs">Dùng chung mọi server của dự án. Chỉ SDK chưa từng nối EarnApp mới dùng lại hoặc chuyển VM được. Tiền là số tích luỹ người vận hành ghi, không phải thu / chi.</p></div>
      <div className="flex gap-2 items-center">{canEdit&&<button type="button" className={'pm-button'+(pasting?' pm-button-primary':'')} aria-expanded={pasting} onClick={()=>setPasting(p=>!p)}><ClipboardPaste size={15}/>Dán SDK vào kho{hasDraft&&!pasting?<span className="vm-sdk-draft">● nháp</span>:null}</button>}<button type="button" className="pm-icon-button" aria-label="Đóng Kho SDK" title="Đóng Kho SDK" onClick={onClose}><X size={16}/></button></div></div>
    {pasting&&canEdit&&<StorePaste projectId={projectId}/>}
    <div className="vm-toolbar"><label className="pm-search vm-search"><Search size={16}/><input aria-label="Tìm SDK, server, VM" placeholder="Tìm SDK, server, VM, ghi chú…" value={q} onChange={e=>setQ(e.target.value)}/>{q&&<button className="vm-cell-icon" aria-label="Xoá ô tìm SDK" onClick={()=>setQ('')}><X size={14}/></button>}</label>
      <select className="pm-input vm-sort" aria-label="Vị trí SDK" value={url.place} onChange={e=>onUrl({place:e.target.value as SdkPlaceFilter,page:1})}><option value="ALL">Mọi vị trí</option><option value="STORE">Trong kho (không ở VM)</option><option value="VM">Đang ở VM</option></select>
      <select className="pm-input vm-sort" aria-label="Sắp xếp SDK" value={url.sort} onChange={e=>onUrl({sort:e.target.value as SdkSort,page:1})}><option value="UPDATED">Cập nhật gần nhất</option><option value="AMOUNT_DESC">Tiền cao → thấp</option><option value="AMOUNT_ASC">Tiền thấp → cao</option><option value="CODE">Theo mã</option></select></div>
    <div className="vm-chips" role="group" aria-label="Lọc theo tình trạng SDK">{STATE_CHIPS.map(c=>{const n=inPlace.filter(r=>matchState(r,c.key)).length;return <button key={c.key} type="button" className={'vm-chip'+(url.state===c.key?' active':'')+(c.key==='UNCONFIRMED'&&n?' attention':'')} aria-pressed={url.state===c.key} onClick={()=>onUrl({state:c.key,page:1})}>{c.label} <strong>{store.data?n:'…'}</strong></button>;})}</div>
    {store.error&&<p role="alert" className="pm-error">{store.error.message} <button className="pm-link" onClick={()=>void store.refetch()}>Thử lại</button></p>}
    <div className="vm-pager"><span className="text-sm pm-muted">{rows.length?`${paged.first}–${paged.last} / ${rows.length} SDK`:'0 SDK'}</span>{paged.pages>1&&<span className="flex gap-1">{Array.from({length:paged.pages},(_,i)=>i+1).filter(p=>Math.abs(p-paged.current)<=2||p===1||p===paged.pages).map(p=><button key={p} type="button" className={'pm-button pm-button-quiet'+(p===paged.current?' active':'')} aria-current={p===paged.current?'page':undefined} onClick={()=>onUrl({page:p})}>{p}</button>)}</span>}</div>
    <div className="vm-sdk-store-table"><table className="pm-table"><thead><tr><th>SDK</th><th>Tiền tích luỹ</th><th>Vị trí hiện tại</th><th>Tình trạng</th><th>Ghi chú</th></tr></thead><tbody>
      {paged.rows.map(r=><StoreRow key={r.id} projectId={projectId} r={r} open={open===r.id} onToggle={()=>setOpen(o=>o===r.id?null:r.id)} canEdit={canEdit} onOpenVm={onOpenVm}/>)}
      {!paged.rows.length&&<tr><td colSpan={5} className="pm-empty">{store.isLoading?'Đang tải kho…':all.length?'Không có SDK trong bộ lọc này.':'Kho chưa có SDK. Ghi SDK tại ô SDK của VM hoặc dán vào kho.'}</td></tr>}
    </tbody></table></div>
  </div>;
}
function StoreRow({projectId,r,open,onToggle,canEdit,onOpenVm}:{projectId:string;r:StoreSdk;open:boolean;onToggle:()=>void;canEdit:boolean;onOpenVm:(vmId:string)=>void}){
  return <><tr className={open?'vm-row-active':''}>
    <td><button type="button" className="vm-sdk-store-code" aria-expanded={open} onClick={onToggle}>{open?<ChevronDown size={13}/>:<ChevronRight size={13}/>}<code className="vm-sdk">{r.code}</code></button><button type="button" className="vm-cell-icon" aria-label={'Copy SDK '+r.code} onClick={()=>void navigator.clipboard?.writeText(r.code).then(()=>toast.success('Đã copy SDK',{duration:1200}))}><Copy size={13}/></button></td>
    <td className="whitespace-nowrap">{r.amount!==null?formatSdkAmount(r.amount):<span className="pm-muted">Chưa ghi tiền</span>}{r.amountAt&&<div className="pm-muted text-xs">{localDate(r.amountAt,true)}</div>}</td>
    <td>{r.vm?<button type="button" className="pm-link text-left" title="Mở VM trong bảng" onClick={()=>onOpenVm(r.vm!.id)}>Đang ở {placeText(r)}</button>:<span className="pm-muted">Trong kho</span>}</td>
    <td><span className={stateClass(r.state)}>{SDK_STATE_LABEL[r.state]}</span>{r.state==='LINKED'&&r.linkedLogin&&<div className="pm-muted text-xs vm-ellipsis" title={r.linkedLogin}>{r.linkedLogin}</div>}</td>
    <td className="vm-sdk-store-note">{r.note?<span className="vm-clamp2" title={r.note}>{r.note}</span>:<span className="pm-muted">—</span>}</td></tr>
    {open&&<tr className="vm-sdk-store-detail"><td colSpan={5}><StoreDetail projectId={projectId} r={r} canEdit={canEdit}/></td></tr>}</>;
}
function StoreDetail({projectId,r,canEdit}:{projectId:string;r:StoreSdk;canEdit:boolean}){
  const info=trpc.vmManagement.sdkInfo.useMutation(),confirm=trpc.vmManagement.sdkConfirm.useMutation(),utils=trpc.useUtils(),refresh=useVMRefresh();
  // The version the edit started from: while nothing is typed the fields follow the store; once typed, a newer version from someone
  // else never replaces the typed text nor becomes the expected revision by itself (the save would then overwrite their value). The
  // person sees the new value and chooses "So với bản mới" explicitly.
  const [base,setBase]=useState({revision:r.revision,amount:r.amount,note:r.note}),[touched,setTouched]=useState(false);
  const [amount,setAmount]=useState(amountInput(r.amount)),[note,setNote]=useState(r.note||''),[error,setError]=useState(''),[busy,setBusy]=useState(false),keyFor=useBusinessKey();
  useEffect(()=>{if(touched)return;setBase({revision:r.revision,amount:r.amount,note:r.note});setAmount(amountInput(r.amount));setNote(r.note||'');},[r.revision,r.amount,r.note,touched]);
  const parsed=amount.trim()?parseSdkAmount(amount):null,amountError=parsed&&'error' in parsed?parsed.error:'',value=parsed&&'value' in parsed?parsed.value:null;
  const amountChanged=(amount.trim()?value:null)!==canonicalAmount(base.amount),noteChanged=(note.trim()||null)!==(base.note||null),changed=(amountChanged||noteChanged)&&!amountError;
  const moved=touched&&r.revision!==base.revision;
  async function run(fn:()=>Promise<{message:string}>,after?:()=>void){if(busy)return;setBusy(true);setError('');try{const x=await fn();toast.success(x.message,{duration:2000});after?.();await Promise.all([utils.vmManagement.sdkStore.invalidate(),utils.vmManagement.sdkDetail.invalidate(),refresh()]);}catch(e){setError(errorMessage(e));}finally{setBusy(false);}}
  const save=()=>{if(!changed||moved)return;const input={projectId,sdkId:r.id,expectedRevision:base.revision,amount:amountChanged?(amount.trim()?amount:null):undefined,note:noteChanged?(note.trim()||null):undefined};void run(()=>info.mutateAsync({...input,key:keyFor(input)}),()=>setTouched(false));};
  const edit=(set:(v:string)=>void)=>(e:{target:{value:string}})=>{setTouched(true);set(e.target.value);};
  const keys=(e:React.KeyboardEvent,multi=false)=>{if(e.nativeEvent.isComposing||e.keyCode===229)return;if(e.key==='Enter'&&!(multi&&e.shiftKey)){e.preventDefault();save();}if(e.key==='Escape'){setTouched(false);setAmount(amountInput(r.amount));setNote(r.note||'');}};
  return <div className="vm-sdk-store-detail-body">
    <div className="space-y-2">
      {r.state==='UNCONFIRMED'&&<div className="pm-review text-sm"><p>Dữ liệu cũ: web chưa có bằng chứng mã này đã hay chưa từng nối EarnApp, nên chưa cho dùng lại.</p>
        {canEdit&&<div className="flex gap-2 flex-wrap mt-2"><button className="pm-button" disabled={busy} onClick={()=>{const input={projectId,sdkId:r.id,expectedRevision:r.revision,decision:'UNLINKED' as const};void run(()=>confirm.mutateAsync({...input,key:keyFor(input)}));}}>Xác nhận chưa từng nối</button><button className="pm-button" disabled={busy} onClick={()=>{const input={projectId,sdkId:r.id,expectedRevision:r.revision,decision:'LINKED' as const};void run(()=>confirm.mutateAsync({...input,key:keyFor(input)}));}}>Đã từng nối (chỉ để tra cứu)</button></div>}</div>}
      {canEdit?<><div className="grid grid-cols-2 gap-2"><label className="pm-label text-xs">Tiền tích luỹ (USD)<input className="pm-input" inputMode="decimal" placeholder="Chưa ghi tiền" aria-label={'Tiền tích luỹ '+r.code} value={amount} disabled={busy} onChange={edit(setAmount)} onKeyDown={e=>keys(e)}/></label>
        <label className="pm-label text-xs">Ghi chú<textarea className="pm-input" rows={2} maxLength={SDK_NOTE_MAX} aria-label={'Ghi chú '+r.code} value={note} disabled={busy} onChange={edit(setNote)} onKeyDown={e=>keys(e,true)}/></label></div>
        {amountError&&<p className="vm-cell-error" role="alert">{amountError}</p>}
        {moved&&<p className="pm-review text-xs" role="alert">Người khác vừa sửa mã này: tiền hiện {formatSdkAmount(r.amount)||'chưa ghi'}{r.note!==base.note?' · ghi chú đã đổi':''}. Nội dung bạn nhập được giữ; bấm <button type="button" className="underline" onClick={()=>setBase({revision:r.revision,amount:r.amount,note:r.note})}>So với bản mới</button> rồi lưu nếu vẫn muốn ghi.</p>}
        <div className="flex justify-end"><button type="button" className="pm-button pm-button-primary" disabled={!changed||busy||moved} onClick={save}>{busy?'Đang lưu…':'Lưu'}</button></div></>:<p className="text-xs pm-muted">Chỉ xem.</p>}
      {error&&<p role="alert" className="vm-status-error">{error}</p>}
    </div>
    <div><h4 className="text-xs font-semibold mb-1">Lịch sử mã</h4><SdkTimeline projectId={projectId} sdkId={r.id}/></div>
  </div>;
}
function useHasPasteDraft(projectId:string){const [has,setHas]=useState(false);useEffect(()=>{const read=()=>{try{setHas(!!localStorage.getItem(pasteKey(projectId)));}catch{setHas(false);}};read();const t=setInterval(read,1500);return ()=>clearInterval(t);},[projectId]);return has;}
const RESULT:Record<string,string>={NEW:'Thêm mới',UPDATE:'Cập nhật',SAME:'Giữ nguyên',ERROR:'Lỗi',SAVED:'Đã lưu'};
function StorePaste({projectId}:{projectId:string}){
  const preview=trpc.vmManagement.sdkStorePreview.useMutation(),apply=trpc.vmManagement.sdkStoreApply.useMutation(),utils=trpc.useUtils(),refresh=useVMRefresh();
  const [text,setText]=useState(()=>{try{return localStorage.getItem(pasteKey(projectId))||'';}catch{return '';}});
  const [checked,setResult]=useState<(Preview&{text:string})|null>(null),[applied,setApplied]=useState<ApplyResult|null>(null),[summary,setSummary]=useState(''),[error,setError]=useState(''),[checking,setChecking]=useState(false);
  // One key per checked content: an unanswered save keeps it, so "Lưu" again replays instead of writing twice.
  const key=useRef<{text:string;key:string}|null>(null),seq=useRef(0);
  useEffect(()=>{try{if(text.trim())localStorage.setItem(pasteKey(projectId),text);else localStorage.removeItem(pasteKey(projectId));}catch{/* private mode */}},[projectId,text]);
  // A check answer counts only for the text it was made for: changing or clearing the box while a check runs never leaves the old
  // list savable (the late answer is dropped by the sequence number and, in any case, no longer matches the text).
  useEffect(()=>{setApplied(null);setError('');const n=++seq.current;if(!text.trim()){setResult(null);setChecking(false);return;}setChecking(true);
    const t=setTimeout(()=>{preview.mutateAsync({projectId,text}).then(r=>{if(n===seq.current)setResult({...r,text});}).catch(e=>{if(n===seq.current){setResult(null);setError(errorMessage(e));}}).finally(()=>{if(n===seq.current)setChecking(false);});},400);
    return ()=>clearTimeout(t);},[text,projectId]);// eslint-disable-line react-hooks/exhaustive-deps
  const result=checked&&(checked.text===text||applied)?checked:null,ready=result&&result.text===text?result.rows.filter(r=>r.outcome==='NEW'||r.outcome==='UPDATE'):[];
  async function save(){
    if(!result||result.text!==text||!ready.length||apply.isLoading)return;if(key.current?.text!==text)key.current={text,key:crypto.randomUUID()};setError('');
    try{const r=await apply.mutateAsync({projectId,key:key.current.key,rows:ready.map(x=>({line:x.line,code:x.code,expectedRevision:x.expectedRevision,amount:x.amount,note:x.note}))});
      setApplied(r);key.current=null;await Promise.all([utils.vmManagement.sdkStore.invalidate(),refresh()]);
      const line=`Đã lưu ${r.saved} SDK`+(r.same?` · ${r.same} giữ nguyên`:'')+(r.errors?` · ${r.errors} lỗi`:'');toast.success(line);
      // Only the lines that still need work stay in the box (refused at the check or at the save).
      const failed=new Set([...result.rows.filter(x=>x.outcome==='ERROR').map(x=>x.line),...r.rows.filter(x=>x.outcome==='ERROR').map(x=>x.line)]);
      const keep=text.replace(/\r/g,'').split('\n').filter((_,i)=>failed.has(i+1)).join('\n');if(keep!==text)setText(keep);
    }catch(e){setError(errorMessage(e)+' Nội dung được giữ; bấm Lưu lại sẽ không ghi trùng.');}
  }
  const after=new Map((applied?.rows||[]).map(r=>[r.line,r]));
  const change=(r:Preview['rows'][number])=>{const parts:string[]=[];
    if(r.amount!==undefined){const from=r.before?.amount??null,to=r.amount;if(!r.before||from!==to)parts.push((r.before?(formatSdkAmount(from)||'chưa ghi')+' → ':'')+(to===null?'xoá tiền':formatSdkAmount(to)));}
    if(r.note!==undefined){const from=r.before?.note??null,to=r.note;if(!r.before||from!==to)parts.push((r.before?(from?'"'+from.slice(0,30)+'"':'trống')+' → ':'')+(to===null?'xoá ghi chú':'"'+to.slice(0,30)+'"'));}
    return parts.join(' · ')||(r.outcome==='NEW'?'chưa ghi tiền':'');};
  return <div className="vm-sdk-paste">
    <label className="pm-label">Dán từ Sheet: SDK | Tiền tích luỹ USD | Ghi chú<textarea className="pm-input pm-paste" rows={5} aria-label="Danh sách SDK dán vào kho" value={text} disabled={apply.isLoading} placeholder={'sdk-abc12345\t12,40\tmáy cũ moon1\nsdk-def67890\t\tchưa ghi tiền'} onChange={e=>{setSummary('');setText(e.target.value);}}/></label>
    {summary&&<p role="status" className="pm-success text-sm">{summary}</p>}
    <p className="pm-muted text-xs">Tự kiểm tra khi dán, chưa ghi gì. Mã đã có là cập nhật (không tạo mã thứ hai). Ô trống giữ nguyên; gõ - để xoá tiền / ghi chú. Mã lặp trong danh sách bị báo ở mọi dòng.</p>
    {checking&&<p className="text-xs pm-muted"><Loader2 size={12} className="inline animate-spin"/> Đang kiểm tra…</p>}
    {result&&<><p className="text-sm"><strong>{result.ready}</strong> sẽ lưu · {result.same} giữ nguyên · <span className={result.errors?'text-red-600':''}>{result.errors} lỗi</span></p>
      <div className="vm-bulk-table"><table className="pm-table"><thead><tr><th>Dòng</th><th>SDK</th><th>Cũ → mới</th><th>Kết quả</th></tr></thead><tbody>{result.rows.map(r=>{const a=after.get(r.line),outcome=a?a.outcome:r.outcome,message=a?a.message:r.message;
        return <tr key={r.line} className={outcome==='ERROR'?'pm-row-blocked':''}><td className="pm-muted">{r.line}</td><td><code className="vm-sdk">{r.code}</code>{r.location&&<div className="pm-muted text-xs">{r.location}</div>}</td><td className="text-xs">{change(r)}</td><td className={outcome==='ERROR'?'text-red-600':outcome==='SAME'?'pm-muted':outcome==='SAVED'?'text-green-700':''}>{RESULT[outcome]||outcome} · {message}</td></tr>;})}</tbody></table></div></>}
    {error&&<p role="alert" className="pm-error">{error}</p>}
    <div className="flex justify-end gap-2">{text&&<button type="button" className="pm-button pm-button-quiet" disabled={apply.isLoading} onClick={()=>setText('')}>Xoá nội dung dán</button>}<button type="button" className="pm-button pm-button-primary" disabled={!ready.length||apply.isLoading||checking} onClick={()=>void save()}>{apply.isLoading?'Đang lưu…':`Lưu ${ready.length} SDK`}</button></div>
  </div>;
}
