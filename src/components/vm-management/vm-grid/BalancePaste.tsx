"use client";
import React,{useEffect,useRef,useState} from 'react';
import {trpc} from '@/lib/trpc';
import {errorMessage} from '../shared';
// Dán bảng → Số dư (owner brief 20/10/2026): "VM | Số dư" (one server) or "Server | VM | Số dư". Checked while typing, one
// "Cập nhật N VM". Each line carries the VM, its round and the EarnApp seen at the check, so a VM recreated or an account changed
// meanwhile is refused at the save. A paste never confirms the withdrawal condition; an empty cell keeps the stored figure.
type Preview={rows:{line:number;server:string|null;vm:string|null;vmId:string|null;expectedCycle:number|null;earnAppId:string|null;account:string|null;amount:string|null;outcome:'READY'|'SKIP'|'ERROR';message:string}[];ready:number;skipped:number;errors:number};
type Saved={rows:{line?:number;outcome:'APPLIED'|'ERROR';message?:string}[]};
const localNow=()=>{const d=new Date(Date.now()-new Date().getTimezoneOffset()*60000);return d.toISOString().slice(0,16);};
export function BalancePasteBody({projectId,serverId,onSaved}:{projectId:string;serverId:string;onSaved:()=>void}){
  const [text,setText]=useState(''),[at,setAt]=useState(localNow),[result,setResult]=useState<{sig:string;p:Preview}|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const preview=trpc.vmOps.balancePreview.useMutation(),record=trpc.vmOps.balanceRecord.useMutation(),seq=useRef(0),keyRef=useRef<{sig:string;key:string}|null>(null),keep=useRef(false);
  const sig=JSON.stringify({serverId,text});
  useEffect(()=>{
    if(keep.current){keep.current=false;return;}
    setSaved('');if(!text.trim()){setResult(null);return;}
    const n=++seq.current,t=setTimeout(()=>{preview.mutateAsync({projectId,text,serverId:serverId||null}).then(p=>{if(n===seq.current){setResult({sig,p:p as Preview});setError('');}}).catch(e=>{if(n===seq.current)setError(errorMessage(e));});},400);
    return ()=>clearTimeout(t);
  },[serverId,text]);// eslint-disable-line react-hooks/exhaustive-deps
  const current=result&&result.sig===sig?result.p:null,ready=current?current.ready:0,atValid=!!at&&!Number.isNaN(new Date(at).getTime())&&new Date(at).getTime()<=Date.now()+5*60000;
  async function save(){
    if(!current||!ready||!atValid) return;
    const checkedAt=new Date(at).toISOString(),items=current.rows.filter(r=>r.outcome==='READY').map(r=>({vmId:r.vmId!,expectedCycle:r.expectedCycle!,earnAppId:r.earnAppId!,checkedAt,outcome:'OK' as const,amount:r.amount!,currency:'USD',withdrawable:'UNKNOWN' as const,line:r.line}));
    // One key per exact content: a retry after a lost answer replays, a new paste is a new check.
    const body=JSON.stringify(items);if(keyRef.current?.sig!==body)keyRef.current={sig:body,key:crypto.randomUUID()};
    setError('');
    try{const r=await record.mutateAsync({projectId,key:keyRef.current.key,source:'PASTE',items}) as Saved;
      const failed=new Set([...current.rows.filter(x=>x.outcome==='ERROR').map(x=>x.line),...r.rows.filter(x=>x.outcome==='ERROR').map(x=>x.line!)]);
      const ok=r.rows.filter(x=>x.outcome==='APPLIED').length,bad=r.rows.filter(x=>x.outcome==='ERROR');
      setSaved(`Đã cập nhật ${ok} VM`+(bad.length?` · ${bad.length} lỗi: `+bad.slice(0,5).map(x=>'dòng '+x.line+' '+x.message).join('; '):'')+'.');
      const rest=text.replace(/\r/g,'').split('\n').filter((_,i)=>failed.has(i+1)).join('\n');keep.current=true;setText(rest);setResult(null);onSaved();
    }catch(e){setError(errorMessage(e)+' — nội dung vẫn giữ nguyên; bấm lại sẽ không ghi trùng.');}
  }
  return <>
    <label className="pm-label">Dán từ Sheet<textarea className="pm-input pm-paste" rows={7} aria-label="Danh sách số dư" disabled={record.isLoading} value={text} placeholder={serverId?'VM_001\t10,50\nVM_002\t0':'An-01\tVM_001\t10,50\nAn-01\tVM_002\t0'} onChange={e=>setText(e.target.value)}/></label>
    <label className="pm-label text-xs">Thời điểm kiểm tra (giờ thật đã xem trên EarnApp)<input type="datetime-local" className="pm-input" aria-label="Thời điểm kiểm tra" value={at} onChange={e=>setAt(e.target.value)}/></label>
    <p className="pm-muted text-xs">{serverId?'Mỗi dòng: VM | Số dư (USD).':'Mỗi dòng: Server | VM | Số dư (USD).'} 0 là số hợp lệ; ô trống giữ số đã có. Dán không xác nhận điều kiện rút; ghi điều kiện ở ô của từng VM. Không tạo VM hay tài khoản. Tự kiểm tra khi dán.</p>
    {!atValid&&<p className="text-xs text-red-600">Thời điểm kiểm tra không hợp lệ hoặc ở tương lai.</p>}
    {preview.isLoading&&<p className="text-xs pm-muted">Đang kiểm tra…</p>}
    {current&&<><p className="text-sm"><strong>{current.ready}</strong> sẽ cập nhật · {current.skipped} giữ nguyên · <span className={current.errors?'text-red-600':''}>{current.errors} lỗi</span></p>
      <div className="vm-bulk-result"><table className="pm-table text-xs"><thead><tr><th>Dòng</th><th>Server / VM</th><th>Số dư</th><th>Kết quả</th></tr></thead><tbody>{current.rows.map(r=><tr key={r.line} className={r.outcome==='ERROR'?'text-red-600':''}><td>{r.line}</td><td>{[r.server,r.vm].filter(Boolean).join(' / ')}</td><td>{r.amount!=null?'$'+r.amount.replace('.',','):'—'}</td><td>{r.message}</td></tr>)}</tbody></table></div></>}
    {saved&&<p role="status" className="pm-success text-sm">{saved}</p>}
    {error&&<p role="alert" className="pm-error">{error}</p>}
    <div className="flex gap-2 justify-end"><button className={'pm-button'+(ready&&atValid?' pm-button-primary':'')} disabled={record.isLoading||preview.isLoading||!ready||!atValid} onClick={()=>void save()}>{record.isLoading?'Đang lưu…':`Cập nhật ${ready} VM`}</button></div>
  </>;
}
