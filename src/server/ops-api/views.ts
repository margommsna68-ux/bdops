import type {Prisma,PrismaClient} from '@prisma/client';
import {moneyOfRequest} from '../vm-ops/ops';
import {neutralHistory} from '../vm-ops/payout';
import {currentBalances} from '../vm-ops/balance';
import {currentProxyOf} from '../vm-management/proxy-change';
import {dayText} from '../business-management/money';
import {opsLabel} from '@/lib/vm-ops';
import {maskEmail,maskHost,redactSecrets} from './safety';
// Answers of the ops API (21/10/2026): every field is listed here; nothing from the database is passed through as it is. Money follows
// the same rights as the web: balances with the balance read right, payout request money with requestMoney, the PayPal book never.
// Credentials, 2FA, links and full proxies are never selected; free text goes through redactSecrets.
export interface ViewRights {balanceRead:boolean;requestMoney:boolean;payoutEmail:boolean}
type Db=PrismaClient|Prisma.TransactionClient;
const endpointSelect={id:true,host:true,port:true,groupId:true,group:{select:{name:true}},identity:{select:{owner:true,subgroup:true}}} as const;
export const vmSelect={id:true,code:true,revision:true,archivedAt:true,server:{select:{id:true,code:true,archivedAt:true}},operation:{select:{cycle:true,status:true,revision:true}},
  // Only holds still in force decide the current proxy (released ones stay as history), the same rule as Server / VM.
  earnApp:{select:{id:true,closedAt:true,login:{select:{email:true}}}},allocations:{where:{releasedAt:null},select:{endpointId:true,role:true}},
  desiredConfiguration:{select:{endpointId:true,endpoint:{select:endpointSelect}}},installedConfiguration:{select:{endpointId:true,endpoint:{select:endpointSelect}}}} as const;
type VmRow=Prisma.VirtualMachineGetPayload<{select:typeof vmSelect}>;
type EndpointRow=Prisma.ProxyIPGetPayload<{select:typeof endpointSelect}>;
const groupOf=(e:EndpointRow)=>e.identity?.owner==='GENJY'?(e.identity.subgroup==='PC_CHUNG'?'Chung mooon–Genjy':'Genjy riêng'):e.groupId?e.group?.name??'Nhóm khác':'TUT';
export function proxyView(vm:VmRow){
  const c=currentProxyOf({desiredConfiguration:vm.desiredConfiguration,installedConfiguration:vm.installedConfiguration,allocations:vm.allocations});
  if(c.review)return {state:'REVIEW' as const,proxy:null};
  const e=[vm.desiredConfiguration?.endpoint,vm.installedConfiguration?.endpoint].find(x=>x&&x.id===c.endpointId);
  return e?{state:'ASSIGNED' as const,proxy:{id:e.id,host:maskHost(e.host),port:e.port,group:groupOf(e)}}:{state:'MISSING' as const,proxy:null};
}
export function vmView(vm:VmRow){
  const ea=vm.earnApp&&!vm.earnApp.closedAt?vm.earnApp:null,p=proxyView(vm);
  return {id:vm.id,code:vm.code,serverId:vm.server.id,serverCode:vm.server.code,deleted:!!vm.archivedAt||!!vm.server.archivedAt,status:vm.operation?.status??null,statusLabel:vm.operation?.status?opsLabel(vm.operation.status):'Chưa ghi',
    expectedCycle:vm.operation?.cycle??1,revision:vm.revision,proxyState:p.state,proxy:p.proxy,earnAppAccount:ea?{id:ea.id,login:maskEmail(ea.login.email)}:null};
}
export const requestSelect={id:true,revision:true,vmId:true,cycle:true,earnAppId:true,paypalId:true,paypalEmailId:true,currency:true,amount:true,requestedAt:true,state:true,stateNote:true,submission:true,submittedAt:true,settledAt:true,shortfall:true,consumedAt:true,history:true,createdAt:true,
  paypal:{select:{code:true}},paypalEmail:{select:{email:true}},earnApp:{select:{vmId:true,closedAt:true}},
  receipts:{select:{id:true,amount:true,currency:true,confirmed:true,failed:true,voidedAt:true,date:true,noTxId:true,transactionId:true,createdAt:true}}} as const;
