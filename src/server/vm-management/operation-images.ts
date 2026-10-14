import type {Prisma,PrismaClient,VirtualMachine,VMConfiguration,VMProxyAllocation,VMTask,Server} from '@prisma/client';
export function captureVM(v:VirtualMachine){return {code:v.code,status:v.status,notes:v.notes,managed:v.managed,proxySlotState:v.proxySlotState,slotSourceRef:v.slotSourceRef,originalSlotCipher:v.originalSlotCipher,revision:v.revision,configurationSequence:v.configurationSequence,archivedAt:v.archivedAt?.toISOString()||null,desiredConfigurationId:v.desiredConfigurationId,installedConfigurationId:v.installedConfigurationId,proxyId:v.proxyId,updatedAt:v.updatedAt.toISOString()};}
export function captureConfiguration(c:VMConfiguration){return {version:c.version,endpointId:c.endpointId,snapshotCipher:c.snapshotCipher,configurationHash:c.configurationHash,status:c.status,startedAt:c.startedAt?.toISOString()||null,confirmedAt:c.confirmedAt?.toISOString()||null,confirmedById:c.confirmedById,failureNote:c.failureNote,revision:c.revision};}
export function captureAllocation(a:VMProxyAllocation&{endpoint?:{host:string|null};vm?:{code:string;server:{code:string}}}){return {vmId:a.vmId,endpointId:a.endpointId,configurationId:a.configurationId,allocationKey:a.allocationKey,role:a.role,releasedAt:a.releasedAt?.toISOString()||null,releaseReason:a.releaseReason,revision:a.revision,ip:a.endpoint?.host||null,location:a.vm?a.vm.server.code+'/'+a.vm.code:null};}
export function captureTask(t:VMTask){return {vmId:t.vmId,configurationId:t.configurationId,type:t.type,title:t.title,description:t.description,scheduledAt:t.scheduledAt.toISOString(),completedAt:t.completedAt?.toISOString()||null,status:t.status,assignedToId:t.assignedToId,updatedAt:t.updatedAt.toISOString()};}
export function captureServer(s:Server){return {code:s.code,ipAddress:s.ipAddress,notes:s.notes,status:s.status,managed:s.managed,archivedAt:s.archivedAt?.toISOString()||null,revision:s.revision,updatedAt:s.updatedAt.toISOString()};}
export type VMImage=( {resource:'VM';before:ReturnType<typeof captureVM>|null;after:ReturnType<typeof captureVM>} | {resource:'VM_CONFIG';before:ReturnType<typeof captureConfiguration>|null;after:ReturnType<typeof captureConfiguration>} | {resource:'VM_ALLOCATION';before:ReturnType<typeof captureAllocation>|null;after:ReturnType<typeof captureAllocation>} | {resource:'VM_TASK';before:ReturnType<typeof captureTask>|null;after:ReturnType<typeof captureTask>} | {resource:'SERVER';before:ReturnType<typeof captureServer>|null;after:ReturnType<typeof captureServer>} )&{id:string};
export async function readVMImage(db:PrismaClient|Prisma.TransactionClient,projectId:string,type:VMImage['resource'],id:string){
  if(type==='VM'){const row=await db.virtualMachine.findFirst({where:{id,managed:true,server:{projectId,managed:true}}});return row?captureVM(row):null;}
  if(type==='VM_CONFIG'){const row=await db.vMConfiguration.findFirst({where:{id,projectId}});return row?captureConfiguration(row):null;}
  if(type==='VM_ALLOCATION'){const row=await db.vMProxyAllocation.findFirst({where:{id,projectId},include:{endpoint:{select:{host:true}},vm:{select:{code:true,server:{select:{code:true}}}}}});return row?captureAllocation(row):null;}
  if(type==='VM_TASK'){const row=await db.vMTask.findFirst({where:{id,vm:{server:{projectId}}}});return row?captureTask(row):null;}
  const row=await db.server.findFirst({where:{id,projectId,managed:true}});return row?captureServer(row):null;
}
export async function restoreVMImage(tx:Prisma.TransactionClient,image:VMImage,reason:string){
  if(image.resource==='VM'){
    if(!image.before){await tx.virtualMachine.update({where:{id:image.id},data:{archivedAt:new Date(),revision:{increment:1}}});return;}
    const {revision:_r,configurationSequence:_s,updatedAt:_u,...data}=image.before;await tx.virtualMachine.update({where:{id:image.id},data:{...data,archivedAt:data.archivedAt?new Date(data.archivedAt):null,revision:{increment:1}}});return;
  }
  if(image.resource==='VM_CONFIG'){
    const before=image.before;await tx.vMConfiguration.update({where:{id:image.id},data:before?{status:before.status,startedAt:before.startedAt?new Date(before.startedAt):null,confirmedAt:before.confirmedAt?new Date(before.confirmedAt):null,confirmedById:before.confirmedById,failureNote:before.failureNote,revision:{increment:1}}:{status:'CANCELLED',revision:{increment:1}}});return;
  }
  if(image.resource==='VM_ALLOCATION'){
    const before=image.before;await tx.vMProxyAllocation.update({where:{id:image.id},data:before?{role:before.role,releasedAt:before.releasedAt?new Date(before.releasedAt):null,releaseReason:before.releaseReason,revision:{increment:1}}:{releasedAt:new Date(),releaseReason:reason,revision:{increment:1}}});return;
  }
  if(image.resource==='VM_TASK'){
    if(!image.before){await tx.vMTask.update({where:{id:image.id},data:{status:'CANCELLED'}});return;}
    const {updatedAt:_u,...data}=image.before;await tx.vMTask.update({where:{id:image.id},data:{...data,scheduledAt:new Date(data.scheduledAt),completedAt:data.completedAt?new Date(data.completedAt):null}});return;
  }
  if(!image.before){await tx.server.update({where:{id:image.id},data:{archivedAt:new Date(),revision:{increment:1}}});return;}
  const {revision:_r,updatedAt:_u,...data}=image.before;await tx.server.update({where:{id:image.id},data:{...data,archivedAt:data.archivedAt?new Date(data.archivedAt):null,revision:{increment:1}}});
}
