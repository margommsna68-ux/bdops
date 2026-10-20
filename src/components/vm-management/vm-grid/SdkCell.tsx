"use client";
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Copy,History,Loader2,Search,Undo2} from 'lucide-react';
import toast from 'react-hot-toast';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {useSession} from 'next-auth/react';
import {trpc} from '@/lib/trpc';
import {formatSdkAmount,parseSdkAmount,SDK_NOTE_MAX,SDK_STATE_LABEL,type SdkLinkState} from '@/lib/sdk-money';
import {localDate} from '@/components/proxy-management/HistoryPanel';
import {errorMessage,useVMRefresh,type ManagedVM} from '../shared';
import type {VmAccount} from './AccountCell';
import {shortCode} from './grid-model';
import {sdkFirst,sdkSummary} from './sdk-summary';
export type StoreSdk=inferRouterOutputs<AppRouter>['vmManagement']['sdkStore'][number];
type VmSdk=ManagedVM['sdks'][number];
/** The "add a code" form of the frame kept as a draft while the frame is closed (per person, project, VM and round). `pending` = the
 *  request of an add whose answer was lost: a retry of the same content reuses its key (no second write). `cycle` = the VM round the
 *  draft was started in and `seen` = the stored version of the typed code the person saw (null = no stored code): a background reload
 *  never moves them; a newer round or version asks "Kiểm tra lại" at the form (review fix 20/10/2026). */
