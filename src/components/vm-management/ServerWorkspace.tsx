"use client";
import {MONEY_FILTER_LABEL,moneyFlags,moneySortKey,moneySummary,type MoneyRow} from '@/lib/vm-ops';
import {formatLedger as fmtLedger,formatUsd} from '@/lib/money-input';
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {usePathname,useRouter,useSearchParams} from 'next/navigation';
import {useSession} from 'next-auth/react';
import {Plus,RefreshCw,Search,ClipboardPaste,Trash2,RotateCcw,X,MoreHorizontal,Copy,Boxes} from 'lucide-react';
import toast from 'react-hot-toast';
import {trpc} from '@/lib/trpc';
import {compareCodes} from '@/server/proxy-management/package-terms';
import {displayNote} from '@/server/vm-management/vm-codes';
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger} from '@/components/ui/dropdown-menu';
import {copyWhenReady} from '@/components/proxy-management/clipboard';
import {links} from '@/lib/links';
import {InlineText} from './InlineText';
import {AddVmDialog,CreateServerDialog} from './VmForms';
import {useVMRefresh,errorMessage,type ManagedVM} from './shared';
import {vmView} from './workflow';
import {VmGrid,type CopyWhich,type GridRights} from './vm-grid/VmGrid';
import {proxyCellInfo} from './vm-grid/ProxyCell';
import {VmSidePanel} from './vm-grid/VmSidePanel';
import {SdkStorePanel} from './vm-grid/SdkStore';
import {PasteTablePanel,AssignProxyPanel,NotesPanel} from './vm-grid/BulkPanels';
import {AccountBulkPanel} from './vm-grid/AccountPanels';
import {PayoutBulkPanel} from './vm-grid/PayoutBulkPanel';
import {MergePayoutPanel} from './vm-grid/MergePayoutPanel';
import type {VmAccount} from './vm-grid/AccountCell';
import {ServerPicker,ColumnMenu,Pager} from './vm-grid/GridControls';
import {vmMoneySortKey,vmMoneyState,vmMoneySummary} from '@/lib/vm-money';
import {compareVmColumn,SDK_STORE_DEFAULT,type SdkStoreUrl,DEFAULT_PREFS,OPS_FILTERS,normalizePrefs,pageOf,prefsKey,readGridUrl,writeGridUrl,type EditField,type GridPrefs,type GridSort,type GridUrl,type GridView,type MoneyFilter,type OpsFilter,type PanelTab} from './vm-grid/grid-model';
import type {OpsRow} from './vm-grid/OpsCells';
import {applyFilters,countWith,serverDistribution,vmIdLines,VIEW_LABEL,type GridFilters,type ServerDistribution,type VmFacts} from './vm-grid/filter-model';
import {selectionKey,useSessionSelection} from '@/lib/session-selection';
import {VM_OPS,VM_OPS_STATUSES,NO_STATUS_LABEL,MILESTONE_LABEL,opsPriority,type Milestone,type VmOpsStatus} from '@/lib/vm-ops';
type Blocked={id:string;code:string;reason:string;cause?:string};
type BulkPanel='paste'|'assign'|'account'|'note'|'copy'|'payout'|'merge'|null;
const CAUSE_TAB:Record<string,PanelTab>={HOLD:'proxy',TASK:'overview',INSTALLED:'proxy',SDK:'overview',SERVER:'overview'};
const STATUS_ORDER={BLOCKED:0,REVIEW:1,MISSING:2,ASSIGNED:3,ARCHIVED:4} as const;
// Server/VM operations table. One scroll area under a fixed header (server picker, counts, search, bulk bar); sticky identity and
// action columns; side panel instead of stacked dialogs; everything the user picked lives in the URL. See docs/runbooks/server-vm-table.md.
export function ServerWorkspace({projectId,serverId}:{projectId:string;serverId?:string}){
  // Live (22/10/2026): the AI writes through the API while the page is open, so the rows refresh on their own (every 30 s while the tab
  // is visible, and on focus); filters, page, selection and drafts live in the URL / component state and are untouched.
  const live={refetchInterval:30000,refetchIntervalInBackground:false,refetchOnWindowFocus:true} as const;
  const workspace=trpc.vmManagement.workspace.useQuery({projectId},live),access=trpc.vmManagement.access.useQuery({projectId}),business=trpc.businessManagement.access.useQuery({projectId}),accounts=trpc.accountStore.vmAccounts.useQuery({projectId},{retry:false,...live}),board=trpc.vmOps.board.useQuery({projectId},{retry:false,...live}),setOps=trpc.vmOps.setStatus.useMutation();
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
  const [blocked,setBlocked]=useState<Blocked[]>([]),[bulk,setBulk]=useState<BulkPanel>(null),[form,setForm]=useState<'CREATE'|'ADD'|null>(null),[manualCopy,setManualCopy]=useState<string|null>(null);
  const [payoutBusy,setPayoutBusy]=useState(false);
  // A selection never survives a change of project, server, filter or search; page and sort keep it (ids, not positions). It is kept
  // in the tab's session (src/lib/session-selection.ts), so leaving the page (Thiết lập, another menu) and coming Back to the same
  // scope ticks the same rows again, minus rows no longer in it.
  const scopeKey=projectId+'|'+(serverId||'')+'|'+url.view+'|'+url.q+'|'+url.st.join(',')+'|'+url.money+'|'+url.warn,firstScope=useRef(scopeKey);
  const [selected,setSelected,restoreSelection]=useSessionSelection(session.status==='authenticated'?selectionKey('vm',userId,projectId):null,scopeKey);
  useEffect(()=>{if(firstScope.current===scopeKey) return;firstScope.current=scopeKey;setSelected(new Set());setBlocked([]);setBulk(b=>b==='paste'?b:null);},[scopeKey,setSelected]);
  const allServers=useMemo(()=>[...(workspace.data?.servers||[])].sort((a,b)=>compareCodes(a.code,b.code)),[workspace.data]),servers=allServers.filter(s=>!s.archivedAt),current=allServers.find(s=>s.id===serverId),single=!!current;
  const allVMs=useMemo(()=>workspace.data?.vms||[],[workspace.data]),deletedView=url.view==='DELETED';
  // EarnApp account (login + PayPal) of each VM; the search also finds VMs by login email or PayPal code.
  const accountOfVm=useMemo(()=>new Map<string,VmAccount>((accounts.data||[]).map(a=>[a.vmId,a])),[accounts.data]),accountText=(id:string)=>{const a=accountOfVm.get(id);return a?[a.earnApp?.login.email,a.earnApp?.paypal?.code,a.earnApp?.paypal?.email,a.legacyGmail].filter(Boolean).join(' '):'';};
  // Account gaps overlap: a VM without an EarnApp account has no PayPal either. Counted only once the links are loaded.
  const accountView=url.view==='ACCOUNT_MISSING'||url.view==='ACCOUNT_PRESENT'||url.view==='PAYPAL_MISSING',accountsReady=!!accounts.data;
  const TODO:(VmOpsStatus|null)[]=['NEW_VM','PROXY_PENDING','PROXY_BLOCKED','EARN_ERROR'];
  // Operating state (recorded by people / AI) and the money milestone of the current round (from the PayPal book).
  const opsOfVm=useMemo(()=>new Map<string,OpsRow>((board.data?.vms||[]).map(o=>[o.vmId,o])),[board.data]);
  const opsStatus=(v:ManagedVM)=>(opsOfVm.get(v.id)?.status??v.ops??null) as VmOpsStatus|null,milestone=(v:ManagedVM)=>(opsOfVm.get(v.id)?.milestone||'') as Milestone;
  const todo=(v:ManagedVM)=>v.applyPending||vmView(v)==='BLOCKED'||TODO.includes(opsStatus(v));
  const proxyBlocked=(v:ManagedVM)=>vmView(v)==='BLOCKED';
  const opsKey=(v:ManagedVM):OpsFilter=>opsStatus(v)??'NONE';
  // Money at the VM (20/10/2026): balance read on EarnApp + payout request; filters and sorts run over the whole result before paging.
  const moneyRow=(v:ManagedVM):MoneyRow=>{const o=opsOfVm.get(v.id),r=o?.request;return {hasEarnApp:!!o?.earnAppId,balance:o?.balance??{latest:null,lastOk:null},request:r?{submission:r.submission,state:r.state,phase:r.phase,requestedAt:r.requestedAt,submittedAt:r.submittedAt,money:r.money?{remaining:r.money.remaining,currency:r.money.currency}:null}:null};};
  // Tiền VM (22/10/2026): the current SDK code's money of each row; Chưa kiểm tra / Số cũ / Kiểm tra lỗi, the money sorts and the
  // total are about it (the EarnApp balance and the payout stay in the frame and the other chips).
  const vmMoneyOf=(v:ManagedVM)=>{const c=v.sdks.find(s=>s.current);return vmMoneyState(c?{code:c.code,amount:c.amount,observedAt:c.amountObservedAt,failedAt:c.amountFailedAt,moneyHidden:c.moneyHidden,stored:c.stored}:null);};
  const sortableMoney=(v:ManagedVM)=>{const m=vmMoneyOf(v);return 'amount' in m&&m.amount!==null?Number(m.amount):null;};
  const priority=(v:ManagedVM)=>opsPriority({status:opsStatus(v),proxyBlocked:proxyBlocked(v),milestone:milestone(v)});
  const unusedSdk=(v:ManagedVM)=>v.sdks.filter(s=>s.state!=='LINKED').length;
  // One set of facts per VM (owner brief 23/10/2026): the table, every count chip, "Phân bố theo server" and "Copy danh sách VM"
  // read the same rule (vm-grid/filter-model.ts). Facts that need the accounts / board answer null until those are loaded.
  const facts=useMemo<VmFacts[]>(()=>allVMs.map(v=>{const m=vmMoneyOf(v),srv=allServers.find(s=>s.id===v.serverId);
    return {id:v.id,serverId:v.serverId,server:v.server,code:v.code,archived:!!v.archivedAt,serverArchived:!srv||!!srv.archivedAt,view:vmView(v),applyPending:!!v.applyPending,todo:todo(v),noSdk:!v.sdks.length&&!v.sdk,
      hasAccount:accountsReady?!!accountOfVm.get(v.id)?.earnApp:null,hasPaypal:accountsReady?!!accountOfVm.get(v.id)?.earnApp?.paypal:null,opsKey:opsKey(v),milestone:board.data?milestone(v):null,moneyFlags:board.data?moneyFlags(moneyRow(v)):null,
      vmMoney:m.kind==='FAILED'?(m.stale?'FAILED_STALE':'FAILED'):m.kind,text:`${v.server} ${v.code} ${displayNote(v.notes)||''} ${v.desired?.ip||''} ${v.installed?.ip||''} ${v.sdks.map(x=>x.code).join(' ')} ${accountText(v.id)}`.toLowerCase()};}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allVMs,allServers,accountOfVm,accountsReady,opsOfVm,board.data]);
  const filters:GridFilters={serverId:serverId||null,view:url.view,st:url.st,money:url.money,warn:url.warn,q:url.q};
  const vmOf=useMemo(()=>new Map(allVMs.map(v=>[v.id,v])),[allVMs]),factOf=useMemo(()=>new Map(facts.map(f=>[f.id,f])),[facts]);
  const active=useMemo(()=>allVMs.filter(v=>{const f=factOf.get(v.id);return !!f&&!f.archived&&!f.serverArchived&&(!serverId||f.serverId===serverId);}),[allVMs,factOf,serverId]),deleted=useMemo(()=>allVMs.filter(v=>{const f=factOf.get(v.id);return !!f&&f.archived&&(!serverId||f.serverId===serverId);}),[allVMs,factOf,serverId]);
  // Count next to a choice: the other groups as they are, the choice's own group replaced (null = a needed dataset not loaded yet).
  const n=(patch:Partial<GridFilters>)=>countWith(facts,filters,patch);
  // "Phân bố theo server": every condition except the server; "Kết quả đang xem" (filtered): with the server, before paging.
  const distribution:ServerDistribution|null=useMemo(()=>serverDistribution(facts,filters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facts,serverId,url.view,url.st,url.money,url.warn,url.q]);
  const filtered=useMemo(()=>applyFilters(facts,filters).map(f=>vmOf.get(f.id)!)
    .sort((a,b)=>((url.sort==='BALANCE'||url.sort==='BALANCE_ASC')?compareVmColumn(sortableMoney(a),sortableMoney(b),url.sort==='BALANCE'):url.sort==='OPS_ASC'||url.sort==='OPS_DESC'?compareVmColumn(opsStatus(a)?VM_OPS[opsStatus(a)!].label:null,opsStatus(b)?VM_OPS[opsStatus(b)!].label:null,url.sort==='OPS_DESC'):url.sort==='ACCOUNT_ASC'||url.sort==='ACCOUNT_DESC'?compareVmColumn(accountOfVm.get(a.id)?.earnApp?.login.email??null,accountOfVm.get(b.id)?.earnApp?.login.email??null,url.sort==='ACCOUNT_DESC'):(url.sort==='CHECKED_OLD')?vmMoneySortKey(url.sort,vmMoneyOf(a))-vmMoneySortKey(url.sort,vmMoneyOf(b)):url.sort==='WAITING_OLD'?moneySortKey(url.sort,moneyRow(a))-moneySortKey(url.sort,moneyRow(b)):url.sort==='PRIORITY'?priority(a)-priority(b):url.sort==='SDK'?unusedSdk(a)-unusedSdk(b):url.sort==='PROXY'?Number(vmView(a)!=='MISSING')-Number(vmView(b)!=='MISSING'):url.sort==='STATUS'?STATUS_ORDER[vmView(a)]-STATUS_ORDER[vmView(b)]:0)||compareCodes(a.server,b.server)||compareCodes(a.code,b.code)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [facts,vmOf,serverId,url.view,url.sort,url.st,url.money,url.warn,url.q,opsOfVm]);
  // Back on the page: tick the saved rows again once the whole result is known (VMs, accounts and statuses loaded), so a row still in
  // the list is never dropped for being late; deleted or filtered-out rows are not restored.
  const restoreReady=!!workspace.data&&(!!accounts.data||accounts.isError)&&(!!board.data||board.isError);
  const validIds=useMemo(()=>restoreReady?new Set(filtered.map(v=>v.id)):null,[restoreReady,filtered]);
  useEffect(()=>{restoreSelection(validIds);},[validIds,restoreSelection]);
  // The selection is a set of ids: a row that leaves the filter after an action (Thiếu proxy → Có proxy) stays selected and stays in
  // the open bulk panel. Bulk actions take the selected rows in table order.
  const selectedRows=useMemo(()=>[...(deletedView?deleted:active)].filter(v=>selected.has(v.id)).sort((a,b)=>compareCodes(a.server,b.server)||compareCodes(a.code,b.code)),[deletedView,deleted,active,selected]);
  const paged=pageOf(filtered,url.page,url.size),onPage=new Set(paged.rows.map(v=>v.id)),offPage=selectedRows.filter(v=>!onPage.has(v.id)).length,selectedInFilter=filtered.filter(v=>selected.has(v.id)).length;
  const rights:GridRights={manage:!!access.data?.canManage,assign:!!access.data?.canAssign,accountAssign:!!access.data?.canAssignAccounts,sdkMoneyRead:!!access.data?.sdkMoneyRead,sdkMoneyWrite:!!access.data?.sdkMoneyWrite,copy:!!access.data?.canCopy,confirm:!!access.data?.canConfirm,costs:!!business.data?.costs,sourceConnected:!!access.data?.sourceConnected,block:!!access.data?.canBlock,replace:!!access.data?.canReplace};
  const panelVm=url.vm?allVMs.find(v=>v.id===url.vm):undefined;
  // Keep room for seven actual rows, even when the filters leave less viewport space.
  // Measure wrapped cells instead of shrinking text or assuming every row is 44 px tall.
  const gridHost=useRef<HTMLDivElement>(null),[maxHeight,setMaxHeight]=useState(480),hasSelection=selected.size>0;
  useLayoutEffect(()=>{
    const el=gridHost.current;if(!el)return;
    const fit=()=>{
      const rows=Array.from(el.querySelectorAll<HTMLTableRowElement>('tr[data-row]')).slice(0,7);
      const rowSpace=rows.reduce((sum,row)=>sum+row.getBoundingClientRect().height,0)+(7-rows.length)*44;
      const header=el.querySelector('thead')?.getBoundingClientRect().height||34;
      const minimum=Math.ceil(header+rowSpace+18); // Includes the horizontal scrollbar.
      const top=el.getBoundingClientRect().top+window.scrollY;
      setMaxHeight(Math.max(minimum,Math.floor(window.innerHeight-top-84)));
    };
    fit();const observer=new ResizeObserver(fit);observer.observe(el);
    window.addEventListener('resize',fit);
    return ()=>{observer.disconnect();window.removeEventListener('resize',fit);};
  },[hasSelection,blocked.length,deletedView,workspace.isLoading,single,access.data?.sourceConnected]);
  // Reload with ?vm=…: bring that row into view once.
  const scrolled=useRef(false);useEffect(()=>{if(scrolled.current||!url.vm||!workspace.data) return;scrolled.current=true;requestAnimationFrame(()=>document.querySelector(`[data-row="${url.vm}"]`)?.scrollIntoView({block:'center'}));},[url.vm,workspace.data]);
  const openVm=(vmId:string,tab:PanelTab='overview',cause:string|null=null)=>{setBulk(null);go({vm:vmId,tab,cause});};
  // Kho SDK opens in this page (no sidebar entry): the table stays mounted underneath so its scroll position survives.
  const sdkUrl=url.sdk||SDK_STORE_DEFAULT,storeOpen=sdkUrl.open;
  const goStore=useCallback((patch:Partial<SdkStoreUrl>,mode:'push'|'replace'='push')=>{const base=(pending.current||readGridUrl(new URLSearchParams(window.location.search))).sdk||SDK_STORE_DEFAULT;go({sdk:{...base,...patch}},mode);},[go]);
  const closePanel=useCallback(()=>{if(payoutBusy)return;const id=new URLSearchParams(window.location.search).get('vm');setBulk(null);if(id){go({vm:null,tab:'overview',cause:null});requestAnimationFrame(()=>document.querySelector<HTMLElement>(`[data-row="${id}"] .vm-id-button`)?.focus({preventScroll:true}));}},[go,payoutBusy]);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&(url.vm||bulk)&&!(e.target as HTMLElement)?.closest?.('.vm-cell-edit,.vm-popover,.vm-status-pop,[role="menu"],.pm-inline-edit,textarea,input,select')) closePanel();};window.addEventListener('keydown',key);return ()=>window.removeEventListener('keydown',key);},[url.vm,bulk,closePanel]);
  const copyProxies=trpc.vmManagement.copyProxies.useMutation(),copyBlocked=trpc.proxyManagement.copyBlockedEndpoints.useMutation(),updateServer=trpc.vmManagement.updateServer.useMutation(),updateVM=trpc.vmManagement.updateVM.useMutation();
  const deleteVMs=trpc.vmManagement.deleteVMs.useMutation(),restoreVMs=trpc.vmManagement.restoreVMs.useMutation(),deleteServer=trpc.vmManagement.deleteServer.useMutation(),restoreServer=trpc.vmManagement.restoreServer.useMutation(),undo=trpc.proxyManagement.undo.useMutation();
  const busy=deleteVMs.isLoading||restoreVMs.isLoading||deleteServer.isLoading||restoreServer.isLoading;
  function undoToast(text:string,operationId?:string){toast.success(t=><span className="flex items-center gap-3">{text}{operationId&&<button className="pm-button pm-button-quiet" onClick={()=>{toast.dismiss(t.id);undo.mutateAsync({projectId,id:operationId,reason:''}).then(()=>{toast.success('Đã hoàn tác');void refresh();}).catch(e=>toast.error(e.message));}}>Hoàn tác</button>}</span>,{duration:8000});}
  // Plain copy: never starts the install. Rows are copied in table order; skipped rows are counted with their reason.
  async function copyList(vms:ManagedVM[],which:CopyWhich){
    if(!vms.length) return;let skipped:{vm:string;reason:string}[]=[],copied=0;
    const out=await copyWhenReady(async()=>{const r=await copyProxies.mutateAsync({projectId,vmIds:vms.map(v=>v.id),which});skipped=r.skipped.map(s=>({vm:s.vm,reason:s.reason}));copied=r.items.length;if(!r.items.length) throw new Error(r.skipped[0]?.reason||'Không có proxy để copy');return r.items.map(i=>i.proxy).join('\n');});
    const label=which==='DESIRED'?'đang dùng':'cũ';
    if(out.ok) toast.success(vms.length===1?`Đã copy proxy ${label} · ${vms[0].code}`:`Đã copy ${copied} proxy ${label}`+(skipped.length?` · bỏ qua ${skipped.length} (${skipped[0].reason})`:''),{duration:5000});
    else if(out.text){setManualCopy(out.text);setBulk('copy');toast('Trình duyệt chặn copy; chọn và copy trong khung bên phải.');}
    else toast.error(out.error||'Chưa copy được');
  }
  // "Copy proxy Blocked (N)" (19/10/2026): the selected rows, or the whole filtered result on every page (never the whole project
  // silently); the current BLOCKED proxy of each VM once, in table order, full IP:port:user:pass only. Copy only copies.
  const blockedIds=(vms:ManagedVM[])=>Array.from(new Set(vms.flatMap(v=>{const c=proxyCellInfo(v).current;return c&&c.state==='BLOCKED'&&c.endpointId?[c.endpointId]:[];})));
  const blockedIn=(vms:ManagedVM[])=>blockedIds(vms).length;
  async function copyBlockedOf(vms:ManagedVM[]){
    const ids=blockedIds(vms);
    if(!ids.length){toast('Không có proxy Blocked trong '+(selected.size?'các dòng đã chọn':'bộ lọc này'));return;}
    let note='',count=0;
    const out=await copyWhenReady(async()=>{const r=await copyBlocked.mutateAsync({projectId,endpointIds:ids});if(r.skipped.length)note=' · bỏ qua '+r.skipped.map(x=>x.count+' ('+(x.reason==='NO_CREDENTIALS'?'thiếu user/pass':'không còn proxy')+')').join(', ');if(!r.proxies.length)throw new Error('Không có proxy Blocked đủ IP:port:user:pass'+note);count=r.proxies.length;return r.proxies.join('\n');});
    if(out.ok)toast.success('Đã copy '+count+' proxy Blocked'+note,{duration:5000});
    else if(out.text){setManualCopy(out.text);setBulk('copy');toast('Trình duyệt chặn copy; chọn và copy trong khung bên phải.');}
    else toast.error(out.error||'Chưa copy được');
  }
  // "Copy danh sách VM" (23/10/2026): identities only (Server | VM), the selected rows or the whole filtered result on every page.
  async function copyIds(vms:ManagedVM[]){
    if(!vms.length)return;const text=vmIdLines(vms),out=await copyWhenReady(async()=>text);
    if(out.ok)toast.success('Đã copy '+vms.length+' VM (Server | VM)',{duration:4000});
    else if(out.text){setManualCopy(out.text);setBulk('copy');toast('Trình duyệt chặn copy; chọn và copy trong khung bên phải.');}
    else toast.error(out.error||'Chưa copy được');
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
    if(held.length){setBlocked(held.map(v=>({id:v.id,code:v.code,cause:'HOLD',reason:'Còn proxy '+v.holds.map(h=>h.ip+' · '+(h.role==='UNCERTAIN'?'Giữ để kiểm tra':'đang dùng')).join(', ')+'; bỏ gán trước'})));toast.error(held.length+' VM còn giữ proxy; chưa xoá được server',{duration:7000});return;}
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
    if(field==='sdk') return; // the SDK has its own frame (SdkCell → vmManagement.sdkSave)
    {const r=await updateVM.mutateAsync({projectId,vmId:vm.id,...(field==='code'?{code:value}:{notes:value||null}),expectedRevision:vm.revision});if(!r.saved){await refresh();return;}}
    toast.success('Đã lưu '+vm.code,{duration:1500});await refresh();
  }
  // Tình trạng cell actions. Each one is the existing checked command; errors propagate so the cell keeps the old state and shows why.
  // Tình trạng: one command for the cell and for bulk; same value = nothing written; old-round commands are refused by the server.
  const opsRights={assign:rights.assign,money:!!board.data?.rights.money,writeMoney:!!board.data?.rights.writeMoney,payout:!!board.data?.rights.payout,receipt:!!board.data?.rights.receipt,balanceRead:!!board.data?.rights.balanceRead,balanceWrite:!!board.data?.rights.balanceWrite};
  const summary=board.data?moneySummary(filtered.map(moneyRow)):null,vmSummary=workspace.data?vmMoneySummary(filtered.map(vmMoneyOf)):null;
  async function setOpsStatus(vm:ManagedVM,status:VmOpsStatus,cycle:number){
    const r=await setOps.mutateAsync({projectId,key:crypto.randomUUID(),items:[{vmId:vm.id,status,expectedCycle:cycle}]}),row=r.rows[0];
    if(row?.outcome==='ERROR')throw new Error(row.message);
    if(row?.outcome==='APPLIED')toast.success(vm.code+': '+row.message,{duration:1500});await board.refetch();
  }
  const [bulkOps,setBulkOps]=useState<VmOpsStatus|''>(''),[bulkOpsErrors,setBulkOpsErrors]=useState<{vm:string;message:string}[]>([]);
  // N on the button = selected VMs whose recorded status really changes (picking the status they already have counts 0).
  const opsChanges=bulkOps?selectedRows.filter(v=>opsStatus(v)!==bulkOps).length:0;
  async function applyBulkOps(){
    if(!bulkOps||!opsChanges)return;
    try{const r=await setOps.mutateAsync({projectId,key:crypto.randomUUID(),items:selectedRows.map(v=>({vmId:v.id,status:bulkOps,expectedCycle:opsOfVm.get(v.id)?.cycle??v.cycle}))});
      setBulkOpsErrors(r.rows.filter(x=>x.outcome==='ERROR').map(x=>({vm:x.where,message:x.message})));
      toast.success(`${VM_OPS[bulkOps].label}: ${r.applied} VM`+(r.skipped?` · ${r.skipped} giữ nguyên`:'')+(r.errors?` · ${r.errors} lỗi`:''),{duration:4000});await board.refetch();}
    catch(e){toast.error(errorMessage(e));}
  }
  const toggle=(id:string,on:boolean)=>setSelected(prev=>{const n=new Set(prev);if(on)n.add(id);else n.delete(id);return n;});
  const togglePage=(on:boolean)=>setSelected(prev=>{const n=new Set(prev);paged.rows.forEach(v=>{if(on)n.add(v.id);else n.delete(v.id);});return n;});
  // Bulk bar buttons always open their panel; only the header "Dán bảng" button toggles.
  const openBulk=(panel:BulkPanel,toggle=false)=>{if(payoutBusy)return;if(url.vm) go({vm:null,cause:null});setBulk(toggle&&bulk===panel?null:panel);};
  useEffect(()=>{if(!selected.size) setBulk(b=>b==='assign'||b==='account'||b==='note'?null:b);},[selected.size]);
  const chip=(view:GridView,label:string,n:number|null)=><button type="button" className={'vm-chip'+(url.view===view?' active':'')+(n&&['MISSING','BLOCKED','REVIEW','SDK_MISSING','ACCOUNT_MISSING','PAYPAL_MISSING','APPLY','TODO'].includes(view)?' attention':'')} aria-pressed={url.view===view} onClick={()=>go({view:url.view===view&&view?'':view,page:1})}>{label} <strong>{n??'…'}</strong></button>;
  if(workspace.error)return <p role="alert" className="pm-error">{workspace.error.message}</p>;
  if(serverId&&workspace.data&&!current)return <p role="alert" className="pm-error">Server không thuộc dự án này.</p>;
  if(current?.archivedAt)return <div className="proxy-workspace space-y-4"><div className="pm-heading"><div><h1>{current.code}</h1><p className="pm-muted">Server đã xoá. Dữ liệu và lịch sử vẫn được giữ.</p></div>{rights.manage&&<button className="pm-button pm-button-primary" disabled={busy} onClick={()=>void bringBackServer(current.id)}><RotateCcw size={16}/>Khôi phục server</button>}</div><Link className="pm-button pm-button-quiet w-fit" href="/infrastructure/servers">Về danh sách server</Link></div>;
  const pickerServers=servers.map(s=>({id:s.id,code:s.code,ipAddress:s.ipAddress,vms:allVMs.filter(v=>v.serverId===s.id&&!v.archivedAt).length}));
  // Changing server (picker or distribution) keeps search, views, statuses, money filter, sort and page size; back to page 1; closes the open VM.
  const goServer=(id:string)=>router.push((id?`/infrastructure/servers/${id}`:'/infrastructure/servers')+writeGridUrl({...url,page:1,vm:null,cause:null}));
  const pager=(where:'top'|'bottom')=><Pager where={where} first={paged.first} last={paged.last} total={filtered.length} page={paged.current} pages={paged.pages} size={url.size} onPage={p=>go({page:p})} onSize={s=>go({size:s,page:1})}/>;
  const panelOpen=!!panelVm||!!bulk;
  return <div className="proxy-workspace vm-workspace">
    <div className="vm-head">
      <ServerPicker servers={pickerServers} value={serverId||''} onChange={goServer}/>
      <div className="vm-title min-w-0">{single?<h1><InlineText value={current!.code} label="tên server" canEdit={rights.manage} onSave={saveServer('code')}/></h1>:<h1>Server / VM</h1>}
        {single&&<div className="pm-muted text-xs flex gap-3 flex-wrap"><span>IP: <InlineText value={current!.ipAddress} label="IP server" placeholder="chưa có" canEdit={rights.manage} onSave={saveServer('ipAddress')}/></span><span className="min-w-0">Ghi chú: <InlineText value={displayNote(current!.notes)} label="ghi chú server" placeholder="thêm ghi chú" canEdit={rights.manage} onSave={saveServer('notes')}/></span></div>}</div>
      <div className="vm-head-actions">{opsRights.money&&<Link className="pm-button" href={"/earnapp-withdrawals"+(serverId?"?server="+encodeURIComponent(serverId):"")}>Lịch sử rút</Link>}{rights.manage&&servers.length>0&&<button className="pm-button" onClick={()=>setForm('ADD')}><Plus size={16}/>Thêm VM</button>}{(rights.assign||rights.manage)&&<button className={'pm-button'+(bulk==='paste'?' pm-button-primary':'')} onClick={()=>openBulk('paste',true)}><ClipboardPaste size={16}/>Dán bảng</button>}<button className={'pm-button'+(storeOpen?' pm-button-primary':'')} aria-pressed={storeOpen} onClick={()=>goStore({open:!storeOpen})}><Boxes size={16}/>Kho SDK</button><button className="pm-icon-button" aria-label="Tải lại" title="Tải lại" onClick={()=>void refresh()}><RefreshCw size={16}/></button>
        <DropdownMenu><DropdownMenuTrigger asChild><button className="pm-icon-button" aria-label="Quản lý server" title="Quản lý server"><MoreHorizontal size={16}/></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="vm-menu">
          {rights.manage&&<DropdownMenuItem onSelect={()=>setForm('CREATE')}>Thêm server</DropdownMenuItem>}
          <DropdownMenuItem asChild><Link href={links.proxies()}>Kho proxy</Link></DropdownMenuItem>
          {rights.manage&&single&&<><DropdownMenuSeparator/><DropdownMenuItem className="text-red-600" disabled={busy} onSelect={()=>void removeServer()}>Xoá server {current!.code}</DropdownMenuItem></>}
        </DropdownMenuContent></DropdownMenu></div>
    </div>
    {access.data&&!access.data.sourceConnected&&<p className="pm-source-warning">Cần kết nối nguồn Genjy trước khi giao proxy (Kho proxy → Cập nhật).</p>}
    <div className="vm-chips" role="group" aria-label="Lọc nhanh">{chip('','Tất cả',n({view:''}))}{chip('MISSING','Thiếu proxy',n({view:'MISSING'}))}{chip('ASSIGNED','Có proxy',n({view:'ASSIGNED'}))}{chip('BLOCKED','Proxy Blocked',n({view:'BLOCKED'}))}{chip('APPLY','Chờ áp dụng trên máy',n({view:'APPLY'}))}{chip('TODO','Cần xử lý',n({view:'TODO'}))}{chip('REVIEW','Cần kiểm tra',n({view:'REVIEW'}))}{chip('SDK_MISSING','Chưa SDK',n({view:'SDK_MISSING'}))}{chip('ACCOUNT_PRESENT','Có EarnApp',n({view:'ACCOUNT_PRESENT'}))}{chip('ACCOUNT_MISSING','Chưa EarnApp',n({view:'ACCOUNT_MISSING'}))}{chip('PAYPAL_MISSING','Chưa PayPal',n({view:'PAYPAL_MISSING'}))}{chip('DELETED','Đã xoá',n({view:'DELETED'}))}</div>
    <div className="vm-chips vm-chips-ops" role="group" aria-label="Lọc theo tình trạng vận hành"><span className="pm-muted text-xs">Tình trạng:</span>
      {OPS_FILTERS.map(k=>{const on=url.st.includes(k),c=n({st:[k]});if(c===0&&!on)return null;return <button key={k} type="button" className={'vm-chip vm-chip-ops vm-ops-'+(k==='NONE'?'none':VM_OPS[k].tone)+(on?' active':'')} aria-pressed={on} onClick={()=>go({st:on?url.st.filter(x=>x!==k):[...url.st,k],page:1})}>{k==='NONE'?NO_STATUS_LABEL:VM_OPS[k].label} <strong>{c??'…'}</strong></button>;})}
      <span className="pm-muted text-xs ml-2">Tiền:</span>

      {(['UNCHECKED','STALE','VM_FAILED'] as const).map(k=>{if(!rights.sdkMoneyRead)return null;const c=n({money:k}),on=url.money===k;if(!c&&!on)return null;return <button key={k} type="button" className={'vm-chip'+(on?' active':'')+(k==='VM_FAILED'?' attention':'')} aria-pressed={on} onClick={()=>go({money:(on?'':k) as MoneyFilter,page:1})}>{k==='UNCHECKED'?'Chưa kiểm tra':k==='STALE'?'Số cũ':'Kiểm tra lỗi'} <strong>{c??'…'}</strong></button>;})}
      {(['WITHDRAWABLE'] as const).map(k=>{const c=n({money:k}),on=url.money===k;if(!c&&!on)return null;return <button key={k} type="button" className={'vm-chip'+(on?' active':'')} aria-pressed={on} onClick={()=>go({money:(on?'':k) as MoneyFilter,page:1})}>{MONEY_FILTER_LABEL[k]} <strong>{c??'…'}</strong></button>;})}
      {(['WAITING','RECREATE','MONEY_REVIEW','FAILED'] as const).map(k=>{const c=n({money:k}),on=url.money===k;if(!c&&!on)return null;return <button key={k} type="button" className={'vm-chip'+(on?' active':'')+(k==='RECREATE'||k==='MONEY_REVIEW'?' attention':'')} aria-pressed={on} onClick={()=>go({money:(on?'':k) as MoneyFilter,page:1})}>{MILESTONE_LABEL[k]} <strong>{c??'…'}</strong></button>;})}
      {(['RECEIVED','CHECK'] as const).map(k=>{const c=n({money:k}),on=url.money===k;if(!c&&!on)return null;return <button key={k} type="button" className={'vm-chip'+(on?' active':'')+(k==='CHECK'?' attention':'')} aria-pressed={on} onClick={()=>go({money:(on?'':k) as MoneyFilter,page:1})}>{MONEY_FILTER_LABEL[k]} <strong>{c??'…'}</strong></button>;})}
      {(url.st.length>0||url.money||url.warn)&&<button type="button" className="pm-link text-xs" onClick={()=>go({st:[],money:'',warn:false,page:1})}>Bỏ lọc tình trạng</button>}
    </div>
    {summary&&vmSummary&&!deletedView&&filtered.length>0&&<MoneySummaryLine summary={summary} vm={vmSummary} total={filtered.length} balanceRead={!!board.data?.rights.balanceRead} money={!!board.data?.rights.money} sdkMoney={!!access.data?.sdkMoneyRead}/>}
    {board.error&&<p role="alert" className="pm-error">Chưa đọc được tình trạng vận hành: {board.error.message} <button className="pm-link" onClick={()=>void board.refetch()}>Thử lại</button></p>}
    {accountView&&accounts.error&&<p role="alert" className="pm-error">Chưa đọc được tài khoản EarnApp: {accounts.error.message} <button className="pm-link" onClick={()=>void accounts.refetch()}>Thử lại</button></p>}
    {url.vm&&workspace.data&&!panelVm&&<div className="pm-blocked flex flex-wrap gap-2 items-center justify-between" role="alert"><span className="text-sm">VM trong liên kết không còn trong dự án này (đã xoá hẳn hoặc thuộc dự án khác).</span><button className="pm-button pm-button-quiet" onClick={()=>go({vm:null,tab:'overview',cause:null},'replace')}>Đóng, về danh sách</button></div>}
    <div className={'vm-body'+(panelOpen?' with-panel':'')}>
      <div className="pm-surface vm-surface">
        {!storeOpen&&<div className="vm-toolbar"><label className="pm-search vm-search"><Search size={16}/><input aria-label="Tìm VM, proxy, SDK, tài khoản, PayPal hoặc ghi chú" placeholder={single?'Tìm VM, IP, SDK, tài khoản, PP, ghi chú…':'Tìm server, VM, IP, SDK, tài khoản, PP…'} value={q} onChange={e=>setQ(e.target.value)}/>{q&&<button className="vm-cell-icon" aria-label="Xoá ô tìm" onClick={()=>setQ('')}><X size={14}/></button>}</label>
          <select aria-label="Sắp xếp VM" className="pm-input vm-sort" value={url.sort} onChange={e=>go({sort:e.target.value as GridSort})}><option value="VM">{single?'Theo mã VM':'Theo server → mã VM'}</option><option value="PRIORITY">Cần xử lý trước</option><option value="STATUS">Blocked / cần kiểm tra trước</option><option value="PROXY">Thiếu proxy trước</option><option value="SDK">Chưa có SDK trước</option><option value="BALANCE_ASC">Tiền trong VM thấp → cao</option><option value="OPS_ASC">Tình trạng A–Z</option><option value="OPS_DESC">Tình trạng Z–A</option><option value="ACCOUNT_ASC">Tài khoản EarnApp A–Z</option><option value="ACCOUNT_DESC">Tài khoản EarnApp Z–A</option><option value="BALANCE">Tiền trong VM cao → thấp</option><option value="CHECKED_OLD">Tiền trong VM kiểm tra lâu nhất</option><option value="WAITING_OLD">Chờ tiền lâu nhất trước</option></select>
          <ColumnMenu prefs={prefs} onChange={savePrefs}/></div>}
        {!storeOpen&&<ScopeStrip distribution={workspace.data?distribution:null} loading={!workspace.data} viewing={filtered.length} single={current?{id:current.id,code:current.code}:null} filters={filters} onServer={goServer} onPatch={patch=>go({...patch,page:1})} onClear={()=>go({view:'',st:[],money:'',warn:false,q:'',page:1})} blockedCopy={rights.copy&&!deletedView?{label:`Copy proxy BLOCKED (${blockedIn(selected.size?selectedRows:filtered)})`,disabled:!blockedIn(selected.size?selectedRows:filtered),run:()=>void copyBlockedOf(selected.size?selectedRows:filtered)}:undefined} copy={{label:selected.size?`Copy danh sách VM (${selectedRows.length} đã chọn)`:`Copy danh sách VM (${filtered.length} · mọi trang)`,disabled:selected.size?!selectedRows.length:!filtered.length,run:()=>void copyIds(selected.size?selectedRows:filtered)}}/>}
        {deletedView&&!serverId&&allServers.some(s=>s.archivedAt)&&<div className="pm-deleted-servers"><span className="pm-muted text-sm">Server đã xoá:</span>{allServers.filter(s=>s.archivedAt).map(s=><span key={s.id} className="flex items-center gap-2"><strong className="text-sm">{s.code}</strong>{rights.manage&&<button className="pm-button pm-button-quiet" disabled={busy} onClick={()=>void bringBackServer(s.id)}><RotateCcw size={14}/>Khôi phục</button>}</span>)}</div>}
        {hasSelection&&!storeOpen&&<div className="vm-bulkbar" role="status"><strong>Đã chọn {selectedRows.length} VM</strong>{offPage>0&&<span className="pm-muted text-xs">({offPage} không ở trang này)</span>}
          {paged.rows.length>0&&paged.rows.every(v=>selected.has(v.id))&&selectedInFilter<filtered.length&&<button className="pm-link text-sm" onClick={()=>setSelected(new Set(filtered.map(v=>v.id)))}>Chọn tất cả {filtered.length} kết quả đang lọc</button>}
          <span className="vm-bulkbar-actions">{deletedView?(rights.manage&&<button className="pm-button" disabled={busy} onClick={()=>void restore(selectedRows.map(v=>v.id))}><RotateCcw size={15}/>Khôi phục</button>):<>
            {rights.copy&&<DropdownMenu><DropdownMenuTrigger asChild><button className="pm-button"><Copy size={15}/>Copy proxy</button></DropdownMenuTrigger><DropdownMenuContent className="vm-menu"><DropdownMenuItem onSelect={()=>void copyList(selectedRows,'DESIRED')}>Copy proxy đang dùng</DropdownMenuItem><DropdownMenuItem onSelect={()=>void copyBlockedOf(selectedRows)}>Copy proxy Blocked ({blockedIn(selectedRows)})</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
            {rights.assign&&<span className="vm-bulk-ops"><select aria-label="Tình trạng cho các VM đã chọn" className="pm-input w-auto" value={bulkOps} onChange={e=>setBulkOps(e.target.value as VmOpsStatus)}><option value="">Tình trạng…</option>{VM_OPS_STATUSES.map(st=><option key={st} value={st}>{VM_OPS[st].label}</option>)}</select><button className="pm-button pm-button-primary" disabled={!opsChanges||setOps.isLoading} onClick={()=>void applyBulkOps()}>{setOps.isLoading?'Đang lưu…':`Áp dụng ${opsChanges} VM`}</button></span>}
            {rights.assign&&<button className={'pm-button'+(bulk==='assign'?' pm-button-primary':'')} onClick={()=>openBulk('assign')}>Gán proxy</button>}
            {rights.accountAssign&&<button className={'pm-button'+(bulk==='account'?' pm-button-primary':'')} onClick={()=>openBulk('account')}>Gán tài khoản</button>}
            {(opsRights.writeMoney||opsRights.payout||opsRights.receipt)&&<button className={'pm-button'+(bulk==='payout'?' pm-button-primary':'')} disabled={payoutBusy||!board.data||!accounts.data} onClick={()=>openBulk('payout')}>Rút về PayPal</button>}
            {(opsRights.writeMoney||opsRights.payout)&&selectedRows.length>=2&&<button className={'pm-button'+(bulk==='merge'?' pm-button-primary':'')} disabled={payoutBusy||!board.data} onClick={()=>openBulk('merge')}>Rút gộp về PayPal</button>}
            {rights.manage&&<button className={'pm-button'+(bulk==='note'?' pm-button-primary':'')} onClick={()=>openBulk('note')}>Sửa ghi chú</button>}
            {rights.manage&&<button className="pm-button" disabled={busy} onClick={()=>void remove(selectedRows.map(v=>v.id))}><Trash2 size={15}/>Xoá</button>}</>}
            <button className="pm-button pm-button-quiet" onClick={()=>setSelected(new Set())}><X size={15}/>Bỏ chọn</button></span></div>}
        {bulkOpsErrors.length>0&&<div className="pm-blocked" role="alert"><div className="flex justify-between gap-2"><strong className="text-sm">{bulkOpsErrors.length} VM chưa đổi tình trạng</strong><button className="pm-icon-button" aria-label="Đóng danh sách lỗi tình trạng" onClick={()=>setBulkOpsErrors([])}><X size={15}/></button></div><ul className="text-sm mt-2 space-y-1 max-h-28 overflow-y-auto">{bulkOpsErrors.map((b,i)=><li key={i}><strong className="pm-code">{b.vm}</strong> — {b.message}</li>)}</ul></div>}
        {blocked.length>0&&<div className="pm-blocked" role="alert"><div className="flex justify-between gap-2"><strong className="text-sm">{blocked.length} VM chưa xử lý được</strong><button className="pm-icon-button" aria-label="Đóng danh sách bị chặn" onClick={()=>setBlocked([])}><X size={15}/></button></div><ul className="text-sm mt-2 space-y-1 max-h-28 overflow-y-auto">{blocked.map(b=><li key={b.id}><strong className="pm-code">{b.code}</strong> — {b.reason} · <button className="pm-link" onClick={()=>openVm(b.id,CAUSE_TAB[b.cause||'']||'overview',b.cause||null)}>Mở VM</button></li>)}</ul></div>}
        {storeOpen&&<SdkStorePanel projectId={projectId} url={sdkUrl} onUrl={goStore} canEdit={rights.assign} money={{read:!!rights.sdkMoneyRead,write:!!rights.sdkMoneyWrite}} maxHeight={maxHeight+60} onClose={()=>goStore({open:false})} onOpenVm={id=>go({sdk:{...sdkUrl,open:false},vm:id,tab:'overview',cause:null})}/>}
        <div hidden={storeOpen}>{pager('top')}</div>
        <div ref={gridHost} hidden={storeOpen}><VmGrid sort={url.sort} onSort={sort=>go({sort})} projectId={projectId} rows={paged.rows} single={single} deletedView={deletedView} prefs={prefs} onPrefs={savePrefs} rights={rights} selected={selected} onToggle={toggle} onTogglePage={togglePage} accountOf={id=>accountOfVm.get(id)} activeVmId={url.vm} maxHeight={maxHeight} loading={workspace.isLoading||(accountView&&accounts.isLoading)}
          emptyText={deletedView?'Không có máy đã xoá.':servers.length?'Không có VM trong bộ lọc này.':'Thêm server và VM để bắt đầu.'} onOpen={(id,tab)=>openVm(id,tab)} onCopy={(vm,which)=>void copyList([vm],which)} onDelete={vm=>void remove([vm.id])} onRestore={vm=>void restore([vm.id])} onSave={saveCell}
          opsOf={id=>opsOfVm.get(id)} opsRights={opsRights} onOpsStatus={setOpsStatus} onOpsDone={()=>Promise.all([board.refetch(),refresh()])} accountState={accounts.isError?'ERROR':accounts.data?'READY':'LOADING'}/></div>
        <div hidden={storeOpen}>{pager('bottom')}</div>
      </div>
      {panelOpen&&<div className="vm-panel-host" style={{maxHeight:maxHeight+110}}>
        {bulk?<aside className="vm-panel" aria-label="Thao tác hàng loạt"><div className="vm-panel-head"><h2>{bulk==='payout'?`Rút về PayPal · ${selectedRows.length} VM`:bulk==='merge'?`Rút gộp về PayPal · ${selectedRows.length} VM`:bulk==='paste'?'Dán bảng':bulk==='assign'?`Gán proxy · ${selectedRows.length} VM`:bulk==='account'?`Gán tài khoản · ${selectedRows.length} VM`:bulk==='note'?`Sửa ghi chú · ${selectedRows.length} VM`:'Copy thủ công'}</h2><button className="pm-icon-button" aria-label="Đóng khung" disabled={payoutBusy} onClick={closePanel}><X size={16}/></button></div><div className="vm-panel-body">
          {bulk==='payout'&&<PayoutBulkPanel key={projectId+':'+userId} projectId={projectId} userId={userId} vms={selectedRows} opsOf={id=>opsOfVm.get(id)} rights={opsRights} onSaved={()=>Promise.all([board.refetch(),refresh()])} onAssign={rights.accountAssign?()=>openBulk('account'):undefined} onBusy={setPayoutBusy}/>}
          {bulk==='merge'&&<MergePayoutPanel key={projectId+':'+userId+':'+selectedRows.map(v=>v.id).join(',')} projectId={projectId} userId={userId} vms={selectedRows} opsOf={id=>opsOfVm.get(id)} rights={opsRights} onSaved={()=>Promise.all([board.refetch(),refresh()])} onBusy={setPayoutBusy}/>}
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
// Money summary over the filtered result (all pages). Amounts only with the rights; counts of VMs without an account / never checked
// for everyone (owner brief 20/10/2026: no "Chưa có dữ liệu: 0 VM" when no VM has an EarnApp yet). Unknown is never shown as $0.
// Tiền VM first (the checked figures added up, the rest counted apart), then the EarnApp balances and the money waiting for PayPal:
// three different things, never added together.
function MoneySummaryLine({summary:s,vm,total,balanceRead,money,sdkMoney}:{summary:ReturnType<typeof moneySummary>;vm:ReturnType<typeof vmMoneySummary>;total:number;balanceRead:boolean;money:boolean;sdkMoney:boolean}){
  const count=(n:number,label:string)=>n>0&&<span>{label}: <strong>{n}</strong> VM</span>;
  return <p className="vm-money-summary text-xs" role="status" data-testid="money-summary">
    {sdkMoney&&vm.checked>0&&<span>Tổng tiền VM đã kiểm tra: <strong>{formatUsd(vm.total)}</strong> ({vm.checked}/{total} VM)</span>}
    {count(vm.unchecked,'Chưa kiểm tra')}{count(vm.stale,'Số cũ')}{count(vm.failed,'Kiểm tra lỗi')}{count(vm.noTime,'Chưa rõ giờ')}
    {(balanceRead||money)&&s.known>0&&<span>Số dư EarnApp đã ghi: <strong>{s.balances.map(x=>fmtLedger(x.amount,x.currency)).join(' · ')}</strong> ({s.known} VM)</span>}
    {money&&<span>Đang chờ về PP: <strong>{s.waiting.length?s.waiting.map(x=>fmtLedger(x.amount,x.currency)).join(' · '):'$0,00'}</strong></span>}
    {count(s.unassigned,'Chưa gán tài khoản')}
    <span className="pm-muted">Theo bộ lọc, mọi trang; tiền VM, số dư EarnApp và tiền chờ về PP không cộng với nhau.</span>
  </p>;
}

// "Phân bố theo server" + the conditions in force (owner brief 23/10/2026). Two scopes, named apart: the distribution applies every
// condition except the server (so the other servers stay visible), "Đang xem" is the table's own count (with the server). Counts are
// over every page. null = a needed dataset is still loading: "Đang tải…", never 0.
const MONEY_LABEL:Record<Exclude<MoneyFilter,''>,string>={WAITING:MILESTONE_LABEL.WAITING,RECREATE:MILESTONE_LABEL.RECREATE,MONEY_REVIEW:MILESTONE_LABEL.MONEY_REVIEW,FAILED:MILESTONE_LABEL.FAILED,NONE:'Chưa có mốc tiền',UNCHECKED:'Chưa kiểm tra',STALE:'Số cũ',VM_FAILED:'Kiểm tra lỗi',WITHDRAWABLE:MONEY_FILTER_LABEL.WITHDRAWABLE,RECEIVED:MONEY_FILTER_LABEL.RECEIVED,CHECK:MONEY_FILTER_LABEL.CHECK};
const SHOW_SERVERS=8;
function ScopeStrip({distribution:d,loading,viewing,single,filters,onServer,onPatch,onClear,copy,blockedCopy}:{distribution:ServerDistribution|null;loading:boolean;viewing:number;single:{id:string;code:string}|null;filters:GridFilters;onServer:(id:string)=>void;onPatch:(p:Partial<GridUrl>)=>void;onClear:()=>void;copy:{label:string;disabled:boolean;run:()=>void};blockedCopy?:{label:string;disabled:boolean;run:()=>void}}){
  const [more,setMore]=useState(false);
  const tags:{key:string;label:string;patch:Partial<GridUrl>}[]=[];
  if(filters.view)tags.push({key:'view',label:VIEW_LABEL[filters.view],patch:{view:''}});
  for(const k of filters.st)tags.push({key:'st-'+k,label:k==='NONE'?NO_STATUS_LABEL:VM_OPS[k].label,patch:{st:filters.st.filter(x=>x!==k)}});
  if(filters.money)tags.push({key:'money',label:MONEY_LABEL[filters.money],patch:{money:''}});
  if(filters.warn)tags.push({key:'warn',label:'Chỉ proxy Blocked',patch:{warn:false}});
  if(filters.q.trim())tags.push({key:'q',label:'Tìm "'+filters.q.trim()+'"',patch:{q:''}});
  const items=d?(more?d.items:d.items.slice(0,SHOW_SERVERS)):[],hidden=d?d.items.length-items.length:0;
  const noneHere=!!single&&!!d&&viewing===0&&d.total>0;
  return <div className="vm-scope" role="region" aria-label="Phân bố theo server" data-testid="vm-scope">
    <div className="vm-scope-line">
      {!d?<span className="pm-muted">{loading?'Đang tải…':'Đang tải dữ liệu lọc…'}</span>:<>
        <span className="vm-scope-total"><strong>{d.total}</strong> VM phù hợp · <strong>{d.items.length}</strong> server{single&&<span className="pm-muted"> · Đang xem {single.code} · <strong>{viewing}</strong> VM</span>}</span>
        <span className="vm-scope-servers">
          <button type="button" className={'vm-chip vm-chip-sm'+(single?'':' active')} aria-pressed={!single} onClick={()=>onServer('')}>Tất cả</button>
          {items.map(it=><button key={it.serverId} type="button" className={'vm-chip vm-chip-sm'+(single?.id===it.serverId?' active':'')} aria-pressed={single?.id===it.serverId} title={'Xem '+it.code+' với bộ lọc hiện tại'} onClick={()=>onServer(it.serverId)}>{it.code} <strong>{it.count}</strong></button>)}
          {hidden>0&&<button type="button" className="pm-link text-xs" onClick={()=>setMore(true)}>+{hidden} server</button>}{more&&d.items.length>SHOW_SERVERS&&<button type="button" className="pm-link text-xs" onClick={()=>setMore(false)}>Thu gọn</button>}
        </span></>}
      <span className="vm-scope-actions"><button type="button" className="pm-button vm-scope-copy" disabled={copy.disabled} title="Chỉ tên server và mã VM, mỗi VM một dòng" onClick={copy.run}><Copy size={14}/>{copy.label}</button>{blockedCopy&&<button type="button" className="pm-button vm-scope-copy" disabled={blockedCopy.disabled} title="Proxy BLOCKED của các VM đã chọn; nếu chưa chọn thì theo bộ lọc, mọi trang" onClick={blockedCopy.run}><Copy size={14}/>{blockedCopy.label}</button>}</span>
    </div>
    {tags.length>0&&<div className="vm-scope-line vm-scope-tags"><span className="pm-muted">Đang lọc:</span>{tags.map(t=><span key={t.key} className="vm-filter-tag">{t.label}<button type="button" className="vm-cell-icon" aria-label={'Bỏ điều kiện '+t.label} onClick={()=>onPatch(t.patch)}><X size={12}/></button></span>)}<button type="button" className="pm-link text-xs" onClick={onClear}>Xoá bộ lọc</button></div>}
    {noneHere&&<div className="vm-scope-line" role="status"><span>Không còn VM phù hợp ở <strong>{single!.code}</strong>; các server khác còn <strong>{d!.total}</strong> VM.</span><button type="button" className="pm-button pm-button-quiet" onClick={()=>onServer('')}>Về Tất cả server</button></div>}
  </div>;
}
