import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {toCents,fromCents} from '@/lib/vm-ops';
// One payout frame (owner 28/10/2026) for the Tiền VM cell, the VM panel and the "Rút EarnApp" report: pure rules, no React.
type RouterOutputs=inferRouterOutputs<AppRouter>;
export type VmOpsRequestView=NonNullable<RouterOutputs['vmOps']['board']['vms'][number]['request']>;
export type FrameAction='SEND'|'DROP'|'EDIT'|'UNSEND'|'RECEIPT'|'SETTLE'|'SUS'|'FAIL'|'RETRY'|'VOID';
export type FrameRights={writeMoney:boolean;payout?:boolean;receipt?:boolean;assign:boolean};
export interface FrameView {phase:string;submission:string;state:string;hasReceipts:boolean;consumed:boolean;rights:FrameRights}
/**
 * Which buttons the frame shows. "Rút" (no request yet) lives at the Tiền VM cell, so no request → nothing here. Edit / unsend /
 * void / failed / retry need the money write right; "Đã rút" / "Bỏ" the payout right (or money write); "Tiền đã về" the receipt
 * right; "EarnApp bị SUS" the assign right. The server checks every rule again.
 */
export function payoutActions(v:FrameView|null):FrameAction[]{
  if(!v||v.consumed)return [];
  const r=v.rights,payout=!!(r.writeMoney||r.payout),receipt=!!(r.receipt??r.writeMoney),write=!!r.writeMoney,sus=!!r.assign;
  const out:(FrameAction|false)[]=[];
  if(v.state==='FAILED'||v.state==='CANCELLED')out.push(write&&'RETRY');
  else if(v.phase==='LOST'||v.state==='LOST_SUS')out.push(receipt&&'RECEIPT');
  // Received more than asked / another currency: reconcile in the PayPal book; only "Thất bại" is offered here.
  else if(v.state==='REQUESTED'&&v.phase==='REVIEW')out.push(write&&'FAIL');
  else if(v.state==='REQUESTED'&&v.phase==='WAITING'){
    if(v.submission==='PREPARING')out.push(payout&&'SEND',payout&&'DROP',write&&'EDIT',sus&&'SUS');
    else if(v.submission==='UNKNOWN')out.push(payout&&'SEND',write&&'EDIT',write&&'UNSEND',sus&&'SUS',write&&'FAIL');
    else if(v.hasReceipts)out.push(receipt&&'RECEIPT',write&&'SETTLE',sus&&'SUS');
    else out.push(receipt&&'RECEIPT',write&&'EDIT',write&&'UNSEND',sus&&'SUS',write&&'FAIL');
  }
  return out.filter((a):a is FrameAction=>!!a);
}
/** Money already linked to the request (received or a linked pending receipt). Without money rights the frame cannot tell: false. */
export function requestHasReceipts(m:{received:string;pendingLinked:string}|null|undefined){return !!m&&(m.received!=='0.00'||m.pendingLinked!=='0.00');}
type PickEmail={id:string;own:boolean;dailyAllowed?:boolean;dailyOccupied?:boolean};
export interface PickLike {earnApp:{emailId:string|null}|null;paypals:{id:string;usable:boolean;emails:PickEmail[]}[];suggestion:{paypalId:string}|null}
/**
 * The email "Rút" holds in the same click: the EarnApp's own email (never swapped when today's slot is gone), else the first email
 * of the suggested PayPal that is allowed today and not already counted. Nothing usable → an error and nothing is held.
 */
export function pickPayoutEmail(pick:PickLike):{emailId:string}|{error:string}{
  if(!pick.earnApp)return {error:'VM chưa có tài khoản EarnApp ở lượt này; gán tài khoản trước.'};
  const own=pick.paypals.flatMap(p=>p.emails.map(e=>({p,e}))).find(x=>x.e.own||x.e.id===pick.earnApp!.emailId);
  if(own)return own.e.dailyAllowed!==false?{emailId:own.e.id}:{error:'Email đã gắn với EarnApp này hết lượt hôm nay; không tự đổi email. Rút lại vào ngày mai.'};
  const pp=pick.suggestion?pick.paypals.find(p=>p.id===pick.suggestion!.paypalId):undefined;
  if(!pp)return {error:'Không còn PayPal có email trống dùng được hôm nay.'};
  if(!pp.usable)return {error:'PayPal gợi ý không dùng được hôm nay.'};
  const e=pp.emails.find(x=>!x.own&&x.dailyAllowed!==false&&x.dailyOccupied!==true);
  return e?{emailId:e.id}:{error:'PayPal gợi ý không còn email trống hôm nay.'};
}
/** Default amount of "Rút" = Tiền VM of the current SDK, cut to cents (never rounded up past what was seen). */
export function defaultPayoutAmount(v:string|null|undefined){
  const t=(v??'').trim();if(!/^\d+(\.\d+)?$/.test(t))return '';
  const [i,d='']=t.split('.'),c=Number(i)*100+Number((d+'00').slice(0,2));return c>0?fromCents(c):'';
}
const MONEY=/^\d+([.,]\d{1,2})?$/;
/**
 * "Số tiền chính xác trong PayPal": empty and required. open = what may still arrive (the lost amount for late money after SUS) less a
 * linked pending receipt; fee = open − entered. "Chốt luôn, phần thiếu là phí" is offered while the entry is below the open part.
 */
