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
export async function checkPin(db:Db,userId:string,pin:string):Promise<PinCheck>{
 for(let attempt=0;attempt<3;attempt++){
  const user=await db.user.findUnique({where:{id:userId},select:{pin:true,pinLockedAt:true}});if(!user?.pin)return 'NOT_SET';
  if(user.pinLockedAt&&user.pinLockedAt.getTime()+PIN_LOCK_MS>Date.now())return 'LOCKED';
  const compared=user.pin,valid=await bcrypt.compare(pin,compared);
  const apply=async(tx:Prisma.TransactionClient):Promise<PinCheck|'AGAIN'>=>{
   const [row]=await tx.$queryRaw<{pin:string|null;pinFailedCount:number;pinLockedAt:Date|null}[]>`SELECT "pin","pinFailedCount","pinLockedAt" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
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
  if(r!=='AGAIN')return r;
 }
 return 'INVALID';
}
export async function verifyBusinessPin(db:PrismaClient,userId:string,pin:string){
 const r=await checkPin(db,userId,pin);
 if(r==='NOT_SET')throw new ProxyDomainError('FORBIDDEN','Cần đặt PIN trước khi copy thông tin đăng nhập');
 if(r==='LOCKED')throw new ProxyDomainError('FORBIDDEN','PIN đang bị khóa. Liên hệ quản lý hoặc chờ hết 30 phút.');
 if(r==='LOCKED_NOW')throw new ProxyDomainError('FORBIDDEN','Sai PIN 3 lần; khóa 30 phút');
 if(r==='INVALID')throw new ProxyDomainError('FORBIDDEN','PIN chưa đúng');
}
