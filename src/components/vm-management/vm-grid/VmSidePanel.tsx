"use client";
import {useState} from 'react';
import Link from 'next/link';
import {Copy,X} from 'lucide-react';
import toast from 'react-hot-toast';
import {trpc} from '@/lib/trpc';
import {localDate} from '@/components/proxy-management/HistoryPanel';
import {useBusinessKey} from '@/components/business-management/shared';
import {workLabels} from '@/components/business-management/workflow';
import {displayNote} from '@/server/vm-management/vm-codes';
import {AllocationForm} from '../AllocationDialog';
import {InstallDialog} from '../InstallWorkspace';
import {SdkHistoryTable} from '../SdkCell';
import {InlineText} from '../InlineText';
import {vmView,viewLabels,proxyAddress} from '../workflow';
import {errorMessage,type ManagedVM} from '../shared';
import {reviewReason,type CopyWhich,type GridRights} from './VmGrid';
import type {PanelTab} from './grid-model';
const TABS:{key:PanelTab;label:string}[]=[{key:'overview',label:'Tổng quan'},{key:'proxy',label:'Proxy'},{key:'install',label:'Việc cài'},{key:'work',label:'Công việc'},{key:'account',label:'Gmail'},{key:'history',label:'Lịch sử'}];
const ROLE:Record<string,string>={DESIRED:'Chờ cài',INSTALLED:'Đã cài',UNCERTAIN:'Giữ để kiểm tra'};
const CONFIG_STATUS:Record<string,string>={PLANNED:'Chưa bắt đầu',IN_PROGRESS:'Đang cài',FAILED:'Cài chưa xong',CONFIRMED:'Đã xác nhận',CANCELLED:'Đã huỷ'};
const CAUSE:Record<string,string>={HOLD:'VM còn giữ proxy (chờ cài, đã cài hoặc giữ để kiểm tra). Bỏ gán ở bảng proxy hoặc hoàn tất ở Việc cài trước khi xoá.',TASK:'VM còn việc cài proxy chưa xong. Hoàn tất hoặc huỷ ở tab Việc cài.',INSTALLED:'VM còn liên kết proxy đã cài. Đổi hoặc gỡ proxy rồi xác nhận trước khi xoá.',SDK:'SDK của máy đang thuộc VM khác; web không giành lại. Xoá SDK ở máy kia hoặc giữ máy này ở trạng thái đã xoá.',SERVER:'Server của VM đang ở trạng thái đã xoá; khôi phục server trước.'};
export function VmSidePanel({projectId,vm,tab,cause,rights,gmailEmail,onTab,onClose,onSaved,onCopy}:{projectId:string;vm:ManagedVM;tab:PanelTab;cause:string|null;rights:GridRights;gmailEmail:string|null;onTab:(t:PanelTab)=>void;onClose:()=>void;onSaved:()=>void;onCopy:(vm:ManagedVM,which:CopyWhich)=>void}){
  const deleted=!!vm.archivedAt,status=vmView(vm);
  return <aside className="vm-panel" aria-label={'Chi tiết '+vm.server+' / '+vm.code}>
    <div className="vm-panel-head"><div className="min-w-0"><p className="pm-muted text-xs">{vm.server}</p><h2 className="pm-code vm-ellipsis">{vm.code}</h2><span className={`pm-badge ${deleted?'pm-badge-muted':status==='REVIEW'?'pm-badge-red':status==='PENDING'?'vm-badge-pending':status==='INSTALLED'?'pm-badge-green':'pm-badge-muted'}`}>{deleted?'Đã xoá':viewLabels[status]}</span></div><button className="pm-icon-button" aria-label="Đóng chi tiết" title="Đóng (Esc)" onClick={onClose}><X size={16}/></button></div>
    <div className="vm-panel-tabs" role="tablist">{TABS.map(t=><button key={t.key} type="button" role="tab" aria-selected={tab===t.key} className={tab===t.key?'active':''} onClick={()=>onTab(t.key)}>{t.label}</button>)}</div>
    <div className="vm-panel-body">
      {cause&&CAUSE[cause]&&<p className="pm-review text-sm" role="note"><strong>Lý do bị chặn:</strong> {CAUSE[cause]}</p>}
      {tab==='overview'&&<Overview projectId={projectId} vm={vm} rights={rights} gmailEmail={gmailEmail} onTab={onTab} onSaved={onSaved} onCopy={onCopy}/>}
      {tab==='proxy'&&(deleted?<p className="pm-muted text-sm">Máy đã xoá không được giao proxy. Khôi phục trước.</p>:!rights.assign?<p className="pm-muted text-sm">Chưa có quyền giao proxy.</p>:!rights.sourceConnected?<p className="pm-source-warning">Cần kết nối nguồn Genjy trước khi giao proxy.</p>:<><p className="pm-muted text-sm">{vm.installed?'Giao cấu hình mới. Proxy đã cài vẫn được giữ đến khi xác nhận thay xong.':'Chọn proxy NEW chưa dùng: TUT hoặc Chung mooon–Genjy.'}</p><AllocationForm key={vm.id+(vm.desired?.id||'')} projectId={projectId} vm={vm} onClose={()=>onTab('overview')} onSaved={onSaved}/></>)}
      {tab==='install'&&<InstallTab projectId={projectId} vm={vm} rights={rights} onSaved={onSaved}/>}
      {tab==='work'&&<WorkTab projectId={projectId} vm={vm}/>}
      {tab==='account'&&<AccountTab projectId={projectId} vm={vm} canEdit={rights.assign&&!deleted} onSaved={onSaved}/>}
      {tab==='history'&&<HistoryTab projectId={projectId} vm={vm}/>}
    </div>
  </aside>;
}
function Overview({projectId,vm,rights,gmailEmail,onTab,onSaved,onCopy}:{projectId:string;vm:ManagedVM;rights:GridRights;gmailEmail:string|null;onTab:(t:PanelTab)=>void;onSaved:()=>void;onCopy:(vm:ManagedVM,which:CopyWhich)=>void}){
  const detail=trpc.vmManagement.detail.useQuery({projectId,vmId:vm.id}),updateVM=trpc.vmManagement.updateVM.useMutation(),sdk=trpc.vmManagement.sdkApply.useMutation(),[confirmClear,setConfirmClear]=useState(false);
  const deleted=!!vm.archivedAt,cfg=(id?:string)=>detail.data?.configurations.find(c=>c.id===id),d=cfg(vm.desired?.id),i=cfg(vm.installed?.id),status=vmView(vm);
  const saveNotes=async(value:string)=>{const r=await updateVM.mutateAsync({projectId,vmId:vm.id,notes:value||null,expectedRevision:vm.revision});if(r.saved){toast.success('Đã lưu');onSaved();}};
  const clearSdk=async()=>{try{await sdk.mutateAsync({projectId,key:crypto.randomUUID(),items:[{vmId:vm.id,sdk:null,expectedRevision:vm.revision,clear:true}]});toast.success('Đã xoá SDK; mã cũ còn trong lịch sử');setConfirmClear(false);onSaved();}catch(e){toast.error(errorMessage(e));}};
  return <div className="space-y-4 text-sm">
    {status==='REVIEW'&&!deleted&&<p className="pm-review">{reviewReason(vm)}</p>}
    <section className="vm-panel-card"><h3>Proxy</h3>
      {!vm.desired&&!vm.installed&&!vm.holds.length&&<p className="pm-muted">Chưa có proxy.</p>}
      {vm.desired&&vm.desired.id!==vm.installed?.id&&<div className="vm-panel-row"><div><span className="vm-tag vm-tag-plan">Được giao</span> <span className="pm-ip">{proxyAddress(vm.desired)}</span><p className="pm-muted text-xs">Cấu hình #{vm.desired.version} · {CONFIG_STATUS[vm.desired.status]||vm.desired.status}{d?' · giao bởi '+(d.createdBy||'—')+' '+localDate(d.createdAt):''}{vm.desired.startedAt?' · bắt đầu '+localDate(vm.desired.startedAt):''}</p></div>{rights.copy&&<button className="pm-button pm-button-quiet" onClick={()=>onCopy(vm,'DESIRED')}><Copy size={14}/>Copy</button>}</div>}
      {vm.installed&&<div className="vm-panel-row"><div><span className="vm-tag vm-tag-ok">Đã cài</span> <span className="pm-ip">{proxyAddress(vm.installed)}</span><p className="pm-muted text-xs">Cấu hình #{vm.installed.version}{vm.installed.confirmedAt?' · xác nhận '+localDate(vm.installed.confirmedAt):''}{i?.confirmedBy?' bởi '+i.confirmedBy:''}</p></div>{rights.copy&&<button className="pm-button pm-button-quiet" onClick={()=>onCopy(vm,'INSTALLED')}><Copy size={14}/>Copy</button>}</div>}
      {vm.holds.filter(h=>h.endpointId!==vm.desired?.endpointId&&h.endpointId!==vm.installed?.endpointId).map(h=><p key={h.id} className="pm-muted text-xs">Giữ thêm: <span className="pm-ip">{h.ip}</span> · {ROLE[h.role]||h.role} · {h.state}</p>)}
      {!deleted&&rights.assign&&<div className="flex gap-2 flex-wrap mt-2"><button className="pm-button" disabled={!rights.sourceConnected} onClick={()=>onTab('proxy')}>{status==='MISSING'?'Gán proxy':'Đổi proxy'}</button>{vm.desired&&vm.desired.id!==vm.installed?.id&&<button className="pm-button" onClick={()=>onTab('install')}>Cài / xác nhận</button>}</div>}
    </section>
    <section className="vm-panel-card"><h3>SDK EarnApp</h3>{vm.sdk?<><code className="vm-sdk vm-sdk-full">{vm.sdk.id}</code><p className="pm-muted text-xs mt-1">{vm.sdk.recordedBy||'—'} · {localDate(vm.sdk.recordedAt)}</p></>:<p className="vm-sdk-missing">Chưa có SDK</p>}
      <div className="flex gap-2 flex-wrap mt-2">{vm.sdk&&<button className="pm-button pm-button-quiet" onClick={()=>void navigator.clipboard?.writeText(vm.sdk!.id).then(()=>toast.success('Đã copy SDK'))}><Copy size={14}/>Copy SDK</button>}{vm.sdk&&rights.assign&&!deleted&&(confirmClear?<span className="flex gap-2 items-center"><span>Xoá SDK của {vm.code}?</span><button className="pm-button" disabled={sdk.isLoading} onClick={()=>void clearSdk()}>Xoá</button><button className="pm-button pm-button-quiet" onClick={()=>setConfirmClear(false)}>Huỷ</button></span>:<button className="pm-button pm-button-quiet" onClick={()=>setConfirmClear(true)}>Xoá SDK</button>)}</div>
      <p className="pm-muted text-xs mt-1">Sửa SDK ngay tại ô SDK trong bảng (Enter/F2). Ghi SDK không chứng minh app đang chạy.</p></section>
    <section className="vm-panel-card"><h3>Gmail của VM</h3><p>{gmailEmail||<span className="pm-muted">Chưa liên kết</span>}</p>{!deleted&&rights.assign&&<button className="pm-button pm-button-quiet mt-2" onClick={()=>onTab('account')}>Đổi Gmail</button>}</section>
    <section className="vm-panel-card"><h3>Ghi chú</h3><InlineText value={displayNote(vm.notes)} label={'ghi chú '+vm.code} placeholder="thêm ghi chú" canEdit={rights.manage&&!deleted} multiline className="vm-panel-note" onSave={saveNotes}/></section>
  </div>;
}
function InstallTab({projectId,vm,rights,onSaved}:{projectId:string;vm:ManagedVM;rights:GridRights;onSaved:()=>void}){
  const detail=trpc.vmManagement.detail.useQuery({projectId,vmId:vm.id}),pending=vm.desired&&vm.desired.id!==vm.installed?.id&&!vm.archivedAt;
  const open=(detail.data?.tasks||[]).filter(t=>t.status==='PENDING'||t.status==='IN_PROGRESS');
  return <div className="space-y-4">
    {pending?<InstallDialog key={vm.desired!.id} embedded projectId={projectId} vm={vm} canCopy={rights.copy} canConfirm={rights.confirm} sourceConnected={rights.sourceConnected} onClose={()=>{}} onChanged={onSaved}/>:<p className="pm-muted text-sm">Không có cấu hình chờ cài trên máy này.{vm.installed?' Proxy đã cài: '+proxyAddress(vm.installed)+'.':''}</p>}
    {vm.holds.some(h=>h.role==='UNCERTAIN')&&<p className="pm-review text-sm">Giữ để kiểm tra: {vm.holds.filter(h=>h.role==='UNCERTAIN').map(h=>h.ip).join(', ')}. Kiểm tra thực tế trên máy; khi xác nhận cấu hình mới, các proxy cũ được thả.</p>}
    {!pending&&open.length>0&&<div><h3 className="text-sm font-semibold mb-2">Việc cài còn mở</h3><ul className="text-sm space-y-1">{open.map(t=><li key={t.id}>{t.title} · {t.status==='IN_PROGRESS'?'Đang làm':'Chưa bắt đầu'} · {localDate(t.scheduledAt)}</li>)}</ul><p className="pm-muted text-xs mt-1">Việc này không còn cấu hình chờ cài đi kèm; mở <Link className="pm-link" href="/vm-tasks">Việc cài</Link> để xử lý.</p></div>}
    {detail.data&&detail.data.tasks.length>0&&<details><summary className="text-sm cursor-pointer">Tất cả việc của máy ({detail.data.tasks.length})</summary><ul className="text-xs space-y-1 mt-2">{detail.data.tasks.map(t=><li key={t.id}>{localDate(t.scheduledAt)} · {t.title} · {t.status}</li>)}</ul></details>}
  </div>;
}
function WorkTab({projectId,vm}:{projectId:string;vm:ManagedVM}){
  const work=trpc.businessManagement.work.useQuery({projectId}),rows=(work.data?.items||[]).filter(w=>w.vmId===vm.id);
  return <div className="space-y-3">{work.error&&<p role="alert" className="pm-error">{work.error.message}</p>}
    {rows.length?<ul className="space-y-2">{rows.map(w=><li key={w.id} className="vm-panel-card text-sm"><strong>{w.title}</strong><p className="pm-muted text-xs">{workLabels[w.status as keyof typeof workLabels]||w.status}{w.assignee?' · '+w.assignee:''}{w.dueDate?' · hạn '+w.dueDate:''}</p>{w.notes&&<p className="text-xs mt-1">{w.notes}</p>}</li>)}</ul>:<p className="pm-muted text-sm">{work.isLoading?'Đang tải…':'Chưa có công việc cho VM này.'}</p>}
    <Link className="pm-button pm-button-quiet" href={`/work?vm=${vm.id}`}>Thêm / sửa ở trang Công việc</Link></div>;
}
function AccountTab({projectId,vm,canEdit,onSaved}:{projectId:string;vm:ManagedVM;canEdit:boolean;onSaved:()=>void}){
  const accounts=trpc.businessManagement.accounts.useQuery({projectId}),keyFor=useBusinessKey(),row=accounts.data?.vms.find(v=>v.id===vm.id),[pick,setPick]=useState<string|null>(null),value=pick??row?.gmailId??'',[search,setSearch]=useState('');
  const bind=trpc.businessManagement.bindAccount.useMutation({onSuccess:r=>{if(r.undone){toast.error('Thao tác đã hoàn tác; tải lại.');return;}toast.success('Đã lưu Gmail cho VM');setPick(null);onSaved();},onError:e=>toast.error(e.message)});
  const options=(accounts.data?.gmails||[]).filter(g=>!g.archivedAt&&(g.id===value||g.email.toLowerCase().includes(search.toLowerCase())));
  if(vm.archivedAt) return <p className="pm-muted text-sm">Máy đã xoá; Gmail được giữ trong dữ liệu.</p>;
  return <form className="space-y-3" onSubmit={e=>{e.preventDefault();if(row){const p={projectId,vmId:vm.id,gmailId:value||null,expectedRevision:row.revision};bind.mutate({...p,key:keyFor(p)});}}}>
    <p className="text-sm">Gmail đang liên kết với VM (không phải tài khoản EarnApp). Một Gmail có thể dùng cho nhiều VM; đổi ở đây không tháo Gmail khỏi VM khác.</p>
    <input className="pm-input" aria-label="Tìm Gmail" placeholder="Tìm Gmail…" value={search} onChange={e=>setSearch(e.target.value)}/>
    <select className="pm-input" aria-label="Gmail của VM" disabled={!canEdit||bind.isLoading} value={value} onChange={e=>setPick(e.target.value)}><option value="">Chưa liên kết</option>{options.map(g=><option key={g.id} value={g.id}>{g.email}{g.vmRefs.length?` · ${g.vmRefs.length} VM`:''}</option>)}</select>
    {accounts.error&&<p role="alert" className="pm-error">{accounts.error.message}</p>}
    {canEdit&&<div className="flex justify-end gap-2"><Link className="pm-button pm-button-quiet" href="/gmails">Thêm Gmail</Link><button className="pm-button pm-button-primary" disabled={!row||bind.isLoading||value===(row?.gmailId||'')}>{bind.isLoading?'Đang lưu…':'Lưu'}</button></div>}
  </form>;
}
function HistoryTab({projectId,vm}:{projectId:string;vm:ManagedVM}){
  const detail=trpc.vmManagement.detail.useQuery({projectId,vmId:vm.id});
  return <div className="space-y-4">
    <div><h3 className="text-sm font-semibold mb-2">Các phiên bản cấu hình proxy</h3>{detail.error&&<p role="alert" className="pm-error">{detail.error.message}</p>}
      <div className="vm-bulk-table"><table className="pm-table"><thead><tr><th>#</th><th>Proxy</th><th>Trạng thái</th><th>Người / ngày</th></tr></thead><tbody>{detail.data?.configurations.map(c=><tr key={c.id}><td>{c.version}{c.current&&<div className="text-xs pm-muted">{c.current==='DESIRED'?'đang giao':'đang cài'}</div>}</td><td><span className="pm-ip">{c.ip?c.ip+(c.port?':'+c.port:''):'—'}</span>{c.group&&<div className="text-xs pm-muted">{c.group}</div>}</td><td className="text-xs">{CONFIG_STATUS[c.status]||c.status}{c.failureNote&&<div className="pm-muted">{c.failureNote}</div>}</td><td className="text-xs">Giao: {c.createdBy||'—'} · {localDate(c.createdAt)}{c.startedAt&&<div>Bắt đầu: {localDate(c.startedAt)}</div>}{c.confirmedAt&&<div>Xác nhận: {c.confirmedBy||'—'} · {localDate(c.confirmedAt)}</div>}</td></tr>)}{detail.data&&!detail.data.configurations.length&&<tr><td colSpan={4} className="pm-empty">Chưa có cấu hình proxy.</td></tr>}</tbody></table></div></div>
    <div><h3 className="text-sm font-semibold mb-2">Lịch sử SDK</h3><SdkHistoryTable projectId={projectId} vmId={vm.id}/></div>
    <p className="pm-muted text-xs">Mọi thao tác ghi đều có ở <Link className="pm-link" href="/history">Lịch sử thao tác</Link> và hoàn tác được ở đó.</p>
  </div>;
}
