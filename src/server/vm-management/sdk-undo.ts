import type {Prisma} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
import type {BusinessImage} from '../business-management/types';
import {syncMirror} from './sdk-store';
async function syncAndLog(tx:Prisma.TransactionClient,projectId:string,vmId:string,actor:string,now:Date){
  const ch=await syncMirror(tx,vmId,actor,now);if(ch)await tx.vMSdkHistory.create({data:{projectId,vmId,previousSdk:ch.from,newSdk:ch.to,actorId:actor,recordedAt:now,note:'Hoàn tác'}});
}
// Undo of an SDK store image (money / note edit, record, replace, move). The journal only gets here when every image of the
// operation is unchanged since (assertImagesUnchanged), so a code another person placed later on one of these VMs blocks the undo.
// - A recorded link to EarnApp is final: refused (also in operation-history/undo-rules.ts).
// - A code the operation created is removed again (it had no other history); a code that existed goes back to its position, money,
//   note and state. Positions are freed before they are taken so the one-VM-one-SDK keys never collide; mirrors follow.
export async function restoreSdkImage(tx:Prisma.TransactionClient,projectId:string,image:BusinessImage,actorId?:string){
  const before=image.before,after=image.after,actor=actorId||'',now=new Date();
  if(after?.linkState==='LINKED'&&before?.linkState!=='LINKED')throw new ProxyDomainError('INVALID_INPUT','SDK đã ghi nối EarnApp giữ vĩnh viễn; không hoàn tác');
  const rec=await tx.sdkRecord.findFirst({where:{id:image.id,projectId}});if(!rec)throw new ProxyDomainError('NOT_FOUND','SDK không còn trong dự án');
  const left=rec.vmId;
  if(!before){
    if(rec.linkState==='LINKED')throw new ProxyDomainError('INVALID_INPUT','SDK đã ghi nối EarnApp giữ vĩnh viễn; không hoàn tác');
    await tx.sdkRecord.update({where:{id:rec.id},data:{vmId:null}});if(left)await syncAndLog(tx,projectId,left,actor,now);
    await tx.sdkRecord.delete({where:{id:rec.id}});return;
  }
  const target=(before.vmId as string|null)??null,date=(v:unknown)=>v?new Date(String(v)):null;
  if(target&&target!==left)await tx.sdkRecord.updateMany({where:{vmId:target,id:{not:rec.id}},data:{vmId:null}});
  await tx.sdkRecord.update({where:{id:rec.id},data:{vmId:target,amount:(before.amount as string|null)??null,currency:String(before.currency||'USD'),amountAt:date(before.amountAt),amountById:(before.amountById as string|null)??null,
    note:(before.note as string|null)??null,noteAt:date(before.noteAt),noteById:(before.noteById as string|null)??null,linkState:before.linkState as 'UNLINKED'|'LINKED'|'UNCONFIRMED',
    linkedEarnAppId:(before.linkedEarnAppId as string|null)??null,linkedVmId:(before.linkedVmId as string|null)??null,linkedCycle:(before.linkedCycle as number|null)??null,linkedAt:date(before.linkedAt),linkedById:(before.linkedById as string|null)??null,
    confirmedAt:date(before.confirmedAt),confirmedById:(before.confirmedById as string|null)??null,revision:{increment:1}}});
  if(left&&left!==target)await syncAndLog(tx,projectId,left,actor,now);
  if(target)await syncAndLog(tx,projectId,target,actor,now);
  await tx.sdkEvent.create({data:{projectId,sdkId:rec.id,kind:'UNDO',fromVmId:left,toVmId:target,actorId:actor,createdAt:now,detail:{via:'Hoàn tác'}}});
}
