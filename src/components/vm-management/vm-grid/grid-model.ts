// Pure model of the Server/VM grid: columns and per-user preferences, URL state, the next editable cell for Tab, pagination.
// No React here, so it is unit-tested directly.
export type ColumnKey='proxy'|'sdk'|'account'|'paypal'|'payout'|'notes'|'version'|'sdkMeta'|'progress';
export type EditField='code'|'sdk'|'notes';
export interface ColumnDef {key:ColumnKey;label:string;width:number;min:number;optional?:boolean;edit?:EditField}
// Fixed columns (not movable/hideable): [select] [server, only for all servers] [VM] [Tình trạng] … [⋯]. These are the movable ones.
export const COLUMNS:ColumnDef[]=[
  // Proxy: IP:port with copy and, under it, the install progress (Chờ cài / Đang cài / Đã cài / Cần thay proxy…); a click opens the
  // install actions. The separate "Cài proxy" column was merged into it (owner brief 19/10/2026); stored column settings drop it.
  {key:'proxy',label:'Proxy',width:250,min:160},
  // SDK: code + copy, then the code's money and link state; a click opens the SDK frame (not part of the Tab cell editing).
  {key:'sdk',label:'SDK',width:190,min:130},
  {key:'account',label:'Tài khoản EarnApp',width:230,min:140},
  {key:'paypal',label:'PayPal nhận',width:130,min:90},
  {key:'payout',label:'Rút tiền',width:200,min:140},
  {key:'notes',label:'Ghi chú',width:220,min:120,edit:'notes'},
  {key:'version',label:'Cấu hình',width:120,min:90,optional:true},
  {key:'sdkMeta',label:'SDK ghi bởi',width:170,min:110,optional:true},
  {key:'progress',label:'Tiến độ cài',width:130,min:100,optional:true},
];
export const FIXED={select:40,server:96,vm:118,ops:124,menu:48};
export interface GridPrefs {order:ColumnKey[];hidden:ColumnKey[];widths:Partial<Record<ColumnKey|'server'|'vm',number>>}
export const DEFAULT_PREFS:GridPrefs={order:COLUMNS.map(c=>c.key),hidden:COLUMNS.filter(c=>c.optional).map(c=>c.key),widths:{}};
// Stored preferences survive new columns being added later: unknown keys are dropped, missing ones appended (hidden if optional).
export function normalizePrefs(raw:unknown):GridPrefs{
  const keys=COLUMNS.map(c=>c.key),p=(raw&&typeof raw==='object'?raw:{}) as Partial<GridPrefs>;
  const order=(Array.isArray(p.order)?p.order:[]).filter((k):k is ColumnKey=>keys.includes(k as ColumnKey)).filter((k,i,a)=>a.indexOf(k)===i);
  const missing=keys.filter(k=>!order.includes(k));
  // A column added later goes to its default place (after the column before it), not to the end.
  for(const k of missing){const at=keys.indexOf(k),prev=keys.slice(0,at).reverse().find(x=>order.includes(x));order.splice(prev?order.indexOf(prev)+1:0,0,k);}
  const hidden=(Array.isArray(p.hidden)?p.hidden:DEFAULT_PREFS.hidden).filter((k):k is ColumnKey=>keys.includes(k as ColumnKey));
  const widths:GridPrefs['widths']={};for(const [k,v] of Object.entries(p.widths||{})) if((keys.includes(k as ColumnKey)||k==='server'||k==='vm')&&typeof v==='number'&&v>=60&&v<=800) widths[k as ColumnKey]=Math.round(v);
  return {order,hidden:[...hidden,...missing.filter(k=>COLUMNS.find(c=>c.key===k)!.optional&&!hidden.includes(k))],widths};
}
export const prefsKey=(userId:string)=>'mth.vm-grid.v1.'+userId;
export function visibleColumns(prefs:GridPrefs){return prefs.order.filter(k=>!prefs.hidden.includes(k)).map(k=>COLUMNS.find(c=>c.key===k)!);}
export function widthOf(prefs:GridPrefs,key:ColumnKey|'server'|'vm'){const def=key==='server'?FIXED.server:key==='vm'?FIXED.vm:COLUMNS.find(c=>c.key===key)!.width;return prefs.widths[key]??def;}
export function moveColumn(prefs:GridPrefs,key:ColumnKey,to:number):GridPrefs{const order=prefs.order.filter(k=>k!==key);order.splice(Math.max(0,Math.min(to,order.length)),0,key);return {...prefs,order};}
export function toggleColumn(prefs:GridPrefs,key:ColumnKey,on:boolean):GridPrefs{return {...prefs,hidden:on?prefs.hidden.filter(k=>k!==key):Array.from(new Set([...prefs.hidden,key]))};}
export function resizeColumn(prefs:GridPrefs,key:ColumnKey|'server'|'vm',width:number):GridPrefs{const min=key==='server'?70:key==='vm'?80:COLUMNS.find(c=>c.key===key)!.min;return {...prefs,widths:{...prefs.widths,[key]:Math.round(Math.max(min,Math.min(800,width)))}};}
// Editable cells in visual order: VM code first (when the user may manage), then the visible editable columns.
export function editableFields(prefs:GridPrefs,rights:{manage:boolean;assign:boolean}):EditField[]{
  const out:EditField[]=[];if(rights.manage) out.push('code');
  for(const c of visibleColumns(prefs)){if(c.edit==='notes'&&rights.manage) out.push('notes');}
  return out;
}
// Tab / Shift+Tab after a successful save: next editable cell in the row, then the first one of the next row (on the current page).
export function nextCell(rowIds:string[],fields:EditField[],at:{vmId:string;field:EditField},back=false):{vmId:string;field:EditField}|null{
  const r=rowIds.indexOf(at.vmId),f=fields.indexOf(at.field);if(r<0||f<0||!fields.length) return null;
  const i=r*fields.length+f+(back?-1:1);if(i<0||i>=rowIds.length*fields.length) return null;
  return {vmId:rowIds[Math.floor(i/fields.length)],field:fields[i%fields.length]};
}
// URL state: everything the user picked survives reload and Back/Forward. The server is in the path.
export type GridView=''|'MISSING'|'PENDING'|'INSTALLED'|'REVIEW'|'SDK_MISSING'|'ACCOUNT_MISSING'|'PAYPAL_MISSING'|'TASK_ORPHAN'|'DELETED';
export type GridSort='VM'|'PRIORITY'|'SDK'|'PROXY'|'STATUS';
// Operating status filter (several at once; NONE = Chưa ghi) and money milestone filter.
export const OPS_FILTERS=['NONE','OK','NOT_LINKED','OFF','PROXY_BLOCKED','LINKED','EARN_ERROR','SUSPENDED','DELETED','NEW_VM','MAIL_LOGGED'] as const;
export type OpsFilter=typeof OPS_FILTERS[number];
export type MoneyFilter=''|'WAITING'|'RECREATE'|'MONEY_REVIEW'|'FAILED'|'NONE';
export type PanelTab='overview'|'proxy'|'install'|'work'|'account'|'history';
// Kho SDK (opened in the page with ?sdk=1): its search, filters, sort and page live in the URL too, so Back / Forward and reload return to it.
export type SdkStateFilter='FREE'|'UNCONFIRMED'|'LINKED'|'ALL';
export type SdkPlaceFilter='ALL'|'STORE'|'VM';
export type SdkSort='UPDATED'|'AMOUNT_DESC'|'AMOUNT_ASC'|'CODE';
export interface SdkStoreUrl {open:boolean;q:string;state:SdkStateFilter;place:SdkPlaceFilter;sort:SdkSort;page:number}
export interface GridUrl {q:string;view:GridView;sort:GridSort;page:number;size:50|100|200;vm:string|null;tab:PanelTab;cause:string|null;st:OpsFilter[];money:MoneyFilter;warn:boolean;sdk?:SdkStoreUrl}
const SDK_STATES:SdkStateFilter[]=['FREE','UNCONFIRMED','LINKED','ALL'],SDK_PLACES:SdkPlaceFilter[]=['ALL','STORE','VM'],SDK_SORTS:SdkSort[]=['UPDATED','AMOUNT_DESC','AMOUNT_ASC','CODE'];
export const SDK_STORE_DEFAULT:SdkStoreUrl={open:false,q:'',state:'FREE',place:'ALL',sort:'UPDATED',page:1};
function readSdkUrl(p:{get(name:string):string|null}):SdkStoreUrl{
  const pick=<T extends string>(v:string|null,all:T[],d:T)=>(all as string[]).includes(v||'')?v as T:d;
  return {open:p.get('sdk')==='1',q:p.get('sq')||'',state:pick(p.get('sf'),SDK_STATES,'FREE'),place:pick(p.get('sl'),SDK_PLACES,'ALL'),sort:pick(p.get('ss'),SDK_SORTS,'UPDATED'),page:Math.max(1,Math.floor(Number(p.get('sp'))||1))};
}
const VIEWS:GridView[]=['','MISSING','PENDING','INSTALLED','REVIEW','SDK_MISSING','ACCOUNT_MISSING','PAYPAL_MISSING','TASK_ORPHAN','DELETED'],SORTS:GridSort[]=['VM','PRIORITY','SDK','PROXY','STATUS'],MONEY:MoneyFilter[]=['','WAITING','RECREATE','MONEY_REVIEW','FAILED','NONE'],TABS:PanelTab[]=['overview','proxy','install','work','account','history'];
export function readGridUrl(p:{get(name:string):string|null}):GridUrl{
  const view=(p.get('view')||'') as GridView,sort=(p.get('sort')||'VM') as GridSort,size=Number(p.get('size')),tab=(p.get('tab')||'overview') as PanelTab;
  return {q:p.get('q')||'',view:VIEWS.includes(view)?view:'',sort:SORTS.includes(sort)?sort:'VM',page:Math.max(1,Math.floor(Number(p.get('page'))||1)),size:size===50||size===200?size:100,vm:p.get('vm')||null,tab:TABS.includes(tab)?tab:'overview',cause:p.get('cause')||null,
    sdk:readSdkUrl(p),st:(p.get('st')||'').split(',').filter((x):x is OpsFilter=>(OPS_FILTERS as readonly string[]).includes(x)).filter((x,i,a)=>a.indexOf(x)===i),money:MONEY.includes((p.get('money')||'') as MoneyFilter)?(p.get('money')||'') as MoneyFilter:'',warn:p.get('warn')==='proxy'};
}
export function writeGridUrl(state:GridUrl):string{
  const q=new URLSearchParams();if(state.q) q.set('q',state.q);if(state.view) q.set('view',state.view);if(state.st?.length) q.set('st',state.st.join(','));if(state.money) q.set('money',state.money);if(state.warn) q.set('warn','proxy');if(state.sort!=='VM') q.set('sort',state.sort);
  if(state.page>1) q.set('page',String(state.page));if(state.size!==100) q.set('size',String(state.size));
  if(state.vm){q.set('vm',state.vm);if(state.tab!=='overview') q.set('tab',state.tab);if(state.cause) q.set('cause',state.cause);}
  const k=state.sdk;if(k?.open){q.set('sdk','1');if(k.q) q.set('sq',k.q);if(k.state!=='FREE') q.set('sf',k.state);if(k.place!=='ALL') q.set('sl',k.place);if(k.sort!=='UPDATED') q.set('ss',k.sort);if(k.page>1) q.set('sp',String(k.page));}
  const s=q.toString();return s?'?'+s:'';
}
export function pageOf<T>(rows:T[],page:number,size:number){const pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,pages),start=(current-1)*size;return {pages,current,first:rows.length?start+1:0,last:Math.min(rows.length,start+size),rows:rows.slice(start,start+size)};}
// Long SDK codes: head…tail when shown, full value in the title, copy and edit.
export function shortCode(value:string,keep=8){return value.length<=keep*2+1?value:value.slice(0,keep)+'…'+value.slice(-keep);}
