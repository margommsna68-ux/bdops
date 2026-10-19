"use client";
import {useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ArrowRight,Copy,History,Loader2,Search} from 'lucide-react';
import toast from 'react-hot-toast';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {useSession} from 'next-auth/react';
import {trpc} from '@/lib/trpc';
import {useBusinessKey} from '@/components/business-management/shared';
import {formatSdkAmount,SDK_NOTE_MAX,SDK_STATE_LABEL,type SdkLinkState} from '@/lib/sdk-money';
import {localDate} from '@/components/proxy-management/HistoryPanel';
import {errorMessage,useVMRefresh,type ManagedVM} from '../shared';
import type {VmAccount} from './AccountCell';
import {shortCode} from './grid-model';
import {sdkFormValues} from './sdk-form';
export type StoreSdk=inferRouterOutputs<AppRouter>['vmManagement']['sdkStore'][number];
/** The versions an edit started from (owner brief 19/10/2026): who, which project / VM / round, and the revisions of the VM, of its
 *  current SDK and of the stored code being placed, as seen when the edit began. A draft is saved only against these: after the VM
 *  is recreated, the code moves or someone else edits it, the frame says so and waits for "Kiểm tra lại" (never takes the newer
 *  revision or round by itself). */
export interface SdkDraftBase {userId:string;projectId:string;vmId:string;cycle:number;vmRevision:number;sdkRevision:number|null}
export interface SdkSeen {code:string;revision:number|null;fromVmId:string|null;fromRevision:number|null}
/** amount / note undefined = not edited: the field shows (and keeps) the stored value of the code in the code field.
 *  `pending` = the request of a save whose answer was lost: a retry of the same content reuses its key (no second write). */
export interface SdkDraft {code:string;amount?:string;note?:string;base?:SdkDraftBase;seen?:SdkSeen;pending?:{sig:string;key:string}}
const SDK_PATTERN=/^[A-Za-z0-9._:-]{8,128}$/;
export const stateClass=(s:SdkLinkState|null|undefined)=>s==='LINKED'?'vm-sdk-state-linked':s==='UNCONFIRMED'?'vm-sdk-state-unconfirmed':'vm-sdk-state-free';
export const placeText=(r:{vm:StoreSdk['vm']})=>r.vm?r.vm.server+' / '+r.vm.code+(r.vm.deleted?' (đã xoá)':''):'Trong kho';
// Fixed-position popover next to a cell (portal: never clipped by the table's scroll area). Opens below, or above when there is no
// room; a popover taller than the window keeps its footer (the save button) on screen and scrolls its body.
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
// SDK cell: two short lines (code + copy; money · link state). The copy button only copies. Clicking the rest opens the SDK frame next
// to the cell. A frame closed with unsaved changes keeps them as a draft (marked in the cell); Esc / Huỷ drops them.
export function SdkCell({projectId,vm,account,canEdit,draft,onDraft,onBusy}:{projectId:string;vm:ManagedVM;account:VmAccount|undefined;canEdit:boolean;draft:SdkDraft|null;onDraft:(d:SdkDraft|null)=>void;onBusy:(vmId:string,busy:boolean)=>void}){
  const [open,setOpen]=useState(false),anchor=useRef<HTMLDivElement>(null),pop=useRef<HTMLDivElement>(null),pos=useAnchored(open,anchor,pop,380);
  const onDraftRef=useRef(onDraft);onDraftRef.current=onDraft;const busy=useRef(false),close=(refocus=true)=>{if(busy.current)return;setOpen(false);if(refocus)anchor.current?.focus({preventScroll:true});};const closeRef=useRef(close);closeRef.current=close;
  useEffect(()=>{if(!open)return;const down=(e:MouseEvent)=>{if(!pop.current?.contains(e.target as Node)&&!anchor.current?.contains(e.target as Node))closeRef.current(false);};
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing){e.stopPropagation();e.preventDefault();if(!busy.current){onDraftRef.current(null);closeRef.current();}}};
    document.addEventListener('mousedown',down);document.addEventListener('keydown',key,true);return ()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key,true);};},[open]);
  const s=vm.sdk,money=s?(s.amount!==null?formatSdkAmount(s.amount):'Chưa ghi tiền'):null;
  const view=<>{s?<span className="vm-sdk-line"><code className="vm-sdk vm-ellipsis" title={s.id}>{shortCode(s.id)}</code><button type="button" className="vm-cell-icon" aria-label={'Copy SDK '+vm.code} title="Copy SDK đầy đủ" onClick={e=>{e.stopPropagation();copyCode(s.id,vm.code);}} onKeyDown={e=>e.stopPropagation()}><Copy size={13}/></button></span>:<span className="vm-sdk-missing">Chưa có SDK</span>}
    {s&&<span className="vm-sdk-sub"><span className={s.amount===null?'pm-muted':''}>{money}</span> · <span className={stateClass(s.state)}>{SDK_STATE_LABEL[s.state]}</span></span>}
    {draft&&<span className="vm-sdk-draft" title="Có thay đổi chưa lưu; mở ô để lưu hoặc huỷ">● Nháp chưa lưu</span>}</>;
  if(vm.archivedAt)return <div className="vm-sdk-cell2">{view}</div>;
  return <div className="vm-status">
    <div ref={anchor} role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={open} aria-label={'SDK '+vm.code+(s?': '+s.id:': chưa có')+'. Bấm để '+(canEdit?'sửa':'xem')} className={'vm-sdk-cell2 vm-cell-trigger'+(draft?' vm-has-draft':'')} data-cell={vm.id+'|sdk'}
      onClick={()=>setOpen(o=>!o)} onKeyDown={e=>{if((e.key==='Enter'||e.key==='F2'||e.key===' ')&&!open){e.preventDefault();setOpen(true);}}}>{view}</div>
    {open&&typeof document!=='undefined'&&createPortal(<div ref={pop} role="dialog" aria-label={`SDK ${vm.server} / ${vm.code}`} className="vm-status-pop vm-sdk-pop" style={{top:pos?.top??-9999,left:pos?.left??-9999,maxHeight:pos?.maxHeight}}>
      <SdkEditor projectId={projectId} vm={vm} account={account} canEdit={canEdit} draft={draft} onDraft={onDraft} onBusy={b=>{busy.current=b;onBusy(vm.id,b);}} onDone={()=>{setOpen(false);anchor.current?.focus({preventScroll:true});}} onCancel={()=>{onDraft(null);close();}}/>
    </div>,document.body)}
  </div>;
}
/**
 * The SDK frame (cell popover and the VM side panel): code, accumulated money (USD), note, "Chọn SDK đã lưu", save, remove from the VM,
 * "Đã nối EarnApp" and the code's history. Every save goes through vmManagement.sdkSave / sdkLink (same checks as paste and Kho SDK).
 */
