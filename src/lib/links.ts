// One builder for in-app links. Dashboard cards, charts, alerts, table buttons and side panels all open the same filtered list
// through these functions, so a count and the list it opens always use the same URL (and therefore the same rule on the page).
// Pure: used by server code (notifications) and client components alike.
export type VmView=''|'MISSING'|'ASSIGNED'|'BLOCKED'|'REVIEW'|'SDK_MISSING'|'ACCOUNT_MISSING'|'PAYPAL_MISSING'|'DELETED';
export type VmTab='overview'|'proxy'|'work'|'account'|'history';
export type ProxyGroupKey='TUT'|'SHARED'|'GENJY'|'UNKNOWN';
export type ProxyStateKey='NEW'|'LIVE'|'BLOCKED'|'OTHER'|'REPLACED'|'DIE'|'QUARANTINED'|'VOID'|'RETIRED';
export type ProxyTab='current'|'history'|'all';
type Value=string|number|null|undefined|false;
export function query(values:Record<string,Value>):string{
  const p=new URLSearchParams();for(const [k,v] of Object.entries(values)) if(v!==undefined&&v!==null&&v!==false&&v!=='') p.set(k,String(v));
  const s=p.toString();return s?'?'+s:'';
}
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/,DAY=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const period=(o:{month?:string;date?:string}):{month?:string;date?:string}=>{const date=o.date&&DAY.test(o.date)?o.date:undefined;return {month:date?date.slice(0,7):o.month&&MONTH.test(o.month)?o.month:undefined,date};};
// Read back by the money pages: the month (default: this month) and a day inside that month (anything else is ignored).
export function readPeriod(p:{get(name:string):string|null},fallbackMonth:string):{month:string;date:string|null}{
  const d=p.get('date')||'',m=p.get('month')||'',date=DAY.test(d)&&(!m||d.startsWith(m))?d:null;
  return {month:date?date.slice(0,7):MONTH.test(m)?m:fallbackMonth,date};
}
export const links={
  dashboard:()=>'/dashboard',
  // Server / VM grid. The server is in the path; vm + tab open the side panel on that VM (same keys as grid-model writeGridUrl).
  vms:(o:{serverId?:string|null;view?:VmView;q?:string;vm?:string|null;tab?:VmTab}={})=>(o.serverId?'/infrastructure/servers/'+encodeURIComponent(o.serverId):'/infrastructure/servers')+query({q:o.q,view:o.view,vm:o.vm,tab:o.vm&&o.tab&&o.tab!=='overview'?o.tab:undefined}),
  // Proxy registry: ?q &servers &group &state &package &tab (current is the default tab) &page. servers uses 'none' for unassigned.
  proxies:(o:{q?:string;group?:ProxyGroupKey|string;state?:ProxyStateKey|string;package?:string;servers?:string[];tab?:ProxyTab;pay?:string;page?:number}={})=>'/infrastructure/proxies'+query({q:o.q,servers:o.servers?.length?o.servers.join(','):undefined,group:o.group,state:o.state,package:o.package,tab:o.tab&&o.tab!=='current'?o.tab:undefined,page:o.page&&o.page>1?o.page:undefined,pay:o.pay}),
  // Proxy packages: the package list (Thiết lập → Gói proxy) on the registry, due ones first, or the payment form of one package.
  packages:(o:{pay?:string}={})=>'/infrastructure/proxies'+(o.pay?query({pay:o.pay}):query({packages:'due'})),
  // 19/10/2026: there is no install step any more; an old /vm-tasks link opens Server / VM (the VM when one is named).
  installs:(o:{vm?:string;serverId?:string}={}):string=>links.vms({serverId:o.serverId,vm:o.vm}),
  work:(o:{kind?:'TASK'|'SHEET_REVIEW';vm?:string}={})=>'/work'+query({kind:o.kind==='SHEET_REVIEW'?'SHEET_REVIEW':undefined,vm:o.vm}),
  // Kho tài khoản (see components/account-store/account-url.ts): kind tab, then Lịch sử nhập kho / Cần đối chiếu inside that kind.
  accounts:(o:{tab?:'login'|'paypal';view?:'history'|'review';q?:string;state?:string;batch?:string}={})=>'/gmails'+query({tab:o.tab&&o.tab!=='login'?o.tab:undefined,view:o.view,q:o.q,state:o.state,batch:o.batch}),
  // Money lists open on the month (and optionally the day) they were opened from: ?month=YYYY-MM &date=YYYY-MM-DD (a day implies its month).
  costs:(o:{month?:string;date?:string;cost?:string;server?:string}={})=>'/costs'+query({...period(o),cost:o.cost,server:o.server}),
  // Money pages. With team cash on, /withdrawals is "Nhận USDT về team" and the original withdrawals/transfers live under
  // ?view=original; without it /withdrawals is the original withdrawals page. /funds is always money arriving in PayPal.
  teamReceipts:(o:{sources?:boolean;month?:string;date?:string}={})=>'/withdrawals'+query({view:o.sources?'sources':undefined,...period(o)}),
  originalWithdrawals:(cashMode:boolean)=>cashMode?'/withdrawals?view=original':'/withdrawals',
  paypalIn:()=>'/funds',
  profit:(o:{month?:string}={})=>'/profit'+query(period(o)),
  history:()=>'/history',
};
