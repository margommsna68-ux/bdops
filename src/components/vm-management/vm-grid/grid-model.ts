// Pure model of the Server/VM grid: columns and per-user preferences, URL state, the next editable cell for Tab, pagination.
// No React here, so it is unit-tested directly.
export type ColumnKey='proxy'|'sdk'|'account'|'paypal'|'status'|'notes'|'version'|'sdkMeta'|'progress';
export type EditField='code'|'sdk'|'notes';
export interface ColumnDef {key:ColumnKey;label:string;width:number;min:number;optional?:boolean;edit?:EditField}
// Fixed columns (not movable/hideable): [select] [server, only for all servers] [VM] … [⋯]. These are the movable ones.
export const COLUMNS:ColumnDef[]=[
  {key:'proxy',label:'Proxy',width:230,min:150},
  {key:'sdk',label:'SDK',width:170,min:110,edit:'sdk'},
  {key:'account',label:'Tài khoản EarnApp',width:230,min:140},
  {key:'paypal',label:'PayPal nhận',width:130,min:90},
  {key:'status',label:'Tình trạng',width:130,min:100},
  {key:'notes',label:'Ghi chú',width:220,min:120,edit:'notes'},
  {key:'version',label:'Cấu hình',width:120,min:90,optional:true},
  {key:'sdkMeta',label:'SDK ghi bởi',width:170,min:110,optional:true},
  {key:'progress',label:'Tiến độ cài',width:130,min:100,optional:true},
];
export const FIXED={select:40,server:96,vm:118,menu:48};
export interface GridPrefs {order:ColumnKey[];hidden:ColumnKey[];widths:Partial<Record<ColumnKey|'server'|'vm',number>>}
export const DEFAULT_PREFS:GridPrefs={order:COLUMNS.map(c=>c.key),hidden:COLUMNS.filter(c=>c.optional).map(c=>c.key),widths:{}};
// Stored preferences survive new columns being added later: unknown keys are dropped, missing ones appended (hidden if optional).
export function normalizePrefs(raw:unknown):GridPrefs{
  const keys=COLUMNS.map(c=>c.key),p=(raw&&typeof raw==='object'?raw:{}) as Partial<GridPrefs>;
  const order=(Array.isArray(p.order)?p.order:[]).filter((k):k is ColumnKey=>keys.includes(k as ColumnKey)).filter((k,i,a)=>a.indexOf(k)===i);
  const missing=keys.filter(k=>!order.includes(k));
  const hidden=(Array.isArray(p.hidden)?p.hidden:DEFAULT_PREFS.hidden).filter((k):k is ColumnKey=>keys.includes(k as ColumnKey));
  const widths:GridPrefs['widths']={};for(const [k,v] of Object.entries(p.widths||{})) if(typeof v==='number'&&v>=60&&v<=800) widths[k as ColumnKey]=Math.round(v);
  return {order:[...order,...missing],hidden:[...hidden,...missing.filter(k=>COLUMNS.find(c=>c.key===k)!.optional&&!hidden.includes(k))],widths};
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
  for(const c of visibleColumns(prefs)){if(c.edit==='sdk'&&rights.assign) out.push('sdk');if(c.edit==='notes'&&rights.manage) out.push('notes');}
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
export type GridSort='VM'|'SDK'|'PROXY'|'STATUS';
export type PanelTab='overview'|'proxy'|'install'|'work'|'account'|'history';
export interface GridUrl {q:string;view:GridView;sort:GridSort;page:number;size:50|100|200;vm:string|null;tab:PanelTab;cause:string|null}
const VIEWS:GridView[]=['','MISSING','PENDING','INSTALLED','REVIEW','SDK_MISSING','ACCOUNT_MISSING','PAYPAL_MISSING','TASK_ORPHAN','DELETED'],SORTS:GridSort[]=['VM','SDK','PROXY','STATUS'],TABS:PanelTab[]=['overview','proxy','install','work','account','history'];
export function readGridUrl(p:{get(name:string):string|null}):GridUrl{
  const view=(p.get('view')||'') as GridView,sort=(p.get('sort')||'VM') as GridSort,size=Number(p.get('size')),tab=(p.get('tab')||'overview') as PanelTab;
  return {q:p.get('q')||'',view:VIEWS.includes(view)?view:'',sort:SORTS.includes(sort)?sort:'VM',page:Math.max(1,Math.floor(Number(p.get('page'))||1)),size:size===50||size===200?size:100,vm:p.get('vm')||null,tab:TABS.includes(tab)?tab:'overview',cause:p.get('cause')||null};
}
export function writeGridUrl(state:GridUrl):string{
  const q=new URLSearchParams();if(state.q) q.set('q',state.q);if(state.view) q.set('view',state.view);if(state.sort!=='VM') q.set('sort',state.sort);
  if(state.page>1) q.set('page',String(state.page));if(state.size!==100) q.set('size',String(state.size));
  if(state.vm){q.set('vm',state.vm);if(state.tab!=='overview') q.set('tab',state.tab);if(state.cause) q.set('cause',state.cause);}
  const s=q.toString();return s?'?'+s:'';
}
export function pageOf<T>(rows:T[],page:number,size:number){const pages=Math.max(1,Math.ceil(rows.length/size)),current=Math.min(page,pages),start=(current-1)*size;return {pages,current,first:rows.length?start+1:0,last:Math.min(rows.length,start+size),rows:rows.slice(start,start+size)};}
// Long SDK codes: head…tail when shown, full value in the title, copy and edit.
export function shortCode(value:string,keep=8){return value.length<=keep*2+1?value:value.slice(0,keep)+'…'+value.slice(-keep);}
