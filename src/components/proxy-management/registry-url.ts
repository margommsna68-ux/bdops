// URL state of the proxy registry. The URL is the only source of the filters: reload, Back/Forward and a link clicked on the same page
// all land on the same list. Keys: ?q &servers=moon1,none (none = unassigned) &group &state (incl. OTHER) &package (code | due)
// &sort (PACKAGE default) &tab (history | all; current is the default) &page (1 is the default). ?pay= belongs to the package dialog and
// is kept as is.
import type {RegistrySort} from '@/server/proxy-management/package-terms';
import {UNASSIGNED_SERVER} from '@/server/proxy-management/types';
import {links} from '@/lib/links';
export type RegistryView='CURRENT'|'HISTORY'|'ALL';
export interface RegistryUrl {q:string;servers:string[];group:string;state:string;pkg:string;sort:RegistrySort;view:RegistryView;page:number;/** ?batch= one import batch ("Xem vừa nhập") */batch:string}
export const REGISTRY_STATES=['NEW','LIVE','BLOCKED','REPLACED','DIE','QUARANTINED','VOID','RETIRED','OTHER'];
const SORTS:RegistrySort[]=['PACKAGE','SERVER','STATUS','IP'];
const TABS:Record<string,RegistryView>={history:'HISTORY',all:'ALL'};
// A page number the server can serve: a whole number from 1 (anything else is page 1). Past the last page is clamped by the server.
export const pageOf=(v:string|null)=>/^[1-9]\d{0,5}$/.test(v||'')?Number(v):1;
export function readRegistryUrl(p:{get(name:string):string|null}):RegistryUrl{
  const state=p.get('state')||'',sort=(p.get('sort')||'PACKAGE') as RegistrySort;
  return {q:p.get('q')||'',servers:(p.get('servers')||'').split(',').filter(Boolean).map(s=>s==='none'?UNASSIGNED_SERVER:s),group:p.get('group')||'',state:REGISTRY_STATES.includes(state)?state:'',pkg:p.get('package')||'',sort:SORTS.includes(sort)?sort:'PACKAGE',view:TABS[p.get('tab')||'']||'CURRENT',page:pageOf(p.get('page')),batch:p.get('batch')||''};
}
export function writeRegistryUrl(u:RegistryUrl,pay?:string|null):string{
  const href=links.proxies({q:u.q||undefined,servers:u.servers.map(s=>s===UNASSIGNED_SERVER?'none':s),group:u.group||undefined,state:u.state||undefined,package:u.pkg||undefined,tab:u.view==='HISTORY'?'history':u.view==='ALL'?'all':undefined,pay:pay||undefined,page:u.page>1?u.page:undefined,batch:u.batch||undefined});
  if(u.sort==='PACKAGE')return href.slice('/infrastructure/proxies'.length);
  const [, query='']=href.split('?'),p=new URLSearchParams(query);p.set('sort',u.sort);return '?'+p.toString();
}
// Anything that changes the result or its order resets paging (go() writes page 1 unless the patch names a page) and the selection.
export const filterKey=(u:RegistryUrl)=>JSON.stringify([u.q.trim(),u.servers,u.group,u.state,u.pkg,u.view,u.sort,u.batch]);
