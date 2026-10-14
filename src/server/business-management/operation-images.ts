import {Prisma,type PrismaClient} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
import type {BusinessResource,BusinessRow,BusinessImage} from './types';
import {assertPeriodOpen} from './period-lock';
const fields:Record<BusinessResource,string[]>={
 GMAIL:['email','password','twoFaCurrent','twoFaOld','recoveryEmail','token','status','notes','paypalId','businessManaged','archivedAt','revision'],
 PAYPAL:['code','primaryEmail','holder','status','notes','businessManaged','archivedAt','revision'],
 PAYPAL_EMAIL:['email','password','twoFa','hotmailToken','isPrimary','notes','paypalId','businessManaged','archivedAt','revision'],
 VM_BINDING:['gmailId','revision'],
 WORK:['title','notes','status','serverId','vmId','assigneeId','createdById','completedById','completedAt','dueDate','archivedAt','revision'],
 COST:['date','category','amount','total','isPrepaid','note','serverId','proxyAccountId','currency','businessManaged','voidedAt','revision'],
 FUND:['date','amount','transactionId','confirmed','failed','company','notes','paypalId','paypalEmailId','serverId','vmId','createdById','currency','businessManaged','voidedAt','revision'],
 WITHDRAWAL:['date','amount','paypalFee','type','sourcePaypalId','destPaypalId','transactionId','paidToTeam','paidAt','notes','currency','businessManaged','voidedAt','revision'],
 PROFIT:['periodStart','periodEnd','totalWithdrawal','totalCost','netProfit','settled','notes','currency','basis','sourceHash','sourceSnapshotCipher','businessManaged','voidedAt','revision'],
 SPLIT_PAYMENT:['splitId','partnerName','percentage','amount','paid','note','revision'],
};
export const isBusinessResource=(type:string):type is BusinessResource=>type in fields;
function capture(type:BusinessResource,row:object):BusinessRow{const data=row as Record<string,unknown>,image:BusinessRow={};for(const key of fields[type]){const value=data[key];image[key]=value instanceof Date?value.toISOString():value instanceof Prisma.Decimal?value.toString():value as BusinessRow[string];}return image;}
export async function readBusinessImage(db:PrismaClient|Prisma.TransactionClient,projectId:string,type:BusinessResource,id:string){
 let row:object|null=null;
 if(type==='GMAIL')row=await db.gmailAccount.findFirst({where:{id,projectId}});
 if(type==='PAYPAL')row=await db.payPalAccount.findFirst({where:{id,projectId}});
 if(type==='PAYPAL_EMAIL')row=await db.payPalEmail.findFirst({where:{id,projectId}});
 if(type==='VM_BINDING')row=await db.virtualMachine.findFirst({where:{id,managed:true,server:{projectId,managed:true}}});
 if(type==='WORK')row=await db.businessWorkItem.findFirst({where:{id,projectId}});
 if(type==='COST')row=await db.costRecord.findFirst({where:{id,projectId}});
 if(type==='FUND')row=await db.fundTransaction.findFirst({where:{id,projectId}});
 if(type==='WITHDRAWAL')row=await db.withdrawal.findFirst({where:{id,projectId}});
 if(type==='PROFIT')row=await db.profitSplit.findFirst({where:{id,projectId}});
 if(type==='SPLIT_PAYMENT')row=await db.splitAllocation.findFirst({where:{id,split:{projectId}}});
 return row?capture(type,row):null;
}
export async function restoreBusinessImage(tx:Prisma.TransactionClient,projectId:string,image:BusinessImage){
 if(['COST','FUND','WITHDRAWAL'].includes(image.resource))for(const state of [image.after,image.before])if(state?.date)await assertPeriodOpen(tx,projectId,new Date(String(state.date)),String(state.currency));
 if(image.resource==='PROFIT'&&image.after.settled)throw new ProxyDomainError('INVALID_INPUT','Kỳ đã chốt; không hoàn tác thông thường');
 if(image.resource==='SPLIT_PAYMENT'&&(image.after.paid||image.before?.paid))throw new ProxyDomainError('INVALID_INPUT','Ghi nhận đã trả tiền cần nghiệp vụ điều chỉnh riêng');
 const before=image.before,data:Record<string,unknown>={};
 if(before){for(const [key,value] of Object.entries(before)){if(key==='revision')continue;data[key]=value&&['date','paidAt','periodStart','periodEnd','completedAt','dueDate','archivedAt','voidedAt'].includes(key)?new Date(String(value)):value;}}
 else if(['GMAIL','PAYPAL','PAYPAL_EMAIL','WORK'].includes(image.resource))data.archivedAt=new Date();
 else if(['COST','FUND','WITHDRAWAL','PROFIT'].includes(image.resource))data.voidedAt=new Date();
 else throw new ProxyDomainError('INVALID_INPUT');
 data.revision={increment:1};
 // The shape is built from the fixed field allowlist above, never from client data.
 if(image.resource==='GMAIL')await tx.gmailAccount.update({where:{id:image.id},data:data as Prisma.GmailAccountUpdateInput});
 if(image.resource==='PAYPAL')await tx.payPalAccount.update({where:{id:image.id},data:data as Prisma.PayPalAccountUncheckedUpdateInput});
 if(image.resource==='PAYPAL_EMAIL')await tx.payPalEmail.update({where:{id:image.id},data:data as Prisma.PayPalEmailUncheckedUpdateInput});
 if(image.resource==='VM_BINDING')await tx.virtualMachine.update({where:{id:image.id},data:data as Prisma.VirtualMachineUncheckedUpdateInput});
 if(image.resource==='WORK')await tx.businessWorkItem.update({where:{id:image.id},data:data as Prisma.BusinessWorkItemUncheckedUpdateInput});
 if(image.resource==='COST')await tx.costRecord.update({where:{id:image.id},data:data as Prisma.CostRecordUncheckedUpdateInput});
 if(image.resource==='FUND')await tx.fundTransaction.update({where:{id:image.id},data:data as Prisma.FundTransactionUncheckedUpdateInput});
 if(image.resource==='WITHDRAWAL')await tx.withdrawal.update({where:{id:image.id},data:data as Prisma.WithdrawalUncheckedUpdateInput});
 if(image.resource==='PROFIT')await tx.profitSplit.update({where:{id:image.id},data:data as Prisma.ProfitSplitUncheckedUpdateInput});
 if(image.resource==='SPLIT_PAYMENT')await tx.splitAllocation.update({where:{id:image.id},data:data as Prisma.SplitAllocationUncheckedUpdateInput});
}
export function describeBusinessImage(image:BusinessImage){
 const s=image.after,b=image.before,label=String(s.email||s.code||s.title||s.transactionId||s.partnerName||(image.resource==='COST'?s.category+' · '+String(s.date).slice(0,10):image.resource==='PROFIT'?String(s.periodStart).slice(0,10)+' → '+String(s.periodEnd).slice(0,10):image.id));
 const format=(row:BusinessRow|null)=>{
  if(!row)return 'Chưa có';if(row.voidedAt||row.archivedAt)return 'Đã thu hồi / ẩn';
  if(image.resource==='VM_BINDING')return row.gmailId?'Đã ghi tài khoản':'Chưa gán tài khoản';
  if(image.resource==='PROFIT')return `Lợi nhuận ${row.netProfit} ${row.currency} · ${row.settled?'Đã chốt':'Bản tính'}`;
  if(row.amount){const status=image.resource==='FUND'?row.failed?'Không về':row.confirmed?'Đã nhận':'Chờ nhận':image.resource==='WITHDRAWAL'?row.type==='MIXING'?'Chuyển nội bộ':row.paidToTeam?'Đã về':'Chờ về':image.resource==='SPLIT_PAYMENT'?row.paid?'Đã ghi trả':'Chưa ghi trả':'Chi phí';return `${row.amount} ${row.currency||''} · ${status}`;}
  return [row.status,row.notes].filter(Boolean).join(' · ')||'Đã lưu';
 };
 const secrets=['password','twoFaCurrent','twoFa','token','hotmailToken'],secretChanged=b&&secrets.some(k=>s[k]!==b[k]);
 return {resource:{GMAIL:'Gmail',PAYPAL:'PayPal',PAYPAL_EMAIL:'Email PayPal',VM_BINDING:'Tài khoản VM',WORK:'Công việc',COST:'Chi phí',FUND:'Tiền nhận',WITHDRAWAL:'Tiền rút / chuyển',PROFIT:'Kỳ lợi nhuận',SPLIT_PAYMENT:'Ghi trả lợi nhuận'}[image.resource],label,before:format(b),after:format(s)+(secretChanged?' · Đã cập nhật thông tin đăng nhập':''),onUndo:b?'Khôi phục ghi nhận trước nếu chưa được sửa tiếp':'Ẩn / thu hồi bản ghi; giữ lịch sử'};
}
