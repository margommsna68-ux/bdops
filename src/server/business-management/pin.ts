import type {Prisma,PrismaClient} from '@prisma/client';
import bcrypt from 'bcryptjs';
import {ProxyDomainError} from '../proxy-management/types';
export const PIN_LOCK_MS=30*60000;
// One PIN rule for the web and the ops API (21/10/2026): 3 wrong PINs lock the user for 30 minutes, whatever channel was used.
// LOCKED_NOW = this wrong PIN was the third one; LOCKED = already locked.
export type PinCheck='OK'|'INVALID'|'LOCKED_NOW'|'LOCKED'|'NOT_SET';
type Db=PrismaClient|Prisma.TransactionClient;
// The comparison (bcrypt) is slow and runs outside any lock; its result is then applied in a short transaction holding the user row
// (SELECT … FOR UPDATE), so concurrent checks of one user are decided one by one on the state as it is THEN (review fix 21/10/2026):
// - a lock written meanwhile by other wrong PINs wins over a correct PIN compared earlier;
// - a PIN changed meanwhile is compared again against the new hash (a result on the old hash is never accepted);
// - the failure count is written by this short transaction on its own connection: a business transaction that later rolls back
//   cannot undo it. Callers pass the plain client (never a business transaction).
export async function checkPin(db:Db,userId:string,pin:string):Promise<PinCheck>{return (await checkPinVersion(db,userId,pin)).result;}
// Review fix 22/10/2026: the decision is tied to the PIN version it was made on (User.pinVersion read in the same locked step), so a
// caller that acts on an OK (unlocking a session, changing the PIN) can refuse when the PIN changed afterwards.
export async function checkPinVersion(db:Db,userId:string,pin:string):Promise<{result:PinCheck;pinVersion:number|null}>{
 for(let attempt=0;attempt<3;attempt++){
  const user=await db.user.findUnique({where:{id:userId},select:{pin:true,pinLockedAt:true,pinVersion:true}});if(!user?.pin)return {result:'NOT_SET',pinVersion:user?.pinVersion??null};
  if(user.pinLockedAt&&user.pinLockedAt.getTime()+PIN_LOCK_MS>Date.now())return {result:'LOCKED',pinVersion:user.pinVersion};
  const compared=user.pin,valid=await bcrypt.compare(pin,compared);
  let version:number|null=null;
  const apply=async(tx:Prisma.TransactionClient):Promise<PinCheck|'AGAIN'>=>{
   const [row]=await tx.$queryRaw<{pin:string|null;pinFailedCount:number;pinLockedAt:Date|null;pinVersion:number}[]>`SELECT "pin","pinFailedCount","pinLockedAt","pinVersion" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
   version=row?.pinVersion??null;
   if(!row?.pin)return 'NOT_SET';
   const lockedAt=row.pinLockedAt?new Date(row.pinLockedAt):null;
   if(lockedAt&&lockedAt.getTime()+PIN_LOCK_MS>Date.now())return 'LOCKED';
   if(row.pin!==compared)return 'AGAIN';
   // An expired lock starts the count again.
   const failed=lockedAt?0:row.pinFailedCount;
   if(valid){await tx.user.update({where:{id:userId},data:{pinFailedCount:0,pinLockedAt:null}});return 'OK';}
   const next=failed+1;await tx.user.update({where:{id:userId},data:{pinFailedCount:next,pinLockedAt:next>=3?new Date():null}});return next>=3?'LOCKED_NOW':'INVALID';
  };
  const r='$transaction' in db?await (db as PrismaClient).$transaction(apply):await apply(db as Prisma.TransactionClient);
  if(r!=='AGAIN')return {result:r,pinVersion:version};
 }
 return {result:'INVALID',pinVersion:null};
}
/** Proofs are server-local objects, never accepted from request bodies or serializable unlock flags. */
export type BusinessPinProof=Readonly<{userId:string;kind:'PIN'|'TOTP';version:number;authEpoch:number;sessionId:string|null;verifiedAt:number}>;
const issuedProofs=new WeakSet<BusinessPinProof>();
const PROOF_MAX_AGE_MS=2*60000;
const proofError=()=>new ProxyDomainError('FORBIDDEN','Phiên xác thực vừa thay đổi; mở khoá lại bằng PIN / mã 2FA của bạn');
type ProofUser={password:string|null;pin:string|null;pinVersion:number;pinLockedAt:Date|null;totpEnabledAt:Date|null;totpVersion:number;totpLockedAt:Date|null;disabledAt:Date|null;authEpoch:number;totpRequiredAt:Date|null;passwordResetRequiredAt:Date|null};
function eligible(u:ProofUser|undefined){if(!u||u.disabledAt||u.passwordResetRequiredAt||u.totpRequiredAt&&!u.totpEnabledAt)throw proofError();}
function issueProof(data:Omit<BusinessPinProof,'verifiedAt'>){const proof=Object.freeze({...data,verifiedAt:Date.now()});issuedProofs.add(proof);return proof;}
/** Recheck in the reveal transaction, before decrypting/auditing. User and session locks order a reveal against reset/revocation.
 * This does NOT consume the TOTP again. A checked HTTP session already proved that factor at login/unlock. */
export async function assertBusinessPinProof(tx:Prisma.TransactionClient,userId:string,proof:BusinessPinProof){
 if(!proof||!issuedProofs.has(proof)||proof.userId!==userId||Date.now()-proof.verifiedAt>PROOF_MAX_AGE_MS||proof.verifiedAt>Date.now())throw proofError();
 const [u]=await tx.$queryRaw<ProofUser[]>`SELECT "password","pin","pinVersion","pinLockedAt","totpEnabledAt","totpVersion","totpLockedAt","disabledAt","authEpoch","totpRequiredAt","passwordResetRequiredAt" FROM "User" WHERE "id"=${userId} FOR SHARE`;
 eligible(u);if(u.authEpoch!==proof.authEpoch)throw proofError();
 const totp=!!u.totpEnabledAt,lockedAt=totp?u.totpLockedAt:u.pinLockedAt;
 if((totp?'TOTP':'PIN')!==proof.kind||(totp?u.totpVersion:u.pinVersion)!==proof.version||!totp&&!u.pin)throw proofError();
 if(lockedAt&&new Date(lockedAt).getTime()+PIN_LOCK_MS>Date.now())throw proofError();
 if(proof.sessionId){
  if(!u.password)throw proofError();
  const [s]=await tx.$queryRaw<{userId:string;epoch:number;revokedAt:Date|null;pinUnlockedAt:Date|null;pinVersion:number|null;totpUnlockedAt:Date|null;totpVersion:number|null}[]>`SELECT "userId","epoch","revokedAt","pinUnlockedAt","pinVersion","totpUnlockedAt","totpVersion" FROM "UserSession" WHERE "id"=${proof.sessionId} FOR SHARE`;
  if(!s||s.userId!==userId||s.revokedAt||s.epoch!==u.authEpoch)throw proofError();
  if(totp?(!s.totpUnlockedAt||s.totpVersion!==u.totpVersion):(!s.pinUnlockedAt||s.pinVersion!==u.pinVersion))throw proofError();
 }
}
/** Only HTTP router code supplies sessionId, taken from ctx.web. No input session id, boolean or cached client unlock is a proof. */
export async function verifyBusinessWebSession(db:PrismaClient,userId:string,sessionId:string):Promise<BusinessPinProof>{
 const {checkWebSession}=await import('../users/access');
 const checked=await checkWebSession(db,sessionId,userId);if(!checked.ok||!checked.pinUnlocked)throw proofError();
 const u=await db.user.findUnique({where:{id:userId},select:{password:true,pin:true,pinVersion:true,pinLockedAt:true,totpEnabledAt:true,totpVersion:true,totpLockedAt:true,disabledAt:true,authEpoch:true,totpRequiredAt:true,passwordResetRequiredAt:true}});
 eligible(u??undefined);if(!u)throw proofError();
 const proof=issueProof({userId,kind:u.totpEnabledAt?'TOTP':'PIN',version:u.totpEnabledAt?u.totpVersion:u.pinVersion,authEpoch:u.authEpoch,sessionId});
 await db.$transaction(tx=>assertBusinessPinProof(tx,userId,proof));return proof;
}
/** Direct service callers still prove their own TOTP (or one-use backup) / legacy PIN. Wrong attempts commit independently.
 * Return the proof so the action can recheck the same factor/version under its own transaction lock. */
export async function verifyBusinessPin(db:PrismaClient,userId:string,pin:string):Promise<BusinessPinProof>{
 const u=await db.user.findUnique({where:{id:userId},select:{password:true,pin:true,pinVersion:true,pinLockedAt:true,totpEnabledAt:true,totpVersion:true,totpLockedAt:true,disabledAt:true,authEpoch:true,totpRequiredAt:true,passwordResetRequiredAt:true}});
 eligible(u??undefined);if(!u)throw proofError();
 let kind:BusinessPinProof['kind'],version:number|null;
 if(u.totpEnabledAt){
  const {checkTotp,totpMessage}=await import('../users/totp');
  const t=await checkTotp(db,userId,pin);
  if(t.result!=='OK')throw new ProxyDomainError('FORBIDDEN',totpMessage(t.result,u.totpLockedAt));
  kind='TOTP';version=t.totpVersion;
 }else{
  const checked=await checkPinVersion(db,userId,pin),r=checked.result;
  if(r==='NOT_SET')throw new ProxyDomainError('FORBIDDEN','Cần đặt PIN trước khi copy thông tin đăng nhập');
  if(r==='LOCKED')throw new ProxyDomainError('FORBIDDEN','PIN đang bị khóa. Liên hệ quản lý hoặc chờ hết 30 phút.');
  if(r==='LOCKED_NOW')throw new ProxyDomainError('FORBIDDEN','Sai PIN 3 lần; khóa 30 phút');
  if(r==='INVALID')throw new ProxyDomainError('FORBIDDEN','PIN chưa đúng');
  kind='PIN';version=checked.pinVersion;
 }
 if(version===null)throw proofError();
 const proof=issueProof({userId,kind,version,authEpoch:u.authEpoch,sessionId:null});
 await db.$transaction(tx=>assertBusinessPinProof(tx,userId,proof));return proof;
}
