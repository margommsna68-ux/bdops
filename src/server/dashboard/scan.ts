import {z} from 'zod';
import type {PrismaClient,Prisma} from '@prisma/client';
import type {ScanHealth} from '@/lib/business-pulse';
import {MonitorObservation} from '@/lib/monitor-policy';
import {assertMonitorCanary} from './monitor';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {authorizeVM} from '../vm-management/repository';
import {runBusinessCommand} from '../business-management/idempotency';
import {assertSdkMoneyWrite} from '../vm-management/sdk-money-rights';
import {observeAmount} from '../vm-management/sdk-observe';

const uuid=/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Only an explicitly recorded machine UUID, not a name alias or arbitrary UUID in prose. */
export function machineUuid(notes:string|null){
 const lines=(notes??'').split(/\r?\n/).filter(l=>/UUID\s*(máy|VM)?\s*[:=]/i.test(l));
 const ids=[...new Set(lines.flatMap(l=>l.match(uuid)??[]).map(v=>v.toLowerCase()))];return ids.length===1?ids[0]:null;
}
export const ScanBody=z.object({projectId:z.string().min(1).max(64),expectedCycle:z.number().int().min(1),expectedVmRevision:z.number().int().min(0),
 machineUuid:z.string().uuid(),configurationId:z.string().nullable(),observedAt:z.string().datetime({offset:true}),
 earning:z.boolean().nullable(),problem:z.enum(['EARNAPP','PROXY_CONNECTION','PROXY_AUTH','PROXY_EXPIRED','PROXY_BLOCKED','VM_OFF']).nullable(),
 earningObservedAt:z.string().datetime({offset:true}).optional(),
 monitor:MonitorObservation.optional(),
 money:z.object({sdkId:z.string(),expectedSdkRevision:z.number().int().min(0),capturedAt:z.string().datetime({offset:true}),observedAt:z.string().datetime({offset:true}),amount:z.string().regex(/^\d{1,10}(\.\d{1,6})?$/).nullable()}).strict().optional(),
}).strict();
export type ScanInput=z.infer<typeof ScanBody>&{vmId:string;key:string};
export function readScanHealth(detail:Prisma.JsonValue|null,configurationId:string|null,currentUuid:string|null,binding?:{projectId:string;serverId:string;cycle:number;revision:number}):ScanHealth|null{
 if(!detail||typeof detail!=='object'||Array.isArray(detail))return null;
 if(!currentUuid||detail.machineUuid!==currentUuid)return null;
 if(detail.configurationId!==configurationId||typeof detail.at!=='string'||!Number.isFinite(Date.parse(detail.at)))return null;
 if(detail.earning!==null&&typeof detail.earning!=='boolean')return null;
 if(detail.problem!==null&&!['EARNAPP','PROXY_CONNECTION','PROXY_AUTH','PROXY_EXPIRED','PROXY_BLOCKED','VM_OFF'].includes(String(detail.problem)))return null;
 const earningAt=typeof detail.earningObservedAt==='string'?detail.earningObservedAt:detail.at;
 if(!Number.isFinite(Date.parse(earningAt))||Date.parse(earningAt)>Date.parse(detail.at))return null;
 const monitor=MonitorObservation.safeParse(detail.monitor);
 if(detail.monitor&&(!monitor.success||binding&&(detail.projectId!==binding.projectId||detail.serverId!==binding.serverId||detail.cycle!==binding.cycle||detail.vmRevision!==binding.revision)))return null;
 return {at:earningAt,observedAt:detail.at,earning:detail.earning as boolean|null,problem:detail.problem as ScanHealth['problem'],...(typeof detail.receivedAt==='string'?{receivedAt:detail.receivedAt}:{}),...(monitor.success?{monitor:monitor.data}:{})};
}
const conflict=(text:string)=>new ProxyDomainError('STALE_PREVIEW',text,'REVISION_CONFLICT');
/** An observation only: no status, configuration, SDK placement, VM job or account is changed. */
export async function recordGen2Scan(scope:ActorScope,input:ScanInput,db:PrismaClient){
 const {key,vmId,...raw}=input,b=ScanBody.parse(raw),payload={vmId,...b};
 return runBusinessCommand(scope,{key,payload,kind:'GEN2_SCAN',module:'INFRASTRUCTURE',reversible:false,authorize:tx=>authorizeVM(scope,'ASSIGN',tx)},async(tx,images,current)=>{
  const v=await tx.virtualMachine.findFirst({where:{id:vmId,managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},include:{operation:true,sdkRecord:true,desiredConfiguration:true}});
  if(!v)throw new ProxyDomainError('NOT_FOUND');
  if((v.operation?.cycle??1)!==b.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW','VM đã sang lượt khác','CYCLE_CHANGED');
  if(v.revision!==b.expectedVmRevision||v.desiredConfigurationId!==b.configurationId)throw conflict('VM hoặc proxy đã thay đổi; chờ lượt quét mới');
  if(machineUuid(v.notes)!==b.machineUuid.toLowerCase())throw conflict('UUID máy chưa khớp với VM trên web');
  const cycle=await tx.vmCycle.findFirst({where:{vmId,projectId:scope.projectId},orderBy:{number:'desc'},select:{closedAt:true}});
  const at=new Date(b.observedAt),barrier=Math.max(v.createdAt.getTime(),cycle?.closedAt.getTime()??0,v.desiredConfiguration?.createdAt.getTime()??0);
  if(at.getTime()<barrier||at.getTime()>Date.now()+5*60000)throw conflict('Lần quét không thuộc cấu hình/lượt VM hiện tại');
  if(b.earningObservedAt){
   const earningTime=Date.parse(b.earningObservedAt);
   if(earningTime<barrier||earningTime>at.getTime()||earningTime>Date.now())throw conflict('Bằng chứng kiếm tiền không thuộc thời điểm quan sát / cấu hình này');
  }
  if(b.monitor){
   assertMonitorCanary(scope.projectId,v.serverId);
   if(at.getTime()>Date.now())throw new ProxyDomainError('INVALID_INPUT','Quan sát monitor ở tương lai','VALIDATION');
   for(const axis of [b.monitor.vmState,b.monitor.guest,b.monitor.network,b.monitor.proxy,b.monitor.app])if(axis&&(Date.parse(axis.observedAt)>at.getTime()||Date.parse(axis.observedAt)<barrier))throw conflict('Thời điểm trục giám sát không thuộc quan sát / cấu hình này');
   const p=b.monitor.proxy;
   if(p&&(p.endpointId!==v.desiredConfiguration?.endpointId||p.appliedConfigurationId!==null&&(p.appliedConfigurationId!==v.desiredConfigurationId||p.provenance==='GUEST'&&p.appliedConfigurationId!==v.installedConfigurationId)))throw conflict('Bằng chứng proxy không khớp endpoint / cấu hình đang áp dụng');
  }
  let money=null;
  if(b.money){
   await assertSdkMoneyWrite(current,tx);const m=b.money,rec=v.sdkRecord,seen=new Date(m.observedAt),captured=new Date(m.capturedAt);
   if(!rec||rec.id!==m.sdkId||rec.revision!==m.expectedSdkRevision)throw conflict('SDK hiện hành đã đổi; chờ lượt quét mới');
   if(!Number.isFinite(captured.getTime())||captured.getTime()<barrier||seen<captured||seen.getTime()>Date.now()+5*60000||rec.placedAt&&seen<rec.placedAt)throw conflict('Tiền được đọc trước lúc chụp định danh hiện hành; chờ lượt quét mới');
   money=await observeAmount(tx,{projectId:scope.projectId,actorId:current.userId,images,now:new Date(),via:'GEN2 · kết quả quét sẵn'},rec,m.amount,seen,'GEN2',null,{vmId,cycle:b.expectedCycle});
  }
  const after=await tx.virtualMachine.findUniqueOrThrow({where:{id:vmId},select:{revision:true,sdkRecord:{select:{revision:true}}}});
  const detail={at:at.toISOString(),observedAt:at.toISOString(),receivedAt:new Date().toISOString(),projectId:scope.projectId,serverId:v.serverId,vmId,cycle:b.expectedCycle,expectedVmRevision:b.expectedVmRevision,vmRevision:after.revision,earning:b.earning,problem:b.problem,configurationId:b.configurationId,machineUuid:b.machineUuid.toLowerCase(),...(b.earningObservedAt?{earningObservedAt:new Date(b.earningObservedAt).toISOString()}:{}),...(b.monitor?{monitor:b.monitor}:{})};
  const event=await tx.vmOpsEvent.create({data:{projectId:scope.projectId,vmId,cycle:b.expectedCycle,kind:'GEN2_SCAN',detail,actorId:current.userId}});
  return {id:event.id,vmId,cycle:b.expectedCycle,observedAt:detail.at,money,vmRevisionAfter:after.revision,sdkRevisionAfter:after.sdkRecord?.revision??null};
 },db);
}
