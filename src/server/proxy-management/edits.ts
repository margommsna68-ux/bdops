import {randomBytes} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {prisma} from '@/lib/prisma';
import {encrypt,decrypt} from '@/lib/encryption';
import {assertInfrastructureAction,loadInfrastructureScope} from '@/server/permissions/infrastructure';
import {recordOperation} from '../operation-history/journal';
import {snapshotCollector} from '../vm-management/allocation';
import {vmHash,type ConfigurationSnapshot} from '../vm-management/types';
import {compareCodes} from './package-terms';
import {decodeEndpoint} from './repository';
import {fullProxy,parseProxy} from './parse';
import {withProxyTransaction} from './transaction';
import {assertGroupName,ownerLabel} from './groups';
import {HISTORICAL_STATES,ProxyDomainError,type ActorScope,type EditInput,type EditItem,type EditPreview,type EditResult,type EditRow,type InventoryState,type IssueCode,type LocationChoice,type ManageChoice,type VmTarget} from './types';
const STATE_LABEL:Record<InventoryState,string>={NEW:'NEW',LIVE:'LIVE',BLOCKED:'BLOCKED',REPLACED:'Đã replace',DIE:'Ngừng dùng',QUARANTINED:'Cần kiểm tra',VOID:'Đã thu hồi',RETIRED:'Ngừng quản lý'};
export const RETIRED_LABEL=STATE_LABEL.RETIRED;
type RetiredNote={reason:string;previousState:InventoryState;previousStatus:string;previousStatusAt:string|null;by:string;at:string};
const readNotes=(cipher:string|null)=>{if(!cipher) return {} as Record<string,unknown>;try{return JSON.parse(decrypt(cipher)) as Record<string,unknown>;}catch{return {};}};
export const MAX_EDIT_ROWS=2000;
type Reader=PrismaClient|Prisma.TransactionClient;
const ROLE_LABEL={DESIRED:'Chờ cài',INSTALLED:'Đã cài',UNCERTAIN:'Giữ để kiểm tra'} as const;
// A pasted "Proxy | Server | VM" table: cells split on | or tab, blank lines skipped, a header row ignored. Row numbers follow the pasted lines.
export function parsePasteMapping(text:string){
  const out:{row:number;proxy:string;server:string;vm:string}[]=[];
  text.split(/\r?\n/).forEach((line,i)=>{
    if(!line.trim()) return;
    const cells=(line.includes('|')?line.split('|'):line.split('\t')).map(c=>c.trim());
    if(i===0&&['proxy','ip proxy'].includes(cells[0].toLowerCase())&&(cells[1]||'').toLowerCase()==='server') return;
    out.push({row:i+1,proxy:cells[0],server:cells[1]||'',vm:cells[2]||''});
  });
  return out;
}
const vmInclude={server:true,allocations:{where:{releasedAt:null},include:{endpoint:{select:{id:true,host:true}},configuration:true}},desiredConfiguration:{include:{endpoint:{select:{id:true,host:true}},task:true}},installedConfiguration:{include:{endpoint:{select:{id:true,host:true}}}},proxy:{select:{id:true,host:true}}} as const;
type VMRow=Prisma.VirtualMachineGetPayload<{include:typeof vmInclude}>;
const endpointInclude={identity:{include:{sourceRefs:{select:{owner:true}}}},group:{select:{id:true,name:true}},vm:{include:{server:true}},allocations:{where:{releasedAt:null},include:{vm:{include:{server:true}},configuration:true}}} as const;
type EndpointRow=Prisma.ProxyIPGetPayload<{include:typeof endpointInclude}>;
// Any proxy that currently sits on the VM (hold of any role, pending or installed configuration, or the VM link recorded from the Sheet).
function occupantOf(vm:VMRow,except?:string){
  const hold=vm.allocations.find(a=>a.endpointId!==except);if(hold) return hold.endpoint.host||hold.endpointId;
  for(const c of [vm.desiredConfiguration,vm.installedConfiguration]) if(c?.endpointId&&c.endpointId!==except) return c.endpoint?.host||c.endpointId;
  if(vm.proxyId&&vm.proxyId!==except) return vm.proxy?.host||vm.proxyId;
  return null;
}
const positionLabel=(e:EndpointRow)=>{const parts=e.allocations.map(a=>a.vm.server.code+'/'+a.vm.code+' · '+ROLE_LABEL[a.role]);if(e.vm&&!e.allocations.some(a=>a.vmId===e.vm!.id)) parts.push(e.vm.server.code+'/'+e.vm.code);return parts.length?parts.join(', '):'Chưa gán';};
// Only a plan that nobody has started installing can be moved or dropped from the registry; everything else goes through the install flow.
function immovableReason(e:EndpointRow):string|null{
  for(const a of e.allocations){
    const at=a.vm.server.code+'/'+a.vm.code;
    if(a.role==='INSTALLED') return 'Đã cài trên '+at+'; đổi proxy qua Server/VM và xác nhận lại';
    if(a.role==='UNCERTAIN') return 'Đang giữ để kiểm tra trên '+at+'; xử lý ở Server/VM trước';
    if(a.configuration.startedAt||a.configuration.status!=='PLANNED') return 'Đã bắt đầu cài trên '+at+'; xác nhận hoặc báo lỗi ở Việc cài trước';
  }
  return null;
}
function assignableReason(e:EndpointRow):{code:IssueCode;message:string}|null{
  if(e.identity?.owner==='GENJY'||e.identity?.sourceRefs.some(s=>s.owner==='GENJY')) return {code:'GENJY_RESERVED',message:'Proxy của genjy/PC chung không gán vào VM'};
  if(e.identity?.owner!=='SELF') return {code:'OWNER_CONFLICT',message:'Chỉ proxy TUT mới được gán VM'};
  const proxy=decodeEndpoint(e);
  if(e.retiredAt||!['NEW','LIVE'].includes(e.inventoryState)||proxy?.format!=='FULL'||!e.inventoryKey||!e.port) return {code:'INVALID_INPUT',message:'Proxy chưa đủ điều kiện (cần NEW/LIVE, đủ user/pass)'};
  return null;
}
export async function listVmTargets(scope:ActorScope,db:Reader=prisma):Promise<VmTarget[]>{
  assertInfrastructureAction(await loadInfrastructureScope(db,scope.userId,scope.projectId),'READ');
  const vms=await db.virtualMachine.findMany({where:{managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},include:vmInclude});
  return vms.sort((a,b)=>compareCodes(a.server.code,b.server.code)||compareCodes(a.code,b.code)).map(v=>({id:v.id,code:v.code,serverId:v.serverId,serverCode:v.server.code,occupant:occupantOf(v)}));
}
type PlannedItem={row:number;endpointId:string;group?:{owner:'SELF'|'OTHER';groupId:string|null;newName:string|null};location?:{kind:'UNASSIGN'}|{kind:'VM';vmId:string};manage?:ManageChoice};
type Plan={rows:EditRow[];items:PlannedItem[];needs:{group:boolean;location:boolean;manage:boolean}};
async function resolveItems(scope:ActorScope,input:EditInput,db:Reader):Promise<{items:(EditItem&{row:number})[];rows:EditRow[]}>{
  if(input.items&&input.paste||!input.items&&!input.paste) throw new ProxyDomainError('INVALID_INPUT');
  if(input.items){
    if(!input.items.length||input.items.length>MAX_EDIT_ROWS||input.items.some(i=>!i.group&&!i.location&&!i.manage)) throw new ProxyDomainError('INVALID_INPUT');
    const ids=Array.from(new Set(input.items.map(i=>i.endpointId)));
    const found=await db.proxyIP.count({where:{id:{in:ids},projectId:scope.projectId,identityId:{not:null}}});if(found!==ids.length) throw new ProxyDomainError('NOT_FOUND','Có dòng không thuộc dự án này');
    return {items:input.items.map((i,n)=>({...i,row:n+1})),rows:[]};
  }
  const parsed=parsePasteMapping(input.paste||'');if(!parsed.length||parsed.length>MAX_EDIT_ROWS) throw new ProxyDomainError('INVALID_INPUT','Dán mỗi dòng một ánh xạ Proxy | Server | VM');
  const [endpoints,vms]=await Promise.all([db.proxyIP.findMany({where:{projectId:scope.projectId,identityId:{not:null},retiredAt:null,inventoryState:{notIn:['REPLACED','VOID']}},include:{identity:{select:{ip:true}}}}),db.virtualMachine.findMany({where:{managed:true,server:{projectId:scope.projectId,managed:true}},include:{server:{select:{code:true}}}})]);
  const items:(EditItem&{row:number})[]=[],rows:EditRow[]=[];
  for(const p of parsed){
    const error=(message:string,code:IssueCode='INVALID_INPUT')=>rows.push({row:p.row,endpointId:null,ip:p.proxy,field:'LOCATION',before:'',after:[p.server,p.vm].filter(Boolean).join('/'),outcome:'ERROR',code,message});
    let proxy;try{proxy=parseProxy(p.proxy);}catch{error('Proxy không hợp lệ');continue;}
    const matches=endpoints.filter(e=>e.identity!.ip===proxy.ip&&(proxy.port===null||e.port===proxy.port)&&(proxy.format!=='FULL'||(()=>{const d=decodeEndpoint(e);return d?.format==='FULL'&&fullProxy(d)===fullProxy(proxy);})()));
    if(!matches.length){error('Không tìm thấy proxy trong kho',"NOT_FOUND");continue;}
    if(matches.length>1){error('IP có nhiều proxy; dán đầy đủ IP:port:user:pass','AMBIGUOUS_OLD');continue;}
    const unassign=['-','bỏ gán','bo gan'].includes(p.server.toLowerCase());
    let location:LocationChoice|undefined;
    if(unassign) location={kind:'UNASSIGN'};
    else if(!p.server&&!p.vm) location=undefined;
    else if(!p.server){error('Thiếu mã server cho VM '+p.vm);continue;}
    else if(!p.vm){error('Thiếu mã VM trên server '+p.server);continue;}
    else{const vm=vms.find(v=>v.server.code.toLowerCase()===p.server.toLowerCase()&&v.code.toLowerCase()===p.vm.toLowerCase()&&!v.archivedAt);if(!vm){error('Không tìm thấy VM '+p.server+'/'+p.vm,'NOT_FOUND');continue;}location={kind:'VM',vmId:vm.id};}
    if(!location){rows.push({row:p.row,endpointId:matches[0].id,ip:proxy.ip,field:'LOCATION',before:'',after:'',outcome:'SKIP',message:'Ô trống: giữ nguyên'});continue;}
    items.push({row:p.row,endpointId:matches[0].id,location});
  }
  return {items,rows};
}
async function planEdits(scope:ActorScope,input:EditInput,db:Reader):Promise<Plan>{
  const {items,rows:parseRows}=await resolveItems(scope,input,db);
  const needs={group:items.some(i=>i.group),location:items.some(i=>i.location),manage:items.some(i=>i.manage)};
  const ids=Array.from(new Set(items.map(i=>i.endpointId)));
  const [endpoints,vms,groups]=await Promise.all([
    db.proxyIP.findMany({where:{id:{in:ids},projectId:scope.projectId},include:endpointInclude}),
    db.virtualMachine.findMany({where:{managed:true,server:{projectId:scope.projectId,managed:true}},include:vmInclude}),
    db.proxyGroup.findMany({where:{projectId:scope.projectId}}),
  ]);
  vms.sort((a,b)=>compareCodes(a.server.code,b.server.code)||compareCodes(a.code,b.code));
  const byId=new Map(endpoints.map(e=>[e.id,e])),vmById=new Map(vms.map(v=>[v.id,v]));
  // Another current endpoint of the same IP blocks a restore, except for approved port streams where several ports per IP are normal (same port still conflicts).
  const twins=await db.proxyIP.findMany({where:{projectId:scope.projectId,identityId:{in:endpoints.map(e=>e.identityId!)},inventoryState:{notIn:HISTORICAL_STATES},retiredAt:null},select:{id:true,identityId:true,port:true,identity:{select:{allocationMode:true}}}});
  const twinConflict=(e:EndpointRow)=>twins.some(t=>t.identityId===e.identityId&&t.id!==e.id&&(t.identity?.allocationMode!=='APPROVED_PORT_STREAM'||t.port===e.port));
  const seen=new Map<string,number>();for(const i of items) seen.set(i.endpointId,(seen.get(i.endpointId)||0)+1);
  const rows:EditRow[]=[...parseRows],planned:PlannedItem[]=[];
  const taken=new Map<string,number>();for(const i of items) if(i.location?.kind==='VM') taken.set(i.location.vmId,(taken.get(i.location.vmId)||0)+1);
  const picked=new Set<string>();
  for(const item of items){
    const e=byId.get(item.endpointId)!,ip=e.identity!.ip,current=positionLabel(e),plan:PlannedItem={row:item.row,endpointId:e.id};
    const push=(field:EditRow['field'],before:string,after:string,outcome:EditRow['outcome'],message:string,code?:IssueCode)=>rows.push({row:item.row,endpointId:e.id,ip,field,before,after,outcome,code,message});
    const duplicate=seen.get(e.id)!>1;
    if(item.group){
      const before=ownerLabel(e.identity!.owner,e.identity!.subgroup,e.group?.name);
      let after='',target:{owner:'SELF'|'OTHER';groupId:string|null;newName:string|null}|null=null,fail:{code:IssueCode;message:string}|null=null;
      if(item.group.kind==='TUT'){after='TUT';target={owner:'SELF',groupId:null,newName:null};}
      else if(item.group.kind==='GROUP'){const g=groups.find(g=>g.id===(item.group as {id:string}).id);if(!g) fail={code:'NOT_FOUND',message:'Không có nhóm này'};else if(g.archivedAt&&g.id!==e.groupId) fail={code:'INVALID_INPUT',message:'Nhóm "'+g.name+'" đã lưu trữ; mở lại nhóm hoặc chọn nhóm khác'};else{after=g.name;target={owner:'OTHER',groupId:g.id,newName:null};}}
      else{try{const n=assertGroupName(item.group.name);const existing=groups.find(g=>g.normalizedName===n.normalized);after=existing?existing.name:n.name;target=existing?{owner:'OTHER',groupId:existing.id,newName:null}:{owner:'OTHER',groupId:null,newName:n.name};}catch(err){fail={code:'INVALID_INPUT',message:err instanceof ProxyDomainError?err.message.replace(/^INVALID_INPUT: /,''):'Tên nhóm không hợp lệ'};}}
      if(fail) push('GROUP',before,after,'ERROR',fail.message,fail.code);
      else if(duplicate) push('GROUP',before,after,'ERROR','Proxy xuất hiện ở nhiều dòng; giữ một dòng','DUPLICATE_INPUT');
      else if(e.identity!.owner==='GENJY'||e.identity!.sourceRefs.some(s=>s.owner==='GENJY')) push('GROUP',before,after,'ERROR','Proxy genjy/PC chung luôn thuộc Genjy; không đổi nhóm','GENJY_RESERVED');
      else if(target!.owner===e.identity!.owner&&(target!.groupId||null)===(e.groupId||null)&&!target!.newName) push('GROUP',before,after,'SKIP','Đã ở nhóm này');
      else if(e.allocations.length||e.vm) push('GROUP',before,after,'ERROR','Proxy đang giữ hoặc đã cài trên VM; bỏ gán trước khi đổi nhóm','OWNER_CONFLICT');
      else{push('GROUP',before,after,'READY',target!.owner==='SELF'?'Chuyển về kho TUT':'Chuyển sang nhóm '+after);plan.group=target!;}
    }
    if(item.location){
      const loc=item.location,blocked=immovableReason(e);
      if(loc.kind==='UNASSIGN'){
        if(duplicate) push('LOCATION',current,'Bỏ gán','ERROR','Proxy xuất hiện ở nhiều dòng; giữ một dòng','DUPLICATE_INPUT');
        else if(!e.allocations.length&&!e.vm) push('LOCATION',current,'Bỏ gán','SKIP','Chưa gán; giữ nguyên');
        else if(blocked) push('LOCATION',current,'Bỏ gán','ERROR',blocked,'STALE_PREVIEW');
        else{push('LOCATION',current,'Bỏ gán','READY','Thả bản giao chưa cài; VM trống lại');plan.location={kind:'UNASSIGN'};}
      }else{
        const server=loc.kind==='SERVER'?vms.find(v=>v.serverId===loc.serverId)?.server:vmById.get(loc.vmId)?.server;
        const serverLabel=server?.code||'?';
        const eligible=assignableReason(e);
        let after=loc.kind==='VM'?(vmById.get(loc.vmId)?`${serverLabel}/${vmById.get(loc.vmId)!.code}`:'VM không có'):serverLabel;
        if(duplicate) push('LOCATION',current,after,'ERROR','Proxy xuất hiện ở nhiều dòng; giữ một dòng','DUPLICATE_INPUT');
        else if(!server||server.archivedAt||!server.managed) push('LOCATION',current,after,'ERROR','Server không có hoặc đã ẩn','NOT_FOUND');
        else if(loc.kind==='SERVER'&&e.allocations.some(a=>a.vm.serverId===loc.serverId)) push('LOCATION',current,current,'SKIP','Đã ở server này');
        else if(loc.kind==='VM'&&e.allocations.some(a=>a.vmId===loc.vmId&&a.role==='DESIRED')) push('LOCATION',current,after,'SKIP','Đã ở VM này');
        else if(eligible) push('LOCATION',current,after,'ERROR',eligible.message,eligible.code);
        else if(blocked) push('LOCATION',current,after,'ERROR',blocked,'STALE_PREVIEW');
        else if(loc.kind==='VM'){
          const vm=vmById.get(loc.vmId);
          if(!vm||vm.archivedAt) push('LOCATION',current,after,'ERROR','VM không có hoặc đã ẩn','NOT_FOUND');
          else if(taken.get(vm.id)!>1) push('LOCATION',current,after,'ERROR','VM được gán cho nhiều proxy trong cùng đợt','DUPLICATE_INPUT');
          else{const who=occupantOf(vm,e.id);if(who) push('LOCATION',current,after,'ERROR','VM đang giữ hoặc dùng proxy '+who+'; bỏ gán proxy đó trước','CURRENT_IP');else{push('LOCATION',current,after,'READY','Giao cấu hình mới; chờ cài thực tế');plan.location={kind:'VM',vmId:vm.id};}}
        }else{
          // Bulk server move: the next free VM (blank slot, nobody on it, not already chosen in this batch) in natural order.
          const vm=vms.find(v=>v.serverId===loc.serverId&&!v.archivedAt&&v.proxySlotState==='BLANK'&&!occupantOf(v)&&!taken.has(v.id)&&!picked.has(v.id));
          if(!vm) push('LOCATION',current,after,'ERROR','Hết VM trống trên server '+serverLabel,'NOT_FOUND');
          else{picked.add(vm.id);after=serverLabel+'/'+vm.code;push('LOCATION',current,after,'READY','Giao cấu hình mới; chờ cài thực tế');plan.location={kind:'VM',vmId:vm.id};}
        }
      }
    }
    if(item.manage){
      const m=item.manage,genjy=e.identity!.owner==='GENJY',stateLabel=genjy?'genjy':STATE_LABEL[e.inventoryState],retired=e.inventoryState==='RETIRED';
      if(m.kind==='RETIRE'){
        const plans=e.allocations.map(a=>a.vm.server.code+'/'+a.vm.code),blocked=immovableReason(e);
        if(duplicate) push('STATE',stateLabel,RETIRED_LABEL,'ERROR','Proxy xuất hiện ở nhiều dòng; giữ một dòng','DUPLICATE_INPUT');
        else if(genjy||e.identity!.sourceRefs.some(s=>s.owner==='GENJY')) push('STATE',stateLabel,RETIRED_LABEL,'ERROR','Proxy genjy/PC chung do Sheet Genjy quản; chỉ có thể lọc/ẩn, không ngừng quản lý','GENJY_RESERVED');
        else if(retired) push('STATE',stateLabel,RETIRED_LABEL,'SKIP','Đã ngừng quản lý');
        else if(HISTORICAL_STATES.includes(e.inventoryState)) push('STATE',stateLabel,RETIRED_LABEL,'SKIP','Đã ra khỏi kho hiện tại');
        else if(blocked) push('STATE',stateLabel,RETIRED_LABEL,'ERROR',blocked.replace(/; .*$/,'')+'; thay hoặc gỡ proxy ở Server/VM trước','STALE_PREVIEW');
        else if(plans.length&&!m.releasePlans) push('STATE',stateLabel,RETIRED_LABEL,'ERROR','Đang giao chờ cài cho '+plans.join(', ')+'; chọn "Huỷ giao" để ngừng quản lý','STALE_PREVIEW');
        else if(!m.reason.trim()) push('STATE',stateLabel,RETIRED_LABEL,'ERROR','Cần lý do ngừng quản lý','INVALID_INPUT');
        else{push('STATE',stateLabel,RETIRED_LABEL,'READY',plans.length?'Ngừng quản lý và huỷ giao '+plans.join(', ')+' (chưa gỡ ngoài máy)':'Ngừng quản lý; giữ IP, user/pass và lịch sử');plan.manage={kind:'RETIRE',reason:m.reason.trim(),releasePlans:!!plans.length};}
      }else{
        const note=readNotes(e.notesCipher).retired as RetiredNote|undefined,previous=note?.previousState&&STATE_LABEL[note.previousState]?note.previousState:'QUARANTINED';
        if(duplicate) push('STATE',stateLabel,'Khôi phục','ERROR','Proxy xuất hiện ở nhiều dòng; giữ một dòng','DUPLICATE_INPUT');
        else if(!retired) push('STATE',stateLabel,'Khôi phục','SKIP','Đang quản lý; không cần khôi phục');
        else if(twinConflict(e)) push('STATE',stateLabel,STATE_LABEL[previous],'ERROR','IP đã có dòng khác đang quản lý; không khôi phục trùng','CURRENT_IP');
        else{push('STATE',stateLabel,STATE_LABEL[previous],'READY','Khôi phục về trạng thái trước ('+STATE_LABEL[previous]+')');plan.manage={kind:'RESTORE'};}
      }
    }
    if(plan.group||plan.location||plan.manage) planned.push(plan);
  }
  rows.sort((a,b)=>a.row-b.row);
  return {rows,items:planned,needs};
}
async function facts(scope:ActorScope,plan:Plan,db:Reader){
  const ids=Array.from(new Set(plan.items.map(i=>i.endpointId)));
  const [endpoints,vms,holds,groups]=await Promise.all([
    db.proxyIP.findMany({where:{id:{in:ids}},select:{id:true,revision:true,identity:{select:{revision:true}}},orderBy:{id:'asc'}}),
    db.virtualMachine.findMany({where:{managed:true,server:{projectId:scope.projectId}},select:{id:true,revision:true,desiredConfigurationId:true,installedConfigurationId:true,proxyId:true},orderBy:{id:'asc'}}),
    db.vMProxyAllocation.findMany({where:{projectId:scope.projectId,releasedAt:null},select:{id:true,revision:true,endpointId:true,vmId:true},orderBy:{id:'asc'}}),
    db.proxyGroup.findMany({where:{projectId:scope.projectId},select:{id:true,name:true},orderBy:{id:'asc'}}),
  ]);
  return {endpoints,vms,holds,groups};
}
async function authorize(scope:ActorScope,needs:Plan['needs'],db:Reader){
  const current=await loadInfrastructureScope(db,scope.userId,scope.projectId);
  assertInfrastructureAction(current,'READ');if(current.businessMode!=='PROXY_VM') throw new ProxyDomainError('FORBIDDEN','Dự án chưa bật quản lý proxy/VM');
  if(needs.group||needs.manage) assertInfrastructureAction(current,'IMPORT');
  if(needs.location) assertInfrastructureAction(current,'ASSIGN');
  if(!needs.group&&!needs.location&&!needs.manage) assertInfrastructureAction(current,'ASSIGN');
  return current;
}
// Drop every unstarted plan of the endpoint: cancel configuration + task, release the hold, clear the VM pointer/Sheet link and blank the slot when nothing else sits there.
async function releasePlans(tx:Prisma.TransactionClient,images:Awaited<ReturnType<typeof snapshotCollector>>,endpoint:EndpointRow,reason:string,now:Date){
  for(const hold of endpoint.allocations){
    await images.remember('VM_ALLOCATION',hold.id);await images.remember('VM',hold.vmId);await images.remember('VM_CONFIG',hold.configurationId);
    const task=await tx.vMTask.findFirst({where:{configurationId:hold.configurationId}});if(task){await images.remember('VM_TASK',task.id);await tx.vMTask.update({where:{id:task.id},data:{status:'CANCELLED'}});}
    await tx.vMConfiguration.update({where:{id:hold.configurationId},data:{status:'CANCELLED',revision:{increment:1}}});
    await tx.vMProxyAllocation.update({where:{id:hold.id},data:{releasedAt:now,releaseReason:reason,revision:{increment:1}}});
    const vm=await tx.virtualMachine.findUniqueOrThrow({where:{id:hold.vmId},include:{allocations:{where:{releasedAt:null}}}});
    const empty=!vm.installedConfigurationId&&!vm.allocations.length&&(!vm.proxyId||vm.proxyId===endpoint.id);
    await tx.virtualMachine.update({where:{id:vm.id},data:{desiredConfigurationId:vm.desiredConfigurationId===hold.configurationId?null:vm.desiredConfigurationId,proxyId:vm.proxyId===endpoint.id?null:vm.proxyId,...(empty?{proxySlotState:'BLANK' as const}:{}),revision:{increment:1}}});
  }
  if(endpoint.vm&&!endpoint.allocations.some(a=>a.vmId===endpoint.vm!.id)){await images.remember('VM',endpoint.vm.id);const vm=await tx.virtualMachine.findUniqueOrThrow({where:{id:endpoint.vm.id},include:{allocations:{where:{releasedAt:null}}}});await tx.virtualMachine.update({where:{id:vm.id},data:{proxyId:null,...(!vm.installedConfigurationId&&!vm.desiredConfigurationId&&!vm.allocations.length?{proxySlotState:'BLANK' as const}:{}),revision:{increment:1}}});}
}
const dto=(batch:{token:string;previewRows:Prisma.JsonValue;expiresAt:Date}):EditPreview=>{const rows=batch.previewRows as unknown as EditRow[];return {token:batch.token,rows,ready:rows.filter(r=>r.outcome==='READY').length,skipped:rows.filter(r=>r.outcome==='SKIP').length,errors:rows.filter(r=>r.outcome==='ERROR').length,expiresAt:batch.expiresAt.toISOString()};};
// Registry edits (group / server / VM) for one or many rows. Preview stores the plan; commit re-plans inside the transaction and
// refuses when anything moved (revision facts), exactly like the import and VM allocation flows. Same key + same payload replays.
export function createProxyEditService(db:PrismaClient=prisma){
  async function preview(scope:ActorScope,input:EditInput):Promise<EditPreview>{
    const needs={group:!!input.items?.some(i=>i.group),location:!!input.paste||!!input.items?.some(i=>i.location),manage:!!input.items?.some(i=>i.manage)};
    const current=await authorize(scope,needs,db),payloadHash=vmHash(input);
    const prior=await db.proxyBatch.findUnique({where:{projectId_idempotencyKey:{projectId:scope.projectId,idempotencyKey:input.idempotencyKey}}});
    if(prior){if(prior.actorId!==scope.userId) throw new ProxyDomainError('FORBIDDEN');if(prior.kind!=='PROXY_EDIT'||prior.payloadHash!==payloadHash) throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');if(prior.status==='APPLIED') return dto(prior);}
    const plan=await planEdits(current,input,db),known=await facts(current,plan,db);
    // Facts travel inside the encrypted plan: jsonb would reorder keys and break the hash comparison at commit.
    const data={actorId:scope.userId,kind:'PROXY_EDIT',payloadHash,token:randomBytes(32).toString('base64url'),encryptedPlan:encrypt(JSON.stringify({input,plan,facts:known})),sourceHash:'n/a',revisionFacts:known as unknown as Prisma.InputJsonValue,previewRows:plan.rows as unknown as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+600000)};
    const batch=prior?await db.proxyBatch.update({where:{id:prior.id},data}):await db.proxyBatch.create({data:{...data,projectId:scope.projectId,idempotencyKey:input.idempotencyKey}});
    return dto(batch);
  }
  async function commit(scope:ActorScope,token:string,idempotencyKey:string):Promise<EditResult>{
    const original=await db.proxyBatch.findFirst({where:{token,projectId:scope.projectId,actorId:scope.userId,kind:'PROXY_EDIT'}});if(!original) throw new ProxyDomainError('NOT_FOUND');
    if(original.idempotencyKey!==idempotencyKey) throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');
    const replay=async(reader:Reader,batch:NonNullable<typeof original>)=>{const op=await reader.operationJournal.findUnique({where:{batchId:batch.id}}),undo=op?await reader.operationJournal.findUnique({where:{undoOfId:op.id}}):null;return {...batch.result as unknown as EditResult,replay:true,undone:!!undo};};
    if(original.status==='APPLIED') return replay(db,original);
    if(original.expiresAt.getTime()<=Date.now()) throw new ProxyDomainError('STALE_PREVIEW','Bản xem trước đã hết hạn; kiểm tra lại');
    return withProxyTransaction(async tx=>{
      const batch=await tx.proxyBatch.findUniqueOrThrow({where:{id:original.id}});if(batch.status==='APPLIED') return replay(tx,batch);
      if(batch.token!==token||batch.expiresAt.getTime()<=Date.now()) throw new ProxyDomainError('STALE_PREVIEW');
      const saved=JSON.parse(decrypt(batch.encryptedPlan)) as {input:EditInput;plan:Plan;facts:Awaited<ReturnType<typeof facts>>};if(vmHash(saved.input)!==batch.payloadHash) throw new ProxyDomainError('KEY_PAYLOAD_MISMATCH');
      const current=await authorize(scope,saved.plan.needs,tx),plan=await planEdits(current,saved.input,tx);
      if(vmHash(plan)!==vmHash(saved.plan)||vmHash(await facts(current,plan,tx))!==vmHash(saved.facts)) throw new ProxyDomainError('STALE_PREVIEW','Dữ liệu đã thay đổi; kiểm tra lại');
      const images=await snapshotCollector(tx,current),now=new Date(),createdGroups=new Map<string,string>();
      let groupsChanged=0,moved=0,unassigned=0,retired=0,restored=0;
      for(const item of plan.items){
        const endpoint=await tx.proxyIP.findFirstOrThrow({where:{id:item.endpointId,projectId:scope.projectId},include:endpointInclude});
        await images.remember('ENDPOINT',endpoint.id);
        if(item.group){
          let groupId=item.group.groupId;
          if(item.group.newName){const normalized=item.group.newName.toLocaleLowerCase('vi');groupId=createdGroups.get(normalized)||(await tx.proxyGroup.findUnique({where:{projectId_normalizedName:{projectId:scope.projectId,normalizedName:normalized}}}))?.id||(await tx.proxyGroup.create({data:{projectId:scope.projectId,name:item.group.newName,normalizedName:normalized,createdById:scope.userId}})).id;createdGroups.set(normalized,groupId);}
          if(endpoint.identity!.owner==='GENJY') throw new ProxyDomainError('GENJY_RESERVED');
          await tx.proxyIdentity.update({where:{id:endpoint.identityId!},data:{owner:item.group.owner,revision:{increment:1},lastSeenAt:now}});
          await tx.proxyIP.update({where:{id:endpoint.id},data:{groupId:item.group.owner==='OTHER'?groupId:null,revision:{increment:1}}});groupsChanged++;
        }
        if(item.location){
          if(immovableReason(endpoint)) throw new ProxyDomainError('STALE_PREVIEW');
          await releasePlans(tx,images,endpoint,item.location.kind==='UNASSIGN'?'Bỏ gán từ bảng proxy':'Chuyển vị trí từ bảng proxy',now);
          if(item.location.kind==='VM'){
            const vm=await tx.virtualMachine.findFirstOrThrow({where:{id:item.location.vmId,managed:true,archivedAt:null,server:{projectId:scope.projectId,managed:true,archivedAt:null}},include:vmInclude});
            if(occupantOf(vm,endpoint.id)||assignableReason(endpoint)) throw new ProxyDomainError('STALE_PREVIEW');
            await images.remember('VM',vm.id);
            const proxy=decodeEndpoint(endpoint)!,snapshot:ConfigurationSnapshot={proxy,packageCode:endpoint.packageCode,identityId:endpoint.identityId!,endpointRevision:endpoint.revision,server:vm.server.code,vm:vm.code};
            const config=await tx.vMConfiguration.create({data:{projectId:scope.projectId,vmId:vm.id,version:vm.configurationSequence+1,endpointId:endpoint.id,snapshotCipher:encrypt(JSON.stringify(snapshot)),configurationHash:vmHash(snapshot),createdById:scope.userId}});await images.remember('VM_CONFIG',config.id,true);
            const hold=await tx.vMProxyAllocation.create({data:{projectId:scope.projectId,vmId:vm.id,endpointId:endpoint.id,configurationId:config.id,allocationKey:endpoint.inventoryKey!,role:'DESIRED',createdById:scope.userId}});await images.remember('VM_ALLOCATION',hold.id,true);
            const task=await tx.vMTask.create({data:{vmId:vm.id,configurationId:config.id,type:'PROXY_INSTALL',title:`Cài proxy ${proxy.ip} · cấu hình #${config.version}`,scheduledAt:now}});await images.remember('VM_TASK',task.id,true);
            await tx.virtualMachine.update({where:{id:vm.id},data:{desiredConfigurationId:config.id,configurationSequence:{increment:1},proxySlotState:'FULL',revision:{increment:1}}});moved++;
          }else unassigned++;
          await tx.proxyIP.update({where:{id:endpoint.id},data:{revision:{increment:1}}});
        }
        if(item.manage){
          if(endpoint.identity!.owner==='GENJY') throw new ProxyDomainError('GENJY_RESERVED');
          const notes=readNotes(endpoint.notesCipher);
          if(item.manage.kind==='RETIRE'){
            if(endpoint.inventoryState==='RETIRED'||immovableReason(endpoint)) throw new ProxyDomainError('STALE_PREVIEW');
            if(endpoint.allocations.length||endpoint.vm){if(!item.manage.releasePlans) throw new ProxyDomainError('STALE_PREVIEW');await releasePlans(tx,images,endpoint,'Ngừng quản lý proxy: '+item.manage.reason,now);}
            const note:RetiredNote={reason:item.manage.reason,previousState:endpoint.inventoryState,previousStatus:endpoint.status,previousStatusAt:endpoint.statusAt?.toISOString()||null,by:scope.userId,at:now.toISOString()};
            await tx.proxyIP.update({where:{id:endpoint.id},data:{inventoryState:'RETIRED',status:'RESERVED',retiredAt:now,statusAt:now,notesCipher:encrypt(JSON.stringify({...notes,retired:note})),revision:{increment:1}}});
            await tx.proxyStatusEvent.create({data:{projectId:scope.projectId,identityId:endpoint.identityId!,endpointId:endpoint.id,ip:endpoint.identity!.ip,kind:'RETIRED',occurredAt:now,actorId:scope.userId,reason:item.manage.reason}});retired++;
          }else{
            if(endpoint.inventoryState!=='RETIRED') throw new ProxyDomainError('STALE_PREVIEW');
            const note=notes.retired as RetiredNote|undefined,previous:InventoryState=note?.previousState&&STATE_LABEL[note.previousState]?note.previousState:'QUARANTINED';
            if(await tx.proxyIP.findFirst({where:{projectId:scope.projectId,identityId:endpoint.identityId!,id:{not:endpoint.id},inventoryState:{notIn:HISTORICAL_STATES},retiredAt:null,...(endpoint.identity!.allocationMode==='APPROVED_PORT_STREAM'?{port:endpoint.port}:{})},select:{id:true}})) throw new ProxyDomainError('CURRENT_IP');
            const {retired:_r,...rest}=notes;
            await tx.proxyIP.update({where:{id:endpoint.id},data:{inventoryState:previous,status:(note?.previousStatus as 'AVAILABLE'|'IN_USE'|'BLOCKED'|'RESERVED'|undefined)||'AVAILABLE',retiredAt:null,statusAt:note?.previousStatusAt?new Date(note.previousStatusAt):now,notesCipher:Object.keys(rest).length?encrypt(JSON.stringify(rest)):null,revision:{increment:1}}});
            await tx.proxyStatusEvent.create({data:{projectId:scope.projectId,identityId:endpoint.identityId!,endpointId:endpoint.id,ip:endpoint.identity!.ip,kind:'RESTORED',occurredAt:now,actorId:scope.userId}});restored++;
          }
        }
      }
      const result:EditResult={batchId:batch.id,replay:false,rows:plan.rows,applied:plan.items.length,skipped:plan.rows.filter(r=>r.outcome==='SKIP').length,errors:plan.rows.filter(r=>r.outcome==='ERROR').length};
      if(plan.items.length) await recordOperation(tx,{scope:current,kind:'PROXY_EDIT',summary:{count:plan.items.length,groups:groupsChanged,moved,unassigned,retired,restored},snapshot:await images.finish(),batchId:batch.id});
      await tx.proxyBatch.update({where:{id:batch.id},data:{status:'APPLIED',appliedAt:now,result:result as unknown as Prisma.InputJsonValue}});
      await tx.auditLog.create({data:{userId:scope.userId,projectId:scope.projectId,action:'PROXY_EDIT',entity:'ProxyBatch',entityId:batch.id,changes:{applied:result.applied,skipped:result.skipped,errors:result.errors,groups:groupsChanged,moved,unassigned,retired,restored}}});
      return result;
    },db);
  }
  return {preview,commit};
}
