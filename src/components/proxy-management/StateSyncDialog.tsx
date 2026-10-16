"use client";
import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {trpc} from '@/lib/trpc';
import type {EditPreview} from '@/server/proxy-management/types';
import {AlertCircle,Check,Loader2} from 'lucide-react';
import toast from 'react-hot-toast';
// Re-align NEW/LIVE with the real VM holds (TUT and Chung mooon–Genjy). Preview lists every row that will change and why,
// plus rows kept on purpose (review holds); one save, journaled with undo. BLOCKED, unclear and historical rows are never touched.
export function StateSyncDialog({projectId,onClose,onSaved}:{projectId:string;onClose:()=>void;onSaved:()=>void}){
  const [key,setKey]=useState(()=>crypto.randomUUID()),[preview,setPreview]=useState<EditPreview|null>(null),[error,setError]=useState('');
  const inspect=trpc.proxyManagement.editPreview.useMutation(),commit=trpc.proxyManagement.editCommit.useMutation(),busy=inspect.isLoading||commit.isLoading;
  async function check(){setError('');try{setPreview(await inspect.mutateAsync({projectId,syncStates:true,idempotencyKey:key}));}catch(e){setError(e instanceof Error?e.message:'Không kiểm tra được');}}
  async function save(){if(!preview)return;try{const r=await commit.mutateAsync({projectId,token:preview.token,idempotencyKey:key});toast.success('Đã đồng bộ '+r.applied+' proxy');onSaved();onClose();}catch(e){setError(e instanceof Error?e.message:'Chưa lưu được');setPreview(null);setKey(crypto.randomUUID());}}
  const toLive=preview?.rows.filter(r=>r.outcome==='READY'&&r.after==='LIVE').length??0,toNew=preview?.rows.filter(r=>r.outcome==='READY'&&r.after==='NEW').length??0;
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="pm-dialog max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="text-xl">Đồng bộ NEW / LIVE</DialogTitle><DialogDescription>NEW = trong kho, chưa gán VM. LIVE = đã gán VM trên web (Chờ cài hoặc Đã cài); không có nghĩa đã cài hay đã kiểm tra mạng. Áp dụng cho TUT và Chung mooon–Genjy; BLOCKED, cần kiểm tra, đã replace, ngừng quản lý và Genjy riêng giữ nguyên.</DialogDescription></DialogHeader>
    {error&&<p role="alert" className="pm-error flex gap-2"><AlertCircle size={18} className="shrink-0"/>{error}</p>}
    {preview&&<div className="pm-review"><div className="flex gap-4 flex-wrap mb-3 text-sm"><strong data-testid="sync-summary">{toLive} → LIVE | {toNew} → NEW | {preview.skipped} giữ nguyên</strong></div>
      {!preview.rows.length?<p className="pm-muted text-sm">NEW / LIVE đã khớp vị trí VM.</p>:<div className="max-h-80 overflow-auto"><table className="pm-table text-sm"><thead><tr><th>IP</th><th>Trước → sau</th><th>Lý do</th></tr></thead><tbody>{preview.rows.map(r=><tr key={r.row}><td className="font-mono">{r.ip}</td><td>{r.before} → <strong>{r.after}</strong></td><td><span className={`pm-badge ${r.outcome==='READY'?'pm-badge-blue':'pm-badge-muted'}`}>{r.outcome==='READY'?'Sẽ đồng bộ':'Giữ nguyên'}</span><p className="pm-muted mt-1 text-xs">{r.message}</p></td></tr>)}</tbody></table></div>}
    </div>}
    <div className="flex justify-end gap-2 pt-2"><button className="pm-button" disabled={busy} onClick={onClose}>Huỷ</button><button className="pm-button pm-button-primary" disabled={busy||(!!preview&&!preview.ready)} onClick={()=>void(preview?save():check())}>{busy?<Loader2 size={16} className="animate-spin"/>:<Check size={16}/>}{inspect.isLoading?'Đang kiểm tra…':commit.isLoading?'Đang lưu…':preview?`Đồng bộ ${preview.ready} dòng`:'Xem trước'}</button></div>
  </DialogContent></Dialog>;
}
