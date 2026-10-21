// Tiền VM (owner brief 22/10/2026): the money seen on the machine for the VM's CURRENT SDK code at the time it was checked, on THIS VM
// in THIS round (independent review 22/10/2026: a code put back after a recreation or moved from another VM keeps its stored money as
// history, but the new round reads "Chưa kiểm tra" until it is checked again). Never a sum of the VM's codes, never the EarnApp
// balance, never cost / income / PayPal money; nothing is inferred from the figure. One pure state for the cell, the filters, the
// sorts, the summary strip and the API (the server already hides the money without the read right).
export const VM_MONEY_STALE_HOURS=24;
/** The current code as the server gives it for one VM: amount / observedAt / failedAt are the readings bound to this VM + round (null
 *  otherwise); `stored` is the code's own latest figure wherever it was read (history for the frame, never the row figure). */
export interface VmMoneySource {code:string;amount:string|null;observedAt:string|null;failedAt:string|null;moneyHidden:boolean;stored?:{amount:string|null;observedAt:string|null;cycle:number|null;vmId:string|null}|null}
type Stored=NonNullable<VmMoneySource['stored']>|null;
export type VmMoneyState=
  |{kind:'UNCHECKED';code:string|null;stored:Stored}
  |{kind:'HIDDEN';code:string}
  |{kind:'FAILED';code:string;amount:string|null;at:string|null;failedAt:string;stale:boolean}
  |{kind:'OK'|'STALE'|'NO_TIME';code:string;amount:string;at:string|null};
export const isStale=(iso:string,now:Date)=>now.getTime()-Date.parse(iso)>VM_MONEY_STALE_HOURS*3600e3;
/**
 * `cur` = the VM's current code (null when the VM has none: a recreated VM or a replaced code never shows the old money as current).
 * FAILED = the latest reading of this round could not read the money: the last good figure of this round and its own time are kept, never 0.
 * NO_TIME = money recorded before observation times existed: the write time is never shown in its place.
 */
export function vmMoneyState(cur:VmMoneySource|null|undefined,now:Date=new Date()):VmMoneyState{
  if(!cur)return {kind:'UNCHECKED',code:null,stored:null};
  if(cur.moneyHidden)return {kind:'HIDDEN',code:cur.code};
  const stored=cur.stored&&cur.stored.amount!=null?cur.stored:null;
  const failedAfter=!!cur.failedAt&&(!cur.observedAt||Date.parse(cur.failedAt)>Date.parse(cur.observedAt));
  if(failedAfter)return {kind:'FAILED',code:cur.code,amount:cur.amount,at:cur.observedAt,failedAt:cur.failedAt!,stale:!!cur.observedAt&&isStale(cur.observedAt,now)};
  if(cur.amount==null)return {kind:'UNCHECKED',code:cur.code,stored};
  if(!cur.observedAt)return {kind:'NO_TIME',code:cur.code,amount:cur.amount,at:null};
  return {kind:isStale(cur.observedAt,now)?'STALE':'OK',code:cur.code,amount:cur.amount,at:cur.observedAt};
}
export function relativeTime(iso:string,now:Date=new Date()):string{
  const s=Math.max(0,Math.round((now.getTime()-Date.parse(iso))/1000));
  if(s<60)return 'vừa xong';const m=Math.round(s/60);if(m<60)return m+' phút trước';
  const h=Math.round(m/60);if(h<48)return h+' giờ trước';return Math.round(h/24)+' ngày trước';
}
export function fullTime(iso:string,tz='Asia/Ho_Chi_Minh'):string{
  return new Intl.DateTimeFormat('vi-VN',{timeZone:tz,day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
}
// Exact sums: whole dollars and micro-dollars (6 decimals) added apart, never a float on the figures.
const parts=(v:string)=>{const [i,d='']=v.split('.');return {whole:Number(i),micro:Number((d+'000000').slice(0,6))};};
/** Comparable key, smaller first. An unknown figure is never 0: it sorts after every known one; an unknown time after every known time. */
export function vmMoneySortKey(sort:'BALANCE'|'CHECKED_OLD',s:VmMoneyState):number{
  const amount='amount' in s?s.amount:null,at='at' in s?s.at:null;
  if(sort==='BALANCE'){if(amount==null)return Number.MAX_SAFE_INTEGER;const p=parts(amount);return -(p.whole*1e6+p.micro);}
  return at?Date.parse(at):Number.MAX_SAFE_INTEGER;
}
/** "Tổng tiền VM đã kiểm tra": the checked figures added up (stale and last-good-before-failure included), the rest counted apart. */
export function vmMoneySummary(states:VmMoneyState[]){
  let whole=0,micro=0,checked=0,unchecked=0,stale=0,failed=0,noTime=0,hidden=0;
  const add=(v:string)=>{const p=parts(v);whole+=p.whole;micro+=p.micro;checked++;};
  for(const s of states){
    if(s.kind==='HIDDEN'){hidden++;continue;}
    if(s.kind==='UNCHECKED'){unchecked++;continue;}
    if(s.kind==='FAILED'){failed++;if(s.amount!=null)add(s.amount);continue;}
    if(s.kind==='STALE')stale++;if(s.kind==='NO_TIME')noTime++;
    add(s.amount);
  }
  whole+=Math.floor(micro/1e6);micro=micro%1e6;
  return {total:whole+'.'+String(micro).padStart(6,'0'),checked,unchecked,stale,failed,noTime,hidden};
}
