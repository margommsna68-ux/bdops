import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import type {Prisma,PrismaClient} from '@prisma/client';
import bcrypt from 'bcryptjs';
import {toDataURL} from 'qrcode';
import {encrypt,decrypt} from '@/lib/encryption';
import {ProxyDomainError} from '../proxy-management/types';
// 2FA with a Google Authenticator-style TOTP (owner decision 23/10/2026; replaces the fixed PIN for people).
// RFC 6238: SHA-1, 6 digits, 30-second steps, ±1 step tolerance. The secret is stored encrypted and never returned after the setup
// is confirmed. Anti-replay: the last accepted step is written under a row lock, so one code never opens two things. Wrong codes count
// 3 → 30 minutes (one counter for sign-in, unlock and approvals). Backup codes: 8, bcrypt-hashed, one use each.
export const TOTP_LOCK_MS=30*60000,TOTP_STEP_MS=30000,TOTP_DIGITS=6,TOTP_WINDOW=1,BACKUP_COUNT=8;
const ISSUER='MoneyToHome';
type Db=PrismaClient|Prisma.TransactionClient;
const B32='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf:Buffer){let bits=0,value=0,out='';for(const b of buf){value=(value<<8)|b;bits+=8;while(bits>=5){out+=B32[(value>>>(bits-5))&31];bits-=5;}}if(bits>0)out+=B32[(value<<(5-bits))&31];return out;}
export function base32Decode(s:string){const clean=s.toUpperCase().replace(/[^A-Z2-7]/g,'');let bits=0,value=0;const out:number[]=[];for(const ch of clean){value=(value<<5)|B32.indexOf(ch);bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;}}return Buffer.from(out);}
export function hotp(secretBase32:string,counter:number){
  const key=base32Decode(secretBase32),msg=Buffer.alloc(8);msg.writeUInt32BE(Math.floor(counter/0x100000000),0);msg.writeUInt32BE(counter>>>0,4);
  const h=createHmac('sha1',key).update(msg).digest(),o=h[h.length-1]&15,n=((h[o]&0x7f)<<24)|(h[o+1]<<16)|(h[o+2]<<8)|h[o+3];
  return String(n%10**TOTP_DIGITS).padStart(TOTP_DIGITS,'0');
}
export const stepOf=(atMs:number)=>Math.floor(atMs/TOTP_STEP_MS);
export function totpCodeFor(secretBase32:string,atMs=Date.now()){return hotp(secretBase32,stepOf(atMs));}
/** The step the code belongs to (within ±TOTP_WINDOW of now), or null. Constant-time compare. */
export function verifyTotpCode(secretBase32:string,code:string,atMs=Date.now()):number|null{
  const c=String(code||'').replace(/\s/g,'');if(!/^\d{6}$/.test(c))return null;
  const step=stepOf(atMs);
  for(let d=-TOTP_WINDOW;d<=TOTP_WINDOW;d++){const s=step+d;const expected=hotp(secretBase32,s);if(timingSafeEqual(Buffer.from(expected),Buffer.from(c)))return s;}
  return null;
}
export function generateTotpSecret(){return base32Encode(randomBytes(20));}
export function otpauthUrl(secret:string,label:string){return 'otpauth://totp/'+encodeURIComponent(ISSUER)+':'+encodeURIComponent(label)+'?secret='+secret+'&issuer='+encodeURIComponent(ISSUER)+'&algorithm=SHA1&digits='+TOTP_DIGITS+'&period=30';}
function newBackupCode(){const a=base32Encode(randomBytes(10)).slice(0,10).toLowerCase();return a.slice(0,5)+'-'+a.slice(5);}
const normalizeBackup=(s:string)=>s.toLowerCase().replace(/[^a-z2-7]/g,'');
// ─── Setup ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Start (or restart an unconfirmed) setup: a new secret is stored encrypted with enabledAt = null. An enabled 2FA is reset only by an ADMIN. */
export async function beginTotpSetup(db:PrismaClient,userId:string,o:{label:string}){
  const u=await db.user.findUniqueOrThrow({where:{id:userId},select:{totpEnabledAt:true,disabledAt:true}});
  if(u.disabledAt)throw new ProxyDomainError('FORBIDDEN','Tài khoản đã bị vô hiệu hoá');
  if(u.totpEnabledAt)throw new ProxyDomainError('FORBIDDEN','2FA đã bật. Muốn cài lại, nhờ ADMIN đặt lại 2FA');
  const secret=generateTotpSecret(),url=otpauthUrl(secret,o.label);
  await db.user.update({where:{id:userId},data:{totpSecretCipher:encrypt(secret)}});
  return {secret,otpauthUrl:url,qrDataUrl:await toDataURL(url,{errorCorrectionLevel:'M',margin:1,width:220})};
}
/** Confirm with a code of the pending secret: 2FA on, version +1, PIN retired, backup codes issued once, this session unlocked. */
export async function confirmTotpSetup(db:PrismaClient,userId:string,code:string,sid:string|null,atMs=Date.now()){
  const u=await db.user.findUniqueOrThrow({where:{id:userId},select:{totpSecretCipher:true,totpEnabledAt:true,disabledAt:true}});
  if(u.disabledAt)throw new ProxyDomainError('FORBIDDEN','Tài khoản đã bị vô hiệu hoá');
  if(u.totpEnabledAt)throw new ProxyDomainError('STALE_PREVIEW','2FA đã được bật');
  if(!u.totpSecretCipher)throw new ProxyDomainError('STALE_PREVIEW','Chưa bắt đầu cài 2FA; bấm Bắt đầu để lấy mã QR');
  const step=verifyTotpCode(decrypt(u.totpSecretCipher),code,atMs);
  if(step===null)throw new ProxyDomainError('FORBIDDEN','Mã chưa đúng. Kiểm tra giờ điện thoại rồi nhập mã mới');
  const codes=Array.from({length:BACKUP_COUNT},newBackupCode),hashes=await Promise.all(codes.map(c=>bcrypt.hash(normalizeBackup(c),8)));
  const version=await db.$transaction(async tx=>{
    const [row]=await tx.$queryRaw<{totpEnabledAt:Date|null;totpSecretCipher:string|null}[]>`SELECT "totpEnabledAt","totpSecretCipher" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
    if(!row||row.totpEnabledAt||row.totpSecretCipher!==u.totpSecretCipher)throw new ProxyDomainError('STALE_PREVIEW','Cài 2FA vừa thay đổi ở nơi khác; bắt đầu lại');
    const now=new Date(atMs),v=await tx.user.update({where:{id:userId},data:{totpEnabledAt:now,totpLastStep:step,totpFailedCount:0,totpLockedAt:null,totpVersion:{increment:1},pin:null,pinVersion:{increment:1},pinFailedCount:0,pinLockedAt:null},select:{totpVersion:true}});
    await tx.userBackupCode.deleteMany({where:{userId}});
    await tx.userBackupCode.createMany({data:hashes.map(codeHash=>({userId,codeHash}))});
    if(sid)await tx.userSession.updateMany({where:{id:sid,userId,revokedAt:null},data:{totpUnlockedAt:now,totpVersion:v.totpVersion}});
    return v.totpVersion;
  });
  return {backupCodes:codes,totpVersion:version};
}
// ─── Check ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type TotpCheck={result:'OK'|'INVALID'|'LOCKED'|'LOCKED_NOW'|'NOT_SET';totpVersion:number|null;via:'TOTP'|'BACKUP'|null};
/** One rule for sign-in, unlock and approvals: decided on the user row under FOR UPDATE (step replay, lock, counter). */
export async function checkTotp(db:PrismaClient,userId:string,code:string,atMs=Date.now()):Promise<TotpCheck>{
  const pre=await db.user.findUnique({where:{id:userId},select:{totpSecretCipher:true,totpEnabledAt:true,totpLockedAt:true,totpVersion:true}});
  if(!pre?.totpEnabledAt||!pre.totpSecretCipher)return {result:'NOT_SET',totpVersion:pre?.totpVersion??null,via:null};
  if(pre.totpLockedAt&&pre.totpLockedAt.getTime()+TOTP_LOCK_MS>atMs)return {result:'LOCKED',totpVersion:pre.totpVersion,via:null};
  const secret=decrypt(pre.totpSecretCipher),step=verifyTotpCode(secret,code,atMs);
  // Backup codes are compared outside the lock (bcrypt is slow); the winning id is then consumed under the lock.
  let backupId:string|null=null;
  if(step===null&&/^[a-z2-7]{5}-?[a-z2-7]{5}$/i.test(String(code||'').trim())){
    const n=normalizeBackup(code),rows=await db.userBackupCode.findMany({where:{userId,usedAt:null},select:{id:true,codeHash:true}});
    for(const r of rows)if(await bcrypt.compare(n,r.codeHash)){backupId=r.id;break;}
  }
  return db.$transaction(async tx=>{
    const [row]=await tx.$queryRaw<{totpSecretCipher:string|null;totpEnabledAt:Date|null;totpLastStep:number|null;totpFailedCount:number;totpLockedAt:Date|null;totpVersion:number}[]>`SELECT "totpSecretCipher","totpEnabledAt","totpLastStep","totpFailedCount","totpLockedAt","totpVersion" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
    if(!row?.totpEnabledAt||row.totpSecretCipher!==pre.totpSecretCipher)return {result:'NOT_SET',totpVersion:row?.totpVersion??null,via:null};
    const lockedAt=row.totpLockedAt?new Date(row.totpLockedAt):null;
    if(lockedAt&&lockedAt.getTime()+TOTP_LOCK_MS>atMs)return {result:'LOCKED',totpVersion:row.totpVersion,via:null};
    const failed=lockedAt?0:row.totpFailedCount;
    const ok=step!==null?(row.totpLastStep===null||step>row.totpLastStep):false;
    if(ok){await tx.user.update({where:{id:userId},data:{totpLastStep:step,totpFailedCount:0,totpLockedAt:null}});return {result:'OK',totpVersion:row.totpVersion,via:'TOTP'};}
    if(backupId){const used=await tx.userBackupCode.updateMany({where:{id:backupId,usedAt:null},data:{usedAt:new Date(atMs)}});if(used.count===1){await tx.user.update({where:{id:userId},data:{totpFailedCount:0,totpLockedAt:null}});return {result:'OK',totpVersion:row.totpVersion,via:'BACKUP'};}}
    const next=failed+1;await tx.user.update({where:{id:userId},data:{totpFailedCount:next,totpLockedAt:next>=3?new Date(atMs):null}});
    return {result:next>=3?'LOCKED_NOW':'INVALID',totpVersion:row.totpVersion,via:null};
  });
}
export function totpMessage(r:TotpCheck['result'],lockedAt?:Date|null){
  if(r==='LOCKED_NOW')return 'Sai mã 3 lần; khoá 30 phút. Liên hệ ADMIN để mở khoá sớm';
  if(r==='LOCKED'){const mins=lockedAt?Math.max(1,Math.ceil((lockedAt.getTime()+TOTP_LOCK_MS-Date.now())/60000)):30;return 'Mã 2FA đang bị khoá, còn '+mins+' phút. Liên hệ ADMIN để mở khoá sớm';}
  if(r==='NOT_SET')return 'Tài khoản chưa bật 2FA';
  return 'Mã chưa đúng';
}
/** Unlock this session with the TOTP version just proved; refused when 2FA was reset meanwhile, the user is disabled or locked. */
export async function unlockWebSessionTotp(db:PrismaClient,sid:string,userId:string,verifiedVersion:number|null,atLogin=false){
  if(verifiedVersion==null)return false;
  return db.$transaction(async tx=>{
    const [u]=await tx.$queryRaw<{totpEnabledAt:Date|null;totpVersion:number;disabledAt:Date|null;totpLockedAt:Date|null;authEpoch:number}[]>`SELECT "totpEnabledAt","totpVersion","disabledAt","totpLockedAt","authEpoch" FROM "User" WHERE "id"=${userId} FOR SHARE`;
    if(!u?.totpEnabledAt||u.disabledAt||u.totpVersion!==verifiedVersion)return false;
    if(u.totpLockedAt&&new Date(u.totpLockedAt).getTime()+TOTP_LOCK_MS>Date.now())return false;
    const n=await tx.userSession.updateMany({where:{id:sid,userId,revokedAt:null,epoch:u.authEpoch},data:{totpUnlockedAt:new Date(),totpVersion:verifiedVersion,...(atLogin?{totpAtLogin:true}:{})}});
    return n.count===1;
  });
}
// ─── Status / admin ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function securityStatus(db:PrismaClient,userId:string,sid:string|null){
  const u=await db.user.findUniqueOrThrow({where:{id:userId},select:{pin:true,pinVersion:true,totpEnabledAt:true,totpRequiredAt:true,totpVersion:true,totpSecretCipher:true}});
  const s=sid?await db.userSession.findUnique({where:{id:sid},select:{userId:true,revokedAt:true,pinUnlockedAt:true,pinVersion:true,totpUnlockedAt:true,totpVersion:true}}):null;
  const open=s&&s.userId===userId&&!s.revokedAt;
  const totpEnabled=!!u.totpEnabledAt;
  const unlocked=!open?false:totpEnabled?!!s.totpUnlockedAt&&s.totpVersion===u.totpVersion:!!u.pin&&!!s.pinUnlockedAt&&s.pinVersion===u.pinVersion;
  const backupLeft=totpEnabled?await db.userBackupCode.count({where:{userId,usedAt:null}}):0;
  return {totpEnabled,totpRequired:!!u.totpRequiredAt,setupStarted:!totpEnabled&&!!u.totpSecretCipher,hasPin:!!u.pin,unlocked,backupCodesLeft:backupLeft};
}
/** An ADMIN of the project resets a user's 2FA (lost phone): secret and backup codes gone, version +1 (every unlock ends); setup required at the next visit. */
export async function adminResetTotp(db:PrismaClient,actorId:string,userId:string,projectId:string){
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
    const u=await tx.user.update({where:{id:userId},data:{totpSecretCipher:null,totpEnabledAt:null,totpLastStep:null,totpFailedCount:0,totpLockedAt:null,totpVersion:{increment:1},totpRequiredAt:new Date()},select:{totpVersion:true}});
    await tx.userBackupCode.deleteMany({where:{userId}});
    await tx.userSession.updateMany({where:{userId,revokedAt:null},data:{totpUnlockedAt:null}});
    await tx.auditLog.create({data:{projectId,userId:actorId,action:'TOTP_RESET',entity:'User',entityId:userId,changes:{totpVersion:u.totpVersion}}});
    return {totpVersion:u.totpVersion};
  });
}
/** Require (or stop requiring) 2FA for a user: the web forces the setup popup while required and not enabled. */
export async function adminRequireTotp(db:PrismaClient,actorId:string,userId:string,projectId:string,required:boolean){
  await db.user.update({where:{id:userId},data:{totpRequiredAt:required?new Date():null}});
  await db.auditLog.create({data:{projectId,userId:actorId,action:required?'TOTP_REQUIRE':'TOTP_UNREQUIRE',entity:'User',entityId:userId,changes:{}}});
  return {required};
}
/** Early unlock of the 2FA lock by an ADMIN (same idea as the PIN unlock). */
export async function adminUnlockTotp(db:Db,userId:string){await db.user.update({where:{id:userId},data:{totpFailedCount:0,totpLockedAt:null}});}
