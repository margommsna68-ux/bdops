"use client";
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {ChevronDown,Loader2} from 'lucide-react';
import type {ManagedVM} from '../shared';
import {statusInfo,type StatusActionKind,type StatusRights,type StatusTone} from './status-actions';
const TONE:Record<StatusTone,string>={missing:'pm-badge-muted',pending:'vm-badge-pending',progress:'vm-badge-progress',failed:'pm-badge-red',installed:'pm-badge-green',review:'pm-badge-red',deleted:'pm-badge-muted'};
// Tình trạng at the cell: the badge is a button; a small popover next to it offers the actions the backend accepts now. Simple actions
// save on click (no extra Áp dụng/confirm); the popover itself shows the VM and the exact configuration for "Xác nhận đã cài".
// Escape or a click outside only closes it. Saving locks this row; an error keeps the old state and shows the reason here.
export function StatusCell({vm,rights,onAction,onBusy}:{vm:ManagedVM;rights:StatusRights;onAction:(vm:ManagedVM,kind:StatusActionKind,note?:string)=>Promise<string|void>;onBusy:(vmId:string,busy:boolean)=>void}){
  const s=statusInfo(vm,rights),[open,setOpen]=useState(false),[busy,setBusy]=useState<StatusActionKind|null>(null),[error,setError]=useState(''),[note,setNote]=useState(''),[writing,setWriting]=useState(false);
  const button=useRef<HTMLButtonElement>(null),pop=useRef<HTMLDivElement>(null),[pos,setPos]=useState<{top:number;left:number;up:boolean}|null>(null);
  const busyRef=useRef(false);busyRef.current=!!busy;
  const close=(refocus=true)=>{if(busyRef.current) return;setOpen(false);setError('');setWriting(false);if(refocus) button.current?.focus({preventScroll:true});};
  const closeRef=useRef(close);closeRef.current=close;
  // Fixed position in a portal: never clipped by the table's scroll area; follows the cell when the table or page scrolls.
  useLayoutEffect(()=>{if(!open) return;const place=()=>{const r=button.current?.getBoundingClientRect();if(!r) return;const h=pop.current?.offsetHeight||260,up=r.bottom+h+8>window.innerHeight&&r.top>h;setPos({top:up?r.top-h-6:r.bottom+6,left:Math.max(8,Math.min(r.left,window.innerWidth-332)),up});};
    place();window.addEventListener('scroll',place,true);window.addEventListener('resize',place);return ()=>{window.removeEventListener('scroll',place,true);window.removeEventListener('resize',place);};},[open,writing,error]);
  useEffect(()=>{if(!open) return;const down=(e:MouseEvent)=>{if(!pop.current?.contains(e.target as Node)&&!button.current?.contains(e.target as Node)) closeRef.current(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();closeRef.current();}};
    document.addEventListener('mousedown',down);document.addEventListener('keydown',key,true);requestAnimationFrame(()=>pop.current?.querySelector<HTMLElement>('button,textarea')?.focus({preventScroll:true}));return ()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key,true);};},[open]);
  async function run(kind:StatusActionKind,text?:string){
    if(busyRef.current) return;busyRef.current=true;setBusy(kind); // a second click before re-render is ignoredsetError('');onBusy(vm.id,true);
    try{await onAction(vm,kind,text);setOpen(false);setWriting(false);setNote('');}
    catch(e){setError(e instanceof Error?e.message:'Chưa lưu được');} // old state stays; reason shown here
    finally{setBusy(null);onBusy(vm.id,false);}
  }
  if(s.tone==='deleted') return <span className="pm-badge pm-badge-muted">Đã xoá</span>;
  const failure=s.actions.find(a=>a.kind==='FAIL'),current=vm.desired?.failureNote||'';
  return <div className="vm-status">
    <button ref={button} type="button" className={`pm-badge ${TONE[s.tone]} vm-status-button`} aria-haspopup="dialog" aria-expanded={open} aria-label={`Tình trạng ${vm.code}: ${s.label}. Bấm để thao tác`} disabled={!!busy} onClick={()=>open?close():setOpen(true)}>{busy?<Loader2 size={11} className="animate-spin"/>:null}{s.label}<ChevronDown size={11}/></button>
    {s.reason&&(s.tone==='failed'||s.tone==='review')&&<span className="pm-muted text-xs vm-ellipsis" title={s.reason}>{s.reason}</span>}
    {open&&typeof document!=='undefined'&&createPortal(<div ref={pop} role="dialog" aria-label={`Tình trạng ${vm.server} / ${vm.code}`} className="vm-status-pop" style={{top:pos?.top??-9999,left:pos?.left??-9999}}>
      <p className="vm-status-pop-title"><strong>{vm.server} / {vm.code}</strong> · {s.label}</p>
      {s.reason&&<p className="text-xs pm-muted">{s.reason}</p>}
      {s.actions.map(a=>a.kind==='CONFIRM'&&s.target?<div key={a.kind} className="vm-status-confirm">
          <p className="text-xs">Xác nhận đã cài đúng <strong className="pm-ip">{s.target.ip}{s.target.port?':'+s.target.port:''}</strong> (cấu hình #{s.target.version}) trên <strong>{vm.server} / {vm.code}</strong>.{vm.holds.some(h=>h.endpointId!==vm.desired?.endpointId)?' Các proxy cũ còn giữ trên VM sẽ được thả.':''}</p>
          <button type="button" className="pm-button pm-button-primary w-full" disabled={!!busy} onClick={()=>void run('CONFIRM')}>{busy==='CONFIRM'?'Đang xác nhận…':`Xác nhận đã cài ${s.target.ip}`}</button></div>
        :a.kind==='FAIL'?null
        :<button key={a.kind} type="button" className={'vm-status-action'+(a.kind==='START'?' primary':'')} disabled={!!busy} onClick={()=>void run(a.kind)}>{busy===a.kind?'Đang lưu…':a.label}</button>)}
      {failure&&(writing?<div className="space-y-2"><label className="pm-label text-xs">Vướng mắc khi cài<textarea className="pm-input" rows={3} maxLength={1000} value={note} disabled={!!busy} onChange={e=>setNote(e.target.value)}/></label>
          <div className="flex gap-2 justify-end"><button type="button" className="pm-button pm-button-quiet" disabled={!!busy} onClick={()=>setWriting(false)}>Thôi</button><button type="button" className="pm-button" disabled={!!busy||!note.trim()||note.trim()===current} onClick={()=>void run('FAIL',note.trim())}>{busy==='FAIL'?'Đang lưu…':'Lưu vướng mắc'}</button></div></div>
        :<button type="button" className="vm-status-action" disabled={!!busy} onClick={()=>{setNote(current);setWriting(true);}}>{failure.label}</button>)}
      {s.readOnlyNote&&<p className="text-xs pm-muted">{s.readOnlyNote}</p>}
      {!s.actions.length&&!s.readOnlyNote&&<p className="text-xs pm-muted">Không có thao tác nào lúc này.</p>}
      {error&&<p role="alert" className="vm-status-error">{error}</p>}
    </div>,document.body)}
  </div>;
}
