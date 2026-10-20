import type {Prisma,PrismaClient} from '@prisma/client';
import bcrypt from 'bcryptjs';
import {ProxyDomainError} from '../proxy-management/types';
export const PIN_LOCK_MS=30*60000;
// One PIN rule for the web and the ops API (21/10/2026): 3 wrong PINs lock the user for 30 minutes, whatever channel was used.
// LOCKED_NOW = this wrong PIN was the third one; LOCKED = already locked (the PIN was not even compared).
export type PinCheck='OK'|'INVALID'|'LOCKED_NOW'|'LOCKED'|'NOT_SET';
export async function checkPin(db:PrismaClient|Prisma.TransactionClient,userId:string,pin:string):Promise<PinCheck>{
 const user=await db.user.findUnique({where:{id:userId},select:{pin:true,pinFailedCount:true,pinLockedAt:true}});if(!user?.pin)return 'NOT_SET';
 if(user.pinLockedAt&&user.pinLockedAt.getTime()+PIN_LOCK_MS>Date.now())return 'LOCKED';
 if(user.pinLockedAt)await db.user.update({where:{id:userId},data:{pinLockedAt:null,pinFailedCount:0}});
 const valid=await bcrypt.compare(pin,user.pin);
 if(!valid){const row=await db.user.update({where:{id:userId},data:{pinFailedCount:{increment:1}},select:{pinFailedCount:true}});if(row.pinFailedCount>=3){await db.user.update({where:{id:userId},data:{pinLockedAt:new Date()}});return 'LOCKED_NOW';}return 'INVALID';}
 await db.user.update({where:{id:userId},data:{pinFailedCount:0}});return 'OK';
}
export async function verifyBusinessPin(db:PrismaClient,userId:string,pin:string){
 const r=await checkPin(db,userId,pin);
 if(r==='NOT_SET')throw new ProxyDomainError('FORBIDDEN','Cần đặt PIN trước khi copy thông tin đăng nhập');
 if(r==='LOCKED')throw new ProxyDomainError('FORBIDDEN','PIN đang bị khóa. Liên hệ quản lý hoặc chờ hết 30 phút.');
 if(r==='LOCKED_NOW')throw new ProxyDomainError('FORBIDDEN','Sai PIN 3 lần; khóa 30 phút');
 if(r==='INVALID')throw new ProxyDomainError('FORBIDDEN','PIN chưa đúng');
}
