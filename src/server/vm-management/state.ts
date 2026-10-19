// Proxy view of a VM (owner decision 19/10/2026, REPLACES Chờ cài / Đang cài / Đã cài): the assigned proxy is the proxy the VM uses.
// - MISSING: an empty slot. ASSIGNED: one clear current proxy. BLOCKED: the current proxy is BLOCKED (to be replaced).
// - REVIEW: older data with an assigned proxy next to a different confirmed one, a "Giữ để kiểm tra" hold, a proxy that is not ours or
//   no longer current stock, or a slot the Sheet import could not read. The web never guesses the current proxy there.
export type VMView='MISSING'|'ASSIGNED'|'BLOCKED'|'REVIEW'|'ARCHIVED';
type ConfigRef={id:string;endpointId?:string|null}|null;
type HoldRef={role:string;owner:string;state:string;shared?:boolean;endpointId?:string};
type ViewInput={archivedAt:string|null;slotState:string;desired:ConfigRef;installed:ConfigRef;holds:HoldRef[]};
/** The current proxy of a VM as the grid sees it: the endpoint, or null with review=true when there is more than one candidate. */
export function currentOf(vm:Pick<ViewInput,'desired'|'installed'|'holds'>){
  const uncertain=vm.holds.filter(h=>h.role==='UNCERTAIN');
  const ids=Array.from(new Set([vm.desired?.endpointId,vm.installed?.endpointId,...uncertain.map(h=>h.endpointId)].filter((x):x is string=>!!x)));
  if(!ids.length)return {endpointId:null as string|null,review:uncertain.length>0};
  if(ids.length===1&&!uncertain.length)return {endpointId:ids[0],review:false};
  return {endpointId:null,review:true};
}
export function vmView(vm:ViewInput):VMView{
  if(vm.archivedAt)return 'ARCHIVED';
  const cur=currentOf(vm),hold=cur.endpointId?vm.holds.find(h=>h.endpointId===cur.endpointId):undefined;
  if(cur.review||vm.holds.some(h=>h.owner!=='SELF'&&!h.shared))return 'REVIEW';
  if(cur.endpointId){if(hold?.state==='BLOCKED')return 'BLOCKED';return hold&&['NEW','LIVE'].includes(hold.state)?'ASSIGNED':'REVIEW';}
  if(vm.slotState==='BLANK'&&!vm.holds.length)return 'MISSING';
  return 'REVIEW';
}
export function summarizeVMs(vms:ViewInput[]){const views=vms.map(vmView).filter(v=>v!=='ARCHIVED');return {total:views.length,missing:views.filter(v=>v==='MISSING').length,assigned:views.filter(v=>v==='ASSIGNED').length,blocked:views.filter(v=>v==='BLOCKED').length,review:views.filter(v=>v==='REVIEW').length};}
