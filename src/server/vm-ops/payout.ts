import {Prisma,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {fromCents,gatherOf,milestoneOf,toCents} from '@/lib/vm-ops';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {assertInfrastructureAction} from '../permissions/infrastructure';
import {runBusinessCommand} from '../business-management/idempotency';
import {ledgerAmount,ledgerRights,readPaypalLedger} from '../business-management/paypal-ledger';
import {dayDate,dayText} from '../business-management/money';
import {LEDGER_CURRENCY} from '../business-management/types';
import {authorizeVM} from '../vm-management/repository';
import {activeVM,checkLink,writeLink} from '../account-store/links';
import {moneyOfRequest,staleCycle} from './ops';
// EarnApp payout requests (owner decision 18/10/2026: one EarnApp account, one withdrawal).
// - One request per EarnApp (unique earnAppId): a retry, a lost answer or a status correction stays on the same row; a new command
//   key never creates a second one.
// - The request keeps its VM, round, PayPal and receiving email; the email of a sent request is never changed.
// - Money received is what the PayPal book says (confirmed FundTransaction rows linked to the request). A pending linked receipt is
//   part of what is still to come, never added on top. A request is only an expectation, never income.
// - "Tiền về PP" is money on the PayPal, not a withdrawal from it, not money at a collector, not USDT at the team.
type Tx=Prisma.TransactionClient;
const D=(v:Prisma.Decimal.Value)=>new Prisma.Decimal(v);
const currencyOf=(c:string)=>{const v=c.trim().toUpperCase();if(!LEDGER_CURRENCY.test(v))throw new ProxyDomainError('INVALID_INPUT','Đồng tiền là mã 3–5 chữ cái (USD, USDT, VND…)');return v;};
const requestInclude={receipts:{select:{id:true,amount:true,currency:true,confirmed:true,failed:true,voidedAt:true,date:true}},paypal:{select:{id:true,code:true,status:true}},paypalEmail:{select:{id:true,email:true}}} as const;
// A history line keeps its kind next to the full text: the full text (amounts, corrections, shortfall, notes) is shown only with the
// money rights; everyone else gets the operating milestone of the kind.
export type PayoutHistoryKind='REQUESTED'|'CORRECT'|'FAILED'|'CANCELLED'|'RETRY'|'SETTLE'|'CONSUMED';
export const historyEntry=(by:string,kind:PayoutHistoryKind,what:string)=>({at:new Date().toISOString(),by,kind,what});
const NEUTRAL:Record<PayoutHistoryKind,string>={REQUESTED:'Ghi yêu cầu rút',CORRECT:'Sửa yêu cầu rút',FAILED:'Đánh dấu thất bại',CANCELLED:'Đánh dấu huỷ',RETRY:'Gửi lại (cùng lượt rút)',SETTLE:'Chốt nhận thiếu',CONSUMED:'Dùng để ghi tạo lại VM'};
// Lines written before 19/10/2026 carry no kind: it is read from the fixed start of the text (never from the amounts).
const LEGACY:[string,PayoutHistoryKind][]=[['Ghi yêu cầu rút','REQUESTED'],['Sửa','CORRECT'],['Thất bại','FAILED'],['Huỷ','CANCELLED'],['Gửi lại','RETRY'],['Chốt nhận','SETTLE'],['Dùng để ghi tạo lại VM','CONSUMED']];
export function neutralHistory(h:{kind?:string;what:string}){const kind=(h.kind&&h.kind in NEUTRAL?h.kind:LEGACY.find(([p])=>h.what.startsWith(p))?.[1]) as PayoutHistoryKind|undefined;return kind?NEUTRAL[kind]:'Cập nhật yêu cầu rút';}
// Who may do what with payouts. Money (amounts, balances) needs the PayPal money rights; recording a request needs the right to
// record money in (FUNDS write, managers); choosing a new receiving email also needs the right to assign on Server / VM.
export async function payoutRights(scope:ActorScope,db:PrismaClient|Tx=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId),r=await ledgerRights(current,db as PrismaClient);
  let assign=false;try{assertInfrastructureAction(current,'ASSIGN');assign=current.businessMode==='PROXY_VM';}catch{assign=false;}
  return {current,money:r.funds,balance:r.funds&&r.withdrawals,writeMoney:r.writeFunds,assign};
}
// ─── Pending money per PayPal ────────────────────────────────────────────────────────────────────────────────────────────────
// Still to come = the open part of requests waiting for money + pending receipts not linked to a request (a linked pending
// receipt is already inside its request's open part, so it is not counted twice).
export async function pendingByPaypal(db:PrismaClient|Tx,projectId:string){
  const [requests,loose]=await Promise.all([
    db.earnPayoutRequest.findMany({where:{projectId,state:'REQUESTED'},include:{receipts:{select:{amount:true,currency:true,confirmed:true,failed:true,voidedAt:true}}}}),
    db.fundTransaction.findMany({where:{projectId,voidedAt:null,confirmed:false,failed:false,entryKind:'RECEIPT',payoutRequestId:null},select:{paypalId:true,amount:true,currency:true}}),
  ]);
  const out=new Map<string,Record<string,number>>(),add=(pp:string,cur:string,c:number)=>{if(!c)return;const m=out.get(pp)||{};m[cur]=(m[cur]||0)+c;out.set(pp,m);};
  for(const r of requests){const m=moneyOfRequest(r);if(m.phase==='WAITING')add(r.paypalId,r.currency,toCents(m.remaining));}
  for(const f of loose)add(f.paypalId,f.currency,toCents(f.amount.toString()));
  return out;
}
// Balance by the book (up to today), pending and the gathering label of every PayPal, USD only for the label.
export async function readPaypalGather(scope:ActorScope,db:PrismaClient=prisma){
  const {current,money,balance}=await payoutRights(scope,db);
  if(!money)return {rights:{money,balance},paypals:[] as {paypalId:string;balanceUsd:string|null;pendingUsd:string;gather:ReturnType<typeof gatherOf>|null;pending:Record<string,string>}[]};
  const [ledger,pending,pps]=await Promise.all([balance?readPaypalLedger(current,{},db):Promise.resolve(null),pendingByPaypal(db,scope.projectId),db.payPalAccount.findMany({where:{projectId:scope.projectId},select:{id:true}})]);
  const bal=new Map((ledger?.paypals||[]).map(p=>[p.paypalId,p.currencies.find(c=>c.currency==='USD')?.balance??'0.00']));
  return {rights:{money,balance},paypals:pps.map(p=>{const pend=pending.get(p.id)||{},usd=fromCents(pend.USD||0),b=balance?bal.get(p.id)??'0.00':null;
    return {paypalId:p.id,balanceUsd:b,pendingUsd:usd,gather:b===null?null:gatherOf(b,usd),pending:Object.fromEntries(Object.entries(pend).map(([c,v])=>[c,fromCents(v)]))};})};
}
// ─── Picking the PayPal and email for a VM's EarnApp ─────────────────────────────────────────────────────────────────────────
export async function readPayoutPick(scope:ActorScope,input:{vmId:string},db:PrismaClient=prisma){
  const {current,money,balance,writeMoney}=await payoutRights(scope,db);
  if(!writeMoney)throw new ProxyDomainError('FORBIDDEN','Ghi yêu cầu rút cần quyền ghi Tiền vào PayPal');
  const vm=await activeVM(db,scope.projectId,input.vmId);if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không còn hoạt động');
  const earnApp=await db.earnAppAccount.findUnique({where:{vmId:vm.id},include:{login:{select:{email:true}},paypalEmail:{select:{id:true,email:true,paypalId:true}}}});
  const pps=await db.payPalAccount.findMany({where:{projectId:scope.projectId,archivedAt:null},select:{id:true,code:true,status:true,emails:{where:{archivedAt:null},select:{id:true,email:true,usedEarnAppId:true,reviewHold:true,earnApp:{select:{id:true}}}}}});
  const gather=money?await readPaypalGather(current,db):null,g=new Map((gather?.paypals||[]).map(p=>[p.paypalId,p]));
  const rows=pps.map(p=>{
    const own=p.emails.filter(e=>earnApp&&e.id===earnApp.paypalEmailId).map(e=>({id:e.id,email:e.email,own:true}));
    const free=p.emails.filter(e=>!e.usedEarnAppId&&!e.reviewHold&&!e.earnApp).map(e=>({id:e.id,email:e.email,own:false})).sort((a,b)=>a.email.localeCompare(b.email));
    const x=g.get(p.id);
    return {id:p.id,code:p.code,status:p.status,usable:p.status==='ACTIVE',emails:[...own,...(p.status==='ACTIVE'?free:[])],unused:p.status==='ACTIVE'?free.length:0,balanceUsd:balance?x?.balanceUsd??'0.00':null,pendingUsd:money?x?.pendingUsd??'0.00':null};
  }).filter(p=>p.emails.length).sort((a,b)=>a.code.localeCompare(b.code,'en',{numeric:true}));
  return {vm:{id:vm.id,where:vm.server.code+' / '+vm.code},earnApp:earnApp?{id:earnApp.id,login:earnApp.login.email,emailId:earnApp.paypalEmailId,email:earnApp.paypalEmail?.email??null}:null,paypals:rows,rights:{money,balance}};
}
// ─── Commands ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PayoutRequestInput {key:string;vmId:string;expectedCycle:number;paypalEmailId:string;amount:string;currency?:string;reference?:string|null;date:string}
export async function createPayoutRequest(scope:ActorScope,input:PayoutRequestInput,db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARN_PAYOUT_REQUEST',module:'FUNDS'},async(tx,images,current)=>{
    const vm=await activeVM(tx,scope.projectId,input.vmId);if(!vm)throw new ProxyDomainError('NOT_FOUND','VM không còn hoạt động');
    const ops=await tx.vmOperation.findUnique({where:{vmId:vm.id}}),cycle=ops?.cycle??1;
    if(cycle!==input.expectedCycle)throw new ProxyDomainError('STALE_PREVIEW',staleCycle(cycle));
    const earnApp=await tx.earnAppAccount.findUnique({where:{vmId:vm.id},include:{payoutRequest:{include:{paypal:{select:{code:true}}}},login:{select:{email:true}}}});
    if(!earnApp)throw new ProxyDomainError('INVALID_INPUT','VM chưa có tài khoản EarnApp; gán tài khoản trước');
    if(earnApp.payoutRequest){const r=earnApp.payoutRequest;throw new ProxyDomainError('INVALID_INPUT','EarnApp '+earnApp.login.email+' đã có yêu cầu rút ngày '+dayText(r.requestedAt)+' (PP '+r.paypal.code+'); mỗi EarnApp chỉ một lượt rút. Sửa trạng thái trên yêu cầu đó');}
    const amount=ledgerAmount(input.amount,'Số tiền yêu cầu'),currency=currencyOf(input.currency||'USD'),date=dayDate(input.date);
    let emailId=earnApp.paypalEmailId;
    if(input.paypalEmailId!==earnApp.paypalEmailId){
      // A new receiving email: the same checked assignment as Server / VM (one email, one EarnApp, forever).
      await authorizeVM(current,'ASSIGN',tx);
      const r=await checkLink(tx,scope.projectId,vm,{paypalEmail:input.paypalEmailId});if(!r.ok)throw new ProxyDomainError('INVALID_INPUT',r.message);
      if(!r.skip&&r.plan){try{await writeLink(tx,images,scope.projectId,vm,r.plan,current.userId);}catch(e){if((e as {code?:string}).code==='P2002')throw new ProxyDomainError('STALE_PREVIEW','Email PayPal vừa được cấp cho EarnApp khác; tải lại');throw e;}}
      emailId=input.paypalEmailId;
    }
    if(!emailId)throw new ProxyDomainError('INVALID_INPUT','Chọn Mã PP → Email nhận tiền');
    const email=await tx.payPalEmail.findFirstOrThrow({where:{id:emailId,projectId:scope.projectId}});
    let row;
    try{row=await tx.earnPayoutRequest.create({data:{projectId:scope.projectId,earnAppId:earnApp.id,vmId:vm.id,cycle,paypalId:email.paypalId,paypalEmailId:email.id,currency,amount,reference:input.reference?.trim().slice(0,200)||null,requestedAt:date,requestedById:current.userId,history:[historyEntry(current.userId,'REQUESTED','Ghi yêu cầu rút '+amount.toFixed(2)+' '+currency)]}});}
    catch(e){if((e as {code?:string}).code==='P2002')throw new ProxyDomainError('STALE_PREVIEW','EarnApp này vừa được ghi yêu cầu rút; tải lại');throw e;}
    await images.remember('PAYOUT_REQUEST',row.id,true);
    return {id:row.id,where:vm.server.code+' / '+vm.code,cycle};
  },db);
}
export type PayoutAction='FAILED'|'CANCELLED'|'RETRY'|'CORRECT'|'SETTLE';
export async function updatePayoutRequest(scope:ActorScope,input:{key:string;requestId:string;expectedRevision:number;action:PayoutAction;note?:string|null;amount?:string|null;reference?:string|null},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'EARN_PAYOUT_UPDATE',module:'FUNDS',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    const r=await tx.earnPayoutRequest.findFirst({where:{id:input.requestId,projectId:scope.projectId},include:requestInclude});if(!r)throw new ProxyDomainError('NOT_FOUND');
    if(r.revision!==input.expectedRevision)throw new ProxyDomainError('STALE_PREVIEW','Yêu cầu rút vừa được sửa; tải lại');
    const note=input.note?.trim().slice(0,500)||null,m=moneyOfRequest(r);
    if(r.consumedAt)throw new ProxyDomainError('INVALID_INPUT','Yêu cầu này đã dùng để ghi tạo lại VM; chỉ đối chiếu, không đổi trạng thái');
    const data:Prisma.EarnPayoutRequestUncheckedUpdateInput={};let what='';const kind:PayoutHistoryKind=input.action;
    if(input.action==='FAILED'||input.action==='CANCELLED'){
      if(!note)throw new ProxyDomainError('INVALID_INPUT','Ghi căn cứ (lý do) khi đánh dấu '+(input.action==='FAILED'?'thất bại':'huỷ'));
      if(r.state===input.action&&r.stateNote===note)return {id:r.id,changed:false};
      Object.assign(data,{state:input.action,stateNote:note});what=(input.action==='FAILED'?'Thất bại':'Huỷ')+': '+note;
    }else if(input.action==='RETRY'){
      if(r.state==='REQUESTED')return {id:r.id,changed:false};
      Object.assign(data,{state:'REQUESTED',stateNote:note});what='Gửi lại (cùng lượt rút)'+(note?': '+note:'');
    }else if(input.action==='CORRECT'){
      const amount=input.amount!=null?ledgerAmount(input.amount,'Số tiền yêu cầu'):r.amount,reference=input.reference!==undefined?input.reference?.trim().slice(0,200)||null:r.reference;
      if(amount.eq(r.amount)&&reference===r.reference)return {id:r.id,changed:false};
      if(!note)throw new ProxyDomainError('INVALID_INPUT','Ghi lý do khi sửa số tiền / mã tham chiếu');
      Object.assign(data,{amount,reference,settledAt:null,settledById:null,settleNote:null,shortfall:null});what='Sửa '+(amount.eq(r.amount)?'':r.amount.toFixed(2)+' → '+amount.toFixed(2)+' '+r.currency+' ')+(reference!==r.reference?'mã tham chiếu ':'')+'· '+note;
    }else{
      // Received less than asked: settled only with a stated reason (fee / shortfall); the gap is recorded, never assumed.
      if(m.phase!=='WAITING'||toCents(m.received)<=0)throw new ProxyDomainError('INVALID_INPUT','Chỉ chốt thiếu khi đã nhận một phần và còn chờ');
      if(!note)throw new ProxyDomainError('INVALID_INPUT','Ghi rõ phí / chênh lệch khi chốt nhận thiếu');
      const shortfall=D(m.remaining);Object.assign(data,{settledAt:new Date(),settledById:current.userId,settleNote:note,shortfall});what='Chốt nhận '+m.received+' '+r.currency+', thiếu '+shortfall.toFixed(2)+': '+note;
    }
    await images.remember('PAYOUT_REQUEST',r.id);
    await tx.earnPayoutRequest.update({where:{id:r.id},data:{...data,revision:{increment:1},history:[...(r.history as Prisma.JsonArray),historyEntry(current.userId,kind,what)]}});
    return {id:r.id,changed:true};
  },db);
}
// ─── Reads ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Operating state of every VM for the Server / VM grid: recorded status and round, the money milestone of the current round, and
// (only with the money rights) the amounts.
export async function readVmOps(scope:ActorScope,db:PrismaClient=prisma){
  await authorizeVM(scope,'READ',db);const {money,writeMoney,assign}=await payoutRights(scope,db);
  const [vms,users]=await Promise.all([db.virtualMachine.findMany({where:{managed:true,server:{projectId:scope.projectId,managed:true}},select:{id:true,operation:true,earnApp:{select:{id:true,payoutRequest:{include:requestInclude}}}}}),db.user.findMany({where:{memberships:{some:{projectId:scope.projectId}}},select:{id:true,name:true,username:true}})]);
  const who=(id:string|null|undefined)=>{const u=id?users.find(x=>x.id===id):null;return u?u.name||u.username||'Tài khoản cũ':null;};
  return {rights:{money,writeMoney,assign},vms:vms.map(v=>{
    const cycle=v.operation?.cycle??1,r=v.earnApp?.payoutRequest&&v.earnApp.payoutRequest.cycle===cycle&&v.earnApp.payoutRequest.vmId===v.id?v.earnApp.payoutRequest:null,m=r?moneyOfRequest(r):null;
    return {vmId:v.id,cycle,status:v.operation?.status??null,statusAt:v.operation?.statusAt?.toISOString()??null,statusBy:who(v.operation?.statusById),milestone:milestoneOf(m&&{phase:m.phase,consumed:!!r!.consumedAt}),
      request:r?{id:r.id,revision:r.revision,state:r.state,stateNote:money?r.stateNote:null,phase:m!.phase,paypalId:r.paypal.id,paypal:r.paypal.code,email:r.paypalEmail.email,emailId:r.paypalEmail.id,requestedAt:dayText(r.requestedAt),reference:money?r.reference:null,settled:!!r.settledAt,
        money:money?{amount:r.amount.toFixed(2),currency:r.currency,received:m!.received,pendingLinked:m!.pendingLinked,remaining:m!.remaining,shortfall:r.shortfall?.toFixed(2)??null,settleNote:r.settleNote}:null}:null};
  })};
}
// History of one VM position: recorded statuses, closed rounds and the payout requests of every round.
export async function readVmOpsHistory(scope:ActorScope,input:{vmId:string},db:PrismaClient=prisma){
  await authorizeVM(scope,'READ',db);const {money}=await payoutRights(scope,db);
  const vm=await db.virtualMachine.findFirst({where:{id:input.vmId,managed:true,server:{projectId:scope.projectId,managed:true}},select:{id:true}});if(!vm)throw new ProxyDomainError('NOT_FOUND');
  const [events,cycles,requests,users]=await Promise.all([db.vmOpsEvent.findMany({where:{vmId:vm.id,projectId:scope.projectId},orderBy:{createdAt:'desc'},take:200}),db.vmCycle.findMany({where:{vmId:vm.id,projectId:scope.projectId},orderBy:{number:'desc'}}),
    db.earnPayoutRequest.findMany({where:{vmId:vm.id,projectId:scope.projectId},include:{...requestInclude,earnApp:{select:{login:{select:{email:true}},closedAt:true}}},orderBy:{createdAt:'desc'}}),db.user.findMany({where:{memberships:{some:{projectId:scope.projectId}}},select:{id:true,name:true,username:true}})]);
  const who=(id:string|null|undefined)=>{const u=id?users.find(x=>x.id===id):null;return u?u.name||u.username||'Tài khoản cũ':'—';};
  const logins=await db.gmailAccount.findMany({where:{id:{in:cycles.map(c=>c.loginId).filter((x):x is string=>!!x)}},select:{id:true,email:true}});
  return {
    events:events.map(e=>({id:e.id,cycle:e.cycle,kind:e.kind,from:e.fromStatus,to:e.toStatus,note:e.note,detail:e.detail,by:who(e.actorId),at:e.createdAt.toISOString()})),
    cycles:cycles.map(c=>({number:c.number,reason:c.reason,login:logins.find(l=>l.id===c.loginId)?.email??null,sdk:c.sdkId,status:c.status,closedAt:c.closedAt.toISOString(),by:who(c.closedById),note:c.note,proxyKept:!!c.proxyKept})),
    requests:requests.map(r=>{const m=moneyOfRequest(r);return {id:r.id,cycle:r.cycle,login:r.earnApp.login.email,paypal:r.paypal.code,email:r.paypalEmail.email,requestedAt:dayText(r.requestedAt),state:r.state,phase:m.phase,consumed:!!r.consumedAt,reviewAfterRecreate:m.reviewAfterRecreate,
      history:(r.history as {at:string;by:string;kind?:string;what:string}[]).map(h=>({at:h.at,by:who(h.by),what:money?h.what:neutralHistory(h)})),money:money?{amount:r.amount.toFixed(2),currency:r.currency,received:m.received,remaining:m.remaining,receipts:r.receipts.map(x=>({date:dayText(x.date),amount:x.amount.toFixed(2),currency:x.currency,status:x.voidedAt?'Đã thu hồi':x.failed?'Không về':x.confirmed?'Đã nhận':'Chờ nhận'}))}:null};}),
  };
}
