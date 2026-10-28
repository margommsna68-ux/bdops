import {z} from 'zod';
import type {FleetCommand,Prisma} from '@prisma/client';
import type {ActorScope} from '../proxy-management/types';
import {ProxyDomainError} from '../proxy-management/types';
import {authorizeVM} from '../vm-management/repository';
import {assertScopedTargets} from '../permissions/server-scope';
import {assertOpsToken,runWithOpsAuth} from '../ops-api/context';
import {machineUuid} from '../dashboard/scan';
import {FleetEnrollment,FleetServerEnrollment,READ_ACTIONS,type CreateInput} from './schema';
import {recreateRule} from '../vm-ops/ops';
import {telegramRequesterAuth} from './telegram-delegation';
export const conflict=(message='Lệnh đã đổi phiên / hết hạn hoặc cần đối soát')=>new ProxyDomainError('STALE_PREVIEW',message,'REVISION_CONFLICT');
export const invalid=(message='Nội dung lệnh không hợp lệ')=>new ProxyDomainError('INVALID_INPUT',message,'VALIDATION');
export const TERMINAL=['SUCCEEDED','FAILED','CANCELLED','EXPIRED','REFUSED'];
export const ACTIVE=['QUEUED','CLAIMED','DISPATCHED','UNKNOWN'];
export const LEASE_MS=60000,MAX_EVENTS=100;
export function enrollment(b:Pick<CreateInput,'projectId'|'serverId'|'vmId'|'machineUuid'|'expectedCycle'|'configurationId'>):{serverUuid:string}{
 if(process.env.FLEET_CONTROL_M1_READY!=='1')throw new ProxyDomainError('FORBIDDEN','M1 chưa được cho phép điều khiển');
 // Operation (28/10/2026): whole servers are enrolled; the VM identity (UUID máy, round, revision, configuration) comes from the web row.
 if(process.env.FLEET_CONTROL_SERVERS){
  let rows:z.infer<typeof FleetServerEnrollment>[];
  try{rows=z.array(FleetServerEnrollment).min(1).max(100).parse(JSON.parse(process.env.FLEET_CONTROL_SERVERS));}catch{throw new ProxyDomainError('FORBIDDEN','Thiếu cấu hình server điều khiển hợp lệ');}
  const servers=new Map<string,string>(),physical=new Map<string,string>();
  for(const r of rows){
   const server=r.projectId+'/'+r.serverId,host=r.projectId+'/'+r.serverUuid;
   if(servers.has(server)||physical.has(host))throw new ProxyDomainError('FORBIDDEN','Ánh xạ server điều khiển trùng');
   servers.set(server,r.serverUuid);physical.set(host,r.serverId);
  }
  const serverUuid=servers.get(b.projectId+'/'+b.serverId);
  if(!serverUuid)throw new ProxyDomainError('FORBIDDEN','Server chưa được bật điều khiển');
  return {serverUuid};
 }
 let rows:z.infer<typeof FleetEnrollment>[];
 try{rows=z.array(FleetEnrollment).min(1).max(100).parse(JSON.parse(process.env.FLEET_CONTROL_CANARY??'null'));}catch{throw new ProxyDomainError('FORBIDDEN','Thiếu cấu hình canary điều khiển hợp lệ');}
 if(new Set(rows.map(r=>r.projectId+'/'+r.vmId)).size!==rows.length)throw new ProxyDomainError('FORBIDDEN','Cấu hình canary trùng');
 const servers=new Map<string,string>(),physical=new Map<string,string>(),machines=new Set<string>();
 for(const r of rows){
  const server=r.projectId+'/'+r.serverId,host=r.projectId+'/'+r.serverUuid,machine=host+'/'+r.machineUuid;
  if(servers.has(server)&&servers.get(server)!==r.serverUuid||physical.has(host)&&physical.get(host)!==r.serverId||machines.has(machine))throw new ProxyDomainError('FORBIDDEN','Ánh xạ canary server / máy không nhất quán');
  servers.set(server,r.serverUuid);physical.set(host,r.serverId);machines.add(machine);
 }
 const match=rows.find(r=>r.projectId===b.projectId&&r.serverId===b.serverId&&r.vmId===b.vmId&&r.machineUuid===b.machineUuid&&r.expectedCycle===b.expectedCycle&&r.configurationId===b.configurationId);
 if(!match)throw new ProxyDomainError('FORBIDDEN','VM không thuộc đúng UUID / lượt / cấu hình canary');
 return {serverUuid:match.serverUuid};
}
export async function workerAuth(tx:Prisma.TransactionClient,scope:ActorScope,serverId?:string){
 await assertOpsToken(tx,scope);const current=await authorizeVM(scope,'ASSIGN',tx);
 if(serverId)await assertScopedTargets(tx,current,{serverId});return current;
}
export async function requesterAuth(tx:Prisma.TransactionClient,c:Pick<FleetCommand,'projectId'|'serverId'|'vmId'|'requesterId'|'requesterTokenId'|'action'>&{source?:string;operationId?:string},telegramAdmission=false){
 if(c.source==='TELEGRAM')return telegramRequesterAuth(tx,c,telegramAdmission);
 const scope:ActorScope={projectId:c.projectId,userId:c.requesterId,role:'USER',capabilities:[]};
 const rights=async()=>{const current=await authorizeVM(scope,READ_ACTIONS.includes(c.action as never)?'ASSIGN':'MANAGE',tx);await assertScopedTargets(tx,current,{serverId:c.serverId,vmId:c.vmId});return current;};
 // Delayed dispatch checks the ORIGINAL requesting token, independently of the worker's token.
 return c.requesterTokenId?runWithOpsAuth({tokenId:c.requesterTokenId,userId:c.requesterId,operation:'VM_OPS',targets:{serverId:c.serverId,vmId:c.vmId}},async()=>{await assertOpsToken(tx,scope);return rights();}):rights();
}
export async function binding(tx:Prisma.TransactionClient,b:Pick<CreateInput,'projectId'|'serverId'|'vmId'|'machineUuid'|'expectedCycle'|'expectedVmRevision'|'configurationId'>&{action?:string},captured?:{serverUuid:string;vmCode:string}){
 const e=enrollment(b);
 const vm=await tx.virtualMachine.findFirst({where:{id:b.vmId,serverId:b.serverId,managed:true,archivedAt:null,server:{projectId:b.projectId,managed:true,archivedAt:null}},select:{id:true,code:true,revision:true,notes:true,desiredConfigurationId:true,operation:{select:{cycle:true,status:true,proxyPendingConfigId:true}}}});
 if(!vm)throw new ProxyDomainError('NOT_FOUND');
 if(vm.revision!==b.expectedVmRevision)throw conflict('Revision VM đã đổi');
 if((vm.operation?.cycle??1)!==b.expectedCycle)throw conflict('Lượt VM đã đổi');
 if(vm.desiredConfigurationId!==b.configurationId)throw conflict('Cấu hình VM đã đổi');
 if(machineUuid(vm.notes)!==b.machineUuid)throw conflict('UUID VM đã đổi / chưa xác minh');
 if(captured&&(captured.vmCode!==vm.code||captured.serverUuid!==e.serverUuid))throw conflict('Tên VM / UUID server đã đổi');
 if(await tx.vmJob.findFirst({where:{projectId:b.projectId,vmId:b.vmId,state:'ACTIVE',expiresAt:{gt:new Date()}},select:{id:true}}))throw conflict('VM đang có việc vận hành khác; giữ VM Guard');
 // Per-action web preconditions (the same rules the web UI applies by hand).
 if(b.action==='REPLACE_PROXY'&&(!b.configurationId||vm.operation?.proxyPendingConfigId!==b.configurationId))throw invalid('VM chưa ở "Chờ áp dụng proxy" cho cấu hình này; thay proxy trên web (Kho proxy → Nhận replace) trước');
 if(b.action==='RECREATE_VM'){const rule=await recreateRule(tx,b.projectId,{id:vm.id,operation:vm.operation?{cycle:vm.operation.cycle,status:vm.operation.status}:null});if(rule.refusal)throw invalid(rule.refusal);}
 return {vmCode:vm.code,serverUuid:e.serverUuid};
}
export function checkFence(c:FleetCommand,workerId:string,userId:string,epoch:number){
 if(c.workerId!==workerId||c.workerUserId!==userId||c.leaseEpoch!==epoch||!c.leaseUntil||c.leaseUntil<=new Date())throw conflict('Worker mất lease; chỉ đối soát sau khi nhận lease mới');
}
