// Money typed by people, Vietnamese convention (owner brief 19/10/2026): "." groups thousands, "," starts the decimals.
// "70000" and "70.000" are seventy thousand; "16,27" is sixteen point twenty-seven. The text a person types and the canonical
// number sent to the API ("70000", "16.27") are different things: forms parse once here and send only the canonical value, so the
// browser and the server can never read the same text differently (a rate "25.820" was once read as 25,82).
// Ambiguous text ("70,000": seventy thousand in English, seventy in Vietnamese) or a malformed group is an error at the field;
// nothing is multiplied or divided by 1.000 silently.
export type ParsedNumber={value:string|null;error:string|null};
const UNIT=/^(\$|₫|đ|vnd|usdt|usd)|(\$|₫|đ|vnd|usdt|usd)$/i;
export function parseViNumber(text:string,opts:{fraction?:number;integer?:boolean}={}):ParsedNumber{
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
  if(commas&&!int.includes('.')&&frac.length===3&&/^\d{1,3}$/.test(int)){
    const whole=(int+frac).replace(/^0+(?=\d)/,'');
    return {value:null,error:`"${t}" dễ hiểu nhầm: nếu là ${group(whole)} thì ghi ${group(whole)}; nếu có phần lẻ thì ghi ${int},${frac.replace(/0+$/,'')||'0'}`};
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
/** Round a canonical decimal half up to `places` decimals, on the digits (never through a float). */
export function roundDecimal(value:string,places:number):string{
  const neg=value.startsWith('-'),[int,dec='']=value.replace(/^-/,'').split('.');
  const scaled=BigInt((int||'0')+(dec+'0'.repeat(places+1)).slice(0,places+1)),rounded=(scaled+BigInt(5))/BigInt(10);
  const s=rounded.toString().padStart(places+1,'0'),out=places?s.slice(0,-places)+'.'+s.slice(-places):s;
  return (neg&&rounded>BigInt(0)?'-':'')+out;
}
const fixed2=(value:string)=>{const r=roundDecimal(value,2),[i,d]=r.replace(/^-/,'').split('.');return (r.startsWith('-')?'-':'')+group(i)+','+d;};
/** US dollars: "$0,00", "$18,50", "-$5,00". Only USD uses the dollar sign. */
export function formatUsd(value:string):string{const t=fixed2(value);return t.startsWith('-')?'-$'+t.slice(1):'$'+t;}
/** One amount with its own currency. USDT is shown with 2 decimals unless `exact` (the stored precision); VND as ₫. */
export function formatMoney(value:string,currency:string,opts:{exact?:boolean}={}):string{
  const c=currency.toUpperCase();
  if(c==='USD')return opts.exact?(value.startsWith('-')?'-$':'$')+viNumber(value.replace(/^-/,'')):formatUsd(value);
  if(c==='VND')return viNumber(value)+' ₫';
  return (opts.exact?viNumber(value):fixed2(value))+' '+c;
}
/** Ledger amounts with their unit: USD as "$1.234,50", other currencies with every recorded decimal ("420.000 ₫", "16,26646 USDT"). */
export function formatLedger(value:string,currency:string):string{return currency.toUpperCase()==='USD'?formatUsd(value):formatMoney(value,currency,{exact:true});}
