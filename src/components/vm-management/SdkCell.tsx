"use client";
import {useState} from 'react';
import {trpc} from '@/lib/trpc';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Pencil,History} from 'lucide-react';
import toast from 'react-hot-toast';
import {localDate} from '@/components/proxy-management/HistoryPanel';
import {errorMessage,type ManagedVM} from './shared';
/** Current EarnApp SDK of one VM with inline edit, explicit clear and per-VM history. */
export function SdkCell({projectId,vm,canEdit,onSaved}:{projectId:string;vm:ManagedVM;canEdit:boolean;onSaved:()=>void}){
  const [editing,setEditing]=useState(false),[value,setValue]=useState(''),[error,setError]=useState(''),[history,setHistory]=useState(false);
  const apply=trpc.vmManagement.sdkApply.useMutation();
  const save=async(clear=false)=>{
    const sdk=clear?null:value.trim();if(!clear&&!sdk){setError('Nhập mã SDK');return;}
    if(!clear&&sdk===vm.sdk?.id){setEditing(false);return;}
    if(clear&&!window.confirm(`Xóa SDK của ${vm.server} / ${vm.code}? Mã cũ vẫn còn trong lịch sử.`))return;
    setError('');try{const r=await apply.mutateAsync({projectId,key:crypto.randomUUID(),items:[{vmId:vm.id,sdk,expectedRevision:vm.revision,...(clear?{clear:true}:{})}]});toast.success(r.undone?'Thao tác đã được hoàn tác; tải lại để kiểm tra.':clear?'Đã xóa SDK':'Đã ghi SDK');setEditing(false);onSaved();}catch(e){setError(errorMessage(e));}
  };
  if(editing)return <div className="vm-sdk-edit">
    <input className="pm-input vm-sdk-input" aria-label={`SDK mới cho ${vm.server} / ${vm.code}`} autoFocus disabled={apply.isLoading} value={value} placeholder={vm.sdk?.id||'Dán mã SDK'} onChange={e=>setValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void save();}if(e.key==='Escape')setEditing(false);}}/>
    {vm.sdk&&<p className="pm-muted text-xs">Hiện tại: <code className="vm-sdk">{vm.sdk.id}</code></p>}
    {error&&<p role="alert" className="pm-error">{error}</p>}
    <div className="flex gap-1 flex-wrap"><button className="pm-button pm-button-primary" disabled={apply.isLoading} onClick={()=>void save()}>{apply.isLoading?'Đang lưu…':'Lưu'}</button><button className="pm-button pm-button-quiet" disabled={apply.isLoading} onClick={()=>setEditing(false)}>Hủy</button>{vm.sdk&&<button className="pm-button pm-button-quiet" disabled={apply.isLoading} onClick={()=>void save(true)}>Xóa SDK</button>}</div>
  </div>;
  return <div className="vm-sdk-cell">
    <div>{vm.sdk?<><code className="vm-sdk">{vm.sdk.id}</code><div className="pm-muted text-xs mt-1">{vm.sdk.recordedAt?localDate(vm.sdk.recordedAt):'Chưa rõ ngày'}{vm.sdk.recordedBy?' · '+vm.sdk.recordedBy:''}</div></>:<span className="vm-sdk-missing">Chưa có SDK</span>}</div>
    <div className="vm-sdk-actions">{canEdit&&<button type="button" className="pm-icon-button" aria-label={`Ghi SDK ${vm.server} / ${vm.code}`} title="Ghi SDK" onClick={()=>{setValue('');setError('');setEditing(true);}}><Pencil size={15}/></button>}{vm.sdk&&<button type="button" className="pm-icon-button" aria-label={`Lịch sử SDK ${vm.server} / ${vm.code}`} title="Lịch sử SDK" onClick={()=>setHistory(true)}><History size={15}/></button>}</div>
    {history&&<SdkHistoryDialog projectId={projectId} vm={vm} onClose={()=>setHistory(false)}/>}
  </div>;
}
function SdkHistoryDialog({projectId,vm,onClose}:{projectId:string;vm:ManagedVM;onClose:()=>void}){
  const rows=trpc.vmManagement.sdkHistory.useQuery({projectId,vmId:vm.id});
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="pm-dialog max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Lịch sử SDK · {vm.server} / {vm.code}</DialogTitle><DialogDescription>Mỗi lần ghi/đổi/xóa SDK: mã cũ, mã mới, người và thời gian.</DialogDescription></DialogHeader>
    {rows.error&&<p role="alert" className="pm-error">{rows.error.message}</p>}
    <div className="pm-table-scroll"><table className="pm-table"><thead><tr><th>Thời gian</th><th>Người ghi</th><th>SDK cũ</th><th>SDK mới</th></tr></thead><tbody>{rows.data?.map(r=><tr key={r.id}><td>{localDate(r.recordedAt)}{r.note&&<div className="pm-muted text-xs mt-1">{r.note}</div>}</td><td>{r.actor}</td><td><code className="vm-sdk">{r.previousSdk||'—'}</code></td><td><code className="vm-sdk">{r.newSdk||'—'}</code></td></tr>)}{rows.data&&!rows.data.length&&<tr><td colSpan={4} className="pm-empty">Chưa có lịch sử SDK.</td></tr>}</tbody></table></div>
    <div className="flex justify-end"><button className="pm-button" onClick={onClose}>Đóng</button></div>
  </DialogContent></Dialog>;
}
