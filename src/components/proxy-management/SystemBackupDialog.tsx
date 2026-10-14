"use client";
import {trpc} from '@/lib/trpc';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {localDate} from './HistoryPanel';
import {Loader2,Archive} from 'lucide-react';
export function SystemBackupDialog({onClose}:{onClose:()=>void}){
  const list=trpc.proxyManagement.backups.useQuery();
  const create=trpc.proxyManagement.createBackup.useMutation({onSuccess:()=>{void list.refetch();}});
  return <Dialog open onOpenChange={open=>{if(!open&&!create.isLoading)onClose();}}><DialogContent className="pm-dialog max-w-xl"><DialogHeader><DialogTitle>Bản sao dự phòng</DialogTitle><DialogDescription>Sao lưu toàn bộ dữ liệu ứng dụng, gồm các dự án và lịch sử. Chỉ chủ hệ thống được thao tác.</DialogDescription></DialogHeader>
    <button className="pm-button pm-button-primary w-fit" disabled={create.isLoading} onClick={()=>create.mutate()}>{create.isLoading?<Loader2 size={16} className="animate-spin"/>:<Archive size={16}/>} {create.isLoading?'Đang tạo bản sao…':'Tạo bản sao ngay'}</button>
    {create.error&&<p role="alert" className="pm-error">{create.error.message}</p>}{create.data&&<p role="status" className="pm-success">Đã tạo bản sao mã hoá.</p>}
    <div className="max-h-64 overflow-y-auto"><table className="pm-table"><thead><tr><th>Bản sao</th><th>Dung lượng</th></tr></thead><tbody>{list.data?.map(r=><tr key={r.id}><td>{localDate(r.createdAt)}<div className="pm-muted text-xs mt-1">{r.id.slice(0,8)}</div></td><td>{(r.bytes/1024).toFixed(0)} KB</td></tr>)}{!list.data?.length&&<tr><td colSpan={2} className="pm-empty">{list.isLoading?'Đang tải…':'Chưa có bản sao.'}</td></tr>}</tbody></table></div>{list.error&&<p role="alert" className="pm-error">{list.error.message}</p>}
    <p className="pm-muted text-sm">Bản sao lưu bảo mật trên server. Khôi phục toàn hệ thống cần kiểm tra kỹ thuật trên bản riêng trước để tránh mất thao tác mới.</p>
  </DialogContent></Dialog>;
}