export function receiptCheck(m:{amount:string;received:string;remaining:string;pendingLinked:string;lost:string|null;phase?:string},entered:string){
  const base=m.phase==='LOST'&&m.lost?toCents(m.lost):toCents(m.remaining),open=Math.max(0,base-toCents(m.pendingLinked)),t=entered.trim();
  const none={valid:false,amount:null as string|null,fee:null as string|null,showSettle:false,open:fromCents(open),error:''};
  if(!t)return none;
  if(!MONEY.test(t))return {...none,error:'Số tiền là số dương, tối đa 2 chữ số thập phân'};
  const c=toCents(t.replace(',','.'));if(c<=0)return {...none,error:'Số tiền phải lớn hơn 0'};
  if(c>open)return {...none,error:'Số tiền vượt phần còn chờ ('+fromCents(open)+'); đối chiếu trước khi ghi'};
  return {valid:true,amount:fromCents(c),fee:fromCents(open-c),showSettle:c<open,open:fromCents(open),error:''};
}
// Lost answers (pattern of PayoutBulkPanel): the command (key + exact body) is written to this tab before sending; a retry sends it again.
export const FRAME_ACTIONS=['REQUEST','SEND','DROP','EDIT','UNSEND','RECEIPT','SETTLE','SUS','FAIL','RETRY','VOID'] as const;
export type FrameCommandAction=typeof FRAME_ACTIONS[number];
export interface FrameCommand {action:FrameCommandAction;target:string;body:{projectId:string;key:string}&Record<string,unknown>}
export const frameJournalKey=(projectId:string,userId:string,target:string)=>'mth-payout-frame:'+JSON.stringify([projectId,userId,target]);
export function readFrameCommand(raw:string|null,projectId:string,target:string):FrameCommand|null{
  if(!raw)return null;
  try{const c=JSON.parse(raw) as FrameCommand;
    if(!c||typeof c!=='object'||c.target!==target||!(FRAME_ACTIONS as readonly string[]).includes(c.action)||!c.body||c.body.projectId!==projectId||typeof c.body.key!=='string'||c.body.key.length<8)return null;
    return c;}catch{return null;}
}
const REFUSED=['BAD_REQUEST','UNAUTHORIZED','FORBIDDEN','NOT_FOUND','CONFLICT','PRECONDITION_FAILED','TOO_MANY_REQUESTS','UNPROCESSABLE_CONTENT'];
/** A definite refusal of the server (not a lost answer): the command was not recorded. */
export function refusedAnswer(e:unknown){const code=(e as {data?:{code?:string}})?.data?.code;return !!code&&REFUSED.includes(code);}
export const bangkokDay=(at=new Date())=>new Date(at.getTime()+7*3600000).toISOString().slice(0,10);
/** Display label of a request (spec "Nhãn trạng thái"); data keeps state / submission. */
export function requestLabel(r:{state:string;submission:string;phase:string;settled?:boolean;money?:{shortfall:string|null}|null}){
  if(r.phase==='LOST'||r.state==='LOST_SUS')return 'Mất do SUS';
  if(r.state==='FAILED')return 'Thất bại';if(r.state==='CANCELLED')return 'Đã huỷ';
  if(r.submission==='PREPARING')return 'Đang rút, chưa xác nhận';if(r.submission==='UNKNOWN')return 'Chưa rõ đã rút chưa';
  if(r.phase==='RECEIVED')return r.money?.shortfall&&r.money.shortfall!=='0.00'?'Về thiếu (đã chốt)':'Đã về';
  if(r.phase==='REVIEW')return 'Cần đối chiếu tiền';
  return 'Đã rút, chờ tiền';
}
/**
 * What the frame says after an answer (final review 28/10/2026): an answer with changed:false recorded nothing, so it never reads as
 * "Đã ghi …" (e.g. "EarnApp bị SUS" on a VM already SUS with nothing left to close). null = use the normal done message.
 */
export function unchangedMessage(action:FrameCommandAction,answer:unknown):string|null{
  if(!answer||typeof answer!=='object'||(answer as {changed?:unknown}).changed!==false)return null;
  return action==='SUS'?'EarnApp đã ghi SUS từ trước, không còn yêu cầu rút mở: không có gì thay đổi':'Không có gì thay đổi (đã ghi trước đó)';
}