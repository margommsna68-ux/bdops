// URL state of Kho tài khoản. Two account kinds are the tabs (?tab=login | paypal; the page's own kind is the default: /gmails → login,
// /paypals → paypal). Lịch sử nhập kho (?view=history) and Cần đối chiếu (?view=review) are views inside the kind being looked at.
// Filters: ?q &type (login only) &state &batch (a purchase code: the accounts of that purchase; in history: that purchase highlighted).
// PayPal tab: ?pp=<code> &show=emails | in | out opens that PayPal's emails or the rows behind its money in / out, ?month=YYYY-MM
// limits the money columns to a month (the balance still includes everything before it). Without a month, an open money list
// keeps its cut-off day in ?asof=YYYY-MM-DD so the number and its rows stay the same range after reload / Back / Forward.
// Old URLs keep working: ?tab=batch → history, ?tab=review → review (of the page's kind); ?import=1 opens the import panel once.
// ?state=DELETED lists the rows deleted from the stock (Khôi phục); ?page= is the page of the filtered list (100 rows; filters reset it).
import {LOGIN_STATUS_LABEL} from '@/lib/login-issue';
import {CHECK_STATE_LABEL,CHECK_STATE_ORDER,type CheckState} from './check-status';
export type AccountKind='login'|'paypal';
export type AccountView=''|'history'|'review';
export type PaypalShow=''|'emails'|'in'|'out';
export type LoginSort='CREATED'|'ERRORS_FIRST'|'LATEST_ISSUE'|'EMAIL'|'SOURCE'|'SOURCE_DESC'|'CHECK_STATUS'|'CHECK_STATUS_DESC';
export interface AccountUrl {tab:AccountKind;view:AccountView;q:string;type:string;state:string;batch:string;page:number;daily?:'AVAILABLE';status?:string;check?:CheckState;source?:string;sourceMissing?:boolean;sort?:LoginSort;pp?:string;show?:PaypalShow;month?:string;asof?:string}
const STATES=['NEW','ASSIGNED','USED','BLOCKED','DELETED'],TYPES=['GMAIL','APPLE_ID'];
const LOGIN_STATUSES=Object.keys(LOGIN_STATUS_LABEL);
const LOGIN_SORTS:LoginSort[]=['ERRORS_FIRST','LATEST_ISSUE','EMAIL','SOURCE','SOURCE_DESC','CHECK_STATUS','CHECK_STATUS_DESC'];
export const PAGE_SIZE=100;
export function readAccountUrl(p:{get(name:string):string|null},initial:AccountKind):AccountUrl{
  const t=p.get('tab')||'',v=p.get('view')||'',tab:AccountKind=t==='login'||t==='paypal'?t:initial;
  const view:AccountView=v==='history'||t==='batch'?'history':v==='review'||t==='review'?'review':'';
  const state=p.get('state')||'',type=p.get('type')||'';
  const show=p.get('show')||'',month=p.get('month')||'',pp=tab==='paypal'?p.get('pp')||'':'';
  const page=Math.max(1,Math.floor(Number(p.get('page')||'1'))||1);
  const out:AccountUrl={tab,view,q:p.get('q')||'',type:tab==='login'&&TYPES.includes(type)?type:'',state:STATES.includes(state)?state:'',batch:p.get('batch')||'',page:view?1:page,pp,show:pp&&['emails','in','out'].includes(show)?show as PaypalShow:'',month:tab==='paypal'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)?month:'',asof:''};
  const asof=p.get('asof')||'';if(out.pp&&(out.show==='in'||out.show==='out')&&!out.month&&/^\d{4}-\d{2}-\d{2}$/.test(asof))out.asof=asof;
  if(tab==='paypal'&&p.get('daily')==='AVAILABLE')out.daily='AVAILABLE';
  if(tab==='login'){
    const status=p.get('status')||'',sort=p.get('sort')||'';
    if(LOGIN_STATUSES.includes(status))out.status=status;
    if(LOGIN_SORTS.includes(sort as LoginSort))out.sort=sort as LoginSort;
    const check=p.get('check')||'';if(Object.hasOwn(CHECK_STATE_LABEL,check))out.check=check as CheckState;
    if(p.get('sourceMissing')==='1')out.sourceMissing=true;else if(p.get('source'))out.source=p.get('source')!;
  }
  return out;
}
export function writeAccountUrl(u:AccountUrl,initial:AccountKind):string{
  const p=new URLSearchParams();
  if(u.tab!==initial)p.set('tab',u.tab);if(u.view)p.set('view',u.view);
  if(u.q)p.set('q',u.q);if(u.type&&u.tab==='login')p.set('type',u.type);if(u.state)p.set('state',u.state);if(u.batch)p.set('batch',u.batch);if(!u.view&&u.page>1)p.set('page',String(u.page));
  if(u.tab==='login'){if(u.status&&LOGIN_STATUSES.includes(u.status))p.set('status',u.status);if(u.sort&&LOGIN_SORTS.includes(u.sort))p.set('sort',u.sort);}
  if(u.tab==='login'&&!u.view){if(u.check)p.set('check',u.check);if(u.sourceMissing)p.set('sourceMissing','1');else if(u.source)p.set('source',u.source);}
  if(u.tab==='paypal'){if(u.daily==='AVAILABLE'&&!u.view)p.set('daily',u.daily);if(u.month)p.set('month',u.month);if(u.pp&&u.show){p.set('pp',u.pp);p.set('show',u.show);if(u.asof&&!u.month&&(u.show==='in'||u.show==='out'))p.set('asof',u.asof);}}
  const s=p.toString();return s?'?'+s:'';
}
// A kind change starts clean (no filters of the other kind); a view change keeps the kind.
export const switchKind=(u:AccountUrl,tab:AccountKind):AccountUrl=>({tab,view:'',q:'',type:'',state:'',batch:'',page:1,month:tab==='paypal'?u.month:''});
export const openView=(u:AccountUrl,view:AccountView,batch=''):AccountUrl=>{const next={...u,view,q:view?'':u.q,type:view?'':u.type,state:view?'':u.state,batch,page:1};if(view){delete next.status;delete next.check;delete next.source;delete next.sourceMissing;delete next.sort;}return next;};
/** A changed filter / search starts at page 1. */
export const withFilter=(u:AccountUrl,change:Partial<AccountUrl>):AccountUrl=>({...u,...change,page:1});
// Same query (order aside)? Used to replace an old-style URL with its canonical form without adding a history entry.
export function sameQuery(a:string,b:string){const n=(s:string)=>{const p=new URLSearchParams(s.replace(/^\?/,''));p.sort();return p.toString();};return n(a)===n(b);}
/** Keep the server's created order by default. Call after filtering and before taking the current page. */
export function orderLoginRows<T extends {email:string;status:string;loginIssueAt?:string|null;source?:string|null;checkState?:CheckState}>(rows:readonly T[],sort:LoginSort='CREATED'):T[]{
  const result=[...rows];
  const issueTime=(row:T)=>{const time=Date.parse(row.loginIssueAt||'');return Number.isFinite(time)?time:0;};
  if(sort==='ERRORS_FIRST')result.sort((a,b)=>Number(a.status==='ACTIVE')-Number(b.status==='ACTIVE'));
  if(sort==='LATEST_ISSUE')result.sort((a,b)=>issueTime(b)-issueTime(a));
  if(sort==='EMAIL')result.sort((a,b)=>a.email.localeCompare(b.email,'vi',{sensitivity:'base',numeric:true}));
  if(sort==='SOURCE'||sort==='SOURCE_DESC')result.sort((a,b)=>Number(!a.source)-Number(!b.source)||(a.source||'').localeCompare(b.source||'','vi',{sensitivity:'base',numeric:true})*(sort==='SOURCE_DESC'?-1:1));
  if(sort==='CHECK_STATUS'||sort==='CHECK_STATUS_DESC')result.sort((a,b)=>(CHECK_STATE_ORDER.indexOf(a.checkState??'UNCHECKED')-CHECK_STATE_ORDER.indexOf(b.checkState??'UNCHECKED'))*(sort==='CHECK_STATUS_DESC'?-1:1));
  return result;
}
