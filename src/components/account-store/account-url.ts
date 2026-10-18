// URL state of Kho tài khoản. Two account kinds are the tabs (?tab=login | paypal; the page's own kind is the default: /gmails → login,
// /paypals → paypal). Lịch sử nhập kho (?view=history) and Cần đối chiếu (?view=review) are views inside the kind being looked at.
// Filters: ?q &type (login only) &state &batch (a purchase code: the accounts of that purchase; in history: that purchase highlighted).
// PayPal tab: ?pp=<code> &show=emails | in | out opens that PayPal's emails or the rows behind its money in / out, ?month=YYYY-MM
// limits the money columns to a month (the balance still includes everything before it). Without a month, an open money list
// keeps its cut-off day in ?asof=YYYY-MM-DD so the number and its rows stay the same range after reload / Back / Forward.
// Old URLs keep working: ?tab=batch → history, ?tab=review → review (of the page's kind); ?import=1 opens the import panel once.
export type AccountKind='login'|'paypal';
export type AccountView=''|'history'|'review';
export type PaypalShow=''|'emails'|'in'|'out';
export interface AccountUrl {tab:AccountKind;view:AccountView;q:string;type:string;state:string;batch:string;pp?:string;show?:PaypalShow;month?:string;asof?:string}
const STATES=['NEW','ASSIGNED','USED','BLOCKED'],TYPES=['GMAIL','APPLE_ID'];
export function readAccountUrl(p:{get(name:string):string|null},initial:AccountKind):AccountUrl{
  const t=p.get('tab')||'',v=p.get('view')||'',tab:AccountKind=t==='login'||t==='paypal'?t:initial;
  const view:AccountView=v==='history'||t==='batch'?'history':v==='review'||t==='review'?'review':'';
  const state=p.get('state')||'',type=p.get('type')||'';
  const show=p.get('show')||'',month=p.get('month')||'',pp=tab==='paypal'?p.get('pp')||'':'';
  const out:AccountUrl={tab,view,q:p.get('q')||'',type:tab==='login'&&TYPES.includes(type)?type:'',state:STATES.includes(state)?state:'',batch:p.get('batch')||'',pp,show:pp&&['emails','in','out'].includes(show)?show as PaypalShow:'',month:tab==='paypal'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(month)?month:'',asof:''};
  const asof=p.get('asof')||'';if(out.pp&&(out.show==='in'||out.show==='out')&&!out.month&&/^\d{4}-\d{2}-\d{2}$/.test(asof))out.asof=asof;
  return out;
}
export function writeAccountUrl(u:AccountUrl,initial:AccountKind):string{
  const p=new URLSearchParams();
  if(u.tab!==initial)p.set('tab',u.tab);if(u.view)p.set('view',u.view);
  if(u.q)p.set('q',u.q);if(u.type&&u.tab==='login')p.set('type',u.type);if(u.state)p.set('state',u.state);if(u.batch)p.set('batch',u.batch);
  if(u.tab==='paypal'){if(u.month)p.set('month',u.month);if(u.pp&&u.show){p.set('pp',u.pp);p.set('show',u.show);if(u.asof&&!u.month&&(u.show==='in'||u.show==='out'))p.set('asof',u.asof);}}
  const s=p.toString();return s?'?'+s:'';
}
// A kind change starts clean (no filters of the other kind); a view change keeps the kind.
export const switchKind=(u:AccountUrl,tab:AccountKind):AccountUrl=>({tab,view:'',q:'',type:'',state:'',batch:'',month:tab==='paypal'?u.month:''});
export const openView=(u:AccountUrl,view:AccountView,batch=''):AccountUrl=>({...u,view,q:view?'':u.q,type:view?'':u.type,state:view?'':u.state,batch});
// Same query (order aside)? Used to replace an old-style URL with its canonical form without adding a history entry.
export function sameQuery(a:string,b:string){const n=(s:string)=>{const p=new URLSearchParams(s.replace(/^\?/,''));p.sort();return p.toString();};return n(a)===n(b);}
