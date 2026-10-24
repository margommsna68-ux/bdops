"use client";
import {normalizeProxySearch} from '@/lib/proxy-search';
import Link from 'next/link';
import {Fragment,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useSession} from 'next-auth/react';
import {selectionKey,useSessionSelection} from '@/lib/session-selection';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {compareCodes,type RegistrySort} from '@/server/proxy-management/package-terms';
import {PackageDialog,packageHeading,dueBadge,dueLabel} from './PackageDialog';
import {trpc} from '@/lib/trpc';
import {GROUP_GENJY,GROUP_SHARED,GROUP_TUT,GROUP_UNKNOWN,isShared,type BatchKind,type CopyResult,type InventoryState,type RegistryRow} from '@/server/proxy-management/types';
import {BulkEditPanel,GroupCell,RowEditor,StatusQuick,type BulkMode,useInventoryDelete} from './RegistryEdit';
import {quickEdit,quickEditMessage} from './quick-save';
import {GroupDialog} from './GroupDialog';
import {SharedListDialog} from './SharedListDialog';
import {StateSyncDialog} from './StateSyncDialog';
import {BatchDialog} from './BatchDialog';
import {HistoryPanel,localDate} from './HistoryPanel';
import {ProxyCopy} from './ProxyCopy';
import {LocationCells,ServerFilter,copySummary} from './RegistryCells';
import {copyWhenReady} from './clipboard';
import {filterKey,readRegistryUrl,writeRegistryUrl,type RegistryUrl,type RegistryView} from './registry-url';
import {links} from '@/lib/links';
import {MemberRightsDialog} from './MemberRightsDialog';
import {OperationHistoryDialog} from './OperationHistoryDialog';
import {SystemBackupDialog} from './SystemBackupDialog';
import {useVMRefresh} from '@/components/vm-management/shared';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '@/components/ui/dropdown-menu';

