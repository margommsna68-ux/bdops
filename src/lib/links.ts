// One builder for in-app links. Dashboard cards, charts, alerts, table buttons and side panels all open the same filtered list
// through these functions, so a count and the list it opens always use the same URL (and therefore the same rule on the page).
// Pure: used by server code (notifications) and client components alike.
import {moduleOn} from './features';
export type VmView=''|'MISSING'|'PENDING'|'INSTALLED'|'REVIEW'|'SDK_MISSING'|'ACCOUNT_MISSING'|'PAYPAL_MISSING'|'TASK_ORPHAN'|'DELETED';
export type VmTab='overview'|'proxy'|'install'|'work'|'account'|'history';
export type ProxyGroupKey='TUT'|'SHARED'|'GENJY'|'UNKNOWN';
export type ProxyStateKey='NEW'|'LIVE'|'BLOCKED'|'OTHER'|'REPLACED'|'DIE'|'QUARANTINED'|'VOID'|'RETIRED';
export type ProxyTab='current'|'history'|'all';
type Value=string|number|null|undefined|false;
export function query(values:Record<string,Value>):string{
  const p=new URLSearchParams();for(const [k,v] of Object.entries(values)) if(v!==undefined&&v!==null&&v!==false&&v!=='') p.set(k,String(v));
  const s=p.toString();return s?'?'+s:'';
}
const MONTH=/^\d{4}-\d{2}$/;
export const links={
  dashboard:()=>'/dashboard',
  // Server / VM grid. The server is in the path; vm + tab open the side panel on that VM (same keys as grid-model writeGridUrl).
  vms:(o:{serverId?:string|null;view?:VmView;q?:string;vm?:string|null;tab?:VmTab}={})=>(o.serverId?'/infrastructure/servers/'+encodeURIComponent(o.serverId):'/infrastructure/servers')+query({q:o.q,view:o.view,vm:o.vm,tab:o.vm&&o.tab&&o.tab!=='overview'?o.tab:undefined}),
  // Proxy registry: ?q &servers &group &state &package &tab (current is the default tab). servers uses 'none' for unassigned.
  proxies:(o:{q?:string;group?:ProxyGroupKey|string;state?:ProxyStateKey|string;package?:string;servers?:string[];tab?:ProxyTab;pay?:string}={})=>'/infrastructure/proxies'+query({q:o.q,servers:o.servers?.length?o.servers.join(','):undefined,group:o.group,state:o.state,package:o.package,tab:o.tab&&o.tab!=='current'?o.tab:undefined,pay:o.pay}),
  // Proxy packages: the package list (Thiết lập → Gói proxy) on the registry, due ones first, or the payment form of one package.
  packages:(o:{pay?:string}={})=>'/infrastructure/proxies'+(o.pay?query({pay:o.pay}):query({packages:'due'})),
  // Install work happens at the VM (Server / VM, tab Cài proxy) while the Việc cài proxy page is hidden (src/lib/features.ts).
  installs:(o:{vm?:string;serverId?:string}={}):string=>moduleOn('INSTALL_TASKS')?'/vm-tasks'+query({vm:o.vm}):links.vms({serverId:o.serverId,vm:o.vm,tab:'install',view:o.vm?undefined:'PENDING'}),
  // Open install tasks without a pending configuration: the VM itself when there is one, otherwise the Server / VM filter.
  orphanTasks:(list:{serverId:string;vmId:string}[]):string=>list.length===1?links.vms({serverId:list[0].serverId,vm:list[0].vmId,tab:'install'}):links.vms({view:'TASK_ORPHAN'}),
  work:(o:{kind?:'TASK'|'SHEET_REVIEW';vm?:string}={})=>'/work'+query({kind:o.kind==='SHEET_REVIEW'?'SHEET_REVIEW':undefined,vm:o.vm}),
  accounts:(o:{tab?:'login'|'paypal'|'batch'|'review';q?:string;state?:string}={})=>'/gmails'+query({tab:o.tab&&o.tab!=='login'?o.tab:undefined,q:o.q,state:o.state}),
  costs:(o:{month?:string;cost?:string;server?:string}={})=>'/costs'+query({month:o.month&&MONTH.test(o.month)?o.month:undefined,cost:o.cost,server:o.server}),
  // Money pages. With team cash on, /withdrawals is "Nhận USDT về team" and the original withdrawals/transfers live under
  // ?view=original; without it /withdrawals is the original withdrawals page. /funds is always money arriving in PayPal.
  teamReceipts:(o:{sources?:boolean}={})=>'/withdrawals'+query({view:o.sources?'sources':undefined}),
  originalWithdrawals:(cashMode:boolean)=>cashMode?'/withdrawals?view=original':'/withdrawals',
  paypalIn:()=>'/funds',
  profit:()=>'/profit',
  history:()=>'/history',
};
