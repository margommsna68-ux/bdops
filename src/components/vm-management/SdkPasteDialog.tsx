"use client";
import {useState} from 'react';
import {trpc} from '@/lib/trpc';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {SdkPreview,SdkPreviewRow} from '@/server/vm-management/sdk';
import {errorMessage} from './shared';
type ServerOption={id:string;code:string};
export function SdkPreviewTable({rows}:{rows:SdkPreviewRow[]}){
  return <div className="pm-table-scroll max-h-80"><table className="pm-table"><thead><tr><th>Dòng</th><th>Server / VM</th><th>SDK hiện tại</th><th>SDK mới</th><th>Kết quả</th></tr></thead><tbody>{rows.map(r=><tr key={r.line} className={r.outcome==='ERROR'?'pm-row-blocked':''}><td className="pm-muted">{r.line}</td><td>{r.server?r.server+' / ':''}{r.vm}</td><td><code className="vm-sdk">{r.current||'—'}</code></td><td><code className="vm-sdk">{r.next||'—'}</code></td><td className={r.outcome==='ERROR'?'text-red-500':r.outcome==='SKIP'?'pm-muted':''}>{r.message}</td></tr>)}</tbody></table></div>;
}
/** Paste Server|VM|SDK (or VM|SDK for one server), preview every line, then save only the ready rows as one operation. */
export function SdkPasteForm({projectId,servers,serverId,onClose,onSaved}:{projectId:string;servers:ServerOption[];serverId?:string;onClose:()=>void;onSaved:()=>void}){
  const [server,setServer]=useState(serverId||''),[text,setText]=useState(''),[preview,setPreview]=useState<SdkPreview|null>(null),[key,setKey]=useState(()=>crypto.randomUUID()),[error,setError]=useState(''),[saved,setSaved]=useState<string|null>(null);
  const inspect=trpc.vmManagement.sdkPreview.useMutation(),apply=trpc.vmManagement.sdkApply.useMutation(),busy=inspect.isLoading||apply.isLoading;
  const reset=()=>{setPreview(null);setKey(crypto.randomUUID());setError('');};
  const check=async()=>{setError('');try{setPreview(await inspect.mutateAsync({projectId,text,serverId:server||undefined}));}catch(e){setError(errorMessage(e));}};
  const save=async()=>{
    if(!preview)return;const items=preview.rows.filter(r=>r.outcome==='READY'&&r.vmId&&r.next).map(r=>({vmId:r.vmId!,sdk:r.next!,expectedRevision:r.expectedRevision!}));
    setError('');try{const r=await apply.mutateAsync({projectId,key,items});setSaved(r.undone?'Đợt này đã được hoàn tác; không ghi lại.':`Đã ghi SDK cho ${r.updated} VM.${preview.errors?` Còn ${preview.errors} dòng lỗi chưa ghi.`:''}`);onSaved();}
    catch(e){setError(errorMessage(e));if((e as {data?:{code?:string}})?.data?.code==='CONFLICT')reset();}
  };
  return <>
    <DialogHeader><DialogTitle>Dán SDK</DialogTitle><DialogDescription>Mỗi dòng một VM. Đã chọn server: dán <code>VM&nbsp;SDK</code>. Nhiều server: dán <code>Server&nbsp;VM&nbsp;SDK</code>. Ghép theo tên server và mã VM, không theo thứ tự dòng; ô SDK trống giữ nguyên mã cũ.</DialogDescription></DialogHeader>
    {saved?<><p role="status" className="pm-success">{saved}</p><div className="flex justify-end gap-2"><button className="pm-button" onClick={()=>{setSaved(null);setText('');reset();}}>Dán tiếp</button><button className="pm-button pm-button-primary" onClick={onClose}>Đóng</button></div></>:<>
      <label className="pm-label">Server<select className="pm-input" aria-label="Server nhận SDK" disabled={busy} value={server} onChange={e=>{setServer(e.target.value);reset();}}><option value="">Nhiều server (dán kèm cột Server)</option>{servers.map(s=><option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
      <label className="pm-label">Danh sách<textarea className="pm-input pm-paste" rows={8} aria-label="Danh sách VM và SDK" disabled={busy} placeholder={server?'VM_001\tsdk-…\nVM_002\tsdk-…':'vt-01\tVM_001\tsdk-…\nvt-02\tVM_002\tsdk-…'} value={text} onChange={e=>{setText(e.target.value);reset();}}/></label>
      {preview&&<div className="pm-review"><p className="text-sm mb-3">{preview.ready} đổi/ghi mới · {preview.skipped} giữ nguyên · {preview.errors} lỗi</p><SdkPreviewTable rows={preview.rows}/></div>}
      {error&&<p role="alert" className="pm-error">{error}</p>}
      <div className="flex justify-end gap-2"><button className="pm-button" disabled={busy} onClick={onClose}>Đóng</button>{preview?.ready?<button className="pm-button pm-button-primary" disabled={busy} onClick={()=>void save()}>{busy?'Đang lưu…':`Lưu ${preview.ready} thay đổi`}</button>:<button className="pm-button pm-button-primary" disabled={busy||!text.trim()} onClick={()=>void check()}>{busy?'Đang kiểm tra…':'Kiểm tra'}</button>}</div>
    </>}
  </>;
}
export function SdkPasteDialog(props:{projectId:string;servers:ServerOption[];serverId?:string;onClose:()=>void;onSaved:()=>void}){
  return <Dialog open onOpenChange={open=>{if(!open)props.onClose();}}><DialogContent className="pm-dialog max-w-3xl max-h-[90vh] overflow-y-auto"><SdkPasteForm {...props}/></DialogContent></Dialog>;
}