import {Search,Plus,RefreshCw,ShieldAlert,ArrowLeftRight,Copy,Settings2,History,ChevronLeft,ChevronRight,ChevronDown,X,Network,ArrowUpRight,Pencil,Tags,Server,MonitorSmartphone,RotateCcw} from 'lucide-react';
import {BulkBar,RowDeleteButton} from './BulkBar';
import toast from 'react-hot-toast';
const states:Record<InventoryState,string>={NEW:'NEW',LIVE:'LIVE',BLOCKED:'BLOCKED',REPLACED:'Đã replace',DIE:'Ngừng dùng',QUARANTINED:'Cần kiểm tra',VOID:'Đã thu hồi',RETIRED:'Đã xoá'};
const PAGE_SIZE=100;
// The URL holds every filter (see registry-url.ts); this component only reads it and navigates.
export function RegistryTable({projectId}:{projectId:string}){
  const params=useSearchParams(),router=useRouter(),pathname=usePathname(),url=readRegistryUrl(params),{q:query,group,state,pkg,sort,servers,view}=url;
  // Filter changes are history entries (Back returns to the previous filter); typing in the search box replaces in place.
  const pending=useRef<RegistryUrl|null>(null);useEffect(()=>{pending.current=null;},[params]);
  // Every change that is not a page change starts at page 1.
  const go=useCallback((patch:Partial<RegistryUrl>,mode:'push'|'replace'='push',pay?:string|null)=>{const next={...(pending.current||readRegistryUrl(new URLSearchParams(window.location.search))),page:1,...patch};pending.current=next;const href=pathname+writeRegistryUrl(next,pay===undefined?new URLSearchParams(window.location.search).get('pay'):pay);if(mode==='push')router.push(href,{scroll:false});else router.replace(href,{scroll:false});},[pathname,router]);
  const [search,setSearch]=useState(query);useEffect(()=>{setSearch(query);},[query]);
  const [kind,setKind]=useState<BatchKind|null>(null),[history,setHistory]=useState<string|null>(null),[catalogOpen,setCatalogOpen]=useState(false);
  // The selection (one page, as before) is kept in the tab's session by id with its filter and page (src/lib/session-selection.ts):
  // leaving for another page and coming Back ticks the same proxies again, minus rows no longer on that page.
  const session=useSession(),userId=(session.data?.user as {id?:string}|undefined)?.id||'anon';
  const [selected,setSelected,restoreSelection]=useSessionSelection(session.status==='authenticated'?selectionKey('proxy',userId,projectId):null,projectId+'|'+filterKey(url)+'|'+url.page);
  const [fallback,setFallback]=useState<string|null>(null),[copying,setCopying]=useState(false);
  const [rightsOpen,setRightsOpen]=useState(false);
  const [operationsOpen,setOperationsOpen]=useState(false),[backupsOpen,setBackupsOpen]=useState(false);
  const refreshVM=useVMRefresh();
  const [editing,setEditing]=useState<string|null>(null),[bulkMode,setBulkMode]=useState<BulkMode|null>(null),[groupsOpen,setGroupsOpen]=useState(false),[sharedOpen,setSharedOpen]=useState(false),[syncOpen,setSyncOpen]=useState(false);
  const payParam=params.get('pay'),packagesParam=params.get('packages')==='due',tableTop=useRef<HTMLDivElement>(null);
  const blockedChosen=trpc.proxyManagement.copyBlockedEndpoints.useMutation(),blockedAll=trpc.proxyManagement.copyBlockedFiltered.useMutation(),copyOne=trpc.proxyManagement.copyEndpoint.useMutation(),copySelected=trpc.proxyManagement.copyEndpoints.useMutation(),copyAll=trpc.proxyManagement.copyFiltered.useMutation();
  const utils=trpc.useUtils(),access=trpc.proxyManagement.access.useQuery({projectId}),catalog=trpc.proxyManagement.catalog.useQuery({projectId});
  const vmAccess=trpc.vmManagement.access.useQuery({projectId});
  const groups=trpc.proxyManagement.groups.useQuery({projectId}),targets=trpc.proxyManagement.vmTargets.useQuery({projectId});
  const filter={projectId,view,group:group||undefined,state:(state||undefined) as InventoryState|'OTHER'|undefined,search:query||undefined,sort,packageCode:pkg&&pkg!=='due'?pkg:undefined,due:pkg==='due'||undefined,servers:servers.length?servers:undefined,batchId:url.batch||undefined};
  const data=trpc.proxyManagement.list.useQuery({...filter,page:url.page,limit:PAGE_SIZE},{keepPreviousData:true});
  // The page in the URL no longer exists (rows were removed since the link was made): the server served the last page; show that page's
  // number in the URL too, and say why.
  const [clamped,setClamped]=useState<number|null>(null);
  useEffect(()=>{const served=data.data?.page;if(!served||data.isPreviousData||served===url.page) return;setClamped(url.page);go({page:served},'replace');},[data.data?.page,data.isPreviousData,url.page,go]);
  const duePackages=catalog.data?catalog.data.filter(p=>p.reminder&&['OVERDUE','DUE_SOON'].includes(p.due.state)).length:null;
  useEffect(()=>{if(payParam||packagesParam) setCatalogOpen(true);},[payParam,packagesParam]);
  useEffect(()=>{if(search===query) return;const timer=setTimeout(()=>go({q:search},'replace'),250);return()=>clearTimeout(timer);},[search,query,go]);
  const reset=()=>{setSelected(new Set());setEditing(null);setBulkMode(null);setClamped(null);setRowErrors({});};
  // A new result (filter, tab, sort, search — from a click, Back/Forward or a link on this page) starts at page 1 with nothing selected.
  const resultKey=filterKey(url),firstKey=useRef(resultKey);
  useEffect(()=>{if(firstKey.current===resultKey) return;firstKey.current=resultKey;reset();},[resultKey]);
  // Nhập proxy mới xong toàn bộ (20/10/2026): the dialog closes, the table reloads with its filters; "Xem vừa nhập" opens exactly that batch.
  const imported=(r:{applied:number;batchId:string})=>{const hidden=!!(url.q||url.group||url.state&&url.state!=='NEW'||url.pkg||url.servers.length||url.view==='HISTORY'||url.page>1||url.batch);
    toast.success(t=><span className="flex items-center gap-3">Đã nhập {r.applied} proxy{hidden&&<button className="pm-button pm-button-quiet" onClick={()=>{toast.dismiss(t.id);go({q:'',servers:[],group:'',state:'',pkg:'',view:'CURRENT',batch:r.batchId});}}>Xem vừa nhập</button>}</span>,{duration:hidden?10000:4000});};
  const refresh=()=>{void refreshVM();void utils.proxyManagement.access.invalidate();void utils.proxyManagement.catalog.invalidate();void utils.proxyManagement.groups.invalidate();void utils.proxyManagement.vmTargets.invalidate();};
  const sync=trpc.proxyManagement.sync.useMutation({onSuccess:r=>{refresh();toast[r.scanSucceeded?'success':'error'](r.scanSucceeded?'Đã cập nhật nguồn Genjy':'Chưa kết nối được Genjy. Danh sách đã biết vẫn được giữ.');},onError:e=>toast.error(e.message)});
  const rights=access.data,counts=data.data?.counts,rows=data.data?.rows||[],total=data.data?.total??0,serverChoices=data.data?.servers||[],groupChoices=data.data?.groups||groups.data||[];
  const packageChoices=Array.from(new Set([...(catalog.data||[]).map(p=>p.code),...Object.keys(data.data?.packageCounts||{}).filter(Boolean)])).sort(compareCodes);
  const packageTotal=data.data?Object.values(data.data.packageCounts||{}).reduce((n,count)=>n+count,0):null;
  const canGroup=!!rights?.canImport,canLocate=!!vmAccess.data?.canAssign,canEdit=canGroup||canLocate,canDelete=!!rights?.canDelete;
  // Xoá khỏi kho / Khôi phục (20/10/2026): one click, ADMIN only; refused rows keep their reason at the row and stay selected.
  const inventory=useInventoryDelete(projectId,refresh),[rowErrors,setRowErrors]=useState<Record<string,string>>({});
  const deletable=(r:RegistryRow)=>!!r.endpointId&&['NEW','LIVE','BLOCKED','DIE','QUARANTINED'].includes(r.state),deleted=(r:RegistryRow)=>!!r.endpointId&&r.state==='RETIRED';
  async function runInventory(rows:RegistryRow[],kind:'remove'|'restore'){
    const o=await inventory[kind](rows);if(!o) return;
    const errs:Record<string,string>={};for(const e of o.errors) if(e.endpointId) errs[e.endpointId]=e.message;
    setRowErrors(errs);setSelected(new Set(Object.keys(errs)));
  }
  const selectable=rows.filter(r=>r.endpointId),allOnPage=selectable.length>0&&selectable.every(r=>selected.has(r.endpointId!)),columns=rights?.canCopy?10:9,selectedRows=selectable.filter(r=>selected.has(r.endpointId!));
  const editorProps={projectId,groups:groupChoices,targets:targets.data||[]};
  const pageReady=!!data.data&&!data.isPreviousData&&data.data.page===url.page,validIds=useMemo(()=>pageReady?new Set(selectable.map(r=>r.endpointId!)):null,[pageReady,data.data]);// eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>{restoreSelection(validIds);},[validIds,restoreSelection]);
  const toggleRow=(row:RegistryRow,checked:boolean)=>setSelected(prev=>{const next=new Set(prev);if(checked) next.add(row.endpointId!);else next.delete(row.endpointId!);return next;});
  // Copy flows: one click each. Credentials are fetched through the COPY_CREDENTIALS endpoint on demand, never preloaded.
  async function copyProxy(row:RegistryRow){
    const r=await copyWhenReady(()=>copyOne.mutateAsync({projectId,endpointId:row.endpointId!}).then(res=>res.proxy));
    if(r.ok) toast.success('Đã copy '+row.ip);else if(r.text) setFallback(r.text);else toast.error(r.error||'Không copy được');
  }
  async function copyMany(load:()=>Promise<CopyResult>){
    if(copying) return;setCopying(true);let result:CopyResult|undefined;
    try{
      const r=await copyWhenReady(async()=>{result=await load();if(!result.proxies.length) throw new Error(copySummary(result).message);return result.proxies.join('\n');});
      if(r.ok){const s=copySummary(result!);toast[s.ok&&!result!.skipped.length?'success':'error'](s.message,{duration:result!.skipped.length?8000:3000});}
      else if(r.text){setFallback(r.text);if(result?.skipped.length) toast.error(copySummary(result).message,{duration:8000});}
      else toast.error(r.error||'Không copy được');
    }finally{setCopying(false);}
  }
  // Same totals and page buttons above and below the table; the bottom pager scrolls back to the top of the table.
  const page=data.data?.page??url.page,pages=Math.max(1,Math.ceil(total/PAGE_SIZE)),first=total?(page-1)*PAGE_SIZE+1:0,last=(page-1)*PAGE_SIZE+rows.length;
  // Pages are history entries: Back returns to the previous page; reload or a copied link opens the same page.
  const goPrevious=()=>{setSelected(new Set());setClamped(null);go({page:Math.max(1,page-1)});};
  const goNext=()=>{setSelected(new Set());setClamped(null);go({page:page+1});};
  const pager=(where:'top'|'bottom')=><div ref={where==='top'?tableTop:undefined} className={'pm-table-footer'+(where==='top'?' pm-table-pager-top':'')} data-testid={'pager-'+where}><span className="pm-muted text-xs">{total?`Dòng ${first}–${last} / ${total}`:'0 / 0 dòng'} · Trang {page}/{pages}{where==='bottom'?<> · bấm IP để xem lịch sử{rights?.source.lastScan?' · quét Genjy '+localDate(rights.source.lastScan):''}</>:null}</span><div className="flex gap-2"><button className="pm-icon-button" aria-label="Trang trước" disabled={page<=1||data.isFetching} onClick={()=>{goPrevious();if(where==='bottom') tableTop.current?.scrollIntoView({block:'start'});}}><ChevronLeft size={18}/></button><button className="pm-icon-button" aria-label="Trang sau" disabled={!data.data?.nextCursor||data.isFetching} onClick={()=>{goNext();if(where==='bottom') tableTop.current?.scrollIntoView({block:'start'});}}><ChevronRight size={18}/></button></div></div>;
  // Bulk status in one click: NEW on rows still held by a VM releases those plans after a single confirmation.
  const [bulkState,setBulkState]=useState<''|'NEW'|'LIVE'|'BLOCKED'>(''),[applyingState,setApplyingState]=useState(false);
  const stateMutations={inspect:trpc.proxyManagement.editPreview.useMutation(),commit:trpc.proxyManagement.editCommit.useMutation()};
  async function applyBulkState(){
    if(!bulkState) return;
    const held=selectedRows.filter(r=>bulkState==='NEW'&&r.state!=='NEW'&&r.locations.some(l=>l.role==='DESIRED'||l.role==='INSTALLED')&&(r.owner==='SELF'||(r.owner==='GENJY'&&r.subgroup==='PC_CHUNG')));
    if(held.length&&!window.confirm(held.length+' dòng đang giữ VM sẽ được bỏ gán để về NEW (không ghi nhận đã gỡ ngoài máy). Tiếp tục?')) return;
    setApplyingState(true);
    try{const o=await quickEdit({projectId,items:selectedRows.map(r=>({endpointId:r.endpointId!,manage:{kind:'STATE' as const,state:bulkState},...(held.includes(r)?{location:{kind:'UNASSIGN' as const}}:{})})),idempotencyKey:crypto.randomUUID()},stateMutations.inspect.mutateAsync,x=>stateMutations.commit.mutateAsync({projectId,...x}));
      (o.errors.length?toast:toast.success)(quickEditMessage(o),{duration:o.errors.length?8000:2500});if(o.applied){setSelected(new Set());setBulkState('');refresh();}
    }catch(e){toast.error(e instanceof Error?e.message:'Chưa lưu được');}finally{setApplyingState(false);}
  }
  const copyChosen=()=>copyMany(()=>copySelected.mutateAsync({projectId,endpointIds:selectable.filter(r=>selected.has(r.endpointId!)).map(r=>r.endpointId!)}));
  const copyFiltered=()=>copyMany(()=>copyAll.mutateAsync(filter));
  // "Copy proxy Blocked (N)" (19/10/2026): selected rows, or the whole filtered result on every page; current BLOCKED proxies only,
  // full IP:port:user:pass one per line, one click (no window); the server checks the copy right and logs counts only.
  const blockedN=selected.size?selectedRows.filter(r=>r.state==='BLOCKED').length:(!filter.state||filter.state==='BLOCKED')&&view!=='HISTORY'?(data.data?.stateCounts?.BLOCKED??0):0;
  const copyBlocked=()=>copyMany(async()=>{const r=selected.size?await blockedChosen.mutateAsync({projectId,endpointIds:Array.from(selected)}):await blockedAll.mutateAsync(filter);if(!r.proxies.length)throw new Error('Không có proxy Blocked '+(selected.size?'trong các dòng đã chọn':'trong bộ lọc này'));return {...r,blocked:true} as typeof r;});
  const hasFilters=!!(query||state||group||pkg||servers.length||url.batch);
  const groupCount=(key:string)=>data.data?.groupCounts?` (${data.data.groupCounts[key]??0})`:'';
  return <div className="proxy-workspace pm-registry space-y-5">
    <div className="pm-heading"><div><div className="flex items-center gap-2 mb-1"><Network size={20} className="pm-muted"/><h1>Kho proxy</h1></div><p className="pm-muted">Proxy, vị trí VM và lịch sử thay thế.</p></div><div className="flex gap-2 flex-wrap"><button className="pm-button" disabled={sync.isLoading} onClick={()=>rights?.canBlock?sync.mutate({projectId}):refresh()}><RefreshCw size={16} className={sync.isLoading?'animate-spin':''}/>Cập nhật</button><button className="pm-button" onClick={()=>setOperationsOpen(true)}><History size={16}/>Lịch sử</button>{(rights?.canManage||rights?.canGrant||rights?.canBackup)&&<DropdownMenu><DropdownMenuTrigger asChild><button className="pm-button" aria-label="Thiết lập proxy"><Settings2 size={16}/>Thiết lập</button></DropdownMenuTrigger><DropdownMenuContent align="end">{rights?.canManage&&<DropdownMenuItem onSelect={()=>setCatalogOpen(true)}>Gói proxy</DropdownMenuItem>}{rights?.canManage&&<DropdownMenuItem onSelect={()=>setGroupsOpen(true)}>Nhóm proxy</DropdownMenuItem>}{rights?.canImport&&<DropdownMenuItem onSelect={()=>setSharedOpen(true)}>Xác nhận nhóm chung</DropdownMenuItem>}{rights?.canImport&&<DropdownMenuItem onSelect={()=>setSyncOpen(true)}>Đồng bộ NEW / LIVE</DropdownMenuItem>}{rights?.canGrant&&<DropdownMenuItem onSelect={()=>setRightsOpen(true)}>Quyền nhân viên</DropdownMenuItem>}{rights?.canBackup&&<DropdownMenuItem onSelect={()=>setBackupsOpen(true)}>Bản sao dự phòng</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>}</div></div>
    {rights?.trial&&<div className="pm-banner">Bản thử. Thao tác chỉ ghi trên web, không sửa Google Sheet hoặc tự đổi cấu hình máy.</div>}
    {rights?.source.mode==='LOCAL_SNAPSHOT'&&<p className="pm-muted text-xs">Genjy đang dùng bản chụp để thử. Nút Cập nhật quét lại bản chụp này, chưa tự đọc thay đổi mới trên Google Sheet.</p>}
    <div className="pm-summary"><div><span>Kho TUT</span><strong>{counts?.current??'—'}</strong></div><div><span>Chung mooon–Genjy</span><strong>{counts?.shared??'—'}</strong></div><div><span>Genjy riêng</span><strong>{counts?.reserved??'—'}</strong></div><div><span>Cần kiểm tra</span><strong>{counts?.quarantined??'—'}</strong></div><div><span>Đã replace / thu hồi</span><strong>{counts?.historical??'—'}</strong></div><div><span>Gói sắp đến hạn</span><strong className={duePackages?'text-amber-600':''}>{duePackages??'—'}</strong></div></div>
    <div className="pm-surface">
      <div className="pm-actions pm-registry-actions">
        <div className="pm-registry-actions-main">
          {rights?.canImport&&<button className="pm-button pm-button-primary" disabled={!rights.source.connected} onClick={()=>setKind('NEW')}><Plus size={16}/>Nhập mới</button>}
          {rights?.canBlock&&<button className="pm-button pm-button-quiet" onClick={()=>setKind('BLOCKED')}><ShieldAlert size={16}/>Báo BLOCKED</button>}
          {rights?.canReplace&&<button className="pm-button pm-button-quiet" disabled={!rights.source.connected} onClick={()=>setKind('REPLACE')}><ArrowLeftRight size={16}/>Nhận replace</button>}
        </div>
        {rights?.canCopy&&<DropdownMenu>
          <DropdownMenuTrigger asChild><button className="pm-button" disabled={copying} aria-label="Copy danh sách proxy"><Copy size={16}/>{copying?'Đang copy…':'Copy'}<ChevronDown size={14}/></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="pm-registry-copy-menu">
            <DropdownMenuItem disabled={!total} onSelect={()=>void copyFiltered()}><Copy size={15}/><span>Kết quả đang lọc <small>Tất cả các trang</small></span><span className="pm-registry-menu-count">{total}</span></DropdownMenuItem>
            <DropdownMenuItem disabled={!blockedN} onSelect={()=>void copyBlocked()}><ShieldAlert size={15}/><span>Proxy BLOCKED <small>{selected.size?'Trong các dòng đã chọn':'Trong bộ lọc · mọi trang'}</small></span><span className="pm-registry-menu-count">{blockedN}</span></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      {rights&&!rights.source.connected&&<div className="pm-source-warning">Chưa kết nối được nguồn Genjy. Vẫn xem kho và báo BLOCKED; cần kết nối trước khi nhận proxy mới.</div>}
      <div className="pm-registry-filters">
        <div className="pm-registry-search-row">
          <label className="pm-search"><Search size={17}/><input aria-label="Tìm IP, gói hoặc server VM" placeholder="Tìm IP, gói, server / VM…" value={search} onChange={e=>setSearch(normalizeProxySearch(e.target.value))}/></label>
          <button type="button" className="pm-registry-blocked" aria-label="Chỉ hiện proxy BLOCKED" aria-pressed={state==='BLOCKED'} title="Bật / tắt lọc proxy BLOCKED" onClick={()=>go({state:state==='BLOCKED'?'':'BLOCKED'})}><span className="pm-registry-status-dot"/>BLOCKED <span className="pm-registry-filter-count">{data.data?.stateCounts.BLOCKED??'…'}</span>{state==='BLOCKED'&&<X size={13}/>}</button>
          {hasFilters&&<button type="button" className="pm-button pm-button-quiet pm-registry-reset" onClick={()=>{setSearch('');go({q:'',state:'',group:'',pkg:'',servers:[],batch:''});}}><X size={14}/>Bỏ lọc</button>}
        </div>
        <div className="pm-registry-filter-grid">
          <label className="pm-registry-filter-field"><span>Gói proxy</span><select aria-label="Gói proxy" className="pm-input" value={pkg} onChange={e=>go({pkg:e.target.value})}><option value="">Tất cả gói{packageTotal!==null?` (${packageTotal})`:''}</option><option value="due">Sắp đến hạn / quá hạn</option>{packageChoices.map(code=><option key={code} value={code}>{code}{data.data?` (${data.data.packageCounts?.[code]||0})`:''}</option>)}</select></label>
          <div className="pm-registry-filter-field"><span>Server</span><ServerFilter servers={serverChoices} value={servers} onChange={next=>go({servers:next})}/></div>
          <label className="pm-registry-filter-field"><span>Nhóm</span><select aria-label="Từ nhóm" className="pm-input" value={group} onChange={e=>go({group:e.target.value})}><option value="">Tất cả nhóm{groupCount('ALL')}</option><option value={GROUP_TUT}>TUT{groupCount(GROUP_TUT)}</option><option value={GROUP_SHARED}>Chung mooon–Genjy{groupCount(GROUP_SHARED)}</option><option value={GROUP_GENJY}>Genjy riêng{groupCount(GROUP_GENJY)}</option>{groupChoices.map(g=><option key={g.id} value={g.id}>{g.name}{groupCount(g.id)}</option>)}<option value={GROUP_UNKNOWN}>Chưa xác định{groupCount(GROUP_UNKNOWN)}</option></select></label>
          <label className="pm-registry-filter-field"><span>Trạng thái</span><select aria-label="Trạng thái proxy" className="pm-input" value={state} onChange={e=>go({state:e.target.value})}><option value="">Tất cả trạng thái{data.data?.stateCounts?` (${data.data.stateCounts.ALL??0})`:''}</option>{Object.entries(states).map(([value,label])=><option key={value} value={value}>{label}{data.data?.stateCounts?` (${data.data.stateCounts[value]??0})`:''}</option>)}<option value="OTHER">Khác NEW / LIVE / BLOCKED{data.data?.stateCounts?` (${data.data.stateCounts.OTHER??0})`:''}</option></select></label>
          <label className="pm-registry-filter-field"><span>Sắp xếp</span><select aria-label="Sắp xếp" className="pm-input" value={sort} onChange={e=>go({sort:e.target.value as RegistrySort})}><option value="PACKAGE">Gói → server / VM</option><option value="BLOCKED_FIRST">BLOCKED trước</option><option value="SERVER">Server / VM</option><option value="STATUS">Ghi nhận mới nhất</option><option value="IP">IP tăng dần</option></select></label>
        </div>
        {url.batch&&<p className="pm-filter-chip" role="status">Đang xem đợt nhập vừa thêm <button type="button" className="pm-link" onClick={()=>go({batch:''})}>Bỏ lọc đợt</button></p>}
      </div>
      <div className="pm-tabs" role="tablist" aria-label="Kho và lịch sử">{([['CURRENT','Đang quản lý'],['HISTORY','Lịch sử IP'],['ALL','Toàn bộ IP']] as const).map(([value,label])=><button key={value} role="tab" aria-selected={view===value} className={view===value?'active':''} onClick={()=>go({view:value as RegistryView})}>{label}</button>)}</div>
      {data.error&&<p role="alert" className="pm-error m-4">{data.error.message}</p>}
      {(rights?.canCopy||canEdit)&&<BulkBar count={selectedRows.length} unit="proxy" busy={inventory.busy||applyingState} onClear={()=>{setSelected(new Set());setBulkMode(null);}} onDelete={canDelete?()=>void runInventory(selectedRows.filter(deletable),'remove'):undefined} deleteCount={selectedRows.filter(deletable).length}>
        {canGroup&&<button className="pm-button pm-button-sm" disabled={!!bulkMode&&bulkMode!=='GROUP'} onClick={()=>setBulkMode('GROUP')}><Tags size={14}/>Đổi nhóm</button>}{canLocate&&<button className="pm-button pm-button-sm" disabled={!!bulkMode&&bulkMode!=='SERVER'} onClick={()=>setBulkMode('SERVER')}><Server size={14}/>Chuyển server</button>}{canLocate&&view==='CURRENT'&&<button className="pm-button pm-button-sm" disabled={!!bulkMode&&bulkMode!=='VM'} onClick={()=>setBulkMode('VM')}><MonitorSmartphone size={14}/>Gán VM</button>}
        {(canLocate||rights?.canBlock)&&view==='CURRENT'&&<span className="flex gap-1 items-center"><select aria-label="Trạng thái cho dòng đã chọn" className="pm-input pm-bulk-state" value={bulkState} disabled={applyingState} onChange={e=>setBulkState(e.target.value as ''|'NEW'|'LIVE'|'BLOCKED')}><option value="">Trạng thái…</option><option value="NEW">NEW</option><option value="LIVE">LIVE</option>{rights?.canBlock&&<option value="BLOCKED">BLOCKED</option>}</select><button className="pm-button pm-button-sm" disabled={!bulkState||applyingState} onClick={()=>void applyBulkState()}>{applyingState?'Đang lưu…':'Áp dụng'}</button></span>}
        {rights?.canCopy&&<button className="pm-button pm-button-sm" disabled={copying} onClick={()=>void copyChosen()}><Copy size={14}/>Copy proxy</button>}{canDelete&&selectedRows.some(deleted)&&<button className="pm-button pm-button-sm" disabled={inventory.busy} onClick={()=>void runInventory(selectedRows.filter(deleted),'restore')}><RotateCcw size={14}/>Khôi phục {selectedRows.filter(deleted).length} dòng</button>}
      </BulkBar>}
      {bulkMode&&selectedRows.length>0&&<BulkEditPanel key={bulkMode} {...editorProps} mode={bulkMode} rows={selectedRows} onClose={()=>setBulkMode(null)} onSaved={()=>{setSelected(new Set());refresh();}}/>}
      {pager('top')}{clamped&&<p className="pm-review text-xs mx-4 my-1" role="status">Trang {clamped} không còn (danh sách đã thay đổi); đang ở trang cuối {page}.</p>}<div className="pm-table-scroll"><table className="pm-table"><thead><tr>{rights?.canCopy&&<th className="pm-check"><input type="checkbox" aria-label="Chọn tất cả trên trang" checked={allOnPage} disabled={!selectable.length} onChange={e=>setSelected(prev=>{const next=new Set(prev);for(const r of selectable){if(e.target.checked) next.add(r.endpointId!);else next.delete(r.endpointId!);}return next;})}/></th>}<th>Gói proxy</th><th>IP proxy</th><th>Trạng thái</th><th>Từ nhóm</th><th>Server</th><th>VM</th><th>Ghi chú vận hành</th><th>Ghi nhận tình trạng</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>
        {rows.map((row,index)=>{const group=row.packageCode||'Chưa rõ gói',info=row.packageCode?catalog.data?.find(p=>p.code===row.packageCode):undefined,start=sort==='PACKAGE'&&(index===0||rows[index-1].packageCode!==row.packageCode);return <Fragment key={row.endpointId||row.identityId}>{start&&<tr className="pm-group"><td colSpan={columns}>Gói proxy <strong>{group}</strong>{info&&<span className="pm-muted">{packageHeading(info)}</span>}{info&&(info.due.state==='OVERDUE'||info.due.state==='DUE_SOON')&&<span className={dueBadge(info.due.state)+' ml-2'}>{dueLabel(info)}</span>}</td></tr>}<tr className={(row.state==='BLOCKED'?'pm-row-blocked':row.state==='REPLACED'?'pm-row-retired':'')+(row.endpointId&&selected.has(row.endpointId)?' pm-row-selected':'')}>{rights?.canCopy&&<td className="pm-check">{row.endpointId&&<input type="checkbox" aria-label={'Chọn '+row.ip} checked={selected.has(row.endpointId)} onChange={e=>toggleRow(row,e.target.checked)}/>}</td>}<td className="pm-code">{row.packageCode||<span className="pm-muted font-normal">Chưa rõ gói</span>}</td><td><button className="pm-ip" onClick={()=>setHistory(row.identityId)}>{row.ip}</button><div className="pm-muted text-xs mt-1">{row.port?'Port '+row.port:'IP từ nguồn Genjy'}</div>{row.endpointId&&rowErrors[row.endpointId]&&<div className="pm-error text-xs mt-1" role="alert">{rowErrors[row.endpointId]}{row.locations[0]&&<> · <Link className="underline" href={links.vms({serverId:row.locations[0].serverId,vm:row.locations[0].vmId})}>Mở {row.locations[0].serverCode}/{row.locations[0].vmCode}</Link></>}</div>}</td><td>{(canLocate||canGroup||rights?.canBlock)&&row.endpointId&&(row.state==='NEW'||row.state==='LIVE')?<StatusQuick projectId={projectId} row={row} canBlock={!!rights?.canBlock} onSaved={refresh}/>:<span className={`pm-badge ${row.state==='BLOCKED'?'pm-badge-red':row.state==='NEW'?'pm-badge-blue':row.state==='LIVE'?'pm-badge-green':'pm-badge-muted'}`}>{!row.endpointId&&row.owner==='GENJY'?'Giữ riêng':states[row.state]}</span>}</td><GroupCell row={row}/><LocationCells row={row}/><td className="pm-muted text-xs">{row.statusAt?localDate(row.statusAt):'Chưa rõ ngày'}</td><td><div className="flex gap-1">{rights?.canCopy&&row.endpointId&&<button className="pm-icon-button" title="Copy proxy đầy đủ" aria-label={'Copy proxy '+row.ip} onClick={()=>void copyProxy(row)}><Copy size={16}/></button>}{canEdit&&row.endpointId&&<button className={'pm-icon-button'+(editing===row.endpointId?' pm-icon-active':'')} title="Sửa nhóm / server / VM" aria-label={'Sửa '+row.ip} onClick={()=>setEditing(editing===row.endpointId?null:row.endpointId)}><Pencil size={16}/></button>}{canDelete&&deletable(row)&&<RowDeleteButton label={row.ip} busy={inventory.busy} onClick={()=>void runInventory([row],'remove')}/>}{canDelete&&deleted(row)&&<button className="pm-icon-button" title="Khôi phục" aria-label={'Khôi phục '+row.ip} disabled={inventory.busy} onClick={()=>void runInventory([row],'restore')}><RotateCcw size={16}/></button>}<button className="pm-icon-button" aria-label={'Xem lịch sử '+row.ip} onClick={()=>setHistory(row.identityId)}><History size={17}/></button></div></td></tr>{editing===row.endpointId&&row.endpointId&&<tr className="pm-row-editor"><td colSpan={columns}><RowEditor canDelete={canDelete} key={row.endpointId+':'+row.revision} {...editorProps} row={row} canGroup={canGroup} canLocate={canLocate&&(row.owner==='SELF'||isShared(row.owner,row.subgroup))&&row.state!=='RETIRED'} canUnassign={canLocate&&row.state!=='RETIRED'} canBlock={!!rights?.canBlock} onClose={()=>setEditing(null)} onSaved={refresh}/></td></tr>}</Fragment>;})}
        {data.isLoading&&<tr><td colSpan={columns} className="pm-empty">Đang tải kho proxy…</td></tr>}{!data.isLoading&&!rows.length&&!data.error&&<tr><td colSpan={columns} className="pm-empty"><Network size={30} className="mx-auto mb-3 text-blue-400"/><strong>Chưa có proxy trong danh sách này</strong><p className="pm-muted mt-1">{search||state||group||pkg||servers.length?'Đổi bộ lọc để tìm proxy.':'Nhập proxy mới hoặc đối chiếu dữ liệu Sheet để bắt đầu.'}</p></td></tr>}
      </tbody></table></div>{pager('bottom')}
    </div>
    <div className="pm-next"><div><strong className="text-sm">Gán proxy cho VM</strong><p className="pm-muted text-sm mt-1">Chọn VM thiếu proxy ở Server/VM rồi điền NEW của TUT cho đúng các VM đã chọn. Gán là xong: VM dùng proxy đó ngay, không có bước cài / xác nhận.</p></div>{vmAccess.data?.canAssign&&<Link className="pm-button" href={links.vms({view:'MISSING'})}>Mở VM thiếu proxy <ArrowUpRight size={16}/></Link>}</div>
    {operationsOpen&&<OperationHistoryDialog projectId={projectId} onClose={()=>setOperationsOpen(false)} onChanged={refresh}/>} {backupsOpen&&<SystemBackupDialog onClose={()=>setBackupsOpen(false)}/>} {rightsOpen&&<MemberRightsDialog projectId={projectId} onClose={()=>setRightsOpen(false)}/>} {fallback&&<ProxyCopy data={{proxy:fallback}} isLoading={false} error={null} onClose={()=>setFallback(null)}/>} {kind&&<BatchDialog projectId={projectId} kind={kind} onImported={imported} onClose={()=>setKind(null)} onSaved={refresh}/>} {history&&<HistoryPanel projectId={projectId} identityId={history} onClose={()=>setHistory(null)}/>}  {catalogOpen&&<PackageDialog projectId={projectId} packages={catalog.data||[]} loading={catalog.isLoading} canManage={!!rights?.canManage} initialPayCode={payParam||undefined} initialView={packagesParam?'DUE':'ALL'} onClose={()=>{setCatalogOpen(false);if(payParam||packagesParam) go({},'replace',null);}} onSaved={()=>{void catalog.refetch();refresh();}}/>} {syncOpen&&<StateSyncDialog projectId={projectId} onClose={()=>setSyncOpen(false)} onSaved={()=>{refresh();void data.refetch();}}/>} {sharedOpen&&<SharedListDialog projectId={projectId} onClose={()=>setSharedOpen(false)} onSaved={()=>{refresh();void data.refetch();}}/>} {groupsOpen&&<GroupDialog projectId={projectId} canManage={!!rights?.canManage} onClose={()=>setGroupsOpen(false)} onChanged={refresh}/>}
  </div>;
}
