import type {RegistryRow} from './types';
export type DueState='NONE'|'OVERDUE'|'DUE_SOON'|'OK';
export type RegistrySort='PACKAGE'|'SERVER'|'STATUS'|'IP';
export const DUE_SOON_DAYS=7;
const utcDay=(d:Date)=>Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate());
// Calendar day as the team sees it (Asia/Bangkok), expressed as a UTC day number so it compares with DATE columns.
export function businessDay(now:Date=new Date()){const [y,m,d]=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(now).split('-').map(Number);return Date.UTC(y,m-1,d);}
export function dueState(nextDueDate:Date|null|undefined,today:Date=new Date()):{state:DueState;daysLeft:number|null}{
  if(!nextDueDate) return {state:'NONE',daysLeft:null};
  const daysLeft=Math.round((utcDay(nextDueDate)-businessDay(today))/86400000);
  return {state:daysLeft<0?'OVERDUE':daysLeft<=DUE_SOON_DAYS?'DUE_SOON':'OK',daysLeft};
}
export function addMonthsClamped(date:Date,months:number){
  const y=date.getUTCFullYear(),m=date.getUTCMonth()+months,d=date.getUTCDate();
  const last=new Date(Date.UTC(y,m+1,0)).getUTCDate();
  return new Date(Date.UTC(y,m,Math.min(d,last)));
}
export function nextDueAfterPayment(current:Date|null|undefined,paidOn:Date,cycleMonths:number){
  const base=current&&utcDay(current)>utcDay(paidOn)?current:paidOn;
  return addMonthsClamped(new Date(utcDay(base)),Math.max(1,Math.floor(cycleMonths||1)));
}
export const compareCodes=(a:string,b:string)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'});
const numericIP=(ip:string)=>ip.split('.').reduce((n,part)=>n*256+Number(part),0);
const packageRank=(code:string|null)=>code===null?2:/^\d+$/.test(code)?0:1;
function vmKey(row:RegistryRow){const ref=row.vmRefs[0];if(!ref) return null;const [server='',rest='']=ref.split('/');return {server,vm:rest.split(' · ')[0]};}
function compareVM(a:RegistryRow,b:RegistryRow){const ka=vmKey(a),kb=vmKey(b);if(!ka&&!kb) return 0;if(!ka) return 1;if(!kb) return -1;return compareCodes(ka.server,kb.server)||compareCodes(ka.vm,kb.vm);}
function comparePackage(a:RegistryRow,b:RegistryRow){return packageRank(a.packageCode)-packageRank(b.packageCode)||compareCodes(a.packageCode||'',b.packageCode||'');}
function compareIP(a:RegistryRow,b:RegistryRow){return numericIP(a.ip)-numericIP(b.ip)||(a.port||0)-(b.port||0)||(a.endpointId||a.identityId).localeCompare(b.endpointId||b.identityId);}
function compareStatus(a:RegistryRow,b:RegistryRow){if(!a.statusAt&&!b.statusAt) return 0;if(!a.statusAt) return 1;if(!b.statusAt) return -1;return b.statusAt.localeCompare(a.statusAt);}
const comparators:Record<RegistrySort,(a:RegistryRow,b:RegistryRow)=>number>={
  PACKAGE:(a,b)=>comparePackage(a,b)||compareVM(a,b)||compareIP(a,b),
  SERVER:(a,b)=>compareVM(a,b)||comparePackage(a,b)||compareIP(a,b),
  STATUS:(a,b)=>compareStatus(a,b)||comparePackage(a,b)||compareIP(a,b),
  IP:compareIP,
};
export function sortRegistryRows(rows:RegistryRow[],mode:RegistrySort='PACKAGE'){return rows.sort(comparators[mode]||comparators.PACKAGE);}
