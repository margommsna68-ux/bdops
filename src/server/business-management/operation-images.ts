import {Prisma,type PrismaClient} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
import type {BusinessResource,BusinessRow,BusinessImage} from './types';
import {assertPeriodOpen,assertCollectorSourceOpen} from './period-lock';
import {dayText} from './money';
const fields:Record<BusinessResource,string[]>={
 GMAIL:['email','password','twoFaCurrent','twoFaOld','recoveryEmail','token','status','notes','paypalId','businessManaged','archivedAt','revision','loginType','batchId'],
 PAYPAL:['code','primaryEmail','holder','status','notes','businessManaged','archivedAt','revision','batchId','firstEarnAppId'],
 PAYPAL_EMAIL:['email','password','twoFa','hotmailToken','isPrimary','notes','paypalId','businessManaged','archivedAt','revision','usedEarnAppId','usedAt','reviewHold','reviewNote'],
 VM_BINDING:['gmailId','revision'],
 VM_SDK:['sdkId','sdkRecordedAt','sdkRecordedById','revision'],
 WORK:['title','notes','status','serverId','vmId','assigneeId','createdById','completedById','completedAt','dueDate','archivedAt','revision','kind'],
 COST:['date','category','amount','total','isPrepaid','note','serverId','proxyAccountId','currency','businessManaged','voidedAt','revision','usdtRate','usdtAmount','fxAppliedAt','fxSource','fxNote','profitTreatment','sourceReceiptId','sourceCollectorExpenseId'],
 TEAM_RECEIPT:['receivedAt','amountUsdt','referenceId','referenceKey','status','collectorId','sourceCollectorExpenseId','collectorUsdAmount','createdById','notes','revision','voidedAt'],
 COLLECTOR_EXPENSE:['date','type','amount','referenceId','note','collectorId','businessManaged','revision','voidedAt'],
 FUND:['date','amount','transactionId','confirmed','failed','company','notes','paypalId','paypalEmailId','serverId','vmId','createdById','currency','businessManaged','voidedAt','revision','entryKind','earnAppId','distinctConfirmed','noTxId'],
 WITHDRAWAL:['date','amount','paypalFee','type','sourcePaypalId','destPaypalId','transactionId','paidToTeam','paidAt','notes','currency','businessManaged','voidedAt','revision','ledgerVersion','feeAmount','receivedAmount','receivedCurrency','fxRate','receiverFeeAmount','noTxId'],
 PROFIT:['periodStart','periodEnd','totalWithdrawal','totalCost','netProfit','netProfitUsdt','settled','notes','currency','basis','sourceHash','sourceSnapshotCipher','businessManaged','voidedAt','revision'],
 SPLIT_PAYMENT:['splitId','partnerName','percentage','amount','amountUsdt','paid','note','revision'],
 PACKAGE:['code','nextDueDate','lastPaidAt','revision'],
 EARNAPP:['loginId','vmId','paypalId','paypalEmailId','registeredAt','registeredById','revision'],
 PAYOUT:['earnAppId','paypalId','paypalEmailId','vmId','startedAt','endedAt'],
 ACCOUNT_BATCH:['kind','loginType','code','source','purchasedAt','priceMode','unitPrice','totalPaid','currency','lineCount','paidQuantity','costRecordId','notes','archivedAt','revision'],
};
export const isBusinessResource=(type:string):type is BusinessResource=>type in fields;
function capture(type:BusinessResource,row:object):BusinessRow{const data=row as Record<string,unknown>,image:BusinessRow={};for(const key of fields[type]){const value=data[key];image[key]=value instanceof Date?value.toISOString():value instanceof Prisma.Decimal?value.toString():value as BusinessRow[string];}return image;}
export async function readBusinessImage(db:PrismaClient|Prisma.TransactionClient,projectId:string,type:BusinessResource,id:string){
 let row:object|null=null;
 if(type==='GMAIL')row=await db.gmailAccount.findFirst({where:{id,projectId}});
 if(type==='PAYPAL')row=await db.payPalAccount.findFirst({where:{id,projectId}});
 if(type==='PAYPAL_EMAIL')row=await db.payPalEmail.findFirst({where:{id,projectId}});
 if(type==='VM_BINDING'||type==='VM_SDK')row=await db.virtualMachine.findFirst({where:{id,managed:true,server:{projectId,managed:true}}});
 if(type==='WORK')row=await db.businessWorkItem.findFirst({where:{id,projectId}});
 if(type==='COST')row=await db.costRecord.findFirst({where:{id,projectId}});
 if(type==='TEAM_RECEIPT')row=await db.teamReceipt.findFirst({where:{id,projectId}});
 if(type==='COLLECTOR_EXPENSE')row=await db.collectorExpense.findFirst({where:{id,projectId}});
 if(type==='FUND')row=await db.fundTransaction.findFirst({where:{id,projectId}});
 if(type==='WITHDRAWAL')row=await db.withdrawal.findFirst({where:{id,projectId}});
 if(type==='PROFIT')row=await db.profitSplit.findFirst({where:{id,projectId}});
 if(type==='SPLIT_PAYMENT')row=await db.splitAllocation.findFirst({where:{id,split:{projectId}}});
 if(type==='PACKAGE')row=await db.proxyProviderAccount.findFirst({where:{id,projectId}});
 if(type==='EARNAPP')row=await db.earnAppAccount.findFirst({where:{id,projectId}});
 if(type==='ACCOUNT_BATCH')row=await db.accountPurchaseBatch.findFirst({where:{id,projectId}});
 if(type==='PAYOUT')row=await db.earnAppPayout.findFirst({where:{id,projectId}});
 return row?capture(type,row):null;
}
export async function restoreBusinessImage(tx:Prisma.TransactionClient,projectId:string,image:BusinessImage,actorId?:string){
 if(['COST','TEAM_RECEIPT'].includes(image.resource))for(const state of [image.after,image.before])if(typeof state?.sourceCollectorExpenseId==='string')await assertCollectorSourceOpen(tx,projectId,state.sourceCollectorExpenseId);
 if(image.resource==='TEAM_RECEIPT'&&(!image.before||image.before.status!=='CONFIRMED'||image.before.voidedAt)&&await tx.costRecord.findFirst({where:{sourceReceiptId:image.id,voidedAt:null}}))throw new ProxyDomainError('INVALID_INPUT','Thu hồi chi phí đối soát liên kết trước');
 if(['COST','FUND','WITHDRAWAL'].includes(image.resource))for(const state of [image.after,image.before])if(state?.date)await assertPeriodOpen(tx,projectId,new Date(String(state.date)),String(state.currency));
 if(['TEAM_RECEIPT','COLLECTOR_EXPENSE'].includes(image.resource))for(const state of [image.after,image.before]){const date=state?.receivedAt||state?.date;if(date)await assertPeriodOpen(tx,projectId,new Date(String(date)),'USDT');}
 if(image.resource==='PROFIT'&&image.after.settled)throw new ProxyDomainError('INVALID_INPUT','Kỳ đã chốt; không hoàn tác thông thường');
 // An email given to its first EarnApp returns to unused only while nothing depends on that use (no payment recorded on it).
 if(image.resource==='PAYPAL_EMAIL'&&image.after.usedEarnAppId&&!image.before?.usedEarnAppId&&await tx.fundTransaction.findFirst({where:{paypalEmailId:image.id,voidedAt:null},select:{id:true}}))throw new ProxyDomainError('INVALID_INPUT','Email đã có tiền nhận; giữ bằng chứng sử dụng, không hoàn tác lần gán đầu');
 if(image.resource==='SPLIT_PAYMENT'&&(image.after.paid||image.before?.paid))throw new ProxyDomainError('INVALID_INPUT','Ghi nhận đã trả tiền cần nghiệp vụ điều chỉnh riêng');
 const before=image.before,data:Record<string,unknown>={};
 if(before){for(const [key,value] of Object.entries(before)){if(key==='revision')continue;data[key]=value&&['date','receivedAt','fxAppliedAt','paidAt','periodStart','periodEnd','completedAt','dueDate','archivedAt','voidedAt','nextDueDate','lastPaidAt','registeredAt','purchasedAt','usedAt','startedAt','endedAt'].includes(key)?new Date(String(value)):value;}}
 else if(['GMAIL','PAYPAL','PAYPAL_EMAIL','WORK','ACCOUNT_BATCH'].includes(image.resource))data.archivedAt=new Date();
 else if(image.resource==='EARNAPP'){await tx.earnAppPayout.deleteMany({where:{earnAppId:image.id}});await tx.earnAppAccount.delete({where:{id:image.id}});return;} // created by the undone operation
 else if(image.resource==='PAYOUT'){await tx.earnAppPayout.deleteMany({where:{id:image.id}});return;} // history period opened by the undone operation
 else if(['COST','FUND','WITHDRAWAL','PROFIT','TEAM_RECEIPT','COLLECTOR_EXPENSE'].includes(image.resource))data.voidedAt=new Date();
 else throw new ProxyDomainError('INVALID_INPUT');
 if(image.resource!=='PAYOUT')data.revision={increment:1};
 if(image.resource==='COLLECTOR_EXPENSE')data.businessManaged=true;
 // The shape is built from the fixed field allowlist above, never from client data.
 if(image.resource==='GMAIL')await tx.gmailAccount.update({where:{id:image.id},data:data as Prisma.GmailAccountUpdateInput});
 if(image.resource==='PAYPAL')await tx.payPalAccount.update({where:{id:image.id},data:data as Prisma.PayPalAccountUncheckedUpdateInput});
 if(image.resource==='PAYPAL_EMAIL')await tx.payPalEmail.update({where:{id:image.id},data:data as Prisma.PayPalEmailUncheckedUpdateInput});
 if(image.resource==='VM_BINDING')await tx.virtualMachine.update({where:{id:image.id},data:data as Prisma.VirtualMachineUncheckedUpdateInput});
 if(image.resource==='VM_SDK'){
  const before=image.before;if(!before)throw new ProxyDomainError('INVALID_INPUT');
  if(before.sdkId&&await tx.virtualMachine.findFirst({where:{sdkId:String(before.sdkId),managed:true,archivedAt:null,id:{not:image.id}},select:{id:true}}))throw new ProxyDomainError('STALE_PREVIEW','SDK cũ đã được ghi cho VM khác; không thể hoàn tác');
  await tx.virtualMachine.update({where:{id:image.id},data:{sdkId:before.sdkId as string|null,sdkRecordedAt:before.sdkRecordedAt?new Date(String(before.sdkRecordedAt)):null,sdkRecordedById:before.sdkRecordedById as string|null,revision:{increment:1}}});
  await tx.vMSdkHistory.create({data:{projectId,vmId:image.id,previousSdk:image.after.sdkId as string|null,newSdk:before.sdkId as string|null,actorId:actorId||String(image.after.sdkRecordedById||''),note:'Hoàn tác'}});
 }
 if(image.resource==='WORK')await tx.businessWorkItem.update({where:{id:image.id},data:data as Prisma.BusinessWorkItemUncheckedUpdateInput});
 if(image.resource==='COST')await tx.costRecord.update({where:{id:image.id},data:data as Prisma.CostRecordUncheckedUpdateInput});
 if(image.resource==='EARNAPP')await tx.earnAppAccount.update({where:{id:image.id},data:data as Prisma.EarnAppAccountUncheckedUpdateInput});
 if(image.resource==='PAYOUT')await tx.earnAppPayout.update({where:{id:image.id},data:data as Prisma.EarnAppPayoutUncheckedUpdateInput});
 if(image.resource==='ACCOUNT_BATCH')await tx.accountPurchaseBatch.update({where:{id:image.id},data:data as Prisma.AccountPurchaseBatchUncheckedUpdateInput});
 if(image.resource==='PACKAGE')await tx.proxyProviderAccount.update({where:{id:image.id},data:data as Prisma.ProxyProviderAccountUncheckedUpdateInput});
 if(image.resource==='TEAM_RECEIPT')await tx.teamReceipt.update({where:{id:image.id},data:data as Prisma.TeamReceiptUncheckedUpdateInput});
 if(image.resource==='COLLECTOR_EXPENSE')await tx.collectorExpense.update({where:{id:image.id},data:data as Prisma.CollectorExpenseUncheckedUpdateInput});
 if(image.resource==='FUND')await tx.fundTransaction.update({where:{id:image.id},data:data as Prisma.FundTransactionUncheckedUpdateInput});
 if(image.resource==='WITHDRAWAL')await tx.withdrawal.update({where:{id:image.id},data:data as Prisma.WithdrawalUncheckedUpdateInput});
 if(image.resource==='PROFIT')await tx.profitSplit.update({where:{id:image.id},data:data as Prisma.ProfitSplitUncheckedUpdateInput});
 if(image.resource==='SPLIT_PAYMENT')await tx.splitAllocation.update({where:{id:image.id},data:data as Prisma.SplitAllocationUncheckedUpdateInput});
}
export function describeBusinessImage(image:BusinessImage){
 const s=image.after,b=image.before,label=String(s.email||s.code||s.title||s.transactionId||s.partnerName||(image.resource==='COST'?s.category+' · '+dayText(new Date(String(s.date))):image.resource==='PROFIT'?dayText(new Date(String(s.periodStart)))+' → '+dayText(new Date(String(s.periodEnd))):image.id));
 const format=(row:BusinessRow|null)=>{
  if(!row)return 'Chưa có';if(row.voidedAt||row.archivedAt)return 'Đã thu hồi / ẩn';
  if(image.resource==='TEAM_RECEIPT')return `${row.amountUsdt??'Chưa xác minh'} USDT · ${row.status}`;
  if(image.resource==='COST'&&row.usdtAmount)return `${row.amount} ${row.currency} → ${row.usdtAmount} USDT · 1 USDT = ${row.usdtRate} ${row.currency}`;
  if(image.resource==='VM_BINDING')return 'VM';
  if(image.resource==='EARNAPP')return (row.vmId?'Đang trên VM':'Chưa gán VM')+' · '+(row.paypalId?'có PayPal':'chưa có PayPal')+(row.registeredAt?' · đã ghi đăng ký':'');
  if(image.resource==='ACCOUNT_BATCH')return 'Lô '+row.code+(row.costRecordId?' · đã ghi chi phí':' · chưa ghi chi phí');
  if(image.resource==='VM_SDK')return row.sdkId?String(row.sdkId):'Chưa có SDK';
  if(image.resource==='PROFIT')return `Lợi nhuận ${row.netProfit} ${row.currency} · ${row.settled?'Đã chốt':'Bản tính'}`;
  if(row.amount){const status=image.resource==='FUND'?row.failed?'Không về':row.confirmed?'Đã nhận':'Chờ nhận':image.resource==='WITHDRAWAL'?row.type==='MIXING'?'Chuyển nội bộ':row.paidToTeam?'Đã về':'Chờ về':image.resource==='SPLIT_PAYMENT'?row.paid?'Đã ghi trả':'Chưa ghi trả':'Chi phí';return `${row.amount} ${row.currency||''} · ${status}`;}
  if(image.resource==='PACKAGE')return 'Đến hạn '+(row.nextDueDate?dayText(new Date(String(row.nextDueDate))):'chưa đặt');
  return [row.status,row.notes].filter(Boolean).join(' · ')||'Đã lưu';
 };
 const secrets=['password','twoFaCurrent','twoFa','token','hotmailToken'],secretChanged=b&&secrets.some(k=>s[k]!==b[k]);
 return {resource:{GMAIL:'Gmail',PAYPAL:'PayPal',PAYPAL_EMAIL:'Email PayPal',VM_BINDING:'Tài khoản VM',VM_SDK:'SDK EarnApp',WORK:'Công việc',COST:'Chi phí',FUND:'Tiền nhận',WITHDRAWAL:'Tiền rút / chuyển',PROFIT:'Kỳ lợi nhuận',SPLIT_PAYMENT:'Ghi trả lợi nhuận',TEAM_RECEIPT:'Nhận về team',COLLECTOR_EXPENSE:'Đối soát collector',PACKAGE:'Gói proxy',PAYOUT:'Email nhận của EarnApp',EARNAPP:'Tài khoản EarnApp',ACCOUNT_BATCH:'Lô nhập tài khoản'}[image.resource],label,before:format(b),after:format(s)+(secretChanged?' · Đã cập nhật thông tin đăng nhập':''),onUndo:b?'Khôi phục ghi nhận trước nếu chưa được sửa tiếp':'Ẩn / thu hồi bản ghi; giữ lịch sử'};
}
