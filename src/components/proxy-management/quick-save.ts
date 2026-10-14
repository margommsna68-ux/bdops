import type {BatchInput,BatchPreview,CommitResult} from '@/server/proxy-management/types';
export async function submitCheckedBatch(input:BatchInput,inspect:(input:BatchInput)=>Promise<BatchPreview>,commit:(input:{token:string;idempotencyKey:string})=>Promise<CommitResult>,onPreview:(preview:BatchPreview)=>void){
  const preview=await inspect(input);onPreview(preview);
  if(preview.errors||!preview.ready||preview.rows.some(r=>r.code==='UNKNOWN_PACKAGE'))return {phase:'REVIEW' as const,preview};
  const result=await commit({token:preview.token,idempotencyKey:input.idempotencyKey});return {phase:'SAVED' as const,preview,result};
}
