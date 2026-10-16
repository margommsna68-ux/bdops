import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {withProxyTransaction} from '../proxy-management/transaction';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {recordOperation} from '../operation-history/journal';
import {authorizeVM} from './repository';
import {snapshotCollector} from './allocation';
import {expandVmRange,VmCodeError} from './vm-codes';
function validateCodes(codes:string[]){if(!codes.length||codes.length>500||new Set(codes).size!==codes.length||codes.some(code=>!/^[a-zA-Z0-9_-]{1,64}$/.test(code)))throw new ProxyDomainError('INVALID_INPUT','Mỗi VM có một mã riêng (chữ/số/-/_), tối đa 500 VM mỗi đợt');}
export async function createManagedServer(scope:ActorScope,input:{code:string;vmCodes:string[];ipAddress?:string},db:PrismaClient=prisma){
  validateCodes(input.vmCodes);if(!input.code.trim()||input.code.length>80)throw new ProxyDomainError('INVALID_INPUT');
  return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx);if(await tx.server.findFirst({where:{projectId:scope.projectId,code:input.code.trim()},select:{id:true}}))throw new ProxyDomainError('DUPLICATE_INPUT','Server '+input.code.trim()+' đã có trong dự án (kể cả đã xoá)');
    const images=await snapshotCollector(tx,current),server=await tx.server.create({data:{projectId:scope.projectId,code:input.code.trim(),ipAddress:input.ipAddress||null,managed:true}});await images.remember('SERVER',server.id,true);
    for(const code of input.vmCodes){const vm=await tx.virtualMachine.create({data:{serverId:server.id,code,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});await images.remember('VM',vm.id,true);}
    await recordOperation(tx,{scope:current,kind:'SERVER_CREATE',summary:{server:server.code,count:input.vmCodes.length},snapshot:await images.finish()});return {id:server.id};
  },db);
}
// "Từ"–"Đến" range (see vm-codes.ts); domain error for the API.
export function parseVmRange(from:string,to:string):string[]{try{return expandVmRange(from,to);}catch(e){throw new ProxyDomainError('INVALID_INPUT',e instanceof VmCodeError?e.message:'Khoảng mã không hợp lệ');}}
// Creates only codes that do not exist on the server. Active codes are skipped, deleted (archived) codes too — they are restored,
// never recreated. Re-evaluated inside the transaction; the (serverId, code) unique index stops concurrent duplicates.
export async function addManagedVMs(scope:ActorScope,serverId:string,codes:string[],db:PrismaClient=prisma){
  validateCodes(codes);return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx),server=await tx.server.findFirst({where:{id:serverId,projectId:scope.projectId,managed:true,archivedAt:null}});if(!server)throw new ProxyDomainError('NOT_FOUND','Server không có hoặc đã xoá');
    const known=await tx.virtualMachine.findMany({where:{serverId,code:{in:codes}},select:{code:true,archivedAt:true}});
    const existing=known.filter(v=>!v.archivedAt).map(v=>v.code).sort(),archived=known.filter(v=>v.archivedAt).map(v=>v.code).sort(),fresh=codes.filter(c=>!known.some(k=>k.code===c));
    if(!fresh.length) return {created:0,existing,archived,operationId:null as string|null};
    const images=await snapshotCollector(tx,current);await images.remember('SERVER',server.id);
    for(const code of fresh){const vm=await tx.virtualMachine.create({data:{serverId,code,managed:true,proxySlotState:'BLANK',slotSourceRef:'MANUAL'}});await images.remember('VM',vm.id,true);}
    await tx.server.update({where:{id:server.id},data:{revision:{increment:1}}});const op=await recordOperation(tx,{scope:current,kind:'VM_CREATE',summary:{server:server.code,count:fresh.length},snapshot:await images.finish()});
    return {created:fresh.length,existing,archived,operationId:op.id as string|null};
  },db);
}
// Rename / note a VM in place: same id, proxy, SDK, account and history. Codes are unique per server, deleted VMs included.
export async function updateManagedVM(scope:ActorScope,vmId:string,input:{code?:string;notes?:string|null;expectedRevision:number},db:PrismaClient=prisma){
  const code=input.code?.trim();if(code!==undefined&&!/^[a-zA-Z0-9_-]{1,64}$/.test(code))throw new ProxyDomainError('INVALID_INPUT','Mã VM chỉ gồm chữ, số, - hoặc _ (tối đa 64 ký tự)');
  const notes=input.notes===undefined?undefined:(input.notes||'').trim()||null;if(notes&&notes.length>1000)throw new ProxyDomainError('INVALID_INPUT','Ghi chú tối đa 1000 ký tự');
  return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx),vm=await tx.virtualMachine.findFirst({where:{id:vmId,managed:true,server:{projectId:scope.projectId,managed:true}}});if(!vm)throw new ProxyDomainError('NOT_FOUND');
    if(vm.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','VM vừa được sửa; tải lại để xem bản mới');
    const nextCode=code??vm.code,nextNotes=notes===undefined?vm.notes:notes;
    if(nextCode===vm.code&&nextNotes===vm.notes) return {saved:false};
    if(nextCode!==vm.code&&await tx.virtualMachine.findFirst({where:{serverId:vm.serverId,code:nextCode,id:{not:vm.id}},select:{id:true}}))throw new ProxyDomainError('DUPLICATE_INPUT','Mã '+nextCode+' đã có trên server này (kể cả máy đã xoá)');
    const images=await snapshotCollector(tx,current);await images.remember('VM',vm.id);
    await tx.virtualMachine.update({where:{id:vm.id},data:{code:nextCode,notes:nextNotes,revision:{increment:1}}});
    await recordOperation(tx,{scope:current,kind:'VM_METADATA',summary:{vm:nextCode},snapshot:await images.finish()});return {saved:true};
  },db);
}
export async function updateManagedServer(scope:ActorScope,serverId:string,input:{code:string;ipAddress?:string;notes?:string;expectedRevision:number},db:PrismaClient=prisma){
  if(!input.code.trim()||input.code.length>80)throw new ProxyDomainError('INVALID_INPUT');return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx),server=await tx.server.findFirst({where:{id:serverId,projectId:scope.projectId,managed:true}});if(!server)throw new ProxyDomainError('NOT_FOUND');if(server.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW');
    const next={code:input.code.trim(),ipAddress:input.ipAddress===undefined?server.ipAddress:input.ipAddress.trim()||null,notes:input.notes===undefined?server.notes:input.notes.trim()||null};
    if(next.code===server.code&&next.ipAddress===server.ipAddress&&next.notes===server.notes) return {saved:false};
    if(next.code!==server.code&&await tx.server.findFirst({where:{projectId:scope.projectId,code:next.code,id:{not:server.id}},select:{id:true}}))throw new ProxyDomainError('DUPLICATE_INPUT','Server '+next.code+' đã có trong dự án (kể cả đã xoá)');
    const images=await snapshotCollector(tx,current);await images.remember('SERVER',server.id);await tx.server.update({where:{id:server.id},data:{...next,revision:{increment:1}}});await recordOperation(tx,{scope:current,kind:'SERVER_METADATA',summary:{server:next.code},snapshot:await images.finish()});return {saved:true};
  },db);
}
export async function archiveManagedResource(scope:ActorScope,type:'SERVER'|'VM',id:string,db:PrismaClient=prisma){
  return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx),images=await snapshotCollector(tx,current);
    if(type==='SERVER'){
      const server=await tx.server.findFirst({where:{id,projectId:scope.projectId,managed:true}});if(!server)throw new ProxyDomainError('NOT_FOUND');
      if(await tx.vMProxyAllocation.count({where:{releasedAt:null,vm:{serverId:id}}}))throw new ProxyDomainError('INVALID_INPUT','Máy còn proxy đang giữ/đã cài. Xác nhận ngừng dùng trước khi ẩn.');await images.remember('SERVER',id);await tx.server.update({where:{id},data:{archivedAt:new Date(),revision:{increment:1}}});
    }else{
      const vm=await tx.virtualMachine.findFirst({where:{id,managed:true,server:{projectId:scope.projectId,managed:true}}});if(!vm)throw new ProxyDomainError('NOT_FOUND');if(await tx.vMProxyAllocation.count({where:{vmId:id,releasedAt:null}}))throw new ProxyDomainError('INVALID_INPUT','VM còn proxy đang giữ/đã cài; chưa thể ẩn.');await images.remember('VM',id);await tx.virtualMachine.update({where:{id},data:{archivedAt:new Date(),revision:{increment:1}}});
    }
    await recordOperation(tx,{scope:current,kind:'INFRA_ARCHIVE',summary:{type},snapshot:await images.finish()});return {saved:true};
  },db);
}

