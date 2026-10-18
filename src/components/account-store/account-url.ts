// URL state of Kho tài khoản. Two account kinds are the tabs (?tab=login | paypal; the page's own kind is the default: /gmails → login,
// /paypals → paypal). Lịch sử nhập kho (?view=history) and Cần đối chiếu (?view=review) are views inside the kind being looked at.
// Filters: ?q &type (login only) &state &batch (a purchase code: the accounts of that purchase; in history: that purchase highlighted).
// Old URLs keep working: ?tab=batch → history, ?tab=review → review (of the page's kind); ?import=1 opens the import panel once.
export type AccountKind='login'|'paypal';
export type AccountView=''|'history'|'review';
export interface AccountUrl {tab:AccountKind;view:AccountView;q:string;type:string;state:string;batch:string}
const STATES=['NEW','ASSIGNED','USED','BLOCKED'],TYPES=['GMAIL','APPLE_ID'];
export function readAccountUrl(p:{get(name:string):string|null},initial:AccountKind):AccountUrl{
  const t=p.get('tab')||'',v=p.get('view')||'',tab:AccountKind=t==='login'||t==='paypal'?t:initial;
  const view:AccountView=v==='history'||t==='batch'?'history':v==='review'||t==='review'?'review':'';
  const state=p.get('state')||'',type=p.get('type')||'';
  return {tab,view,q:p.get('q')||'',type:tab==='login'&&TYPES.includes(type)?type:'',state:STATES.includes(state)?state:'',batch:p.get('batch')||''};
}
export function writeAccountUrl(u:AccountUrl,initial:AccountKind):string{
  const p=new URLSearchParams();
  if(u.tab!==initial)p.set('tab',u.tab);if(u.view)p.set('view',u.view);
  if(u.q)p.set('q',u.q);if(u.type&&u.tab==='login')p.set('type',u.type);if(u.state)p.set('state',u.state);if(u.batch)p.set('batch',u.batch);
  const s=p.toString();return s?'?'+s:'';
}
// A kind change starts clean (no filters of the other kind); a view change keeps the kind.
export const switchKind=(u:AccountUrl,tab:AccountKind):AccountUrl=>({tab,view:'',q:'',type:'',state:'',batch:''});
export const openView=(u:AccountUrl,view:AccountView,batch=''):AccountUrl=>({...u,view,q:view?'':u.q,type:view?'':u.type,state:view?'':u.state,batch});
// Same query (order aside)? Used to replace an old-style URL with its canonical form without adding a history entry.
export function sameQuery(a:string,b:string){const n=(s:string)=>{const p=new URLSearchParams(s.replace(/^\?/,''));p.sort();return p.toString();};return n(a)===n(b);}
