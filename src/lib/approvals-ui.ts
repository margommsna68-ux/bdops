// Phê duyệt lệnh AI (23/10/2026): pure helpers of the /approvals page (summary rows and the expiry countdown), kept out of the page
// file so they can be tested and so the Next page keeps only its default export.
export const SUMMARY_LABEL:Record<string,string>={vm:'VM',amount:'Số tiền',status:'Trạng thái',paypal:'PayPal',withdrawalId:'Yêu cầu rút',sdk:'Mã SDK (che)',jobId:'Việc',transactionId:'Giao dịch'};
const SUMMARY_ORDER=['vm','amount','status','paypal','withdrawalId','sdk','jobId','transactionId'];
const present=(v:unknown)=>v!==undefined&&v!==null&&v!=='';
/** Label / value pairs an ADMIN reads: the allowed fields first in a fixed order, anything else after; action / label are the row title. */
export function summaryPairs(summary:Record<string,unknown>|null|undefined){
  const s=summary||{};
  const keys=[...SUMMARY_ORDER.filter(k=>present(s[k])),...Object.keys(s).filter(k=>!SUMMARY_ORDER.includes(k)&&k!=='action'&&k!=='label'&&present(s[k]))];
  return keys.map(k=>({key:k,label:SUMMARY_LABEL[k]??k,value:typeof s[k]==='object'?JSON.stringify(s[k]):String(s[k])}));
}
export function countdown(expiresAt:string,now:number){
  const left=new Date(expiresAt).getTime()-now;
  if(!Number.isFinite(left))return '—';
  if(left<=0)return 'Hết hạn';
  const m=Math.floor(left/60000),s=Math.floor((left%60000)/1000);
  return 'còn '+(m>0?m+' phút ':'')+String(s).padStart(2,'0')+' giây';
}
