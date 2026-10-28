import type {Prisma,PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {assertInfrastructureAction,loadInfrastructureScope} from '../permissions/infrastructure';
import {assertUnrestrictedServers} from '../permissions/server-scope';
import {runBusinessCommand} from '../business-management/idempotency';
import {ProxyDomainError,type ActorScope} from './types';
type Reader=PrismaClient|Prisma.TransactionClient;
// Proxy package maintenance commands (owner 29/10/2026). Both are checked, journaled business commands (key + replay,
// undo through the operation journal). 
async function authorizeManage(tx:Reader,scope:ActorScope){
  const current=await loadInfrastructureScope(tx,scope.userId,scope.projectId);assertInfrastructureAction(current,'MANAGE');
  if(current.businessMode!=='PROXY_VM')throw new ProxyDomainError('FORBIDDEN');
  await assertUnrestrictedServers(tx,current);return current;
}
const bangkokDay=(d:Date)=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric'}).format(d);
/**
 * Rename a package code (the provider renumbers package IDs after each payment: 231243 → 252037). One transaction: the package row,
 * every endpoint's packageCode, a "Mã cũ" line in the note. The package id (reminders, costs) never changes. Refused when the new code
 * already exists. Undo restores the old code on the package and on every endpoint.
 */
export async function renamePackage(scope:ActorScope,input:{key:string;code:string;newCode:string;expectedRevision?:number},db:PrismaClient=prisma){
  const code=input.code.trim(),newCode=input.newCode.trim();
  if(!code||!newCode||newCode.length>80)throw new ProxyDomainError('INVALID_INPUT','Mã gói mới 1–80 ký tự');
  if(code===newCode)throw new ProxyDomainError('INVALID_INPUT','Mã gói mới trùng mã hiện tại');
  return runBusinessCommand(scope,{key:input.key,payload:{code,newCode,expectedRevision:input.expectedRevision??null},kind:'PACKAGE_RENAME',module:'INFRASTRUCTURE',authorize:tx=>authorizeManage(tx,scope)},async(tx,images)=>{
    const account=await tx.proxyProviderAccount.findUnique({where:{projectId_code:{projectId:scope.projectId,code}}});if(!account)throw new ProxyDomainError('NOT_FOUND','Không có gói '+code);
    if(input.expectedRevision!==undefined&&account.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','Gói vừa được sửa; tải lại');
    if(await tx.proxyProviderAccount.findUnique({where:{projectId_code:{projectId:scope.projectId,code:newCode}}}))throw new ProxyDomainError('DUPLICATE_INPUT','Mã gói '+newCode+' đã có');
    const now=new Date(),line='Mã cũ: '+code+' (đổi '+bangkokDay(now)+')';
    let note=account.note?account.note+' · '+line:line;if(note.length>500)note=note.slice(note.length-500);
    const label=account.label===code||account.label.startsWith(newCode)?newCode:account.label;
    await images.remember('ACCOUNT',account.id);
    await tx.proxyProviderAccount.update({where:{id:account.id},data:{code:newCode,label,note,revision:{increment:1}}});
    const endpoints=await tx.proxyIP.findMany({where:{projectId:scope.projectId,packageCode:code},select:{id:true},orderBy:{id:'asc'}});
    for(const e of endpoints)await images.remember('ENDPOINT',e.id);
    if(endpoints.length)await tx.proxyIP.updateMany({where:{id:{in:endpoints.map(e=>e.id)}},data:{packageCode:newCode,revision:{increment:1}}});
    await tx.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'PROXY_CATALOG',entity:'ProxyProviderAccount',entityId:account.id,changes:{rename:{from:code,to:newCode},endpoints:endpoints.length}}});
    return {packageId:account.id,code:newCode,oldCode:code,label,endpoints:endpoints.length};
  },db);
}

