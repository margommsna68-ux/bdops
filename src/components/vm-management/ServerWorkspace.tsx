"use client";
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {useSession} from 'next-auth/react';
import {Plus,RefreshCw,Search,ClipboardPaste,Trash2,RotateCcw,X,MoreHorizontal,Copy} from 'lucide-react';
import toast from 'react-hot-toast';
import {trpc} from '@/lib/trpc';
import {compareCodes} from '@/server/proxy-management/package-terms';
import {displayNote} from '@/server/vm-management/vm-codes';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {copyWhenReady} from '@/components/proxy-management/clipboard';
import {links} from '@/lib/links';
import {moduleOn} from '@/lib/features';
import {InlineText} from './InlineText';
import {AddVmDialog,CreateServerDialog} from './VmForms';
import {useVMRefresh,errorMessage,type ManagedVM} from './shared';
import {vmView,summarizeVMs} from './workflow';
import {VmGrid,type CopyWhich,type GridRights} from './vm-grid/VmGrid';
import type {StatusActionKind} from './vm-grid/status-actions';
import {VmSidePanel} from './vm-grid/VmSidePanel';
import {PasteTablePanel,AssignProxyPanel,NotesPanel} from './vm-grid/BulkPanels';
import {AccountBulkPanel} from './vm-grid/AccountPanels';
import type {VmAccount} from './vm-grid/AccountCell';
import {ServerPicker,ColumnMenu,Pager} from './vm-grid/GridControls';
import {DEFAULT_PREFS,OPS_FILTERS,normalizePrefs,pageOf,prefsKey,readGridUrl,writeGridUrl,type EditField,type GridPrefs,type GridSort,type GridUrl,type GridView,type MoneyFilter,type OpsFilter,type PanelTab} from './vm-grid/grid-model';
import type {OpsRow} from './vm-grid/OpsCells';
import {VM_OPS,VM_OPS_STATUSES,NO_STATUS_LABEL,MILESTONE_LABEL,opsPriority,type Milestone,type VmOpsStatus} from '@/lib/vm-ops';
type Blocked={id:string;code:string;reason:string;cause?:string};
type BulkPanel='paste'|'assign'|'account'|'note'|'copy'|null;
const CAUSE_TAB:Record<string,PanelTab>={HOLD:'install',TASK:'install',INSTALLED:'overview',SDK:'overview',SERVER:'overview'};
const STATUS_ORDER={REVIEW:0,PENDING:1,MISSING:2,INSTALLED:3,ARCHIVED:4} as const;
// Server/VM operations table. One scroll area under a fixed header (server picker, counts, search, bulk bar); sticky identity and
// action columns; side panel instead of stacked dialogs; everything the user picked lives in the URL. See docs/runbooks/server-vm-table.md.
export function ServerWorkspace({projectId,serverId}:{projectId:string;serverId?:string}){
  const workspace=trpc.vmManagement.workspace.useQuery({projectId}),access=trpc.vmManagement.access.useQuery({projectId}),business=trpc.businessManagement.access.useQuery({projectId}),accounts=trpc.accountStore.vmAccounts.useQuery({projectId},{retry:false}),orphans=trpc.vmManagement.orphanTasks.useQuery({projectId}),board=trpc.vmOps.board.useQuery({projectId},{retry:false}),setOps=trpc.vmOps.setStatus.useMutation();
  const refresh=useVMRefresh(),params=useSearchParams(),router=useRouter(),pathname=usePathname(),session=useSession(),userId=(session.data?.user as {id?:string}|undefined)?.id||'anon';
  const url=readGridUrl(params);
  // Two quick changes (sort, then page size) must both survive: build on the last URL we asked for until the router catches up.
  const pending=useRef<GridUrl|null>(null);useEffect(()=>{pending.current=null;},[params]);
  const go=useCallback((patch:Partial<GridUrl>,mode:'push'|'replace'='push')=>{const next={...(pending.current||readGridUrl(new URLSearchParams(window.location.search))),...patch};pending.current=next;const href=pathname+writeGridUrl(next);if(mode==='push') router.push(href,{scroll:false});else router.replace(href,{scroll:false});},[pathname,router]);
  // Search box: typing updates the URL in place (replace), so Back goes to the previous filter, not to every keystroke.
  const [q,setQ]=useState(url.q);useEffect(()=>{setQ(url.q);},[url.q]);
  useEffect(()=>{if(q===url.q) return;const t=setTimeout(()=>go({q,page:1},'replace'),250);return ()=>clearTimeout(t);},[q,url.q,go]);
  const [prefs,setPrefs]=useState<GridPrefs>(DEFAULT_PREFS);
  useEffect(()=>{try{setPrefs(normalizePrefs(JSON.parse(localStorage.getItem(prefsKey(userId))||'null')));}catch{setPrefs(DEFAULT_PREFS);}},[userId]);
  const savePrefs=(p:GridPrefs)=>{setPrefs(p);try{localStorage.setItem(prefsKey(userId),JSON.stringify(p));}catch{/* private mode */}};
  const [selected,setSelected]=useState<Set<string>>(new Set()),[blocked,setBlocked]=useState<Blocked[]>([]),[bulk,setBulk]=useState<BulkPanel>(null),[form,setForm]=useState<'CREATE'|'ADD'|null>(null),[manualCopy,setManualCopy]=useState<string|null>(null);
  // A selection never survives a change of project, server, filter or search; page and sort keep it (ids, not positions).
  const scopeKey=projectId+'|'+(serverId||'')+'|'+url.view+'|'+url.q+'|'+url.st.join(',')+'|'+url.money+'|'+url.warn,firstScope=useRef(scopeKey);
  useEffect(()=>{if(firstScope.current===scopeKey) return;firstScope.current=scopeKey;setSelected(new Set());setBlocked([]);setBulk(b=>b==='paste'?b:null);},[scopeKey]);
  const allServers=useMemo(()=>[...(workspace.data?.servers||[])].sort((a,b)=>compareCodes(a.code,b.code)),[workspace.data]),servers=allServers.filter(s=>!s.archivedAt),current=allServers.find(s=>s.id===serverId),single=!!current;
  const allVMs=useMemo(()=>workspace.data?.vms||[],[workspace.data]),inScope=useMemo(()=>allVMs.filter(v=>!serverId||v.serverId===serverId),[allVMs,serverId]);
  const active=useMemo(()=>inScope.filter(v=>!v.archivedAt&&servers.some(s=>s.id===v.serverId)),[inScope,servers]),deleted=useMemo(()=>inScope.filter(v=>v.archivedAt),[inScope]),deletedView=url.view==='DELETED';
  const counts=summarizeVMs(active),noSdk=active.filter(v=>!v.sdk).length;
  // EarnApp account (login + PayPal) of each VM; the search also finds VMs by login email or PayPal code.
  const accountOfVm=useMemo(()=>new Map<string,VmAccount>((accounts.data||[]).map(a=>[a.vmId,a])),[accounts.data]),accountText=(id:string)=>{const a=accountOfVm.get(id);return a?[a.earnApp?.login.email,a.earnApp?.paypal?.code,a.earnApp?.paypal?.email,a.legacyGmail].filter(Boolean).join(' '):'';};
  // Account gaps overlap: a VM without an EarnApp account has no PayPal either. Counted only once the links are loaded.
  const accountView=url.view==='ACCOUNT_MISSING'||url.view==='PAYPAL_MISSING',accountsReady=!!accounts.data;
  const noAccount=accountsReady?active.filter(v=>!accountOfVm.get(v.id)?.earnApp).length:null,noPaypal=accountsReady?active.filter(v=>!accountOfVm.get(v.id)?.earnApp?.paypal).length:null;
  // Open install tasks whose configuration is no longer pending: handled at the VM (tab Cài proxy → Đóng việc), never auto-closed.
  const orphanVms=useMemo(()=>new Set((orphans.data||[]).map(t=>t.vmId)),[orphans.data]),orphanView=url.view==='TASK_ORPHAN',orphansReady=!!orphans.data,noOrphan=orphansReady?active.filter(v=>orphanVms.has(v.id)).length:null;
  const inView=(v:ManagedVM)=>!url.view||(url.view==='TASK_ORPHAN'?orphanVms.has(v.id):url.view==='SDK_MISSING'?!v.sdk:url.view==='ACCOUNT_MISSING'?!accountOfVm.get(v.id)?.earnApp:url.view==='PAYPAL_MISSING'?!accountOfVm.get(v.id)?.earnApp?.paypal:vmView(v)===url.view);
  // Operating state (recorded by people / AI) and the money milestone of the current round (from the PayPal book).
  const opsOfVm=useMemo(()=>new Map<string,OpsRow>((board.data?.vms||[]).map(o=>[o.vmId,o])),[board.data]);
  const opsStatus=(v:ManagedVM)=>(opsOfVm.get(v.id)?.status??v.ops??null) as VmOpsStatus|null,milestone=(v:ManagedVM)=>(opsOfVm.get(v.id)?.milestone||'') as Milestone;
  const proxyBlocked=(v:ManagedVM)=>v.holds.some(h=>h.state==='BLOCKED');
  const opsKey=(v:ManagedVM):OpsFilter=>opsStatus(v)??'NONE';
  const opsView=(v:ManagedVM)=>(!url.st.length||url.st.includes(opsKey(v)))&&(!url.money||(url.money==='NONE'?!milestone(v):milestone(v)===url.money))&&(!url.warn||proxyBlocked(v));
  const priority=(v:ManagedVM)=>opsPriority({status:opsStatus(v),proxyBlocked:proxyBlocked(v),milestone:milestone(v)});
  const needle=url.q.trim().toLowerCase();
  // Filter and sort the whole result first, then page it.
  const filtered=useMemo(()=>(accountView&&!accountsReady||orphanView&&!orphansReady?[]:deletedView?deleted:active).filter(v=>(deletedView||inView(v)&&opsView(v))&&(!needle||`${v.server} ${v.code} ${displayNote(v.notes)||''} ${v.desired?.ip||''} ${v.installed?.ip||''} ${v.sdk?.id||''} ${accountText(v.id)}`.toLowerCase().includes(needle)))
    .sort((a,b)=>(url.sort==='PRIORITY'?priority(a)-priority(b):url.sort==='SDK'?Number(!!a.sdk)-Number(!!b.sdk):url.sort==='PROXY'?Number(vmView(a)!=='MISSING')-Number(vmView(b)!=='MISSING'):url.sort==='STATUS'?STATUS_ORDER[vmView(a)]-STATUS_ORDER[vmView(b)]:0)||compareCodes(a.server,b.server)||compareCodes(a.code,b.code)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deletedView,deleted,active,url.view,url.sort,url.st,url.money,url.warn,needle,accountOfVm,accountView,accountsReady,orphanVms,orphanView,orphansReady,opsOfVm]);
  // The selection is a set of ids: a row that leaves the filter after an action (Thiếu proxy → Chờ cài) stays selected and stays in
  // the open bulk panel. Bulk actions take the selected rows in table order.
  const selectedRows=useMemo(()=>[...(deletedView?deleted:active)].filter(v=>selected.has(v.id)).sort((a,b)=>compareCodes(a.server,b.server)||compareCodes(a.code,b.code)),[deletedView,deleted,active,selected]);
  const paged=pageOf(filtered,url.page,url.size),onPage=new Set(paged.rows.map(v=>v.id)),offPage=selectedRows.filter(v=>!onPage.has(v.id)).length,selectedInFilter=filtered.filter(v=>selected.has(v.id)).length;
  const rights:GridRights={manage:!!access.data?.canManage,assign:!!access.data?.canAssign,copy:!!access.data?.canCopy,confirm:!!access.data?.canConfirm,costs:!!business.data?.costs,sourceConnected:!!access.data?.sourceConnected};
  const panelVm=url.vm?allVMs.find(v=>v.id===url.vm):undefined;
  // The table gets the rest of the window height; the page itself does not scroll, so there is one vertical scroll area.
  const gridHost=useRef<HTMLDivElement>(null),[maxHeight,setMaxHeight]=useState(480),hasSelection=selected.size>0;
  useLayoutEffect(()=>{const fit=()=>{const el=gridHost.current;if(!el) return;const top=el.getBoundingClientRect().top+window.scrollY;setMaxHeight(Math.max(260,Math.floor(window.innerHeight-top-84)));};fit();window.addEventListener('resize',fit);return ()=>window.removeEventListener('resize',fit);},[hasSelection,blocked.length,deletedView,workspace.isLoading,single,access.data?.sourceConnected]);
  // Reload with ?vm=…: bring that row into view once.
  const scrolled=useRef(false);useEffect(()=>{if(scrolled.current||!url.vm||!workspace.data) return;scrolled.current=true;requestAnimationFrame(()=>document.querySelector(`[data-row="${url.vm}"]`)?.scrollIntoView({block:'center'}));},[url.vm,workspace.data]);
  const openVm=(vmId:string,tab:PanelTab='overview',cause:string|null=null)=>{setBulk(null);go({vm:vmId,tab,cause});};
  const closePanel=useCallback(()=>{const id=new URLSearchParams(window.location.search).get('vm');setBulk(null);if(id){go({vm:null,tab:'overview',cause:null});requestAnimationFrame(()=>document.querySelector<HTMLElement>(`[data-row="${id}"] .vm-id-button`)?.focus({preventScroll:true}));}},[go]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&(url.vm||bulk)&&!(e.target as HTMLElement)?.closest?.('.vm-cell-edit,.vm-popover,[role="menu"],.pm-inline-edit,textarea,input,select')) closePanel();};window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);},[url.vm,bulk,closePanel]);
  const copyProxies=trpc.vmManagement.copyProxies.useMutation(),copyInstall=trpc.vmManagement.copy.useMutation(),updateServer=trpc.vmManagement.updateServer.useMutation(),updateVM=trpc.vmManagement.updateVM.useMutation(),sdkApply=trpc.vmManagement.sdkApply.useMutation();
  const deleteVMs=trpc.vmManagement.deleteVMs.useMutation(),restoreVMs=trpc.vmManagement.restoreVMs.useMutation(),deleteServer=trpc.vmManagement.deleteServer.useMutation(),restoreServer=trpc.vmManagement.restoreServer.useMutation(),undo=trpc.proxyManagement.undo.useMutation();
  const busy=deleteVMs.isLoading||restoreVMs.isLoading||deleteServer.isLoading||restoreServer.isLoading;
  function undoToast(text:string,operationId?:string){toast.success(t=><span className="flex items-center gap-3">{text}{operationId&&<button className="pm-button pm-button-quiet" onClick={()=>{toast.dismiss(t.id);undo.mutateAsync({projectId,id:operationId,reason:''}).then(()=>{toast.success('Đã hoàn tác');void refresh();}).catch(e=>toast.error(e.message));}}>Hoàn tác</button>}</span>,{duration:8000});}
  // Plain copy: never starts the install. Rows are copied in table order; skipped rows are counted with their reason.
  async function copyList(vms:ManagedVM[],which:CopyWhich){
    if(!vms.length) return;let skipped:{vm:string;reason:string}[]=[],copied=0;
    const out=await copyWhenReady(async()=>{const r=await copyProxies.mutateAsync({projectId,vmIds:vms.map(v=>v.id),which});skipped=r.skipped.map(s=>({vm:s.vm,reason:s.reason}));copied=r.items.length;if(!r.items.length) throw new Error(r.skipped[0]?.reason||'Không có proxy để copy');return r.items.map(i=>i.proxy).join('\n');});
    const label=which==='DESIRED'?'được giao':'đã cài';
    if(out.ok) toast.success(vms.length===1?`Đã copy proxy ${label} · ${vms[0].code}`:`Đã copy ${copied} proxy ${label}`+(skipped.length?` · bỏ qua ${skipped.length} (${skipped[0].reason})`:''),{duration:5000});
    else if(out.text){setManualCopy(out.text);setBulk('copy');toast('Trình duyệt chặn copy; chọn và copy trong khung bên phải.');}
    else toast.error(out.error||'Chưa copy được');
  }
  async function copyToInstall(vm:ManagedVM){
    const out=await copyWhenReady(async()=>(await copyInstall.mutateAsync({projectId,configurationId:vm.desired!.id})).proxy);void refresh();
    if(out.ok) toast.success('Đã copy để cài '+vm.code+'; việc cài đã bắt đầu');else if(out.text){setManualCopy(out.text);setBulk('copy');}else toast.error(out.error||'Chưa copy được');
  }
  async function remove(ids:string[]){
    try{const r=await deleteVMs.mutateAsync({projectId,vmIds:ids});setBlocked(r.blocked);setSelected(prev=>{const n=new Set(prev);ids.forEach(id=>{if(!r.blocked.some(b=>b.id===id)) n.delete(id);});return n;});void refresh();
      if(r.archived) undoToast(`Đã xoá ${r.archived} VM`,r.operationId);
      if(r.blocked.length) toast.error(r.blocked.length===1&&ids.length===1?r.blocked[0].reason:`${r.blocked.length} VM bị chặn — xem lý do phía trên bảng`,{duration:7000});
    }catch(e){toast.error(errorMessage(e));}
  }
  async function restore(ids:string[]){
    try{const r=await restoreVMs.mutateAsync({projectId,vmIds:ids});setBlocked(r.blocked);setSelected(new Set());void refresh();
      if(r.restored) undoToast(`Đã khôi phục ${r.restored} VM`,r.operationId);
      if(r.blocked.length) toast.error(`${r.blocked.length} VM chưa khôi phục — xem lý do phía trên bảng`,{duration:7000});
    }catch(e){toast.error(errorMessage(e));}
  }
  async function removeServer(){
    if(!current) return;const held=active.filter(v=>v.holds.length>0);
    // Known blockers first: no confirmation for something that cannot succeed. The server re-checks anyway.
    if(held.length){setBlocked(held.map(v=>({id:v.id,code:v.code,cause:'HOLD',reason:'Còn proxy '+v.holds.map(h=>h.ip+' · '+(h.role==='INSTALLED'?'Đã cài':h.role==='UNCERTAIN'?'Giữ để kiểm tra':'Chờ cài')).join(', ')+'; bỏ gán trước'})));toast.error(held.length+' VM còn giữ proxy; chưa xoá được server',{duration:7000});return;}
    if(!window.confirm(`Xoá server ${current.code} cùng ${active.length} VM? Dữ liệu và lịch sử được giữ; khôi phục ở bộ lọc Đã xoá.`)) return;
    try{const r=await deleteServer.mutateAsync({projectId,serverId:current.id});undoToast(`Đã xoá ${current.code} · ${r.archivedVMs} VM`,r.operationId);void refresh();router.push('/infrastructure/servers');}
    catch(e){toast.error(errorMessage(e),{duration:8000});}
  }
  async function bringBackServer(id:string){
    try{const r=await restoreServer.mutateAsync({projectId,serverId:id});undoToast(`Đã khôi phục server · ${r.restoredVMs} VM`+(r.skipped.length?` · ${r.skipped.length} VM cần xử lý SDK`:''),r.operationId);setBlocked(r.skipped);void refresh();}
    catch(e){toast.error(errorMessage(e));}
  }
  // Only the edited field is sent; untouched fields (including hidden import notes) stay exactly as stored.
  const saveServer=(field:'code'|'notes'|'ipAddress')=>async(value:string)=>{if(!current)return;const r=await updateServer.mutateAsync({projectId,serverId:current.id,code:field==='code'?value:current.code,...(field==='notes'?{notes:value}:{}),...(field==='ipAddress'?{ipAddress:value}:{}),expectedRevision:current.revision});if(r.saved){toast.success('Đã lưu');await refresh();}};
  async function saveCell(vm:ManagedVM,field:EditField,value:string){
    if(field==='sdk'){const r=await sdkApply.mutateAsync({projectId,key:crypto.randomUUID(),items:[{vmId:vm.id,sdk:value,expectedRevision:vm.revision}]});if(r.undone) throw new Error('Thao tác đã được hoàn tác; tải lại để kiểm tra');}
    else{const r=await updateVM.mutateAsync({projectId,vmId:vm.id,...(field==='code'?{code:value}:{notes:value||null}),expectedRevision:vm.revision});if(!r.saved){await refresh();return;}}
    toast.success('Đã lưu '+vm.code,{duration:1500});await refresh();
  }
  // Tình trạng cell actions. Each one is the existing checked command; errors propagate so the cell keeps the old state and shows why.
  const startInstall=trpc.vmManagement.start.useMutation(),confirmInstall=trpc.vmManagement.confirm.useMutation(),reportFailure=trpc.vmManagement.reportFailure.useMutation(),autoPreview=trpc.vmManagement.preview.useMutation(),autoCommit=trpc.vmManagement.commit.useMutation();
  async function statusAction(vm:ManagedVM,kind:StatusActionKind,note?:string):Promise<void>{
    if(kind==='ASSIGN'||kind==='CHANGE_PROXY'){openVm(vm.id,'proxy');return;}
    if(kind==='OPEN_INSTALL'){openVm(vm.id,'install');return;}
    if(kind==='OPEN_REGISTRY'){const ip=vm.holds.find(h=>h.endpointId===vm.desired?.endpointId)?.ip||vm.holds[0]?.ip||vm.desired?.ip||'';router.push(links.proxies({q:ip||undefined}));return;}
    const d=vm.desired;let message='';
    if(kind==='START'){const r=await startInstall.mutateAsync({projectId,configurationId:d!.id,expectedVmRevision:vm.revision});message=r.replay?vm.code+' đã ở trạng thái đang cài':'Đã bắt đầu cài '+vm.code;}
    else if(kind==='COPY_INSTALL'){const out=await copyWhenReady(async()=>(await copyInstall.mutateAsync({projectId,configurationId:d!.id})).proxy);if(!out.ok){if(out.text){setManualCopy(out.text);setBulk('copy');}else throw new Error(out.error||'Chưa copy được');}message='Đã copy để cài '+vm.code+'; việc cài đã bắt đầu';}
    else if(kind==='CONFIRM'){const r=await confirmInstall.mutateAsync({projectId,configurationId:d!.id,configurationHash:d!.hash,expectedVmRevision:vm.revision});message=r.replay?vm.code+' đã được xác nhận trước đó':'Đã xác nhận cài '+(d!.ip||'')+' trên '+vm.code;}
    else if(kind==='FAIL'){const r=await reportFailure.mutateAsync({projectId,configurationId:d!.id,note:note||'',expectedVmRevision:vm.revision});message=r.saved?'Đã ghi vướng mắc '+vm.code:'Vướng mắc không đổi; không ghi thêm';}
    else if(kind==='AUTOFILL'){const key=crypto.randomUUID(),p=await autoPreview.mutateAsync({projectId,mode:'AUTO',vmIds:[vm.id],idempotencyKey:key});const row=p.rows[0];if(!p.ready) throw new Error(row?.message||'Không giao được proxy cho VM này');await autoCommit.mutateAsync({projectId,token:p.token,idempotencyKey:key});message='Đã giao '+(row?.ip||'proxy')+' cho '+vm.code+'; chờ cài';}
    toast.success(message,{duration:3000});await refresh();
  }
  // Tình trạng: one command for the cell and for bulk; same value = nothing written; old-round commands are refused by the server.
  const opsRights={assign:rights.assign,money:!!board.data?.rights.money,writeMoney:!!board.data?.rights.writeMoney};
  async function setOpsStatus(vm:ManagedVM,status:VmOpsStatus,cycle:number){
    const r=await setOps.mutateAsync({projectId,key:crypto.randomUUID(),items:[{vmId:vm.id,status,expectedCycle:cycle}]}),row=r.rows[0];
    if(row?.outcome==='ERROR')throw new Error(row.message);
    if(row?.outcome==='APPLIED')toast.success(vm.code+': '+row.message,{duration:1500});await board.refetch();
  }
  const [bulkOps,setBulkOps]=useState<VmOpsStatus|''>(''),[bulkOpsErrors,setBulkOpsErrors]=useState<{vm:string;message:string}[]>([]);
  async function applyBulkOps(){
    if(!bulkOps)return;
    try{const r=await setOps.mutateAsync({projectId,key:crypto.randomUUID(),items:selectedRows.map(v=>({vmId:v.id,status:bulkOps,expectedCycle:opsOfVm.get(v.id)?.cycle??v.cycle}))});
      setBulkOpsErrors(r.rows.filter(x=>x.outcome==='ERROR').map(x=>({vm:x.where,message:x.message})));
      toast.success(`${VM_OPS[bulkOps].label}: ${r.applied} VM`+(r.skipped?` · ${r.skipped} giữ nguyên`:'')+(r.errors?` · ${r.errors} lỗi`:''),{duration:4000});await board.refetch();}
    catch(e){toast.error(errorMessage(e));}
  }
  const toggle=(id:string,on:boolean)=>setSelected(prev=>{const n=new Set(prev);if(on)n.add(id);else n.delete(id);return n;});
  const togglePage=(on:boolean)=>setSelected(prev=>{const n=new Set(prev);paged.rows.forEach(v=>{if(on)n.add(v.id);else n.delete(v.id);});return n;});
  // Bulk bar buttons always open their panel; only the header "Dán bảng" button toggles.
  const openBulk=(panel:BulkPanel,toggle=false)=>{if(url.vm) go({vm:null,cause:null});setBulk(toggle&&bulk===panel?null:panel);};
  useEffect(()=>{if(!selected.size) setBulk(b=>b==='assign'||b==='account'||b==='note'?null:b);},[selected.size]);
  const chip=(view:GridView,label:string,n:number|null)=><button type="button" className={'vm-chip'+(url.view===view?' active':'')+(n&&['MISSING','PENDING','REVIEW','SDK_MISSING','ACCOUNT_MISSING','PAYPAL_MISSING','TASK_ORPHAN'].includes(view)?' attention':'')} aria-pressed={url.view===view} onClick={()=>go({view:url.view===view&&view?'':view,page:1})}>{label} <strong>{n??'…'}</strong></button>;
  if(workspace.error)return <p role="alert" className="pm-error">{workspace.error.message}</p>;
  if(serverId&&workspace.data&&!current)return <p role="alert" className="pm-error">Server không thuộc dự án này.</p>;
  if(current?.archivedAt)return <div className="proxy-workspace space-y-4"><div className="pm-heading"><div><h1>{current.code}</h1><p className="pm-muted">Server đã xoá. Dữ liệu và lịch sử vẫn được giữ.</p></div>{rights.manage&&<button className="pm-button pm-button-primary" disabled={busy} onClick={()=>void bringBackServer(current.id)}><RotateCcw size={16}/>Khôi phục server</button>}</div><Link className="pm-button pm-button-quiet w-fit" href="/infrastructure/servers">Về danh sách server</Link></div>;
  const pickerServers=servers.map(s=>({id:s.id,code:s.code,ipAddress:s.ipAddress,vms:allVMs.filter(v=>v.serverId===s.id&&!v.archivedAt).length}));
  const pager=(where:'top'|'bottom')=><Pager where={where} first={paged.first} last={paged.last} total={filtered.length} page={paged.current} pages={paged.pages} size={url.size} onPage={p=>go({page:p})} onSize={s=>go({size:s,page:1})}/>;
  const panelOpen=!!panelVm||!!bulk;
  return <div className="proxy-workspace vm-workspace">
    <div className="vm-head">
      <ServerPicker servers={pickerServers} value={serverId||''} onChange={id=>router.push((id?`/infrastructure/servers/${id}`:'/infrastructure/servers')+writeGridUrl({...url,q:'',page:1,vm:null,cause:null}))}/>
      <div className="vm-title min-w-0">{single?<h1><InlineText value={current!.code} label="tên server" canEdit={rights.manage} onSave={saveServer('code')}/></h1>:<h1>Server / VM</h1>}
        {single&&<div className="pm-muted text-xs flex gap-3 flex-wrap"><span>IP: <InlineText value={current!.ipAddress} label="IP server" placeholder="chưa có" canEdit={rights.manage} onSave={saveServer('ipAddress')}/></span><span className="min-w-0">Ghi chú: <InlineText value={displayNote(current!.notes)} label="ghi chú server" placeholder="thêm ghi chú" canEdit={rights.manage} onSave={saveServer('notes')}/></span></div>}</div>
      <div className="vm-head-actions">{rights.manage&&servers.length>0&&<button className="pm-button" onClick={()=>setForm('ADD')}><Plus size={16}/>Thêm VM</button>}{(rights.assign||rights.manage)&&<button className={'pm-button'+(bulk==='paste'?' pm-button-primary':'')} onClick={()=>openBulk('paste',true)}><ClipboardPaste size={16}/>Dán bảng</button>}<button className="pm-icon-button" aria-label="Tải lại" title="Tải lại" onClick={()=>void refresh()}><RefreshCw size={16}/></button>
        <DropdownMenu><DropdownMenuTrigger asChild><button className="pm-icon-button" aria-label="Quản lý server" title="Quản lý server"><MoreHorizontal size={16}/></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="vm-menu">
          {rights.manage&&<DropdownMenuItem onSelect={()=>setForm('CREATE')}>Thêm server</DropdownMenuItem>}
          {moduleOn('INSTALL_TASKS')&&<DropdownMenuItem asChild><Link href={links.installs()}>Việc cài proxy</Link></DropdownMenuItem>}<DropdownMenuItem asChild><Link href={links.proxies()}>Kho proxy</Link></DropdownMenuItem>
          {rights.manage&&single&&<><DropdownMenuSeparator/><DropdownMenuItem className="text-red-600" disabled={busy} onSelect={()=>void removeServer()}>Xoá server {current!.code}</DropdownMenuItem></>}
        </DropdownMenuContent></DropdownMenu></div>
    </div>
    {access.data&&!access.data.sourceConnected&&<p className="pm-source-warning">Cần kết nối nguồn Genjy trước khi giao proxy (Kho proxy → Cập nhật).</p>}
    <div className="vm-chips" role="group" aria-label="Lọc nhanh">{chip('','Tất cả',counts.total)}{chip('MISSING','Thiếu proxy',counts.missing)}{chip('PENDING','Chờ cài',counts.pending)}{chip('INSTALLED','Đã cài',counts.installed)}{chip('REVIEW','Cần kiểm tra',counts.review)}{chip('SDK_MISSING','Chưa SDK',noSdk)}{chip('ACCOUNT_MISSING','Chưa tài khoản',noAccount)}{chip('PAYPAL_MISSING','Chưa PayPal',noPaypal)}{(noOrphan||orphanView)?chip('TASK_ORPHAN','Việc cài bị bỏ lại',noOrphan):null}{chip('DELETED','Đã xoá',deleted.length)}</div>
    <div className="vm-chips vm-chips-ops" role="group" aria-label="Lọc theo tình trạng vận hành"><span className="pm-muted text-xs">Tình trạng:</span>
      {OPS_FILTERS.map(k=>{const n=active.filter(v=>opsKey(v)===k).length,on=url.st.includes(k);if(!n&&!on)return null;return <button key={k} type="button" className={'vm-chip vm-chip-ops vm-ops-'+(k==='NONE'?'none':VM_OPS[k].tone)+(on?' active':'')} aria-pressed={on} onClick={()=>go({st:on?url.st.filter(x=>x!==k):[...url.st,k],page:1})}>{k==='NONE'?NO_STATUS_LABEL:VM_OPS[k].label} <strong>{n}</strong></button>;})}
      <span className="pm-muted text-xs ml-2">Proxy / tiền:</span>
      {(()=>{const n=active.filter(proxyBlocked).length;return (n||url.warn)?<button type="button" className={'vm-chip'+(url.warn?' active':'')+(n?' attention':'')} aria-pressed={url.warn} onClick={()=>go({warn:!url.warn,page:1})}>Proxy BLOCKED <strong>{n}</strong></button>:null;})()}
      {(['WAITING','RECREATE','MONEY_REVIEW','FAILED'] as const).map(k=>{const n=board.data?active.filter(v=>milestone(v)===k).length:null,on=url.money===k;if(!n&&!on)return null;return <button key={k} type="button" className={'vm-chip'+(on?' active':'')+(k==='RECREATE'||k==='MONEY_REVIEW'?' attention':'')} aria-pressed={on} onClick={()=>go({money:(on?'':k) as MoneyFilter,page:1})}>{MILESTONE_LABEL[k]} <strong>{n??'…'}</strong></button>;})}
      {(url.st.length>0||url.money||url.warn)&&<button type="button" className="pm-link text-xs" onClick={()=>go({st:[],money:'',warn:false,page:1})}>Bỏ lọc tình trạng</button>}
    </div>
    {board.error&&<p role="alert" className="pm-error">Chưa đọc được tình trạng vận hành: {board.error.message} <button className="pm-link" onClick={()=>void board.refetch()}>Thử lại</button></p>}
    {orphanView&&orphans.error&&<p role="alert" className="pm-error">Chưa đọc được việc cài: {orphans.error.message} <button className="pm-link" onClick={()=>void orphans.refetch()}>Thử lại</button></p>}{accountView&&accounts.error&&<p role="alert" className="pm-error">Chưa đọc được tài khoản EarnApp: {accounts.error.message} <button className="pm-link" onClick={()=>void accounts.refetch()}>Thử lại</button></p>}
    {url.vm&&workspace.data&&!panelVm&&<div className="pm-blocked flex flex-wrap gap-2 items-center justify-between" role="alert"><span className="text-sm">VM trong liên kết không còn trong dự án này (đã xoá hẳn hoặc thuộc dự án khác).</span><button className="pm-button pm-button-quiet" onClick={()=>go({vm:null,tab:'overview',cause:null},'replace')}>Đóng, về danh sách</button></div>}
    <div className={'vm-body'+(panelOpen?' with-panel':'')}>
      <div className="pm-surface vm-surface">
        <div className="vm-toolbar"><label className="pm-search vm-search"><Search size={16}/><input aria-label="Tìm VM, proxy, SDK, tài khoản, PayPal hoặc ghi chú" placeholder={single?'Tìm VM, IP, SDK, tài khoản, PP, ghi chú…':'Tìm server, VM, IP, SDK, tài khoản, PP…'} value={q} onChange={e=>setQ(e.target.value)}/>{q&&<button className="vm-cell-icon" aria-label="Xoá ô tìm" onClick={()=>setQ('')}><X size={14}/></button>}</label>
          <select aria-label="Sắp xếp VM" className="pm-input vm-sort" value={url.sort} onChange={e=>go({sort:e.target.value as GridSort})}><option value="VM">Theo mã VM</option><option value="PRIORITY">Cần xử lý trước</option><option value="STATUS">Theo tiến độ cài</option><option value="PROXY">Thiếu proxy trước</option><option value="SDK">Chưa có SDK trước</option></select>
          <ColumnMenu prefs={prefs} onChange={savePrefs}/></div>
        {deletedView&&!serverId&&allServers.some(s=>s.archivedAt)&&<div className="pm-deleted-servers"><span className="pm-muted text-sm">Server đã xoá:</span>{allServers.filter(s=>s.archivedAt).map(s=><span key={s.id} className="flex items-center gap-2"><strong className="text-sm">{s.code}</strong>{rights.manage&&<button className="pm-button pm-button-quiet" disabled={busy} onClick={()=>void bringBackServer(s.id)}><RotateCcw size={14}/>Khôi phục</button>}</span>)}</div>}
        {hasSelection&&<div className="vm-bulkbar" role="status"><strong>Đã chọn {selectedRows.length} VM</strong>{offPage>0&&<span className="pm-muted text-xs">({offPage} không ở trang này)</span>}
          {paged.rows.length>0&&paged.rows.every(v=>selected.has(v.id))&&selectedInFilter<filtered.length&&<button className="pm-link text-sm" onClick={()=>setSelected(new Set(filtered.map(v=>v.id)))}>Chọn tất cả {filtered.length} kết quả đang lọc</button>}
          <span className="vm-bulkbar-actions">{deletedView?(rights.manage&&<button className="pm-button" disabled={busy} onClick={()=>void restore(selectedRows.map(v=>v.id))}><RotateCcw size={15}/>Khôi phục</button>):<>
            {rights.copy&&<DropdownMenu><DropdownMenuTrigger asChild><button className="pm-button"><Copy size={15}/>Copy proxy</button></DropdownMenuTrigger><DropdownMenuContent className="vm-menu"><DropdownMenuItem onSelect={()=>void copyList(selectedRows,'DESIRED')}>Copy proxy được giao</DropdownMenuItem><DropdownMenuItem onSelect={()=>void copyList(selectedRows,'INSTALLED')}>Copy proxy đã cài</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
            {rights.assign&&<span className="vm-bulk-ops"><select aria-label="Tình trạng cho các VM đã chọn" className="pm-input w-auto" value={bulkOps} onChange={e=>setBulkOps(e.target.value as VmOpsStatus)}><option value="">Tình trạng…</option>{VM_OPS_STATUSES.map(st=><option key={st} value={st}>{VM_OPS[st].label}</option>)}</select><button className="pm-button" disabled={!bulkOps||setOps.isLoading} onClick={()=>void applyBulkOps()}>{setOps.isLoading?'Đang lưu…':'Áp dụng'}</button></span>}
            {rights.assign&&<button className={'pm-button'+(bulk==='assign'?' pm-button-primary':'')} onClick={()=>openBulk('assign')}>Gán proxy</button>}
            {rights.assign&&<button className={'pm-button'+(bulk==='account'?' pm-button-primary':'')} onClick={()=>openBulk('account')}>Gán tài khoản</button>}
            {rights.manage&&<button className={'pm-button'+(bulk==='note'?' pm-button-primary':'')} onClick={()=>openBulk('note')}>Sửa ghi chú</button>}
            {rights.manage&&<button className="pm-button" disabled={busy} onClick={()=>void remove(selectedRows.map(v=>v.id))}><Trash2 size={15}/>Xoá</button>}</>}
            <button className="pm-button pm-button-quiet" onClick={()=>setSelected(new Set())}><X size={15}/>Bỏ chọn</button></span></div>}
        {bulkOpsErrors.length>0&&<div className="pm-blocked" role="alert"><div className="flex justify-between gap-2"><strong className="text-sm">{bulkOpsErrors.length} VM chưa đổi tình trạng</strong><button className="pm-icon-button" aria-label="Đóng danh sách lỗi tình trạng" onClick={()=>setBulkOpsErrors([])}><X size={15}/></button></div><ul className="text-sm mt-2 space-y-1 max-h-28 overflow-y-auto">{bulkOpsErrors.map((b,i)=><li key={i}><strong className="pm-code">{b.vm}</strong> — {b.message}</li>)}</ul></div>}
        {blocked.length>0&&<div className="pm-blocked" role="alert"><div className="flex justify-between gap-2"><strong className="text-sm">{blocked.length} VM chưa xử lý được</strong><button className="pm-icon-button" aria-label="Đóng danh sách bị chặn" onClick={()=>setBlocked([])}><X size={15}/></button></div><ul className="text-sm mt-2 space-y-1 max-h-28 overflow-y-auto">{blocked.map(b=><li key={b.id}><strong className="pm-code">{b.code}</strong> — {b.reason} · <button className="pm-link" onClick={()=>openVm(b.id,CAUSE_TAB[b.cause||'']||'overview',b.cause||null)}>Mở VM</button></li>)}</ul></div>}
        {pager('top')}
        <div ref={gridHost}><VmGrid projectId={projectId} rows={paged.rows} single={single} deletedView={deletedView} prefs={prefs} onPrefs={savePrefs} rights={rights} selected={selected} onToggle={toggle} onTogglePage={togglePage} accountOf={id=>accountOfVm.get(id)} activeVmId={url.vm} maxHeight={maxHeight} loading={workspace.isLoading||(accountView&&accounts.isLoading)}
          emptyText={deletedView?'Không có máy đã xoá.':servers.length?'Không có VM trong bộ lọc này.':'Thêm server và VM để bắt đầu.'} onOpen={(id,tab)=>openVm(id,tab)} onCopy={(vm,which)=>void copyList([vm],which)} onCopyToInstall={vm=>void copyToInstall(vm)} onDelete={vm=>void remove([vm.id])} onRestore={vm=>void restore([vm.id])} onSave={saveCell} onStatus={statusAction}
          opsOf={id=>opsOfVm.get(id)} opsRights={opsRights} onOpsStatus={setOpsStatus} onOpsDone={()=>Promise.all([board.refetch(),refresh()])}/></div>
        {pager('bottom')}
      </div>
      {panelOpen&&<div className="vm-panel-host" style={{maxHeight:maxHeight+110}}>
        {bulk?<aside className="vm-panel" aria-label="Thao tác hàng loạt"><div className="vm-panel-head"><h2>{bulk==='paste'?'Dán bảng':bulk==='assign'?`Gán proxy · ${selectedRows.length} VM`:bulk==='account'?`Gán tài khoản · ${selectedRows.length} VM`:bulk==='note'?`Sửa ghi chú · ${selectedRows.length} VM`:'Copy thủ công'}</h2><button className="pm-icon-button" aria-label="Đóng khung" onClick={closePanel}><X size={16}/></button></div><div className="vm-panel-body">
          {bulk==='paste'&&<PasteTablePanel projectId={projectId} servers={servers.map(s=>({id:s.id,code:s.code}))} serverId={serverId} onSaved={()=>void refresh()}/>}
          {bulk==='assign'&&<AssignProxyPanel projectId={projectId} vms={selectedRows} sourceConnected={rights.sourceConnected} onSaved={()=>void refresh()}/>}
          {bulk==='account'&&<AccountBulkPanel projectId={projectId} vms={selectedRows} onSaved={()=>void refresh()}/>}
          {bulk==='note'&&<NotesPanel projectId={projectId} vms={selectedRows} onSaved={()=>void refresh()}/>}
          {bulk==='copy'&&manualCopy&&<label className="pm-label">Chọn và copy (Ctrl+C)<textarea className="pm-input font-mono" rows={8} readOnly value={manualCopy} onFocus={e=>e.target.select()}/></label>}
        </div></aside>:panelVm&&<VmSidePanel key={panelVm.id} projectId={projectId} vm={panelVm} tab={url.tab} cause={url.cause} rights={rights} account={accountOfVm.get(panelVm.id)} onTab={t=>go({tab:t},'replace')} onClose={closePanel} onSaved={()=>void refresh()} onCopy={(vm,which)=>void copyList([vm],which)}/>}
      </div>}
    </div>
    {form==='ADD'&&<AddVmDialog projectId={projectId} servers={servers.map(s=>({id:s.id,code:s.code}))} serverId={serverId} known={allVMs.map(v=>({serverId:v.serverId,code:v.code,archivedAt:v.archivedAt}))} onClose={()=>setForm(null)} onSaved={()=>void refresh()}/>}
    {form==='CREATE'&&<CreateServerDialog projectId={projectId} onClose={()=>setForm(null)} onSaved={id=>{void refresh();router.push(`/infrastructure/servers/${id}`);}}/>}
  </div>;
}