// ---- Delete (= archive, restorable) and restore. Data, links and history stay; deleted machines leave every picker,
// autofill and active count. Nothing is released to make a delete possible.
type Blocked={id:string;code:string;reason:string};
const ROLE:Record<string,string>={DESIRED:'Chờ cài',INSTALLED:'Đã cài',UNCERTAIN:'Giữ để kiểm tra'};
async function deleteBlockers(tx:Prisma.TransactionClient,vmIds:string[]){
  const vms=await tx.virtualMachine.findMany({where:{id:{in:vmIds}},include:{allocations:{where:{releasedAt:null},include:{endpoint:{select:{host:true}}}},tasks:{where:{status:{in:['PENDING','IN_PROGRESS']}},select:{id:true}}}});
  return new Map(vms.map(v=>[v.id,v.allocations.length?'Còn proxy '+v.allocations.map(a=>(a.endpoint.host||'')+' · '+ROLE[a.role]).join(', ')+'; bỏ gán hoặc xử lý ở Việc cài trước':v.tasks.length?'Còn việc cài proxy chưa xong; hoàn tất hoặc huỷ ở Việc cài trước':v.proxyId?'Còn liên kết proxy đã cài; xử lý ở Server/VM trước':null]));
}
const byCode=(a:{code:string},b:{code:string})=>a.code.localeCompare(b.code,undefined,{numeric:true});
export async function archiveVMs(scope:ActorScope,vmIds:string[],db:PrismaClient=prisma){
  const ids=Array.from(new Set(vmIds));if(!ids.length||ids.length>1000)throw new ProxyDomainError('INVALID_INPUT');
  return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx),vms=await tx.virtualMachine.findMany({where:{id:{in:ids},managed:true,server:{projectId:scope.projectId,managed:true}},select:{id:true,code:true,archivedAt:true}});
    if(vms.length!==ids.length)throw new ProxyDomainError('NOT_FOUND','Có VM không thuộc dự án này');
    const why=await deleteBlockers(tx,ids),blocked:Blocked[]=[],images=await snapshotCollector(tx,current),now=new Date();let archived=0;
    for(const vm of vms.sort(byCode)){
      if(vm.archivedAt) continue;const reason=why.get(vm.id);if(reason){blocked.push({id:vm.id,code:vm.code,reason});continue;}
      await images.remember('VM',vm.id);await tx.virtualMachine.update({where:{id:vm.id},data:{archivedAt:now,revision:{increment:1}}});archived++;
    }
    const op=archived?await recordOperation(tx,{scope:current,kind:'VM_DELETE',summary:{count:archived},snapshot:await images.finish()}):null;
    return {archived,blocked,operationId:op?.id as string|undefined};
  },db);
}
export async function restoreVMs(scope:ActorScope,vmIds:string[],db:PrismaClient=prisma){
  const ids=Array.from(new Set(vmIds));if(!ids.length||ids.length>1000)throw new ProxyDomainError('INVALID_INPUT');
  return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx),vms=await tx.virtualMachine.findMany({where:{id:{in:ids},managed:true,server:{projectId:scope.projectId,managed:true}},include:{server:{select:{code:true,archivedAt:true}}}});
    if(vms.length!==ids.length)throw new ProxyDomainError('NOT_FOUND','Có VM không thuộc dự án này');
    const blocked:Blocked[]=[],images=await snapshotCollector(tx,current);let restored=0;
    for(const vm of vms.sort(byCode)){
      if(!vm.archivedAt) continue;
      if(vm.server.archivedAt){blocked.push({id:vm.id,code:vm.code,reason:'Server '+vm.server.code+' đã xoá; khôi phục server trước'});continue;}
      if(vm.sdkId){const other=await tx.virtualMachine.findFirst({where:{sdkId:vm.sdkId,managed:true,archivedAt:null,id:{not:vm.id}},include:{server:{select:{code:true}}}});if(other){blocked.push({id:vm.id,code:vm.code,reason:'SDK '+vm.sdkId+' đang thuộc '+other.server.code+'/'+other.code+'; không giành lại'});continue;}}
      await images.remember('VM',vm.id);await tx.virtualMachine.update({where:{id:vm.id},data:{archivedAt:null,revision:{increment:1}}});restored++;
    }
    const op=restored?await recordOperation(tx,{scope:current,kind:'VM_RESTORE',summary:{count:restored},snapshot:await images.finish()}):null;
    return {restored,blocked,operationId:op?.id as string|undefined};
  },db);
}
// Server delete: only when no VM of the server holds a proxy or has an open install; the server and its active VMs are archived
// together (same instant, one journal entry) so a restore brings exactly those VMs back.
export async function archiveServer(scope:ActorScope,serverId:string,db:PrismaClient=prisma){
  return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx),server=await tx.server.findFirst({where:{id:serverId,projectId:scope.projectId,managed:true,archivedAt:null},include:{vms:{where:{archivedAt:null},select:{id:true,code:true}}}});if(!server)throw new ProxyDomainError('NOT_FOUND');
    const why=await deleteBlockers(tx,server.vms.map(v=>v.id)),blocked=server.vms.filter(v=>why.get(v.id)).sort(byCode);
    if(blocked.length)throw new ProxyDomainError('INVALID_INPUT',blocked.length+' VM còn proxy hoặc việc cài: '+blocked.slice(0,5).map(v=>v.code).join(', ')+(blocked.length>5?'…':'')+'. Xử lý các VM đó trước khi xoá server');
    const images=await snapshotCollector(tx,current),now=new Date();await images.remember('SERVER',server.id);
    for(const vm of server.vms){await images.remember('VM',vm.id);await tx.virtualMachine.update({where:{id:vm.id},data:{archivedAt:now,revision:{increment:1}}});}
    await tx.server.update({where:{id:server.id},data:{archivedAt:now,revision:{increment:1}}});
    const op=await recordOperation(tx,{scope:current,kind:'SERVER_DELETE',summary:{server:server.code,count:server.vms.length},snapshot:await images.finish()});
    return {archivedVMs:server.vms.length,operationId:op.id};
  },db);
}
export async function restoreServer(scope:ActorScope,serverId:string,db:PrismaClient=prisma){
  return withProxyTransaction(async tx=>{
    const current=await authorizeVM(scope,'MANAGE',tx),server=await tx.server.findFirst({where:{id:serverId,projectId:scope.projectId,managed:true,archivedAt:{not:null}}});if(!server)throw new ProxyDomainError('NOT_FOUND','Server không ở trạng thái đã xoá');
    const vms=await tx.virtualMachine.findMany({where:{serverId,archivedAt:server.archivedAt}}),images=await snapshotCollector(tx,current),skipped:Blocked[]=[];let restoredVMs=0;
    await images.remember('SERVER',server.id);await tx.server.update({where:{id:server.id},data:{archivedAt:null,revision:{increment:1}}});
    for(const vm of vms){
      if(vm.sdkId&&await tx.virtualMachine.findFirst({where:{sdkId:vm.sdkId,managed:true,archivedAt:null,id:{not:vm.id}},select:{id:true}})){skipped.push({id:vm.id,code:vm.code,reason:'SDK '+vm.sdkId+' đang thuộc VM khác'});continue;}
      await images.remember('VM',vm.id);await tx.virtualMachine.update({where:{id:vm.id},data:{archivedAt:null,revision:{increment:1}}});restoredVMs++;
    }
    const op=await recordOperation(tx,{scope:current,kind:'SERVER_RESTORE',summary:{server:server.code,count:restoredVMs},snapshot:await images.finish()});
    return {restoredVMs,skipped,operationId:op.id};
  },db);
}
