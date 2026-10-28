"use client";
import {useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {trpc} from '@/lib/trpc';
import toast from 'react-hot-toast';
const CRED=/^[^\s:|]{1,200}$/;
/** "user:pass" → pair, or null. Credentials never contain spaces, ':' or '|'. */
export function parsePair(text:string){const t=text.trim(),i=t.indexOf(':');if(i<=0)return null;const username=t.slice(0,i),password=t.slice(i+1);return CRED.test(username)&&CRED.test(password)?{username,password}:null;}
type Preview={endpoints:number;unchanged:number;byState:Record<string,number>;vms:number;reviewVms:number;package:string|null;packageBefore:string[];updatesPackage:boolean;refusal:string|null};
// Owner 29/10/2026: the provider changed user/pass of some proxies on its site; the web keeps the proxies (ids, VM positions, history)
// and rewrites only their credentials. VMs using them get a new configuration "Chờ áp dụng trên máy".
export function CredentialChangeDialog({projectId,endpointIds,onClose,onSaved}:{projectId:string;endpointIds:string[];onClose:()=>void;onSaved:()=>void}){
  const [text,setText]=useState(''),[wholePackage,setWholePackage]=useState(false),[preview,setPreview]=useState<Preview|null>(null);
  const pair=parsePair(text);
  // One key per exact request: a lost answer retried with the same content replays instead of writing twice.
  const [key,setKey]=useState(()=>crypto.randomUUID());
  const change=trpc.proxyManagement.changeCredentials.useMutation();
  const body=pair?{projectId,key,endpointIds,username:pair.username,password:pair.password,updatePackageCredentials:wholePackage}:null;
  const check=()=>{if(!body)return;change.mutate({...body,preview:true},{onSuccess:r=>setPreview(r as Preview),onError:e=>toast.error(e.message)});};
  const apply=()=>{if(!body)return;change.mutate(body,{onSuccess:r=>{toast.success('Đã đổi user/pass '+r.endpoints+' proxy'+(r.vms?' · '+r.vms+' VM chờ áp dụng trên máy':''));onSaved();onClose();},onError:e=>toast.error(e.message)});};
  const states=preview?Object.entries(preview.byState).map(([s,n])=>s+' '+n).join(' · '):'';
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="pm-dialog max-w-lg"><DialogHeader><DialogTitle>Đổi user/pass</DialogTitle><DialogDescription>{endpointIds.length} proxy đã chọn. Giữ nguyên IP, port, trạng thái, VM và lịch sử; chỉ đổi user/pass. VM đang dùng các proxy này chuyển sang “Chờ áp dụng trên máy”.</DialogDescription></DialogHeader>
    <div className="space-y-3">
      <label className="pm-label">User:pass mới<input className="pm-input" autoComplete="off" spellCheck={false} placeholder="user:pass" value={text} onChange={e=>{setText(e.target.value);setPreview(null);setKey(crypto.randomUUID());}}/></label>
      {text.trim()&&!pair&&<p role="alert" className="pm-field-error">Dán đúng dạng user:pass (không khoảng trắng, không dấu |).</p>}
      <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={wholePackage} onChange={e=>{setWholePackage(e.target.checked);setPreview(null);setKey(crypto.randomUUID());}}/>Cập nhật luôn user/pass của gói (khi nhà cung cấp đổi cả gói)</label>
      {preview&&<div className="pm-review text-sm space-y-1" role="status">
        <div>Đổi <strong>{preview.endpoints}</strong> proxy{preview.unchanged?` · ${preview.unchanged} đã đúng user/pass, giữ nguyên`:''}{states?` (${states})`:''}</div>
        <div>Gói: {preview.packageBefore.join(', ')||'Chưa rõ gói'} → <strong>{preview.package||'không thuộc gói nào'}</strong>{preview.updatesPackage?' · cập nhật user/pass của gói':''}</div>
        <div>{preview.vms} VM chuyển “Chờ áp dụng trên máy”{preview.reviewVms?` · ${preview.reviewVms} VM đang cần đối chiếu (không đổi cấu hình)`:''}</div>
        {preview.refusal&&<p role="alert" className="pm-error">{preview.refusal}</p>}
      </div>}
      {change.error&&!preview&&<p role="alert" className="pm-error text-sm">{change.error.message}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="pm-button" onClick={onClose}>Huỷ</button>
        {preview&&!preview.refusal&&preview.endpoints>0?<button className="pm-button pm-button-primary" disabled={change.isLoading} onClick={apply}>{change.isLoading?'Đang lưu…':'Áp dụng '+preview.endpoints+' proxy'}</button>:<button className="pm-button pm-button-primary" disabled={!pair||change.isLoading} onClick={check}>{change.isLoading?'Đang kiểm tra…':'Kiểm tra'}</button>}
      </div>
    </div>
  </DialogContent></Dialog>;
}
