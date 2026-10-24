import {ProxyDomainError,type ActorScope} from '../proxy-management/types';
import {authorizeBusiness} from '../business-management/scope';
import {assertScopedSdkCodes,assertScopedVmIds,hasServerScope,vmWhere,type ScopeDB} from '../permissions/server-scope';

export const SDK_SCOPE_REFUSAL='Không tìm thấy SDK trong phạm vi server được giao';
/** Code-bearing payloads need this check before idempotency replay as well as before planning. */
export async function authorizeSdkCodes(db:ScopeDB,scope:ActorScope,codes:string[]){
  const current=await authorizeBusiness(scope,'INFRASTRUCTURE',true,db);
  await assertScopedSdkCodes(db,current,codes,{allowNew:true});return current;
}
/** Check before loading holder labels or evaluating state/revision conflicts. New codes may only be created at a scoped VM. */
export async function assertSdkPlacementScope(db:ScopeDB,scope:ActorScope,vmId:string,code:string|null,from?:{vmId:string}|null){
  await assertScopedVmIds(db,scope,[vmId,...(from?[from.vmId]:[])]);
  if(code!==null)await assertScopedSdkCodes(db,scope,[code],{allowNew:true});
}
/** Resolve metadata bindings by VM identity; a null/unknown binding is not evidence of an allowed server. */
export async function sdkVisibleVmIds(db:ScopeDB,scope:ActorScope,ids:(string|null)[]){
  if(!hasServerScope(scope))return null;
  const rows=await db.virtualMachine.findMany({where:{id:{in:[...new Set(ids.filter((id):id is string=>!!id))]},server:{projectId:scope.projectId},...vmWhere(scope)},select:{id:true}});
  return new Set(rows.map(r=>r.id));
}
export const sdkBindingVisible=(visible:Set<string>|null,id:string|null)=>visible===null||!!id&&visible.has(id);
export function denyScopedSdkHistory(scope:ActorScope){
  // Historical notes/detail are free text and may name old codes, money or servers without structured references.
  if(hasServerScope(scope))throw new ProxyDomainError('FORBIDDEN','Lịch sử SDK đầy đủ chỉ dành cho người có quyền toàn bộ server');
}
