import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {CashDecimal,readPaypalCostRates} from '../business-management/usdt-money';
import {dayText} from '../business-management/money';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {vmWhere,hasServerScope,scopedLoginWhere} from '../permissions/server-scope';
import {assertBusinessArea} from '../business-management/scope';
import {canSeeMoney} from './inventory';
// Stock state is computed from the current links, never stored:
//  NEW       never linked to an EarnApp account (login) / never received for one (PayPal), usable
//  ASSIGNED  the EarnApp account runs on a VM now (shown with server / VM)
//  USED      linked before (or its EarnApp account has no VM now); never offered again as NEW
//  BLOCKED   status is not ACTIVE (error / stopped): history kept, not offered for new assignment
export type StockState='NEW'|'ASSIGNED'|'USED'|'BLOCKED'|'DELETED';
const can=(scope:ActorScope,area:'INFRASTRUCTURE'|'PAYPALS',write=false)=>{try{assertBusinessArea(scope,area,write);return true;}catch{return false;}};
const place=(vm:{id:string;code:string;server:{id:string;code:string}}|null)=>vm?{vmId:vm.id,vm:vm.code,serverId:vm.server.id,server:vm.server.code}:null;
const vmSelect={select:{id:true,code:true,archivedAt:true,server:{select:{id:true,code:true}}}} as const;
/** options.deleted: the rows deleted from the stock (archivedAt set; Khôi phục), instead of the live stock. Batches are the same. */
export async function readAccountStore(scope:ActorScope,db:PrismaClient=prisma,options:{deleted?:boolean}={}){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);
  if(hasServerScope(current))return readScopedLoginStore(current,db,options);
  const archived=options.deleted?{not:null}:null,logins=can(current,'INFRASTRUCTURE'),paypals=can(current,'PAYPALS');
  if(current.businessMode!=='PROXY_VM'||!logins&&!paypals)throw new ProxyDomainError('FORBIDDEN');
  const money=canSeeMoney(current),projectId=scope.projectId;
  const [gm,pp,batches,legacyVms]=await Promise.all([
    logins?db.gmailAccount.findMany({where:{projectId,archivedAt:archived},select:{id:true,email:true,loginType:true,status:true,loginIssueNote:true,loginIssueAt:true,notes:true,recoveryEmail:true,phone:true,twoFaLink:true,smsLink:true,revision:true,createdAt:true,archivedAt:true,batchId:true,password:true,twoFaCurrent:true,token:true,_count:{select:{vms:true}},earnApp:{select:{id:true,registeredAt:true,revision:true,vm:vmSelect,paypal:{select:{id:true,code:true}},paypalEmail:{select:{id:true,email:true}}}}},orderBy:[{createdAt:'desc'},{email:'asc'}]}):Promise.resolve([]),
    paypals||logins?db.payPalAccount.findMany({where:{projectId,archivedAt:archived},select:{id:true,code:true,primaryEmail:true,status:true,notes:true,revision:true,createdAt:true,batchId:true,archivedAt:true,_count:{select:{gmails:true}},emails:{select:{id:true,email:true,isPrimary:true,archivedAt:true,usedEarnAppId:true,reviewHold:true,reviewNote:true,createdAt:true,revision:true,earnApp:{select:{id:true,login:{select:{email:true}},vm:vmSelect}}},orderBy:[{isPrimary:'desc'},{createdAt:'asc'},{email:'asc'}]},earnApps:{where:{paypalEmailId:null},select:{id:true,login:{select:{email:true}},vm:vmSelect}}},orderBy:[{createdAt:'desc'},{code:'asc'}]}):Promise.resolve([]),
    db.accountPurchaseBatch.findMany({where:{projectId,archivedAt:null},include:{costRecord:{select:{id:true,voidedAt:true,date:true,amount:true,currency:true,usdtRate:true,usdtAmount:true,fxNote:true}},_count:{select:{logins:true,paypals:true}}},orderBy:[{purchasedAt:'desc'},{createdAt:'desc'},{id:'desc'}]}),// newest purchase date first; same day: the purchase created last first
   
    logins?db.virtualMachine.findMany({where:{gmailId:{not:null},managed:true,server:{projectId,managed:true}},select:{id:true,code:true,archivedAt:true,gmailId:true,server:{select:{id:true,code:true}},earnApp:{select:{loginId:true}},gmail:{select:{email:true,paypalId:true}}}}):Promise.resolve([]),
  ]);
  // Lịch sử nhập kho order: purchase day (as shown, Asia/Bangkok) newest first; same day: the purchase created last first; then id.
  batches.sort((a,b)=>dayText(b.purchasedAt).localeCompare(dayText(a.purchasedAt))||b.createdAt.getTime()-a.createdAt.getTime()||(a.id<b.id?1:a.id>b.id?-1:0));
  const batchOf=new Map(batches.map(b=>[b.id,b]));
  // The current cost record in Chi phí is what was actually paid: amount, currency, rate, USDT and state come from it, never from
  // the batch's first price (kept as history only, shown when the cost was adjusted or voided). Nothing is recomputed or written.
  type BatchRow=typeof batches[number];
  const paidOf=(b:BatchRow)=>{
    const c=b.costRecord&&!b.costRecord.voidedAt?b.costRecord:null,same=!!c&&!!b.totalPaid&&c.currency===b.currency&&new CashDecimal(c.amount.toString()).eq(b.totalPaid.toString());
    const n=b.kind==='PAYPAL'?b._count.paypals:b._count.logins,per=b.paidQuantity??n;
    // The unit × quantity formula is only shown while the ledger still holds that exact total.
    const unit=same&&b.unitPrice?b.unitPrice.toString():null;
    const each=c?unit??(per?new CashDecimal(c.amount.toString()).div(per).toDecimalPlaces(4).toString():null):null;
    return {c,same,unit,each};
  };
  const allocated=(batchId:string|null)=>{const b=batchId?batchOf.get(batchId):null;if(!money||!b)return null;const p=paidOf(b);return p.c&&p.each?{amount:new CashDecimal(p.each).toDecimalPlaces(4).toString(),currency:p.c.currency}:null;};
  const priceState=(batchId:string|null)=>{const b=batchId?batchOf.get(batchId):null;return !b?.costRecord?'NONE' as const:b.costRecord.voidedAt?'VOIDED' as const:'RECORDED' as const;};
  const loginRows=gm.map(g=>{const vm=g.earnApp?.vm&&!g.earnApp.vm.archivedAt?g.earnApp.vm:null,state:StockState=g.archivedAt?'DELETED':g.status!=='ACTIVE'?'BLOCKED':vm?'ASSIGNED':g.earnApp?'USED':'NEW';
    return {id:g.id,email:g.email,type:g.loginType,status:g.status,loginIssueNote:g.loginIssueNote,loginIssueAt:g.loginIssueAt?.toISOString()??null,state,deletedAt:g.archivedAt?.toISOString()??null,revision:g.revision,notes:g.notes,recoveryEmail:g.recoveryEmail,createdAt:g.createdAt.toISOString(),batch:g.batchId?batchOf.get(g.batchId)?.code??null:null,batchId:g.batchId,price:allocated(g.batchId),priceState:priceState(g.batchId),credentialsAvailable:!!(g.password||g.twoFaCurrent||g.token||g.twoFaLink||g.smsLink),phone:g.phone,links:{twoFa:!!g.twoFaLink,sms:!!g.smsLink},has:{password:!!g.password,twoFa:!!g.twoFaCurrent,token:!!g.token},
      earnApp:g.earnApp?{id:g.earnApp.id,revision:g.earnApp.revision,registeredAt:g.earnApp.registeredAt?.toISOString()??null,paypal:g.earnApp.paypal?g.earnApp.paypal.code+' · '+(g.earnApp.paypalEmail?.email??'chưa xác định email'):null}:null,place:place(vm),legacyVmCount:g._count.vms};});
  // PayPal: one row per code, its emails each with their own use. An email is NEW (never given to an EarnApp, not held), ASSIGNED
  // (receiving for an EarnApp account on a VM now), USED (given before; never offered again) or HOLD (old data to reconcile). The
  // PayPal is NEW while it still has a NEW email (one assigned email does not use up the PayPal), BLOCKED when locked / stopped.
  const paypalRows=pp.map(p=>{
    const emails=p.emails.filter(e=>!e.archivedAt).map(e=>{const vm=e.earnApp?.vm&&!e.earnApp.vm.archivedAt?e.earnApp.vm:null,state:'NEW'|'ASSIGNED'|'USED'|'HOLD'=e.reviewHold&&!e.earnApp?'HOLD':vm?'ASSIGNED':e.earnApp||e.usedEarnAppId?'USED':'NEW';
      return {id:e.id,email:e.email,primary:e.isPrimary,state,earnAppLogin:e.earnApp?.login.email??null,place:place(vm),note:e.reviewHold?e.reviewNote:null,revision:e.revision};});
    const n=(s:string)=>emails.filter(e=>e.state===s).length,counts={total:emails.length,NEW:n('NEW'),ASSIGNED:n('ASSIGNED'),USED:n('USED'),HOLD:n('HOLD')};
    const state:StockState=p.archivedAt?'DELETED':p.status!=='ACTIVE'?'BLOCKED':counts.NEW?'NEW':counts.ASSIGNED?'ASSIGNED':'USED';
    // Old links whose email is not known (before 18/10/2026): shown on the PayPal, never moved to an email by guessing.
    const unknown=p.earnApps.map(a=>({earnAppLogin:a.login.email,place:place(a.vm&&!a.vm.archivedAt?a.vm:null)}));
    return {id:p.id,code:p.code,email:p.primaryEmail,status:p.status,state,deletedAt:p.archivedAt?.toISOString()??null,revision:p.revision,notes:p.notes,createdAt:p.createdAt.toISOString(),batch:p.batchId?batchOf.get(p.batchId)?.code??null:null,batchId:p.batchId,price:allocated(p.batchId),priceState:priceState(p.batchId),emails,counts,unknownLinks:unknown,legacyLoginCount:p._count.gmails};});
  // Lịch sử nhập kho counts what the purchase brought in: every email of its PayPals, deleted or not (review fix 20/10/2026).
  const ppBatchIds=batches.filter(b=>b.kind==='PAYPAL').map(b=>b.id),emailsInBatch=new Map<string,number>();
  if(ppBatchIds.length){const rows=await db.payPalEmail.findMany({where:{projectId,paypal:{batchId:{in:ppBatchIds}}},select:{paypal:{select:{batchId:true}}}});for(const r of rows){const b=r.paypal.batchId!;emailsInBatch.set(b,(emailsInBatch.get(b)||0)+1);}}
  const batchRows=batches.filter(b=>b.kind==='PAYPAL'?paypals:logins).map(b=>({id:b.id,kind:b.kind,type:b.loginType,code:b.code,source:b.source,purchasedAt:dayText(b.purchasedAt),lineCount:b.lineCount,paidQuantity:b.paidQuantity,received:b.kind==='PAYPAL'?b._count.paypals:b._count.logins,emails:b.kind==='PAYPAL'?emailsInBatch.get(b.id)??0:null,revision:b.revision,notes:b.notes,
    cost:b.costRecord&&!b.costRecord.voidedAt?'RECORDED' as const:b.costRecord?'VOIDED' as const:'NONE' as const,costId:money?b.costRecord?.id??null:null,
    costLink:money&&b.costRecord&&!b.costRecord.voidedAt?{id:b.costRecord.id,month:dayText(b.costRecord.date).slice(0,7)}:null,
    money:money?(()=>{const p=paidOf(b),original=b.totalPaid?{total:b.totalPaid.toString(),currency:b.currency,unit:b.unitPrice?.toString()??null,quantity:b.paidQuantity}:null;
      if(p.c)return {...readPaypalCostRates(p.c.fxNote),priceMode:b.priceMode,total:p.c.amount.toString(),currency:p.c.currency,rate:p.c.usdtRate?.toString()??null,usdt:p.c.usdtAmount?.toString()??null,unit:p.unit,adjusted:!p.same,original:p.same?null:original};
      return original?{paypalVndRate:null,vndUsdtRate:null,priceMode:b.priceMode,total:null,currency:null,rate:null,usdt:null,unit:null,adjusted:false,original}:null;})():null}));
  // Old data that conflicts with the new rules: listed for a person to check; never merged, moved or deleted automatically. Each item
  // belongs to one account kind (shown with that kind), has a short reason and opens the place to handle it: the VM, the account
  // (searched in its own table) or the purchase in Lịch sử nhập kho. Account states (locked, PayPal limit, stopped) are not listed here.
  type Open={type:'vm';place:NonNullable<ReturnType<typeof place>>}|{type:'account';q:string}|{type:'batch';code:string};
  type Review={kind:string;group:'LOGIN'|'PAYPAL';subject:string;reason:string;message:string;place:ReturnType<typeof place>;open:Open};
  const review:Review[]=[];const reviewOn=!options.deleted;
  const add=(r:Omit<Review,'message'>)=>{if(reviewOn)review.push({...r,message:r.subject+': '+r.reason});};
  for(const v of legacyVms)if(!v.earnApp){const at=v.archivedAt?null:place(v),email=v.gmail?.email||'';add({kind:'LEGACY_VM_LOGIN',group:'LOGIN',subject:email,reason:'Gmail cũ ghi trên VM '+v.server.code+' / '+v.code+' (trước quy tắc mới), VM chưa có tài khoản EarnApp. Gán lại tại ô nếu đúng.',place:at,open:at?{type:'vm',place:at}:{type:'account',q:email}});}
  for(const g of loginRows)if(g.legacyVmCount>1)add({kind:'LEGACY_SHARED_LOGIN',group:'LOGIN',subject:g.email,reason:'Từng ghi cho '+g.legacyVmCount+' VM (quy tắc cũ dùng chung); nay một tài khoản chỉ cho một VM.',place:null,open:{type:'account',q:g.email}});
  for(const p of paypalRows){for(const e of p.emails)if(e.state==='HOLD')add({kind:'PAYPAL_EMAIL_HOLD',group:'PAYPAL',subject:p.code+' · '+e.email,reason:(e.note||'Email tạm giữ để đối chiếu')+'. Xác định email nào EarnApp cũ đã dùng; web không tự đoán.',place:null,open:{type:'account',q:e.email}});
    for(const u of p.unknownLinks)add({kind:'PAYPAL_LINK_NO_EMAIL',group:'PAYPAL',subject:p.code+' · '+u.earnAppLogin,reason:'EarnApp nhận bằng PP này từ trước 18/10 nhưng chưa rõ email; chọn đúng email tại VM.',place:u.place,open:u.place?{type:'vm',place:u.place}:{type:'account',q:p.code}});}
  for(const p of paypalRows)if(p.legacyLoginCount>1)add({kind:'LEGACY_SHARED_PAYPAL',group:'PAYPAL',subject:p.code,reason:'Từng liên kết '+p.legacyLoginCount+' Gmail (quy tắc cũ); nay mỗi EarnApp nhận qua một email riêng của PP, nhiều EarnApp có thể dùng cùng mã PP qua các email khác nhau.',place:null,open:{type:'account',q:p.code}});
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
      if(why.length)add({kind:'LEGACY_BATCH_COST',group:b.kind==='PAYPAL'?'PAYPAL':'LOGIN',subject:'Lô '+b.code,reason:'Ghi trước bản sửa 17/10: '+why.join('; ')+'. Đối chiếu với tiền thực trả; web không tự tính lại hay sửa chi phí.',place:null,open:{type:'batch',code:b.code}});
    }
  }
  for(const g of loginRows)if(!g.type)add({kind:'LOGIN_TYPE_MISSING',group:'LOGIN',subject:g.email,reason:'Chưa chọn loại Gmail / Apple ID (dữ liệu cũ); web không tự đoán từ đuôi email.',place:null,open:{type:'account',q:g.email}});
  return {logins:logins?loginRows:[],paypals:paypalRows,batches:batchRows,review,
    rights:{logins,paypals,admin:current.role==='ADMIN',writeLogins:can(current,'INFRASTRUCTURE',true)&&['ADMIN','MODERATOR'].includes(current.role),writePaypals:can(current,'PAYPALS',true)&&['ADMIN','MODERATOR'].includes(current.role),money,writeCosts:!!current.teamCashEnabled&&(current.role==='ADMIN'||current.role==='MODERATOR'&&!!current.allowedModules?.includes('COSTS')),copy:current.role!=='VIEWER'&&(current.role==='ADMIN'||current.capabilities.includes('COPY_CREDENTIALS'))}};
}
// Keep the existing grid DTO, but query no PayPal, batch, cost or global-review data at all.
async function readScopedLoginStore(current:ActorScope,db:PrismaClient,options:{deleted?:boolean}){
 if(current.businessMode!=='PROXY_VM'||!can(current,'INFRASTRUCTURE')||!['ADMIN','MODERATOR'].includes(current.role))throw new ProxyDomainError('FORBIDDEN');
 const liveVM={managed:true,archivedAt:null,server:{projectId:current.projectId,managed:true,archivedAt:null},...vmWhere(current)};
 const rows=options.deleted?[]:await db.gmailAccount.findMany({where:scopedLoginWhere(current),select:{id:true,email:true,loginType:true,status:true,loginIssueNote:true,loginIssueAt:true,notes:true,recoveryEmail:true,phone:true,revision:true,createdAt:true,password:true,twoFaCurrent:true,token:true,twoFaLink:true,smsLink:true,
  earnApp:{select:{id:true,revision:true,registeredAt:true,vm:vmSelect}},
  vms:{where:{...liveVM,earnApp:{is:null}},select:vmSelect.select}},orderBy:[{createdAt:'desc'},{email:'asc'}]});
 const logins=rows.map(g=>{const vm=g.earnApp?.vm??g.vms[0]??null,state:StockState=g.status!=='ACTIVE'?'BLOCKED':'ASSIGNED';return {
  id:g.id,email:g.email,type:g.loginType,status:g.status,loginIssueNote:g.loginIssueNote,loginIssueAt:g.loginIssueAt?.toISOString()??null,state,deletedAt:null,revision:g.revision,notes:g.notes,recoveryEmail:g.recoveryEmail,createdAt:g.createdAt.toISOString(),batch:null,batchId:null,price:null,priceState:'NONE' as const,
  credentialsAvailable:!!(g.password||g.twoFaCurrent||g.token||g.twoFaLink||g.smsLink),phone:g.phone,links:{twoFa:!!g.twoFaLink,sms:!!g.smsLink},has:{password:!!g.password,twoFa:!!g.twoFaCurrent,token:!!g.token},
  earnApp:g.earnApp?{id:g.earnApp.id,revision:g.earnApp.revision,registeredAt:g.earnApp.registeredAt?.toISOString()??null,paypal:null}:null,place:place(vm),legacyVmCount:g.vms.length,
 };});
 return {logins,paypals:[],batches:[],review:[],rights:{logins:true,paypals:false,admin:false,writeLogins:false,writePaypals:false,money:false,writeCosts:false,copy:current.role==='ADMIN'||current.capabilities.includes('COPY_CREDENTIALS')}};
}
// Server/VM grid: the EarnApp account of each VM (login, type, PayPal) plus the legacy Gmail link when no account was recorded yet.
export async function readVmAccounts(scope:ActorScope,db:PrismaClient=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);if(!can(current,'INFRASTRUCTURE'))throw new ProxyDomainError('FORBIDDEN');
  const vms=await db.virtualMachine.findMany({where:{managed:true,server:{projectId:scope.projectId,managed:true},...vmWhere(current)},select:{id:true,gmail:{select:{email:true}},earnApp:{select:{id:true,revision:true,registeredAt:true,login:{select:{id:true,email:true,loginType:true,status:true,revision:true,loginIssueNote:true,loginIssueAt:true}},paypal:{select:{id:true,code:true,primaryEmail:true,status:true}},paypalEmail:{select:{id:true,email:true}}}}}});
  return vms.filter(v=>v.earnApp||v.gmail).map(v=>({vmId:v.id,earnApp:v.earnApp?{id:v.earnApp.id,revision:v.earnApp.revision,registeredAt:v.earnApp.registeredAt?.toISOString()??null,login:{id:v.earnApp.login.id,email:v.earnApp.login.email,type:v.earnApp.login.loginType,status:v.earnApp.login.status,revision:v.earnApp.login.revision,loginIssueNote:v.earnApp.login.loginIssueNote,loginIssueAt:v.earnApp.login.loginIssueAt?.toISOString()??null},paypal:v.earnApp.paypal?{id:v.earnApp.paypal.id,code:v.earnApp.paypal.code,emailId:v.earnApp.paypalEmail?.id??null,email:v.earnApp.paypalEmail?.email??null,status:v.earnApp.paypal.status}:null}:null,legacyGmail:!v.earnApp&&v.gmail?v.gmail.email:null}));
}
