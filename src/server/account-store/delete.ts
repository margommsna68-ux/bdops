import type {PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {CashDecimal} from '../business-management/usdt-money';
import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {runBusinessCommand} from '../business-management/idempotency';
import {assertStockWrite,type StockKind} from './inventory';
// Xoá khỏi kho (owner brief 20/10/2026): Gmail / Apple ID and PayPal rows are hidden from the stock (archivedAt), never deleted.
// - ADMIN of the project only, checked inside the write transaction (a right dropped meanwhile refuses). Restore and undo likewise.
// - A row still in use is refused with its place: a login whose EarnApp account sits on an active VM (or an old VM link still in
//   force); a PayPal with an email receiving for a VM, a payout request still waiting, money left by the book in any currency, or
//   emails / links waiting for reconciliation. Settled history never blocks.
// - Nothing else moves: purchase batches, costs, quantities, the PayPal book and the "used" marks of emails stay. Restoring puts the
//   row back exactly as it was (a used login or email never becomes NEW: the state is computed from its links).
// - One command key per click: a retry replays; undo goes through the journal images (refused once the row changed again).
export interface StockActionRow {id:string;outcome:'APPLIED'|'SKIP'|'ERROR';message:string;place:{serverId:string;vmId:string;server:string;vm:string}|null;href:string|null}
export interface StockActionResult extends Record<string,unknown> {rows:StockActionRow[];applied:number}
const MAX=1000;
const assertStockAdmin=(scope:ActorScope,kind:StockKind)=>{assertStockWrite(scope,kind);if(scope.role!=='ADMIN')throw new ProxyDomainError('FORBIDDEN','Chỉ ADMIN của dự án được xoá / khôi phục tài khoản');};
const vmSelect={select:{id:true,code:true,archivedAt:true,server:{select:{id:true,code:true,archivedAt:true}}}} as const;
type VmRef={id:string;code:string;archivedAt:Date|null;server:{id:string;code:string;archivedAt:Date|null}};
const livePlace=(vm:VmRef|null|undefined)=>vm&&!vm.archivedAt&&!vm.server.archivedAt?{serverId:vm.server.id,vmId:vm.id,server:vm.server.code,vm:vm.code}:null;
const vmHref=(p:{serverId:string;vmId:string})=>'/infrastructure/servers/'+encodeURIComponent(p.serverId)+'?vm='+encodeURIComponent(p.vmId)+'&tab=account';
/** Money left by the book per currency (same rules as the PayPal ledger: confirmed receipts incl. opening + internal in − debits). */
async function bookBalances(db:Parameters<Parameters<typeof runBusinessCommand>[2]>[0],projectId:string,paypalId:string){
  const [funds,outs]=await Promise.all([
    db.fundTransaction.findMany({where:{projectId,paypalId,voidedAt:null,confirmed:true,failed:false},select:{amount:true,currency:true}}),
    db.withdrawal.findMany({where:{projectId,voidedAt:null,OR:[{sourcePaypalId:paypalId},{destPaypalId:paypalId,type:'MIXING'}]},select:{sourcePaypalId:true,destPaypalId:true,type:true,amount:true,currency:true,receivedAmount:true,receivedCurrency:true}}),
  ]);
  type D=InstanceType<typeof CashDecimal>;const m=new Map<string,D>(),add=(c:string,v:D)=>m.set(c,(m.get(c)||new CashDecimal(0)).plus(v));
  for(const f of funds)add(f.currency,new CashDecimal(f.amount.toString()));
  for(const w of outs){
    if(w.sourcePaypalId===paypalId)add(w.currency,new CashDecimal(w.amount.toString()).neg());
    if(w.type==='MIXING'&&w.destPaypalId===paypalId){const amt=w.receivedAmount?new CashDecimal(w.receivedAmount.toString()):new CashDecimal(w.amount.toString());add(w.receivedAmount?w.receivedCurrency||w.currency:w.currency,amt);}
  }
  return [...m.entries()].filter(([,v])=>!v.isZero()).map(([c,v])=>v.toFixed(2)+' '+c);
}
async function withOperation<T extends Record<string,unknown>>(db:PrismaClient,projectId:string,key:string,result:T&{replay:boolean}){
  const op=await db.operationJournal.findUnique({where:{projectId_commandKey:{projectId,commandKey:key}},select:{id:true}});
  return {...result,operationId:op?.id??null};
}
export async function deleteStock(scope:ActorScope,input:{kind:StockKind;items:{id:string;expectedRevision:number}[];key:string},db:PrismaClient=prisma){
  if(!input.items.length||input.items.length>MAX)throw new ProxyDomainError('INVALID_INPUT','Chọn từ 1 đến '+MAX+' dòng');
  const result=await runBusinessCommand<StockActionResult>(scope,{key:input.key,payload:input,kind:'ACCOUNT_STOCK_DELETE',module:input.kind==='PAYPAL'?'PAYPALS':'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    assertStockAdmin(current,input.kind);const rows:StockActionRow[]=[],now=new Date();
    const row=(id:string,outcome:StockActionRow['outcome'],message:string,place:StockActionRow['place']=null,href:string|null=null)=>rows.push({id,outcome,message,place,href:href??(place?vmHref(place):null)});
    for(const item of input.items){
      if(input.kind==='LOGIN'){
        const old=await tx.gmailAccount.findFirst({where:{id:item.id,projectId:scope.projectId},include:{earnApp:{select:{vm:vmSelect}},vms:{where:{managed:true,archivedAt:null},select:vmSelect.select,take:1}}});
        if(!old){row(item.id,'ERROR','Không còn trong kho');continue;}
        if(old.archivedAt){row(item.id,'SKIP','Đã xoá trước đó');continue;}
        if(old.revision!==item.expectedRevision){row(item.id,'ERROR','Vừa được sửa; tải lại');continue;}
        const place=livePlace(old.earnApp?.vm)||livePlace(old.vms[0]);
        if(place){row(item.id,'ERROR','Đang gán cho '+place.server+' / '+place.vm+'; bỏ gán tại VM trước',place);continue;}
        await images.remember('GMAIL',old.id);await tx.gmailAccount.update({where:{id:old.id},data:{archivedAt:now,revision:{increment:1}}});row(item.id,'APPLIED','Đã xoá khỏi kho');
      }else{
        const old=await tx.payPalAccount.findFirst({where:{id:item.id,projectId:scope.projectId},include:{emails:{where:{archivedAt:null},select:{id:true,email:true,reviewHold:true,earnApp:{select:{vm:vmSelect}}}},earnApps:{where:{paypalEmailId:null},select:{id:true}}}});
        if(!old){row(item.id,'ERROR','Không còn trong kho');continue;}
        if(old.archivedAt){row(item.id,'SKIP','Đã xoá trước đó');continue;}
        if(old.revision!==item.expectedRevision){row(item.id,'ERROR','Vừa được sửa; tải lại');continue;}
        const assigned=old.emails.map(e=>({e,place:livePlace(e.earnApp?.vm)})).find(x=>x.place);
        if(assigned){row(item.id,'ERROR',assigned.e.email+' đang nhận cho '+assigned.place!.server+' / '+assigned.place!.vm+'; bỏ gán tại VM trước',assigned.place);continue;}
        const pp='/paypals?pp='+encodeURIComponent(old.code);
        const pending=await tx.earnPayoutRequest.count({where:{paypalId:old.id,state:'REQUESTED',consumedAt:null}});
        if(pending){row(item.id,'ERROR','Còn '+pending+' yêu cầu rút đang chờ tiền về; xử lý ở Tiền vào PayPal trước',null,pp+'&show=in');continue;}
        const left=await bookBalances(tx,scope.projectId,old.id);
        if(left.length){row(item.id,'ERROR','Còn lại theo sổ '+left.join(', ')+'; chuyển / rút hết hoặc đối chiếu trước',null,pp+'&show=out');continue;}
        if(old.emails.some(e=>e.reviewHold&&!e.earnApp)||old.earnApps.length){row(item.id,'ERROR','Còn mục cần đối chiếu (email tạm giữ hoặc liên kết cũ chưa rõ email); xử lý ở Cần đối chiếu trước',null,'/paypals?view=review');continue;}
        await images.remember('PAYPAL',old.id);await tx.payPalAccount.update({where:{id:old.id},data:{archivedAt:now,revision:{increment:1}}});row(item.id,'APPLIED','Đã xoá khỏi kho');
      }
    }
    return {rows,applied:rows.filter(r=>r.outcome==='APPLIED').length};
  },db);
  return withOperation(db,scope.projectId,input.key,result);
}
export async function restoreStock(scope:ActorScope,input:{kind:StockKind;items:{id:string;expectedRevision:number}[];key:string},db:PrismaClient=prisma){
  if(!input.items.length||input.items.length>MAX)throw new ProxyDomainError('INVALID_INPUT','Chọn từ 1 đến '+MAX+' dòng');
  const result=await runBusinessCommand<StockActionResult>(scope,{key:input.key,payload:input,kind:'ACCOUNT_STOCK_RESTORE',module:input.kind==='PAYPAL'?'PAYPALS':'INFRASTRUCTURE',skipJournalWhenUnchanged:true},async(tx,images,current)=>{
    assertStockAdmin(current,input.kind);const rows:StockActionRow[]=[];
    const row=(id:string,outcome:StockActionRow['outcome'],message:string)=>rows.push({id,outcome,message,place:null,href:null});
    for(const item of input.items){
      if(input.kind==='LOGIN'){
        const old=await tx.gmailAccount.findFirst({where:{id:item.id,projectId:scope.projectId}});
        if(!old){row(item.id,'ERROR','Không còn trong dự án');continue;}
        if(!old.archivedAt){row(item.id,'SKIP','Đang trong kho; không cần khôi phục');continue;}
        if(old.revision!==item.expectedRevision){row(item.id,'ERROR','Vừa được sửa; tải lại');continue;}
        const twin=await tx.gmailAccount.findFirst({where:{email:{equals:old.email,mode:'insensitive'},archivedAt:null,id:{not:old.id}},select:{id:true}});
        if(twin){row(item.id,'ERROR','Email này đã có dòng khác đang trong kho; không khôi phục trùng');continue;}
        await images.remember('GMAIL',old.id);await tx.gmailAccount.update({where:{id:old.id},data:{archivedAt:null,revision:{increment:1}}});row(item.id,'APPLIED','Đã khôi phục; tình trạng tính lại từ liên kết hiện có');
      }else{
        const old=await tx.payPalAccount.findFirst({where:{id:item.id,projectId:scope.projectId}});
        if(!old){row(item.id,'ERROR','Không còn trong dự án');continue;}
        if(!old.archivedAt){row(item.id,'SKIP','Đang trong kho; không cần khôi phục');continue;}
        if(old.revision!==item.expectedRevision){row(item.id,'ERROR','Vừa được sửa; tải lại');continue;}
        const twin=await tx.payPalAccount.findFirst({where:{projectId:scope.projectId,code:{equals:old.code,mode:'insensitive'},archivedAt:null,id:{not:old.id}},select:{id:true}});
        if(twin){row(item.id,'ERROR','Mã PP này đã có dòng khác đang trong kho; không khôi phục trùng');continue;}
        await images.remember('PAYPAL',old.id);await tx.payPalAccount.update({where:{id:old.id},data:{archivedAt:null,revision:{increment:1}}});row(item.id,'APPLIED','Đã khôi phục; email đã dùng vẫn là đã dùng');
      }
    }
    return {rows,applied:rows.filter(r=>r.outcome==='APPLIED').length};
  },db);
  return withOperation(db,scope.projectId,input.key,result);
}
