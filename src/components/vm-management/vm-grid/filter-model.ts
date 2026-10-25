// Pure filter model of the Server/VM grid (owner brief 23/10/2026 "cải thiện lọc và thống kê"): ONE rule decides which VM is in the
// result, and the table, every count chip, the "Phân bố theo server" strip and "Copy danh sách VM" all read it. No React here.
//
// Groups: server (the path) · view (one problem view) · st (operating statuses, OR inside the group) · money (one money filter) ·
// warn (proxy Blocked only) · q (search). AND between groups. A condition whose data is not loaded yet answers null (unknown), never 0.
import {compareCodes} from '@/server/proxy-management/package-terms';
import type {VMView} from '@/server/vm-management/state';
import type {Milestone,MoneyFlag} from '@/lib/vm-ops';
import type {GridView,MoneyFilter,OpsFilter} from './grid-model';
export type VmMoneyKind='UNCHECKED'|'OK'|'STALE'|'FAILED'|'FAILED_STALE'|'NO_TIME'|'HIDDEN';
export interface VmFacts {
  id:string;serverId:string;server:string;code:string;archived:boolean;serverArchived:boolean;
  view:VMView;applyPending:boolean;todo:boolean;noSdk:boolean;
  hasAccount:boolean|null;hasPaypal:boolean|null;            // null = EarnApp accounts not loaded
  opsKey:OpsFilter;milestone:Milestone|null;moneyFlags:Record<MoneyFlag,boolean>|null; // null = operating board not loaded
  vmMoney:VmMoneyKind;                                       // Tiền VM comes with the workspace, so it is always known
  text:string;                                               // lower-cased search text (server, VM, note, IPs, SDK codes, account)
}
export interface GridFilters {serverId:string|null;view:GridView;st:OpsFilter[];money:MoneyFilter;warn:boolean;q:string}
export type FilterGroup='server'|'view'|'st'|'money'|'warn'|'q';
export const DEFAULT_FILTERS:GridFilters={serverId:null,view:'',st:[],money:'',warn:false,q:''};
type Tri=boolean|null;
function viewMatch(f:VmFacts,view:GridView):Tri{
  switch(view){
    case '':case 'DELETED':return true;
    case 'APPLY':return f.applyPending;
    case 'TODO':return f.todo;
    case 'SDK_MISSING':return f.noSdk;
    case 'ACCOUNT_PRESENT':return f.hasAccount;
    case 'ACCOUNT_MISSING':return f.hasAccount==null?null:!f.hasAccount;
    case 'PAYPAL_MISSING':return f.hasPaypal==null?null:!f.hasPaypal;
    default:return f.view===view;
  }
}
function moneyMatch(f:VmFacts,money:MoneyFilter):Tri{
  switch(money){
    case '':return true;
    case 'UNCHECKED':return f.vmMoney==='UNCHECKED';
    case 'STALE':return f.vmMoney==='STALE'||f.vmMoney==='FAILED_STALE';
    case 'VM_FAILED':return f.vmMoney==='FAILED'||f.vmMoney==='FAILED_STALE';
    case 'NONE':return f.milestone==null?null:!f.milestone;
    case 'WAITING':case 'RECREATE':case 'MONEY_REVIEW':case 'FAILED':return f.milestone==null?null:f.milestone===money;
    default:return f.moneyFlags==null?null:f.moneyFlags[money];
  }
}
// true = in the result, false = out, null = cannot be decided until the missing data arrives. A definite "out" of any group wins.
export function matchVm(f:VmFacts,fl:GridFilters,omit?:FilterGroup):Tri{
  const deleted=fl.view==='DELETED';
  if(deleted?!f.archived:(f.archived||f.serverArchived))return false;
  const parts:Tri[]=[];
  if(omit!=='server'&&fl.serverId)parts.push(f.serverId===fl.serverId);
  if(omit!=='view')parts.push(viewMatch(f,fl.view));
  if(!deleted){
    if(omit!=='st'&&fl.st.length)parts.push(fl.st.includes(f.opsKey));
    if(omit!=='money')parts.push(moneyMatch(f,fl.money));
    if(omit!=='warn'&&fl.warn)parts.push(f.view==='BLOCKED');
  }
  const needle=fl.q.trim().toLowerCase();
  if(omit!=='q'&&needle)parts.push(f.text.includes(needle));
  if(parts.some(p=>p===false))return false;
  return parts.some(p=>p===null)?null:true;
}
// "Kết quả đang xem": every condition including the server; counted before paging; each VM once (the input has each VM once).
export function applyFilters(rows:VmFacts[],fl:GridFilters):VmFacts[]{return rows.filter(f=>matchVm(f,fl)===true);}
export function countMatching(rows:VmFacts[],fl:GridFilters,omit?:FilterGroup):number|null{
  let n=0;for(const f of rows){const m=matchVm(f,fl,omit);if(m===null)return null;if(m)n++;}return n;
}
// The number next to a choice: the other groups as they are, the choice's own group replaced by that choice.
export function countWith(rows:VmFacts[],fl:GridFilters,patch:Partial<GridFilters>):number|null{return countMatching(rows,{...fl,...patch});}
export interface ServerDistribution {total:number;items:{serverId:string;code:string;count:number}[]}
// "Phân bố theo server": every condition except the server, so the other servers stay visible while one is open. Servers with
// matching VMs only, most VMs first, equal counts in natural name order. null while a needed dataset is still loading.
export function serverDistribution(rows:VmFacts[],fl:GridFilters):ServerDistribution|null{
  const by=new Map<string,{serverId:string;code:string;count:number}>();let total=0;
  for(const f of rows){const m=matchVm(f,fl,'server');if(m===null)return null;if(!m)continue;total++;const it=by.get(f.serverId)||{serverId:f.serverId,code:f.server,count:0};it.count++;by.set(f.serverId,it);}
  return {total,items:[...by.values()].sort((a,b)=>b.count-a.count||compareCodes(a.code,b.code))};
}
// "Copy danh sách VM": identities only, `Server | VM` per line, server then VM code in natural order.
export function vmIdLines(rows:{server:string;code:string}[]):string{
  return [...rows].sort((a,b)=>compareCodes(a.server,b.server)||compareCodes(a.code,b.code)).map(r=>r.server+' | '+r.code).join('\n');
}
// Labels of the conditions in force, for the "đang lọc" line with one × per condition.
export const VIEW_LABEL:Record<Exclude<GridView,''>,string>={MISSING:'Thiếu proxy',ASSIGNED:'Có proxy',BLOCKED:'Proxy Blocked',REVIEW:'Cần kiểm tra',SDK_MISSING:'Chưa SDK',ACCOUNT_MISSING:'Chưa EarnApp',ACCOUNT_PRESENT:'Có EarnApp',PAYPAL_MISSING:'Chưa PayPal',DELETED:'Đã xoá',APPLY:'Chờ áp dụng trên máy',TODO:'Cần xử lý'};
