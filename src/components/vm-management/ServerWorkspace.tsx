"use client";
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {compareCodes} from '@/server/proxy-management/package-terms';
import {trpc} from '@/lib/trpc';
import {Plus,RefreshCw,Server,Search,ClipboardPaste,Trash2,RotateCcw,X} from 'lucide-react';
import toast from 'react-hot-toast';
import {AllocationDialog} from './AllocationDialog';
import {SdkCell} from './SdkCell';
import {SdkPasteDialog} from './SdkPasteDialog';
import {InlineText} from './InlineText';
import {AddVmDialog,CreateServerDialog} from './VmForms';
import {useVMRefresh,type ManagedVM} from './shared';
import {vmView,summarizeVMs,viewLabels,proxyAddress,type VMView} from './workflow';
import {ProxyCopy} from '@/components/proxy-management/ProxyCopy';
import {AccountBindingDialog} from '@/components/business-management/AccountsWorkspace';
type RowFilter=VMView|'SDK_MISSING'|'DELETED'|'';
type VMSort='VM'|'SDK'|'PROXY';
type Blocked={id:string;code:string;reason:string};
const FILTERS=['MISSING','PENDING','INSTALLED','REVIEW','SDK_MISSING','DELETED'];
// Server/VM administration: one server (its name only in the title) or all servers (Server and VM columns). Edit names and notes
// in place, create VMs by range, delete (= archive, restorable, with Hoàn tác) one or many, restore from the "Đã xoá" filter.
export function ServerWorkspace({projectId,serverId}:{projectId:string;serverId?:string}){
  const workspace=trpc.vmManagement.workspace.useQuery({projectId}),access=trpc.vmManagement.access.useQuery({projectId}),refresh=useVMRefresh(),params=useSearchParams();
  const router=useRouter(),pathname=usePathname(),sortParam=params.get('sort'),[sort,setSort]=useState<VMSort>(sortParam&&['VM','SDK','PROXY'].includes(sortParam)?sortParam as VMSort:'VM');
  const initialView=params.get('view'),[server,setServer]=useState(serverId||''),[filter,setFilter]=useState<RowFilter>(initialView&&FILTERS.includes(initialView)?initialView as RowFilter:''),[search,setSearch]=useState(''),[allocation,setAllocation]=useState<ManagedVM|'AUTO'|null>(null),[form,setForm]=useState<'CREATE'|'ADD'|null>(null),[paste,setPaste]=useState(false);
  const [selected,setSelected]=useState<Set<string>>(new Set()),[blocked,setBlocked]=useState<Blocked[]>([]);
  const allServers=workspace.data?.servers||[],servers=allServers.filter(s=>!s.archivedAt),scopeId=serverId||server,current=allServers.find(s=>s.id===scopeId);
  const inScope=(workspace.data?.vms||[]).filter(v=>!scopeId||v.serverId===scopeId);
  const active=inScope.filter(v=>!v.archivedAt&&servers.some(s=>s.id===v.serverId)),deleted=inScope.filter(v=>v.archivedAt);
  const deletedView=filter==='DELETED',counts=summarizeVMs(active),noSdk=active.filter(v=>!v.sdk).length;
  const rows=(deletedView?deleted:active).filter(v=>(deletedView||!filter||(filter==='SDK_MISSING'?!v.sdk:vmView(v)===filter))&&(!search||`${v.server} ${v.code} ${v.notes||''} ${v.desired?.ip||''} ${v.installed?.ip||''} ${v.sdk?.id||''}`.toLowerCase().includes(search.toLowerCase()))).sort((a,b)=>(sort==='SDK'?Number(!!a.sdk)-Number(!!b.sdk):sort==='PROXY'?Number(vmView(a)!=='MISSING')-Number(vmView(b)!=='MISSING'):0)||compareCodes(a.server,b.server)||compareCodes(a.code,b.code));
  const rights=access.data,manage=!!rights?.canManage,single=!!current;
  const businessAccess=trpc.businessManagement.access.useQuery({projectId}); const [copyOpen,setCopyOpen]=useState(false),[binding,setBinding]=useState<string|null>(null); const accounts=trpc.businessManagement.accounts.useQuery({projectId});
  const copy=trpc.vmManagement.copy.useMutation({onSuccess:()=>void refresh(),onError:e=>toast.error(e.message)});
  const updateServer=trpc.vmManagement.updateServer.useMutation(),updateVM=trpc.vmManagement.updateVM.useMutation(),deleteVMs=trpc.vmManagement.deleteVMs.useMutation(),restoreVMs=trpc.vmManagement.restoreVMs.useMutation(),deleteServer=trpc.vmManagement.deleteServer.useMutation(),restoreServer=trpc.vmManagement.restoreServer.useMutation(),undo=trpc.proxyManagement.undo.useMutation();
  useEffect(()=>{setSelected(new Set());setBlocked([]);},[scopeId,filter,search]); // a selection never survives a change of server or filter
  const busy=deleteVMs.isLoading||restoreVMs.isLoading||deleteServer.isLoading||restoreServer.isLoading;
  function undoToast(text:string,operationId?:string){
    toast.success(t=><span className="flex items-center gap-3">{text}{operationId&&<button className="pm-button pm-button-quiet" onClick={()=>{toast.dismiss(t.id);undo.mutateAsync({projectId,id:operationId,reason:''}).then(()=>{toast.success('Đã hoàn tác');void refresh();}).catch(e=>toast.error(e.message));}}>Hoàn tác</button>}</span>,{duration:8000});
  }
  async function remove(ids:string[]){
    try{const r=await deleteVMs.mutateAsync({projectId,vmIds:ids});setBlocked(r.blocked);setSelected(new Set());void refresh();
      if(r.archived) undoToast(`Đã xoá ${r.archived} VM`,r.operationId);
      if(r.blocked.length) toast.error(r.blocked.length===1&&ids.length===1?r.blocked[0].reason:`${r.blocked.length} VM bị chặn — xem lý do bên dưới`,{duration:7000});
    }catch(e){toast.error(e instanceof Error?e.message:'Chưa xoá được');}
  }
  async function restore(ids:string[]){
    try{const r=await restoreVMs.mutateAsync({projectId,vmIds:ids});setBlocked(r.blocked);setSelected(new Set());void refresh();
      if(r.restored) undoToast(`Đã khôi phục ${r.restored} VM`,r.operationId);
      if(r.blocked.length) toast.error(`${r.blocked.length} VM chưa khôi phục — xem lý do bên dưới`,{duration:7000});
    }catch(e){toast.error(e instanceof Error?e.message:'Chưa khôi phục được');}
  }
  async function removeServer(){
    if(!current) return;const n=active.length;
    // Known blockers first (no confirmation for something that cannot succeed); the server re-checks anyway.
    const held=active.filter(v=>v.holds.length>0);
    if(held.length){setBlocked(held.map(v=>({id:v.id,code:v.code,reason:'Còn proxy '+v.holds.map(h=>h.ip+' · '+(h.role==='INSTALLED'?'Đã cài':h.role==='UNCERTAIN'?'Giữ để kiểm tra':'Chờ cài')).join(', ')+'; bỏ gán trước'})));toast.error(held.length+' VM còn giữ proxy; chưa xoá được server',{duration:7000});return;}
    if(!window.confirm(`Xoá server ${current.code} cùng ${n} VM? Dữ liệu và lịch sử được giữ; khôi phục ở bộ lọc Đã xoá.`)) return;
    try{const r=await deleteServer.mutateAsync({projectId,serverId:current.id});undoToast(`Đã xoá ${current.code} · ${r.archivedVMs} VM`,r.operationId);void refresh();if(serverId) router.push('/infrastructure/servers');else setServer('');}
    catch(e){toast.error(e instanceof Error?e.message:'Chưa xoá được server',{duration:8000});}
  }
  async function bringBackServer(id:string){
    try{const r=await restoreServer.mutateAsync({projectId,serverId:id});undoToast(`Đã khôi phục server · ${r.restoredVMs} VM`+(r.skipped.length?` · ${r.skipped.length} VM cần xử lý SDK`:''),r.operationId);setBlocked(r.skipped);void refresh();}
    catch(e){toast.error(e instanceof Error?e.message:'Chưa khôi phục được');}
  }
  const saveServer=(patch:{code?:string;notes?:string;ipAddress?:string})=>async(value:string)=>{if(!current)return;const next={code:current.code,notes:current.notes||'',ipAddress:current.ipAddress||'',...Object.fromEntries(Object.entries(patch).map(([k])=>[k,value]))};const r=await updateServer.mutateAsync({projectId,serverId:current.id,code:next.code,notes:next.notes,ipAddress:next.ipAddress,expectedRevision:current.revision});if(r.saved){toast.success('Đã lưu');await refresh();}};
  const saveVM=(v:ManagedVM,field:'code'|'notes')=>async(value:string)=>{const r=await updateVM.mutateAsync({projectId,vmId:v.id,...(field==='code'?{code:value}:{notes:value||null}),expectedRevision:v.revision});if(r.saved){toast.success('Đã lưu');await refresh();}};
  if(workspace.error)return <p role="alert" className="pm-error">{workspace.error.message}</p>;
  if(serverId&&workspace.data&&!current)return <p role="alert" className="pm-error">Server không thuộc dự án này.</p>;
  if(current?.archivedAt)return <div className="proxy-workspace space-y-4"><div className="pm-heading"><div><h1>{current.code}</h1><p className="pm-muted">Server đã xoá. Dữ liệu và lịch sử vẫn được giữ.</p></div>{manage&&<button className="pm-button pm-button-primary" disabled={busy} onClick={()=>void bringBackServer(current.id)}><RotateCcw size={16}/>Khôi phục server</button>}</div><Link className="pm-button pm-button-quiet w-fit" href="/infrastructure/servers">Về danh sách server</Link></div>;
  const allOnPage=rows.length>0&&rows.every(v=>selected.has(v.id)),toggle=(id:string,on:boolean)=>setSelected(prev=>{const n=new Set(prev);if(on)n.add(id);else n.delete(id);return n;});
  const columns=(manage?1:0)+(single?0:1)+7;
  return <div className="proxy-workspace space-y-5"><div className="pm-heading"><div>
      {single?<h1><InlineText value={current!.code} label="tên server" canEdit={manage} onSave={saveServer({code:''})}/></h1>:<h1>Server / VM</h1>}
      {single&&<div className="pm-muted text-sm flex gap-4 flex-wrap mt-1"><span>IP: <InlineText value={current!.ipAddress} label="IP server" placeholder="chưa có" canEdit={manage} onSave={saveServer({ipAddress:''})}/></span><span>Ghi chú: <InlineText value={current!.notes} label="ghi chú server" placeholder="thêm ghi chú" canEdit={manage} onSave={saveServer({notes:''})}/></span></div>}
    </div><div className="flex gap-2 flex-wrap"><button className="pm-button" onClick={()=>void refresh()}><RefreshCw size={16}/>Tải lại</button>{manage&&<button className="pm-button" onClick={()=>setForm('CREATE')}><Plus size={16}/>Thêm server</button>}{manage&&servers.length>0&&<button className="pm-button" onClick={()=>setForm('ADD')}><Plus size={16}/>Thêm VM</button>}{rights?.canAssign&&<button className="pm-button" onClick={()=>setPaste(true)}><ClipboardPaste size={16}/>Dán SDK</button>}{rights?.canAssign&&<button className="pm-button pm-button-primary" disabled={!rights.sourceConnected||!counts.missing} onClick={()=>setAllocation('AUTO')}>Điền VM thiếu</button>}{manage&&single&&<button className="pm-button pm-button-quiet" disabled={busy} onClick={()=>void removeServer()}><Trash2 size={16}/>Xoá server</button>}</div></div>
    {rights&&!rights.sourceConnected&&<p className="pm-source-warning">Cần kết nối nguồn Genjy trước khi giao proxy (Quản lý proxy → Cập nhật).</p>}
    <div className="pm-summary"><div><span>Tổng VM</span><strong>{counts.total}</strong></div><div><span>Thiếu proxy</span><strong>{counts.missing}</strong></div><div><span>Chờ cài</span><strong>{counts.pending}</strong></div><div><span>Cần kiểm tra</span><strong>{counts.review}</strong></div><div><span>Chưa có SDK</span><strong>{noSdk}</strong></div></div>
    <div className="pm-surface">
      <div className="pm-filters pt-4">{!serverId&&<select className="pm-input" aria-label="Chọn server" value={server} onChange={e=>setServer(e.target.value)}><option value="">Tất cả server</option>{servers.map(s=><option key={s.id} value={s.id}>{s.code}</option>)}</select>}<label className="pm-search"><Search size={17}/><input aria-label="Tìm VM hoặc proxy" placeholder={single?'Tìm VM, ghi chú hoặc IP…':'Tìm server, VM, ghi chú hoặc IP…'} value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Tình trạng VM" className="pm-input" value={filter} onChange={e=>setFilter(e.target.value as RowFilter)}><option value="">Tất cả VM ({active.length})</option>{(['MISSING','PENDING','INSTALLED','REVIEW'] as const).map(k=><option key={k} value={k}>{viewLabels[k]}</option>)}<option value="SDK_MISSING">Chưa có SDK</option><option value="DELETED">Đã xoá ({deleted.length})</option></select><select aria-label="Sắp xếp VM" className="pm-input" value={sort} onChange={e=>{const v=e.target.value as VMSort;setSort(v);const q=new URLSearchParams(params.toString());if(v==='VM')q.delete('sort');else q.set('sort',v);router.replace(pathname+(q.toString()?'?'+q.toString():''));}}><option value="VM">Theo mã VM</option><option value="SDK">Chưa có SDK trước</option><option value="PROXY">Thiếu proxy trước</option></select></div>
      {deletedView&&!serverId&&allServers.some(s=>s.archivedAt)&&<div className="pm-deleted-servers"><span className="pm-muted text-sm">Server đã xoá:</span>{allServers.filter(s=>s.archivedAt).map(s=><span key={s.id} className="flex items-center gap-2"><strong className="text-sm">{s.code}</strong>{manage&&<button className="pm-button pm-button-quiet" disabled={busy} onClick={()=>void bringBackServer(s.id)}><RotateCcw size={14}/>Khôi phục</button>}</span>)}</div>}
      {deletedView&&<p className="pm-muted text-xs px-5 pb-3">Máy đã xoá vẫn giữ SDK, tài khoản và lịch sử; không được giao proxy hay tạo việc mới cho tới khi khôi phục.</p>}
      {manage&&selected.size>0&&<div className="pm-bulkbar" role="status"><strong>Đã chọn {selected.size} VM</strong>{deletedView?<button className="pm-button" disabled={busy} onClick={()=>void restore(Array.from(selected))}><RotateCcw size={16}/>Khôi phục {selected.size}</button>:<button className="pm-button" disabled={busy} onClick={()=>void remove(Array.from(selected))}><Trash2 size={16}/>Xoá {selected.size}</button>}<button className="pm-button pm-button-quiet" onClick={()=>setSelected(new Set())}><X size={16}/>Bỏ chọn</button></div>}
      {blocked.length>0&&<div className="pm-blocked" role="alert"><div className="flex justify-between gap-2"><strong className="text-sm">{blocked.length} VM chưa xử lý được</strong><button className="pm-icon-button" aria-label="Đóng danh sách bị chặn" onClick={()=>setBlocked([])}><X size={15}/></button></div><ul className="text-sm mt-2 space-y-1">{blocked.map(b=><li key={b.id}><strong className="pm-code">{b.code}</strong> — {b.reason} · <Link className="pm-link" href={`/vm-tasks?vm=${b.id}`}>Mở VM</Link></li>)}</ul></div>}
      <div className="pm-table-scroll"><table className="pm-table"><thead><tr>{manage&&<th className="pm-check"><input type="checkbox" aria-label={`Chọn tất cả ${rows.length} VM đang lọc`} title={`Chọn tất cả ${rows.length} VM đang lọc`} checked={allOnPage} disabled={!rows.length} onChange={e=>setSelected(e.target.checked?new Set(rows.map(v=>v.id)):new Set())}/></th>}{!single&&<th>Server</th>}<th>VM</th><th>Ghi chú</th><th>Đã cài trên máy</th><th>Proxy được giao</th><th>SDK EarnApp</th><th>Việc cần làm</th><th></th></tr></thead><tbody>{rows.map(v=>{const status=vmView(v),blockedProxy=v.holds.some(h=>h.state==='BLOCKED'),email=accounts.data?.gmails.find(g=>g.id===accounts.data?.vms.find(m=>m.id===v.id)?.gmailId)?.email,editable=manage&&!deletedView;return <tr key={v.id} className={(blockedProxy?'pm-row-blocked':status==='PENDING'&&!deletedView?'vm-row-pending':'')+(selected.has(v.id)?' pm-row-selected':'')}>
        {manage&&<td className="pm-check"><input type="checkbox" aria-label={'Chọn '+v.code} checked={selected.has(v.id)} onChange={e=>toggle(v.id,e.target.checked)}/></td>}
        {!single&&<td><Link href={`/infrastructure/servers/${v.serverId}`} className="pm-link">{v.server}</Link></td>}
        <td><div className="font-semibold"><InlineText value={v.code} label={'mã VM '+v.code} canEdit={editable} mono onSave={saveVM(v,'code')}/></div>{email&&<div className="pm-muted text-xs mt-1">{email}</div>}</td>
        <td className="pm-notes"><InlineText value={v.notes} label={'ghi chú '+v.code} placeholder={editable?'—':''} canEdit={editable} onSave={saveVM(v,'notes')}/></td>
        <td>{v.installed?proxyAddress(v.installed):<span className="pm-muted">Chưa xác nhận</span>}{v.installed&&<div className="pm-muted text-xs mt-1">Cấu hình #{v.installed.version}</div>}</td>
        <td>{proxyAddress(v.desired)}{v.desired&&<div className="pm-muted text-xs mt-1">Cấu hình #{v.desired.version}</div>}</td>
        <td>{deletedView?(v.sdk?<span className="pm-code">{v.sdk.id}</span>:<span className="pm-muted">—</span>):<SdkCell projectId={projectId} vm={v} canEdit={!!rights?.canAssign} onSaved={()=>void refresh()}/>}</td>
        <td>{deletedView?<span className="pm-badge pm-badge-muted">Đã xoá</span>:<><span className={`pm-badge ${status==='REVIEW'?'pm-badge-red':status==='PENDING'?'vm-badge-pending':'pm-badge-muted'}`}>{viewLabels[status]}</span>{status==='REVIEW'&&<p className="pm-muted text-xs mt-2">{v.desired?.failureNote||(blockedProxy?'Proxy BLOCKED':v.holds.some(h=>h.owner!=='SELF'&&!h.shared)?'Có proxy Genjy / chưa rõ sở hữu':v.holds.some(h=>h.role==='UNCERTAIN')?'Có proxy cần kiểm tra thực tế':'Ô cũ có công thức / nội dung chưa rõ')}</p>}</>}</td>
        <td><div className="vm-row-actions">{deletedView?(manage&&<button className="pm-button pm-button-quiet" disabled={busy} onClick={()=>void restore([v.id])}><RotateCcw size={14}/>Khôi phục</button>):<>
          {rights?.canAssign&&<button className="pm-button pm-button-quiet" onClick={()=>setBinding(v.id)}>Tài khoản</button>}<Link className="pm-button pm-button-quiet" href={`/work?vm=${v.id}`}>Công việc</Link>{businessAccess.data?.costs&&<Link className="pm-button pm-button-quiet" href={`/costs?server=${v.serverId}`}>Chi phí</Link>}
          {rights?.canCopy&&rights.canConfirm&&v.installed&&<button className="pm-button pm-button-quiet" onClick={()=>{copy.reset();setCopyOpen(true);copy.mutate({projectId,configurationId:v.installed!.id});}}>Copy đã cài</button>}
          {rights?.canAssign&&<button className="pm-button pm-button-quiet" disabled={!rights.sourceConnected} onClick={()=>setAllocation(v)}>{status==='MISSING'?'Gán proxy':'Đổi proxy'}</button>}{v.desired&&v.desired.id!==v.installed?.id&&<Link className="pm-button pm-button-quiet" href={`/vm-tasks?vm=${v.id}`}>Cài proxy</Link>}
          {manage&&<button className="pm-icon-button" aria-label={'Xoá '+v.code} title="Xoá (khôi phục được)" disabled={busy} onClick={()=>void remove([v.id])}><Trash2 size={15}/></button>}</>}</div></td></tr>;})}
        {!rows.length&&<tr><td colSpan={columns} className="pm-empty"><Server size={28} className="mx-auto mb-3 pm-muted"/>{workspace.isLoading?'Đang tải máy…':deletedView?'Không có máy đã xoá.':servers.length?'Không có VM trong bộ lọc này.':'Thêm server và VM để bắt đầu.'}</td></tr>}</tbody></table></div>
      <div className="pm-table-footer"><span className="pm-muted text-xs">{rows.length} VM{deletedView?' đã xoá':''}</span><span className="flex gap-2"><Link className="pm-button pm-button-quiet" href="/vm-tasks">Việc cài</Link><Link className="pm-button pm-button-quiet" href="/infrastructure/proxies">Quản lý proxy</Link></span></div></div>
    {allocation&&<AllocationDialog projectId={projectId} serverId={scopeId||undefined} vm={allocation==='AUTO'?undefined:allocation} onClose={()=>setAllocation(null)} onSaved={()=>void refresh()}/>}
    {paste&&<SdkPasteDialog projectId={projectId} servers={servers.map(s=>({id:s.id,code:s.code}))} serverId={scopeId||undefined} onClose={()=>setPaste(false)} onSaved={()=>void refresh()}/>}
    {form==='ADD'&&<AddVmDialog projectId={projectId} servers={servers.map(s=>({id:s.id,code:s.code}))} serverId={scopeId||undefined} known={(workspace.data?.vms||[]).map(v=>({serverId:v.serverId,code:v.code,archivedAt:v.archivedAt}))} onClose={()=>setForm(null)} onSaved={()=>void refresh()}/>}
    {form==='CREATE'&&<CreateServerDialog projectId={projectId} onClose={()=>setForm(null)} onSaved={id=>{void refresh();router.push(`/infrastructure/servers/${id}`);}}/>}
    {binding&&<AccountBindingDialog projectId={projectId} vmId={binding} onClose={()=>setBinding(null)}/>}{copyOpen&&<ProxyCopy data={copy.data} isLoading={copy.isLoading} error={copy.error} onClose={()=>setCopyOpen(false)}/>}
  </div>;
}
