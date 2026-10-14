import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {assertInfrastructureAction,loadInfrastructureScope} from '@/server/permissions/infrastructure';
import {decodeEndpoint} from './repository';
import {fullProxy} from './parse';
import {ProxyDomainError,type ActorScope,type ProxyTimeline,type RegistryFilter,type RegistryPage,type RegistryRow} from './types';
async function authorize(scope:ActorScope,copy:boolean,db:PrismaClient){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);assertInfrastructureAction(current,copy?'COPY_CREDENTIALS':'READ');return current;
}
export async function queryRegistry(scope:ActorScope,filter:RegistryFilter,db:PrismaClient=prisma):Promise<RegistryPage>{
  await authorize(scope,false,db);
  if(filter.limit<1||filter.limit>100) throw new ProxyDomainError('INVALID_INPUT');
  const [endpoints,reserved]=await Promise.all([
    db.proxyIP.findMany({where:{projectId:scope.projectId,identityId:{not:null}},include:{identity:{include:{sourceRefs:{where:{snapshot:{projectId:scope.projectId}}}}},vm:{include:{server:true}},allocations:{where:{releasedAt:null},include:{vm:{include:{server:true}}}}}}),
    db.proxyIdentity.findMany({where:{owner:'GENJY',sourceRefs:{some:{snapshot:{projectId:scope.projectId}}}},include:{sourceRefs:{where:{snapshot:{projectId:scope.projectId}}}}}),
  ]);
  const rows:RegistryRow[]=endpoints.flatMap(e=>e.identity?[{identityId:e.identity.id,endpointId:e.id,ip:e.identity.ip,port:e.port,owner:e.identity.owner,subgroup:e.identity.subgroup,packageCode:e.packageCode,state:e.inventoryState,revision:e.revision,sourceRefs:Array.from(new Set(e.identity.sourceRefs.map(s=>s.sourceRef))),vmRefs:e.allocations.length?e.allocations.map(a=>a.vm.server.code+'/'+a.vm.code+' · '+(a.role==='DESIRED'?'Chờ cài':a.role==='INSTALLED'?'Đã cài':'Giữ để kiểm tra')):e.vm?[e.vm.server.code+'/'+e.vm.code]:[],statusAt:e.statusAt?.toISOString()||null}]:[]);
  const linked=new Set(endpoints.map(e=>e.identityId));
  for(const i of reserved) if(!linked.has(i.id)) rows.push({identityId:i.id,endpointId:null,ip:i.ip,port:null,owner:'GENJY',subgroup:i.subgroup,packageCode:null,state:'QUARANTINED',revision:i.revision,sourceRefs:Array.from(new Set(i.sourceRefs.map(s=>s.sourceRef))),vmRefs:[],statusAt:null});
  const counts={current:rows.filter(r=>!!r.endpointId&&r.owner==='SELF'&&!['REPLACED','VOID','QUARANTINED'].includes(r.state)).length,historical:rows.filter(r=>['REPLACED','VOID'].includes(r.state)).length,reserved:new Set(rows.filter(r=>r.owner==='GENJY').map(r=>r.identityId)).size,quarantined:rows.filter(r=>!!r.endpointId&&r.state==='QUARANTINED').length};
  const search=filter.search?.trim().toLowerCase();
  const filtered=rows.filter(r=>
    (filter.view==='ALL'||(filter.view==='HISTORY'?['REPLACED','VOID'].includes(r.state):!['REPLACED','VOID'].includes(r.state)))&&
    (!filter.owner||r.owner===filter.owner)&&(!filter.state||r.state===filter.state)&&(!filter.packageCode||r.packageCode===filter.packageCode)&&
    (!search||[r.ip,r.packageCode||'',...r.vmRefs].some(v=>v.toLowerCase().includes(search))));
  const numericIP=(ip:string)=>ip.split('.').reduce((n,part)=>n*256+Number(part),0);
  filtered.sort((a,b)=>Number(a.packageCode===null)-Number(b.packageCode===null)||(a.packageCode||'').localeCompare(b.packageCode||'',undefined,{numeric:true})||numericIP(a.ip)-numericIP(b.ip)||(a.port||0)-(b.port||0)||(a.endpointId||a.identityId).localeCompare(b.endpointId||b.identityId));
  let start=0;
  if(filter.cursor){let cursor:string;try{cursor=Buffer.from(filter.cursor,'base64url').toString('utf8');}catch{throw new ProxyDomainError('INVALID_INPUT');}const index=filtered.findIndex(r=>(r.endpointId||r.identityId)===cursor);if(index<0) throw new ProxyDomainError('STALE_PREVIEW','Danh sách đã thay đổi; tải lại');start=index+1;}
  const page=filtered.slice(start,start+filter.limit),last=page[page.length-1];
  return {rows:page,counts,nextCursor:start+filter.limit<filtered.length&&last?Buffer.from(last.endpointId||last.identityId).toString('base64url'):null};
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
  await authorize(scope,true,db);
  if(await db.vMProxyAllocation.findFirst({where:{projectId:scope.projectId,endpointId,releasedAt:null},select:{id:true}}))throw new ProxyDomainError('INVALID_INPUT','Proxy đang giữ cho VM. Copy cấu hình tại Việc cài hoặc Server/VM để giữ đúng phiên bản và lịch sử.');
  const endpoint=await db.proxyIP.findFirst({where:{id:endpointId,projectId:scope.projectId,identityId:{not:null}}});
  if(!endpoint) throw new ProxyDomainError('NOT_FOUND');
  const p=decodeEndpoint(endpoint);if(!p||p.format!=='FULL') throw new ProxyDomainError('INVALID_INPUT','Proxy chưa đủ thông tin');
  await db.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'COPY_PROXY_CREDENTIALS',entity:'ProxyIP',entityId:endpointId,changes:{count:1}}});
  return {proxy:fullProxy(p)};
}
