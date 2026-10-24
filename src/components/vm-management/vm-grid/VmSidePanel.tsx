"use client";
import React from 'react';
import {formatLedger} from '@/lib/money-input';
import Link from 'next/link';
import {Copy,X} from 'lucide-react';
import toast from 'react-hot-toast';
import {trpc} from '@/lib/trpc';
import {localDate} from '@/components/proxy-management/HistoryPanel';
import {workLabels} from '@/components/business-management/workflow';
import {displayNote} from '@/server/vm-management/vm-codes';
import {ChangeProxy,proxyCellInfo} from './ProxyCell';
import {SdkHistoryTable} from '../SdkCell';
import {SdkEditor} from './SdkCell';
import {InlineText} from '../InlineText';
import {vmView,viewLabels,proxyAddress} from '../workflow';
import type {ManagedVM} from '../shared';
import {reviewReason,type CopyWhich,type GridRights} from './VmGrid';
import type {PanelTab} from './grid-model';
import {links} from '@/lib/links';
import {moduleOn} from '@/lib/features';
import {AccountPicker,TYPE_LABEL,type VmAccount} from './AccountCell';
import {opsLabel,type VmOpsStatus} from '@/lib/vm-ops';
const TABS:{key:PanelTab;label:string}[]=[{key:'overview',label:'Tổng quan'},{key:'proxy',label:'Thay proxy'},{key:'work',label:'Công việc'},{key:'account',label:'Tài khoản'},{key:'history',label:'Lịch sử'}];
// Configuration history (19/10/2026: no install step; older install states stay readable as history).
const CONFIG_STATUS:Record<string,string>={PLANNED:'Gán',IN_PROGRESS:'Gán (dữ liệu cũ: đã bắt đầu cài)',FAILED:'Gán (dữ liệu cũ: cài chưa xong)',CONFIRMED:'Dữ liệu cũ: đã xác nhận cài',CANCELLED:'Đã thay / bỏ'};
const ROLE:Record<string,string>={DESIRED:'Đang dùng',INSTALLED:'Đã cài trước đây',UNCERTAIN:'Giữ để kiểm tra'};
const CAUSE:Record<string,string>={HOLD:'VM còn giữ proxy. Bỏ gán ở Kho proxy (hoặc đối chiếu ở ô Proxy) trước khi xoá.',INSTALLED:'VM còn liên kết proxy cũ. Đổi hoặc bỏ gán proxy trước khi xoá.',SDK:'SDK cũ của máy đã được chuyển sang VM khác; web không giành lại. Ghi SDK mới cho máy này nếu cần.',SERVER:'Server của VM đang ở trạng thái đã xoá; khôi phục server trước.'};
export function VmSidePanel({projectId,vm,tab,cause,rights,account,onTab,onClose,onSaved,onCopy}:{projectId:string;vm:ManagedVM;tab:PanelTab;cause:string|null;rights:GridRights;account:VmAccount|undefined;onTab:(t:PanelTab)=>void;onClose:()=>void;onSaved:()=>void;onCopy:(vm:ManagedVM,which:CopyWhich)=>void}){
  const deleted=!!vm.archivedAt,status=vmView(vm);
  return <aside className="vm-panel" aria-label={'Chi tiết '+vm.server+' / '+vm.code}>
    <div className="vm-panel-head"><div className="min-w-0"><p className="pm-muted text-xs">{vm.server}</p><h2 className="pm-code vm-ellipsis">{vm.code}</h2><span className={`pm-badge ${deleted?'pm-badge-muted':status==='REVIEW'||status==='BLOCKED'?'pm-badge-red':status==='ASSIGNED'?'pm-badge-green':'pm-badge-muted'}`}>{deleted?'Đã xoá':viewLabels[status]}</span></div><button className="pm-icon-button" aria-label="Đóng chi tiết" title="Đóng (Esc)" onClick={onClose}><X size={16}/></button></div>
    <div className="vm-panel-tabs" role="tablist">{TABS.filter(t=>t.key!=='work'||moduleOn('WORK')).map(t=><button key={t.key} type="button" role="tab" aria-selected={tab===t.key} className={tab===t.key?'active':''} onClick={()=>onTab(t.key)}>{t.label}</button>)}</div>
    <div className="vm-panel-body">
      {cause&&CAUSE[cause]&&<p className="pm-review text-sm" role="note"><strong>Lý do bị chặn:</strong> {CAUSE[cause]}</p>}
      {tab==='overview'&&<Overview projectId={projectId} vm={vm} rights={rights} account={account} onTab={onTab} onSaved={onSaved} onCopy={onCopy}/>}
      {tab==='proxy'&&(deleted?<p className="pm-muted text-sm">Máy đã xoá không được giao proxy. Khôi phục trước.</p>:<div className="vm-panel-card"><ChangeProxy projectId={projectId} vm={vm} info={proxyCellInfo(vm)} rights={{assign:rights.assign,copy:rights.copy,replace:!!rights.replace,block:!!rights.block}} onBusy={()=>undefined} onDone={onSaved} onCancel={()=>onTab('overview')}/></div>)}
      {tab==='work'&&!moduleOn('WORK')&&<p className="pm-muted text-sm">Giao việc đang tạm ẩn. Dữ liệu việc cũ vẫn được giữ.</p>}
      {tab==='work'&&moduleOn('WORK')&&<WorkTab projectId={projectId} vm={vm}/>}
      {tab==='account'&&<AccountTab projectId={projectId} vm={vm} account={account} canEdit={(rights.accountAssign??rights.assign)&&!deleted} onSaved={onSaved}/>}
      {tab==='history'&&<HistoryTab projectId={projectId} vm={vm}/>}
    </div>
  </aside>;
}
function Overview({projectId,vm,rights,account,onTab,onSaved,onCopy}:{projectId:string;vm:ManagedVM;rights:GridRights;account:VmAccount|undefined;onTab:(t:PanelTab)=>void;onSaved:()=>void;onCopy:(vm:ManagedVM,which:CopyWhich)=>void}){
  const detail=trpc.vmManagement.detail.useQuery({projectId,vmId:vm.id}),updateVM=trpc.vmManagement.updateVM.useMutation();
  const deleted=!!vm.archivedAt,cfg=(id?:string)=>detail.data?.configurations.find(c=>c.id===id),status=vmView(vm);
  const saveNotes=async(value:string)=>{const r=await updateVM.mutateAsync({projectId,vmId:vm.id,notes:value||null,expectedRevision:vm.revision});if(r.saved){toast.success('Đã lưu');onSaved();}};
  return <div className="space-y-4 text-sm">
    {status==='REVIEW'&&!deleted&&<p className="pm-review">{reviewReason(vm)}</p>}
    <section className="vm-panel-card"><h3>Proxy</h3>
      {(()=>{const info=proxyCellInfo(vm),c=info.current,config=c?[vm.desired,vm.installed].find(x=>x&&x.endpointId===c.endpointId):null,dc=config?cfg(config.id):undefined;
        return <>{c?<div className="vm-panel-row"><div><span className="pm-ip">{proxyAddress(c)}</span>{info.warning&&<span className="vm-proxy-state vm-proxy-state-review"> {info.warning}</span>}<p className="pm-muted text-xs">Cấu hình #{config!.version}{dc?' · gán bởi '+(dc.createdBy||'—')+' '+localDate(dc.createdAt):''}</p></div>{rights.copy&&<button className="pm-button pm-button-quiet" onClick={()=>onCopy(vm,config===vm.desired?'DESIRED':'INSTALLED')}><Copy size={14}/>Copy</button>}</div>
          :info.candidates.length?<p className="text-xs text-amber-700">Cần đối chiếu: {info.candidates.map(x=>proxyAddress(x)+' ('+x.label+')').join(', ')}</p>:<p className="pm-muted">Chưa có proxy.</p>}
          {vm.holds.filter(h=>h.role!=='UNCERTAIN'&&h.endpointId!==c?.endpointId&&!info.candidates.some(x=>x.endpointId===h.endpointId)).map(h=><p key={h.id} className="pm-muted text-xs">Giữ thêm: <span className="pm-ip">{h.ip}</span> · {ROLE[h.role]||h.role} · {h.state}</p>)}
          {!deleted&&rights.assign&&<div className="flex gap-2 flex-wrap mt-2"><button className="pm-button" onClick={()=>onTab('proxy')}>{status==='MISSING'?'Gán proxy':'Thay proxy'}</button></div>}</>;})()}
    </section>
    <section className="vm-panel-card"><h3>SDK EarnApp</h3>
      <SdkEditor key={vm.id} embedded projectId={projectId} vm={vm} account={account} canEdit={rights.assign&&!deleted} money={{read:!!rights.sdkMoneyRead,write:!!rights.sdkMoneyWrite&&!deleted}} draft={null} onDraft={()=>undefined}/></section>
    <section className="vm-panel-card"><h3>Tài khoản EarnApp</h3><p>{account?.earnApp?<>{account.earnApp.login.email} <span className="pm-muted">({TYPE_LABEL[account.earnApp.login.type||'']||'chưa chọn loại'})</span> · PayPal {account.earnApp.paypal?account.earnApp.paypal.code+' · '+(account.earnApp.paypal.email||'chưa xác định email'):'chưa có'}</>:account?.legacyGmail?<span className="pm-muted">Gmail cũ: {account.legacyGmail} (chưa có tài khoản EarnApp)</span>:<span className="pm-muted">Chưa gán</span>}</p><p className="pm-muted text-xs">{account?.earnApp?.registeredAt?'Đã ghi đăng ký EarnApp':'Chưa ghi đăng ký EarnApp'}. Sửa ngay tại ô Tài khoản EarnApp trong bảng.</p>{!deleted&&(rights.accountAssign??rights.assign)&&<button className="pm-button pm-button-quiet mt-2" onClick={()=>onTab('account')}>Đổi tài khoản / PayPal</button>}</section>
    <section className="vm-panel-card"><h3>Ghi chú</h3><InlineText value={displayNote(vm.notes)} label={'ghi chú '+vm.code} placeholder="thêm ghi chú" canEdit={rights.manage&&!deleted} multiline className="vm-panel-note" onSave={saveNotes}/></section>
  </div>;
}
function WorkTab({projectId,vm}:{projectId:string;vm:ManagedVM}){
  const work=trpc.businessManagement.work.useQuery({projectId}),rows=(work.data?.items||[]).filter(w=>w.vmId===vm.id);
  return <div className="space-y-3">{work.error&&<p role="alert" className="pm-error">{work.error.message}</p>}
    {rows.length?<ul className="space-y-2">{rows.map(w=><li key={w.id} className="vm-panel-card text-sm"><strong>{w.title}</strong><p className="pm-muted text-xs">{workLabels[w.status as keyof typeof workLabels]||w.status}{w.assignee?' · '+w.assignee:''}{w.dueDate?' · hạn '+w.dueDate:''}</p>{w.notes&&<p className="text-xs mt-1">{w.notes}</p>}</li>)}</ul>:<p className="pm-muted text-sm">{work.isLoading?'Đang tải…':'Chưa có công việc cho VM này.'}</p>}
    <Link className="pm-button pm-button-quiet" href={links.work({vm:vm.id})}>Thêm / sửa ở trang Công việc</Link></div>;
}
// EarnApp account of the VM: same picker as the cell (login + PayPal saved together), plus a link to the stock.
function AccountTab({projectId,vm,account,canEdit,onSaved}:{projectId:string;vm:ManagedVM;account:VmAccount|undefined;canEdit:boolean;onSaved:()=>void}){
  if(vm.archivedAt) return <p className="pm-muted text-sm">Máy đã xoá; tài khoản và lịch sử được giữ trong dữ liệu.</p>;
  return <div className="space-y-3"><AccountPicker projectId={projectId} vm={vm} link={account} canAssign={canEdit} onDone={onSaved}/><Link className="pm-button pm-button-quiet" href={links.accounts()}>Mở Kho tài khoản</Link></div>;
}
function HistoryTab({projectId,vm}:{projectId:string;vm:ManagedVM}){
  const detail=trpc.vmManagement.detail.useQuery({projectId,vmId:vm.id});
  return <div className="space-y-4">
    <div><h3 className="text-sm font-semibold mb-2">Các phiên bản cấu hình proxy</h3>{detail.error&&<p role="alert" className="pm-error">{detail.error.message}</p>}
      <div className="vm-bulk-table"><table className="pm-table"><thead><tr><th>#</th><th>Proxy</th><th>Trạng thái</th><th>Người / ngày</th></tr></thead><tbody>{detail.data?.configurations.map(c=><tr key={c.id}><td>{c.version}{c.current&&<div className="text-xs pm-muted">{c.current==='DESIRED'?'đang dùng':'đã cài trước đây'}</div>}</td><td><span className="pm-ip">{c.ip?c.ip+(c.port?':'+c.port:''):'—'}</span>{c.group&&<div className="text-xs pm-muted">{c.group}</div>}</td><td className="text-xs">{CONFIG_STATUS[c.status]||c.status}{c.failureNote&&<div className="pm-muted">{c.failureNote}</div>}</td><td className="text-xs">Giao: {c.createdBy||'—'} · {localDate(c.createdAt)}{c.startedAt&&<div>Bắt đầu: {localDate(c.startedAt)}</div>}{c.confirmedAt&&<div>Xác nhận: {c.confirmedBy||'—'} · {localDate(c.confirmedAt)}</div>}</td></tr>)}{detail.data&&!detail.data.configurations.length&&<tr><td colSpan={4} className="pm-empty">Chưa có cấu hình proxy.</td></tr>}</tbody></table></div></div>
    <OpsHistory projectId={projectId} vmId={vm.id}/>
    <div><h3 className="text-sm font-semibold mb-2">Lịch sử SDK</h3><SdkHistoryTable projectId={projectId} vmId={vm.id}/></div>
    <p className="pm-muted text-xs">Mọi thao tác ghi đều có ở <Link className="pm-link" href={links.history()}>Lịch sử thao tác</Link> ; hoàn tác được ở đó, trừ ghi nhận tạo lại VM và lần cấp đầu một email PayPal (dùng Bỏ gán).</p>
  </div>;
}

