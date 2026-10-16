export type VMView='MISSING'|'PENDING'|'INSTALLED'|'REVIEW'|'ARCHIVED';
type ViewInput={archivedAt:string|null;slotState:string;desired:{id:string;status:string}|null;installed:{id:string;status:string}|null;holds:{role:string;owner:string;state:string;shared?:boolean}[]};
export function vmView(vm:ViewInput):VMView{
  if(vm.archivedAt)return 'ARCHIVED';
  if(vm.holds.some(h=>h.role==='UNCERTAIN'||(h.owner!=='SELF'&&!h.shared)||!['NEW','LIVE'].includes(h.state))||vm.desired?.status==='FAILED')return 'REVIEW';
  if(vm.desired&&vm.desired.id!==vm.installed?.id)return 'PENDING';
  if(vm.installed&&vm.desired?.id===vm.installed.id)return 'INSTALLED';
  if(vm.slotState==='BLANK'&&!vm.desired&&!vm.installed&&!vm.holds.length)return 'MISSING';
  return 'REVIEW';
}
export function summarizeVMs(vms:ViewInput[]){const views=vms.map(vmView).filter(v=>v!=='ARCHIVED');return {total:views.length,missing:views.filter(v=>v==='MISSING').length,pending:views.filter(v=>v==='PENDING').length,installed:views.filter(v=>v==='INSTALLED').length,review:views.filter(v=>v==='REVIEW').length};}
