"use client";
import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {trpc} from '@/lib/trpc';
import type {ProxyGroupRef} from '@/server/proxy-management/types';
import {Archive,ArchiveRestore,Check,Loader2} from 'lucide-react';
import toast from 'react-hot-toast';
// Rename in place (id stays, links and history untouched) and archive / reopen. Archived groups leave the choice lists but keep their proxies.
function GroupRow({projectId,group,canManage,onChanged}:{projectId:string;group:ProxyGroupRef;canManage:boolean;onChanged:()=>void}){
  const [name,setName]=useState(group.name);
  const rename=trpc.proxyManagement.renameGroup.useMutation({onSuccess:g=>{toast.success('Đã đổi tên nhóm thành '+g.name);onChanged();},onError:e=>toast.error(e.message)});
  const archive=trpc.proxyManagement.archiveGroup.useMutation({onSuccess:g=>{toast.success(g.archivedAt?'Đã lưu trữ nhóm '+g.name:'Đã mở lại nhóm '+g.name);onChanged();},onError:e=>toast.error(e.message)});
  const busy=rename.isLoading||archive.isLoading,changed=name.trim()!==group.name;
  return <tr className={group.archivedAt?'pm-row-retired':''}>
    <td><form className="flex gap-2 items-center" onSubmit={e=>{e.preventDefault();if(changed) rename.mutate({projectId,id:group.id,name:name.trim()});}}><input aria-label={'Tên nhóm '+group.name} className="pm-input" maxLength={60} value={name} disabled={!canManage||busy} onChange={e=>setName(e.target.value)}/>{canManage&&changed&&<button type="submit" className="pm-button pm-button-primary" disabled={busy||!name.trim()}>{rename.isLoading?<Loader2 size={16} className="animate-spin"/>:<Check size={16}/>}Lưu</button>}</form></td>
    <td className="tabular-nums">{group.proxyCount??0}</td>
    <td>{group.archivedAt?<span className="pm-badge pm-badge-muted">Lưu trữ</span>:<span className="pm-badge pm-badge-green">Đang dùng</span>}</td>
    <td>{canManage&&<button className="pm-button pm-button-quiet" disabled={busy} onClick={()=>archive.mutate({projectId,id:group.id,archived:!group.archivedAt})}>{group.archivedAt?<><ArchiveRestore size={16}/>Mở lại</>:<><Archive size={16}/>Lưu trữ</>}</button>}</td>
  </tr>;
}
export function GroupDialog({projectId,canManage,onClose,onChanged}:{projectId:string;canManage:boolean;onClose:()=>void;onChanged:()=>void}){
  const groups=trpc.proxyManagement.groups.useQuery({projectId});
  const changed=()=>{void groups.refetch();onChanged();};
  return <Dialog open onOpenChange={open=>{if(!open) onClose();}}><DialogContent className="pm-dialog max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Nhóm proxy</DialogTitle><DialogDescription>TUT và genjy là nhóm có sẵn. Đổi tên giữ nguyên liên kết và lịch sử; lưu trữ chỉ ẩn khỏi ô chọn, proxy trong nhóm không tự chuyển về TUT.</DialogDescription></DialogHeader>
    <div className="pm-table-scroll"><table className="pm-table"><thead><tr><th>Tên nhóm</th><th>Proxy</th><th>Trạng thái</th><th></th></tr></thead><tbody>
      {groups.data?.map(g=><GroupRow key={g.id} projectId={projectId} group={g} canManage={canManage} onChanged={changed}/>)}
      {groups.data&&!groups.data.length&&<tr><td colSpan={4} className="pm-empty">Chưa có nhóm tự đặt. Tạo nhóm ở Nhập mới hoặc khi sửa dòng proxy.</td></tr>}
      {groups.isLoading&&<tr><td colSpan={4} className="pm-empty">Đang tải…</td></tr>}
    </tbody></table></div>
    <div className="flex justify-end"><button className="pm-button" onClick={onClose}>Đóng</button></div>
  </DialogContent></Dialog>;
}
