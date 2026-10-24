import type {PrismaClient} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
import {assertUserEnabled} from '../users/access';
// Legacy AutoType edits project stock. A server-limited user never owns that stock, even with a token issued before restriction.
export async function updateUnrestrictedAutotypePassword(db:PrismaClient,input:{userId:string;projectId:string;paypalId:string;emailId:string|null;encryptedPassword:string;authEpoch:number}){
 return db.$transaction(async tx=>{
  await assertUserEnabled(tx,input.userId);
  const user=await tx.user.findUnique({where:{id:input.userId},select:{authEpoch:true}});
  await tx.$queryRaw`SELECT "id" FROM "ProjectMember" WHERE "userId"=${input.userId} AND "projectId"=${input.projectId} FOR SHARE`;
  const member=await tx.projectMember.findUnique({where:{userId_projectId:{userId:input.userId,projectId:input.projectId}}});
  if(!user||user.authEpoch!==input.authEpoch||!member||member.serverScope!=='ALL'||member.role!=='ADMIN'&&!member.allowedModules.includes('AUTOTYPE'))throw new ProxyDomainError('FORBIDDEN','Quyền AutoType đã thay đổi');
  const paypal=await tx.payPalAccount.findFirst({where:{id:input.paypalId,projectId:input.projectId},select:{id:true}});
  if(!paypal)throw new ProxyDomainError('NOT_FOUND');
  if(input.emailId&&!await tx.payPalEmail.findFirst({where:{id:input.emailId,paypalId:paypal.id},select:{id:true}}))throw new ProxyDomainError('NOT_FOUND');
  await tx.payPalAccount.update({where:{id:paypal.id},data:{password:input.encryptedPassword}});
  if(input.emailId)await tx.payPalEmail.update({where:{id:input.emailId},data:{password:input.encryptedPassword}});
 });
}
