import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {CashDecimal} from '../business-management/usdt-money';
import {dayText} from '../business-management/money';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {assertBusinessArea} from '../business-management/scope';
import {canSeeMoney} from './inventory';
// Stock state is computed from the current links, never stored:
//  NEW       never linked to an EarnApp account (login) / never received for one (PayPal), usable
//  ASSIGNED  the EarnApp account runs on a VM now (shown with server / VM)
//  USED      linked before (or its EarnApp account has no VM now); never offered again as NEW
//  BLOCKED   status is not ACTIVE (error / stopped): history kept, not offered for new assignment
export type StockState='NEW'|'ASSIGNED'|'USED'|'BLOCKED';
const can=(scope:ActorScope,area:'INFRASTRUCTURE'|'PAYPALS',write=false)=>{try{assertBusinessArea(scope,area,write);return true;}catch{return false;}};
const place=(vm:{id:string;code:string;server:{id:string;code:string}}|null)=>vm?{vmId:vm.id,vm:vm.code,serverId:vm.server.id,server:vm.server.code}:null;
const vmSelect={select:{id:true,code:true,archivedAt:true,server:{select:{id:true,code:true}}}} as const;
export async function readAccountStore(scope:ActorScope,db:PrismaClient=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId),logins=can(current,'INFRASTRUCTURE'),paypals=can(current,'PAYPALS');
  if(current.businessMode!=='PROXY_VM'||!logins&&!paypals)throw new ProxyDomainError('FORBIDDEN');
  const money=canSeeMoney(current),projectId=scope.projectId;
  const [gm,pp,batches,legacyVms]=await Promise.all([
    logins?db.gmailAccount.findMany({where:{projectId,archivedAt:null},select:{id:true,email:true,loginType:true,status:true,notes:true,recoveryEmail:true,revision:true,createdAt:true,batchId:true,password:true,twoFaCurrent:true,token:true,_count:{select:{vms:true}},earnApp:{select:{id:true,registeredAt:true,revision:true,vm:vmSelect,paypal:{select:{id:true,code:true}}}}},orderBy:[{createdAt:'desc'},{email:'asc'}]}):Promise.resolve([]),
    paypals||logins?db.payPalAccount.findMany({where:{projectId,archivedAt:null},select:{id:true,code:true,primaryEmail:true,status:true,notes:true,revision:true,createdAt:true,batchId:true,firstEarnAppId:true,_count:{select:{gmails:true}},earnApp:{select:{id:true,login:{select:{email:true}},vm:vmSelect}}},orderBy:[{createdAt:'desc'},{code:'asc'}]}):Promise.resolve([]),
    db.accountPurchaseBatch.findMany({where:{projectId,archivedAt:null},include:{costRecord:{select:{id:true,voidedAt:true,usdtAmount:true}},_count:{select:{logins:true,paypals:true}}},orderBy:[{purchasedAt:'desc'},{code:'asc'}]}),
    logins?db.virtualMachine.findMany({where:{gmailId:{not:null},managed:true,server:{projectId,managed:true}},select:{id:true,code:true,archivedAt:true,gmailId:true,server:{select:{id:true,code:true}},earnApp:{select:{loginId:true}},gmail:{select:{email:true,paypalId:true}}}}):Promise.resolve([]),
  ]);
  const batchOf=new Map(batches.map(b=>[b.id,b]));
  // Per-account price is an allocation of the batch payment for information only (unit price, else total / quantity bought, else
  // total / accounts received).
  const allocated=(batchId:string|null)=>{const b=batchId?batchOf.get(batchId):null;if(!money||!b||!b.totalPaid)return null;const n=b.kind==='PAYPAL'?b._count.paypals:b._count.logins;const per=b.paidQuantity??n,each=b.unitPrice??(per?new CashDecimal(b.totalPaid.toString()).div(per):null);return each?{amount:new CashDecimal(each.toString()).toDecimalPlaces(4).toString(),currency:b.currency}:null;};
  const loginRows=gm.map(g=>{const vm=g.earnApp?.vm&&!g.earnApp.vm.archivedAt?g.earnApp.vm:null,state:StockState=g.status!=='ACTIVE'?'BLOCKED':vm?'ASSIGNED':g.earnApp?'USED':'NEW';
    return {id:g.id,email:g.email,type:g.loginType,status:g.status,state,revision:g.revision,notes:g.notes,recoveryEmail:g.recoveryEmail,createdAt:g.createdAt.toISOString(),batch:g.batchId?batchOf.get(g.batchId)?.code??null:null,batchId:g.batchId,price:allocated(g.batchId),credentialsAvailable:!!(g.password||g.twoFaCurrent||g.token),
      earnApp:g.earnApp?{id:g.earnApp.id,revision:g.earnApp.revision,registeredAt:g.earnApp.registeredAt?.toISOString()??null,paypal:g.earnApp.paypal?.code??null}:null,place:place(vm),legacyVmCount:g._count.vms};});
  const paypalRows=pp.map(p=>{const vm=p.earnApp?.vm&&!p.earnApp.vm.archivedAt?p.earnApp.vm:null,state:StockState=p.status!=='ACTIVE'?'BLOCKED':vm?'ASSIGNED':p.earnApp||p.firstEarnAppId?'USED':'NEW';
    return {id:p.id,code:p.code,email:p.primaryEmail,status:p.status,state,revision:p.revision,notes:p.notes,createdAt:p.createdAt.toISOString(),batch:p.batchId?batchOf.get(p.batchId)?.code??null:null,batchId:p.batchId,price:allocated(p.batchId),earnAppLogin:p.earnApp?.login.email??null,place:place(vm),legacyLoginCount:p._count.gmails};});
  const batchRows=batches.filter(b=>b.kind==='PAYPAL'?paypals:logins).map(b=>({id:b.id,kind:b.kind,type:b.loginType,code:b.code,source:b.source,purchasedAt:dayText(b.purchasedAt),lineCount:b.lineCount,paidQuantity:b.paidQuantity,received:b.kind==='PAYPAL'?b._count.paypals:b._count.logins,revision:b.revision,notes:b.notes,
    cost:b.costRecord&&!b.costRecord.voidedAt?'RECORDED' as const:b.costRecord?'VOIDED' as const:'NONE' as const,costId:money?b.costRecord?.id??null:null,
    money:money&&b.totalPaid?{priceMode:b.priceMode,unit:b.unitPrice?.toString()??null,total:b.totalPaid.toString(),currency:b.currency,usdt:b.costRecord&&!b.costRecord.voidedAt?b.costRecord.usdtAmount?.toString()??null:null}:null}));
  // Old data that conflicts with the new rules: listed for a person to check; never merged, moved or deleted automatically.
  const review:{kind:string;message:string;place:ReturnType<typeof place>}[]=[];
  for(const v of legacyVms)if(!v.earnApp)review.push({kind:'LEGACY_VM_LOGIN',message:'VM có Gmail cũ '+v.gmail?.email+' (trước quy tắc mới) nhưng chưa có tài khoản EarnApp; gán lại tại ô nếu đúng',place:v.archivedAt?null:place(v)});
  for(const g of loginRows)if(g.legacyVmCount>1)review.push({kind:'LEGACY_SHARED_LOGIN',message:'Gmail '+g.email+' từng ghi cho '+g.legacyVmCount+' VM (quy tắc cũ dùng chung); mỗi tài khoản giờ chỉ cho một VM',place:null});
  for(const p of paypalRows)if(p.legacyLoginCount>1)review.push({kind:'LEGACY_SHARED_PAYPAL',message:'PayPal '+p.code+' từng liên kết '+p.legacyLoginCount+' Gmail (quy tắc cũ); một PayPal chỉ nhận cho một EarnApp',place:null});
  // Batches recorded before the 17/10 fix: unit price × pasted lines (errors and repeats included), and a same-day code reused by
  // a later import fell into the first batch without its own cost. Listed for comparison with what was paid; never recomputed.
  const legacy=batches.filter(b=>b.costRule===1&&(b.kind==='PAYPAL'?paypals:logins)),ids=legacy.map(b=>b.id);
  if(ids.length){
    const [gl,pl]=await Promise.all([db.gmailAccount.groupBy({by:['batchId'],where:{projectId,batchId:{in:ids}},_max:{createdAt:true}}),db.payPalAccount.groupBy({by:['batchId'],where:{projectId,batchId:{in:ids}},_max:{createdAt:true}})]);
    const last=new Map([...gl,...pl].map(r=>[r.batchId,r._max.createdAt]));
    for(const b of legacy){
      const received=b.kind==='PAYPAL'?b._count.paypals:b._count.logins,late=last.get(b.id),why:string[]=[];
      if(b.priceMode==='UNIT'&&received!==b.lineCount)why.push('tiền tính theo giá × '+b.lineCount+' dòng dán, '+received+' đã nhận');
      if(late&&late.getTime()-b.createdAt.getTime()>120000)why.push('có tài khoản nhập thêm sau lần đầu cùng mã lô (có thể là lần mua khác chưa ghi chi phí riêng)');
      if(why.length)review.push({kind:'LEGACY_BATCH_COST',message:'Lô '+b.code+' (ghi trước bản sửa 17/10): '+why.join('; ')+'. Đối chiếu với tiền thực trả; web không tự tính lại hay sửa chi phí.',place:null});
    }
  }
  for(const g of loginRows)if(!g.type)review.push({kind:'LOGIN_TYPE_MISSING',message:'Tài khoản '+g.email+' chưa chọn loại Gmail / Apple ID (dữ liệu cũ); web không tự đoán từ đuôi email',place:null});
  return {logins:logins?loginRows:[],paypals:paypalRows,batches:batchRows,review,
    rights:{logins,paypals,writeLogins:can(current,'INFRASTRUCTURE',true)&&['ADMIN','MODERATOR'].includes(current.role),writePaypals:can(current,'PAYPALS',true)&&['ADMIN','MODERATOR'].includes(current.role),money,writeCosts:!!current.teamCashEnabled&&(current.role==='ADMIN'||current.role==='MODERATOR'&&!!current.allowedModules?.includes('COSTS')),copy:current.role!=='VIEWER'&&(current.role==='ADMIN'||current.capabilities.includes('COPY_CREDENTIALS'))}};
}
// Server/VM grid: the EarnApp account of each VM (login, type, PayPal) plus the legacy Gmail link when no account was recorded yet.
export async function readVmAccounts(scope:ActorScope,db:PrismaClient=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);if(!can(current,'INFRASTRUCTURE'))throw new ProxyDomainError('FORBIDDEN');
  const vms=await db.virtualMachine.findMany({where:{managed:true,server:{projectId:scope.projectId,managed:true}},select:{id:true,gmail:{select:{email:true}},earnApp:{select:{id:true,revision:true,registeredAt:true,login:{select:{id:true,email:true,loginType:true,status:true}},paypal:{select:{id:true,code:true,primaryEmail:true,status:true}}}}}});
  return vms.filter(v=>v.earnApp||v.gmail).map(v=>({vmId:v.id,earnApp:v.earnApp?{id:v.earnApp.id,revision:v.earnApp.revision,registeredAt:v.earnApp.registeredAt?.toISOString()??null,login:{id:v.earnApp.login.id,email:v.earnApp.login.email,type:v.earnApp.login.loginType,status:v.earnApp.login.status},paypal:v.earnApp.paypal?{id:v.earnApp.paypal.id,code:v.earnApp.paypal.code,email:v.earnApp.paypal.primaryEmail,status:v.earnApp.paypal.status}:null}:null,legacyGmail:!v.earnApp&&v.gmail?v.gmail.email:null}));
}
