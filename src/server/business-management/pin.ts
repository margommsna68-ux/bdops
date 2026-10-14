import type {PrismaClient} from '@prisma/client';
import bcrypt from 'bcryptjs';
import {ProxyDomainError} from '../proxy-management/types';
export async function verifyBusinessPin(db:PrismaClient,userId:string,pin:string){
 const user=await db.user.findUnique({where:{id:userId},select:{pin:true,pinFailedCount:true,pinLockedAt:true}});if(!user?.pin)throw new ProxyDomainError('FORBIDDEN','Cần đặt PIN trước khi copy thông tin đăng nhập');
 if(user.pinLockedAt&&user.pinLockedAt.getTime()+30*60000>Date.now())throw new ProxyDomainError('FORBIDDEN','PIN đang bị khóa. Liên hệ quản lý hoặc chờ hết 30 phút.');
 if(user.pinLockedAt)await db.user.update({where:{id:userId},data:{pinLockedAt:null,pinFailedCount:0}});
 const valid=await bcrypt.compare(pin,user.pin);
 if(!valid){const row=await db.user.update({where:{id:userId},data:{pinFailedCount:{increment:1}},select:{pinFailedCount:true}});if(row.pinFailedCount>=3)await db.user.update({where:{id:userId},data:{pinLockedAt:new Date()}});throw new ProxyDomainError('FORBIDDEN',row.pinFailedCount>=3?'Sai PIN 3 lần; khóa 30 phút':'PIN chưa đúng');}
 await db.user.update({where:{id:userId},data:{pinFailedCount:0}});
}
