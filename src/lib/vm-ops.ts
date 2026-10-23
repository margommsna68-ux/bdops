import {formatUsd} from './money-input';
// VM operation cycle (owner brief 18/10/2026), shared by the Server/VM grid, Kho tài khoản and the server so labels, priority and
// money states are computed the same way everywhere. Pure functions, exact cents (no floating point).
export const VM_OPS_STATUSES=['OK','NOT_LINKED','OFF','PROXY_BLOCKED','LINKED','EARN_ERROR','SUSPENDED','DELETED','NEW_VM','MAIL_LOGGED','PROXY_PENDING'] as const;
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
  NEW_VM:{label:'Chưa cài',tone:'fresh',hint:'VM chưa hoàn tất cài máy, proxy, EarnApp, Firefox và lưu SDK'},
  MAIL_LOGGED:{label:'Đã login mail',tone:'violet',hint:'Đã đăng nhập Gmail / Apple ID; bước tiếp là tạo EarnApp'},
  // 21/10/2026: the web has the new proxy (replaced after Blocked); the real machine still has to apply it and be checked.
  PROXY_PENDING:{label:'Chờ áp dụng proxy',tone:'pending',hint:'Web đã có proxy mới; máy thật chưa áp dụng / chưa kiểm tra'},
};
export const NO_STATUS_LABEL='Chưa ghi';
export const opsLabel=(s:VmOpsStatus|null|undefined)=>s?VM_OPS[s].label:NO_STATUS_LABEL;
// Money milestone of the current round (computed from the payout request and the PayPal book, never picked by hand).
export type Milestone=''|'WAITING'|'RECREATE'|'MONEY_REVIEW'|'FAILED'|'PREPARING'|'UNKNOWN';
export const MILESTONE_LABEL:Record<Exclude<Milestone,''>,string>={WAITING:'Chờ tiền về',RECREATE:'Cần tạo lại VM',MONEY_REVIEW:'Cần đối chiếu tiền',FAILED:'Rút thất bại / huỷ',PREPARING:'Đang chuẩn bị rút',UNKNOWN:'Chưa xác định kết quả rút'};
// "Cần xử lý trước": SUS, proxy BLOCKED, Earn/VM lỗi, needs recreating, OFF, waiting for money, then the preparation steps and OK.
export function opsPriority(v:{status:VmOpsStatus|null;proxyBlocked:boolean;milestone:Milestone}){
  if(v.status==='SUSPENDED')return 0;
  if(v.proxyBlocked||v.status==='PROXY_BLOCKED')return 1;
  if(v.status==='PROXY_PENDING')return 1;
  if(v.status==='EARN_ERROR'||v.milestone==='MONEY_REVIEW'||v.milestone==='UNKNOWN')return 2;
  if(v.milestone==='RECREATE')return 3;
  if(v.status==='OFF'||v.status==='DELETED')return 4;
  if(v.milestone==='WAITING'||v.milestone==='PREPARING')return 5;
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
export function milestoneOf(m:{phase:RequestPhase;consumed:boolean;submission?:string}|null):Milestone{
  if(!m)return '';
  // Not sent on EarnApp yet, or the send could not be confirmed: never "Chờ tiền về" (owner brief 20/10/2026).
  if(m.phase==='WAITING'&&m.submission==='PREPARING')return 'PREPARING';if(m.phase==='WAITING'&&m.submission==='UNKNOWN')return 'UNKNOWN';
  if(m.phase==='WAITING')return 'WAITING';if(m.phase==='RECEIVED')return m.consumed?'':'RECREATE';if(m.phase==='REVIEW')return 'MONEY_REVIEW';return 'FAILED';
}
// ─── PayPal gathering label (USD only; 100 USD is the minimum target of a PP code, not a cap) ─────────────────────────────────
export const GATHER_TARGET_CENTS=10000;
export type Gather='GATHERING'|'PROJECTED'|'REACHED';
// Labels carry the unit (owner brief 19/10/2026: the host showed "0" and "Đang gom · thiếu 100,00"). Only USD uses "$".
export const GATHER_LABEL:Record<Gather,string>={GATHERING:'Đang gom',PROJECTED:'Dự kiến đủ $100,00',REACHED:'Đạt mức gom $100,00'};
/** One line for a PP: "Đang gom · thiếu $100,00", "Dự kiến đủ $100,00" (only with money still to come), "Đạt mức gom $100,00" (book balance). */
export function gatherText(g:{state:Gather;label:string;missing:string}){return g.state==='GATHERING'?g.label+' · thiếu '+formatUsd(g.missing):g.label;}
export function gatherOf(balanceUsd:string|null,pendingUsd:string|null,extra='0'){
  const b=balanceUsd==null?0:toCents(balanceUsd),p=pendingUsd==null?0:toCents(pendingUsd),x=toCents(extra||'0');
  const state:Gather=b>=GATHER_TARGET_CENTS?'REACHED':b+p>=GATHER_TARGET_CENTS?'PROJECTED':'GATHERING';
  return {state,label:GATHER_LABEL[state],missing:fromCents(Math.max(0,GATHER_TARGET_CENTS-b)),missingAfterPending:fromCents(Math.max(0,GATHER_TARGET_CENTS-b-p)),projected:fromCents(b+p),projectedWith:fromCents(b+p+x)};
}
// PayPal health states (kept as they are; changed at the cell / in bulk in Kho tài khoản).
export const PP_STATUS_LABEL:Record<string,string>={ACTIVE:'Dùng được',PENDING_VERIFY:'Chờ xác minh',LIMITED:'Bị limit',SUSPENDED:'Bị suspend',CLOSED:'Đã đóng'};

// ─── EarnApp balance at the VM (owner brief 20/10/2026) ───────────────────────────────────────────────────────────────────────
// A balance is what a person / AI read on the EarnApp account (never SDK notes, never income). "Có thể rút" only when the
// withdrawal condition was observed (withdrawable YES); a bare balance is "Chưa kiểm tra điều kiện rút". A figure older than
// BALANCE_STALE_HOURS is shown as old and asks for a new check.
export const BALANCE_STALE_HOURS=24;
export type Withdrawable='YES'|'NO'|'UNKNOWN';
export interface BalanceCheckView {outcome:'OK'|'FAILED';amount:string|null;currency:string;withdrawable:Withdrawable;checkedAt:string;failure?:string|null;condition?:string|null;/** A note exists but is shown only with the balance read right. */noteHidden?:boolean}
export const WITHDRAWABLE_LABEL:Record<Withdrawable,string>={YES:'Có thể rút',NO:'Chưa đủ điều kiện rút',UNKNOWN:'Chưa kiểm tra điều kiện rút'};
export function balanceState(b:{latest:BalanceCheckView|null;lastOk:BalanceCheckView|null},now:Date=new Date()){
  if(!b.latest)return {kind:'UNCHECKED' as const};
  const stale=(at:string)=>now.getTime()-new Date(at).getTime()>BALANCE_STALE_HOURS*3600e3;
  if(b.latest.outcome==='FAILED')return {kind:'FAILED' as const,at:b.latest.checkedAt,failure:b.latest.failure||null,hidden:!!b.latest.noteHidden,last:b.lastOk};
  return {kind:'OK' as const,at:b.latest.checkedAt,amount:b.latest.amount!,currency:b.latest.currency,zero:toCents(b.latest.amount||'0')===0,stale:stale(b.latest.checkedAt),withdrawable:b.latest.withdrawable,condition:b.latest.condition||null};
}
export const MONEY_FILTERS=['UNCHECKED','WITHDRAWABLE','WAITING','RECEIVED','CHECK'] as const;
export type MoneyFlag=typeof MONEY_FILTERS[number];
export const MONEY_FILTER_LABEL:Record<MoneyFlag,string>={UNCHECKED:'Chưa kiểm tra',WITHDRAWABLE:'Có thể rút',WAITING:'Chờ về PP',RECEIVED:'Đã về PP',CHECK:'Cần kiểm tra'};
/** Which money filters a VM row matches (they are not exclusive: a VM may still show a balance while waiting for PayPal). */
export function moneyFlags(v:{hasEarnApp:boolean;balance:{latest:BalanceCheckView|null;lastOk:BalanceCheckView|null};request:{submission:string;state:string;phase:string}|null},now:Date=new Date()):Record<MoneyFlag,boolean>{
  const b=balanceState(v.balance,now),r=v.request,open=!!r&&r.state==='REQUESTED'&&r.phase==='WAITING';
  return {
    UNCHECKED:v.hasEarnApp&&b.kind==='UNCHECKED',
    WITHDRAWABLE:b.kind==='OK'&&b.withdrawable==='YES'&&!b.stale&&!open&&!(r&&r.phase==='RECEIVED'),
    WAITING:open&&r!.submission==='SENT',
    RECEIVED:!!r&&r.phase==='RECEIVED',
    CHECK:b.kind==='FAILED'||(b.kind==='OK'&&b.stale)||!!r&&(r.phase==='REVIEW'||r.state==='REQUESTED'&&r.submission==='UNKNOWN'),
  };
}
// ─── Suggest a PayPal for a payout (owner brief 20/10/2026) ───────────────────────────────────────────────────────────────────
// The EarnApp's own receiving email always wins (never changed silently). Otherwise: usable PPs with a free email whose projected
// money (book balance + money still to come + money held by payouts being prepared) is still under the $100 target; prefer the one
// this amount brings closest to $100 without going over; if none fits, the one closest to the target. A PP already reached or
// projected to reach $100 is not picked automatically. Without the money rights (balance unknown) nothing is picked.
export interface PaypalCandidate {id:string;code:string;usable:boolean;freeEmails:number;own:boolean;balanceUsd:string|null;pendingUsd:string|null;heldUsd:string}
export function suggestPaypal(list:PaypalCandidate[],amount:string):{paypalId:string;why:string}|null{
  const mine=list.find(p=>p.own);if(mine)return {paypalId:mine.id,why:'EarnApp đã có email nhận ở '+mine.code+'; giữ nguyên, không đổi email'};
  const a=toCents(amount||'0');
  const rows=list.filter(p=>p.usable&&p.freeEmails>0&&p.balanceUsd!==null).map(p=>{const proj=toCents(p.balanceUsd!)+toCents(p.pendingUsd||'0')+toCents(p.heldUsd||'0');return {p,proj};}).filter(x=>x.proj<GATHER_TARGET_CENTS);
  if(!rows.length)return null;
  const fit=rows.filter(x=>x.proj+a<=GATHER_TARGET_CENTS),by=(x:{p:PaypalCandidate;proj:number},y:{p:PaypalCandidate;proj:number})=>y.proj-x.proj||x.p.code.localeCompare(y.p.code,'en',{numeric:true});
  const best=(fit.length?fit:rows).sort(by)[0],after=best.proj+a;
  return {paypalId:best.p.id,why:best.p.code+': đã có / chờ / giữ '+formatUsd(fromCents(best.proj))+', sau khoản này '+formatUsd(fromCents(after))+(after>GATHER_TARGET_CENTS?' (không PP nào vừa đủ; chọn PP gần mục tiêu nhất)':' (gần $100,00 nhất, không vượt)')};
}

// ─── Sort keys and the summary strip (whole filtered result, before paging) ───────────────────────────────────────────────────
export const MONEY_SORTS=['BALANCE','CHECKED_OLD','WAITING_OLD'] as const;
export type MoneySort=typeof MONEY_SORTS[number];
export interface MoneyRow {hasEarnApp:boolean;balance:{latest:BalanceCheckView|null;lastOk:BalanceCheckView|null};request:{submission:string;state:string;phase:string;requestedAt:string;submittedAt?:string|null;money:{remaining:string;currency:string}|null}|null}
/** Comparable key: smaller first. Unknown money is never 0: it sorts after every known figure. */
export function moneySortKey(sort:MoneySort,v:MoneyRow):number{
  if(sort==='BALANCE'){const a=v.balance.lastOk?.amount;return a==null?Number.MAX_SAFE_INTEGER:-toCents(a);}
  if(sort==='CHECKED_OLD'){if(!v.hasEarnApp)return Number.MAX_SAFE_INTEGER;const at=v.balance.latest?.checkedAt;return at?new Date(at).getTime():-1;}
  const r=v.request;if(!r||r.state!=='REQUESTED'||r.phase!=='WAITING'||r.submission!=='SENT')return Number.MAX_SAFE_INTEGER;return new Date(r.submittedAt||r.requestedAt).getTime();
}
/** Balances recorded (the newest good figure of each current account) and money waiting for PayPal, per currency, never added together. */
export function moneySummary(rows:MoneyRow[]){
  const bal:Record<string,number>={},wait:Record<string,number>={};let unchecked=0,known=0,unassigned=0;
  for(const v of rows){
    const ok=v.balance.lastOk;if(ok&&ok.amount!=null){bal[ok.currency]=(bal[ok.currency]||0)+toCents(ok.amount);known++;}
    if(v.hasEarnApp&&!v.balance.latest)unchecked++;if(!v.hasEarnApp)unassigned++;
    const r=v.request;if(r&&r.state==='REQUESTED'&&r.phase==='WAITING'&&r.submission==='SENT'&&r.money)wait[r.money.currency]=(wait[r.money.currency]||0)+toCents(r.money.remaining);
  }
  const text=(m:Record<string,number>)=>Object.entries(m).sort(([a],[b])=>a.localeCompare(b)).map(([c,v])=>({currency:c,amount:fromCents(v)}));
  return {balances:text(bal),waiting:text(wait),unchecked,known,unassigned};
}
