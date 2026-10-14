import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt} from '@/lib/encryption';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {withProxyTransaction} from '../proxy-management/transaction';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {openSnapshot,recordOperation} from './journal';
import {assertImagesUnchanged,readImage,type OperationSnapshot,type ResourceImage} from './snapshot';
import {restoreVMImage} from '../vm-management/operation-images';
export async function undoOperation(scope:ActorScope,id:string,reason:string,db:PrismaClient=prisma,deps:{afterWrite?:()=>void|Promise<void>}={}){
  if(!reason.trim()||reason.length>300)throw new ProxyDomainError('INVALID_INPUT','Ghi lý do hoàn tác (tối đa 300 ký tự)');
  return withProxyTransaction(async tx=>{
    const current=await loadInfrastructureScope(tx,scope.userId,scope.projectId);
    if(current.role!=='ADMIN'||current.businessMode!=='PROXY_VM')throw new ProxyDomainError('FORBIDDEN');
    const original=await tx.operationJournal.findFirst({where:{id,projectId:scope.projectId}});if(!original)throw new ProxyDomainError('NOT_FOUND');
    const prior=await tx.operationJournal.findUnique({where:{undoOfId:id}});if(prior)return {id:prior.id,replay:true};
    if(original.kind==='UNDO'||!original.reversible)throw new ProxyDomainError('INVALID_INPUT','Thao tác này chỉ để xem; cần cấu hình và xác nhận mới');
    const snapshot=openSnapshot(original.snapshotCipher),now=new Date();
    // Validate ALL resources before changing any of them. No client before-image accepted.
    await assertImagesUnchanged(tx,scope.projectId,snapshot);
    const reversed:OperationSnapshot={version:2,resources:[],eventIds:[],replacementIds:[]};
    const resources=[...snapshot.resources].sort((a,b)=>Number(b.resource==='VM_ALLOCATION'&&!b.before)-Number(a.resource==='VM_ALLOCATION'&&!a.before));
    for(const image of resources){
      if(image.resource==='ENDPOINT'){
        const before=image.before;
        if(before){const {revision:_revision,owner:_owner,subgroup:_subgroup,identityId:_identityId,vmId:_vmId,updatedAt:_updatedAt,...data}=before;await tx.proxyIP.update({where:{id:image.id},data:{...data,statusAt:data.statusAt?new Date(data.statusAt):null,retiredAt:data.retiredAt?new Date(data.retiredAt):null,revision:{increment:1}}});}
        else await tx.proxyIP.update({where:{id:image.id},data:{inventoryState:'VOID',status:'RESERVED',retiredAt:now,statusAt:now,notesCipher:encrypt(JSON.stringify({withdrawnByOperation:id,reason:reason.trim()})),revision:{increment:1}}});
        const event=await tx.proxyStatusEvent.create({data:{projectId:scope.projectId,identityId:image.after.identityId!,endpointId:image.id,ip:image.after.host!,kind:'UNDO',occurredAt:now,actorId:scope.userId,reason:reason.trim()}});reversed.eventIds.push(event.id);
      }else if(image.resource==='ACCOUNT'){
        if(image.before){const {revision:_revision,...data}=image.before;await tx.proxyProviderAccount.update({where:{id:image.id},data});}
        else await tx.proxyProviderAccount.update({where:{id:image.id},data:{disabled:true}});
      }else if(image.resource==='MEMBER'){
        if(!image.before)throw new ProxyDomainError('INVALID_INPUT');
        const {accessRevision:_accessRevision,...data}=image.before;await tx.projectMember.update({where:{id:image.id},data});
      }else await restoreVMImage(tx,image,reason.trim());
      reversed.resources.push({...image,before:image.after,after:await readImage(tx,scope.projectId,image.resource,image.id)} as ResourceImage);
      await deps.afterWrite?.();
    }
    // Keep RECEIVED and ownership facts intact, even after cancelling the operation.
    await tx.proxyStatusEvent.updateMany({where:{id:{in:snapshot.eventIds},projectId:scope.projectId,kind:{in:['BLOCKED','REPLACED','SHEET_IMPORT']}},data:{reversedAt:now}});
    await tx.proxyReplacement.updateMany({where:{id:{in:snapshot.replacementIds},projectId:scope.projectId},data:{status:'VOID'}});
    const operation=await recordOperation(tx,{scope:current,kind:'UNDO',summary:{originalKind:original.kind,reason:reason.trim(),count:snapshot.resources.length},snapshot:reversed,undoOfId:id});
    await tx.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'UNDO_OPERATION',entity:'OperationJournal',entityId:operation.id,changes:{undoOfId:id,reason:reason.trim()}}});
    return {id:operation.id,replay:false};
  },db);
}
