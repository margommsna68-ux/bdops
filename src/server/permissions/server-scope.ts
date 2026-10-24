import type {Prisma,PrismaClient} from '@prisma/client';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {loadInfrastructureScope} from './infrastructure';
export type ScopeDB=PrismaClient|Prisma.TransactionClient;
export const hasServerScope=(s:ActorScope)=>Array.isArray(s.serverIds);
export const serverWhere=(s:ActorScope)=>hasServerScope(s)?{id:{in:s.serverIds!}}:{};
export const vmWhere=(s:ActorScope)=>hasServerScope(s)?{serverId:{in:s.serverIds!}}:{};
export const sdkWhere=(s:ActorScope):Prisma.SdkRecordWhereInput=>hasServerScope(s)?{OR:[{holder:{serverId:{in:s.serverIds!}}},{holderVmId:null,vm:{serverId:{in:s.serverIds!}}}]}:{};
// Only active holds, the legacy VM link, or configurations currently selected by a VM prove a binding.
// VMConfiguration.vm is history: it must never grant access after both current pointers have moved on.
export const endpointWhere=(s:ActorScope):Prisma.ProxyIPWhereInput=>hasServerScope(s)?{OR:[
 {allocations:{some:{releasedAt:null,vm:{serverId:{in:s.serverIds!}}}}},
 {vm:{serverId:{in:s.serverIds!}}},
 {vmConfigurations:{some:{OR:[{desiredBy:{serverId:{in:s.serverIds!}}},{installedBy:{serverId:{in:s.serverIds!}}}]}}},
]}:{};
const deny=()=>{throw new ProxyDomainError('NOT_FOUND','Không tìm thấy dữ liệu trong phạm vi server được giao');};
const unique=(ids:readonly string[])=>[...new Set(ids)];
export async function assertScopedServerIds(db:ScopeDB,s:ActorScope,ids:readonly string[]){const scope=await loadInfrastructureScope(db,s.userId,s.projectId);if(!hasServerScope(scope)||!ids.length)return;const all=unique(ids),rows=await db.server.findMany({where:{projectId:s.projectId,AND:[{id:{in:all}},serverWhere(scope)]},select:{id:true}});if(rows.length!==all.length)deny();}
export async function assertScopedVmIds(db:ScopeDB,s:ActorScope,ids:readonly string[]){const scope=await loadInfrastructureScope(db,s.userId,s.projectId);if(!hasServerScope(scope)||!ids.length)return;const all=unique(ids),rows=await db.virtualMachine.findMany({where:{id:{in:all},server:{projectId:s.projectId},...vmWhere(scope)},select:{id:true}});if(rows.length!==all.length)deny();}
export async function assertScopedSdkIds(db:ScopeDB,s:ActorScope,ids:readonly string[]){const scope=await loadInfrastructureScope(db,s.userId,s.projectId);if(!hasServerScope(scope)||!ids.length)return;const all=unique(ids),rows=await db.sdkRecord.findMany({where:{id:{in:all},projectId:s.projectId,...sdkWhere(scope)},select:{id:true,vmId:true,holderVmId:true}});if(rows.length!==all.length)deny();for(const r of rows)await assertScopedVmIds(db,scope,[r.vmId,r.holderVmId].filter((id):id is string=>!!id));}
export async function assertScopedSdkCodes(db:ScopeDB,s:ActorScope,codes:readonly string[],opts:{allowNew?:boolean}={}){const scope=await loadInfrastructureScope(db,s.userId,s.projectId);if(!hasServerScope(scope)||!codes.length)return;const all=unique(codes),rows=await db.sdkRecord.findMany({where:{projectId:s.projectId,code:{in:all}},select:{id:true}});if(!opts.allowNew&&rows.length!==all.length)deny();await assertScopedSdkIds(db,scope,rows.map(r=>r.id));}
export async function assertScopedEndpointIds(db:ScopeDB,s:ActorScope,ids:readonly string[],opts:{write?:boolean}={}){
 const scope=await loadInfrastructureScope(db,s.userId,s.projectId);if(!hasServerScope(scope)||!ids.length)return;
 const all=unique(ids),rows=await db.proxyIP.findMany({
  where:{id:{in:all},projectId:s.projectId,...endpointWhere(scope)},
  select:{id:true,vm:{select:{serverId:true}},allocations:{where:{releasedAt:null},select:{vm:{select:{serverId:true}}}},
   vmConfigurations:{where:{OR:[{desiredBy:{isNot:null}},{installedBy:{isNot:null}}]},select:{desiredBy:{select:{serverId:true}},installedBy:{select:{serverId:true}}}}},
 });
 if(rows.length!==all.length)deny();
 // Read access needs one allowed binding. A write must be safe for every current binding, including config-only VMs.
 if(opts.write)for(const r of rows){
  const servers=[r.vm?.serverId,...r.allocations.map(a=>a.vm.serverId),...r.vmConfigurations.flatMap(c=>[c.desiredBy?.serverId,c.installedBy?.serverId])];
  if(servers.some(id=>id&&!scope.serverIds!.includes(id)))deny();
 }
}
// Resolve indirect command identities from the database, never from caller-supplied server labels.
export async function assertScopedTargets(db:ScopeDB,s:ActorScope,input:unknown,opts:{write?:boolean}={}){
 const scope=await loadInfrastructureScope(db,s.userId,s.projectId);if(!hasServerScope(scope))return;
 const ids:Record<string,string[]>={vmId:[],serverId:[],sdkId:[],endpointId:[],jobId:[],taskId:[],configurationId:[],earnAppId:[],requestId:[]};
 function scan(v:unknown){if(!v||typeof v!=='object')return;for(const [k,x] of Object.entries(v)){const singular=k==='expectedEndpointId'?'endpointId':k.endsWith('Ids')?k.slice(0,-1):k;if(Object.prototype.hasOwnProperty.call(ids,singular)){if(typeof x==='string')ids[singular].push(x);else if(Array.isArray(x))ids[singular].push(...x.filter((i):i is string=>typeof i==='string'));}else if(k==='earnAppAccountId'&&typeof x==='string')ids.earnAppId.push(x);if(x&&typeof x==='object'){if(Array.isArray(x))x.forEach(scan);else scan(x);}}}
 scan(input);await assertScopedServerIds(db,scope,ids.serverId);await assertScopedVmIds(db,scope,ids.vmId);await assertScopedSdkIds(db,scope,ids.sdkId);await assertScopedEndpointIds(db,scope,ids.endpointId,{write:opts.write!==false});
 for(const key of ['jobId','taskId','configurationId','earnAppId','requestId'] as const){if(!ids[key].length)continue;const wanted=unique(ids[key]);let vms:(string|null)[]=[];
  if(key==='jobId'){const rows=await db.vmJob.findMany({where:{id:{in:wanted},projectId:s.projectId},select:{vmId:true}});if(rows.length!==wanted.length)deny();vms=rows.map(r=>r.vmId);}
  if(key==='taskId'){const rows=await db.vMTask.findMany({where:{id:{in:wanted},vm:{server:{projectId:s.projectId}}},select:{vmId:true}});if(rows.length!==wanted.length)deny();vms=rows.map(r=>r.vmId);}
  if(key==='configurationId'){const rows=await db.vMConfiguration.findMany({where:{id:{in:wanted},projectId:s.projectId},select:{vmId:true}});if(rows.length!==wanted.length)deny();vms=rows.map(r=>r.vmId);}
  if(key==='earnAppId'){const rows=await db.earnAppAccount.findMany({where:{id:{in:wanted},projectId:s.projectId},select:{vmId:true}});if(rows.length!==wanted.length||rows.some(r=>!r.vmId))deny();vms=rows.map(r=>r.vmId);}
  if(key==='requestId'){const rows=await db.earnPayoutRequest.findMany({where:{id:{in:wanted},projectId:s.projectId},select:{vmId:true}});if(rows.length!==wanted.length)deny();vms=rows.map(r=>r.vmId);}
  if(vms.some(v=>!v))deny();await assertScopedVmIds(db,scope,vms as string[]);
 }
}
export async function assertUnrestrictedServers(db:ScopeDB,s:ActorScope){if(hasServerScope(await loadInfrastructureScope(db,s.userId,s.projectId)))throw new ProxyDomainError('FORBIDDEN','Thao tác kho chung do ADMIN hoặc người có quyền toàn bộ server thực hiện');}
