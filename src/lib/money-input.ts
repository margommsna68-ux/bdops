// Money typed by people, US convention (owner decision 28/10/2026, REPLACES the Vietnamese convention of 19/10/2026): "." is the
// decimal point and "," an optional thousands separator, for every currency including VND. "12.18" is twelve point eighteen,
// "1,234.56" = "1234.56", "420,000" = "420000" (VND). The text a person types and the canonical number sent to the API ("420000",
// "16.27") are different things: forms parse once here and send only the canonical value, so the browser and the server can never
// read the same text differently. Anything ambiguous is an error at the field, never guessed: a decimal comma ("12,18", "1.234,56")
// or a comma group that is not exactly 3 digits is refused with "Dùng dấu . cho phần thập phân, ví dụ 12.18". Exact decimals are
// valid everywhere ("0.424", "16.125 USDT"), up to `fraction` digits. Text the web writes into a field goes through moneyInput, so
// it always reads back as the same value.
export type ParsedNumber={value:string|null;error:string|null};
const UNIT=/^(\$|₫|đ|vnd|usdt|usd)|(\$|₫|đ|vnd|usdt|usd)$/i;
export const US_DECIMAL_HINT='Dùng dấu . cho phần thập phân, ví dụ 12.18; dấu , chỉ để tách hàng nghìn (1,234.56)';
/** Old Vietnamese-style VND ("420.000" = four hundred twenty thousand) typed after the switch to the US format (review 29/10/2026). */
export const vndHint=(int:string,frac:string)=>'VND không có phần lẻ — '+int+'.'+frac+' là '+group(int.replace(/,/g,'')+frac)+'?';
export const ambiguousCommaHint=(a:string,b:string)=>'Ghi rõ: '+a+b+' hoặc '+a+'.'+b;
/**
 * Options (review 29/10/2026):
 * - `vnd`: a VND amount is whole đồng; any decimal part is refused, exactly 3 decimals ("420.000") with vndHint (old thousands dot).
 * - `vndRate`: a VND rate (1 USDT = N VND, 1 USD PayPal = N VND) may have decimals but never exactly 3 (same old thousands dot).
 * - `strictComma`: fields that allow more than 2 decimals (SDK money, unit prices, USDT): a lone "12,345" without a dot used to mean
 *   12.345, so it is refused as ambiguous; "12,345.5" and "1,234,567" (several groups) stay valid.
 */
export interface MoneyParseOptions {fraction?:number;integer?:boolean;vnd?:boolean;vndRate?:boolean;strictComma?:boolean}
/** Parse options of an amount in this currency for fields that allow more than 2 decimals (purchase totals / unit prices, costs). */
export const amountOptions=(currency:string|null|undefined,fraction=8):MoneyParseOptions=>currency?.toUpperCase()==='VND'?{fraction,vnd:true}:{fraction,strictComma:true};
export function parseMoneyNumber(text:string,opts:MoneyParseOptions={}):ParsedNumber{
  const fraction=opts.fraction??8;let t=text.trim().replace(/\s+/g,'');
  for(let i=0;i<2;i++)t=t.replace(UNIT,'');
  if(!t)return {value:null,error:null};
  if(t.startsWith('-'))return {value:null,error:'Không nhập số âm'};
  if(!/^[\d.,]+$/.test(t))return {value:null,error:'Chỉ nhập chữ số, dấu chấm (phần thập phân) và dấu phẩy (hàng nghìn)'};
  const dots=t.split('.').length-1;
  if(dots>1&&(opts.vnd||opts.vndRate)&&/^\d{1,3}(\.\d{3})+$/.test(t))return {value:null,error:'VND không có phần lẻ — '+t+' là '+t.replace(/\./g,',')+'?'};
  if(dots>1)return {value:null,error:'Chỉ một dấu chấm, đứng trước phần thập phân (ví dụ 12.18)'};
  const [int,frac='']=t.split('.');
  if(frac.includes(',')||(int.includes(',')&&!/^[1-9]\d{0,2}(,\d{3})+$/.test(int)))return {value:null,error:US_DECIMAL_HINT};
  if((opts.vnd||opts.vndRate)&&dots&&frac.length===3)return {value:null,error:vndHint(int,frac)};
  if(opts.vnd&&dots)return {value:null,error:'VND không có phần lẻ; nhập số đồng nguyên (ví dụ 420,000)'};
  if(opts.strictComma&&!dots&&/^\d{1,3},\d{3}$/.test(int)){const [a,b]=int.split(',');return {value:null,error:ambiguousCommaHint(a,b)};}
  if(opts.integer&&dots)return {value:null,error:'Nhập số nguyên, không có phần thập phân'};
  if(!int)return {value:null,error:'Thiếu phần nguyên trước dấu chấm (ví dụ 0.5)'};
  if(dots&&!frac)return {value:null,error:'Thiếu phần thập phân sau dấu chấm'};
  if(frac.length>fraction)return {value:null,error:'Tối đa '+fraction+' chữ số thập phân'};
  const digits=int.replace(/,/g,'').replace(/^0+(?=\d)/,''),f=frac.replace(/0+$/,'');
  if(digits.length>16)return {value:null,error:'Số quá lớn'};
  return {value:digits+(f?'.'+f:''),error:null};
}
const group=(int:string)=>(int.replace(/^0+(?=\d)/,'')||'0').replace(/\B(?=(\d{3})+(?!\d))/g,',');
/** A positive amount with at most 2 decimals (payout / receipt fields): canonical "1234.5" or the error to show at the field;
 *  value null + error null = empty. "1,234.50" is accepted, "12,18" refused. */