// Reconciling an old account's request (review fix 20/10/2026): the account left this VM or round, so the cell no longer shows it.
// Only what EarnApp's own history shows is recorded, on that old account: sent (its email becomes its receiving email, late money
// links to the request) or not sent (the held email goes back). Nothing touches the account now on the VM. One click, retry = same key.
type HistReq={id:string;revision:number;vmId:string;earnAppId:string;cycle:number};
function OldRequestActions({projectId,request:r,onDone}:{projectId:string;request:HistReq;onDone:()=>void}){
  const update=trpc.vmOps.updatePayout.useMutation(),key=React.useRef<{sig:string;key:string}|null>(null),[error,setError]=React.useState('');
  async function run(action:'SENT'|'CANCELLED'){
    const input={projectId,requestId:r.id,expectedRevision:r.revision,vmId:r.vmId,expectedCycle:r.cycle,earnAppId:r.earnAppId,history:true,action,note:action==='CANCELLED'?'Đối chiếu lịch sử: chưa gửi trên EarnApp':null};
    const sig=JSON.stringify(input);if(key.current?.sig!==sig)key.current={sig,key:crypto.randomUUID()};setError('');
    try{await update.mutateAsync({...input,key:key.current.key});toast.success('Đã đối chiếu yêu cầu rút lượt '+r.cycle);onDone();}catch(e){setError(e instanceof Error?e.message:'Chưa lưu được');}
  }
  return <div className="flex gap-2 flex-wrap items-center mt-1"><span className="text-amber-600">Tài khoản cũ, chưa xác nhận gửi:</span>
    <button type="button" className="pm-link" disabled={update.isLoading} onClick={()=>void run('SENT')}>Đã gửi trên EarnApp (theo lịch sử EarnApp)</button>
    <button type="button" className="pm-link" disabled={update.isLoading} onClick={()=>void run('CANCELLED')}>Chưa gửi — trả email</button>
    {error&&<span role="alert" className="vm-cell-error">{error}</span>}</div>;
}
const PHASE:Record<string,string>={WAITING:'Chờ tiền về',RECEIVED:'Đã nhận đủ',REVIEW:'Cần đối chiếu',FAILED:'Thất bại',CANCELLED:'Đã huỷ'};
// Rounds of this VM position, recorded statuses and the payout request of every round (amounts only with the money rights).
function OpsHistory({projectId,vmId}:{projectId:string;vmId:string}){
  const h=trpc.vmOps.history.useQuery({projectId,vmId});
  if(h.error)return <p role="alert" className="pm-error">{h.error.message}</p>;
  if(!h.data)return <p className="pm-muted text-xs">Đang tải lịch sử vận hành…</p>;
  const d=h.data;
  return <div className="space-y-3">
    <div><h3 className="text-sm font-semibold mb-2">Lượt vận hành đã đóng</h3>{d.cycles.length?<ul className="text-xs space-y-1">{d.cycles.map(c=><li key={c.number}><strong>Lượt {c.number}</strong> · {c.reason==='SUSPENDED'?'SUS':'tiền đã về đủ'} · {c.login||'không có EarnApp'}{c.sdk?' · SDK '+c.sdk:''} · tình trạng cuối {opsLabel(c.status as VmOpsStatus|null)}{c.proxyKept?' · giữ proxy':''} · {c.by} {localDate(c.closedAt)}{c.note?' · '+c.note:''}</li>)}</ul>:<p className="pm-muted text-xs">Chưa tạo lại lần nào (lượt 1).</p>}</div>
    <div><h3 className="text-sm font-semibold mb-2">Yêu cầu rút EarnApp</h3>{d.requests.length?<ul className="text-xs space-y-2">{d.requests.map(r=><li key={r.id}><div><strong>Lượt {r.cycle}</strong> · {r.login} · {r.paypal} · {r.email} · ngày {r.requestedAt.split('-').reverse().join('/')} · {PHASE[r.phase]||r.phase}{r.consumed?' · đã dùng để tạo lại VM':''}{r.reviewAfterRecreate?<span className="text-amber-600"> · cần đối chiếu (khoản nhận đổi sau khi tạo lại; VM giữ lượt mới)</span>:null}</div>
      {r.money&&<div className="pm-muted">Yêu cầu {formatLedger(r.money.amount,r.money.currency)} · đã về {formatLedger(r.money.received,r.money.currency)}{r.money.remaining!=='0.00'?' · còn chờ '+formatLedger(r.money.remaining,r.money.currency):''}{r.money.receipts.length?' · '+r.money.receipts.map(x=>x.date.split('-').reverse().join('/')+' '+formatLedger(x.amount,r.money!.currency)+' ('+x.status+')').join(', '):''}</div>}
      {r.old&&d.rights.writeMoney&&r.state==='REQUESTED'&&r.submission!=='SENT'&&<OldRequestActions projectId={projectId} request={r} onDone={()=>void h.refetch()}/>}
      <div className="pm-muted">{r.history.map((x,i)=><span key={i} className="block">{localDate(x.at)} · {x.by}: {x.what}</span>)}</div></li>)}</ul>:<p className="pm-muted text-xs">Chưa có yêu cầu rút.</p>}</div>
    <div><h3 className="text-sm font-semibold mb-2">Tình trạng đã ghi</h3>{d.events.length?<ul className="text-xs space-y-1">{d.events.map(e=>{const tok=e.detail&&typeof e.detail==='object'&&'token' in (e.detail as object)?' ('+String((e.detail as {token:string}).token)+')':'';
      // 21/10/2026: operating notes and the steps of work on the real machine (who, token, when) sit in the same history.
      if(e.kind==='NOTE'||e.kind==='JOB')return <li key={e.id}>{localDate(e.at)} · {e.by}{tok} · lượt {e.cycle} · {e.kind==='NOTE'?'Ghi chú vận hành: ':'Việc trên máy: '}{e.note}</li>;
      return <li key={e.id}>{localDate(e.at)} · {e.by}{tok} · lượt {e.cycle} · {e.kind==='RECREATE'?'Ghi nhận tạo lại VM → ':e.kind==='UNDO'?'Hoàn tác trên web: ':''}{opsLabel(e.from as VmOpsStatus|null)} → {opsLabel(e.to as VmOpsStatus|null)}{e.note?' · '+e.note:''}{e.kind==='RECREATE'&&e.detail&&typeof e.detail==='object'&&'proxy' in (e.detail as object)?' · '+String((e.detail as {proxy:string}).proxy):''}</li>;})}</ul>:<p className="pm-muted text-xs">Chưa ghi tình trạng (Chưa ghi).</p>}</div>
  </div>;
}
