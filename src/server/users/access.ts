import type {Prisma,PrismaClient} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
// Account access (owner brief 22/10/2026).
// - Disabled (an ADMIN's decision: User.disabledAt) is not the temporary lock after wrong passwords / PINs (loginLockedAt / pinLockedAt).
// - A web sign-in opens a UserSession; the JWT carries only its id. Every request checks the session is open, belongs to the user, was
//   made under the user's current authEpoch and that the user is enabled. Disabling / enabling bumps authEpoch: older sessions never
//   come back, even after enabling again.
// - The PIN unlock lives on the session with the PIN version it was made with (User.pinVersion). A PIN change (own or by an admin) or a
//   PIN removal bumps the version, so older unlocks stop working. Nothing on the client (sessionStorage, an open dialog) proves an unlock.
// - Writes check the user is enabled inside their own transaction (assertUserEnabled, FOR SHARE on the user row): disabling (an UPDATE
//   of that row) either waits for a write that already passed the check or makes every later write fail.
type Db=PrismaClient|Prisma.TransactionClient;
export const DISABLED_MESSAGE='Tài khoản đã bị vô hiệu hoá. Liên hệ quản trị.';
export async function assertUserEnabled(db:Db,userId:string){
  const [u]=await db.$queryRaw<{disabledAt:Date|null}[]>`SELECT "disabledAt" FROM "User" WHERE "id"=${userId} FOR SHARE`;
  if(!u||u.disabledAt)throw new ProxyDomainError('FORBIDDEN',DISABLED_MESSAGE,'UNAUTHORIZED');
}
export async function openWebSession(db:Db,userId:string){
  const u=await db.user.findUniqueOrThrow({where:{id:userId},select:{authEpoch:true}});
  return db.userSession.create({data:{userId,epoch:u.authEpoch}});
}
export type WebSessionCheck={ok:true;sessionId:string;pinUnlocked:boolean}|{ok:false;reason:'NO_SESSION'|'REVOKED'|'DISABLED'|'EPOCH'|'NO_LOGIN'};
/** The web session of a request (JWT sid + user), or why it is no longer valid. Touches lastSeenAt at most once a minute. */
export async function checkWebSession(db:PrismaClient,sid:string|null|undefined,userId:string):Promise<WebSessionCheck>{
  if(!sid)return {ok:false,reason:'NO_SESSION'};
  const s=await db.userSession.findUnique({where:{id:sid},include:{user:{select:{disabledAt:true,authEpoch:true,password:true,pin:true,pinVersion:true}}}});
  if(!s||s.userId!==userId)return {ok:false,reason:'NO_SESSION'};
  if(s.revokedAt)return {ok:false,reason:'REVOKED'};
  if(s.user.disabledAt)return {ok:false,reason:'DISABLED'};
  if(!s.user.password)return {ok:false,reason:'NO_LOGIN'};
  if(s.epoch!==s.user.authEpoch)return {ok:false,reason:'EPOCH'};
  if(Date.now()-s.lastSeenAt.getTime()>60000)await db.userSession.update({where:{id:s.id},data:{lastSeenAt:new Date()}}).catch(()=>undefined);
  return {ok:true,sessionId:s.id,pinUnlocked:!!s.user.pin&&!!s.pinUnlockedAt&&s.pinVersion===s.user.pinVersion};
}
export async function revokeWebSession(db:Db,sid:string,reason:string){
  await db.userSession.updateMany({where:{id:sid,revokedAt:null},data:{revokedAt:new Date(),revokeReason:reason}});
}
/** The PIN was just proved on this session: unlock it for the user's current PIN version. */
export async function unlockWebSession(db:Db,sid:string,userId:string){
  const u=await db.user.findUniqueOrThrow({where:{id:userId},select:{pinVersion:true}});
  await db.userSession.updateMany({where:{id:sid,userId,revokedAt:null},data:{pinUnlockedAt:new Date(),pinVersion:u.pinVersion}});
}
/** A new / changed / removed PIN: every PIN unlock of the user made before stops counting. Returns the new version. */
export async function bumpPinVersion(db:Db,userId:string){
  return (await db.user.update({where:{id:userId},data:{pinVersion:{increment:1}},select:{pinVersion:true}})).pinVersion;
}
// ─── Disable / enable ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Disable or enable the whole account. The caller (actorId) must be ADMIN of every project the user belongs to (checked by the router
 * through assertUserTarget). Never oneself; never the last enabled ADMIN of a project. Disabling revokes every web session, every ops
 * token and the autotype sessions, releases the user's active VM jobs and is journaled; nothing of the user or the business data is
 * deleted. Enabling lets the user sign in again: older sessions, PIN unlocks and tokens stay dead.
 */
