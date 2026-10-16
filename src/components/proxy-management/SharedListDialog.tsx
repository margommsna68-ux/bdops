"use client";
import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {trpc} from '@/lib/trpc';
import type {EditPreview} from '@/server/proxy-management/types';
import {AlertCircle,Check,Loader2} from 'lucide-react';
import toast from 'react-hot-toast';
// The owner's confirmed list of "Chung mooon–Genjy" proxies: paste IPs or full proxies, review every line, save the valid ones once.
// Nothing is imported; shared IPs missing from the list are only shown. Saved through editPreview/editCommit (journal + undo).
export function SharedListDialog({projectId,onClose,onSaved}:{projectId:string;onClose:()=>void;onSaved:()=>void}){
  const [text,setText]=useState(''),[key,setKey]=useState(()=>crypto.randomUUID()),[preview,setPreview]=useState<EditPreview|null>(null),[error,setError]=useState('');
  const inspect=trpc.proxyManagement.editPreview.useMutation(),commit=trpc.proxyManagement.editCommit.useMutation(),busy=inspect.isLoading||commit.isLoading;
  const change=(v:string)=>{setText(v);setPreview(null);setError('');setKey(crypto.randomUUID());};
  async function check(){setError('');try{setPreview(await inspect.mutateAsync({projectId,sharedList:text,idempotencyKey:key}));}catch(e){setError(e instanceof Error?e.message:'Không kiểm tra được');}}
  async function save(){if(!preview)return;try{const r=await commit.mutateAsync({projectId,token:preview.token,idempotencyKey:key});toast.success(r.undone?'Đợt này đã được hoàn tác':'Đã xác nhận '+r.applied+' proxy vào nhóm chung');onSaved();onClose();}catch(e){const m=e instanceof Error?e.message:'Chưa lưu được';setError(m);if(/STALE_PREVIEW|thay đổi/.test(m)){setPreview(null);setKey(crypto.randomUUID());}}}
  const label={READY:'Sẽ cập nhật',SKIP:'Giữ nguyên',ERROR:'Cần kiểm tra'} as const;
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="pm-dialog max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="text-xl">Xác nhận nhóm chung mooon–Genjy</DialogTitle><DialogDescription>Dán danh sách proxy chung đã chốt (IP hoặc IP:port:user:pass, mỗi dòng một proxy). Chỉ đổi phân loại proxy đã có; không nhập mới, không suy theo dải IP hay user/pass.</DialogDescription></DialogHeader>
    <label className="pm-label">Danh sách proxy chung<textarea autoFocus className="pm-input pm-paste" rows={8} value={text} disabled={busy} placeholder="Dán danh sách tại đây" onChange={e=>change(e.target.value)}/></label>
    {error&&<p role="alert" className="pm-error flex gap-2"><AlertCircle size={18} className="shrink-0"/>{error}</p>}
    {preview&&<div className="pm-review"><div className="flex gap-4 flex-wrap mb-3 text-sm"><strong data-testid="shared-summary">{preview.ready} sẽ cập nhật | {preview.skipped} đã ở nhóm chung | {preview.errors} cần kiểm tra</strong></div>
      <div className="max-h-72 overflow-auto"><table className="pm-table text-sm"><thead><tr><th>Dòng</th><th>IP</th><th>Hiện tại → sau</th><th>Kết quả</th></tr></thead><tbody>{preview.rows.map(r=><tr key={r.row}><td>{r.row}</td><td className="font-mono">{r.ip}</td><td>{r.before?<>{r.before} → <strong>{r.after}</strong></>:<span className="pm-muted">—</span>}</td><td><span className={`pm-badge ${r.outcome==='ERROR'?'pm-badge-red':r.outcome==='READY'?'pm-badge-shared':'pm-badge-muted'}`}>{label[r.outcome]}</span><p className="pm-muted mt-1 text-xs">{r.message}</p></td></tr>)}</tbody></table></div>
      {preview.notListed.length>0&&<details className="pm-options mt-3"><summary>{preview.notListed.length} proxy đang ở nhóm chung nhưng không có trong danh sách (giữ nguyên)</summary><p className="font-mono text-xs mt-2 break-all">{preview.notListed.map(n=>n.ip).join(', ')}</p></details>}
    </div>}
    <div className="flex justify-end gap-2 pt-2"><button className="pm-button" disabled={busy} onClick={onClose}>Huỷ</button><button className="pm-button pm-button-primary" disabled={busy||!text.trim()||(!!preview&&!preview.ready)} onClick={()=>void(preview?save():check())}>{busy?<Loader2 size={16} className="animate-spin"/>:<Check size={16}/>}{inspect.isLoading?'Đang kiểm tra…':commit.isLoading?'Đang lưu…':preview?`Lưu ${preview.ready} dòng hợp lệ`:'Xem trước'}</button></div>
  </DialogContent></Dialog>;
}
