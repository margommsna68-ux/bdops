"use client";
import {useMemo,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {trpc} from '@/lib/trpc';
import {expandVmRange,splitVmCodes,suggestNextVmCode,validVmCode,VmCodeError} from '@/server/vm-management/vm-codes';
import {Loader2} from 'lucide-react';
import toast from 'react-hot-toast';
type KnownVM={serverId:string;code:string;archivedAt:string|null};
// Codes from a "Từ"–"Đến" range (default) or a pasted list, with the live split new / existing / deleted for one server.
function useCodes(known:KnownVM[],serverId:string){
  const onServer=useMemo(()=>known.filter(v=>v.serverId===serverId),[known,serverId]);
  const next=useMemo(()=>suggestNextVmCode(onServer.map(v=>v.code)),[onServer]);
  const [mode,setMode]=useState<'RANGE'|'LIST'>('RANGE'),[from,setFrom]=useState(next||''),[to,setTo]=useState(next||''),[text,setText]=useState('');
  let codes:string[]=[],error='';
  try{
    if(mode==='RANGE'){if(from.trim()&&to.trim()) codes=expandVmRange(from,to);}
    else{codes=splitVmCodes(text);const bad=codes.find(c=>!validVmCode(c));if(bad) throw new VmCodeError('Mã "'+bad+'" chỉ được gồm chữ, số, - hoặc _');if(codes.length>500) throw new VmCodeError('Tối đa 500 VM mỗi lần');}
  }catch(e){codes=[];error=e instanceof VmCodeError?e.message:'Mã không hợp lệ';}
  const active=new Set(onServer.filter(v=>!v.archivedAt).map(v=>v.code)),deleted=new Set(onServer.filter(v=>v.archivedAt).map(v=>v.code));
  const fresh=codes.filter(c=>!active.has(c)&&!deleted.has(c)),existing=codes.filter(c=>active.has(c)).length,archived=codes.filter(c=>deleted.has(c)).length;
  const fields=<div className="space-y-3">
    {mode==='RANGE'?<div className="grid grid-cols-2 gap-3"><label className="pm-label">Từ<input className="pm-input pm-code" aria-label="Từ mã VM" placeholder={next||'VM_001'} value={from} onChange={e=>setFrom(e.target.value)}/></label><label className="pm-label">Đến<input className="pm-input pm-code" aria-label="Đến mã VM" placeholder={next||'VM_080'} value={to} onChange={e=>setTo(e.target.value)}/></label></div>
      :<label className="pm-label">Danh sách mã<textarea className="pm-input pm-paste" rows={5} aria-label="Danh sách mã VM" placeholder="VM_001, VM_005, M-012…" value={text} onChange={e=>setText(e.target.value)}/></label>}
    <button type="button" className="pm-link text-xs" onClick={()=>setMode(mode==='RANGE'?'LIST':'RANGE')}>{mode==='RANGE'?'Mã không liên tiếp? Dán danh sách':'Dùng khoảng Từ → Đến'}</button>
    {error?<p role="alert" className="pm-error text-sm">{error}</p>:codes.length>0&&<p className="text-sm" data-testid="vm-code-count"><strong>{fresh.length} VM mới</strong> · {existing} đã tồn tại · {archived} đã xoá{archived>0&&<span className="pm-muted"> — mã đã xoá được bỏ qua; khôi phục ở bộ lọc Đã xoá</span>}</p>}
  </div>;
  return {fields,codes,fresh};
}
export function AddVmDialog({projectId,servers,serverId,known,onClose,onSaved}:{projectId:string;servers:{id:string;code:string}[];serverId?:string;known:KnownVM[];onClose:()=>void;onSaved:()=>void}){
  const [target,setTarget]=useState(serverId||servers[0]?.id||''),add=trpc.vmManagement.addVMs.useMutation();
  return <Dialog open onOpenChange={open=>{if(!open&&!add.isLoading)onClose();}}><DialogContent className="pm-dialog max-w-lg"><DialogHeader><DialogTitle>Thêm VM</DialogTitle><DialogDescription>Chỉ tạo mã chưa có. Không tự gán proxy, SDK hay tài khoản.</DialogDescription></DialogHeader>
    <label className="pm-label">Server<select className="pm-input" aria-label="Server cho VM mới" value={target} disabled={add.isLoading} onChange={e=>setTarget(e.target.value)}>{servers.map(s=><option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
    <CodesAndSave key={target} known={known} serverId={target} busy={add.isLoading} onCancel={onClose} onSave={async codes=>{const r=await add.mutateAsync({projectId,serverId:target,vmCodes:codes});toast.success(`Đã tạo ${r.created} VM`+(r.existing.length||r.archived.length?` · bỏ qua ${r.existing.length+r.archived.length} mã đã có`:''));onSaved();onClose();}}/>
  </DialogContent></Dialog>;
}
function CodesAndSave({known,serverId,busy,onCancel,onSave}:{known:KnownVM[];serverId:string;busy:boolean;onCancel:()=>void;onSave:(codes:string[])=>Promise<void>}){
  const {fields,codes,fresh}=useCodes(known,serverId),[error,setError]=useState('');
  return <>{fields}{error&&<p role="alert" className="pm-error text-sm">{error}</p>}<div className="flex justify-end gap-2"><button className="pm-button" disabled={busy} onClick={onCancel}>Huỷ</button><button className="pm-button pm-button-primary" disabled={busy||!fresh.length} onClick={()=>{setError('');onSave(codes).catch(e=>setError(e instanceof Error?e.message:'Chưa tạo được'));}}>{busy&&<Loader2 size={16} className="animate-spin"/>}{busy?'Đang tạo…':`Tạo ${fresh.length} VM`}</button></div></>;
}
export function CreateServerDialog({projectId,onClose,onSaved}:{projectId:string;onClose:()=>void;onSaved:(id:string)=>void}){
  const [code,setCode]=useState(''),[ip,setIP]=useState(''),create=trpc.vmManagement.createServer.useMutation(),[error,setError]=useState('');
  const {fields,codes}=useCodes([],'');
  return <Dialog open onOpenChange={open=>{if(!open&&!create.isLoading)onClose();}}><DialogContent className="pm-dialog max-w-lg"><DialogHeader><DialogTitle>Thêm server</DialogTitle><DialogDescription>Tạo server và danh sách VM trên web; không tạo máy thật.</DialogDescription></DialogHeader>
    <div className="grid grid-cols-2 gap-3"><label className="pm-label">Tên server<input className="pm-input" aria-label="Tên server" value={code} onChange={e=>setCode(e.target.value)}/></label><label className="pm-label">IP <span className="pm-muted font-normal">(không bắt buộc)</span><input className="pm-input" aria-label="IP server" value={ip} onChange={e=>setIP(e.target.value)}/></label></div>
    {fields}{error&&<p role="alert" className="pm-error text-sm">{error}</p>}
    <div className="flex justify-end gap-2"><button className="pm-button" disabled={create.isLoading} onClick={onClose}>Huỷ</button><button className="pm-button pm-button-primary" disabled={create.isLoading||!code.trim()||!codes.length} onClick={()=>{setError('');create.mutateAsync({projectId,code:code.trim(),ipAddress:ip.trim()||undefined,vmCodes:codes}).then(r=>{toast.success(`Đã tạo ${code.trim()} với ${codes.length} VM`);onSaved(r.id);onClose();}).catch(e=>setError(e instanceof Error?e.message:'Chưa tạo được'));}}>{create.isLoading?'Đang tạo…':`Tạo server · ${codes.length} VM`}</button></div>
  </DialogContent></Dialog>;
}
