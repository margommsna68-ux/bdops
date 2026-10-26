import type {Prisma,PrismaClient} from '@prisma/client';
import {ProxyDomainError} from '../proxy-management/types';

type DB=PrismaClient|Prisma.TransactionClient;
export const PAYPAL_DAILY_EMAIL_LIMIT=2;
const TIME_ZONE='Asia/Ho_Chi_Minh';
export function payoutDay(now=new Date()){
 const date=new Date(now.getTime()+7*3600_000).toISOString().slice(0,10);
 const start=new Date(date+'T00:00:00+07:00');
 return {date,timeZone:TIME_ZONE,start,end:new Date(start.getTime()+86400_000)};
}
type Usage={used:Set<string>;held:Set<string>};
export async function readPayoutDaily(db:DB,projectId:string,now=new Date()){
 const day=payoutDay(now),byPaypal=new Map<string,Usage>();
 const usage=(id:string)=>{let v=byPaypal.get(id);if(!v){v={used:new Set(),held:new Set()};byPaypal.set(id,v);}return v;};
 const [spent,requests]=await Promise.all([
  db.payPalPayoutDayEmail.findMany({where:{projectId,day:day.date},select:{paypalId:true,paypalEmailId:true}}),
  db.earnPayoutRequest.findMany({where:{projectId,OR:[
   {state:'REQUESTED',submission:{in:['PREPARING','UNKNOWN']}},
   {submission:'SENT',OR:[{submittedAt:{gte:day.start,lt:day.end}},{submittedAt:null,createdAt:{gte:day.start,lt:day.end}}]},
  ]},select:{paypalId:true,paypalEmailId:true,submission:true},orderBy:[{createdAt:'asc'},{id:'asc'}]}),
 ]);
 for(const row of spent)usage(row.paypalId).used.add(row.paypalEmailId);
 for(const row of requests)(row.submission==='SENT'?usage(row.paypalId).used:usage(row.paypalId).held).add(row.paypalEmailId);
 const summary=(id:string)=>{const x=usage(id),reserved=[...x.held].filter(e=>!x.used.has(e)).length;return {date:day.date,timeZone:TIME_ZONE,limit:PAYPAL_DAILY_EMAIL_LIMIT,used:x.used.size,reserved,remaining:Math.max(0,PAYPAL_DAILY_EMAIL_LIMIT-x.used.size-reserved)};};
 // Pre-existing overbooked drafts are not permission to send a third email. Oldest holds get the available slots;
 // already-used emails may still reconcile/replay because that introduces no new email into this day.
 const allowed=(id:string,emailId:string)=>{const x=usage(id);if(x.used.has(emailId))return true;if(x.held.has(emailId)){const pending=[...x.held].filter(e=>!x.used.has(e));return pending.indexOf(emailId)<Math.max(0,PAYPAL_DAILY_EMAIL_LIMIT-x.used.size);}return summary(id).remaining>0;};
 const occupied=(id:string,emailId:string)=>{const x=usage(id);return x.used.has(emailId)||x.held.has(emailId);};
 return {summary,allowed,occupied};
}
/** Called only inside the shared project-locked serializable business transaction. */
export async function assertPayoutDailySlot(tx:Prisma.TransactionClient,projectId:string,paypalId:string,paypalEmailId:string){
 const daily=await readPayoutDaily(tx,projectId);
 if(!daily.allowed(paypalId,paypalEmailId)){
  const details=daily.summary(paypalId);
  throw new ProxyDomainError('INVALID_INPUT','Mã PayPal đã đủ 2/2 email trong ngày (giờ Việt Nam), gồm email đang giữ. Chọn mã PayPal khác hoặc chờ sang ngày; email đã gán cho EarnApp không tự đổi.','PAYPAL_DAILY_LIMIT',{paypalId,...details});
 }
}
/** A send/uncertain result is a consumed slot. Kept even if its request is later failed, cancelled or undone. */
export async function consumePayoutDailySlot(tx:Prisma.TransactionClient,row:{projectId:string;paypalId:string;paypalEmailId:string;id:string}){
 const now=new Date(),day=payoutDay(now).date,key={projectId:row.projectId,paypalId:row.paypalId,day,paypalEmailId:row.paypalEmailId};
 await tx.payPalPayoutDayEmail.upsert({where:{projectId_paypalId_day_paypalEmailId:key},create:{...key,requestId:row.id,usedAt:now},update:{}});
}
