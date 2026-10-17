import {dueState} from './package-terms';
import {links} from '@/lib/links';
export type ReminderLevel='SOON'|'THREE_DAYS'|'ONE_DAY'|'TODAY'|'OVERDUE';
export interface ReminderPackage {id:string;code:string;nextDueDate:Date|null;reminderDays:number;renewalStoppedAt:Date|null;price:string|null;priceCurrency:string|null;disabled:boolean}
export interface PackageReminder {id:string;type:'PACKAGE_DUE';level:ReminderLevel;severity:'info'|'warning'|'error';title:string;message:string;link:string;createdAt:Date;packageId:string;code:string;daysLeft:number}
const dayText=(d:Date)=>d.toISOString().slice(0,10).split('-').reverse().join('/');
export const reminderLevel=(daysLeft:number):ReminderLevel=>daysLeft<0?'OVERDUE':daysLeft===0?'TODAY':daysLeft<=1?'ONE_DAY':daysLeft<=3?'THREE_DAYS':'SOON';
export const reminderSeverity=(level:ReminderLevel)=>level==='SOON'?'info':level==='THREE_DAYS'?'warning':'error';
// One live reminder per package inside its own window (reminderDays before the due day, Asia/Bangkok calendar), until the manager
// explicitly stops renewal. A disabled package still reminds: disabling only stops new imports. Packages without a due date never remind.
export function packageReminders(packages:ReminderPackage[],today:Date=new Date(),showAmount:boolean):PackageReminder[]{
  const out:PackageReminder[]=[];
  for(const p of packages){
    if(!p.nextDueDate||p.renewalStoppedAt) continue;
    const due=dueState(p.nextDueDate,today,p.reminderDays);if(due.state!=='DUE_SOON'&&due.state!=='OVERDUE') continue;
    const daysLeft=due.daysLeft!,level=reminderLevel(daysLeft);
    const title=level==='OVERDUE'?`Gói ${p.code} quá hạn ${-daysLeft} ngày`:level==='TODAY'?`Gói ${p.code} đến hạn hôm nay`:`Gói ${p.code} còn ${daysLeft} ngày`;
    const amount=showAmount&&p.price?` · ${p.price} ${p.priceCurrency||''}`.trimEnd():'';
    out.push({id:'pkg-due-'+p.id,type:'PACKAGE_DUE',level,severity:reminderSeverity(level),title,message:`Đến hạn ${dayText(p.nextDueDate)}${amount}${p.disabled?' · gói đã tắt nhập mới':''}.${showAmount?' Bấm để ghi thanh toán.':''}`,link:links.proxies({package:p.code,pay:showAmount?p.code:undefined}),createdAt:p.nextDueDate,packageId:p.id,code:p.code,daysLeft});
  }
  return out.sort((a,b)=>a.daysLeft-b.daysLeft);
}
