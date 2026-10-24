import {AsyncLocalStorage} from 'node:async_hooks';
import type {Prisma} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
import {assertScopedTargets,assertScopedSdkCodes,assertUnrestrictedServers} from '../permissions/server-scope';
// Which ops API token a write runs for (review fix 21/10/2026). Set only by the API handler around the service call, kept in server
// memory for that call (AsyncLocalStorage): no request field, header or tRPC input can set or change it.
// runBusinessCommand calls assertOpsToken inside its transaction, before a replay or a write: the token row is read FOR SHARE, so a
// revoke (UPDATE of that row) either lands before — and the write is refused — or waits until the write has committed.
/** `also`: more operations this write needs (e.g. BALANCE_WRITE when an SDK observation carries money), checked with `operation`. */
export interface OpsAuth {tokenId:string;userId:string;operation:string|null;also?:string[];targets?:unknown;unrestrictedServers?:boolean}
const store=new AsyncLocalStorage<OpsAuth>();
export const runWithOpsAuth=<T>(auth:OpsAuth,fn:()=>Promise<T>)=>store.run(auth,fn);
export async function assertOpsToken(tx:Prisma.TransactionClient,scope:{userId:string;projectId:string}){
  const auth=store.getStore();if(!auth)return;
  const [t]=await tx.$queryRaw<{userId:string;projectIds:string[];scopes:string[];expiresAt:Date;revokedAt:Date|null}[]>`SELECT "userId","projectIds","scopes","expiresAt","revokedAt" FROM "OpsToken" WHERE "id"=${auth.tokenId} FOR SHARE`;
  if(!t)throw new ProxyDomainError('FORBIDDEN','Token không hợp lệ','UNAUTHORIZED');
  if(t.revokedAt)throw new ProxyDomainError('FORBIDDEN','Token đã bị thu hồi','TOKEN_REVOKED');
  // The column has no time zone and holds UTC; read back through the raw query it is compared as UTC.
  const expires=new Date(t.expiresAt);if(expires.getTime()<=Date.now())throw new ProxyDomainError('FORBIDDEN','Token đã hết hạn','TOKEN_EXPIRED');
  if(t.userId!==auth.userId||scope.userId!==auth.userId)throw new ProxyDomainError('FORBIDDEN','Token không thuộc người dùng này','UNAUTHORIZED');
  if(!t.projectIds.includes(scope.projectId))throw new ProxyDomainError('FORBIDDEN','Dự án không nằm trong phạm vi token');
  if((auth.operation&&!t.scopes.includes(auth.operation))||(auth.also||[]).some(s=>!t.scopes.includes(s)))throw new ProxyDomainError('FORBIDDEN','Token không được cấp thao tác này');
  const [u]=await tx.$queryRaw<{password:string|null;loginLockedAt:Date|null;disabledAt:Date|null}[]>`SELECT "password","loginLockedAt","disabledAt" FROM "User" WHERE "id"=${auth.userId} FOR SHARE`;
  if(u?.disabledAt)throw new ProxyDomainError('FORBIDDEN','Tài khoản của token đã bị vô hiệu hoá','UNAUTHORIZED');
  if(!u?.password||u.loginLockedAt&&new Date(u.loginLockedAt).getTime()+30*60000>Date.now())throw new ProxyDomainError('FORBIDDEN','Tài khoản của token đang bị khoá hoặc không còn đăng nhập được');
  // The transaction refreshes and locks membership before a journal result can be replayed.
  const actor={...scope,role:'USER' as const,capabilities:[]};
  if(auth.unrestrictedServers)await assertUnrestrictedServers(tx,actor);
  await assertScopedTargets(tx,actor,auth.targets);
  const jobIds=new Set<string>(),codes=new Set<string>();
  function scan(value:unknown){
    if(!value||typeof value!=='object')return;
    for(const [key,v] of Object.entries(value)){
      if(key==='jobId'&&typeof v==='string')jobIds.add(v);
      if(key==='code'&&typeof v==='string')codes.add(v.trim());
      if(v&&typeof v==='object')scan(v);
    }
  }
  scan(auth.targets);
  for(const id of jobIds){
    const job=await tx.vmJob.findFirst({where:{id,projectId:scope.projectId},select:{vmId:true,claimedById:true,tokenId:true}});
    if(!job)throw new ProxyDomainError('NOT_FOUND','Không có việc này trong dự án');
    const vmId=(auth.targets as {vmId?:unknown})?.vmId;
    if(typeof vmId==='string'&&job.vmId!==vmId)throw new ProxyDomainError('INVALID_INPUT','Việc này thuộc VM khác','VALIDATION');
    if(job.claimedById!==auth.userId||job.tokenId!==auth.tokenId)throw new ProxyDomainError('FORBIDDEN','Việc này do người / token khác nhận');
  }
  await assertScopedSdkCodes(tx,actor,[...codes],{allowNew:true});
}
