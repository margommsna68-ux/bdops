import type {Prisma} from '@prisma/client';
import type {InventoryState} from './types';
// Decided 16/10/2026: NEW = eligible stock not on a VM, LIVE = assigned to a VM on the web (a "Chờ cài" or "Đã cài" hold).
// A "Giữ để kiểm tra" hold is not a valid assignment, but while one remains the proxy is not put back into NEW stock.
// Only TUT and Chung mooon–Genjy follow the rule (the classes that sit on the user's VMs); BLOCKED, QUARANTINED, REPLACED,
// RETIRED, VOID and DIE are never changed here. LIVE does not mean installed or network-checked.
export type AssignmentTarget={from:InventoryState;to:InventoryState;reason:string}|{from:InventoryState;to:null;reason:string};
type EndpointForState={inventoryState:InventoryState;retiredAt:Date|null;identity:{owner:string;subgroup:string|null}|null;allocations:{role:string;releasedAt?:Date|null;vm?:{code:string;server:{code:string}}}[]};
export function followsAssignmentRule(e:Pick<EndpointForState,'identity'>){return e.identity?.owner==='SELF'||(e.identity?.owner==='GENJY'&&e.identity.subgroup==='PC_CHUNG');}
const where=(a:EndpointForState['allocations'][number])=>a.vm?a.vm.server.code+'/'+a.vm.code:'VM';
// What the state should be for the current holds; to:null means "leave as it is" (with the reason shown in previews).
export function expectedAssignmentState(e:EndpointForState):AssignmentTarget|null{
  if(e.retiredAt||!['NEW','LIVE'].includes(e.inventoryState)||!followsAssignmentRule(e)) return null;
  const holds=e.allocations.filter(a=>!a.releasedAt),active=holds.filter(a=>a.role==='DESIRED'||a.role==='INSTALLED');
  if(active.length) return {from:e.inventoryState,to:'LIVE',reason:'Đang giữ ở '+active.map(a=>where(a)+' · '+(a.role==='INSTALLED'?'Đã cài':'Chờ cài')).join(', ')};
  if(holds.length) return {from:e.inventoryState,to:null,reason:'Chỉ còn bản Giữ để kiểm tra ở '+holds.map(where).join(', ')+'; không tính là đã gán, chưa đưa về kho NEW'};
  return {from:e.inventoryState,to:'NEW',reason:'Không còn VM nào giữ'};
}
// Bring NEW/LIVE in line with the holds, inside the caller's transaction. Returns the change, or null when nothing changed.
export async function syncAssignmentState(tx:Prisma.TransactionClient,endpointId:string){
  const e=await tx.proxyIP.findUnique({where:{id:endpointId},include:{identity:{select:{owner:true,subgroup:true}},allocations:{where:{releasedAt:null},select:{role:true}}}});
  if(!e) return null;
  const target=expectedAssignmentState(e);
  if(!target?.to||target.to===e.inventoryState) return null;
  await tx.proxyIP.update({where:{id:e.id},data:{inventoryState:target.to,status:target.to==='LIVE'?'IN_USE':'AVAILABLE',revision:{increment:1}}});
  return {from:e.inventoryState,to:target.to};
}
