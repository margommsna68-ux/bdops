import {Prisma,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {loadInfrastructureScope} from '../permissions/infrastructure';
import {runBusinessCommand,type BusinessCollector} from './idempotency';
import {assertBusinessArea} from './scope';
import {assertPeriodOpen} from './period-lock';
import {dayDate,dayText} from './money';
import {LEDGER_CURRENCY} from './types';
import {isEmail} from '../account-store/parse';
import {checkTransfer,moneyCents,centsText} from '@/lib/paypal-transfer';
import {parseMoneyNumber} from '@/lib/money-input';
// PayPal ledger (18/10/2026). One book for money on the PayPal accounts, the same rows as Tiền vào PayPal (FundTransaction) and
// Rút / chuyển (Withdrawal); Kho tài khoản reads it, nothing is copied into a second book.
// - Money in = money actually received from outside (RECEIPT, status "đã nhận") + internal transfers in (the amount the receiving
//   side actually got). Pending, failed and voided rows never count. EarnApp income = RECEIPT only (internal transfers excluded).
// - Money out = the total the PayPal was debited (ledgerVersion 2: amount, fee included; the fee is never subtracted again).
// - Balance by the book = opening + in − out, per currency (exact decimals, codes never added together). It is the book, not the
//   balance PayPal's website shows.
// - Older rows (ledgerVersion 1) are kept as recorded: out = amount. Internal transfers without a received amount and rows with a
//   collector fee whose meaning is not certain are flagged for reconciliation; nothing is rewritten.
// - An EarnApp withdrawal request (EarnWithdrawal) is a different moment; it is never added to the money received here.
const D=(v:Prisma.Decimal.Value)=>new Prisma.Decimal(v);
const ZERO=()=>D(0);
export function ledgerAmount(text:string,label='Số tiền'){
  // US number format (owner decision 28/10/2026): "." decimal point, "," optional thousands separator ("1,234.56").
  const t=text.trim().replace(/\s/g,'');if(/^[\d.,]+$/.test(t)){const p=parseMoneyNumber(t,{fraction:2});if(p.error)throw new ProxyDomainError('INVALID_INPUT',label+': '+p.error);}
  const norm=t.replace(/,/g,'');
  if(!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(norm)||D(norm).lte(0))throw new ProxyDomainError('INVALID_INPUT',label+' phải là số dương, tối đa 2 chữ số thập phân');
  return D(norm);
}
const currencyOf=(c:string)=>{const v=c.trim().toUpperCase();if(!LEDGER_CURRENCY.test(v))throw new ProxyDomainError('INVALID_INPUT','Đồng tiền là mã 3–5 chữ cái (USD, USDT, VND…)');return v;};
function rights(scope:ActorScope){const can=(a:'FUNDS'|'WITHDRAWALS',w=false)=>{try{assertBusinessArea(scope,a,w);return true;}catch{return false;}};return {funds:can('FUNDS'),withdrawals:can('WITHDRAWALS'),writeFunds:can('FUNDS',true)&&['ADMIN','MODERATOR'].includes(scope.role),writeWithdrawals:can('WITHDRAWALS',true)&&['ADMIN','MODERATOR'].includes(scope.role)};}
export async function ledgerRights(scope:ActorScope,db:PrismaClient=prisma){const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);return rights(current);}
// ─── Receipts: "Email | Số tiền | Mã giao dịch" for one PayPal ───────────────────────────────────────────────────────────────
export interface ReceiptLine {line:number;email:string;amount:string|null;transactionId:string|null;error:string|null}
export function parseReceiptLines(text:string):ReceiptLine[]{
  const out:ReceiptLine[]=[];
  for(const [i,raw] of text.replace(/\r/g,'').split('\n').entries()){
    if(!raw.trim())continue;
    // Tab or | keep every cell in its place, so an empty amount stays empty and the payment id is never read as the amount; only
    // separators at the very end are ignored. Without tab or |, cells are separated by spaces (an empty cell cannot be written).
    const sep=raw.includes('\t')?'\t':raw.includes('|')?'|':null,c=sep?raw.split(sep).map(x=>x.trim()):raw.trim().split(/\s+/);
    if(sep)while(c.length>1&&!c[c.length-1])c.pop();
    if(!out.length&&/^email$/i.test(c[0]||''))continue;
    const email=(c[0]||'').toLowerCase();let amount:string|null=null,error:string|null=null;
    if(!isEmail(email))error=c[0]?'Cột 1 phải là email nhận tiền':'Cột 1 (email) đang trống';
    else if(c.length>3)error='Thừa cột: mỗi dòng Email | Số tiền | Mã giao dịch (nếu có)';
    else if(c.length<2)error='Thiếu số tiền (cột 2)';
    else if(!c[1])error='Ô số tiền (cột 2) đang trống'+(c[2]?'; cột 3 là mã giao dịch, không dùng làm số tiền':'');
    else{try{amount=ledgerAmount(c[1]).toFixed(2);}catch(e){error=(e as Error).message;}}
    const tx=c[2]||null;if(!error&&tx&&tx.length>160)error='Mã giao dịch quá dài';
    out.push({line:i+1,email,amount,transactionId:tx,error});
  }
  return out;
}
export interface ReceiptInput {paypalId:string;date:string;currency:string;status:'RECEIVED'|'PENDING';text:string;distinct?:number[]}
type Db=Prisma.TransactionClient|PrismaClient;
async function classifyReceipts(db:Db,scope:ActorScope,input:ReceiptInput){
  if(input.text.length>200000)throw new ProxyDomainError('INVALID_INPUT','Tối đa 1000 dòng mỗi lần');
  const date=dayDate(input.date),currency=currencyOf(input.currency),lines=parseReceiptLines(input.text);
  if(!lines.length||lines.length>1000)throw new ProxyDomainError('INVALID_INPUT','Dán từ 1 đến 1000 dòng: Email | Số tiền | Mã giao dịch');
  const pp=await db.payPalAccount.findFirst({where:{id:input.paypalId,projectId:scope.projectId},select:{id:true,code:true,archivedAt:true}});if(!pp||pp.archivedAt)throw new ProxyDomainError('NOT_FOUND','PayPal không còn trong kho');
  const emails=await db.payPalEmail.findMany({where:{paypalId:pp.id,projectId:scope.projectId},select:{id:true,email:true,earnApp:{select:{id:true,vmId:true,vm:{select:{serverId:true}},payoutRequest:{select:{id:true,paypalEmailId:true,state:true,requestedAt:true,submission:true}}}}}}),byEmail=new Map(emails.map(e=>[e.email.toLowerCase(),e]));
  const ids=lines.map(l=>l.transactionId).filter((x):x is string=>!!x);
  const [usedIds,sameDay]=await Promise.all([ids.length?db.fundTransaction.findMany({where:{projectId:scope.projectId,transactionId:{in:ids}},select:{transactionId:true,date:true,paypal:{select:{code:true}}}}):Promise.resolve([]),
    db.fundTransaction.findMany({where:{projectId:scope.projectId,paypalId:pp.id,voidedAt:null,date,currency,entryKind:'RECEIPT'},select:{paypalEmailId:true,amount:true,transactionId:true,noTxId:true}})]);
  const idTaken=new Map(usedIds.map(u=>[u.transactionId,u])),distinct=new Set(input.distinct||[]),seen=new Map<string,number>(),seenKey=new Map<string,number>();
  const rows=lines.map(l=>{
    const base={line:l.line,email:l.email,amount:l.amount,transactionId:l.transactionId,emailId:null as string|null};
    if(l.error)return {...base,outcome:'ERROR' as const,message:l.error};
    const e=byEmail.get(l.email);if(!e)return {...base,outcome:'ERROR' as const,message:'Email không thuộc PP '+pp.code+' (Bổ sung email vào PP trước nếu đúng)'};
    if(l.transactionId){
      const t=idTaken.get(l.transactionId);if(t)return {...base,emailId:e.id,outcome:'ERROR' as const,message:'Mã giao dịch đã ghi ngày '+dayText(t.date)+' (PP '+t.paypal.code+'); một giao dịch chỉ ghi một lần'};
      const again=seen.get(l.transactionId);if(again)return {...base,emailId:e.id,outcome:'ERROR' as const,message:'Mã giao dịch lặp với dòng '+again};seen.set(l.transactionId,l.line);
    }
    // Same email, day and amount as a recorded payment or an earlier line, without a payment id to tell them apart: a possible
    // duplicate to reconcile at the line. Never decided automatically; the person confirms "khoản riêng" if it is a separate one.
    const key=e.id+'|'+l.amount,earlier=seenKey.get(key);seenKey.set(key,earlier??l.line);
    const recorded=sameDay.find(f=>f.paypalEmailId===e.id&&f.amount.toFixed(2)===l.amount&&(!l.transactionId||f.noTxId));
    if((recorded||earlier)&&!distinct.has(l.line))return {...base,emailId:e.id,outcome:'SUSPECT' as const,message:(recorded?'Đã có khoản cùng email, cùng ngày, cùng số tiền':'Giống dòng '+earlier+' (cùng email, số tiền)')+'; nếu là khoản riêng thì bấm "Khoản riêng"'};
    return {...base,emailId:e.id,outcome:'READY' as const,message:(recorded||earlier)?'Đã xác nhận là khoản riêng':e.earnApp?'Hợp lệ':'Hợp lệ · email chưa gán EarnApp (không tự gán)'};
  });
  return {pp,date,currency,rows,byEmail};
}
const receiptSummary=<T extends {outcome:string;amount:string|null}>(rows:T[])=>({ready:rows.filter(r=>r.outcome==='READY').length,suspect:rows.filter(r=>r.outcome==='SUSPECT').length,errors:rows.filter(r=>r.outcome==='ERROR').length,total:rows.filter(r=>r.outcome==='READY').reduce((a,r)=>a.plus(r.amount!),ZERO()).toFixed(2)});
// Check only (typing / pasting): nothing is written.
export async function checkReceipts(scope:ActorScope,input:ReceiptInput,db:PrismaClient=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);if(!rights(current).writeFunds)throw new ProxyDomainError('FORBIDDEN');
  const r=await classifyReceipts(db,current,input);return {rows:r.rows.map(({emailId:_e,...x})=>x),...receiptSummary(r.rows),currency:r.currency};
}
// Record: every line is checked again inside the transaction; only READY lines are written, the others are returned to fix.
export async function recordReceipts(scope:ActorScope,input:ReceiptInput&{key:string},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'PAYPAL_RECEIPTS',module:'FUNDS',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    if(!rights(current).writeFunds)throw new ProxyDomainError('FORBIDDEN');
    const r=await classifyReceipts(tx,current,input);await assertPeriodOpen(tx,scope.projectId,r.date,r.currency);
    const ready=r.rows.filter(x=>x.outcome==='READY');
    if(ready.length){await images.remember('PAYPAL',r.pp.id);await tx.payPalAccount.update({where:{id:r.pp.id},data:{revision:{increment:1}}});}
    const bumped=new Set<string>();
    for(const row of ready){
      const e=r.byEmail.get(row.email)!;
      // The payment keeps the EarnApp / VM using this email at the time it is recorded (none = not assigned; nothing is assigned).
      // Money for the payout request of that EarnApp through this same email, on or after the request day, belongs to it (that is
      // the evidence: same EarnApp, same email). Anything else stays unlinked; nothing is matched later by guessing.
      const req=e.earnApp?.payoutRequest,payoutRequestId=req&&req.paypalEmailId===e.id&&req.state!=='CANCELLED'&&req.submission==='SENT'&&r.date>=dayDate(dayText(req.requestedAt))?req.id:null; // only a request really sent on EarnApp takes money (20/10/2026)
      const f=await tx.fundTransaction.create({data:{payoutRequestId,projectId:scope.projectId,date:r.date,amount:D(row.amount!),currency:r.currency,transactionId:row.transactionId||'WEB-'+input.key+'-'+row.line,noTxId:!row.transactionId,confirmed:input.status==='RECEIVED',failed:false,company:'',paypalId:r.pp.id,paypalEmailId:e.id,earnAppId:e.earnApp?.id??null,vmId:e.earnApp?.vmId??null,serverId:e.earnApp?.vm?.serverId??null,entryKind:'RECEIPT',distinctConfirmed:(input.distinct||[]).includes(row.line),businessManaged:true,createdById:scope.userId}});
      await images.remember('FUND',f.id,true);
      // A payment on an email is a use that later undo of its first assignment must not erase.
      if(!bumped.has(e.id)){bumped.add(e.id);await images.remember('PAYPAL_EMAIL',e.id);await tx.payPalEmail.update({where:{id:e.id},data:{revision:{increment:1}}});}
    }
    return {rows:r.rows.map(({emailId:_e,...x})=>({...x,outcome:x.outcome==='READY'?'APPLIED' as const:x.outcome})),saved:ready.length,...receiptSummary(r.rows),code:r.pp.code};
  },db);
}
// Opening balance of a PayPal (money already there when the book starts): counted in the balance, never as EarnApp income.
export async function recordOpening(scope:ActorScope,input:{paypalId:string;date:string;currency:string;amount:string;notes?:string;key:string},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'PAYPAL_OPENING',module:'FUNDS'},async(tx,images,current)=>{
    if(!rights(current).writeFunds)throw new ProxyDomainError('FORBIDDEN');
    const pp=await tx.payPalAccount.findFirst({where:{id:input.paypalId,projectId:scope.projectId,archivedAt:null}});if(!pp)throw new ProxyDomainError('NOT_FOUND');
    const date=dayDate(input.date),currency=currencyOf(input.currency),amount=ledgerAmount(input.amount,'Số dư đầu');await assertPeriodOpen(tx,scope.projectId,date,currency);
    if(await tx.fundTransaction.findFirst({where:{projectId:scope.projectId,paypalId:pp.id,currency,entryKind:'OPENING',voidedAt:null},select:{id:true}}))throw new ProxyDomainError('INVALID_INPUT','PP '+pp.code+' đã có số dư đầu '+currency+'; thu hồi khoản cũ nếu cần ghi lại');
    const f=await tx.fundTransaction.create({data:{projectId:scope.projectId,date,amount,currency,transactionId:'OPEN-'+input.key,noTxId:true,confirmed:true,company:'',paypalId:pp.id,entryKind:'OPENING',notes:input.notes?.slice(0,2000)||null,businessManaged:true,createdById:scope.userId}});
    await images.remember('FUND',f.id,true);await images.remember('PAYPAL',pp.id);await tx.payPalAccount.update({where:{id:pp.id},data:{revision:{increment:1}}});
    return {id:f.id};
  },db);
}
// ─── Transfers / withdrawals ───────────────────────────────────────────────────────────────────────────────────────────────
export interface TransferInput {paypalId:string;type:'EXCHANGE'|'MIXING';date:string;currency:string;debited:string;fee?:string|null;destPaypalId?:string|null;received?:string|null;receivedCurrency?:string|null;rate?:string|null;receiverFee?:string|null;transactionId?:string|null;notes?:string|null;distinct?:boolean}
// The amounts must add up by the one rule in lib/paypal-transfer.ts (the form uses it too): received =
// round_half_up((debited − fee) × rate, 2) − receiver fee. "All positive" is not enough; the first wrong field is reported.
function transferShape(input:TransferInput){
  const currency=currencyOf(input.currency),receivedCurrency=input.received?.trim()||input.type==='MIXING'?currencyOf(input.receivedCurrency||currency):null;
  if(input.receiverFee?.trim()&&!input.received?.trim())throw new ProxyDomainError('INVALID_INPUT','Phí bên nhận chỉ ghi khi có số bên nhận thực nhận');
  const c=checkTransfer({type:input.type,currency,receivedCurrency,debited:input.debited,fee:input.fee,received:input.received,rate:input.rate,receiverFee:input.receiverFee});
  const first=(['debited','fee','rate','receiverFee','received'] as const).map(k=>c.errors[k]).find(Boolean);if(first)throw new ProxyDomainError('INVALID_INPUT',first);
  if(input.transactionId&&input.transactionId.trim().length>160||input.notes&&input.notes.length>2000)throw new ProxyDomainError('INVALID_INPUT','Mã giao dịch / ghi chú quá dài');
  const cents=(v:string|null|undefined,label:string)=>v?.trim()?D(centsText(moneyCents(v,label,true) as bigint)):null;
  const debited=ledgerAmount(input.debited,'Tổng PP bị trừ'),fee=cents(input.fee,'Phí'),received=cents(input.received,'Số bên nhận'),receiverFee=received?cents(input.receiverFee,'Phí bên nhận'):null;
  const rate=received&&receivedCurrency!==currency?D(input.rate!.trim().replace(/\s/g,'').replace(/,/g,'')):null;
  return {currency,debited,fee,received,receivedCurrency:received?receivedCurrency:null,rate,receiverFee};
}
export async function recordTransfer(scope:ActorScope,input:TransferInput&{key:string},db:PrismaClient=prisma){
  return runBusinessCommand(scope,{key:input.key,payload:input,kind:'PAYPAL_TRANSFER',module:'WITHDRAWALS'},async(tx,images,current)=>{
    if(!rights(current).writeWithdrawals)throw new ProxyDomainError('FORBIDDEN');
    const s=transferShape(input),date=dayDate(input.date);
    const pp=await tx.payPalAccount.findFirst({where:{id:input.paypalId,projectId:scope.projectId,archivedAt:null}});if(!pp)throw new ProxyDomainError('NOT_FOUND','PayPal nguồn không còn trong kho');
    let dest:{id:string}|null=null;
    if(input.type==='MIXING'){if(!input.destPaypalId||input.destPaypalId===pp.id)throw new ProxyDomainError('INVALID_INPUT','Chuyển nội bộ cần PP nhận khác PP nguồn');dest=await tx.payPalAccount.findFirst({where:{id:input.destPaypalId,projectId:scope.projectId,archivedAt:null},select:{id:true}});if(!dest)throw new ProxyDomainError('NOT_FOUND','PP nhận không còn trong kho');}
    else if(input.destPaypalId)throw new ProxyDomainError('INVALID_INPUT','Rút ra ngoài không chọn PP nhận trong kho; chọn Chuyển nội bộ nếu tiền sang PP khác');
    await assertPeriodOpen(tx,scope.projectId,date,s.currency);if(s.receivedCurrency&&s.receivedCurrency!==s.currency)await assertPeriodOpen(tx,scope.projectId,date,s.receivedCurrency);
    const transactionId=input.transactionId?.trim()||null;
    if(transactionId&&await tx.withdrawal.findFirst({where:{projectId:scope.projectId,transactionId},select:{id:true}}))throw new ProxyDomainError('INVALID_INPUT','Mã giao dịch rút/chuyển đã ghi; một giao dịch chỉ ghi một lần');
    if(!transactionId&&!input.distinct&&await tx.withdrawal.findFirst({where:{projectId:scope.projectId,sourcePaypalId:pp.id,date,currency:s.currency,amount:s.debited,voidedAt:null},select:{id:true}}))throw new ProxyDomainError('INVALID_INPUT','Đã có khoản rút/chuyển cùng PP, cùng ngày, cùng số tiền. Nếu là khoản riêng, chọn "Đây là khoản riêng" rồi lưu');
    await images.remember('PAYPAL',pp.id);await tx.payPalAccount.update({where:{id:pp.id},data:{revision:{increment:1}}});
    if(dest){await images.remember('PAYPAL',dest.id);await tx.payPalAccount.update({where:{id:dest.id},data:{revision:{increment:1}}});}
    // One row = one event: the debit of the source and, for an internal transfer, what the receiving PayPal actually got.
    const w=await tx.withdrawal.create({data:{projectId:scope.projectId,date,amount:s.debited,currency:s.currency,feeAmount:s.fee,receivedAmount:s.received,receivedCurrency:s.received?s.receivedCurrency:null,fxRate:s.rate,receiverFeeAmount:s.receiverFee,type:input.type,sourcePaypalId:pp.id,destPaypalId:dest?.id??null,transactionId:transactionId||'WEB-'+input.key,noTxId:!transactionId,paidToTeam:false,notes:input.notes?.trim()||null,ledgerVersion:2,businessManaged:true}});
    await images.remember('WITHDRAWAL',w.id,true);
    return {id:w.id};
  },db);
}
// ─── Reading the book ──────────────────────────────────────────────────────────────────────────────────────────────────────
type Money=Record<string,Prisma.Decimal>;
const add=(m:Money,c:string,v:Prisma.Decimal)=>{m[c]=(m[c]||ZERO()).plus(v);};
const text=(m:Money)=>Object.fromEntries(Object.entries(m).filter(([,v])=>!v.isZero()).map(([k,v])=>[k,v.toFixed(2)]));
// v1 rows whose meaning is not certain (see header): listed for reconciliation, still counted as recorded.
export function withdrawalReview(w:{ledgerVersion:number;type:string;paypalFee:Prisma.Decimal|null;agentUserId:string|null}){
  if(w.ledgerVersion>=2)return null;
  if(w.type==='MIXING')return 'Chuyển nội bộ ghi trước 18/10: chưa rõ số bên nhận thực nhận (tạm tính bằng số tiền ghi)';
  if(w.paypalFee&&!w.agentUserId)return 'Khoản cũ có phí: chưa rõ phí đã nằm trong số tiền ghi hay chưa';
  return null;
}
// Per PayPal and currency: opening (before the month, plus opening entries), in (receipts / internal), out, balance at the end.
// Without month: the whole book up to today. Amounts a member may not read are null (never zeros), and the balance needs both.
// One range for the totals and for the list behind them: a month (its first to last day; earlier rows become the opening), or
// everything up to a cut-off day (stated, or today in Asia/Bangkok). Rows after the cut-off day are in neither.
export function ledgerRange(input:{month?:string|null;asOf?:string|null}){
  const month=input.month&&/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)?input.month:null;
  const end=month?(()=>{const [y,m]=month.split('-').map(Number);return dayDate(month+'-'+String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0'));})():dayDate(input.asOf&&/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)?input.asOf:dayText(new Date()));
  return {month,start:month?dayDate(month+'-01'):null,end,until:new Date(end.getTime()+86400000),asOf:dayText(end)};
}
export async function readPaypalLedger(scope:ActorScope,input:{month?:string|null;asOf?:string|null},db:PrismaClient=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId),r=rights(current);
  if(current.businessMode!=='PROXY_VM'||!r.funds&&!r.withdrawals)return {rights:r,asOf:null,month:null,paypals:[],emails:[],totals:null};
  return bookOf(db,scope.projectId,r,input);
}
/** USD balance by the book of every PayPal (up to today). Only for the payout suggestion of a member with a payout right, who
 *  receives the suggestion and the projected figure of the suggested PayPal, never the book itself. */
export async function bookUsdBalances(db:PrismaClient,projectId:string){
  const book=await bookOf(db,projectId,{funds:true,withdrawals:true,writeFunds:false,writeWithdrawals:false},{});
  return new Map(book.paypals.map(p=>[p.paypalId,p.currencies.find(c=>c.currency==='USD')?.balance??'0.00']));
}
async function bookOf(db:PrismaClient,projectId:string,r:ReturnType<typeof rights>,input:{month?:string|null;asOf?:string|null}){
  const {month,start,end,until}=ledgerRange(input);
  const [funds,outs]=await Promise.all([
    r.funds?db.fundTransaction.findMany({where:{projectId,voidedAt:null,confirmed:true,failed:false,date:{lt:until}},select:{paypalId:true,paypalEmailId:true,amount:true,currency:true,date:true,entryKind:true}}):Promise.resolve([]),
    r.withdrawals?db.withdrawal.findMany({where:{projectId,voidedAt:null,date:{lt:until}},select:{sourcePaypalId:true,destPaypalId:true,amount:true,currency:true,date:true,type:true,receivedAmount:true,receivedCurrency:true,ledgerVersion:true,paypalFee:true,agentUserId:true}}):Promise.resolve([]),
  ]);
  type Acc={opening:Money;receipts:Money;internalIn:Money;out:Money;review:number};
  const per=new Map<string,Acc>(),acc=(id:string)=>{let a=per.get(id);if(!a){a={opening:{},receipts:{},internalIn:{},out:{},review:0};per.set(id,a);}return a;};
  const before=(d:Date)=>!!start&&d<start,emailIn=new Map<string,Money>(),unknown=new Map<string,Money>();
  const total={receipts:{} as Money,internal:{} as Money,out:{} as Money};
  for(const f of funds){
    const a=acc(f.paypalId),amt=D(f.amount);
    if(f.entryKind==='OPENING'||before(f.date)){add(a.opening,f.currency,amt);continue;}
    add(a.receipts,f.currency,amt);add(total.receipts,f.currency,amt);
    if(f.paypalEmailId){const m=emailIn.get(f.paypalEmailId)||{};add(m,f.currency,amt);emailIn.set(f.paypalEmailId,m);}else{const m=unknown.get(f.paypalId)||{};add(m,f.currency,amt);unknown.set(f.paypalId,m);}
  }
  for(const w of outs){
    const src=acc(w.sourcePaypalId),amt=D(w.amount),old=before(w.date);
    if(withdrawalReview(w))src.review++;
    if(old)add(src.opening,w.currency,amt.neg());else{add(src.out,w.currency,amt);add(total.out,w.currency,amt);}
    if(w.type==='MIXING'&&w.destPaypalId){
      const dst=acc(w.destPaypalId),inAmt=w.receivedAmount?D(w.receivedAmount):amt,inCur=w.receivedAmount?w.receivedCurrency||w.currency:w.currency;
      if(old)add(dst.opening,inCur,inAmt);else{add(dst.internalIn,inCur,inAmt);add(total.internal,inCur,inAmt);}
    }
  }
  const both=r.funds&&r.withdrawals;
  const paypals=[...per.entries()].map(([paypalId,a])=>{
    const cur=new Set([...Object.keys(a.opening),...Object.keys(a.receipts),...Object.keys(a.internalIn),...Object.keys(a.out)]);
    const rows=[...cur].sort().map(c=>{const opening=a.opening[c]||ZERO(),inn=(a.receipts[c]||ZERO()).plus(a.internalIn[c]||ZERO()),out=a.out[c]||ZERO();
      return {currency:c,receipts:r.funds?(a.receipts[c]||ZERO()).toFixed(2):null,internalIn:r.withdrawals?(a.internalIn[c]||ZERO()).toFixed(2):null,in:both?inn.toFixed(2):null,out:r.withdrawals?out.toFixed(2):null,opening:both?opening.toFixed(2):null,balance:both?opening.plus(inn).minus(out).toFixed(2):null};});
    return {paypalId,currencies:rows,review:a.review,unknownEmail:r.funds?text(unknown.get(paypalId)||{}):null};
  });
  return {rights:r,asOf:dayText(end),month,paypals,emails:r.funds?[...emailIn.entries()].map(([emailId,m])=>({emailId,received:text(m)})):[],
    totals:{earnApp:r.funds?text(total.receipts):null,internal:r.withdrawals?text(total.internal):null,out:r.withdrawals?text(total.out):null}};
}
// The rows behind one number of one PayPal (Tiền vào = receipts + internal in; Tiền ra = debits), in exactly the range of that
// number (ledgerRange). Rows shown for reconciliation but not added up (pending, failed, voided, the opening balance) carry
// counted=false and their role; `totals` adds up only the counted rows, so it equals the number that was clicked.
type EntryRow={kind:'RECEIPT'|'OPENING'|'INTERNAL_IN'|'OUT';id:string;date:string;amount:string;currency:string;email:string|null;place:string|null;other:string|null;fee:string|null;received:string|null;status:string;transactionId:string|null;review:string|null;counted:boolean;role:string|null};
export async function readPaypalEntries(scope:ActorScope,input:{paypalId:string;direction:'IN'|'OUT';month?:string|null;asOf?:string|null;currency?:string|null},db:PrismaClient=prisma){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId),r=rights(current);
  if(current.businessMode!=='PROXY_VM'||input.direction==='OUT'&&!r.withdrawals||input.direction==='IN'&&!r.funds&&!r.withdrawals)throw new ProxyDomainError('FORBIDDEN');
  const {month,start,until,asOf}=ledgerRange(input),range=start?{gte:start,lt:until}:{lt:until};
  const pp=await db.payPalAccount.findFirst({where:{id:input.paypalId,projectId:scope.projectId},select:{id:true,code:true}});if(!pp)throw new ProxyDomainError('NOT_FOUND');
  const cur=input.currency?currencyOf(input.currency):undefined,rows:EntryRow[]=[];let later=0;
  const fundWhere={projectId:scope.projectId,paypalId:pp.id,...(cur?{currency:cur}:{})},wWhere={projectId:scope.projectId,...(input.direction==='OUT'?{sourcePaypalId:pp.id}:{destPaypalId:pp.id,type:'MIXING' as const})};
  if(input.direction==='IN'&&r.funds){
    const funds=await db.fundTransaction.findMany({where:{...fundWhere,date:range},orderBy:[{date:'desc'},{createdAt:'desc'}],include:{paypalEmail:{select:{email:true}},vm:{select:{code:true,server:{select:{code:true}}}}}});
    for(const f of funds){
      const role=f.entryKind==='OPENING'?'Số dư đầu kỳ: tính vào Còn lại theo sổ, không tính vào Tiền vào':f.voidedAt?'Đã thu hồi: không cộng':f.failed?'Không về: không cộng':!f.confirmed?'Chờ nhận: không cộng':null;
      rows.push({kind:f.entryKind==='OPENING'?'OPENING':'RECEIPT',id:f.id,date:dayText(f.date),amount:f.amount.toFixed(2),currency:f.currency,email:f.paypalEmail?.email??null,place:f.vm?f.vm.server.code+' / '+f.vm.code:null,other:null,fee:null,received:null,status:f.voidedAt?'Đã thu hồi':f.failed?'Không về':f.entryKind==='OPENING'?'Số dư đầu':f.confirmed?'Đã nhận':'Chờ nhận',transactionId:f.noTxId?null:f.transactionId,review:null,counted:!role,role});
    }
    if(!month)later+=await db.fundTransaction.count({where:{...fundWhere,date:{gte:until}}});
  }
  if(r.withdrawals){
    const ws=await db.withdrawal.findMany({where:{...wWhere,date:range},orderBy:[{date:'desc'},{createdAt:'desc'}],include:{sourcePaypal:{select:{code:true}},destPaypal:{select:{code:true}}}});
    for(const w of ws){
      const inside=input.direction==='IN',amount=inside?(w.receivedAmount?w.receivedAmount.toFixed(2):w.amount.toFixed(2)):w.amount.toFixed(2),currency=inside?(w.receivedAmount?w.receivedCurrency||w.currency:w.currency):w.currency;
      if(cur&&currency!==cur)continue;
      const fees=[w.feeAmount?.toFixed(2)??w.paypalFee?.toFixed(2)??null,w.receiverFeeAmount?'bên nhận '+w.receiverFeeAmount.toFixed(2)+' '+(w.receivedCurrency||w.currency):null].filter(Boolean).join(' · ')||null;
      rows.push({kind:inside?'INTERNAL_IN':'OUT',id:w.id,date:dayText(w.date),amount,currency,email:null,place:null,other:inside?w.sourcePaypal.code:w.destPaypal?.code??null,fee:inside?null:fees,received:inside?null:w.receivedAmount?w.receivedAmount.toFixed(2)+' '+(w.receivedCurrency||w.currency):null,status:w.voidedAt?'Đã thu hồi':w.type==='MIXING'?'Chuyển nội bộ':'Rút / chuyển ra',transactionId:w.noTxId?null:w.transactionId,review:withdrawalReview(w),counted:!w.voidedAt,role:w.voidedAt?'Đã thu hồi: không cộng':null});
    }
    if(!month)later+=await db.withdrawal.count({where:{...wWhere,date:{gte:until}}});
  }
  rows.sort((a,b)=>b.date.localeCompare(a.date));
  const sum:Money={};for(const x of rows)if(x.counted)add(sum,x.currency,D(x.amount));
  return {code:pp.code,month,asOf,rows,totals:Object.fromEntries(Object.entries(sum).map(([k,v])=>[k,v.toFixed(2)])),later};
}
export type {BusinessCollector};
