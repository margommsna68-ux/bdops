// Money typed by people, Vietnamese convention (owner brief 19/10/2026): "." groups thousands, "," starts the decimals.
// "70000" and "70.000" are seventy thousand; "16,27" is sixteen point twenty-seven. The text a person types and the canonical
// number sent to the API ("70000", "16.27") are different things: forms parse once here and send only the canonical value, so the
// browser and the server can never read the same text differently (a rate "25.820" was once read as 25,82).
// A malformed group is an error at the field; nothing is multiplied or divided by 1.000 silently. Exact decimals are valid
// everywhere ("0,424", "16,125 USDT"), up to `fraction` digits. Only a VND field (`vnd`, amounts and "1 USDT = N VND" rates, where
// prices have no real decimals) warns about the English thousands comma: "25,820" there is refused with both readings; "0,xxx" is
// never a thousands group. Text the web writes into a field goes through viInput, so it always reads back as the same value.
export type ParsedNumber={value:string|null;error:string|null};
const UNIT=/^(\$|₫|đ|vnd|usdt|usd)|(\$|₫|đ|vnd|usdt|usd)$/i;
export function parseViNumber(text:string,opts:{fraction?:number;integer?:boolean;vnd?:boolean}={}):ParsedNumber{
  const fraction=opts.fraction??8;let t=text.trim().replace(/\s+/g,'');
  for(let i=0;i<2;i++)t=t.replace(UNIT,'');
  if(!t)return {value:null,error:null};
  if(t.startsWith('-'))return {value:null,error:'Không nhập số âm'};
  if(!/^[\d.,]+$/.test(t))return {value:null,error:'Chỉ nhập chữ số, dấu chấm (hàng nghìn) và dấu phẩy (phần lẻ)'};
  const commas=t.split(',').length-1;
  if(commas>1)return {value:null,error:'Chỉ một dấu phẩy, đứng trước phần lẻ (ví dụ 16,27)'};
  if(opts.integer&&commas)return {value:null,error:'Nhập số nguyên, không có phần lẻ'};
  const [int,frac='']=t.split(',');
  if(!int)return {value:null,error:'Thiếu phần nguyên trước dấu phẩy (ví dụ 0,5)'};
  if(int.includes('.')&&!/^\d{1,3}(\.\d{3})+$/.test(int))return {value:null,error:'Dấu chấm chỉ để tách hàng nghìn (70.000). Phần lẻ dùng dấu phẩy, ví dụ 25,82'};
  if(opts.vnd&&commas&&frac.length===3&&/^[1-9]\d{0,2}$/.test(int)){
    const whole=int+frac,short=frac.replace(/0+$/,'');
    return {value:null,error:`"${t}" dễ hiểu nhầm: nếu là ${group(whole)} thì ghi ${group(whole)}; nếu thật sự có phần lẻ thì ghi ${int},${short.length<3?short||'0':frac+'0'}`};
  }
  if(commas&&!frac)return {value:null,error:'Thiếu phần lẻ sau dấu phẩy'};
  if(!/^\d*$/.test(frac))return {value:null,error:'Phần lẻ chỉ gồm chữ số'};
  if(frac.length>fraction)return {value:null,error:'Tối đa '+fraction+' chữ số phần lẻ'};
  const digits=int.replace(/\./g,'').replace(/^0+(?=\d)/,''),f=frac.replace(/0+$/,'');
  if(digits.length>16)return {value:null,error:'Số quá lớn'};
  return {value:digits+(f?'.'+f:''),error:null};
}
const group=(int:string)=>(int.replace(/^0+(?=\d)/,'')||'0').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
/** Canonical decimal → Vietnamese text keeping every significant decimal ("420000" → "420.000", "16.2665" → "16,2665"). */
export function viNumber(value:string|null|undefined):string{
  if(!value)return '';const neg=value.startsWith('-'),[int,dec='']=value.replace(/^-/,'').split('.'),frac=dec.replace(/0+$/,'');
  return (neg?'-':'')+group(int)+(frac?','+frac:'');
}
/** Canonical decimal → text for an input that parseViNumber(·, opts) reads back as the same value: viNumber, plus a trailing zero only
 *  where a VND field would otherwise take it for a thousands group ("15.625" VND → "15,6250"). */
export function viInput(value:string|null|undefined,opts:{vnd?:boolean}={}):string{
  const t=viNumber(value);return t&&opts.vnd&&parseViNumber(t,{vnd:true}).error?t+'0':t;
}
/** Round a canonical decimal half up to `places` decimals, on the digits (never through a float). */
export function roundDecimal(value:string,places:number):string{
  const neg=value.startsWith('-'),[int,dec='']=value.replace(/^-/,'').split('.');
  const scaled=BigInt((int||'0')+(dec+'0'.repeat(places+1)).slice(0,places+1)),rounded=(scaled+BigInt(5))/BigInt(10);
  const s=rounded.toString().padStart(places+1,'0'),out=places?s.slice(0,-places)+'.'+s.slice(-places):s;
  return (neg&&rounded>BigInt(0)?'-':'')+out;
}
const fixed2=(value:string)=>{const r=roundDecimal(value,2),[i,d]=r.replace(/^-/,'').split('.');return (r.startsWith('-')?'-':'')+group(i)+','+d;};
/** US dollars: "$0,00", "$18,50", "-$5,00". USD uses the dollar sign; PayPal cost dollars add their own label in formatMoney. */
export function formatUsd(value:string):string{const t=fixed2(value);return t.startsWith('-')?'-$'+t.slice(1):'$'+t;}
/** One amount with its own currency. USDT is shown with 2 decimals unless `exact` (the stored precision); VND as ₫. */
export function formatMoney(value:string,currency:string,opts:{exact?:boolean}={}):string{
  const c=currency.toUpperCase();
  if(c==='PPUSD')return formatMoney(value,'USD',opts)+' PayPal';
  if(c==='USD')return opts.exact?(value.startsWith('-')?'-$':'$')+viNumber(value.replace(/^-/,'')):formatUsd(value);
  if(c==='VND')return viNumber(value)+' ₫';
  return (opts.exact?viNumber(value):fixed2(value))+' '+c;
}
/** Ledger amounts with their unit: USD as "$1.234,50", other currencies with every recorded decimal ("420.000 ₫", "16,26646 USDT"). */
export function formatLedger(value:string,currency:string):string{return currency.toUpperCase()==='USD'?formatUsd(value):formatMoney(value,currency,{exact:true});}
/** Display only: explicit units, at most two decimals. Never use this text as an input or persisted value. */
export function displayMoney(value:string,currency:string):string{
  const c=currency.toUpperCase(),rounded=roundDecimal(value,c==='VND'?0:2);
  if(c==='VND')return viNumber(rounded)+' ₫';
  const negative=rounded.startsWith('-'),[int,frac]=rounded.replace(/^-/,'').split('.');
  const text=(negative?'-':'')+int.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+frac;
  return c==='USD'||c==='PPUSD'?(negative?'-$'+text.slice(1):'$'+text)+(c==='PPUSD'?' PayPal':''):text+' '+c;
}
