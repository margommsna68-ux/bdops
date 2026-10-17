import type {PrismaClient,VMTaskStatus} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {withProxyTransaction} from '../proxy-management/transaction';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {recordOperation} from '../operation-history/journal';
import {authorizeVM} from './repository';
import {snapshotCollector} from './allocation';
// An install task is "orphan" when it is still open but its configuration is no longer the VM's pending one (proxy changed,
// installed by another configuration, plan released). Việc cài lists pending configurations only, so these need their own list.
const OPEN:VMTaskStatus[]=['PENDING','IN_PROGRESS'];
type TaskRow={id:string;configurationId:string|null;vm:{desiredConfigurationId:string|null;installedConfigurationId:string|null}};
export const isOrphanTask=(t:TaskRow)=>!(t.configurationId&&t.vm.desiredConfigurationId===t.configurationId&&t.vm.desiredConfigurationId!==t.vm.installedConfigurationId);
export async function readOrphanTasks(scope:ActorScope,db:PrismaClient=prisma){
  await authorizeVM(scope,'READ',db);
  const tasks=await db.vMTask.findMany({where:{status:{in:OPEN},vm:{managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}}},select:{id:true,title:true,status:true,scheduledAt:true,configurationId:true,vmId:true,vm:{select:{code:true,serverId:true,desiredConfigurationId:true,installedConfigurationId:true,server:{select:{code:true}}}}},orderBy:[{scheduledAt:'asc'},{id:'asc'}]});
  return tasks.filter(isOrphanTask).map(t=>({id:t.id,title:t.title,status:t.status,scheduledAt:t.scheduledAt.toISOString(),vmId:t.vmId,vm:t.vm.code,serverId:t.vm.serverId,server:t.vm.server.code}));
}
// Close an orphan task (CANCELLED). Re-checked inside the transaction; a task that belongs to the pending configuration again is
// refused (it is handled on Việc cài). Journaled with the task image, so undo reopens it.
export async function closeOrphanTask(scope:ActorScope,input:{taskId:string},db:PrismaClient=prisma){
  return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'CONFIRM',tx);
    const task=await tx.vMTask.findFirst({where:{id:input.taskId,vm:{managed:true,server:{projectId:scope.projectId,managed:true}}},select:{id:true,title:true,status:true,configurationId:true,vm:{select:{code:true,desiredConfigurationId:true,installedConfigurationId:true,server:{select:{code:true}}}}}});
    if(!task)throw new ProxyDomainError('NOT_FOUND','Việc cài không còn trong dự án');
    if(!OPEN.includes(task.status))return {closed:false,operationId:null as string|null};
    if(!isOrphanTask(task))throw new ProxyDomainError('INVALID_INPUT','Việc này đang gắn với cấu hình chờ cài; cài và xác nhận ở tab Cài proxy của VM');
    const images=await snapshotCollector(tx,current);await images.remember('VM_TASK',task.id);
    await tx.vMTask.update({where:{id:task.id},data:{status:'CANCELLED'}});
    const op=await recordOperation(tx,{scope:current,kind:'VM_TASK_CLOSE',summary:{server:task.vm.server.code,vm:task.vm.code,title:task.title},snapshot:await images.finish()});
    return {closed:true,operationId:op.id as string|null};
  },db);
}
