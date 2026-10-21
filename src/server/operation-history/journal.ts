import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {assertImagesUnchanged,describeImage,type OperationSnapshot} from './snapshot';
import {undoRefusal} from './undo-rules';
export async function recordOperation(tx:Prisma.TransactionClient,input:{scope:ActorScope;kind:string;summary:Record<string,string|number>;snapshot:OperationSnapshot;batchId?:string;undoOfId?:string;reversible?:boolean;accessModule?:string;commandKey?:string;requestHash?:string;resultCipher?:string}){
  return tx.operationJournal.create({data:{projectId:input.scope.projectId,actorId:input.scope.userId,kind:input.kind,summary:input.summary,snapshotCipher:encrypt(JSON.stringify(input.snapshot)),batchId:input.batchId,undoOfId:input.undoOfId,reversible:input.reversible??true,accessModule:input.accessModule||'INFRASTRUCTURE',commandKey:input.commandKey,requestHash:input.requestHash,resultCipher:input.resultCipher}});
}
export function openSnapshot(cipher:string):OperationSnapshot{
  const value=JSON.parse(decrypt(cipher)) as OperationSnapshot;
  if(![1,2,3,4].includes(value.version)||!Array.isArray(value.resources)||!Array.isArray(value.eventIds)||!Array.isArray(value.replacementIds))throw new ProxyDomainError('INVALID_INPUT','Không có bản trước để hoàn tác');
  return value;
}
export async function listOperations(scope:ActorScope,db:PrismaClient=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);
  const rows=await db.operationJournal.findMany({where:{projectId:scope.projectId,...(current.role==='ADMIN'?{}:{accessModule:{in:current.allowedModules||[]}})},orderBy:[{createdAt:'desc'},{id:'desc'}],take:100,select:{id:true,kind:true,summary:true,batchId:true,undoOfId:true,actorId:true,createdAt:true,reversible:true,accessModule:true,snapshotCipher:true}});
  const [undos,users]=await Promise.all([db.operationJournal.findMany({where:{projectId:scope.projectId,undoOfId:{in:rows.map(r=>r.id)}},select:{id:true,undoOfId:true}}),db.user.findMany({where:{id:{in:Array.from(new Set(rows.map(r=>r.actorId)))}},select:{id:true,name:true,username:true}})]);
  const refused=(r:{kind:string;reversible:boolean;snapshotCipher:string})=>{if(!r.reversible||r.kind==='UNDO')return false;try{return !!undoRefusal(r.kind,openSnapshot(r.snapshotCipher));}catch{return true;}};
  return rows.map(({snapshotCipher,...r})=>({...r,actor:users.find(u=>u.id===r.actorId)?.name||users.find(u=>u.id===r.actorId)?.username||'Tài khoản cũ',createdAt:r.createdAt.toISOString(),undoneById:undos.find(u=>u.undoOfId===r.id)?.id||null,canUndo:current.role==='ADMIN'&&r.reversible&&r.kind!=='UNDO'&&!undos.some(u=>u.undoOfId===r.id)&&!refused({...r,snapshotCipher})}));
}
export async function inspectOperation(scope:ActorScope,id:string,db:PrismaClient=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);
  const operation=await db.operationJournal.findFirst({where:{id,projectId:scope.projectId}});if(!operation)throw new ProxyDomainError('NOT_FOUND');
  if(current.role!=='ADMIN'&&!current.allowedModules?.includes(operation.accessModule))throw new ProxyDomainError('FORBIDDEN');
  const undo=await db.operationJournal.findUnique({where:{undoOfId:id}}),snapshot=openSnapshot(operation.snapshotCipher);
  let blockedReason:string|null=operation.kind!=='UNDO'?undoRefusal(operation.kind,snapshot):null;
  if(!blockedReason)blockedReason=operation.reversible?null:operation.kind.startsWith('BUSINESS_')?'Đây là ghi nhận chốt kỳ / trả tiền. Dùng Mở lại kỳ hoặc Sửa ghi trả nhầm với lý do để điều chỉnh.':'Đã bắt đầu xử lý thực tế. Giao một cấu hình mới và xác nhận mới nếu cần đổi lại.';
  if(!blockedReason)try{await assertImagesUnchanged(db,scope.projectId,snapshot);}catch(error){if(error instanceof ProxyDomainError)blockedReason=error.message;else throw error;}
  // Payout amounts in a journal (a recreation consumes a payout request) are money: shown only with the PayPal money rights, like the
  // VM payout history (independent review 19/10/2026). Others see the request's state only.
  const money=snapshot.resources.some(r=>r.resource==='PAYOUT_REQUEST')?(await (await import('../business-management/paypal-ledger')).ledgerRights(current,db)).funds:true;
  const neutral=(row:Record<string,unknown>|null)=>row?'Yêu cầu rút · '+String(row.state||'')+(row.consumedAt?' · đã dùng để tạo lại VM':''):'Chưa có';
  // SDK money (Tiền tích luỹ SDK) follows the same read right as the EarnApp balance (independent review 22/10/2026): an SDK image is
  // described without its amount, source or note for readers without it.
  const sdkMoney=snapshot.resources.some(r=>r.resource==='SDK')?(await (await import('../vm-management/sdk-money-rights')).sdkMoneyRights(current,db)).read:true;
  const neutralSdk=(row:Record<string,unknown>|null)=>row?(row.vmId?'Đang trên VM':'Trong kho')+' · '+String(row.linkState||'')+' · tiền / ghi chú ẩn (cần quyền xem tiền)':'Chưa có';
  const rows=await Promise.all(snapshot.resources.map(async image=>{const result=describeImage(image);if(image.resource==='PAYOUT_REQUEST'&&!money){result.before=neutral(image.before as Record<string,unknown>|null);result.after=neutral(image.after as Record<string,unknown>);}if(image.resource==='SDK'&&!sdkMoney){result.before=neutralSdk(image.before as Record<string,unknown>|null);result.after=image.after?neutralSdk(image.after as Record<string,unknown>):'Đã gỡ (hoàn tác)';}if(image.resource==='VM_BINDING'||image.resource==='VM_SDK'||image.resource==='SDK_SLOT'){const vm=await db.virtualMachine.findFirst({where:{id:image.id,server:{projectId:scope.projectId}},select:{code:true,server:{select:{code:true}}}});if(vm)result.label=vm.server.code+' / '+vm.code;}return result;}));
  return {id,kind:operation.kind,createdAt:operation.createdAt.toISOString(),summary:operation.summary,blockedReason,canUndo:current.role==='ADMIN'&&(current.businessMode==='PROXY_VM'||current.teamCashEnabled&&['FUNDS','WITHDRAWALS','COSTS','PROFIT'].includes(operation.accessModule)&&snapshot.resources.every(r=>['COST','FUND','WITHDRAWAL','PROFIT','SPLIT_PAYMENT','TEAM_RECEIPT','COLLECTOR_EXPENSE','PAYPAL'].includes(r.resource)))&&operation.reversible&&operation.kind!=='UNDO'&&!undo&&!blockedReason,rows};
}
