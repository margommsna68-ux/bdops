import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {assertInfrastructureAction,loadInfrastructureScope} from '@/server/permissions/infrastructure';
import {decodeEndpoint} from './repository';
import {fullProxy} from './parse';
import {compareCodes,dueState,sortLocations,sortRegistryRows} from './package-terms';
import {GROUP_GENJY,GROUP_SHARED,GROUP_TUT,GROUP_UNKNOWN,HISTORICAL_STATES,isShared,ProxyDomainError,UNASSIGNED_SERVER,type ActorScope,type CopyResult,type CopySkipReason,type ProxyTimeline,type RegistryFilter,type RegistryLocation,type RegistryPage,type RegistryRow} from './types';
type VMRef={id:string;code:string;serverId:string;server:{code:string}};
// Every valid position of an endpoint: active holds (with their role) plus the VM link recorded from the Sheet (role null) when it is not already held.
function locationsOf(e:{vm:VMRef|null;allocations:{vmId:string;role:string;vm:VMRef}[]}):RegistryLocation[]{
  const out:RegistryLocation[]=e.allocations.map(a=>({serverId:a.vm.serverId,serverCode:a.vm.server.code,vmId:a.vmId,vmCode:a.vm.code,role:a.role as RegistryLocation['role']}));
  if(e.vm&&!out.some(l=>l.vmId===e.vm!.id)) out.push({serverId:e.vm.serverId,serverCode:e.vm.server.code,vmId:e.vm.id,vmCode:e.vm.code,role:null});
  return sortLocations(out);
}
type RowsFilter=Omit<RegistryFilter,'cursor'|'limit'>;
const MAIN_STATES=['NEW','LIVE','BLOCKED'];
// "Từ nhóm" key of a row: the built-in groups map to owners; anything else is a ProxyGroup id.
export const registryGroupKey=(r:Pick<RegistryRow,'owner'|'subgroup'|'groupId'>)=>r.owner==='SELF'?GROUP_TUT:isShared(r.owner,r.subgroup)?GROUP_SHARED:r.owner==='GENJY'?GROUP_GENJY:r.owner==='UNKNOWN'?GROUP_UNKNOWN:r.groupId||GROUP_UNKNOWN;
export function stateMatches(state:string,filter:string){return filter==='OTHER'?!MAIN_STATES.includes(state):state===filter;}
// Whole registry of the project, filtered and sorted; callers paginate or copy from it.
export async function loadRegistryRows(scope:ActorScope,filter:RowsFilter,db:PrismaClient){
  const [endpoints,reserved,groups]=await Promise.all([
    db.proxyIP.findMany({where:{projectId:scope.projectId,identityId:{not:null}},include:{identity:{include:{sourceRefs:{where:{snapshot:{projectId:scope.projectId}}}}},group:{select:{id:true,name:true}},vm:{include:{server:true}},allocations:{where:{releasedAt:null},include:{vm:{include:{server:true}}}}}}),
    db.proxyIdentity.findMany({where:{owner:'GENJY',sourceRefs:{some:{snapshot:{projectId:scope.projectId}}}},include:{sourceRefs:{where:{snapshot:{projectId:scope.projectId}}}}}),
    db.proxyGroup.findMany({where:{projectId:scope.projectId},select:{id:true,name:true}}).then(list=>list.sort((a,b)=>a.name.localeCompare(b.name,'vi',{sensitivity:'base',numeric:true}))),
  ]);
  const rows:RegistryRow[]=endpoints.flatMap(e=>e.identity?[{identityId:e.identity.id,endpointId:e.id,ip:e.identity.ip,port:e.port,owner:e.identity.owner,subgroup:e.identity.subgroup,groupId:e.groupId,groupName:e.group?.name||null,packageCode:e.packageCode,state:e.inventoryState,revision:e.revision,sourceRefs:Array.from(new Set(e.identity.sourceRefs.map(s=>s.sourceRef))),locations:locationsOf(e),statusAt:e.statusAt?.toISOString()||null}]:[]);
  const linked=new Set(endpoints.map(e=>e.identityId));
  for(const i of reserved) if(!linked.has(i.id)) rows.push({identityId:i.id,endpointId:null,ip:i.ip,port:null,owner:'GENJY',subgroup:i.subgroup,groupId:null,groupName:null,packageCode:null,state:'QUARANTINED',revision:i.revision,sourceRefs:Array.from(new Set(i.sourceRefs.map(s=>s.sourceRef))),locations:[],statusAt:null});
  const counts={current:rows.filter(r=>!!r.endpointId&&r.owner==='SELF'&&!['QUARANTINED',...HISTORICAL_STATES].includes(r.state)).length,historical:rows.filter(r=>HISTORICAL_STATES.includes(r.state)).length,reserved:new Set(rows.filter(r=>r.owner==='GENJY'&&!isShared(r.owner,r.subgroup)).map(r=>r.identityId)).size,shared:new Set(rows.filter(r=>isShared(r.owner,r.subgroup)&&!HISTORICAL_STATES.includes(r.state)).map(r=>r.identityId)).size,quarantined:rows.filter(r=>!!r.endpointId&&r.state==='QUARANTINED').length};
  const servers=Array.from(new Set(rows.flatMap(r=>r.locations.map(l=>l.serverCode)))).sort(compareCodes);
  const search=filter.search?.trim().toLowerCase(),serverSet=filter.servers?.length?new Set(filter.servers):null;
  // Group filter: the built-in groups map to owners; anything else is a ProxyGroup id.
  const groupKey=registryGroupKey;
  const groupMatch=(r:RegistryRow)=>!filter.group||groupKey(r)===filter.group;
  const dueCodes=filter.due?new Set((await db.proxyProviderAccount.findMany({where:{projectId:scope.projectId,nextDueDate:{not:null}},select:{code:true,nextDueDate:true}})).filter(a=>['DUE_SOON','OVERDUE'].includes(dueState(a.nextDueDate).state)).map(a=>a.code)):null;
  const scoped=rows.filter(r=>(!dueCodes||(!!r.packageCode&&dueCodes.has(r.packageCode)))&&
    (filter.view==='ALL'||(filter.view==='HISTORY'?HISTORICAL_STATES.includes(r.state):!HISTORICAL_STATES.includes(r.state)))&&
    (!filter.owner||r.owner===filter.owner)&&(!filter.packageCode||r.packageCode===filter.packageCode)&&
    (!serverSet||(r.locations.length?r.locations.some(l=>serverSet.has(l.serverCode)):serverSet.has(UNASSIGNED_SERVER)))&&
    (!search||[r.ip,r.packageCode||'',r.groupName||'',...r.locations.flatMap(l=>[l.serverCode,l.vmCode,l.serverCode+'/'+l.vmCode])].some(v=>v.toLowerCase().includes(search))));
  // stateCounts: rows per state under every filter except the state itself; groupCounts: per group under every filter except the group.
  const stateCounts:Record<string,number>={ALL:0,OTHER:0};for(const r of scoped) if(groupMatch(r)){stateCounts.ALL++;stateCounts[r.state]=(stateCounts[r.state]||0)+1;if(!MAIN_STATES.includes(r.state)) stateCounts.OTHER++;}
  const stateScoped=filter.state?scoped.filter(r=>stateMatches(r.state,filter.state!)):scoped;
  const groupCounts:Record<string,number>={ALL:stateScoped.length,[GROUP_TUT]:0,[GROUP_SHARED]:0,[GROUP_GENJY]:0,[GROUP_UNKNOWN]:0};
  for(const r of stateScoped){const k=groupKey(r);groupCounts[k]=(groupCounts[k]||0)+1;}
  const filtered=stateScoped.filter(groupMatch);
  sortRegistryRows(filtered,filter.sort);
  return {rows:filtered,counts,servers,groups,groupCounts,stateCounts};
}
async function authorize(scope:ActorScope,copy:boolean,db:PrismaClient){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);assertInfrastructureAction(current,copy?'COPY_CREDENTIALS':'READ');return current;
}
export async function queryRegistry(scope:ActorScope,filter:RegistryFilter,db:PrismaClient=prisma):Promise<RegistryPage>{
  await authorize(scope,false,db);
  if(filter.limit<1||filter.limit>100) throw new ProxyDomainError('INVALID_INPUT');
  const {rows:filtered,counts,servers,groups,groupCounts,stateCounts}=await loadRegistryRows(scope,filter,db);
  let start=0;
  if(filter.cursor){let cursor:string;try{cursor=Buffer.from(filter.cursor,'base64url').toString('utf8');}catch{throw new ProxyDomainError('INVALID_INPUT');}const index=filtered.findIndex(r=>(r.endpointId||r.identityId)===cursor);if(index<0) throw new ProxyDomainError('STALE_PREVIEW','Danh sách đã thay đổi; tải lại');start=index+1;}
  const page=filtered.slice(start,start+filter.limit),last=page[page.length-1];
  return {rows:page,counts,total:filtered.length,servers,groups,groupCounts,stateCounts,nextCursor:start+filter.limit<filtered.length&&last?Buffer.from(last.endpointId||last.identityId).toString('base64url'):null};
}
export async function getProxyTimeline(scope:ActorScope,identityId:string,db:PrismaClient=prisma):Promise<ProxyTimeline>{
  await authorize(scope,false,db);
  const identity=await db.proxyIdentity.findFirst({where:{id:identityId,OR:[{endpoints:{some:{projectId:scope.projectId}}},{sourceRefs:{some:{snapshot:{projectId:scope.projectId}}}}]}});
  if(!identity) throw new ProxyDomainError('NOT_FOUND');
  const replacements=await db.proxyReplacement.findMany({where:{projectId:scope.projectId},include:{oldEndpoint:{include:{identity:true}},newEndpoint:{include:{identity:true}}},orderBy:{recordedAt:'asc'}});
  const connected=new Set([identityId]);let changed=true;
  while(changed){changed=false;for(const r of replacements){const a=r.oldEndpoint.identityId,b=r.newEndpoint.identityId;if(a&&b&&(connected.has(a)||connected.has(b))){if(!connected.has(a)||!connected.has(b)) changed=true;connected.add(a);connected.add(b);}}}
  const ids=Array.from(connected),[events,vms,holds]=await Promise.all([
    db.proxyStatusEvent.findMany({where:{projectId:scope.projectId,identityId:{in:ids}},orderBy:{recordedAt:'asc'}}),
    db.virtualMachine.findMany({where:{server:{projectId:scope.projectId},proxy:{identityId:{in:ids}}},include:{server:{select:{code:true}}}}),
    db.vMProxyAllocation.findMany({where:{projectId:scope.projectId,releasedAt:null,endpoint:{identityId:{in:ids}}},include:{vm:{include:{server:{select:{code:true}}}}}}),
  ]);
  const occupied=new Set(holds.map(h=>h.vmId));
  return {identity:{id:identity.id,ip:identity.ip,owner:identity.owner,subgroup:identity.subgroup,revision:identity.revision,allocationMode:identity.allocationMode},events:events.map(e=>({kind:e.kind,occurredAt:e.occurredAt?.toISOString()||null,recordedAt:e.recordedAt.toISOString(),reversedAt:e.reversedAt?.toISOString()||null,actor:e.actorId,sourceRef:e.sourceRef})),replacements:replacements.filter(r=>r.oldEndpoint.identityId&&connected.has(r.oldEndpoint.identityId)).map(r=>({oldIp:r.oldEndpoint.identity!.ip,newIp:r.newEndpoint.identity!.ip,receivedDate:r.receivedDate?.toISOString().slice(0,10)||null,recordedAt:r.recordedAt.toISOString(),status:r.status as 'APPLIED'|'VOID'})),vmRefs:[...holds.map(h=>h.vm.server.code+'/'+h.vm.code+' · '+(h.role==='DESIRED'?'Chờ cài':h.role==='INSTALLED'?'Đã cài':'Giữ để kiểm tra')),...vms.filter(v=>!occupied.has(v.id)).map(v=>v.server.code+'/'+v.code)]};
}
export async function exportBlocked(scope:ActorScope,db:PrismaClient=prisma){
  await authorize(scope,true,db);
  const rows=await db.proxyIP.findMany({where:{projectId:scope.projectId,inventoryState:'BLOCKED',retiredAt:null},orderBy:[{packageCode:'asc'},{host:'asc'}]});
  const result=rows.flatMap(r=>{const p=decodeEndpoint(r);return p?.format==='FULL'?[{packageCode:r.packageCode||'Chưa rõ gói',proxy:fullProxy(p),status:'BLOCKED' as const}]:[];});
  await db.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'COPY_PROXY_CREDENTIALS',entity:'ProxyIP',entityId:'blocked-export',changes:{count:result.length}}});
  return result;
}
export async function copyProxyEndpoint(scope:ActorScope,endpointId:string,db:PrismaClient=prisma){
  const result=await copyProxyRows(scope,{endpointIds:[endpointId]},db);
  if(!result.proxies.length) throw new ProxyDomainError('INVALID_INPUT','Proxy chưa đủ thông tin');
  return {proxy:result.proxies[0]};
}
export type CopySelection={endpointIds:string[]}|{filter:RowsFilter};
export const MAX_COPY_ROWS=2000;
// Full proxies for selected rows (display order) or for a whole filtered result. Copying from the registry never changes
// allocation or install state; it only logs how many credentials left the server, never the credentials themselves.
export async function copyProxyRows(scope:ActorScope,selection:CopySelection,db:PrismaClient=prisma):Promise<CopyResult>{
  await authorize(scope,true,db);
  let ordered:{endpointId:string|null}[];
  if('endpointIds' in selection){
    const ids=Array.from(new Set(selection.endpointIds));if(!ids.length||ids.length>MAX_COPY_ROWS) throw new ProxyDomainError('INVALID_INPUT');
    const found=new Set((await db.proxyIP.findMany({where:{id:{in:ids},projectId:scope.projectId,identityId:{not:null}},select:{id:true}})).map(e=>e.id));
    if(found.size!==ids.length) throw new ProxyDomainError('NOT_FOUND','Có dòng không thuộc dự án này');
    ordered=ids.map(id=>({endpointId:id}));
  } else ordered=(await loadRegistryRows(scope,selection.filter,db)).rows;
  const ids=ordered.flatMap(r=>r.endpointId?[r.endpointId]:[]);
  const endpoints=new Map((await db.proxyIP.findMany({where:{id:{in:ids},projectId:scope.projectId}})).map(e=>[e.id,e]));
  const proxies:string[]=[],skipped:Record<CopySkipReason,number>={NO_CREDENTIALS:0,NO_ENDPOINT:0};
  for(const r of ordered){
    const e=r.endpointId?endpoints.get(r.endpointId):undefined;if(!e){skipped.NO_ENDPOINT++;continue;}
    const p=decodeEndpoint(e);if(p?.format==='FULL') proxies.push(fullProxy(p));else skipped.NO_CREDENTIALS++;
  }
  const result:CopyResult={proxies,copied:proxies.length,total:ordered.length,skipped:(Object.keys(skipped) as CopySkipReason[]).filter(k=>skipped[k]>0).map(reason=>({reason,count:skipped[reason]}))};
  if(proxies.length) await db.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'COPY_PROXY_CREDENTIALS',entity:'ProxyIP',entityId:'endpointIds' in selection&&ids.length===1?ids[0]:'bulk-copy',changes:{count:proxies.length,total:ordered.length,skipped:result.skipped}}});
  return result;
}
