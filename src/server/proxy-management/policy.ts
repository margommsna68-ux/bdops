import {HISTORICAL_STATES,type Conflict,type Decision,type EndpointFact,type ExistingRef,type InventoryState,type IssueCode,type Owner,type ParsedProxy,type ProxyContext,type ReplacementContext} from './types';
const error=(code:IssueCode,message:string):Decision=>({outcome:'ERROR',code,message});
const ready=(message:string):Decision=>({outcome:'READY',message});
const STATE_LABEL:Record<InventoryState,string>={NEW:'mới, chưa gán',LIVE:'đang dùng',BLOCKED:'BLOCKED',REPLACED:'đã replace',DIE:'DIE',QUARANTINED:'cần kiểm tra',VOID:'đã huỷ ghi nhận',RETIRED:'ngừng quản lý'};
const day=(iso?:string|null)=>iso?new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(iso)):'';
const withDate=(text:string,iso?:string|null)=>{const d=day(iso);return d?`${text} ${d}`:text;};
// Why an input IP cannot become a new proxy: the same physical IP anywhere (any port, user/pass or package), in this
// project or another, now or in the past. Null means the IP is unknown to the system.
// Approved port streams are the one exception: the same owner may add another port; the same port is still a duplicate
// and that port's own history still counts. The exception comes only from the identity's reviewed allocationMode.
export function findConflict(p:ParsedProxy,owner:Owner,ctx:ProxyContext,projectId?:string,options:{ignoreGenjy?:boolean}={}):Conflict|null{
  const identity=ctx.identities.find(i=>i.ip===p.ip)||null,sameIp=ctx.endpoints.filter(e=>e.proxy.ip===p.ip);
  const mine=(e:EndpointFact)=>!projectId||e.projectId===projectId;
  const pick=(list:EndpointFact[])=>list.find(mine)||list[0];
  const existing=(e?:EndpointFact):ExistingRef|undefined=>{const id=identity?.id||e?.identityId;return id?{identityId:id,state:e?.inventoryState||null,owner:identity?.owner||'UNKNOWN',locations:e&&mine(e)?e.vmKeys:[],foreign:!!e&&!mine(e)}:undefined;};
  const active=sameIp.filter(e=>!e.retiredAt&&!HISTORICAL_STATES.includes(e.inventoryState));
  if(!options.ignoreGenjy&&(identity?.owner==='GENJY'||ctx.evidence.some(e=>e.ip===p.ip&&e.owner==='GENJY'))){
    // Genjy rows: only this project's own endpoint (if any) is described; the reservation itself is the reason, wherever the IP sits.
    const e=active.find(mine);return {code:'GENJY_RESERVED',message:'IP đã dành cho Genjy'+(e?` (${STATE_LABEL[e.inventoryState]}${e.vmKeys.length?' · '+e.vmKeys.join(', '):''})`:''),existing:existing(e)};
  }
  const stream=identity?.allocationMode==='APPROVED_PORT_STREAM'&&identity.owner===owner&&p.format==='FULL';
  const samePort=(e:EndpointFact)=>e.proxy.port===p.port;
  const blocking=stream?active.filter(samePort):active;
  if(blocking.length){
    const e=pick(blocking);
    if(!mine(e)) return {code:'CURRENT_IP',message:'IP đang thuộc dự án khác',existing:existing(e)};
    return {code:'CURRENT_IP',message:(stream?'Cổng này đã có trong kho':'Đã có trong kho')+` (${STATE_LABEL[e.inventoryState]})`+(e.vmKeys.length?' · '+e.vmKeys.join(', '):''),existing:existing(e)};
  }
  const past=(stream?sameIp.filter(samePort):sameIp).filter(e=>!active.includes(e));
  if(past.length){
    const e=pick(past);
    if(!mine(e)) return {code:'HISTORICAL_IP',message:'IP từng dùng ở dự án khác',existing:existing(e)};
    const receipt=ctx.receipts.find(r=>r.status==='APPLIED'&&r.oldIp===p.ip);
    const message=e.inventoryState==='RETIRED'?withDate('Đã ngừng quản lý',e.retiredAt)+'; khôi phục ở Lịch sử IP thay vì nhập lại'
      :e.inventoryState==='REPLACED'?withDate(receipt?`Đã replace bằng ${receipt.newIp}`:'Đã replace',e.retiredAt)
      :e.inventoryState==='VOID'?withDate('Đã hoàn tác / huỷ ghi nhận',e.retiredAt)
      :e.inventoryState==='DIE'?withDate('Đã ghi DIE',e.retiredAt):withDate('Đã ngừng dùng',e.retiredAt);
    return {code:'HISTORICAL_IP',message,existing:existing(e)};
  }
  if(stream) return null;
  const events=ctx.history.filter(h=>h.ip===p.ip);
  if(events.length){
    const last=[...events].sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt)).pop()!;
    const text=last.kind==='BLOCKED'?'Từng BLOCKED':last.kind==='REPLACED'?'Từng replace':last.kind==='VOID'?'Từng huỷ ghi nhận':last.kind==='DIE'?'Từng ghi DIE':'Đã nhận trước đây';
    return {code:'HISTORICAL_IP',message:withDate(text,last.occurredAt||last.recordedAt),existing:existing()};
  }
  // An identity without endpoints or events comes from Genjy evidence; decideReplacement judges that itself (bare completion), so skip it in ignoreGenjy mode.
  if(identity&&!options.ignoreGenjy) return {code:'HISTORICAL_IP',message:'IP đã xuất hiện trước đây',existing:existing()};
  return null;
}
export function decideNew(proxy:ParsedProxy,owner:Owner,ctx:ProxyContext,projectId?:string):Decision&{existing?:ExistingRef}{
  if(!ctx.source.scanSucceeded) return error('SOURCE_UNAVAILABLE','Chưa quét được danh sách Genjy');
  if(proxy.format!=='FULL') return error('INVALID_INPUT','Nhập mới cần đủ port, user và pass');
  if(owner==='UNKNOWN') return error('OWNER_CONFLICT','Chưa xác định proxy của ai');
  const conflict=findConflict(proxy,owner,ctx,projectId);
  if(conflict) return {...error(conflict.code,conflict.message),existing:conflict.existing};
  const stream=ctx.identities.some(i=>i.ip===proxy.ip&&i.allocationMode==='APPROVED_PORT_STREAM');
  return ready(stream?'Thêm cổng vào IP nhiều cổng đã duyệt':'Sẵn sàng nhập proxy mới');
}
export function decideBlock(candidates:EndpointFact[]):Decision{
  if(!candidates.length) return error('NOT_FOUND','Không tìm thấy proxy');
  if(candidates.length!==1) return error('AMBIGUOUS_OLD','IP có nhiều endpoint; cần nhập đầy đủ proxy');
  if(candidates[0].inventoryState==='BLOCKED') return {outcome:'SKIP',message:'Đã BLOCKED; giữ ngày ghi nhận cũ'};
  if(candidates[0].retiredAt||['REPLACED','DIE','VOID','RETIRED'].includes(candidates[0].inventoryState)) return error('HISTORICAL_IP','Proxy đã ngừng dùng; mở lịch sử để kiểm tra');
  return ready('Ghi BLOCKED và ngày giờ hiện tại');
}
export function decideReplacement(c:ReplacementContext):Decision{
  if(c.exactReceiptReplay) return {outcome:'SKIP',message:'Cặp replace đã được ghi nhận'};
  if(!c.sourceScanSucceeded) return error('SOURCE_UNAVAILABLE','Chưa quét được danh sách Genjy');
  if(!c.old||!c.oldIdentity||!c.oldCandidates) return error('NOT_FOUND','Không tìm thấy proxy cũ');
  if(c.oldCandidates!==1) return error('AMBIGUOUS_OLD','Nhập đầy đủ proxy cũ để chọn đúng endpoint');
  if(c.old.inventoryState!=='BLOCKED') return error('NOT_BLOCKED','Proxy cũ chưa được ghi BLOCKED');
  if(c.oldIdentity.owner==='UNKNOWN') return error('OWNER_CONFLICT','Chưa xác định chủ sở hữu proxy cũ');
  if(c.old.proxy.ip===c.next.ip) return error('CURRENT_IP','IP thay thế giống IP cũ');
  if(c.nextConflict) return error(c.nextConflict.code,c.nextConflict.message);
  // Approved port stream of the same (non-Genjy) owner: the new port joins the stream; findConflict already refused same-port and history.
  if(!c.nextEvidence.length&&c.nextIdentities.length&&c.nextIdentities.every(i=>i.allocationMode==='APPROVED_PORT_STREAM'&&i.owner===c.oldIdentity!.owner&&i.owner!=='GENJY')) return ready('Nhận proxy thay thế; thêm cổng vào IP nhiều cổng đã duyệt');
  if(c.nextEvidence.length||c.nextIdentities.length){
    const owner=c.oldIdentity.owner, subgroup=c.oldIdentity.subgroup;
    const sameGenjy=owner==='GENJY'&&c.nextEvidence.length>0&&c.nextEvidence.every(e=>e.owner===owner&&e.subgroup===subgroup&&e.format==='BARE'&&!e.hasFullCredentials&&!e.hasManualMetadata)&&c.nextIdentities.every(i=>i.owner===owner&&i.subgroup===subgroup);
    if(!sameGenjy) return error('OWNER_CONFLICT','IP đã có bằng chứng sở hữu hoặc thông tin cũ cần kiểm tra');
    return ready('Hoàn thiện proxy trong cùng Genjy; giữ nguyên chủ sở hữu');
  }
  return ready('Nhận proxy thay thế; proxy mới chờ gán VM');
}
