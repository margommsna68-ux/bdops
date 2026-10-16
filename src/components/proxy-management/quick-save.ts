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
