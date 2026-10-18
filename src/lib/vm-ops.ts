// VM operation cycle (owner brief 18/10/2026), shared by the Server/VM grid, Kho tài khoản and the server so labels, priority and
// money states are computed the same way everywhere. Pure functions, exact cents (no floating point).
export const VM_OPS_STATUSES=['OK','NOT_LINKED','OFF','PROXY_BLOCKED','LINKED','EARN_ERROR','SUSPENDED','DELETED','NEW_VM','MAIL_LOGGED'] as const;
export type VmOpsStatus=typeof VM_OPS_STATUSES[number];
// Label and tone (CSS class suffix). The text always says the state; colour only helps.
export const VM_OPS:Record<VmOpsStatus,{label:string;tone:string;hint:string}>={
  OK:{label:'OK',tone:'ok',hint:'Người / AI đã kiểm tra và xác nhận vận hành tốt'},
  NOT_LINKED:{label:'Chưa nối',tone:'warn',hint:'SDK chưa nối vào tài khoản EarnApp'},
  OFF:{label:'OFF VM',tone:'muted',hint:'VM đang tắt'},
  PROXY_BLOCKED:{label:'Blocked',tone:'danger',hint:'Proxy bị blocked, cần xử lý / thay'},
  LINKED:{label:'LINKED',tone:'info',hint:'SDK đã nối EarnApp; chưa phải đã kiểm tra vận hành tốt'},
  EARN_ERROR:{label:'Earn/VM lỗi',tone:'orange',hint:'Cần kiểm tra EarnApp hoặc VM'},
  SUSPENDED:{label:'SUS',tone:'severe',hint:'Tài khoản EarnApp bị suspend vĩnh viễn'},
  DELETED:{label:'VM deleted',tone:'muted',hint:'Máy thực tế đã xoá; vị trí và lịch sử vẫn giữ trên web'},
  NEW_VM:{label:'New VM',tone:'fresh',hint:'Máy mới / tạo lại, đang chuẩn bị cài'},
  MAIL_LOGGED:{label:'Đã login mail',tone:'violet',hint:'Đã đăng nhập Gmail / Apple ID; bước tiếp là tạo EarnApp'},
};
export const NO_STATUS_LABEL='Chưa ghi';
export const opsLabel=(s:VmOpsStatus|null|undefined)=>s?VM_OPS[s].label:NO_STATUS_LABEL;
// Money milestone of the current round (computed from the payout request and the PayPal book, never picked by hand).
export type Milestone=''|'WAITING'|'RECREATE'|'MONEY_REVIEW'|'FAILED';
export const MILESTONE_LABEL:Record<Exclude<Milestone,''>,string>={WAITING:'Chờ tiền về',RECREATE:'Cần tạo lại VM',MONEY_REVIEW:'Cần đối chiếu tiền',FAILED:'Rút thất bại / huỷ'};
// "Cần xử lý trước": SUS, proxy BLOCKED, Earn/VM lỗi, needs recreating, OFF, waiting for money, then the preparation steps and OK.
export function opsPriority(v:{status:VmOpsStatus|null;proxyBlocked:boolean;milestone:Milestone}){
  if(v.status==='SUSPENDED')return 0;
  if(v.proxyBlocked||v.status==='PROXY_BLOCKED')return 1;
  if(v.status==='EARN_ERROR'||v.milestone==='MONEY_REVIEW')return 2;
  if(v.milestone==='RECREATE')return 3;
  if(v.status==='OFF'||v.status==='DELETED')return 4;
  if(v.milestone==='WAITING')return 5;
  return ({NEW_VM:6,MAIL_LOGGED:7,NOT_LINKED:8,LINKED:9} as Record<string,number>)[v.status||'']??(v.status==='OK'?11:10);
}
// ─── Money (cents) ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const toCents=(v:string|number)=>{const t=String(v).trim(),neg=t.startsWith('-'),[i,d='']=(neg?t.slice(1):t).split('.');return (neg?-1:1)*(Number(i)*100+Number((d+'00').slice(0,2)));};
export const fromCents=(c:number)=>{const neg=c<0,a=Math.abs(c);return (neg?'-':'')+Math.floor(a/100)+'.'+String(a%100).padStart(2,'0');};
export interface RequestMoneyInput {amount:string;currency:string;state:string;settledAt:string|null;shortfall:string|null;consumedAt:string|null;receipts:{amount:string;currency:string;confirmed:boolean;failed:boolean;voided:boolean}[]}
export type RequestPhase='WAITING'|'RECEIVED'|'REVIEW'|'FAILED'|'CANCELLED';
// One payout request against the PayPal book: received = confirmed linked receipts; a linked pending receipt is part of what is
// still to come (never added on top). Exactly the requested amount = received in full. Less is still waiting unless a person
// settled the gap with a stated reason; more, or money in another currency, needs reconciling.
export function requestMoney(r:RequestMoneyInput){
  const live=r.receipts.filter(x=>!x.voided&&!x.failed),same=live.filter(x=>x.currency===r.currency);
  const received=same.filter(x=>x.confirmed).reduce((a,x)=>a+toCents(x.amount),0),pendingLinked=same.filter(x=>!x.confirmed).reduce((a,x)=>a+toCents(x.amount),0);
  const amount=toCents(r.amount),short=r.settledAt&&r.shortfall?toCents(r.shortfall):0,other=live.some(x=>x.currency!==r.currency);
  let phase:RequestPhase;
  if(r.state==='CANCELLED')phase='CANCELLED';else if(r.state==='FAILED')phase='FAILED';
  else if(received>amount||other)phase='REVIEW';
  else if(received===amount||short>0&&received+short===amount)phase='RECEIVED';
  else phase='WAITING';
  const remaining=phase==='WAITING'?amount-received:0;
  // The VM was already recreated with this money but it no longer adds up (a receipt was voided / changed): reconcile, the VM
  // stays in its new round.
  const reviewAfterRecreate=!!r.consumedAt&&phase!=='RECEIVED';
  return {phase,received:fromCents(received),pendingLinked:fromCents(pendingLinked),remaining:fromCents(remaining),reviewAfterRecreate};
}
export function milestoneOf(m:{phase:RequestPhase;consumed:boolean}|null):Milestone{
  if(!m)return '';if(m.phase==='WAITING')return 'WAITING';if(m.phase==='RECEIVED')return m.consumed?'':'RECREATE';if(m.phase==='REVIEW')return 'MONEY_REVIEW';return 'FAILED';
}
// ─── PayPal gathering label (USD only; 100 USD is the minimum target of a PP code, not a cap) ─────────────────────────────────
export const GATHER_TARGET_CENTS=10000;
export type Gather='GATHERING'|'PROJECTED'|'REACHED';
export const GATHER_LABEL:Record<Gather,string>={GATHERING:'Đang gom',PROJECTED:'Dự kiến đủ 100 USD',REACHED:'Đạt mức gom'};
export function gatherOf(balanceUsd:string|null,pendingUsd:string|null,extra='0'){
  const b=balanceUsd==null?0:toCents(balanceUsd),p=pendingUsd==null?0:toCents(pendingUsd),x=toCents(extra||'0');
  const state:Gather=b>=GATHER_TARGET_CENTS?'REACHED':b+p>=GATHER_TARGET_CENTS?'PROJECTED':'GATHERING';
  return {state,label:GATHER_LABEL[state],missing:fromCents(Math.max(0,GATHER_TARGET_CENTS-b)),missingAfterPending:fromCents(Math.max(0,GATHER_TARGET_CENTS-b-p)),projected:fromCents(b+p),projectedWith:fromCents(b+p+x)};
}
// PayPal health states (kept as they are; changed at the cell / in bulk in Kho tài khoản).
export const PP_STATUS_LABEL:Record<string,string>={ACTIVE:'Dùng được',PENDING_VERIFY:'Chờ xác minh',LIMITED:'Bị limit',SUSPENDED:'Bị suspend',CLOSED:'Đã đóng'};
