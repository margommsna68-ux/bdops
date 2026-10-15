import type {Prisma,PrismaClient} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
export async function assertPeriodOpen(db:Prisma.TransactionClient|PrismaClient,projectId:string,date:Date,currency:string){
  if(await db.profitSplit.findFirst({where:{projectId,businessManaged:true,settled:true,voidedAt:null,OR:[{currency},{basis:'TEAM_RECEIVED',currency:'USDT'}],periodStart:{lte:date},periodEnd:{gte:date}},select:{id:true}}))throw new ProxyDomainError('INVALID_INPUT','Kỳ lợi nhuận đã chốt. Cần mở lại ghi nhận trước khi sửa thu/chi.');
}