export interface SdkDraftBase {userId:string;projectId:string;vmId:string;cycle:number}
export interface SdkDraft {code:string;amount?:string;note?:string;base?:SdkDraftBase;pending?:{sig:string;key:string};cycle?:number;seen?:{code:string;revision:number|null}}
const SDK_PATTERN=/^[A-Za-z0-9._:-]{8,128}$/;
export const stateClass=(s:SdkLinkState|null|undefined)=>s==='LINKED'?'vm-sdk-state-linked':s==='UNCONFIRMED'?'vm-sdk-state-unconfirmed':'vm-sdk-state-free';
export const placeText=(r:{vm:StoreSdk['vm']})=>r.vm?r.vm.server+' / '+r.vm.code+(r.vm.deleted?' (đã xoá)':''):'Trong kho';
export {sdkSummary} from './sdk-summary';
// Fixed-position popover next to a cell (portal: never clipped by the table's scroll area). Opens below, or above when there is no
// room; a popover taller than the window keeps its footer on screen and scrolls its body.
export function useAnchored(open:boolean,anchor:React.RefObject<HTMLElement|null>,pop:React.RefObject<HTMLElement|null>,width:number){
  const [pos,setPos]=useState<{top:number;left:number;maxHeight:number}|null>(null);
  useLayoutEffect(()=>{if(!open){setPos(null);return;}
    const place=()=>{const r=anchor.current?.getBoundingClientRect();if(!r)return;const h=pop.current?.scrollHeight||420,vh=window.innerHeight,below=vh-r.bottom-12,above=r.top-12;
      const up=h>below&&above>below,maxHeight=Math.max(220,Math.min(h,up?above:below,vh-16)),top=up?Math.max(8,r.top-6-maxHeight):Math.min(r.bottom+6,vh-8-maxHeight);
      const next={top,left:Math.max(8,Math.min(r.left,window.innerWidth-width-8)),maxHeight};setPos(p=>p&&p.top===next.top&&p.left===next.left&&p.maxHeight===next.maxHeight?p:next);};
    place();const raf=requestAnimationFrame(place),t=setTimeout(place,350);window.addEventListener('scroll',place,true);window.addEventListener('resize',place);
    return ()=>{cancelAnimationFrame(raf);clearTimeout(t);window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);};},[open,anchor,pop,width]);
  return pos;
}
function copyCode(code:string,label:string){navigator.clipboard?.writeText(code).then(()=>toast.success('Đã copy SDK '+label,{duration:1500})).catch(()=>toast.error('Trình duyệt chặn copy; mở ô SDK để chọn mã'));}
// SDK cell (owner brief 20/10/2026): the first unused code (copy) and "3 SDK · 2 chưa dùng". A click opens the VM's SDK list next to
// the cell; a closed frame keeps a typed new code as a draft (marked in the cell).
export function SdkCell({projectId,vm,account,canEdit,draft,onDraft,onBusy}:{projectId:string;vm:ManagedVM;account:VmAccount|undefined;canEdit:boolean;draft:SdkDraft|null;onDraft:(d:SdkDraft|null)=>void;onBusy:(vmId:string,busy:boolean)=>void}){
  const [open,setOpen]=useState(false),anchor=useRef<HTMLDivElement>(null),pop=useRef<HTMLDivElement>(null),pos=useAnchored(open,anchor,pop,620);
  const busy=useRef(false),close=(refocus=true)=>{if(busy.current)return;setOpen(false);if(refocus)anchor.current?.focus({preventScroll:true});};const closeRef=useRef(close);closeRef.current=close;
  useEffect(()=>{if(!open)return;const down=(e:MouseEvent)=>{if(!pop.current?.contains(e.target as Node)&&!anchor.current?.contains(e.target as Node))closeRef.current(false);};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing&&!(e.target as HTMLElement)?.closest?.('[data-sdk-edit]')){e.stopPropagation();e.preventDefault();closeRef.current();}};
    document.addEventListener('mousedown',down);document.addEventListener('keydown',key,true);return ()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key,true);};},[open]);
  const list=vm.sdks,first=sdkFirst(list);
  const view=<>{first?<span className="vm-sdk-line"><code className="vm-sdk vm-ellipsis" title={first.code}>{shortCode(first.code)}</code><button type="button" className="vm-cell-icon" aria-label={'Copy SDK '+vm.code} title="Copy SDK đầy đủ" onClick={e=>{e.stopPropagation();copyCode(first.code,vm.code);}} onKeyDown={e=>e.stopPropagation()}><Copy size={13}/></button></span>:<span className="vm-sdk-missing">Chưa có SDK</span>}
    {list.length>0&&<span className="vm-sdk-sub">{sdkSummary(list)}</span>}
    {draft&&<span className="vm-sdk-draft" title="Có mã đang nhập chưa lưu; mở ô để lưu hoặc huỷ">● Nháp chưa lưu</span>}</>;
  if(vm.archivedAt)return <div className="vm-sdk-cell2">{view}</div>;
  return <div className="vm-status">
    <div ref={anchor} role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={open} aria-label={'SDK '+vm.code+': '+sdkSummary(list)+'. Bấm để '+(canEdit?'xem và sửa':'xem')} className={'vm-sdk-cell2 vm-cell-trigger'+(draft?' vm-has-draft':'')} data-cell={vm.id+'|sdk'}
      onClick={()=>setOpen(o=>!o)} onKeyDown={e=>{if((e.key==='Enter'||e.key==='F2'||e.key===' ')&&!open){e.preventDefault();setOpen(true);}}}>{view}</div>
    {open&&typeof document!=='undefined'&&createPortal(<div ref={pop} role="dialog" aria-label={`SDK ${vm.server} / ${vm.code}`} className="vm-status-pop vm-sdk-pop vm-sdk-list-pop" style={{top:pos?.top??-9999,left:pos?.left??-9999,maxHeight:pos?.maxHeight}}>
      <SdkEditor projectId={projectId} vm={vm} account={account} canEdit={canEdit} draft={draft} onDraft={onDraft} onBusy={b=>{busy.current=b;onBusy(vm.id,b);}} onCancel={()=>close()}/>
    </div>,document.body)}
  </div>;
}
type EditorProps={projectId:string;vm:ManagedVM;account:VmAccount|undefined;canEdit:boolean;draft:SdkDraft|null;onDraft:(d:SdkDraft|null)=>void;onBusy?:(b:boolean)=>void;onDone?:()=>void;onCancel?:()=>void;embedded?:boolean};
export function SdkEditor(props:EditorProps){
  const session=useSession();
  if(session.status==='loading')return <p className="text-xs pm-muted p-3"><Loader2 size={12} className="inline animate-spin"/> Đang tải…</p>;
  return <SdkListEditor {...props} userId={(session.data?.user as {id?:string}|undefined)?.id||'anon'}/>;
}
/**
 * The SDK list of a VM: Mã SDK + Copy | Tiền tích luỹ USD | Ghi chú | Đã dùng, unused first. Money / note save in place (Enter; Esc
 * cancels) on the same record as Kho SDK; ticking "Đã dùng" is recorded at once and cannot be undone; an unused code can go back to the
 * store. Adding a code (typed, or "Chọn SDK đã lưu" from the store / another VM with an explicit source) never replaces another one.
 */
