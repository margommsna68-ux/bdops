"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {trpc} from '@/lib/trpc';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import type {AllocationPreview} from '@/server/vm-management/types';
import {submitAllocation} from './workflow';
import {errorMessage,type ManagedVM} from './shared';
// Assign / change the proxy of one VM (TUT or Chung mooon–Genjy, picked by hand) or autofill the selected VMs (TUT NEW only).
export function AllocationDialog(props:{projectId:string;vmIds?:string[];vm?:ManagedVM;onClose:()=>void;onSaved:()=>void}){
  const [busy,setBusy]=useState(false);
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)props.onClose();}}><DialogContent className="pm-dialog max-w-2xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{props.vm?`Đổi proxy · ${props.vm.server} / ${props.vm.code}`:`Điền proxy cho ${props.vmIds?.length||0} VM đã chọn`}</DialogTitle><DialogDescription>{props.vm?'Giao cấu hình mới. Proxy đã cài vẫn được giữ đến khi xác nhận thay xong.':'Chỉ lấy NEW TUT chưa dùng để điền ô trống. Genjy, nhóm chung và những ô cần kiểm tra được giữ nguyên.'}</DialogDescription></DialogHeader><AllocationForm {...props} onBusy={setBusy}/></DialogContent></Dialog>;
}
export function AllocationForm({projectId,vmIds,vm,onClose,onSaved,onBusy}:{projectId:string;vmIds?:string[];vm?:ManagedVM;onClose:()=>void;onSaved:()=>void;onBusy?:(busy:boolean)=>void}){
  const [endpointId,setEndpointId]=useState(''),[key,setKey]=useState(()=>crypto.randomUUID()),[preview,setPreview]=useState<AllocationPreview|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState<string|null>(null);
  const eligible=trpc.vmManagement.eligible.useQuery({projectId},{enabled:!!vm}),inspect=trpc.vmManagement.preview.useMutation(),commit=trpc.vmManagement.commit.useMutation();
  const busy=inspect.isLoading||commit.isLoading;useEffect(()=>{onBusy?.(busy);},[busy,onBusy]);
  const installed=vm?.holds.find(h=>h.role==='INSTALLED'&&h.owner==='SELF'&&['NEW','LIVE'].includes(h.state));
  const input={projectId,mode:vm?'MANUAL' as const:'AUTO' as const,vmIds:vm?[vm.id]:vmIds,endpointId:vm?endpointId:undefined,idempotencyKey:key};
  const done=(r:{applied:number;errors:number;undone:boolean})=>{setSaved(r.undone?'Đợt này đã được hoàn tác; không giao lại proxy.':`Đã giao ${r.applied} proxy. Nhân viên cần cài trên VM rồi xác nhận.${r.errors?` Còn ${r.errors} VM thiếu proxy.`:''}`);onSaved();};
  const failed=(e:unknown)=>{setError(errorMessage(e));if((e as {data?:{code?:string}})?.data?.code==='CONFLICT'){setPreview(null);setKey(crypto.randomUUID());}};
  const check=async()=>{setError('');try{const r=await submitAllocation(input,i=>inspect.mutateAsync({...i,projectId}),i=>commit.mutateAsync({...i,projectId}),setPreview);if(r.phase==='SAVED')done(r.result);}catch(e){failed(e);}};
  return <div className="space-y-4">
    {saved?<><p role="status" className="pm-success">{saved}</p><div className="flex justify-end gap-2"><button className="pm-button" onClick={onClose}>Đóng</button><Link className="pm-button pm-button-primary" href="/vm-tasks">Xem việc cài</Link></div></>:<>
      {vm&&<label className="pm-label">Proxy giao cho VM<select className="pm-input" aria-label="Proxy giao cho VM" disabled={busy} value={endpointId} onChange={e=>{setEndpointId(e.target.value);setPreview(null);setKey(crypto.randomUUID());setError('');}}><option value="">Chọn proxy NEW chưa dùng (TUT hoặc nhóm chung)</option>{eligible.data?.map(p=><option key={p.endpointId} value={p.endpointId}>{p.ip} · port {p.port} · {p.shared?'Chung mooon–Genjy':'TUT'}</option>)}{installed&&!eligible.data?.some(p=>p.endpointId===installed.endpointId)&&<option value={installed.endpointId}>{installed.ip} · đang cài trên VM này</option>}</select></label>}
      {eligible.error&&vm&&<p role="alert" className="pm-error">{eligible.error.message}</p>}
      {!vm&&<p className="pm-review text-sm">Phạm vi: đúng {vmIds?.length||0} VM đã chọn. Chỉ NEW TUT chưa dùng vào ô trống; VM không đủ điều kiện được giữ nguyên và nêu lý do.</p>}
      {preview&&<div className="pm-review"><p className="text-sm mb-3">{preview.ready} VM đủ proxy · {preview.errors} thiếu / cần kiểm tra · {preview.skipped} giữ nguyên</p><div className="pm-table-scroll max-h-72"><table className="pm-table"><thead><tr><th>Server / VM</th><th>Proxy</th><th>Kết quả</th></tr></thead><tbody>{preview.rows.map(r=><tr key={r.vmId}><td>{r.server} / {r.vm}</td><td>{r.ip||'—'}</td><td className={r.outcome==='ERROR'?'text-red-500':'pm-muted'}>{r.message}</td></tr>)}</tbody></table></div></div>}
      {error&&<p role="alert" className="pm-error">{error}</p>}
      <div className="flex justify-end gap-2"><button className="pm-button" disabled={busy} onClick={onClose}>Đóng</button>{preview?.ready?<button className="pm-button pm-button-primary" disabled={busy} onClick={async()=>{setError('');try{done(await commit.mutateAsync({projectId,token:preview.token,idempotencyKey:key}));}catch(e){failed(e);}}}>{busy?'Đang lưu…':`Giao ${preview.ready} proxy${preview.errors?' đủ điều kiện':''}`}</button>:<button className="pm-button pm-button-primary" disabled={busy||!!vm&&!endpointId||!vm&&!vmIds?.length} onClick={()=>void check()}>{busy?'Đang kiểm tra…':vm?'Giao proxy':'Điền VM thiếu'}</button>}</div>
    </>}
  </div>;
}
