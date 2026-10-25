"use client";
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {trpc} from '@/lib/trpc';
import {errorMessage} from '@/components/vm-management/shared';
// Note of a Gmail / Apple ID, edited in its cell (owner brief 20/10/2026). Shows up to three lines; a click (also on an empty cell)
// opens a textarea that grows to the whole text. Enter saves, Shift+Enter breaks the line, Esc cancels; Enter while a Vietnamese IME is
// composing never saves. Leaving the cell keeps an unsaved text open (never saved on blur). An error stays at the cell with the text;
// "Đã lưu" only after the server saved it. A retry of the same text reuses its request key (one write).
export const NOTE_WIDTH_KEY='mth-acc-note-width',NOTE_WIDTH_DEFAULT=280,NOTE_WIDTH_MIN=160,NOTE_WIDTH_MAX=720;
export function useNoteWidth(){
  const [w,setW]=useState(NOTE_WIDTH_DEFAULT);
  useEffect(()=>{try{const v=Number(localStorage.getItem(NOTE_WIDTH_KEY));if(v>=NOTE_WIDTH_MIN&&v<=NOTE_WIDTH_MAX)setW(v);}catch{/* private mode */}},[]);
  const set=(v:number)=>{const n=Math.round(Math.max(NOTE_WIDTH_MIN,Math.min(NOTE_WIDTH_MAX,v)));setW(n);try{localStorage.setItem(NOTE_WIDTH_KEY,String(n));}catch{/* private mode */}};
  return [w,set] as const;
}
/** Column header with a drag handle (and arrow keys) for the note width. */
export function NoteHeader({width,onWidth}:{width:number;onWidth:(w:number)=>void}){
  const start=useRef<{x:number;w:number}|null>(null);
  return <th className="acc-note-th" style={{width,minWidth:width,maxWidth:width}}>Ghi chú
    <span role="separator" aria-orientation="vertical" aria-label="Kéo để đổi độ rộng cột Ghi chú" aria-valuenow={width} aria-valuemin={NOTE_WIDTH_MIN} aria-valuemax={NOTE_WIDTH_MAX} tabIndex={0} className="acc-note-resize"
      onPointerDown={e=>{start.current={x:e.clientX,w:width};(e.target as HTMLElement).setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(start.current)onWidth(start.current.w+e.clientX-start.current.x);}}
      onPointerUp={()=>{start.current=null;}}
      onKeyDown={e=>{if(e.key==='ArrowLeft'){e.preventDefault();onWidth(width-20);}if(e.key==='ArrowRight'){e.preventDefault();onWidth(width+20);}}}/></th>;
}
export function NoteCell({projectId,id,email,notes,revision,canEdit,width,onSaved,loginIssueNote,loginIssueAt}:{projectId:string;id:string;email:string;notes:string|null;revision:number;canEdit:boolean;width:number;onSaved:()=>void;loginIssueNote?:string|null;loginIssueAt?:string|null}){
  const save=trpc.accountStore.setNote.useMutation();
  const [text,setText]=useState<string|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState(false),[expanded,setExpanded]=useState(false);
  const pending=useRef<{sig:string;key:string}|null>(null),area=useRef<HTMLTextAreaElement>(null),view=useRef<HTMLDivElement>(null),[clamped,setClamped]=useState(false);
  const editing=text!==null,stored=notes||'';
  const issueDate=loginIssueAt?new Date(loginIssueAt):null;
  const issueNote=(loginIssueNote||issueDate)&&<div className="acc-note-observation">
    {loginIssueNote&&<p className="whitespace-normal break-words">{loginIssueNote}</p>}
    {issueDate&&Number.isFinite(issueDate.getTime())&&<time className="block pm-muted" dateTime={loginIssueAt!}>Ghi nhận {issueDate.toLocaleString('vi-VN',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}</time>}
  </div>;
  useLayoutEffect(()=>{const a=area.current;if(a){a.style.height='auto';a.style.height=a.scrollHeight+2+'px';}},[text,width]);
  useLayoutEffect(()=>{const v=view.current;setClamped(!!v&&v.scrollHeight>v.clientHeight+1);},[notes,width,expanded,editing]);
  useEffect(()=>{if(!saved)return;const t=setTimeout(()=>setSaved(false),2500);return ()=>clearTimeout(t);},[saved]);
  const open=()=>{if(!canEdit){setExpanded(e=>!e);return;}setError('');setText(stored);requestAnimationFrame(()=>{const a=area.current;if(a){a.focus();a.setSelectionRange(a.value.length,a.value.length);}});};
  const cancel=()=>{setText(null);setError('');pending.current=null;};
  async function submit(){
    if(text===null||save.isLoading)return;
    if(text.trim()===stored.trim()){cancel();return;}
    const input={projectId,id,expectedRevision:revision,notes:text},sig=JSON.stringify(input),key=pending.current?.sig===sig?pending.current.key:crypto.randomUUID();pending.current={sig,key};
    setError('');
    try{await save.mutateAsync({...input,key});pending.current=null;setText(null);setSaved(true);onSaved();}
    catch(e){setError(errorMessage(e));} // the typed text stays for a fix / retry
  }
  const style={width,minWidth:width,maxWidth:width};
  if(editing)return <td className="acc-note-td" style={style}>
    <textarea ref={area} className="pm-input acc-note-input" aria-label={'Ghi chú '+email} value={text} disabled={save.isLoading} maxLength={2000}
      onChange={e=>{setText(e.target.value);setError('');}}
      onBlur={()=>{if(text.trim()===stored.trim()&&!error)cancel();}}
      onKeyDown={e=>{if(e.nativeEvent.isComposing||e.keyCode===229)return;
        if(e.key==='Escape'){e.preventDefault();e.stopPropagation();cancel();}
        else if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void submit();}}}/>
    <span className="acc-note-help" aria-live="polite">{save.isLoading?'Đang lưu…':error?<span className="pm-field-error" role="alert">{error}</span>:'Enter lưu · Shift+Enter xuống dòng · Esc huỷ'}</span>
    {issueNote}
  </td>;
  return <td className="acc-note-td" style={style}>
    <div ref={view} role={canEdit?'button':undefined} tabIndex={0} aria-label={canEdit?(stored?'Sửa ghi chú '+email:'Thêm ghi chú cho '+email):undefined}
      className={'acc-note-view'+(expanded?' expanded':'')+(canEdit?' editable':'')} onClick={open}
      onKeyDown={e=>{if((e.key==='Enter'||e.key==='F2')&&!e.nativeEvent.isComposing){e.preventDefault();open();}}}>
      {stored||(canEdit?<span className="pm-muted">Thêm ghi chú</span>:<span className="pm-muted">—</span>)}
    </div>
    {(clamped||expanded)&&!canEdit&&<button type="button" className="pm-link text-xs" onClick={()=>setExpanded(e=>!e)}>{expanded?'Thu gọn':'Xem hết'}</button>}
    {saved&&<span className="acc-note-saved" role="status">Đã lưu</span>}
    {issueNote}
  </td>;
}
