import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {assertImagesUnchanged,describeImage,type OperationSnapshot} from './snapshot';
export async function recordOperation(tx:Prisma.TransactionClient,input:{scope:ActorScope;kind:string;summary:Record<string,string|number>;snapshot:OperationSnapshot;batchId?:string;undoOfId?:string;reversible?:boolean;accessModule?:string;commandKey?:string;requestHash?:string;resultCipher?:string}){
  return tx.operationJournal.create({data:{projectId:input.scope.projectId,actorId:input.scope.userId,kind:input.kind,summary:input.summary,snapshotCipher:encrypt(JSON.stringify(input.snapshot)),batchId:input.batchId,undoOfId:input.undoOfId,reversible:input.reversible??true,accessModule:input.accessModule||'INFRASTRUCTURE',commandKey:input.commandKey,requestHash:input.requestHash,resultCipher:input.resultCipher}});
}
export function openSnapshot(cipher:string):OperationSnapshot{
  const value=JSON.parse(decrypt(cipher)) as OperationSnapshot;
  if(![1,2,3].includes(value.version)||!Array.isArray(value.resources)||!Array.isArray(value.eventIds)||!Array.isArray(value.replacementIds))throw new ProxyDomainError('INVALID_INPUT','Không có bản trước để hoàn tác');
  return value;
}
export async function listOperations(scope:ActorScope,db:PrismaClient=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);
  const rows=await db.operationJournal.findMany({where:{projectId:scope.projectId,...(current.role==='ADMIN'?{}:{accessModule:{in:current.allowedModules||[]}})},orderBy:[{createdAt:'desc'},{id:'desc'}],take:100,select:{id:true,kind:true,summary:true,batchId:true,undoOfId:true,actorId:true,createdAt:true,reversible:true,accessModule:true}});
  const [undos,users]=await Promise.all([db.operationJournal.findMany({where:{projectId:scope.projectId,undoOfId:{in:rows.map(r=>r.id)}},select:{id:true,undoOfId:true}}),db.user.findMany({where:{id:{in:Array.from(new Set(rows.map(r=>r.actorId)))}},select:{id:true,name:true,username:true}})]);
  return rows.map(r=>({...r,actor:users.find(u=>u.id===r.actorId)?.name||users.find(u=>u.id===r.actorId)?.username||'Tài khoản cũ',createdAt:r.createdAt.toISOString(),undoneById:undos.find(u=>u.undoOfId===r.id)?.id||null,canUndo:current.role==='ADMIN'&&r.reversible&&r.kind!=='UNDO'&&!undos.some(u=>u.undoOfId===r.id)}));
}
export async function inspectOperation(scope:ActorScope,id:string,db:PrismaClient=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);
  const operation=await db.operationJournal.findFirst({where:{id,projectId:scope.projectId}});if(!operation)throw new ProxyDomainError('NOT_FOUND');
  if(current.role!=='ADMIN'&&!current.allowedModules?.includes(operation.accessModule))throw new ProxyDomainError('FORBIDDEN');
  const undo=await db.operationJournal.findUnique({where:{undoOfId:id}}),snapshot=openSnapshot(operation.snapshotCipher);
  let blockedReason:string|null=operation.reversible?null:operation.kind.startsWith('BUSINESS_')?'Đây là ghi nhận chốt kỳ / trả tiền. Dùng Mở lại kỳ hoặc Sửa ghi trả nhầm với lý do để điều chỉnh.':'Đã bắt đầu xử lý thực tế. Giao một cấu hình mới và xác nhận mới nếu cần đổi lại.';
  try{await assertImagesUnchanged(db,scope.projectId,snapshot);}catch(error){if(error instanceof ProxyDomainError)blockedReason=error.message;else throw error;}
  const rows=await Promise.all(snapshot.resources.map(async image=>{const result=describeImage(image);if(image.resource==='VM_BINDING'){const vm=await db.virtualMachine.findFirst({where:{id:image.id,server:{projectId:scope.projectId}},select:{code:true,server:{select:{code:true}}}});if(vm)result.label=vm.server.code+' / '+vm.code;}return result;}));
  return {id,kind:operation.kind,createdAt:operation.createdAt.toISOString(),summary:operation.summary,blockedReason,canUndo:current.role==='ADMIN'&&current.businessMode==='PROXY_VM'&&operation.reversible&&operation.kind!=='UNDO'&&!undo&&!blockedReason,rows};
}