export async function setUserDisabled(db:PrismaClient,actorId:string,input:{userId:string;disabled:boolean;reason?:string|null;projectId:string}){
  if(input.userId===actorId)throw new ProxyDomainError('FORBIDDEN','Không tự vô hiệu hoá tài khoản của mình');
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${input.userId} FOR UPDATE`;
    const user=await tx.user.findUniqueOrThrow({where:{id:input.userId},select:{id:true,disabledAt:true,username:true,memberships:{select:{projectId:true,role:true}}}});
    const now=new Date();
    if(input.disabled){
      if(user.disabledAt)return {changed:false,disabled:true,revokedTokens:0,revokedSessions:0,projects:user.memberships.length};
      for(const m of user.memberships.filter(x=>x.role==='ADMIN')){
        const others=await tx.projectMember.count({where:{projectId:m.projectId,role:'ADMIN',userId:{not:user.id},user:{disabledAt:null}}});
        if(!others)throw new ProxyDomainError('FORBIDDEN','Đây là quản trị viên cuối cùng của một dự án; cấp ADMIN cho người khác trước');
      }
      await tx.user.update({where:{id:user.id},data:{disabledAt:now,disabledById:actorId,disabledReason:input.reason?.trim().slice(0,300)||null,authEpoch:{increment:1}}});
      const sessions=await tx.userSession.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:now,revokeReason:'USER_DISABLED'}});
      const tokens=await tx.opsToken.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:now,revokedById:actorId}});
      await tx.vmJob.updateMany({where:{claimedById:user.id,state:'ACTIVE'},data:{state:'RELEASED',result:'USER_DISABLED',finishedAt:now}});
      await tx.autotypeSession.deleteMany({where:{userId:user.id}}).catch(()=>undefined);
      for(const m of user.memberships)await tx.auditLog.create({data:{projectId:m.projectId,userId:actorId,action:'USER_DISABLE',entity:'User',entityId:user.id,changes:{scope:'ACCOUNT',projects:user.memberships.length,revokedTokens:tokens.count,revokedSessions:sessions.count,reason:input.reason?.trim().slice(0,300)||null}}});
      return {changed:true,disabled:true,revokedTokens:tokens.count,revokedSessions:sessions.count,projects:user.memberships.length};
    }
    if(!user.disabledAt)return {changed:false,disabled:false,revokedTokens:0,revokedSessions:0,projects:user.memberships.length};
    await tx.user.update({where:{id:user.id},data:{disabledAt:null,disabledById:null,disabledReason:null,authEpoch:{increment:1}}});
    for(const m of user.memberships)await tx.auditLog.create({data:{projectId:m.projectId,userId:actorId,action:'USER_ENABLE',entity:'User',entityId:user.id,changes:{scope:'ACCOUNT',projects:user.memberships.length}}});
    return {changed:true,disabled:false,revokedTokens:0,revokedSessions:0,projects:user.memberships.length};
  });
}
/** Short state of an account for the admin lists. */
export function accountState(u:{disabledAt:Date|null;loginLockedAt:Date|null;pinLockedAt:Date|null},lockMs:number){
  if(u.disabledAt)return 'DISABLED' as const;
  const locked=(d:Date|null)=>!!d&&d.getTime()+lockMs>Date.now();
  if(locked(u.loginLockedAt)||locked(u.pinLockedAt))return 'LOCKED' as const;
  return 'ACTIVE' as const;
}
