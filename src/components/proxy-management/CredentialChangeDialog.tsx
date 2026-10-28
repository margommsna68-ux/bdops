"use client";
import {useState} from 'react';
import {Eye,EyeOff} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {trpc} from '@/lib/trpc';
import toast from 'react-hot-toast';
const CRED=/^[^\s:|]{1,200}$/;
/** "user:pass" → pair, or null. Credentials never contain spaces, ':' or '|'. */
export function parsePair(text:string){const t=text.trim(),i=t.indexOf(':');if(i<=0)return null;const username=t.slice(0,i),password=t.slice(i+1);return CRED.test(username)&&CRED.test(password)?{username,password}:null;}
export const validCredential=(v:string)=>CRED.test(v.trim());
type Work={vmId:string|null;endpointId:string|null;kind:'VM_JOB'|'FLEET_COMMAND'|'APPLE_CHECK'};
type Preview={endpoints:number;unchanged:number;byState:Record<string,number>;vms:number;reviewVms:number;blockedVms:number;alreadyPendingVmIds:string[];activeWork:Work[];package:string|null;packageBefore:string[];updatesPackage:boolean;refusal:string|null};
const WORK_LABEL={VM_JOB:'job VM đang chạy',FLEET_COMMAND:'lệnh fleet chưa xong',APPLE_CHECK:'Check Apple ID đang giữ proxy'} as const;
// Owner 29/10/2026: the provider changed user/pass of some proxies on its site; the web keeps the proxies (ids, VM positions, history)
// and rewrites only their credentials. VMs using them get a new configuration "Chờ áp dụng trên máy" (BLOCKED proxies excepted).
export function CredentialChangeDialog({projectId,endpointIds,onClose,onSaved}:{projectId:string;endpointIds:string[];onClose:()=>void;onSaved:()=>void}){
  const [username,setUsername]=useState(''),[password,setPassword]=useState(''),[show,setShow]=useState(false),[wholePackage,setWholePackage]=useState(false),[force,setForce]=useState(false),[preview,setPreview]=useState<Preview|null>(null);
  // One key per exact request: a lost answer retried with the same content replays instead of writing twice.
  const [key,setKey]=useState(()=>crypto.randomUUID());
  const touched=()=>{setPreview(null);setForce(false);setKey(crypto.randomUUID());};
  // Pasting "user:pass" into the user field fills both fields.
  const onUser=(v:string)=>{const pair=v.includes(':')?parsePair(v):null;if(pair){setUsername(pair.username);setPassword(pair.password);}else setUsername(v);touched();};
  const ok=validCredential(username)&&validCredential(password);
  const change=trpc.proxyManagement.changeCredentials.useMutation();
  const body={projectId,key,endpointIds,username:username.trim(),password:password.trim(),updatePackageCredentials:wholePackage};
  const check=()=>{if(!ok)return;change.mutate({...body,preview:true},{onSuccess:r=>setPreview(r as unknown as Preview),onError:e=>toast.error(e.message)});};
  const apply=()=>{if(!ok)return;change.mutate({...body,force},{onSuccess:r=>{toast.success('Đã đổi user/pass '+r.endpoints+' proxy'+(r.vms?' · '+r.vms+' VM chờ áp dụng trên máy':''));onSaved();onClose();},onError:e=>toast.error(e.message)});};
  const states=preview?Object.entries(preview.byState).map(([s,n])=>s+' '+n).join(' · '):'';
  const busy=!!preview?.activeWork.length,canApply=!!preview&&!preview.refusal&&preview.endpoints>0&&(!busy||force);
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="pm-dialog max-w-lg"><DialogHeader><DialogTitle>Đổi user/pass</DialogTitle><DialogDescription>{endpointIds.length} proxy đã chọn. Giữ nguyên IP, port, trạng thái, VM và lịch sử; chỉ đổi user/pass. VM đang dùng các proxy này chuyển sang “Chờ áp dụng trên máy”.</DialogDescription></DialogHeader>
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="pm-label">User mới<input className="pm-input" autoComplete="off" spellCheck={false} placeholder="user (hoặc dán user:pass)" value={username} onChange={e=>onUser(e.target.value)}/></label>
        <label className="pm-label">Password mới<span className="flex gap-1"><input type={show?'text':'password'} className="pm-input" autoComplete="new-password" spellCheck={false} value={password} onChange={e=>{setPassword(e.target.value);touched();}}/><button type="button" className="pm-button pm-button-quiet" aria-label={show?'Ẩn password':'Hiện password'} aria-pressed={show} onClick={()=>setShow(v=>!v)}>{show?<EyeOff size={14}/>:<Eye size={14}/>}</button></span></label>
      </div>
      {(username.trim()||password.trim())&&!ok&&<p role="alert" className="pm-field-error">User và password không để trống, không có khoảng trắng, dấu : hoặc |.</p>}
      <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={wholePackage} onChange={e=>{setWholePackage(e.target.checked);touched();}}/>Cập nhật luôn user/pass của gói (khi nhà cung cấp đổi cả gói)</label>
      {preview&&<div className="pm-review text-sm space-y-1" role="status">
        <div>Đổi <strong>{preview.endpoints}</strong> proxy{preview.unchanged?` · ${preview.unchanged} đã đúng user/pass, giữ nguyên`:''}{states?` (${states})`:''}</div>
        <div>Gói: {preview.packageBefore.join(', ')||'Chưa rõ gói'} → <strong>{preview.package||'không thuộc gói nào'}</strong>{preview.updatesPackage?' · cập nhật user/pass của gói':''}</div>
        <div>{preview.vms} VM chuyển “Chờ áp dụng trên máy”{preview.alreadyPendingVmIds.length?` (${preview.alreadyPendingVmIds.length} VM đang chờ áp dụng sẵn)`:''}{preview.reviewVms?` · ${preview.reviewVms} VM đang cần đối chiếu (không đổi cấu hình)`:''}</div>
        {preview.blockedVms>0&&<div>{preview.blockedVms} VM dùng proxy BLOCKED: chỉ đổi user/pass, VM chờ nhận replace (không đổi cấu hình)</div>}
        {busy&&<div className="pm-error">Đang có việc: {preview.activeWork.map(w=>WORK_LABEL[w.kind]).join(', ')}. <label className="inline-flex gap-1 items-center"><input type="checkbox" checked={force} onChange={e=>setForce(e.target.checked)}/>Vẫn đổi</label></div>}
        {preview.refusal&&<p role="alert" className="pm-error">{preview.refusal}</p>}
      </div>}
      {change.error&&!preview&&<p role="alert" className="pm-error text-sm">{change.error.message}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="pm-button" onClick={onClose}>Huỷ</button>
        {preview&&!preview.refusal&&preview.endpoints>0?<button className="pm-button pm-button-primary" disabled={change.isLoading||!canApply} onClick={apply}>{change.isLoading?'Đang lưu…':'Áp dụng '+preview.endpoints+' proxy'}</button>:<button className="pm-button pm-button-primary" disabled={!ok||change.isLoading} onClick={check}>{change.isLoading?'Đang kiểm tra…':'Kiểm tra'}</button>}
      </div>
    </div>
  </DialogContent></Dialog>;
}
