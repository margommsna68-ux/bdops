import {CashDecimal,normalizeCostMoney} from '@/server/business-management/usdt-money';
import {formatMoney,parseViNumber,roundDecimal,viInput,viNumber} from '@/lib/money-input';
// Money of one purchase in Kho tài khoản (new import and "Ghi chi phí" of a batch), owner brief 19/10/2026:
// - the default is the total actually paid; "Tính theo giá mỗi tài khoản" needs the quantity actually bought (a PayPal purchase
//   counts PP codes, never emails or pasted lines);
// - switching unit → total carries unit × quantity (70.000 never becomes the whole purchase); switching back keeps a unit price only
//   while it still gives the same total;
// - changing the view never drops an entered amount (independent review 19/10: 10 USDT / 3 → empty unit price was imported as
//   "Chưa ghi chi phí"): a total that cannot become an exact unit price stays on Tổng tiền thực trả; only clearing the visible amount
//   (editAmount) means no cost;
// - the total is the source of truth; with a quantity the allocation total ÷ quantity is a reference only (no second cost);
// - outside USDT a rate "1 USDT = N <currency>" is required (never 1, never USD = USDT); a Binance P2P quote carries its source and
//   time, expires visibly (the form blocks Nhập instead of changing the converted amount at the click) and is dropped when the rate
//   is edited or the currency changes.
export type Quote={rate:string;token:string;fetchedAt:string;side:'BUY'|'SELL'};
export interface PurchaseState {mode:'TOTAL'|'UNIT';total:string;unit:string;quantity:string;currency:string;rate:string;quote:Quote|null;held?:boolean}
export const emptyPurchase=():PurchaseState=>({mode:'TOTAL',total:'',unit:'',quantity:'',currency:'USDT',rate:'',quote:null});
/** The server accepts a quote for 10 minutes; the form treats it as expired a little earlier so a click never races the limit. */
export const QUOTE_TTL_MS=9.5*60000;
export const MAX_QUANTITY=100000;
export interface PurchasePayload {priceMode:'TOTAL'|'UNIT';amount:string;quantity:number|null;currency:string;rate:string|null;p2pQuoteToken:string|null}
type Field='total'|'unit'|'quantity'|'rate';
const sameNumber=(a:string,b:string)=>{try{return new CashDecimal(a).eq(b);}catch{return false;}};
const strip=(v:string)=>v.includes('.')?v.replace(/\.?0+$/,''):v;
function quantityOf(s:PurchaseState):{value:number|null;error:string|null}{
  const q=parseViNumber(s.quantity,{integer:true});if(q.error)return {value:null,error:q.error};if(q.value===null)return {value:null,error:null};
  const n=Number(q.value);return n>=1&&n<=MAX_QUANTITY?{value:n,error:null}:{value:null,error:'Số lượng từ 1 đến '+MAX_QUANTITY.toLocaleString('vi-VN')};
}
const vnd=(s:PurchaseState)=>s.currency==='VND';
function positive(text:string,fraction:number,isVnd=false):{value:string|null;error:string|null}{
  const p=parseViNumber(text,{fraction,vnd:isVnd});if(p.value!==null&&!new CashDecimal(p.value).gt(0))return {value:null,error:'Phải lớn hơn 0'};return p;
}
const product=(unit:string,qty:number)=>strip(new CashDecimal(unit).mul(qty).toFixed(8));
/** The unit price that gives exactly this total (8 decimals), or null. */
function exactUnit(total:string,qty:number){const u=strip(new CashDecimal(total).div(qty).toFixed(8));return sameNumber(product(u,qty),total)?u:null;}
export const quoteLabel=(q:Quote)=>'Binance P2P · '+(q.side==='BUY'?'Mua':'Bán')+' USDT · lấy lúc '+new Date(q.fetchedAt).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
export function readPurchase(s:PurchaseState,unitWord:string,now=Date.now()){
  const errors:Partial<Record<Field,string>>={},cur=s.currency,money=positive(s.mode==='TOTAL'?s.total:s.unit,8,vnd(s)),qty=quantityOf(s);
  if(money.error)errors[s.mode==='TOTAL'?'total':'unit']=money.error;
  if(qty.error)errors.quantity=qty.error;
  // A unit view left empty over a kept total (older drafts) is never "no cost": it blocks until a unit price or the total view is used.
  const kept=s.mode==='UNIT'&&!s.unit.trim()&&!!s.total.trim();
  if(kept){const t=positive(s.total,8,vnd(s)).value;errors.unit=`Chưa có giá mỗi ${unitWord}; tổng ${t?formatMoney(t,cur,{exact:true}):s.total.trim()} vẫn giữ: nhập giá mỗi ${unitWord} hoặc bấm Tổng tiền thực trả.`;}
  const priced=money.value!==null||!!money.error||kept;
  const empty={errors,priced,payload:null as PurchasePayload|null,total:null as string|null,usdt:null as string|null,formula:null as string|null,usdtText:null as string|null,rateText:null as string|null,rateSource:'',allocation:null as string|null,quoteExpired:false,unitHint:null as string|null};
  if(!priced)return empty;
  if(s.mode==='TOTAL'&&s.held){const t=money.value;
    empty.unitHint=!t?`Sửa Tổng tiền thực trả trước khi tính giá mỗi ${unitWord}.`
      :qty.value===null?`Cần số ${unitWord} thực mua để tính giá mỗi ${unitWord}; giữ Tổng tiền thực trả ${formatMoney(t,cur,{exact:true})}.`
      :exactUnit(t,qty.value)?null:`${formatMoney(t,cur,{exact:true})} ÷ ${qty.value.toLocaleString('vi-VN')} không chia hết thành giá mỗi ${unitWord} chính xác nên giữ Tổng tiền thực trả ${formatMoney(t,cur,{exact:true})}; giá phân bổ chỉ để tham khảo.`;}
  if(s.mode==='UNIT'&&qty.value===null&&!qty.error)errors.quantity='Giá mỗi '+unitWord+' cần số lượng thực mua (không lấy số email hay số dòng dán)';
  let rate:string|null=null;
  if(cur!=='USDT'){const r=positive(s.rate,12,vnd(s));if(r.error)errors.rate=r.error;else if(r.value===null)errors.rate='Nhập tỷ giá thực trả: 1 USDT = ? '+cur;else rate=r.value;}
  const quote=s.quote&&rate&&sameNumber(s.quote.rate,rate)?s.quote:null,quoteExpired=!!quote&&now-Date.parse(quote.fetchedAt)>QUOTE_TTL_MS;
  const total=money.value===null?null:s.mode==='UNIT'?(qty.value!==null?product(money.value,qty.value):null):money.value;
  let usdt:string|null=null;if(total&&(cur==='USDT'||rate)){try{usdt=normalizeCostMoney({amount:total,currency:cur,rate:rate??undefined}).usdt;}catch{errors.rate=errors.rate||'Số tiền quy đổi quá nhỏ hoặc tỷ giá không hợp lệ';}}
  const formula=s.mode==='UNIT'&&total&&qty.value!==null?`${qty.value.toLocaleString('vi-VN')} ${unitWord} × ${formatMoney(money.value!,cur,{exact:true})} = ${formatMoney(total,cur,{exact:true})}`:null;
  const allocation=s.mode==='TOTAL'&&total&&qty.value!==null?`≈ ${formatMoney(strip(roundDecimal(new CashDecimal(total).div(qty.value).toFixed(8),2)),cur,{exact:true})} / ${unitWord} (tham khảo)`:null;
  const ok=!Object.keys(errors).length&&!!total&&!quoteExpired;
  return {...empty,total,usdt,formula,allocation,quoteExpired,
    usdtText:cur!=='USDT'&&usdt?'≈ '+formatMoney(usdt,'USDT'):null,rateText:rate?`1 USDT = ${viNumber(rate)} ${cur}`:null,rateSource:quote?quoteLabel(quote):rate?'Nhập tay':'',
    payload:ok?{priceMode:s.mode,amount:money.value!,quantity:qty.value,currency:cur,rate:cur==='USDT'?null:rate,p2pQuoteToken:quote?.token??null}:null};
}
// Switching keeps the total: unit → total carries unit × quantity, or the total held before when no valid unit price was typed;
// total → unit fills the exact quotient (every decimal, written so it reads back unchanged). A typed total that cannot become an exact
// unit price (no quantity, a division not exact to 8 decimals, an error in the field) stays on Tổng tiền thực trả with its amount and
// a note (`held`); a rounded unit price is never multiplied back over the total.
export function switchMode(s:PurchaseState,next:'TOTAL'|'UNIT'):PurchaseState{
  if(s.mode===next)return s;const qty=quantityOf(s).value,v=vnd(s);
  if(next==='TOTAL'){const u=positive(s.unit,8,v).value;return {...s,mode:'TOTAL',held:false,total:u&&qty!==null?viInput(product(u,qty),{vnd:v}):s.total};}
  if(!s.total.trim())return {...s,mode:'UNIT',held:false};
  const t=positive(s.total,8,v).value,u=positive(s.unit,8,v).value;
  if(t&&qty!==null&&u&&sameNumber(product(u,qty),t))return {...s,mode:'UNIT',held:false};
  const exact=t&&qty!==null?exactUnit(t,qty):null;
  return exact?{...s,mode:'UNIT',held:false,unit:viInput(exact,{vnd:v})}:{...s,held:true};
}
/** The visible amount field typed by the person; clearing it is the only way to "no cost" (the other view's amount goes too). */
export function editAmount(s:PurchaseState,text:string):PurchaseState{
  if(!text.trim())return {...s,total:'',unit:'',held:false};
  return s.mode==='TOTAL'?{...s,total:text}:{...s,unit:text};
}
export const changeCurrency=(s:PurchaseState,currency:string):PurchaseState=>({...s,currency,rate:'',quote:null});
export const applyQuote=(s:PurchaseState,q:Quote):PurchaseState=>({...s,rate:viInput(strip(q.rate),{vnd:vnd(s)}),quote:q});
export function editRate(s:PurchaseState,text:string):PurchaseState{
  const v=parseViNumber(text,{fraction:12,vnd:vnd(s)}).value;return {...s,rate:text,quote:s.quote&&v&&sameNumber(s.quote.rate,v)?s.quote:null};
}
