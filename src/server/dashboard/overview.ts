import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {loadInfrastructureScope} from '@/server/permissions/infrastructure';
import {readVMWorkspace} from '../vm-management/repository';
import {vmView} from '../vm-management/state';
import {loadRegistryRows,registryGroupKey} from '../proxy-management/history';
import {packageReminders} from '../proxy-management/reminders';
import {compareCodes} from '../proxy-management/package-terms';
import {GROUP_GENJY,GROUP_SHARED,GROUP_TUT,GROUP_UNKNOWN,ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {readVmAccounts} from '../account-store/read';
import {getEligibleInventory,getManualInventory} from '../proxy-management/repository';
import {teamCashSources} from '../business-management/team-cash-report';
import {assertBusinessArea} from '../business-management/scope';
import {dayText,period} from '../business-management/money';
import {CashDecimal} from '../business-management/usdt-money';
// Dashboard read model (MoneyToHome Proxy / VM). Giao việc and Việc cài proxy are hidden modules (src/lib/features.ts): no work
// block here. Since 19/10/2026 there is no install step: VMs are counted as with a proxy, with a Blocked proxy, to review or missing.
// Dashboard read model. Every section reuses the checked read of the page it links to (same permission, same rule, whole result
// before pagination), so the numbers here are the numbers the target list shows. A section the member may not read is null; other
// failures propagate so the page shows an error instead of zeros.
const forbidden=(e:unknown)=>e instanceof ProxyDomainError&&e.code==='FORBIDDEN';
async function maybe<T>(read:()=>Promise<T>):Promise<T|null>{try{return await read();}catch(e){if(forbidden(e))return null;throw e;}}
export type VmBucket='ASSIGNED'|'BLOCKED'|'REVIEW'|'MISSING';
export type StockBucket='NEW'|'LIVE'|'BLOCKED'|'OTHER';
const MAIN=['NEW','LIVE','BLOCKED'];
export function monthBounds(month:string){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new ProxyDomainError('INVALID_INPUT','Tháng không hợp lệ');
  const [y,m]=month.split('-').map(Number);return {start:month+'-01',end:month+'-'+String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')};
}
// part: the page asks for operations and finance separately, so a failure in one section never hides the other (each shows its own
// error and retry). Without part both are read (tests, scripts). The month only concerns finance.
export type OverviewPart='operations'|'finance';
export async function readOverview(scope:ActorScope,input:{month:string;part?:OverviewPart},db:PrismaClient=prisma,now:Date=new Date()){
  const range=monthBounds(input.month),current=await loadInfrastructureScope(db,scope.userId,scope.projectId),want=(p:OverviewPart)=>!input.part||input.part===p;
  const can=(area:'INFRASTRUCTURE'|'COSTS'|'PROFIT'|'FUNDS'|'WITHDRAWALS'|'PAYPALS',write=false)=>{try{assertBusinessArea(current,area,write);return true;}catch{return false;}};
  const rights={infra:current.businessMode==='PROXY_VM'&&can('INFRASTRUCTURE'),cashEnabled:!!current.teamCashEnabled,admin:current.role==='ADMIN',costs:can('COSTS'),profit:can('PROFIT'),funds:can('FUNDS'),withdrawals:can('WITHDRAWALS'),paypals:can('PAYPALS')};
  const [operations,finance]=await Promise.all([want('operations')&&rights.infra?readOperations(scope,db,now,rights.costs):Promise.resolve(null),want('finance')?readFinance(scope,input.month,range,!!current.teamCashEnabled,db):Promise.resolve(null)]);
  return {generatedAt:now.toISOString(),month:input.month,part:input.part??null,rights,operations,finance};
}
async function readOperations(scope:ActorScope,db:PrismaClient,now:Date,costs:boolean){
  const workspace=await maybe(()=>readVMWorkspace(scope,db));if(!workspace)return null;
  const [accounts,registry,packages,autofill,manual]=await Promise.all([
    maybe(()=>readVmAccounts(scope,db)),
    loadRegistryRows(scope,{view:'CURRENT'},db),
    db.proxyProviderAccount.findMany({where:{projectId:scope.projectId,nextDueDate:{not:null},renewalStoppedAt:null}}),
    // NEW is a state; "can be given to a VM" is the allocation pool itself (not held, no install/BLOCKED event, package, credentials).
    getEligibleInventory(scope.projectId,db),getManualInventory(scope.projectId,db),
  ]);
  // Server / VM: deleted servers and VMs are not operating; buckets are the grid's own vmView rule.
  const servers=workspace.servers.filter(s=>!s.archivedAt).sort((a,b)=>compareCodes(a.code,b.code)),active=new Set(servers.map(s=>s.id));
  const vms=workspace.vms.filter(v=>!v.archivedAt&&active.has(v.serverId));
  const perServer=servers.map(s=>{const own=vms.filter(v=>v.serverId===s.id),b:Record<VmBucket,number>={ASSIGNED:0,BLOCKED:0,REVIEW:0,MISSING:0};for(const v of own){const k=vmView(v);if(k!=='ARCHIVED')b[k]++;}return {id:s.id,code:s.code,total:own.length,...b};});
  const sum=(k:VmBucket)=>perServer.reduce((a,s)=>a+s[k],0);
  const accountOf=new Map((accounts||[]).map(a=>[a.vmId,a.earnApp]));
  // Gaps overlap (a VM without an account has no PayPal either); they are never added up into one "VM lỗi" number.
  const gaps={noSdk:vms.filter(v=>!v.sdks.length&&!v.sdk).length,noAccount:accounts?vms.filter(v=>!accountOf.get(v.id)).length:null,noPaypal:accounts?vms.filter(v=>!accountOf.get(v.id)?.paypal).length:null};
  // Proxy stock: the registry's current view (Đang quản lý), grouped by "Từ nhóm" and state exactly like its filters.
  type StockRow={key:string;label:string;total:number}&Record<StockBucket,number>;
  const stock=new Map<string,StockRow>();
  const labelOf=(key:string)=>key===GROUP_TUT?'TUT':key===GROUP_SHARED?'Chung mooon–Genjy':key===GROUP_GENJY?'Genjy riêng':key===GROUP_UNKNOWN?'Chưa xác định':registry.groups.find(g=>g.id===key)?.name||'Nhóm khác';
  const rowOf=(key:string)=>{let row=stock.get(key);if(!row){row={key,label:labelOf(key),NEW:0,LIVE:0,BLOCKED:0,OTHER:0,total:0};stock.set(key,row);}return row;};
  for(const k of [GROUP_TUT,GROUP_SHARED,GROUP_GENJY])rowOf(k);
  for(const r of registry.rows){const row=rowOf(registryGroupKey(r)),s=(MAIN.includes(r.state)?r.state:'OTHER') as StockBucket;row[s]++;row.total++;}
  const reminders=packageReminders(packages.map(p=>({id:p.id,code:p.code,nextDueDate:p.nextDueDate,reminderDays:p.reminderDays,renewalStoppedAt:p.renewalStoppedAt,price:p.price?.toString()??null,priceCurrency:p.priceCurrency,disabled:p.disabled})),now,costs);
  return {
    servers:perServer,
    totals:{servers:servers.length,vms:vms.length,ASSIGNED:sum('ASSIGNED'),BLOCKED:sum('BLOCKED'),REVIEW:sum('REVIEW'),MISSING:sum('MISSING')},
    gaps,
    stock:{rows:Array.from(stock.values()),total:registry.rows.length,ready:{autofill:autofill.length,sharedManual:manual.filter(m=>m.shared).length}},
    packages:reminders.map(r=>({id:r.packageId,code:r.code,title:r.title,severity:r.severity,daysLeft:r.daysLeft,link:r.link})),
  };
}
// Finance for one month: USDT confirmed as received by the team minus valid costs, each at its own recorded rate — the team cash
// report itself. Money still with collectors is not income. Daily points come from the same records; no records → no series.
async function readFinance(scope:ActorScope,month:string,range:{start:string;end:string},enabled:boolean,db:PrismaClient){
  if(!enabled)return {enabled:false as const};
  const source=await maybe(()=>teamCashSources(scope,range,db));if(!source)return null;
  const bounds=period(range.start,range.end),[receipts,costs]=await Promise.all([
    db.teamReceipt.findMany({where:{projectId:scope.projectId,voidedAt:null,status:'CONFIRMED',receivedAt:{gte:bounds.start,lt:bounds.end}},select:{receivedAt:true,amountUsdt:true}}),
    db.costRecord.findMany({where:{projectId:scope.projectId,voidedAt:null,profitTreatment:'CASH_COST',date:{gte:bounds.start,lt:bounds.end}},select:{date:true,usdtAmount:true}}),
  ]);
  const days=new Map<string,{received:InstanceType<typeof CashDecimal>;cost:InstanceType<typeof CashDecimal>}>();
  const at=(d:string)=>{let v=days.get(d);if(!v){v={received:new CashDecimal(0),cost:new CashDecimal(0)};days.set(d,v);}return v;};
  for(const r of receipts)if(r.amountUsdt){const v=at(dayText(r.receivedAt));v.received=v.received.plus(r.amountUsdt.toFixed(6));}
  for(const c of costs)if(c.usdtAmount){const v=at(dayText(c.date));v.cost=v.cost.plus(c.usdtAmount.toFixed(6));}
  const series=receipts.length||costs.length?Array.from({length:Number(range.end.slice(8))},(_,i)=>{const d=month+'-'+String(i+1).padStart(2,'0'),v=days.get(d);return {date:d,received:v?v.received.toFixed(2):'0.00',cost:v?v.cost.toFixed(2):'0.00'};}):[];
  const r=source.report;
  return {enabled:true as const,range,received:r.teamReceived,cost:r.cost,net:r.net,blockingCount:r.blockingCount,missingRate:r.blockers.filter(b=>b.kind==='MISSING_RATE').length,unverified:r.blockers.filter(b=>b.kind!=='MISSING_RATE').length,records:receipts.length+costs.length,series};
}
