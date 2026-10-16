"use client";
import {useState} from 'react';
import {Check,Loader2,Pencil,X} from 'lucide-react';
// Edit in place: pencil → field → Enter or ✓ saves, Escape or ✕ cancels. Nothing is saved while typing. The same value again
// closes without a request. Errors stay next to the field and the typed text is kept.
export function InlineText({value,label,placeholder,canEdit,onSave,mono=false,multiline=false,className=''}:{value:string|null|undefined;label:string;placeholder?:string;canEdit:boolean;onSave:(next:string)=>Promise<unknown>;mono?:boolean;multiline?:boolean;className?:string}){
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(value||''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const start=()=>{setDraft(value||'');setError('');setEditing(true);};
  const cancel=()=>{if(!saving){setEditing(false);setError('');}};
  async function save(){
    if(saving) return;
    if(draft.trim()===(value||'').trim()){setEditing(false);return;}
    setSaving(true);setError('');
    try{await onSave(draft.trim());setEditing(false);}catch(e){setError(e instanceof Error?e.message:'Chưa lưu được');}finally{setSaving(false);}
  }
  if(!editing) return <span className={'pm-inline '+className}>{value?<span className={mono?'pm-code':''}>{value}</span>:<span className="pm-muted">{placeholder||'—'}</span>}{canEdit&&<button type="button" className="pm-inline-pencil" aria-label={'Sửa '+label} title={'Sửa '+label} onClick={start}><Pencil size={13}/></button>}</span>;
  const keys=(e:React.KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();cancel();}else if(e.key==='Enter'&&(!multiline||e.ctrlKey||e.metaKey)){e.preventDefault();void save();}};
  return <span className={'pm-inline-edit '+className}>
    {multiline?<textarea autoFocus aria-label={label} className="pm-input" rows={2} value={draft} disabled={saving} maxLength={1000} onChange={e=>setDraft(e.target.value)} onKeyDown={keys}/>:<input autoFocus aria-label={label} className={'pm-input'+(mono?' pm-code':'')} value={draft} disabled={saving} maxLength={80} onChange={e=>setDraft(e.target.value)} onKeyDown={keys}/>}
    <button type="button" className="pm-icon-button" aria-label={'Lưu '+label} disabled={saving} onClick={()=>void save()}>{saving?<Loader2 size={15} className="animate-spin"/>:<Check size={15}/>}</button>
    <button type="button" className="pm-icon-button" aria-label={'Huỷ sửa '+label} disabled={saving} onClick={cancel}><X size={15}/></button>
    {error&&<span role="alert" className="pm-inline-error">{error}</span>}
  </span>;
}
