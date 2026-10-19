// Accumulated money next to an SDK (owner brief 19/10/2026): the latest total recorded by an operator, USD by default. It is not a
// price, a cost, income or a PayPal receipt. null = not recorded yet ("Chưa ghi tiền"), which is different from a recorded 0.
// Shared by the server checks and the forms so "12,40", "12.40" and "1.234,56" mean the same everywhere.
export const SDK_CURRENCY='USD';
export const SDK_NOTE_MAX=1000;
const MAX=1_000_000_000;
// One separator = decimal mark (Vietnamese "12,40" or "12.40"). Both "." and ",": the last one is the decimal mark, the other groups
// thousands ("1.234,56" / "1,234.56"). At most 6 decimals; no negative amounts.
export function parseSdkAmount(text:string):{value:string}|{error:string}{
  let t=text.trim().replace(/\s+/g,'').replace(/(usd|\$)$/i,'').replace(/^\$/,'');
  if(!t)return {error:'Chưa nhập số tiền'};
  if(t.startsWith('-'))return {error:'Tiền tích luỹ không âm'};
  const dot=t.lastIndexOf('.'),comma=t.lastIndexOf(',');
  if(dot>=0&&comma>=0){const dec=dot>comma?'.':',',group=dec==='.'?',':'.';t=t.split(group).join('');if(t.split(dec).length>2)return {error:'Số tiền không hợp lệ'};t=t.replace(dec,'.');}
  else if(comma>=0){if(t.split(',').length>2)return {error:'Số tiền không hợp lệ'};t=t.replace(',','.');}
  else if(t.split('.').length>2)return {error:'Số tiền không hợp lệ'};
  if(!/^\d+(\.\d+)?$/.test(t))return {error:'Số tiền không hợp lệ (ví dụ 12,40)'};
  const [whole,frac='']=t.split('.');if(frac.length>6)return {error:'Tối đa 6 chữ số thập phân'};
  if(Number(t)>=MAX)return {error:'Số tiền quá lớn'};
  const w=whole.replace(/^0+(?=\d)/,''),f=frac.replace(/0+$/,'');return {value:f?w+'.'+f:w};
}
// Canonical form of a stored Decimal string ("12.400000" → "12.4") so comparisons never see a change that is not there.
export function canonicalAmount(value:string|null|undefined){if(value===null||value===undefined)return null;const r=parseSdkAmount(String(value));return 'value' in r?r.value:String(value);}
export function formatSdkAmount(value:string|null|undefined,currency=SDK_CURRENCY){
  if(value===null||value===undefined)return null;const n=Number(value);if(!Number.isFinite(n))return String(value)+' '+currency;
  const decimals=Math.min(6,Math.max(2,(canonicalAmount(value)!.split('.')[1]||'').length));
  return n.toLocaleString('vi-VN',{minimumFractionDigits:2,maximumFractionDigits:decimals})+' '+currency;
}
// Text typed into the form shown back in the same style ("12.4" → "12,40").
export function amountInput(value:string|null|undefined){if(value===null||value===undefined)return '';const n=Number(value);return Number.isFinite(n)?n.toLocaleString('vi-VN',{minimumFractionDigits:2,maximumFractionDigits:6,useGrouping:false}):String(value);}
export type SdkLinkState='UNLINKED'|'LINKED'|'UNCONFIRMED';
// 20/10/2026: "Đã dùng" = the code was put into an EarnApp account (final); "Chưa dùng" = still available.
export const SDK_STATE_LABEL:Record<SdkLinkState,string>={UNLINKED:'Chưa dùng',LINKED:'Đã dùng',UNCONFIRMED:'Chưa xác nhận'};
