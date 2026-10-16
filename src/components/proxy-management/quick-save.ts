import {DUPLICATE_CODES,type BatchInput,type BatchPreview,type CommitResult,type PreviewRow} from '@/server/proxy-management/types';
export async function submitCheckedBatch(input:BatchInput,inspect:(input:BatchInput)=>Promise<BatchPreview>,commit:(input:{token:string;idempotencyKey:string})=>Promise<CommitResult>,onPreview:(preview:BatchPreview)=>void){
  const preview=await inspect(input);onPreview(preview);
  if(preview.errors||!preview.ready||preview.rows.some(r=>r.code==='UNKNOWN_PACKAGE'))return {phase:'REVIEW' as const,preview};
  const result=await commit({token:preview.token,idempotencyKey:input.idempotencyKey});return {phase:'SAVED' as const,preview,result};
}
// "Trùng" = the IP already exists (paste, stock, VM, Genjy, history); every other error is "Cần kiểm tra" (format, package, owner, pairing).
export const isDuplicate=(r:PreviewRow)=>r.outcome==='ERROR'&&!!r.code&&DUPLICATE_CODES.includes(r.code);
export function previewSummary(p:BatchPreview){
  const parts=[`${p.ready} hợp lệ`,`${p.duplicates} trùng`,`${p.errors-p.duplicates} cần kiểm tra`];
  if(p.skipped) parts.push(`${p.skipped} giữ nguyên`);
  return parts.join(' | ');
}
// Rejected rows for the provider: line, IP(s), class and reason. IPs only — never port, user or password.
export function rejectedReport(rows:PreviewRow[]){
  return rows.filter(r=>r.outcome==='ERROR').map(r=>`Dòng ${r.row}\t${r.oldIp&&r.newIp?`${r.oldIp} → ${r.newIp}`:r.newIp||r.oldIp||'(không đọc được)'}\t${isDuplicate(r)?'Trùng':'Cần kiểm tra'}\t${r.message}`).join('\n');
}
// One-click edits: preview and commit in one go through the same checked endpoints. Valid rows are saved, refused rows come
// back with their reasons; nothing is reported as saved unless the commit succeeded.
export interface QuickEditOutcome {applied:number;errors:{ip:string;message:string}[];unchanged:boolean}
export async function quickEdit<I extends {idempotencyKey:string}>(input:I,inspect:(input:I)=>Promise<{token:string;ready:number;rows:{ip:string;outcome:string;message:string}[]}>,commit:(input:{token:string;idempotencyKey:string})=>Promise<{applied:number}>):Promise<QuickEditOutcome>{
  const preview=await inspect(input),errors=preview.rows.filter(r=>r.outcome==='ERROR').map(r=>({ip:r.ip,message:r.message}));
  if(!preview.ready) return {applied:0,errors,unchanged:!errors.length};
  const result=await commit({token:preview.token,idempotencyKey:input.idempotencyKey});
  return {applied:result.applied,errors,unchanged:false};
}
export function quickEditMessage(o:QuickEditOutcome){
  if(o.unchanged) return 'Không thay đổi';
  const head=o.applied?'Đã lưu'+(o.applied>1?' '+o.applied+' dòng':''):'Chưa lưu';
  return o.errors.length?`${head} · ${o.errors.length} dòng bị chặn: ${o.errors[0].ip} — ${o.errors[0].message}`:head;
}
