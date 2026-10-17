"use client";
import {useEffect,useRef,useState} from 'react';
import {ChevronDown,Columns3,GripVertical,ArrowUp,ArrowDown,Search} from 'lucide-react';
import {COLUMNS,DEFAULT_PREFS,moveColumn,toggleColumn,type ColumnKey,type GridPrefs} from './grid-model';
function useOutside(open:boolean,close:()=>void){
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!open) return;const down=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node)) close();};const key=(e:KeyboardEvent)=>{if(e.key==='Escape') close();};document.addEventListener('mousedown',down);document.addEventListener('keydown',key);return ()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key);};},[open,close]);
  return ref;
}
// Server picker searchable by name, on every Server/VM page; picking one goes straight to that server.
export function ServerPicker({servers,value,onChange}:{servers:{id:string;code:string;ipAddress:string|null;vms:number}[];value:string;onChange:(id:string)=>void}){
  const [open,setOpen]=useState(false),[q,setQ]=useState(''),[hi,setHi]=useState(0),ref=useOutside(open,()=>setOpen(false)),input=useRef<HTMLInputElement>(null);
  const options=[{id:'',code:'Tất cả server',ipAddress:null,vms:servers.reduce((n,s)=>n+s.vms,0)},...servers].filter(s=>!q||s.code.toLowerCase().includes(q.toLowerCase())||(s.ipAddress||'').includes(q));
  const current=servers.find(s=>s.id===value);
  useEffect(()=>{if(open){setQ('');setHi(0);setTimeout(()=>input.current?.focus(),0);}},[open]);
  const pick=(id:string)=>{setOpen(false);if(id!==value) onChange(id);};
  return <div className="vm-picker" ref={ref}>
    <button type="button" className="pm-input vm-picker-button" aria-haspopup="listbox" aria-expanded={open} aria-label="Chọn server" onClick={()=>setOpen(!open)}><span className="vm-ellipsis">{current?current.code:'Tất cả server'}</span><ChevronDown size={15}/></button>
    {open&&<div className="vm-popover vm-picker-pop" role="dialog" aria-label="Chọn server">
      <label className="pm-search"><Search size={15}/><input ref={input} aria-label="Tìm server" placeholder="Gõ tên hoặc IP server…" value={q} onChange={e=>{setQ(e.target.value);setHi(0);}} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setHi(h=>Math.min(options.length-1,h+1));}else if(e.key==='ArrowUp'){e.preventDefault();setHi(h=>Math.max(0,h-1));}else if(e.key==='Enter'&&options[hi]){e.preventDefault();pick(options[hi].id);}}}/></label>
      <ul role="listbox" className="vm-picker-list">{options.map((s,i)=><li key={s.id||'all'} role="option" aria-selected={s.id===value}><button type="button" className={(i===hi?'hi ':'')+(s.id===value?'on':'')} onMouseEnter={()=>setHi(i)} onClick={()=>pick(s.id)}><span>{s.code}</span><span className="pm-muted text-xs">{s.vms} VM{s.ipAddress?' · '+s.ipAddress:''}</span></button></li>)}{!options.length&&<li className="pm-muted text-sm p-2">Không có server khớp.</li>}</ul>
    </div>}
  </div>;
}
// Cột: show/hide optional columns, reorder the movable ones (drag or arrows), reset. Widths are dragged on the header itself.
export function ColumnMenu({prefs,onChange}:{prefs:GridPrefs;onChange:(p:GridPrefs)=>void}){
  const [open,setOpen]=useState(false),[drag,setDrag]=useState<ColumnKey|null>(null),ref=useOutside(open,()=>setOpen(false));
  return <div className="vm-picker" ref={ref}>
    <button type="button" className="pm-button" aria-expanded={open} onClick={()=>setOpen(!open)}><Columns3 size={16}/>Cột</button>
    {open&&<div className="vm-popover vm-column-pop" role="dialog" aria-label="Chọn cột">
      <p className="pm-muted text-xs mb-2">Chọn, VM và ⋯ luôn cố định. Kéo tiêu đề cột trong bảng để đổi độ rộng.</p>
      <ul className="vm-column-list">{prefs.order.map((k,i)=>{const c=COLUMNS.find(x=>x.key===k)!,on=!prefs.hidden.includes(k);
        return <li key={k} draggable onDragStart={()=>setDrag(k)} onDragOver={e=>e.preventDefault()} onDrop={()=>{if(drag&&drag!==k) onChange(moveColumn(prefs,drag,i));setDrag(null);}} className={drag===k?'dragging':''}>
          <GripVertical size={14} className="pm-muted cursor-grab"/><label className="flex items-center gap-2 flex-1"><input type="checkbox" checked={on} onChange={e=>onChange(toggleColumn(prefs,k,e.target.checked))}/>{c.label}</label>
          <button type="button" className="vm-cell-icon" aria-label={'Đưa '+c.label+' lên'} disabled={i===0} onClick={()=>onChange(moveColumn(prefs,k,i-1))}><ArrowUp size={13}/></button><button type="button" className="vm-cell-icon" aria-label={'Đưa '+c.label+' xuống'} disabled={i===prefs.order.length-1} onClick={()=>onChange(moveColumn(prefs,k,i+1))}><ArrowDown size={13}/></button>
        </li>;})}</ul>
      <button type="button" className="pm-button pm-button-quiet mt-2 w-full" onClick={()=>onChange(DEFAULT_PREFS)}>Khôi phục mặc định</button>
    </div>}
  </div>;
}
export function Pager({first,last,total,page,pages,size,onPage,onSize,where}:{first:number;last:number;total:number;page:number;pages:number;size:number;onPage:(p:number)=>void;onSize:(s:50|100|200)=>void;where:'top'|'bottom'}){
  return <div className={'vm-pager vm-pager-'+where} data-testid={'vm-pager-'+where}>
    <span className="pm-muted text-xs">{total?`Dòng ${first}–${last} / ${total} VM`:'0 VM'}</span>
    <span className="flex items-center gap-2">
      <select className="pm-input vm-size" aria-label="Số dòng mỗi trang" value={size} onChange={e=>onSize(Number(e.target.value) as 50|100|200)}><option value={50}>50 / trang</option><option value={100}>100 / trang</option><option value={200}>200 / trang</option></select>
      <button className="pm-button pm-button-quiet" disabled={page<=1} onClick={()=>onPage(1)} aria-label="Trang đầu">«</button><button className="pm-button pm-button-quiet" disabled={page<=1} onClick={()=>onPage(page-1)}>Trước</button>
      <span className="text-xs">Trang {page}/{pages}</span>
      <button className="pm-button pm-button-quiet" disabled={page>=pages} onClick={()=>onPage(page+1)}>Sau</button><button className="pm-button pm-button-quiet" disabled={page>=pages} onClick={()=>onPage(pages)} aria-label="Trang cuối">»</button>
    </span>
  </div>;
}