export function parsePositiveAmount(text:string,fraction=2):ParsedNumber{
  const p=parseMoneyNumber(text,{fraction});if(p.error||p.value===null)return p;
  return /[1-9]/.test(p.value)?p:{value:null,error:'Số tiền phải lớn hơn 0'};
}
/** Canonical decimal → US text keeping every significant decimal ("420000" → "420,000", "16.2665" → "16.2665"). */
export function moneyNumber(value:string|null|undefined):string{
  if(!value)return '';const neg=value.startsWith('-'),[int,dec='']=value.replace(/^-/,'').split('.'),frac=dec.replace(/0+$/,'');
  return (neg?'-':'')+group(int)+(frac?'.'+frac:'');
}
/** Canonical decimal → text for an input that parseMoneyNumber reads back as the same value (US text has no ambiguous form). */
export function moneyInput(value:string|null|undefined):string{return moneyNumber(value);}
/** Round a canonical decimal half up to `places` decimals, on the digits (never through a float). */
export function roundDecimal(value:string,places:number):string{
  const neg=value.startsWith('-'),[int,dec='']=value.replace(/^-/,'').split('.');
  const scaled=BigInt((int||'0')+(dec+'0'.repeat(places+1)).slice(0,places+1)),rounded=(scaled+BigInt(5))/BigInt(10);
  const s=rounded.toString().padStart(places+1,'0'),out=places?s.slice(0,-places)+'.'+s.slice(-places):s;
  return (neg&&rounded>BigInt(0)?'-':'')+out;
}
const fixed2=(value:string)=>{const r=roundDecimal(value,2),[i,d]=r.replace(/^-/,'').split('.');return (r.startsWith('-')?'-':'')+group(i)+'.'+d;};
/** US dollars: "$0.00", "$18.50", "$1,234.56", "-$5.00". USD uses the dollar sign; PayPal cost dollars add their own label in formatMoney. */
export function formatUsd(value:string):string{const t=fixed2(value);return t.startsWith('-')?'-$'+t.slice(1):'$'+t;}
/** One amount with its own currency. USDT is shown with 2 decimals unless `exact` (the stored precision); VND as ₫. */
export function formatMoney(value:string,currency:string,opts:{exact?:boolean}={}):string{
  const c=currency.toUpperCase();
  if(c==='PPUSD')return formatMoney(value,'USD',opts)+' PayPal';
  if(c==='USD')return opts.exact?(value.startsWith('-')?'-$':'$')+moneyNumber(value.replace(/^-/,'')):formatUsd(value);
  if(c==='VND')return moneyNumber(value)+' ₫';
  return (opts.exact?moneyNumber(value):fixed2(value))+' '+c;
}
/** Ledger amounts with their unit: USD as "$1,234.50", other currencies with every recorded decimal ("420,000 ₫", "16.26646 USDT"). */
export function formatLedger(value:string,currency:string):string{return currency.toUpperCase()==='USD'?formatUsd(value):formatMoney(value,currency,{exact:true});}
/** Display only: explicit units, at most two decimals. Never use this text as an input or persisted value. */
export function displayMoney(value:string,currency:string):string{
  const c=currency.toUpperCase(),rounded=roundDecimal(value,c==='VND'?0:2);
  if(c==='VND')return moneyNumber(rounded)+' ₫';
  const negative=rounded.startsWith('-'),[int,frac]=rounded.replace(/^-/,'').split('.');
  const text=(negative?'-':'')+int.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+frac;
  return c==='USD'||c==='PPUSD'?(negative?'-$'+text.slice(1):'$'+text)+(c==='PPUSD'?' PayPal':''):text+' '+c;
}
