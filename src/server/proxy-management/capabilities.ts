import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {withProxyTransaction} from './transaction';
import {ProxyDomainError,type ActorScope} from './types';
import {recordOperation} from '../operation-history/journal';
import {captureMember} from '../operation-history/snapshot';
// EARN_BALANCE (20/10/2026): record EarnApp balance checks without being a manager (e.g. a dedicated AI account).
// EARN_PAYOUT (21/10/2026): prepare a payout request (hold an email) and record it sent / unknown on EarnApp; nothing else of money.
// PAYPAL_RECEIPT_RECORD (21/10/2026): record money received on PayPal for a payout request already sent; no other ledger write.
// VM_PROXY_FOR_OPS (21/10/2026): read the full proxy (IP:port:user:pass) of the one VM the operator has taken in hand (an active job),
// to configure the real machine; never the registry, never another VM (vm-ops/jobs.ts).
// They are off by default and given by an ADMIN; they are checked in the payout services (vm-ops/payout.ts), not only at the API.
export const proxyCapabilities=['COPY_CREDENTIALS','PROXY_IMPORT','PROXY_REPLACE','EARN_BALANCE','EARN_PAYOUT','PAYPAL_RECEIPT_RECORD','VM_PROXY_FOR_OPS'] as const;
async function administrator(scope:ActorScope,db:Parameters<typeof loadInfrastructureScope>[0]){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);
  if(current.role!=='ADMIN'||current.businessMode!=='PROXY_VM') throw new ProxyDomainError('FORBIDDEN');
  return current;
}
export async function listProxyMembers(scope:ActorScope,db:PrismaClient=prisma){
  await administrator(scope,db);
  return db.projectMember.findMany({where:{projectId:scope.projectId},select:{id:true,role:true,capabilities:true,allowedModules:true,serverScope:true,allowedServerIds:true,accessRevision:true,user:{select:{name:true,username:true,email:true}}},orderBy:{createdAt:'asc'}});
}
export async function listServerAccessChoices(scope:ActorScope,db:PrismaClient=prisma){
  await administrator(scope,db);
  return db.server.findMany({where:{projectId:scope.projectId},select:{id:true,code:true},orderBy:{code:'asc'}});
}
export interface MemberServerAccess {mode:'ALL'|'SELECTED';serverIds:string[];expectedAccessRevision:number}
export async function setProxyCapabilities(scope:ActorScope,memberId:string,capabilities:string[],db:PrismaClient=prisma,allowInfrastructure?:boolean,serverAccess?:MemberServerAccess){
  return withProxyTransaction(async tx=>{
    await administrator(scope,tx);
    if(capabilities.some(c=>!proxyCapabilities.includes(c as typeof proxyCapabilities[number]))) throw new ProxyDomainError('INVALID_INPUT');
    // Serialize grants/revocations against every writer of the target membership, including role changes and legacy undo.
    await tx.$queryRaw`SELECT "id" FROM "ProjectMember" WHERE "id"=${memberId} AND "projectId"=${scope.projectId} FOR UPDATE`;
    const member=await tx.projectMember.findFirst({where:{id:memberId,projectId:scope.projectId}});
    if(!member) throw new ProxyDomainError('FORBIDDEN');
    if(member.role==='VIEWER'&&capabilities.length) throw new ProxyDomainError('FORBIDDEN','Tài khoản chỉ xem không nhận quyền thao tác/copy');
    if(allowInfrastructure===false&&capabilities.length) throw new ProxyDomainError('INVALID_INPUT','Tắt quyền truy cập phải tắt các quyền thao tác');
    if(member.role==='ADMIN'&&allowInfrastructure===false) throw new ProxyDomainError('FORBIDDEN');
    let serverScope=member.role==='ADMIN'?'ALL':member.serverScope,allowedServerIds=member.role==='ADMIN'?[]:member.allowedServerIds;
    if(serverAccess){
      if(!['ALL','SELECTED'].includes(serverAccess.mode)||!Number.isSafeInteger(serverAccess.expectedAccessRevision)||serverAccess.expectedAccessRevision<0||serverAccess.serverIds.some(id=>!id.trim())||new Set(serverAccess.serverIds).size!==serverAccess.serverIds.length) throw new ProxyDomainError('INVALID_INPUT','Danh sách server không hợp lệ hoặc trùng lặp');
      if(member.accessRevision!==serverAccess.expectedAccessRevision) throw new ProxyDomainError('STALE_PREVIEW','Quyền vừa được thay đổi; tải lại trước khi lưu');
      if(member.role==='ADMIN'&&serverAccess.mode!=='ALL') throw new ProxyDomainError('FORBIDDEN','ADMIN luôn có quyền trên toàn bộ server');
      const servers=await tx.server.findMany({where:{projectId:scope.projectId,id:{in:serverAccess.serverIds}},select:{id:true}});
      if(servers.length!==serverAccess.serverIds.length) throw new ProxyDomainError('INVALID_INPUT','Server không thuộc dự án đang chọn');
      serverScope=serverAccess.mode;
      allowedServerIds=serverScope==='ALL'?[]:[...serverAccess.serverIds].sort();
    }
    const scopeChanged=serverScope!==member.serverScope||JSON.stringify([...allowedServerIds].sort())!==JSON.stringify([...member.allowedServerIds].sort());
    const next=[...member.capabilities.filter(c=>!proxyCapabilities.includes(c as typeof proxyCapabilities[number])),...Array.from(new Set(capabilities))];
    const allowedModules=allowInfrastructure===undefined?member.allowedModules:allowInfrastructure?Array.from(new Set([...member.allowedModules,'INFRASTRUCTURE'])):member.allowedModules.filter(m=>m!=='INFRASTRUCTURE');
    const updated=await tx.projectMember.update({where:{id:member.id},data:{capabilities:next,allowedModules,...(serverAccess||scopeChanged?{serverScope,allowedServerIds}:{}),...(scopeChanged?{accessRevision:{increment:1}}:{})}});
    // Scope changes are final journal milestones. Incrementing the member revision also makes older MEMBER images stale.
    await recordOperation(tx,{scope,kind:'ACCESS',reversible:!scopeChanged,summary:{member:member.id,count:next.length,...(scopeChanged?{serverScope,serverCount:allowedServerIds.length}:{})},snapshot:{version:1,resources:[{resource:'MEMBER',id:member.id,before:captureMember(member),after:captureMember(updated)}],eventIds:[],replacementIds:[]}});
    await tx.auditLog.create({data:{projectId:scope.projectId,userId:scope.userId,action:'PROXY_CAPABILITIES',entity:'ProjectMember',entityId:member.id,changes:{capabilities:next,allowInfrastructure:allowedModules.includes('INFRASTRUCTURE'),serverScope,allowedServerIds,accessRevision:updated.accessRevision}}});
    return {saved:true};
  },db);
}
