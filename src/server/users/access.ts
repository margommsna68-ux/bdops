import type {Prisma,PrismaClient} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
import {checkPinVersion,PIN_LOCK_MS} from '../business-management/pin';
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
/**
 * The PIN of version `verifiedVersion` was just proved on this session: unlock it, in one transaction, only while that version is still the
 * user's PIN, the user is enabled and not PIN-locked, and the session is open under the current authEpoch (review fix 22/10/2026). A PIN
 * changed / removed meanwhile is refused: the newer version is never used to accept an older result. Returns whether it unlocked.
 */
export async function unlockWebSession(db:PrismaClient,sid:string,userId:string,verifiedVersion:number|null){
  if(verifiedVersion==null)return false;
  return db.$transaction(async tx=>{
    const [u]=await tx.$queryRaw<{pin:string|null;pinVersion:number;disabledAt:Date|null;pinLockedAt:Date|null;authEpoch:number}[]>`SELECT "pin","pinVersion","disabledAt","pinLockedAt","authEpoch" FROM "User" WHERE "id"=${userId} FOR SHARE`;
    if(!u?.pin||u.disabledAt||u.pinVersion!==verifiedVersion)return false;
    if(u.pinLockedAt&&new Date(u.pinLockedAt).getTime()+PIN_LOCK_MS>Date.now())return false;
    const n=await tx.userSession.updateMany({where:{id:sid,userId,revokedAt:null,epoch:u.authEpoch},data:{pinUnlockedAt:new Date(),pinVersion:verifiedVersion}});
    return n.count===1;
  });
}
/**
 * Set / change the user's own PIN (review fix 22/10/2026). A first PIN needs none; changing an existing one proves the current PIN through the
 * shared rule (checkPinVersion: wrong-PIN count, 30-minute lock, no unlimited tries) and is applied only on that same PIN version. Hash and
 * version change in one statement; this session is then unlocked with the new version. Returns the new version.
 */
export async function setOwnPin(db:PrismaClient,userId:string,newHash:string,currentPin:string|null|undefined,sid:string|null){
  const before=await db.user.findUniqueOrThrow({where:{id:userId},select:{pin:true}});
  let expected:number|null=null;
  if(before.pin){
    if(!currentPin)throw new ProxyDomainError('INVALID_INPUT','Cần PIN hiện tại để đổi PIN');
    const r=await checkPinVersion(db,userId,currentPin);
    if(r.result==='LOCKED'||r.result==='LOCKED_NOW')throw new ProxyDomainError('FORBIDDEN',r.result==='LOCKED_NOW'?'Sai PIN 3 lần; khoá 30 phút':'PIN đang bị khoá. Liên hệ quản lý hoặc chờ hết 30 phút.');
    if(r.result==='NOT_SET')throw new ProxyDomainError('STALE_PREVIEW','PIN vừa bị xoá; đặt PIN mới');
    if(r.result!=='OK')throw new ProxyDomainError('FORBIDDEN','PIN hiện tại chưa đúng');
    expected=r.pinVersion;
  }
  const version=await db.$transaction(async tx=>{
    const [u]=await tx.$queryRaw<{pin:string|null;pinVersion:number;disabledAt:Date|null;pinLockedAt:Date|null}[]>`SELECT "pin","pinVersion","disabledAt","pinLockedAt" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
    if(!u||u.disabledAt)throw new ProxyDomainError('FORBIDDEN',DISABLED_MESSAGE);
    if(expected===null?!!u.pin:(!u.pin||u.pinVersion!==expected))throw new ProxyDomainError('STALE_PREVIEW','PIN vừa được đổi ở nơi khác; tải lại rồi thử lại');
    if(u.pinLockedAt&&new Date(u.pinLockedAt).getTime()+PIN_LOCK_MS>Date.now())throw new ProxyDomainError('FORBIDDEN','PIN đang bị khoá. Liên hệ quản lý hoặc chờ hết 30 phút.');
    return (await tx.user.update({where:{id:userId},data:{pin:newHash,pinVersion:{increment:1},pinFailedCount:0,pinLockedAt:null},select:{pinVersion:true}})).pinVersion;
  });
  if(sid)await unlockWebSession(db,sid,userId,version);
  return version;
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
