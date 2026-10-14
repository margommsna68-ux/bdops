import type {AllocationInput,AllocationPreview} from '@/server/vm-management/types';
import type {VMView} from '@/server/vm-management/state';
export {vmView,summarizeVMs} from '@/server/vm-management/state';
export type {VMView} from '@/server/vm-management/state';
export function installationTarget<T extends {endpointId:string}>(vm:{desired:{endpointId:string|null}|null;holds:T[]}){return vm.holds.find(h=>h.endpointId===vm.desired?.endpointId);}
export function proxyAddress(proxy:{ip:string|null;port:number|null}|null|undefined){return proxy?.ip?proxy.ip+(proxy.port?':'+proxy.port:''):'—';}
export async function submitAllocation<T>(input:AllocationInput,inspect:(input:AllocationInput)=>Promise<AllocationPreview>,commit:(input:{token:string;idempotencyKey:string})=>Promise<T>,onPreview:(p:AllocationPreview)=>void){
  const preview=await inspect(input);onPreview(preview);if(preview.errors||!preview.ready)return {phase:'REVIEW' as const,preview};
  return {phase:'SAVED' as const,preview,result:await commit({token:preview.token,idempotencyKey:input.idempotencyKey})};
}
export const viewLabels:Record<VMView,string>={MISSING:'Thiếu proxy',PENDING:'Chờ cài',INSTALLED:'Đã cài',REVIEW:'Cần kiểm tra',ARCHIVED:'Đã ẩn'};