type RequestRow=Prisma.EarnPayoutRequestGetPayload<{select:typeof requestSelect}>;
const SUBMISSION:Record<string,string>={PREPARING:'PREPARING',SENT:'SUBMITTED_ON_EARNAPP',UNKNOWN:'UNKNOWN_RESULT'};
export function withdrawalView(r:RequestRow,rights:ViewRights,opts:{currentCycle?:number|null;history?:boolean}={}){
  const m=moneyOfRequest(r),current=r.earnApp.vmId===r.vmId&&!r.earnApp.closedAt&&(opts.currentCycle==null||opts.currentCycle===r.cycle);
  const money=rights.requestMoney;
  return {id:r.id,revision:r.revision,vmId:r.vmId,cycle:r.cycle,earnAppAccountId:r.earnAppId,current,paypalId:r.paypalId,paypalCode:r.paypal.code,paypalEmailId:r.paypalEmailId,
    paypalEmail:rights.payoutEmail?r.paypalEmail.email:maskEmail(r.paypalEmail.email),requestedOn:dayText(r.requestedAt),state:r.state,submission:SUBMISSION[r.submission]??r.submission,submittedAt:r.submittedAt?.toISOString()??null,
    phase:m.phase,settled:!!r.settledAt,consumed:!!r.consumedAt,
    money:money?{currency:r.currency,requested:r.amount.toFixed(2),received:m.received,pendingLinked:m.pendingLinked,remaining:m.remaining,shortfall:r.shortfall?.toFixed(2)??null}:null,
    note:money?redactSecrets(r.stateNote):null,
    ...(opts.history?{
      receipts:money?r.receipts.map(x=>({id:x.id,amount:x.amount.toFixed(2),currency:x.currency,receivedOn:dayText(x.date),transactionId:x.noTxId?null:x.transactionId,status:x.voidedAt?'VOIDED':x.failed?'FAILED':x.confirmed?'RECEIVED':'PENDING',recordedAt:x.createdAt.toISOString()})):null,
      history:(r.history as {at:string;kind?:string;what:string;observedAt?:string}[]).map(h=>({recordedAt:h.at,observedAt:h.observedAt??null,kind:h.kind??null,text:money?redactSecrets(h.what):neutralHistory(h)})),
    }:{}),
  };
}
export async function balanceView(db:Db,projectId:string,vm:{id:string;cycle:number;earnAppId:string|null},read:boolean){
  const b=(await currentBalances(db as PrismaClient,projectId,[vm],read)).get(vm.id)??{latest:null,lastOk:null};
  const one=(c:typeof b.latest)=>c&&{status:c.outcome==='OK'?'OK':'ERROR',amount:c.amount,currency:c.currency,withdrawable:c.withdrawable==='YES'?true:c.withdrawable==='NO'?false:null,checkedAt:c.checkedAt,errorMessage:redactSecrets(c.failure??null),noteHidden:!!c.noteHidden};
  return {latest:one(b.latest),lastOk:one(b.lastOk),amountsVisible:read};
}
// The balance as one recorded check left it: that VM, round and EarnApp, checks recorded up to it (a newer check, or another account's,
// never changes this acknowledgement).
export async function balanceAsOf(db:Db,projectId:string,rec:{vmId:string;cycle:number;earnAppId:string;recordedAt:string},read:boolean){
  const rows=await db.earnBalanceCheck.findMany({where:{projectId,vmId:rec.vmId,cycle:rec.cycle,earnAppId:rec.earnAppId,recordedAt:{lte:new Date(rec.recordedAt)}},orderBy:[{checkedAt:'desc'},{recordedAt:'desc'}],take:50});
  const one=(c:typeof rows[number]|undefined)=>c?{status:c.outcome==='OK'?'OK':'ERROR',amount:read&&c.amount?c.amount.toFixed(2):null,currency:c.currency,withdrawable:c.withdrawable==='YES'?true:c.withdrawable==='NO'?false:null,checkedAt:c.checkedAt.toISOString(),errorMessage:read?redactSecrets(c.failure):null,noteHidden:!read&&!!(c.failure||c.condition)}:null;
  return {latest:one(rows[0]),lastOk:one(rows.find(r=>r.outcome==='OK')),amountsVisible:read};
}