export function SdkEditor({projectId,vm,account,canEdit,draft,onDraft,onBusy,onDone,onCancel,embedded}:{projectId:string;vm:ManagedVM;account:VmAccount|undefined;canEdit:boolean;draft:SdkDraft|null;onDraft:(d:SdkDraft|null)=>void;onBusy?:(b:boolean)=>void;onDone?:()=>void;onCancel?:()=>void;embedded?:boolean}){
  const store=trpc.vmManagement.sdkStore.useQuery({projectId},{staleTime:10000}),save=trpc.vmManagement.sdkSave.useMutation(),link=trpc.vmManagement.sdkLink.useMutation(),refresh=useVMRefresh(),utils=trpc.useUtils();
  const session=useSession(),userId=(session.data?.user as {id?:string}|undefined)?.id||'anon';
  const cur=vm.sdk,base:SdkDraft={code:cur?.id||''};
  const live=():SdkDraftBase=>({userId,projectId,vmId:vm.id,cycle:vm.cycle,vmRevision:vm.revision,sdkRevision:cur?.recordId?cur.revision:null});
  // A stored draft of another person, project or VM is never used here.
  const own=draft&&(!draft.base||draft.base.userId===userId&&draft.base.projectId===projectId&&draft.base.vmId===vm.id)?draft:null;
  const [d,setD]=useState<SdkDraft>(own||base),[error,setError]=useState(''),[busy,setBusy]=useState<'save'|'remove'|'link'|null>(null),[picking,setPicking]=useState(false),[history,setHistory]=useState(false),[q,setQ]=useState('');
  const busyRef=useRef(false),codeInput=useRef<HTMLInputElement>(null),resync=useRef(false),keyFor=useBusinessKey();
  useEffect(()=>{if(resync.current){resync.current=false;setD(base);}},[cur?.id,cur?.revision,cur?.amount,cur?.note]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{if(!embedded)requestAnimationFrame(()=>codeInput.current?.focus({preventScroll:true}));},[embedded]);
  const byCode=useMemo(()=>new Map((store.data||[]).map(r=>[r.code,r])),[store.data]);
  const code=d.code.trim(),target=code?byCode.get(code):undefined,isCurrent=!!cur&&code===cur.id;
  // The values the form is compared with: the target code's own stored money / note (a new code has none).
  const stored=isCurrent?{amount:cur!.amount,note:cur!.note}:target?{amount:target.amount,note:target.note}:{amount:null,note:null};
  const form=sdkFormValues(stored,d),{amountText,noteText,amountError,amountChanged,noteChanged}=form;
  const elsewhere=!isCurrent&&target?.vm&&target.vm.id!==vm.id?target.vm:null;
  const blocked=!isCurrent&&target&&target.state!=='UNLINKED'?(target.state==='LINKED'?'SDK này đã nối EarnApp; chỉ giữ để tra cứu, không dùng lại.':'SDK dữ liệu cũ chưa xác nhận đã nối hay chưa; xác nhận ở Kho SDK trước.'):'';
  const codeError=code&&!SDK_PATTERN.test(code)?'Mã SDK 8–128 ký tự chữ/số/._:-':'';
  const changed=!isCurrent&&!!code||amountChanged||noteChanged,valid=!!code&&!codeError&&!amountError&&!blocked&&noteText.length<=SDK_NOTE_MAX;
  const dirty=d.code!==base.code||amountChanged||noteChanged;
  // The edit's starting point: fixed once something is typed (kept in the draft), following the VM while nothing is.
  const start=d.base||live();
  useEffect(()=>{if(dirty&&!d.base)setD(p=>({...p,base:live()}));if(!dirty&&d.base&&!d.pending)setD(p=>({...p,base:undefined,seen:undefined}));},[dirty]);// eslint-disable-line react-hooks/exhaustive-deps
  // The stored code being placed, as first seen for this code (a later version of it is a change by someone else).
  useEffect(()=>{if(isCurrent||!code||!store.data||d.seen?.code===code)return;setD(p=>({...p,seen:{code,revision:target?.revision??null,fromVmId:target?.vm?.id??null,fromRevision:target?.vm?.revision??null}}));},[code,isCurrent,store.data]);// eslint-disable-line react-hooks/exhaustive-deps
  const seen=!isCurrent&&code&&d.seen?.code===code?d.seen:null;
  const stale=!dirty?'':start.cycle!==vm.cycle?`VM đã sang lượt ${vm.cycle}; nháp này bắt đầu ở lượt ${start.cycle} nên không được lưu vào lượt mới.`
    :start.vmRevision!==vm.revision?'VM vừa thay đổi từ lúc bắt đầu sửa (SDK có thể đã chuyển máy hoặc VM vừa được tạo lại).'
    :isCurrent&&cur?.recordId&&cur.revision!==start.sdkRevision?'SDK này vừa được người khác sửa: tiền hiện '+(formatSdkAmount(cur.amount)||'chưa ghi')+'.'
    :seen&&target&&(target.revision!==seen.revision||(target.vm?.id??null)!==seen.fromVmId||(!!target.vm&&target.vm.revision!==seen.fromRevision))?'SDK '+shortCode(code)+' vừa thay đổi ở kho / VM khác: '+placeText(target)+(target.amount!==null?' · '+formatSdkAmount(target.amount):'')+'.'
    :seen&&!target&&seen.revision!==null?'SDK '+shortCode(code)+' không còn trong kho như lúc bắt đầu sửa.':'';
  const waitStore=!isCurrent&&!!code&&!seen; // the store has not loaded yet: what the code holds is not known
  // "Kiểm tra lại": start again from the current versions, keeping every typed character; the person then saves explicitly.
  const recheck=()=>{setError('');setD(p=>({...p,base:live(),seen:!isCurrent&&code?{code,revision:target?.revision??null,fromVmId:target?.vm?.id??null,fromRevision:target?.vm?.revision??null}:undefined,pending:undefined}));void utils.vmManagement.sdkStore.invalidate();};
  useEffect(()=>{onDraft(dirty?d:null);},[d,dirty]);// eslint-disable-line react-hooks/exhaustive-deps
  // A different code brings its own stored money / note; a brand-new code starts empty (never the replaced code's values). Values the
  // person typed stay.
  const setCode=(next:string)=>setD(prev=>({...prev,code:next}));
  async function run(kind:'save'|'remove'|'link',fn:()=>Promise<{message:string;changed:boolean}>){
    if(busyRef.current)return;busyRef.current=true;setBusy(kind);setError('');onBusy?.(true);
    try{const r=await fn();resync.current=true;await Promise.all([refresh(),utils.vmManagement.sdkStore.invalidate(),utils.vmManagement.sdkDetail.invalidate(),utils.vmManagement.sdkHistory.invalidate()]);toast.success(vm.code+': '+r.message,{duration:2500});onDraft(null);onDone?.();}
    catch(e){setError(errorMessage(e));} // the typed values (and the request key of this content) stay for a fix / retry
    finally{busyRef.current=false;setBusy(null);onBusy?.(false);}
  }
  const submit=()=>{if(!changed||!valid||busy||stale||waitStore)return;
    const input={projectId,vmId:vm.id,expectedVmRevision:start.vmRevision,expectedCycle:start.cycle,code,expectedSdkRevision:isCurrent?start.sdkRevision:seen!.revision,
      amount:form.amount,note:form.note,from:elsewhere&&seen?.fromVmId===elsewhere.id?{vmId:elsewhere.id,expectedRevision:seen.fromRevision!}:null};
    // Same content as a save whose answer was lost = same key (kept in the draft across reloads).
    const sig=JSON.stringify(input),key=d.pending?.sig===sig?d.pending.key:crypto.randomUUID(),next={...d,base:start,pending:{sig,key}};
    setD(next);onDraft(next);void run('save',()=>save.mutateAsync({...input,key}));};
  const keys=(e:React.KeyboardEvent,multiline=false)=>{if(e.nativeEvent.isComposing||e.keyCode===229)return;// Vietnamese IME still composing
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setD(base);onDraft(null);onCancel?.();}
    else if(e.key==='Enter'&&!(multiline&&e.shiftKey)){e.preventDefault();submit();}};
  const choices=useMemo(()=>{const n=q.trim().toLowerCase();return (store.data||[]).filter(r=>r.state==='UNLINKED'&&r.vm?.id!==vm.id&&(!n||(r.code+' '+placeText(r)+' '+(r.note||'')).toLowerCase().includes(n)))
    .sort((a,b)=>Number(!!a.vm)-Number(!!b.vm)||Number(b.amount??-1)-Number(a.amount??-1)||a.code.localeCompare(b.code)).slice(0,100);},[store.data,q,vm.id]);
  const here=vm.server+' / '+vm.code,canLink=!!cur&&!dirty&&cur.state!=='LINKED'&&!!cur.recordId;
  return <div className="vm-sdk-editor">
    <div className="vm-sdk-editor-body">
      {!embedded&&<p className="vm-status-pop-title"><strong>{here}</strong> · SDK EarnApp</p>}
      {!canEdit&&<p className="text-xs pm-muted">Chỉ xem: tài khoản này chưa có quyền ghi SDK.</p>}
      <label className="pm-label text-xs">Mã SDK<input ref={codeInput} className="pm-input pm-code" aria-label={'Mã SDK '+vm.code} value={d.code} maxLength={128} readOnly={!canEdit||!!busy} spellCheck={false} onChange={e=>setCode(e.target.value)} onKeyDown={e=>keys(e)}/></label>
      {codeError&&<p className="vm-cell-error" role="alert">{codeError}</p>}
      {!isCurrent&&code&&!codeError&&<p className="text-xs" aria-live="polite">{target?<>Mã đã lưu · {placeText(target)} · <span className={stateClass(target.state)}>{SDK_STATE_LABEL[target.state]}</span></>:<span className="pm-muted">Mã mới: chưa có tiền / ghi chú riêng.</span>}{cur&&!blocked?<span className="pm-muted"> {cur.id} {cur.state==='LINKED'?'giữ trong lịch sử':'giữ trong kho với tiền / ghi chú của nó'}.</span>:null}</p>}
      {blocked&&<p className="vm-status-error" role="alert">{blocked}</p>}
      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <label className="pm-label text-xs">Tiền tích luỹ (USD)<input className="pm-input" inputMode="decimal" aria-label={'Tiền tích luỹ SDK '+vm.code} placeholder="Chưa ghi tiền" value={amountText} readOnly={!canEdit||!!busy} onChange={e=>setD({...d,amount:e.target.value})} onKeyDown={e=>keys(e)}/></label>
        <span className="text-xs pm-muted pb-2">{stored.amount!==null?'Đang lưu '+formatSdkAmount(stored.amount):'Chưa ghi'}</span>
      </div>
      {amountError&&<p className="vm-cell-error" role="alert">{amountError}</p>}
      <label className="pm-label text-xs">Ghi chú SDK<textarea className="pm-input" rows={2} maxLength={SDK_NOTE_MAX} aria-label={'Ghi chú SDK '+vm.code} value={noteText} readOnly={!canEdit||!!busy} onChange={e=>setD({...d,note:e.target.value})} onKeyDown={e=>keys(e,true)}/></label>
      {canEdit&&<div className="flex flex-wrap gap-2 items-center">
        <button type="button" className={'pm-button pm-button-quiet'+(picking?' active':'')} aria-expanded={picking} disabled={!!busy} onClick={()=>setPicking(p=>!p)}><Search size={14}/>Chọn SDK đã lưu</button>
        {cur?.recordId&&<button type="button" className="pm-button pm-button-quiet" aria-expanded={history} onClick={()=>setHistory(h=>!h)}><History size={14}/>Lịch sử</button>}
      </div>}
      {!canEdit&&cur?.recordId&&<button type="button" className="pm-button pm-button-quiet w-fit" aria-expanded={history} onClick={()=>setHistory(h=>!h)}><History size={14}/>Lịch sử</button>}
      {picking&&canEdit&&<div className="vm-sdk-pick">
        <input className="pm-input" placeholder="Tìm mã, server, VM, ghi chú…" aria-label="Tìm SDK đã lưu" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setPicking(false);}}}/>
        {store.isLoading&&<p className="text-xs pm-muted"><Loader2 size={12} className="inline animate-spin"/> Đang tải kho…</p>}
        <ul role="listbox" aria-label="SDK chưa nối có thể dùng">{choices.map(r=><li key={r.id}><button type="button" role="option" aria-selected={code===r.code} className={code===r.code?'active':''} onClick={()=>{setD(p=>({...p,code:r.code,amount:undefined,note:undefined,seen:undefined,pending:undefined}));setPicking(false);}}>
          <code className="vm-sdk">{shortCode(r.code,10)}</code><span>{r.amount!==null?formatSdkAmount(r.amount):<span className="pm-muted">Chưa ghi tiền</span>}</span><span className={r.vm?'text-amber-700':'pm-muted'}>{placeText(r)}</span>{r.note&&<span className="pm-muted vm-ellipsis">{r.note}</span>}</button></li>)}</ul>
        {store.data&&!choices.length&&<p className="text-xs pm-muted">Không có SDK chưa nối nào khác trong dự án.</p>}
        <p className="text-xs pm-muted">Chỉ SDK chưa từng nối EarnApp. SDK đang ở VM khác sẽ được chuyển rõ nguồn → đích khi bấm Dùng cho VM này.</p>
      </div>}
      {history&&cur?.recordId&&<SdkTimeline projectId={projectId} sdkId={cur.recordId}/>}
      {cur&&!dirty&&<div className="vm-sdk-link">
        {cur.state==='LINKED'?<p className="text-xs"><span className="vm-sdk-state-linked">Đã nối EarnApp</span>{(()=>{const r=byCode.get(cur.id);return r?.linkedLogin?<> · {r.linkedLogin}{r.linkedAt?' · '+localDate(r.linkedAt):''}</>:null;})()}. Mã chỉ để tra cứu, không dùng lại.</p>
          :canEdit&&(account?.earnApp?<><p className="text-xs">Ghi nhận <code className="vm-sdk">{shortCode(cur.id)}</code> đã nối với <strong>{account.earnApp.login.email}</strong> (lượt {vm.cycle}). Sau đó mã không dùng lại được.</p>
            <button type="button" className="pm-button w-full" disabled={!!busy||!canLink} onClick={()=>{const input={projectId,vmId:vm.id,sdkId:cur.recordId!,expectedSdkRevision:cur.revision,earnAppId:account.earnApp!.id,expectedCycle:vm.cycle};void run('link',()=>link.mutateAsync({...input,key:keyFor(input)}));}}>{busy==='link'?'Đang ghi…':'Đã nối EarnApp'}</button></>
            :<p className="text-xs pm-muted">Chưa có tài khoản EarnApp trên VM này: gán ở ô Tài khoản trước khi ghi Đã nối EarnApp.</p>)}
      </div>}
      {stale&&canEdit&&<div className="pm-review text-xs" role="alert"><p>{stale} Nội dung đang nhập được giữ, chưa ghi gì.</p><button type="button" className="pm-button mt-1" disabled={!!busy} onClick={recheck}>Kiểm tra lại</button></div>}
      {waitStore&&canEdit&&changed&&<p className="text-xs pm-muted"><Loader2 size={12} className="inline animate-spin"/> Đang tải kho SDK để biết mã này đang ở đâu…</p>}
      {error&&<p role="alert" className="vm-status-error">{error}{d.pending?' Lưu lại với cùng nội dung sẽ gửi lại đúng yêu cầu này (không ghi hai lần).':''}</p>}
    </div>
    {canEdit&&<div className="vm-sdk-editor-foot">
      {elsewhere&&changed&&valid&&<p className="vm-sdk-route" aria-live="polite"><span>{placeText(target!)}</span><ArrowRight size={13}/><strong>{here}</strong></p>}
      <div className="flex gap-2 justify-end flex-wrap">
        {cur&&<button type="button" className="pm-button pm-button-quiet" disabled={!!busy} title="Mã vẫn giữ trong kho / lịch sử" onClick={()=>{const input={projectId,vmId:vm.id,expectedVmRevision:vm.revision,expectedCycle:vm.cycle,code:null,expectedSdkRevision:null};void run('remove',()=>save.mutateAsync({...input,key:keyFor(input)}));}}>{busy==='remove'?'Đang gỡ…':'Gỡ khỏi VM'}</button>}
        {!embedded&&<button type="button" className="pm-button pm-button-quiet" disabled={!!busy} onClick={()=>{onDraft(null);onCancel?.();}}>Huỷ</button>}
        <button type="button" className="pm-button pm-button-primary" disabled={!changed||!valid||!!busy||!!stale||waitStore} onClick={submit}>{busy==='save'?'Đang lưu…':elsewhere?'Dùng cho VM này':!isCurrent&&target?'Dùng cho VM này':'Lưu'}</button>
      </div>
      <p className="text-xs pm-muted">Enter lưu · Esc huỷ. Ghi SDK không đổi tài khoản, PayPal hay tình trạng VM.</p>
    </div>}
  </div>;
}
const KIND:Record<string,string>={CREATE:'Ghi mã',PLACE:'Đặt lên VM',MOVE:'Chuyển VM',REMOVE:'Rời VM',AMOUNT:'Sửa tiền',NOTE:'Sửa ghi chú',LINK:'Đã nối EarnApp',CONFIRM:'Xác nhận dữ liệu cũ',RECREATE:'Tạo lại VM',UNDO:'Hoàn tác',MIGRATE:'Chuyển dữ liệu'};
// History of one code: VMs it was on, moves, money / note edits (old → new), link and confirmations.
export function SdkTimeline({projectId,sdkId}:{projectId:string;sdkId:string}){
  const q=trpc.vmManagement.sdkDetail.useQuery({projectId,sdkId});
  if(q.error)return <p role="alert" className="pm-error text-xs">{q.error.message}</p>;
  if(!q.data)return <p className="text-xs pm-muted"><Loader2 size={12} className="inline animate-spin"/> Đang tải lịch sử…</p>;
  const text=(e:typeof q.data.events[number])=>{const x=e.detail||{};
    if(e.kind==='AMOUNT')return (formatSdkAmount(x.from as string|null)||'chưa ghi')+' → '+(formatSdkAmount(x.to as string|null)||'xoá');
    if(e.kind==='NOTE')return (x.from?'"'+String(x.from)+'"':'trống')+' → '+(x.to?'"'+String(x.to)+'"':'xoá');
    if(e.kind==='MOVE')return (e.from||'?')+' → '+(e.to||'?');if(e.kind==='PLACE')return e.to||'';if(e.kind==='REMOVE'||e.kind==='RECREATE')return (e.from||'')+(x.keptAs==='HISTORY'?' · giữ trong lịch sử':x.keptAs==='STORE'?' · về kho':'')+(x.replacedBy?' · thay bằng '+String(x.replacedBy):'');
    if(e.kind==='LINK')return String(x.login||'')+' · lượt '+String(x.cycle??'');if(e.kind==='CONFIRM')return x.decision==='LINKED'?'đã từng nối':'chưa từng nối';if(e.kind==='CREATE')return (x.amount!=null?formatSdkAmount(String(x.amount)):'')+(x.note?' · '+String(x.note):'');
    return String(x.note||'');};
  return <ul className="vm-sdk-timeline">{q.data.events.map(e=><li key={e.id}><span className="pm-muted">{localDate(e.at)} · {e.by}</span><span><strong>{KIND[e.kind]||e.kind}</strong> {text(e)}</span></li>)}{!q.data.events.length&&<li className="pm-muted">Chưa có lịch sử.</li>}</ul>;
}
