import {randomBytes} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {ProxyDomainError,type ActorScope,type SourceSnapshotRef} from '../proxy-management/types';
import {getEligibleInventory,decodeEndpoint} from '../proxy-management/repository';
import {refreshGenjy} from '../proxy-management/sources';
import {withProxyTransaction} from '../proxy-management/transaction';
import {recordOperation} from '../operation-history/journal';
import {readImage,type ResourceImage,type OperationSnapshot} from '../operation-history/snapshot';
import {authorizeVM,requireGenjy,readManagedVMs,type VMReader} from './repository';
import {syncAssignmentState} from '../proxy-management/assignment-state';
import {vmHash,type AllocationInput,type AllocationPreview,type AllocationRow,type ConfigurationSnapshot} from './types';
async function planAllocation(projectId:string,input:AllocationInput,db:VMReader){
  if(!['AUTO','MANUAL'].includes(input.mode)||input.vmIds&&(!input.vmIds.length||input.vmIds.length>1000||new Set(input.vmIds).size!==input.vmIds.length)||input.mode==='MANUAL'&&(!input.endpointId||input.vmIds?.length!==1))throw new ProxyDomainError('INVALID_INPUT');
  const all=await readManagedVMs(projectId,db),vms=all.filter(v=>(!input.serverId||v.serverId===input.serverId)&&(!input.vmIds||input.vmIds.includes(v.id)));
  if(input.vmIds&&vms.length!==input.vmIds.length||input.serverId&&!await db.server.findFirst({where:{id:input.serverId,projectId,managed:true}}))throw new ProxyDomainError('NOT_FOUND');
  const pool=(await getEligibleInventory(projectId,db)).sort((a,b)=>a.ip.localeCompare(b.ip,undefined,{numeric:true}));
  const rows:AllocationRow[]=[],items:{vmId:string;endpointId:string;reuseInstalled:boolean}[]=[];
  for(const vm of vms){
    const row:AllocationRow={vmId:vm.id,server:vm.server.code,vm:vm.code,outcome:'SKIP',message:'VM chưa đủ điều kiện'};
    if(vm.archivedAt||vm.server.archivedAt){rows.push({...row,message:'Máy đã xoá'});continue;}
    if(input.mode==='AUTO'&&(vm.proxySlotState!=='BLANK'||vm.desiredConfigurationId||vm.installedConfigurationId||vm.proxyId||vm.allocations.length)){rows.push({...row,message:'Giữ nguyên: không phải ô proxy trống chưa giao'});continue;}
    let endpoint=pool.find(e=>input.mode==='AUTO'||e.endpointId===input.endpointId),reuseInstalled=false;
    if(input.mode==='MANUAL'&&vm.desiredConfiguration?.endpointId===input.endpointId){rows.push({...row,message:'Proxy đã là cấu hình đang giao'});continue;}
    if(!endpoint&&input.mode==='MANUAL'){
      const hold=vm.allocations.find(a=>a.endpointId===input.endpointId&&a.role==='INSTALLED');
      const existing=hold?await db.proxyIP.findFirst({where:{id:hold.endpointId,projectId,retiredAt:null,inventoryState:{in:['NEW','LIVE']},identity:{owner:'SELF'}},include:{identity:true}}):null;
      if(existing?.identity&&existing.port&&existing.inventoryKey&&existing.credentialCipher&&existing.packageCode){endpoint={identityId:existing.identity.id,endpointId:existing.id,ip:existing.identity.ip,port:existing.port,revision:existing.revision,allocationKey:existing.inventoryKey};reuseInstalled=true;}
    }
    if(!endpoint){rows.push({...row,outcome:'ERROR',message:input.mode==='AUTO'?'Thiếu proxy NEW TUT chưa dùng':'Proxy chưa đủ điều kiện hoặc đã được giữ cho máy khác'});continue;}
    rows.push({...row,outcome:'READY',message:reuseInstalled?'Giao lại cấu hình đã cài; cần xác nhận mới':'Giao proxy; chờ cài thực tế',ip:endpoint.ip,endpointId:endpoint.endpointId});items.push({vmId:vm.id,endpointId:endpoint.endpointId,reuseInstalled});
    const index=pool.findIndex(e=>e.endpointId===endpoint!.endpointId);if(index>=0)pool.splice(index,1);
  }
  return {rows,items,facts:{vms:vms.map(v=>[v.id,v.revision,v.server.revision,v.desiredConfiguration?.revision??null,v.installedConfiguration?.revision??null,v.allocations.map(a=>[a.id,a.revision])]),pool:await getEligibleInventory(projectId,db)}};
}
export async function snapshotCollector(tx:Prisma.TransactionClient,scope:ActorScope){
  const images=new Map<string,{resource:ResourceImage['resource'];id:string;before:unknown}>();
  const remember=async(resource:ResourceImage['resource'],id:string,created=false)=>{const key=resource+'/'+id;if(!images.has(key))images.set(key,{resource,id,before:created?null:await readImage(tx,scope.projectId,resource,id)});};
  const finish=async():Promise<OperationSnapshot>=>{const resources:ResourceImage[]=[];for(const image of Array.from(images.values()))resources.push({...image,after:await readImage(tx,scope.projectId,image.resource,image.id)} as ResourceImage);return {version:2,resources,eventIds:[],replacementIds:[]};};return {remember,finish};
}
export function createVMService(db:PrismaClient=prisma,deps:{refreshSource?:(projectId:string,db:PrismaClient)=>Promise<SourceSnapshotRef>;afterWrite?:(tx:Prisma.TransactionClient)=>void|Promise<void>}={}){
  const refresh=deps.refreshSource||refreshGenjy;
  const dto=(batch:{token:string;previewRows:Prisma.JsonValue})=>{const rows=batch.previewRows as unknown as AllocationRow[];return {token:batch.token,rows,ready:rows.filter(r=>r.outcome==='READY').length,errors:rows.filter(r=>r.outcome==='ERROR').length,skipped:rows.filter(r=>r.outcome==='SKIP').length};};
  async function preview(scope:ActorScope,input:AllocationInput):Promise<AllocationPreview>{
    await authorizeVM(scope,'ASSIGN',db);const hash=vmHash(input),prior=await db.proxyBatch.findUnique({where:{projectId_idempotencyKey:{projectId:scope.projectId,idempotencyKey:input.idempotencyKey}}});
    if(prior){if(prior.actorId!==scope.userId)throw new ProxyDomainError('FORBIDDEN');if(prior.kind!=='VM_ALLOCATION'||prior.payloadHash!==hash)throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');if(prior.status==='APPLIED')return dto(prior);}
    const source=await requireGenjy(scope,db,refresh),plan=await planAllocation(scope.projectId,input,db),data={actorId:scope.userId,kind:'VM_ALLOCATION',payloadHash:hash,token:randomBytes(32).toString('base64url'),encryptedPlan:encrypt(JSON.stringify({input,plan})),sourceHash:source.hash,revisionFacts:plan.facts as unknown as Prisma.InputJsonValue,previewRows:plan.rows as unknown as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+600000)};
    const batch=prior?await db.proxyBatch.update({where:{id:prior.id},data}):await db.proxyBatch.create({data:{...data,projectId:scope.projectId,idempotencyKey:input.idempotencyKey}});return dto(batch);
  }
  async function commit(scope:ActorScope,token:string,key:string){
    await authorizeVM(scope,'ASSIGN',db);const original=await db.proxyBatch.findFirst({where:{token,projectId:scope.projectId,actorId:scope.userId,kind:'VM_ALLOCATION'}});if(!original)throw new ProxyDomainError('NOT_FOUND');if(original.idempotencyKey!==key)throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');
    const replay=async(reader:VMReader,batch:NonNullable<typeof original>)=>{const op=await reader.operationJournal.findUnique({where:{batchId:batch.id}}),undo=op?await reader.operationJournal.findUnique({where:{undoOfId:op.id}}):null;return {...batch.result as unknown as {batchId:string;applied:number;errors:number;rows:AllocationRow[]},replay:true,undone:!!undo};};
    if(original.status==='APPLIED')return replay(db,original);if(original.expiresAt.getTime()<=Date.now())throw new ProxyDomainError('STALE_PREVIEW');const source=await requireGenjy(scope,db,refresh);
    return withProxyTransaction(async tx=>{
      const current=await authorizeVM(scope,'ASSIGN',tx),batch=await tx.proxyBatch.findUniqueOrThrow({where:{id:original.id}});if(batch.status==='APPLIED')return replay(tx,batch);
      const latest=await tx.proxySourceSnapshot.findFirst({where:{projectId:scope.projectId,sourceKey:'GENJY'},orderBy:{fetchedAt:'desc'}});if(!latest?.scanSucceeded)throw new ProxyDomainError('SOURCE_UNAVAILABLE');if(latest.hash!==source.hash)throw new ProxyDomainError('STALE_PREVIEW','Nguồn Genjy đã đổi; kiểm tra lại');
      if(batch.token!==token||batch.expiresAt.getTime()<=Date.now())throw new ProxyDomainError('STALE_PREVIEW');
      const saved=JSON.parse(decrypt(batch.encryptedPlan)) as {input:AllocationInput;plan:Awaited<ReturnType<typeof planAllocation>>};if(vmHash(saved.input)!==batch.payloadHash)throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');
      const plan=await planAllocation(scope.projectId,saved.input,tx);if(source.hash!==batch.sourceHash||vmHash(plan)!==vmHash(saved.plan))throw new ProxyDomainError('STALE_PREVIEW','Danh sách VM/proxy đã thay đổi; kiểm tra lại');
      const images=await snapshotCollector(tx,current);
      for(const item of plan.items){
        const vm=await tx.virtualMachine.findFirstOrThrow({where:{id:item.vmId,managed:true,server:{projectId:scope.projectId,managed:true}},include:{server:true,desiredConfiguration:{include:{task:true}}}});
        await images.remember('VM',vm.id);await images.remember('ENDPOINT',item.endpointId);
        const old=vm.desiredConfiguration;
        if(old&&old.id!==vm.installedConfigurationId){
          await images.remember('VM_CONFIG',old.id);await tx.vMConfiguration.update({where:{id:old.id},data:{status:'CANCELLED',revision:{increment:1}}});
          if(old.task){await images.remember('VM_TASK',old.task.id);await tx.vMTask.update({where:{id:old.task.id},data:{status:'CANCELLED'}});}
          const holds=await tx.vMProxyAllocation.findMany({where:{vmId:vm.id,configurationId:old.id,role:'DESIRED',releasedAt:null}});
          for(const hold of holds){await images.remember('VM_ALLOCATION',hold.id);await images.remember('ENDPOINT',hold.endpointId);await tx.vMProxyAllocation.update({where:{id:hold.id},data:old.startedAt?{role:'UNCERTAIN',revision:{increment:1}}:{releasedAt:new Date(),releaseReason:'Thay kế hoạch chưa bắt đầu',revision:{increment:1}}});await tx.proxyIP.update({where:{id:hold.endpointId},data:{revision:{increment:1}}});await syncAssignmentState(tx,hold.endpointId,{released:!old.startedAt});}
        }
        const endpoint=await tx.proxyIP.findFirstOrThrow({where:{id:item.endpointId,projectId:scope.projectId},include:{identity:true}}),proxy=decodeEndpoint(endpoint);
        if(!proxy||proxy.format!=='FULL'||!endpoint.identity||endpoint.identity.owner!=='SELF'||!endpoint.inventoryKey)throw new ProxyDomainError('OWNER_CONFLICT');
        const snapshot:ConfigurationSnapshot={proxy,packageCode:endpoint.packageCode,identityId:endpoint.identity.id,endpointRevision:endpoint.revision,server:vm.server.code,vm:vm.code};
        const config=await tx.vMConfiguration.create({data:{projectId:scope.projectId,vmId:vm.id,version:vm.configurationSequence+1,endpointId:endpoint.id,snapshotCipher:encrypt(JSON.stringify(snapshot)),configurationHash:vmHash(snapshot),createdById:scope.userId}});await images.remember('VM_CONFIG',config.id,true);
        if(!item.reuseInstalled){const hold=await tx.vMProxyAllocation.create({data:{projectId:scope.projectId,vmId:vm.id,endpointId:endpoint.id,configurationId:config.id,allocationKey:endpoint.inventoryKey,role:'DESIRED',createdById:scope.userId}});await images.remember('VM_ALLOCATION',hold.id,true);}
        const task=await tx.vMTask.create({data:{vmId:vm.id,configurationId:config.id,type:'PROXY_INSTALL',title:`Cài proxy ${proxy.ip} · cấu hình #${config.version}`,scheduledAt:new Date()}});await images.remember('VM_TASK',task.id,true);
        await tx.proxyIP.update({where:{id:endpoint.id},data:{revision:{increment:1}}});await syncAssignmentState(tx,endpoint.id);await tx.virtualMachine.update({where:{id:vm.id},data:{desiredConfigurationId:config.id,configurationSequence:{increment:1},proxySlotState:'FULL',revision:{increment:1}}});await deps.afterWrite?.(tx);
      }
      const result={batchId:batch.id,applied:plan.items.length,errors:plan.rows.filter(r=>r.outcome==='ERROR').length,rows:plan.rows,replay:false,undone:false};
      if(plan.items.length)await recordOperation(tx,{scope:current,kind:'VM_PLAN',summary:{count:plan.items.length},snapshot:await images.finish(),batchId:batch.id});
      await tx.proxyBatch.update({where:{id:batch.id},data:{status:'APPLIED',appliedAt:new Date(),result:result as unknown as Prisma.InputJsonValue}});await tx.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'VM_ALLOCATION',entity:'ProxyBatch',entityId:batch.id,changes:{count:plan.items.length}}});return result;
    },db);
  }
  return {preview,commit};
}