function SdkListEditor({projectId,vm,canEdit,draft,onDraft,onBusy,onCancel,embedded,userId}:EditorProps&{userId:string}){
  const store=trpc.vmManagement.sdkStore.useQuery({projectId},{staleTime:10000}),add=trpc.vmManagement.sdkListAdd.useMutation(),used=trpc.vmManagement.sdkUsed.useMutation(),remove=trpc.vmManagement.sdkListRemove.useMutation(),info=trpc.vmManagement.sdkInfo.useMutation();
  const refresh=useVMRefresh(),utils=trpc.useUtils();
  const own=draft&&(!draft.base||draft.base.userId===userId&&draft.base.projectId===projectId&&draft.base.vmId===vm.id)?{...draft,cycle:draft.cycle??draft.base?.cycle}:null;
  const [d,setD]=useState<SdkDraft>(own||{code:''}),[error,setError]=useState(''),[lost,setLost]=useState(false),[busy,setBusy]=useState<string|null>(null),[picking,setPicking]=useState(false),[q,setQ]=useState(''),[history,setHistory]=useState<string|null>(null);
  const busyRef=useRef(false),codeInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{if(!embedded)requestAnimationFrame(()=>codeInput.current?.focus({preventScroll:true}));},[embedded]);
  const dirty=!!(d.code.trim()||d.amount?.trim()||d.note?.trim());
  useEffect(()=>{onDraft(dirty?{...d,base:{userId,projectId,vmId:vm.id,cycle:d.cycle??vm.cycle}}:null);},[d,dirty]);// eslint-disable-line react-hooks/exhaustive-deps
  const byCode=useMemo(()=>new Map((store.data||[]).map(r=>[r.code,r])),[store.data]);
  const code=d.code.trim(),target=code?byCode.get(code):undefined,inList=vm.sdks.some(s=>s.code===code);
  // Bind the draft to what the person saw: the round when typing started and the version of the typed code once the store answered.
  useEffect(()=>{if(!code||!store.data||d.seen?.code===code)return;setD(p=>({...p,seen:{code,revision:target?.revision??null}}));},[code,store.data]);// eslint-disable-line react-hooks/exhaustive-deps
  const seenRev=d.seen?.code===code?d.seen.revision:target?.revision??null,draftCycle=d.cycle??vm.cycle;
  const recheck=!!code&&!inList&&(draftCycle!==vm.cycle?'VM đã được tạo lại (lượt '+vm.cycle+'); kiểm tra lại mã đang nhập rồi bấm Thêm.':d.seen?.code===code&&!!store.data&&(target?.revision??null)!==seenRev?'SDK '+shortCode(code)+' vừa được người khác '+(seenRev===null?'thêm':'sửa')+'; xem lại tiền / ghi chú ở trên rồi bấm Thêm.':'');
  const codeError=code&&!SDK_PATTERN.test(code)?'Mã SDK 8–128 ký tự chữ/số/._:-':'';
  const amountCheck=d.amount?.trim()?parseSdkAmount(d.amount.trim()):null,amountError=amountCheck&&'error' in amountCheck?amountCheck.error:'';
  const elsewhere=!inList&&target?.vm&&target.vm.id!==vm.id?target.vm:null;
  const blocked=!inList&&target&&target.state!=='UNLINKED'?(target.state==='LINKED'?'SDK này đã dùng cho một tài khoản EarnApp; chỉ giữ để tra cứu, không cấp lại.':'SDK dữ liệu cũ chưa xác nhận đã dùng hay chưa; xác nhận ở Kho SDK trước.'):'';
  const ready=!!code&&!codeError&&!amountError&&!blocked&&!inList&&(d.note||'').length<=SDK_NOTE_MAX&&!!store.data;
  // "Kiểm tra lại": the person has seen the newer round / version; nothing is saved by this click.
  const accept=()=>setD(p=>({...p,cycle:vm.cycle,seen:{code,revision:target?.revision??null},pending:undefined}));
  async function run(label:string,fn:()=>Promise<{message:string;changed:boolean}>,after?:()=>void){
    if(busyRef.current)return false;busyRef.current=true;setBusy(label);setError('');onBusy?.(true);
    try{const r=await fn();await Promise.all([refresh(),utils.vmManagement.sdkStore.invalidate(),utils.vmManagement.sdkDetail.invalidate()]);toast.success(vm.code+': '+r.message,{duration:2500});after?.();return true;}
    // Refused (a newer round / version, someone else saved first): reload so the frame shows what is stored now; the typed content stays.
    catch(e){setError(errorMessage(e));setLost(!(e as {data?:unknown})?.data);void Promise.all([refresh(),utils.vmManagement.sdkStore.invalidate()]).catch(()=>{});return false;}
    finally{busyRef.current=false;setBusy(null);onBusy?.(false);}
  }
  const submit=()=>{if(!ready||busy)return;if(recheck){accept();return;}
    const input={projectId,vmId:vm.id,expectedCycle:draftCycle,code,expectedSdkRevision:seenRev,amount:d.amount?.trim()?d.amount.trim():undefined,note:d.note?.trim()?d.note.trim():undefined,
      from:elsewhere?{vmId:elsewhere.id,expectedRevision:elsewhere.revision}:null};
    const sig=JSON.stringify(input),key=d.pending?.sig===sig?d.pending.key:crypto.randomUUID();setD(p=>({...p,pending:{sig,key}}));
    void run('add',()=>add.mutateAsync({...input,key}),()=>{setD({code:''});onDraft(null);});};
  const keys=(e:React.KeyboardEvent)=>{if(e.nativeEvent.isComposing||e.keyCode===229)return;
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(dirty){setD({code:''});onDraft(null);}else onCancel?.();}
    else if(e.key==='Enter'){e.preventDefault();submit();}};
  const choices=useMemo(()=>{const n=q.trim().toLowerCase();return (store.data||[]).filter(r=>r.state==='UNLINKED'&&r.vm?.id!==vm.id&&(!n||(r.code+' '+placeText(r)+' '+(r.note||'')).toLowerCase().includes(n)))
    .sort((a,b)=>Number(!!a.vm)-Number(!!b.vm)||Number(b.amount??-1)-Number(a.amount??-1)||a.code.localeCompare(b.code)).slice(0,100);},[store.data,q,vm.id]);
  const here=vm.server+' / '+vm.code;
  return <div className="vm-sdk-editor">
    <div className="vm-sdk-editor-body">
      {!embedded&&<p className="vm-status-pop-title"><strong>{here}</strong> · SDK EarnApp · {sdkSummary(vm.sdks)}</p>}
      {!canEdit&&<p className="text-xs pm-muted">Chỉ xem: tài khoản này chưa có quyền ghi SDK.</p>}
      {vm.sdks.length?<table className="vm-sdk-list"><thead><tr><th>Mã SDK</th><th>Tiền tích luỹ USD</th><th>Ghi chú</th><th>Đã dùng</th></tr></thead>
        <tbody>{vm.sdks.map(s=><SdkRow key={s.recordId} s={s} vm={vm} canEdit={canEdit} busy={busy} onHistory={()=>setHistory(h=>h===s.recordId?null:s.recordId)} historyOpen={history===s.recordId} projectId={projectId}
          onInfo={(patch)=>run('info:'+s.recordId,()=>info.mutateAsync({projectId,key:crypto.randomUUID(),sdkId:s.recordId,expectedRevision:s.revision,...patch}).then(r=>({...r,message:r.changed?'Đã lưu SDK '+shortCode(s.code):'Giữ nguyên'})))}
          onUsed={()=>{const input={projectId,vmId:vm.id,expectedCycle:vm.cycle,sdkId:s.recordId,expectedRevision:s.revision};return run('used:'+s.recordId,()=>used.mutateAsync({...input,key:crypto.randomUUID()}));}}
          onRemove={()=>{const input={projectId,vmId:vm.id,expectedCycle:vm.cycle,sdkId:s.recordId,expectedRevision:s.revision};return run('remove:'+s.recordId,()=>remove.mutateAsync({...input,key:crypto.randomUUID()}));}}/>)}</tbody></table>
        :<p className="text-xs pm-muted">VM chưa có SDK nào. Thêm mã ở dưới.</p>}
      {history&&<SdkTimeline projectId={projectId} sdkId={history}/>}
      {canEdit&&<div className="vm-sdk-add" data-sdk-edit>
        <p className="text-xs font-semibold">Thêm SDK vào VM (không thay mã đang có)</p>
        <div className="vm-sdk-add-grid">
          <input ref={codeInput} className="pm-input pm-code" aria-label={'Mã SDK mới cho '+vm.code} placeholder="Mã SDK" value={d.code} maxLength={128} readOnly={!!busy} spellCheck={false} onChange={e=>setD(p=>({...p,code:e.target.value,cycle:p.cycle??vm.cycle,pending:undefined}))} onKeyDown={keys}/>
          <input className="pm-input" inputMode="decimal" aria-label={'Tiền tích luỹ USD của mã mới '+vm.code} placeholder="Tiền USD (không bắt buộc)" value={d.amount||''} readOnly={!!busy} onChange={e=>setD(p=>({...p,amount:e.target.value,cycle:p.cycle??vm.cycle,pending:undefined}))} onKeyDown={keys}/>
          <input className="pm-input" aria-label={'Ghi chú mã mới '+vm.code} placeholder="Ghi chú (không bắt buộc)" value={d.note||''} maxLength={SDK_NOTE_MAX} readOnly={!!busy} onChange={e=>setD(p=>({...p,note:e.target.value,cycle:p.cycle??vm.cycle,pending:undefined}))} onKeyDown={keys}/>
          <button type="button" className="pm-button pm-button-primary" disabled={!ready||!!busy} onClick={submit}>{busy==='add'?'Đang lưu…':recheck?'Kiểm tra lại':elsewhere?'Dùng cho VM này':'Thêm'}</button>
        </div>
        {codeError&&<p className="vm-cell-error" role="alert">{codeError}</p>}{amountError&&<p className="vm-cell-error" role="alert">{amountError}</p>}
        {blocked&&<p className="vm-status-error" role="alert">{blocked}</p>}
        {recheck&&!blocked&&<p className="vm-status-error" role="alert">{recheck}</p>}
        {inList&&<p className="text-xs pm-muted">Mã này đã ở trong danh sách của VM.</p>}
        {!inList&&code&&!codeError&&!blocked&&<p className="text-xs" aria-live="polite">{target?<>Mã đã lưu · {placeText(target)} · <span className={stateClass(target.state)}>{SDK_STATE_LABEL[target.state]}</span>{elsewhere?' · sẽ chuyển rõ '+placeText(target)+' → '+here:''}</>:<span className="pm-muted">Mã mới: chưa có tiền / ghi chú riêng.</span>}</p>}
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" className={'pm-button pm-button-quiet'+(picking?' active':'')} aria-expanded={picking} disabled={!!busy} onClick={()=>setPicking(p=>!p)}><Search size={14}/>Chọn SDK đã lưu</button>
          {!embedded&&<button type="button" className="pm-button pm-button-quiet" disabled={!!busy} onClick={()=>{setD({code:''});onDraft(null);onCancel?.();}}>Đóng</button>}
        </div>
        {picking&&<div className="vm-sdk-pick">
          <input className="pm-input" placeholder="Tìm mã, server, VM, ghi chú…" aria-label="Tìm SDK đã lưu" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setPicking(false);}}}/>
          {store.isLoading&&<p className="text-xs pm-muted"><Loader2 size={12} className="inline animate-spin"/> Đang tải kho…</p>}
          <ul role="listbox" aria-label="SDK chưa dùng có thể thêm">{choices.map(r=><li key={r.id}><button type="button" role="option" aria-selected={code===r.code} className={code===r.code?'active':''} onClick={()=>{setD({code:r.code,cycle:vm.cycle,seen:{code:r.code,revision:r.revision}});setPicking(false);}}>
            <code className="vm-sdk">{shortCode(r.code,10)}</code><span>{r.amount!==null?formatSdkAmount(r.amount):<span className="pm-muted">Chưa ghi tiền</span>}</span><span className={r.vm?'text-amber-700':'pm-muted'}>{placeText(r)}</span>{r.note&&<span className="pm-muted vm-ellipsis">{r.note}</span>}</button></li>)}</ul>
          {store.data&&!choices.length&&<p className="text-xs pm-muted">Không có SDK chưa dùng nào khác trong dự án.</p>}
          <p className="text-xs pm-muted">Chỉ SDK chưa dùng. SDK đang ở VM khác được chuyển rõ nguồn → đích khi bấm Dùng cho VM này.</p>
        </div>}
      </div>}
      {error&&<p role="alert" className="vm-status-error">{error}{d.pending&&lost?' Bấm lại với cùng nội dung sẽ gửi lại đúng yêu cầu này (không ghi hai lần).':''}</p>}
      <p className="text-xs pm-muted">Enter lưu · Esc huỷ. Tiền là tiền tích luỹ USD của mã, không phải chi phí hay doanh thu. Ghi SDK không đổi tài khoản, PayPal hay tình trạng VM.</p>
    </div>
  </div>;
}
// One code of the list. Money / note: click to edit, Enter saves, Esc cancels (a Vietnamese IME composing never saves).
function SdkRow({s,vm,canEdit,busy,onInfo,onUsed,onRemove,onHistory,historyOpen}:{s:VmSdk;vm:ManagedVM;canEdit:boolean;busy:string|null;projectId:string;historyOpen:boolean;onHistory:()=>void;onInfo:(p:{amount?:string|null;note?:string|null})=>Promise<boolean>;onUsed:()=>Promise<boolean>;onRemove:()=>Promise<boolean>}){
  const [edit,setEdit]=useState<'amount'|'note'|null>(null),[text,setText]=useState(''),[err,setErr]=useState('');
  const isUsed=s.state==='LINKED',rowBusy=!!busy&&busy.endsWith(s.recordId);
  const start=(f:'amount'|'note')=>{if(!canEdit)return;setErr('');setEdit(f);setText(f==='amount'?(s.amount!==null?(formatSdkAmount(s.amount)||'').replace(/\s*USD$/,''):''):(s.note||''));};
  const save=async()=>{if(!edit)return;const v=text.trim();
    if(edit==='amount'){if(v){const r=parseSdkAmount(v);if('error' in r){setErr(r.error);return;}}const ok=await onInfo({amount:v?v:null});if(ok)setEdit(null);}
    else{if(v.length>SDK_NOTE_MAX){setErr('Ghi chú tối đa '+SDK_NOTE_MAX+' ký tự');return;}const ok=await onInfo({note:v||null});if(ok)setEdit(null);}};
  const keys=(e:React.KeyboardEvent)=>{if(e.nativeEvent.isComposing||e.keyCode===229)return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setEdit(null);setErr('');}else if(e.key==='Enter'&&!(edit==='note'&&e.shiftKey)){e.preventDefault();void save();}};
  return <tr className={isUsed?'vm-sdk-used':''}>
    <td><span className="vm-sdk-line"><code className="vm-sdk vm-sdk-full" title={s.code}>{s.code}</code><button type="button" className="vm-cell-icon" aria-label={'Copy SDK '+s.code} title="Copy SDK" onClick={()=>copyCode(s.code,vm.code)}><Copy size={13}/></button>
      <button type="button" className="vm-cell-icon" aria-label={'Lịch sử SDK '+s.code} aria-expanded={historyOpen} title="Lịch sử mã" onClick={onHistory}><History size={13}/></button></span>
      {s.current&&<span className="vm-sdk-current">hiện hành</span>}</td>
    <td data-sdk-edit>{edit==='amount'?<input autoFocus className="pm-input vm-sdk-inline" inputMode="decimal" aria-label={'Tiền tích luỹ USD '+s.code} value={text} disabled={rowBusy} onChange={e=>{setText(e.target.value);setErr('');}} onKeyDown={keys}/>
      :<button type="button" className="vm-sdk-value" disabled={!canEdit} onClick={()=>start('amount')}>{s.amount!==null?formatSdkAmount(s.amount):<span className="pm-muted">{canEdit?'Ghi tiền':'Chưa ghi'}</span>}</button>}</td>
    <td data-sdk-edit>{edit==='note'?<textarea autoFocus rows={2} className="pm-input vm-sdk-inline" aria-label={'Ghi chú '+s.code} value={text} maxLength={SDK_NOTE_MAX} disabled={rowBusy} onChange={e=>{setText(e.target.value);setErr('');}} onKeyDown={keys}/>
      :<button type="button" className="vm-sdk-value vm-sdk-note" disabled={!canEdit} onClick={()=>start('note')}>{s.note||<span className="pm-muted">{canEdit?'Thêm ghi chú':'—'}</span>}</button>}
      {err&&<p className="vm-cell-error" role="alert">{err}</p>}</td>
    <td><label className="vm-sdk-used-check" title={isUsed?'Đã dùng'+(s.usedBy?' · '+s.usedBy:'')+(s.usedAt?' · '+localDate(s.usedAt):'')+'. Không bỏ được.':'Tick khi mã đã đưa vào một tài khoản EarnApp'}>
      <input type="checkbox" aria-label={'Đã dùng '+s.code} checked={isUsed} disabled={isUsed||!canEdit||rowBusy} onChange={()=>void onUsed()}/>
      <span className="text-xs">{isUsed?<>Đã dùng{s.usedBy?<span className="pm-muted"> · {s.usedBy}</span>:null}{s.usedAt?<span className="pm-muted"> · {localDate(s.usedAt)}</span>:null}</>:rowBusy&&busy?.startsWith('used')?'Đang ghi…':s.state==='UNCONFIRMED'?'Chưa xác nhận':'Chưa dùng'}</span></label>
      {!isUsed&&canEdit&&<button type="button" className="vm-cell-icon" aria-label={'Đưa '+s.code+' về kho'} title="Bỏ khỏi VM, đưa về kho (giữ tiền, ghi chú)" disabled={rowBusy} onClick={()=>void onRemove()}><Undo2 size={13}/></button>}</td>
  </tr>;
}
const KIND:Record<string,string>={CREATE:'Ghi mã',PLACE:'Đặt hiện hành',HOLD:'Thêm vào VM',MOVE:'Chuyển VM',REMOVE:'Rời VM',AMOUNT:'Sửa tiền',NOTE:'Sửa ghi chú',LINK:'Đã dùng (nối EarnApp)',USED:'Đã dùng',CONFIRM:'Xác nhận dữ liệu cũ',RECREATE:'Tạo lại VM',UNDO:'Hoàn tác',MIGRATE:'Chuyển dữ liệu'};
// History of one code: VMs it was on, moves, money / note edits (old → new), used mark and confirmations.
export function SdkTimeline({projectId,sdkId}:{projectId:string;sdkId:string}){
  const q=trpc.vmManagement.sdkDetail.useQuery({projectId,sdkId});
  if(q.error)return <p role="alert" className="pm-error text-xs">{q.error.message}</p>;
  if(!q.data)return <p className="text-xs pm-muted"><Loader2 size={12} className="inline animate-spin"/> Đang tải lịch sử…</p>;
  const text=(e:typeof q.data.events[number])=>{const x=e.detail||{};
    if(e.kind==='AMOUNT')return (formatSdkAmount(x.from as string|null)||'chưa ghi')+' → '+(formatSdkAmount(x.to as string|null)||'xoá');
    if(e.kind==='NOTE')return (x.from?'"'+String(x.from)+'"':'trống')+' → '+(x.to?'"'+String(x.to)+'"':'xoá');
    if(e.kind==='MOVE')return (e.from||'?')+' → '+(e.to||'?');if(e.kind==='PLACE'||e.kind==='HOLD')return e.to||'';if(e.kind==='REMOVE'||e.kind==='RECREATE')return (e.from||'')+(x.keptAs==='VM_LIST'?' · vẫn trong danh sách của VM':x.keptAs==='HISTORY'?' · giữ trong lịch sử':x.keptAs==='STORE'?' · về kho':'')+(x.replacedBy?' · thay bằng '+String(x.replacedBy):'');
    if(e.kind==='LINK')return String(x.login||'')+' · lượt '+String(x.cycle??'');if(e.kind==='USED')return (e.to||'')+' · lượt '+String(x.cycle??'');if(e.kind==='CONFIRM')return x.decision==='LINKED'?'đã từng dùng':'chưa từng dùng';if(e.kind==='CREATE')return (x.amount!=null?formatSdkAmount(String(x.amount)):'')+(x.note?' · '+String(x.note):'');
    return String(x.note||'');};
  return <ul className="vm-sdk-timeline">{q.data.events.map(e=><li key={e.id}><span className="pm-muted">{localDate(e.at)} · {e.by}</span><span><strong>{KIND[e.kind]||e.kind}</strong> {text(e)}</span></li>)}{!q.data.events.length&&<li className="pm-muted">Chưa có lịch sử.</li>}</ul>;
}
