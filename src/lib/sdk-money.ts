import {parseMoneyNumber,US_DECIMAL_HINT} from './money-input';
// Accumulated money next to an SDK (owner brief 19/10/2026): the latest total recorded by an operator, USD by default. It is not a
// price, a cost, income or a PayPal receipt. null = not recorded yet ("Chưa ghi tiền"), which is different from a recorded 0.
// Shared by the server checks and the forms so "12.40", "1,234.56" and "1234.56" mean the same everywhere (US number format, owner
// decision 28/10/2026: "." decimal point, "," optional thousands separator; a decimal comma such as "12,40" is refused).
export const SDK_CURRENCY='USD';
export const SDK_NOTE_MAX=1000;
const MAX=1_000_000_000;
// At most 6 decimals; no negative amounts.
export function parseSdkAmount(text:string):{value:string}|{error:string}{
  const t=text.trim().replace(/\s+/g,'').replace(/(usd|\$)$/i,'').replace(/^\$/,'');
  if(!t)return {error:'Chưa nhập số tiền'};
  if(t.startsWith('-'))return {error:'Tiền tích luỹ không âm'};
  if(!/^[\d.,]+$/.test(t))return {error:'Số tiền không hợp lệ (ví dụ 12.40)'};
  // A lone "12,345" (old meaning 12.345) is ambiguous with 6 decimals allowed: refused with "Ghi rõ: 12345 hoặc 12.345" (review 29/10/2026).
  const p=parseMoneyNumber(t,{fraction:6,strictComma:true});
  if(p.error||p.value===null)return {error:p.error===US_DECIMAL_HINT||p.error?.startsWith('Ghi rõ')?p.error:p.error&&/^Tối đa/.test(p.error)?'Tối đa 6 chữ số thập phân':p.error==='Số quá lớn'?'Số tiền quá lớn':'Số tiền không hợp lệ (ví dụ 12.40)'};
  if(Number(p.value)>=MAX)return {error:'Số tiền quá lớn'};
  return {value:p.value};
}
// Canonical form of a stored Decimal string ("12.400000" → "12.4") so comparisons never see a change that is not there.
export function canonicalAmount(value:string|null|undefined){if(value===null||value===undefined)return null;const r=parseSdkAmount(String(value));return 'value' in r?r.value:String(value);}
export function formatSdkAmount(value:string|null|undefined,currency=SDK_CURRENCY){
  if(value===null||value===undefined)return null;const n=Number(value);if(!Number.isFinite(n))return String(value)+' '+currency;
  const decimals=Math.min(6,Math.max(2,(canonicalAmount(value)!.split('.')[1]||'').length));
  return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:decimals})+' '+currency;
}
// Text typed into the form shown back in the same style ("12.4" → "12.40").
export function amountInput(value:string|null|undefined){if(value===null||value===undefined)return '';const n=Number(value);return Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:6,useGrouping:false}):String(value);}
export type SdkLinkState='UNLINKED'|'LINKED'|'UNCONFIRMED';
// 20/10/2026: "Đã dùng" = the code was put into an EarnApp account (final); "Chưa dùng" = still available.
export const SDK_STATE_LABEL:Record<SdkLinkState,string>={UNLINKED:'Chưa dùng',LINKED:'Đã dùng',UNCONFIRMED:'Chưa xác nhận'};
