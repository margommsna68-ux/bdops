// What the Tình trạng cell offers for one VM. The label reflects configuration and install progress (never a free status field);
// only actions the backend accepts right now are offered, and only to people with the matching right.
import {vmView} from '@/server/vm-management/state';
export type StatusActionKind='START'|'COPY_INSTALL'|'CONFIRM'|'FAIL'|'AUTOFILL'|'ASSIGN'|'CHANGE_PROXY'|'OPEN_INSTALL'|'OPEN_REGISTRY';
export interface StatusAction {kind:StatusActionKind;label:string}
export type StatusTone='missing'|'pending'|'progress'|'failed'|'installed'|'review'|'deleted';
export interface StatusInfo {label:string;tone:StatusTone;reason:string|null;actions:StatusAction[];readOnlyNote:string|null;target:{ip:string;port:number|null;version:number}|null}
type Hold={endpointId:string;ip:string|null;role:string;state:string;owner:string;shared?:boolean};
type Config={id:string;endpointId:string|null;version:number;status:string;startedAt:string|null;failureNote:string|null;ip:string|null;port:number|null};
export interface StatusVM {archivedAt:string|null;slotState:string;desired:Config|null;installed:Config|null;holds:Hold[]}
export interface StatusRights {assign:boolean;confirm:boolean;copy:boolean;sourceConnected:boolean}
const proxy=(c:{ip:string|null;port:number|null})=>(c.ip||'?')+(c.port?':'+c.port:'');
export function statusInfo(vm:StatusVM,r:StatusRights):StatusInfo{
  const view=vmView(vm as never),pending=vm.desired&&vm.desired.id!==vm.installed?.id?vm.desired:null;
  const target=pending?vm.holds.find(h=>h.endpointId===pending.endpointId):undefined;
  const targetOk=!!target&&(target.owner==='SELF'||!!target.shared)&&['NEW','LIVE'].includes(target.state);
  const actions:StatusAction[]=[],add=(ok:boolean,kind:StatusActionKind,label:string)=>{if(ok) actions.push({kind,label});};
  const canAssign=r.assign&&r.sourceConnected,info=(label:string,tone:StatusTone,reason:string|null):StatusInfo=>({label,tone,reason,actions,readOnlyNote:null,target:pending?{ip:pending.ip||'?',port:pending.port,version:pending.version}:null});
  if(vm.archivedAt) return {...info('Đã xoá','deleted','Máy đã xoá; khôi phục ở bộ lọc Đã xoá trước khi thao tác.'),actions:[]};
  let out:StatusInfo;
  if(view==='MISSING'){
    add(canAssign,'AUTOFILL','Tự điền 1 proxy TUT NEW chưa dùng');add(canAssign,'ASSIGN','Chọn proxy (TUT hoặc nhóm chung)…');
    out=info('Thiếu proxy','missing','VM chưa có proxy được giao.');
  }else if(view==='INSTALLED'){
    add(canAssign,'CHANGE_PROXY','Đổi proxy…');
    out=info('Đã cài','installed','Đã xác nhận cài '+proxy(vm.installed!)+' (cấu hình #'+vm.installed!.version+').');
  }else{
    // A proxy that cannot be installed (unknown owner, BLOCKED, released) is a review case first, whatever its install progress.
    const ownerIssue=!!pending&&!targetOk,failed=pending?.status==='FAILED'&&!ownerIssue,started=!!pending?.startedAt;
    if(pending&&targetOk&&!started){add(r.confirm,'START','Bắt đầu cài');add(r.confirm&&r.copy,'COPY_INSTALL','Copy proxy để cài (bắt đầu cài)');}
    if(pending&&targetOk&&started){add(r.confirm&&r.sourceConnected,'CONFIRM','Xác nhận đã cài');add(r.confirm,'FAIL',failed?'Sửa vướng mắc':'Cài chưa xong…');}
    if(vm.holds.some(h=>h.role==='UNCERTAIN'&&h.state!=='BLOCKED')) add(true,'OPEN_INSTALL','Kiểm tra trên máy (Việc cài)');
    if(ownerIssue||vm.holds.some(h=>h.state==='BLOCKED')) add(true,'OPEN_REGISTRY','Xem proxy ở bảng proxy');
    add(canAssign,pending||vm.installed||vm.holds.length?'CHANGE_PROXY':'ASSIGN',pending||vm.installed||vm.holds.length?'Đổi proxy…':'Chọn proxy (TUT hoặc nhóm chung)…');
    const reason=failed?'Vướng mắc: '+(pending!.failureNote||'chưa ghi'):ownerIssue?(pending!.failureNote?pending!.failureNote+' — ':'')+'Proxy giao '+proxy(pending!)+' '+(target?(['NEW','LIVE'].includes(target.state)?'chưa rõ sở hữu / không thuộc TUT hay nhóm chung':'đang '+target.state):'không còn được giữ cho VM')+'; không cài được, đổi proxy hoặc xử lý ở bảng proxy.'
      :vm.holds.some(h=>h.state==='BLOCKED')?'Proxy '+vm.holds.filter(h=>h.state==='BLOCKED').map(h=>h.ip).join(', ')+' đang BLOCKED: thay proxy (Kho proxy → Thay proxy) rồi giao proxy mới cho VM.':vm.holds.some(h=>h.role==='UNCERTAIN')?'Có proxy giữ để kiểm tra: '+vm.holds.filter(h=>h.role==='UNCERTAIN').map(h=>h.ip).join(', ')+'. Kiểm tra thực tế trên máy.'
      :view==='REVIEW'&&!pending?'Ô proxy cũ có công thức hoặc nội dung chưa rõ; chọn proxy để giao.':started?'Đang cài '+proxy(pending!)+' (cấu hình #'+pending!.version+').':pending?'Chờ cài '+proxy(pending)+' (cấu hình #'+pending.version+').':null;
    // A BLOCKED proxy on the VM is named as what has to be done (19/10/2026): replace it.
    const blocked=vm.holds.some(h=>h.state==='BLOCKED');
    out=info(blocked?'Cần thay proxy':failed?'Cài chưa xong':view==='REVIEW'?'Cần kiểm tra':started?'Đang cài':'Chờ cài',blocked?'review':failed?'failed':view==='REVIEW'?'review':started?'progress':'pending',reason);
  }
  if(!(r.assign||r.confirm)) out.readOnlyNote='Chỉ xem: tài khoản này chưa có quyền giao proxy hay xác nhận cài.';
  else if(!r.sourceConnected&&(view==='MISSING'||out.actions.length===0)) out.readOnlyNote='Cần kết nối nguồn Genjy trước khi giao proxy hoặc xác nhận cài.';
  return out;
}
