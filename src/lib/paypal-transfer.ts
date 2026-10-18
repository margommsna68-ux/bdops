// One rule for a PayPal transfer / withdrawal (review 18/10/2026), used by TransferForm while typing and by recordTransfer before
// writing, so the screen and the server never disagree:
// - "Tổng PP bị trừ" (debited) is what the source PayPal lost, in the source currency. The source fee is in that currency and
//   already inside the total (0 ≤ fee < debited); it is never subtracted again.
// - The receiving side gets: round_half_up((debited − fee) × rate, 2 decimals) − receiver fee. Same currency: rate 1 (no rate is
//   typed). A fee charged on the receiving side is its own field, in the receiving currency; nothing else may explain a gap.
// - An internal transfer must state what the receiving PayPal got; a withdrawal outside only when it is known. A stated amount
//   must equal the computed one exactly; otherwise the field says what it should be.
// Pure integer arithmetic (cents, rate scaled by 1e12) so the browser and the server compute the same digits.
export type TransferErrors=Partial<Record<'debited'|'fee'|'received'|'rate'|'receiverFee',string>>;
export interface TransferCheckInput {type:'EXCHANGE'|'MIXING';currency:string;receivedCurrency?:string|null;debited?:string|null;fee?:string|null;received?:string|null;rate?:string|null;receiverFee?:string|null}
const RATE_SCALE=BigInt('1000000000000');
const norm=(raw:string)=>{const t=raw.trim().replace(/\s/g,'');return /^\d+,\d{1,2}$/.test(t)?t.replace(',','.'):t.replace(/,(?=\d{3}(\D|$))/g,'');};
// Money with at most 2 decimals → cents; null = empty; a string = what is wrong.
export function moneyCents(raw:string|null|undefined,label:string,allowZero=false):bigint|null|string{
  if(raw==null||!raw.trim())return null;const n=norm(raw);
  if(!/^(0|[1-9]\d{0,13})(\.\d{1,2})?$/.test(n))return label+' phải là số, tối đa 2 chữ số thập phân';
  const [i,d='']=n.split('.'),c=BigInt(i)*BigInt(100)+BigInt((d+'00').slice(0,2));
  if(!allowZero&&c<=BigInt(0))return label+' phải lớn hơn 0';return c;
}
function rateScaled(raw:string|null|undefined):bigint|null|string{
  if(raw==null||!raw.trim())return null;const n=raw.trim().replace(/\s/g,'').replace(',','.');
  if(!/^\d{1,12}(\.\d{1,12})?$/.test(n))return 'Tỷ giá là số dương, tối đa 12 chữ số thập phân';
  const [i,d='']=n.split('.'),v=BigInt(i)*RATE_SCALE+BigInt((d+'000000000000').slice(0,12));return v>BigInt(0)?v:'Tỷ giá phải lớn hơn 0';
}
export const centsText=(c:bigint)=>{const neg=c<BigInt(0),a=neg?-c:c,s=a.toString().padStart(3,'0');return (neg?'-':'')+s.slice(0,-2)+'.'+s.slice(-2);};
// Vietnamese display: 750.000,00
export const viCents=(c:bigint)=>{const [i,d]=centsText(c).split('.');return i.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+d;};
export function checkTransfer(input:TransferCheckInput){
  const errors:TransferErrors={},cur=input.currency.trim().toUpperCase(),rc=(input.receivedCurrency||cur).trim().toUpperCase(),same=rc===cur;
  const debited=moneyCents(input.debited,'Tổng PP bị trừ'),fee=moneyCents(input.fee,'Phí',true),received=moneyCents(input.received,'Số bên nhận thực nhận'),rfee=moneyCents(input.receiverFee,'Phí bên nhận',true),rate=rateScaled(input.rate);
  if(debited===null)errors.debited='Nhập tổng PP bị trừ (gồm phí)';else if(typeof debited==='string')errors.debited=debited;
  if(typeof fee==='string')errors.fee=fee;else if(fee!==null&&typeof debited==='bigint'&&fee>=debited)errors.fee='Phí nằm trong tổng PP bị trừ: phải nhỏ hơn '+viCents(debited)+' '+cur;
  if(typeof received==='string')errors.received=received;
  if(typeof rfee==='string')errors.receiverFee=rfee;
  if(same&&rate!==null)errors.rate='Cùng đồng tiền '+cur+': không ghi tỷ giá';
  else if(!same&&typeof rate==='string')errors.rate=rate;
  else if(!same&&rate===null&&(received!==null||rfee!==null||input.type==='MIXING'))errors.rate='Khác đồng tiền: ghi tỷ giá thực dùng (1 '+cur+' = ? '+rc+')';
  let expected:bigint|null=null;
  if(typeof debited==='bigint'&&typeof fee!=='string'&&!errors.fee&&(same||typeof rate==='bigint')&&typeof rfee!=='string'){
    const net=debited-(fee??BigInt(0)),gross=same?net:(net*(rate as bigint)+RATE_SCALE/BigInt(2))/RATE_SCALE;
    expected=gross-(rfee??BigInt(0));
    if(expected<=BigInt(0)){errors.receiverFee='Phí bên nhận phải nhỏ hơn '+viCents(gross)+' '+rc;expected=null;}
  }
  if(received===null){if((input.type==='MIXING'||rfee!==null)&&!errors.received)errors.received=(input.type==='MIXING'?'Chuyển nội bộ: ghi số bên nhận thực nhận':'Có phí bên nhận: ghi số bên nhận thực nhận')+(expected!==null?' ('+viCents(expected)+' '+rc+')':'');}
  else if(typeof received==='bigint'&&expected!==null&&received!==expected)
    errors.received='Bên nhận phải nhận '+viCents(expected)+' '+rc+' = ('+viCents(debited as bigint)+' − phí '+viCents((fee as bigint|null)??BigInt(0))+')'+(same?'':' × '+String(input.rate).trim())+(rfee?' − phí bên nhận '+viCents(rfee as bigint):'')+'. Sửa số nhận'+(same?' hoặc phí':', phí hoặc tỷ giá')+(rfee?'':'; nếu bên nhận bị trừ phí riêng, ghi ở Phí bên nhận');
  return {errors,expected:expected===null?null:centsText(expected),receivedCurrency:rc,same};
}
// TransferForm state (UI review 18/10/2026): while the received amount is untyped it is derived whenever it must be stated (internal
// transfer, other currency, or a receiver fee typed); a typed amount is the user's and only checked. Every typed value is sent, so
// the server refuses what does not add up instead of the form dropping it.
export interface TransferDraftInput {type:'EXCHANGE'|'MIXING';currency:string;recvCur:string;debited:string;fee:string;rate:string;recvFee:string;received:string;auto:boolean}
export function transferDraft(d:TransferDraftInput){
  const rc=(d.recvCur||d.currency).toUpperCase(),same=rc===d.currency.toUpperCase(),hasFee=!!d.recvFee.trim();
  const base={type:d.type,currency:d.currency,receivedCurrency:rc,debited:d.debited,fee:d.fee,rate:same?null:d.rate,receiverFee:d.recvFee};
  const computed=checkTransfer({...base,received:null}).expected,autoOn=d.auto&&(d.type==='MIXING'||!same||hasFee),shown=autoOn?computed||'':d.received;
  const sent=!!shown.trim(),errors=checkTransfer({...base,received:shown||null}).errors;
  const payload={received:sent?shown.trim():null,receivedCurrency:sent||d.type==='MIXING'||hasFee?rc:null,rate:(sent||hasFee)&&!same?d.rate.trim()||null:null,receiverFee:d.recvFee.trim()||null};
  return {rc,same,computed,autoOn,shown,sent,errors,payload};
}
