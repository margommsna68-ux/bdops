"use client";
import {useEffect,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {trpc} from '@/lib/trpc';
import toast from 'react-hot-toast';
type Capability='COPY_CREDENTIALS'|'PROXY_IMPORT'|'PROXY_REPLACE'|'EARN_BALANCE'|'EARN_PAYOUT'|'PAYPAL_RECEIPT_RECORD'|'VM_PROXY_FOR_OPS';
export const CAPABILITY_CHOICES:{value:Capability;label:string}[]=[{value:'COPY_CREDENTIALS',label:'Xem / copy thông tin đăng nhập'},{value:'PROXY_IMPORT',label:'Nhập proxy mới'},{value:'PROXY_REPLACE',label:'Nhận proxy replace'},{value:'EARN_BALANCE',label:'Ghi kiểm tra tiền EarnApp (số dư tại VM)'},{value:'EARN_PAYOUT',label:'Chuẩn bị rút EarnApp (giữ email PP, ghi đã gửi / chưa rõ)'},{value:'PAYPAL_RECEIPT_RECORD',label:'Ghi khoản nhận PP của yêu cầu rút'},{value:'VM_PROXY_FOR_OPS',label:'Lấy proxy của VM đang xử lý (AI, chỉ VM đã nhận việc)'}];
/**
 * Rights of one member in the project being viewed (same backend as Kho proxy → Quyền nhân viên: proxyManagement.setCapabilities,
 * ADMIN of a Proxy / VM project, checked on the server). memberId given = that member only (the user page, 22/10/2026).
 */
export function MemberRightsForm({projectId,memberId,onCancel,onSaved}:{projectId:string;memberId?:string;onCancel?:()=>void;onSaved?:()=>void}){
  const utils=trpc.useUtils(),members=trpc.proxyManagement.members.useQuery({projectId},{refetchOnWindowFocus:false});
  const [id,setId]=useState(memberId??''),[capabilities,setCapabilities]=useState<Capability[]>([]),[allowInfrastructure,setAllowInfrastructure]=useState(false);
  useEffect(()=>{setId(memberId??'');},[memberId,projectId]);
  const selected=members.data?.find(m=>m.id===id);
  useEffect(()=>{if(!memberId&&!id&&members.data?.length)setId((members.data.find(m=>m.role!=='ADMIN')||members.data[0]).id);},[id,memberId,members.data]);
  useEffect(()=>{if(selected){setCapabilities(CAPABILITY_CHOICES.filter(c=>selected.capabilities.includes(c.value)).map(c=>c.value));setAllowInfrastructure(selected.role==='ADMIN'||selected.allowedModules.includes('INFRASTRUCTURE'));}},[selected]);
  const save=trpc.proxyManagement.setCapabilities.useMutation({onSuccess:()=>{toast.success('Đã cập nhật quyền trong dự án');void members.refetch();void utils.proxyManagement.access.invalidate();void utils.opsToken.candidates.invalidate();onSaved?.();},onError:e=>toast.error(e.message)});
  const fixed=selected?.role==='ADMIN',viewer=selected?.role==='VIEWER';
  const changed=!!selected&&(allowInfrastructure!==(selected.role==='ADMIN'||selected.allowedModules.includes('INFRASTRUCTURE'))||[...capabilities].sort().join()!==CAPABILITY_CHOICES.filter(c=>selected.capabilities.includes(c.value)).map(c=>c.value).sort().join());
  if(members.error)return <p className="pm-error" role="alert">{members.error.message}</p>;
  if(memberId&&members.data&&!selected)return <p className="pm-muted text-sm">Người này không phải thành viên của dự án đang chọn.</p>;
  return <div className="space-y-3">
    {!memberId&&<label className="pm-label">Thành viên<select className="pm-input" disabled={members.isLoading||save.isLoading} value={id} onChange={e=>setId(e.target.value)}>{members.data?.map(m=><option key={m.id} value={m.id}>{m.user.name||m.user.username||m.user.email} · {m.role}</option>)}</select></label>}
    <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={allowInfrastructure} disabled={fixed||!selected||save.isLoading} onChange={e=>{setAllowInfrastructure(e.target.checked);if(!e.target.checked)setCapabilities([]);}}/>Được truy cập Proxy / Server / VM</label>
    <div className="space-y-3 border-t pt-3">{CAPABILITY_CHOICES.map(c=><label key={c.value} className="flex items-center gap-3 text-sm"><input type="checkbox" checked={fixed||capabilities.includes(c.value)} disabled={fixed||viewer||!allowInfrastructure||save.isLoading} onChange={e=>setCapabilities(e.target.checked?[...capabilities,c.value]:capabilities.filter(v=>v!==c.value))}/>{c.label}</label>)}</div>
    <p className="pm-muted text-xs">{fixed?'ADMIN có toàn bộ quyền trong dự án.':viewer?'Chỉ xem: không thay đổi dữ liệu và không copy mật khẩu.':'Báo BLOCKED và thao tác VM đi theo quyền vận hành; các quyền trên cấp riêng.'}</p>
    <div className="flex justify-end gap-2">{onCancel&&<button className="pm-button" disabled={save.isLoading} onClick={onCancel}>Đóng</button>}<button className={'pm-button'+(changed?' pm-button-primary':'')} disabled={!selected||fixed||!changed||save.isLoading} onClick={()=>save.mutate({projectId,memberId:id,capabilities,allowInfrastructure})}>Lưu quyền</button></div>
  </div>;
}
export function MemberRightsDialog({projectId,onClose}:{projectId:string;onClose:()=>void}){
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="pm-dialog max-w-lg"><DialogHeader><DialogTitle>Quyền nhân viên</DialogTitle><DialogDescription>Cấp quyền trong dự án đang chọn. Nhân viên thao tác trên toàn bộ VM của dự án. Cũng quản lý được trong trang của từng người (Nhân viên → bấm tên).</DialogDescription></DialogHeader><MemberRightsForm projectId={projectId} onCancel={onClose}/></DialogContent></Dialog>;
}
