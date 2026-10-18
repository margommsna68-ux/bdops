// Display helpers for Lịch sử nhập kho. Amounts come as exact decimal strings from the cost ledger; they are shown in Vietnamese
// format (1.250.000,5) keeping every significant decimal, never rounded through a float.
export function viAmount(value:string|null|undefined):string{
  if(!value)return '';
  const neg=value.startsWith('-'),[int,dec='']=value.replace(/^-/,'').split('.'),frac=dec.replace(/0+$/,'');
  const grouped=(int.replace(/^0+(?=\d)/,'')||'0').replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  return (neg?'-':'')+grouped+(frac?','+frac:'');
}
// Purchase date (YYYY-MM-DD, the day bought — not the day imported) as dd/MM/yyyy.
export const viDate=(ymd:string|null|undefined)=>ymd&&/^\d{4}-\d{2}-\d{2}/.test(ymd)?ymd.slice(8,10)+'/'+ymd.slice(5,7)+'/'+ymd.slice(0,4):'';
// Ledger money: Vietnamese format with at least two decimals (46,00 · 1.234,50), more only when recorded.
export function viMoney(value:string|null|undefined):string{
  if(!value)return '';const [int,dec='']=value.replace(/^-/,'').split('.'),neg=value.startsWith('-')&&/[1-9]/.test(value);
  const frac=(dec.replace(/0+$/,'')+'00').slice(0,Math.max(2,dec.replace(/0+$/,'').length));
  return (neg?'-':'')+(int.replace(/^0+(?=\d)/,'')||'0').replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+frac;
}
