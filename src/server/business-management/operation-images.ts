import {Prisma,type PrismaClient} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';
import type {BusinessResource,BusinessRow,BusinessImage} from './types';
import {assertPeriodOpen,assertCollectorSourceOpen} from './period-lock';
import {dayText} from './money';
import {formatSdkAmount,SDK_STATE_LABEL,type SdkLinkState} from '@/lib/sdk-money';
import {restoreSdkImage} from '../vm-management/sdk-undo';
import {assertPayoutDailySlot} from '../vm-ops/payout-daily';
const fields:Record<BusinessResource,string[]>={
 GMAIL:['email','password','twoFaCurrent','twoFaOld','recoveryEmail','token','status','notes','paypalId','businessManaged','archivedAt','revision','loginType','batchId','twoFaLink','smsLink','phone','loginIssueNote','loginIssueAt'],
 PAYPAL:['code','primaryEmail','holder','status','notes','businessManaged','archivedAt','revision','batchId','firstEarnAppId'],
 PAYPAL_EMAIL:['email','password','twoFa','hotmailToken','isPrimary','notes','paypalId','businessManaged','archivedAt','revision','usedEarnAppId','usedAt','reviewHold','reviewNote','holdEarnAppId','holdAt'],
 VM_BINDING:['gmailId','revision'],
 VM_SDK:['sdkId','sdkRecordedAt','sdkRecordedById','revision'],
 WORK:['title','notes','status','serverId','vmId','assigneeId','createdById','completedById','completedAt','dueDate','archivedAt','revision','kind'],
 COST:['date','category','amount','total','isPrepaid','note','serverId','proxyAccountId','currency','businessManaged','voidedAt','revision','usdtRate','usdtAmount','fxAppliedAt','fxSource','fxNote','profitTreatment','sourceReceiptId','sourceCollectorExpenseId'],
 TEAM_RECEIPT:['receivedAt','amountUsdt','referenceId','referenceKey','status','collectorId','sourceCollectorExpenseId','collectorUsdAmount','createdById','notes','revision','voidedAt'],
 COLLECTOR_EXPENSE:['date','type','amount','referenceId','note','collectorId','businessManaged','revision','voidedAt'],
 FUND:['date','amount','transactionId','confirmed','failed','company','notes','paypalId','paypalEmailId','serverId','vmId','createdById','currency','businessManaged','voidedAt','revision','entryKind','earnAppId','distinctConfirmed','noTxId','payoutRequestId'],
 WITHDRAWAL:['date','amount','paypalFee','type','sourcePaypalId','destPaypalId','transactionId','paidToTeam','paidAt','notes','currency','businessManaged','voidedAt','revision','ledgerVersion','feeAmount','receivedAmount','receivedCurrency','fxRate','receiverFeeAmount','noTxId'],
 PROFIT:['periodStart','periodEnd','totalWithdrawal','totalCost','netProfit','netProfitUsdt','settled','notes','currency','basis','sourceHash','sourceSnapshotCipher','businessManaged','voidedAt','revision'],
 SPLIT_PAYMENT:['splitId','partnerName','percentage','amount','amountUsdt','paid','note','revision'],
 PACKAGE:['code','nextDueDate','lastPaidAt','revision'],
 EARNAPP:['loginId','vmId','paypalId','paypalEmailId','registeredAt','registeredById','revision','closedAt','closedReason'],
 PAYOUT:['earnAppId','paypalId','paypalEmailId','vmId','startedAt','endedAt'],
 VM_OPS:['vmId','cycle','status','statusAt','statusById','blockedFrom','blockedFromKnown','blockedEndpointId','blockedCycle','blockedAt','revision'],
 PAYOUT_REQUEST:['earnAppId','vmId','cycle','paypalId','paypalEmailId','currency','amount','reference','requestedAt','state','stateNote','settledAt','settledById','settleNote','shortfall','consumedAt','revision','submission','submittedAt','lostAmount','lostAt'],
 VM_CYCLE:['vmId','number','reason','earnAppId','payoutRequestId','payoutMemberId','closedAt'],
 // Merged payout member (27/10/2026): another VM whose SDK was merged into the request's EarnApp account.
 PAYOUT_MEMBER:['requestId','vmId','cycle','sdkId','shareAmount','shareObservedAt','removedAt','removedById','consumedAt','consumedReason','revision'],
 SDK:['code','vmId','holderVmId','heldAt','heldById','amount','currency','amountAt','amountById','amountObservedAt','amountSource','amountFailedAt','amountVmId','amountCycle','amountFailedVmId','amountFailedCycle','note','noteAt','noteById','linkState','linkedEarnAppId','linkedVmId','linkedCycle','linkedAt','linkedById','confirmedAt','confirmedById','revision'],
 // The SDK position of a VM (its mirror): lets undo see a code placed on that VM later by someone else.
 SDK_SLOT:['sdkId'],
 ACCOUNT_BATCH:['kind','loginType','code','source','purchasedAt','priceMode','unitPrice','totalPaid','currency','lineCount','paidQuantity','costRecordId','notes','archivedAt','revision'],
};
export const isBusinessResource=(type:string):type is BusinessResource=>type in fields;
function capture(type:BusinessResource,row:object):BusinessRow{const data=row as Record<string,unknown>,image:BusinessRow={};for(const key of fields[type]){const value=data[key];image[key]=value instanceof Date?value.toISOString():value instanceof Prisma.Decimal?value.toString():value as BusinessRow[string];}return image;}
export async function readBusinessImage(db:PrismaClient|Prisma.TransactionClient,projectId:string,type:BusinessResource,id:string){
 let row:object|null=null;
 if(type==='GMAIL')row=await db.gmailAccount.findFirst({where:{id,projectId}});
 if(type==='PAYPAL')row=await db.payPalAccount.findFirst({where:{id,projectId}});
 if(type==='PAYPAL_EMAIL')row=await db.payPalEmail.findFirst({where:{id,projectId}});
 if(type==='VM_BINDING'||type==='VM_SDK'||type==='SDK_SLOT')row=await db.virtualMachine.findFirst({where:{id,managed:true,server:{projectId,managed:true}}});
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
 if(type==='VM_OPS')row=await db.vmOperation.findFirst({where:{id,projectId}});
 if(type==='PAYOUT_REQUEST')row=await db.earnPayoutRequest.findFirst({where:{id,projectId}});
 if(type==='VM_CYCLE')row=await db.vmCycle.findFirst({where:{id,projectId}});
 if(type==='PAYOUT_MEMBER')row=await db.earnPayoutMember.findFirst({where:{id,projectId}});
 if(type==='SDK')row=await db.sdkRecord.findFirst({where:{id,projectId}});
 return row?capture(type,row):null;
}
export async function restoreBusinessImage(tx:Prisma.TransactionClient,projectId:string,image:BusinessImage,actorId?:string){
 if(['COST','TEAM_RECEIPT'].includes(image.resource))for(const state of [image.after,image.before])if(typeof state?.sourceCollectorExpenseId==='string')await assertCollectorSourceOpen(tx,projectId,state.sourceCollectorExpenseId);
 if(image.resource==='TEAM_RECEIPT'&&(!image.before||image.before.status!=='CONFIRMED'||image.before.voidedAt)&&await tx.costRecord.findFirst({where:{sourceReceiptId:image.id,voidedAt:null}}))throw new ProxyDomainError('INVALID_INPUT','Thu hồi chi phí đối soát liên kết trước');
 if(['COST','FUND','WITHDRAWAL'].includes(image.resource))for(const state of [image.after,image.before])if(state?.date)await assertPeriodOpen(tx,projectId,new Date(String(state.date)),String(state.currency));
 if(['TEAM_RECEIPT','COLLECTOR_EXPENSE'].includes(image.resource))for(const state of [image.after,image.before]){const date=state?.receivedAt||state?.date;if(date)await assertPeriodOpen(tx,projectId,new Date(String(date)),'USDT');}
 if(image.resource==='PROFIT'&&image.after.settled)throw new ProxyDomainError('INVALID_INPUT','Kỳ đã chốt; không hoàn tác thông thường');
 // Removed by the undone operation (28/10/2026): a mistaken payout request comes back from its void snapshot; a receiving-email period
 // of a mistaken email is recreated from its image.
 if((image.after as unknown)===null&&image.before){
  if(image.resource==='PAYOUT_REQUEST'){const {restoreVoidedRequest}=await import('../vm-ops/payout-fix');await restoreVoidedRequest(tx,projectId,image.id);return;}
  // A member taken out of a mistaken / SUS preparation that was then voided (28/10/2026): the void restore above brought the row back
  // (members are restored after their request: the request image is remembered first); it gets its active state back, never into two open requests.
  if(image.resource==='PAYOUT_MEMBER'){const b=image.before,now=await tx.earnPayoutMember.findFirst({where:{id:image.id,projectId}});if(!now)throw new ProxyDomainError('INVALID_INPUT','VM gộp không còn trong lệnh rút; không hoàn tác');
   if(!b.removedAt){const {openPayoutOf}=await import('../vm-ops/payout-members');const other=await openPayoutOf(tx,projectId,String(b.vmId),Number(b.cycle),String(b.requestId));if(other)throw new ProxyDomainError('INVALID_INPUT','VM đã vào lệnh rút khác ('+other.where+'); không hoàn tác');}
   await tx.earnPayoutMember.update({where:{id:image.id},data:{removedAt:b.removedAt?new Date(String(b.removedAt)):null,removedById:(b.removedById as string|null)??null,revision:{increment:1}}});return;}
  if(image.resource==='PAYOUT'){const b=image.before;await tx.earnAppPayout.create({data:{id:image.id,projectId,earnAppId:String(b.earnAppId),paypalId:(b.paypalId as string|null)??null,paypalEmailId:(b.paypalEmailId as string|null)??null,vmId:(b.vmId as string|null)??null,startedAt:new Date(String(b.startedAt)),endedAt:b.endedAt?new Date(String(b.endedAt)):null}});return;}
  throw new ProxyDomainError('INVALID_INPUT');
 }
 // Facts that never go back (19/10/2026): an email given to its first EarnApp stays used forever, with or without money on it; a
 // recorded recreation keeps its closed round, its closed EarnApp and the used receipt (see operation-history/undo-rules.ts).
 if(image.resource==='PAYPAL_EMAIL'&&image.after.usedEarnAppId&&!image.before?.usedEarnAppId)throw new ProxyDomainError('INVALID_INPUT','Email PayPal đã cấp cho EarnApp giữ dấu đã dùng vĩnh viễn; dùng Bỏ gán thay vì hoàn tác');
 if((image.resource==='VM_CYCLE'&&!image.before)||(image.resource==='EARNAPP'&&image.after.closedAt&&!image.before?.closedAt)||(['PAYOUT_REQUEST','PAYOUT_MEMBER'].includes(image.resource)&&image.after.consumedAt&&!image.before?.consumedAt))throw new ProxyDomainError('INVALID_INPUT','Ghi nhận tạo lại VM chỉ để xem; không hoàn tác');
 // SDK store: a link to EarnApp is never taken back; positions are restored through the mirror (see vm-management/sdk-store.ts).
 if(image.resource==='SDK_SLOT')return;
 if(image.resource==='SDK'){await restoreSdkImage(tx,projectId,image,actorId);return;}
 if(image.resource==='SPLIT_PAYMENT'&&(image.after.paid||image.before?.paid))throw new ProxyDomainError('INVALID_INPUT','Ghi nhận đã trả tiền cần nghiệp vụ điều chỉnh riêng');
 const before=image.before,data:Record<string,unknown>={};
 if(before){for(const [key,value] of Object.entries(before)){if(key==='revision')continue;data[key]=value&&['date','receivedAt','fxAppliedAt','paidAt','periodStart','periodEnd','completedAt','dueDate','archivedAt','voidedAt','nextDueDate','lastPaidAt','registeredAt','purchasedAt','usedAt','startedAt','endedAt','closedAt','statusAt','requestedAt','settledAt','consumedAt','submittedAt','holdAt','loginIssueAt','removedAt','shareObservedAt','lostAt'].includes(key)?new Date(String(value)):value;}}
 else if(['GMAIL','PAYPAL','PAYPAL_EMAIL','WORK','ACCOUNT_BATCH'].includes(image.resource))data.archivedAt=new Date();
 else if(image.resource==='EARNAPP'){await tx.earnAppPayout.deleteMany({where:{earnAppId:image.id}});await tx.earnAppAccount.delete({where:{id:image.id}});return;} // created by the undone operation
 else if(image.resource==='PAYOUT'){await tx.earnAppPayout.deleteMany({where:{id:image.id}});return;} // history period opened by the undone operation
 else if(image.resource==='VM_OPS'){await tx.vmOperation.delete({where:{id:image.id}});return;} // first record of this VM: back to "Chưa ghi"
 else if(image.resource==='PAYOUT_MEMBER'){await tx.earnPayoutMember.deleteMany({where:{id:image.id}});return;} // attached by the undone operation (already gone with its request)
 else if(image.resource==='PAYOUT_REQUEST'){if(await tx.fundTransaction.findFirst({where:{payoutRequestId:image.id},select:{id:true}}))throw new ProxyDomainError('INVALID_INPUT','Yêu cầu rút đã có khoản tiền về liên kết; giữ yêu cầu để đối chiếu');await tx.earnPayoutMember.deleteMany({where:{requestId:image.id}});await tx.earnPayoutRequest.delete({where:{id:image.id}});return;}
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
 if(image.resource==='VM_OPS'){await tx.vmOperation.update({where:{id:image.id},data:data as Prisma.VmOperationUncheckedUpdateInput});await tx.vmOpsEvent.create({data:{projectId,vmId:String(before!.vmId),cycle:Number(before!.cycle),kind:'UNDO',fromStatus:(image.after.status as never)??null,toStatus:(before!.status as never)??null,note:'Hoàn tác ghi nhận trên web',actorId:actorId||''}});}
 if(image.resource==='PAYOUT_REQUEST'){
  if(data.state==='REQUESTED'&&(data.submission==='PREPARING'||data.submission==='UNKNOWN'))await assertPayoutDailySlot(tx,projectId,String(data.paypalId),String(data.paypalEmailId));
  await tx.earnPayoutRequest.update({where:{id:image.id},data:data as Prisma.EarnPayoutRequestUncheckedUpdateInput});
 }
 // Merged payout (review 27/10/2026): undo never puts a VM into two open requests at once.
 if(image.resource==='PAYOUT_MEMBER'&&before&&!before.removedAt&&image.after?.removedAt){const {openPayoutOf}=await import('../vm-ops/payout-members');const other=await openPayoutOf(tx,projectId,String(before.vmId),Number(before.cycle),String(before.requestId));if(other)throw new ProxyDomainError('INVALID_INPUT','VM đã vào lệnh rút khác ('+other.where+'); không hoàn tác bỏ gộp');}
 if(image.resource==='PAYOUT_REQUEST'&&data.state==='REQUESTED'&&image.after?.state!=='REQUESTED'){const {assertMembersFree}=await import('../vm-ops/payout-members');try{await assertMembersFree(tx,projectId,image.id);}catch(e){throw new ProxyDomainError('INVALID_INPUT',e instanceof ProxyDomainError?e.message.replace(/^[A-Z_]+: /,''):'VM đã vào lệnh rút khác; không hoàn tác');}}
 if(image.resource==='PAYOUT_MEMBER')await tx.earnPayoutMember.update({where:{id:image.id},data:data as Prisma.EarnPayoutMemberUncheckedUpdateInput});
 if(image.resource==='VM_CYCLE')throw new ProxyDomainError('INVALID_INPUT');
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
 const s=image.after||{},b=image.before,label=String(s.email||s.code||s.title||s.transactionId||s.partnerName||(image.resource==='COST'?s.category+' · '+dayText(new Date(String(s.date))):image.resource==='PROFIT'?dayText(new Date(String(s.periodStart)))+' → '+dayText(new Date(String(s.periodEnd))):image.id));
 const format=(row:BusinessRow|null)=>{
  if(!row)return 'Chưa có';if(row.voidedAt||row.archivedAt)return 'Đã thu hồi / ẩn';
  if(image.resource==='TEAM_RECEIPT')return `${row.amountUsdt??'Chưa xác minh'} USDT · ${row.status}`;
  if(image.resource==='COST'&&row.usdtAmount)return `${row.amount} ${row.currency} → ${row.usdtAmount} USDT · 1 USDT = ${row.usdtRate} ${row.currency}`;
  if(image.resource==='VM_BINDING')return 'VM';
  if(image.resource==='EARNAPP')return (row.vmId?'Đang trên VM':'Chưa gán VM')+' · '+(row.paypalId?'có PayPal':'chưa có PayPal')+(row.registeredAt?' · đã ghi đăng ký':'');
  if(image.resource==='ACCOUNT_BATCH')return 'Lô '+row.code+(row.costRecordId?' · đã ghi chi phí':' · chưa ghi chi phí');
  if(image.resource==='VM_SDK'||image.resource==='SDK_SLOT')return row.sdkId?String(row.sdkId):'Chưa có SDK';
  if(image.resource==='SDK')return (row.vmId?'Đang trên VM':'Trong kho')+' · '+(row.amount!=null?formatSdkAmount(String(row.amount)):'chưa ghi tiền')+' · '+SDK_STATE_LABEL[row.linkState as SdkLinkState]+(row.note?' · '+String(row.note).slice(0,60):'');
  if(image.resource==='VM_OPS')return 'Lượt '+row.cycle+' · '+(row.status?String(row.status):'Chưa ghi');
  if(image.resource==='VM_CYCLE')return 'Lượt '+row.number+' đã đóng ('+row.reason+')';
  if(image.resource==='PAYOUT_MEMBER')return 'VM gộp lượt '+row.cycle+(row.removedAt?' · đã bỏ gộp':'')+(row.consumedAt?' · đã dùng để tạo lại VM':'');
  if(image.resource==='PAYOUT_REQUEST')return `${row.amount} ${row.currency} · ${row.state}`+(row.consumedAt?' · đã dùng để tạo lại VM':'');
  if(image.resource==='PROFIT')return `Lợi nhuận ${row.netProfit} ${row.currency} · ${row.settled?'Đã chốt':'Bản tính'}`;
  if(row.amount){const status=image.resource==='FUND'?row.failed?'Không về':row.confirmed?'Đã nhận':'Chờ nhận':image.resource==='WITHDRAWAL'?row.type==='MIXING'?'Chuyển nội bộ':row.paidToTeam?'Đã về':'Chờ về':image.resource==='SPLIT_PAYMENT'?row.paid?'Đã ghi trả':'Chưa ghi trả':'Chi phí';return `${row.amount} ${row.currency||''} · ${status}`;}
  if(image.resource==='PACKAGE')return 'Đến hạn '+(row.nextDueDate?dayText(new Date(String(row.nextDueDate))):'chưa đặt');
  return [row.status,row.notes].filter(Boolean).join(' · ')||'Đã lưu';
 };
 const secrets=['password','twoFaCurrent','twoFa','token','hotmailToken','twoFaLink','smsLink'],secretChanged=b&&secrets.some(k=>s[k]!==b[k]);
 return {resource:{GMAIL:'Gmail',PAYPAL:'PayPal',PAYPAL_EMAIL:'Email PayPal',VM_BINDING:'Tài khoản VM',VM_SDK:'SDK EarnApp',WORK:'Công việc',COST:'Chi phí',FUND:'Tiền nhận',WITHDRAWAL:'Tiền rút / chuyển',PROFIT:'Kỳ lợi nhuận',SPLIT_PAYMENT:'Ghi trả lợi nhuận',TEAM_RECEIPT:'Nhận về team',COLLECTOR_EXPENSE:'Đối soát collector',PACKAGE:'Gói proxy',PAYOUT:'Email nhận của EarnApp',VM_OPS:'Tình trạng VM',PAYOUT_REQUEST:'Yêu cầu rút EarnApp',PAYOUT_MEMBER:'VM gộp vào lệnh rút',VM_CYCLE:'Lượt VM đã đóng',SDK:'SDK (Kho SDK)',SDK_SLOT:'SDK của VM',EARNAPP:'Tài khoản EarnApp',ACCOUNT_BATCH:'Lô nhập tài khoản'}[image.resource],label,before:format(b),after:(image.after?format(s):'Đã gỡ (hoàn tác)')+(secretChanged?' · Đã cập nhật thông tin đăng nhập':''),onUndo:['VM_OPS','VM_CYCLE','PAYOUT_REQUEST','PAYOUT_MEMBER'].includes(image.resource)?'Chỉ huỷ ghi nhận trên web; không đảo ngược việc rút tiền hay xoá / cài máy thật':b?'Khôi phục ghi nhận trước nếu chưa được sửa tiếp':'Ẩn / thu hồi bản ghi; giữ lịch sử'};
}
