import type {Decision,EndpointFact,IssueCode,Owner,ParsedProxy,ProxyContext,ReplacementContext} from './types';
const error=(code:IssueCode,message:string):Decision=>({outcome:'ERROR',code,message});
const ready=(message:string):Decision=>({outcome:'READY',message});
export function decideNew(proxy:ParsedProxy,owner:Owner,ctx:ProxyContext):Decision{
  if(!ctx.source.scanSucceeded) return error('SOURCE_UNAVAILABLE','Chưa quét được danh sách Genjy');
  if(proxy.format!=='FULL') return error('INVALID_INPUT','Nhập mới cần đủ port, user và pass');
  if(owner==='UNKNOWN') return error('OWNER_CONFLICT','Chưa xác định proxy của ai');
  if(ctx.evidence.some(e=>e.ip===proxy.ip&&e.owner==='GENJY')||ctx.identities.some(i=>i.ip===proxy.ip&&i.owner==='GENJY')) return error('GENJY_RESERVED','IP đã dành cho Genjy');
  if(ctx.endpoints.some(e=>e.proxy.ip===proxy.ip&&!e.retiredAt&&!['REPLACED','VOID','RETIRED'].includes(e.inventoryState))) return error('CURRENT_IP','IP đã có trong hệ thống');
  if(ctx.history.some(h=>h.ip===proxy.ip)||ctx.identities.some(i=>i.ip===proxy.ip)) return error('HISTORICAL_IP','IP đã xuất hiện trước đây');
  return ready('Sẵn sàng nhập proxy mới');
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
  if(c.nextInInventory||c.nextInVmOrReservation) return error('CURRENT_IP','IP mới đã có hoặc đang được dùng');
  if(c.nextHistory.length) return error('HISTORICAL_IP','Nhà cung cấp đã gửi IP này trước đây');
  if(c.nextEvidence.length||c.nextIdentities.length){
    const owner=c.oldIdentity.owner, subgroup=c.oldIdentity.subgroup;
    const sameGenjy=owner==='GENJY'&&c.nextEvidence.length>0&&c.nextEvidence.every(e=>e.owner===owner&&e.subgroup===subgroup&&e.format==='BARE'&&!e.hasFullCredentials&&!e.hasManualMetadata)&&c.nextIdentities.every(i=>i.owner===owner&&i.subgroup===subgroup);
    if(!sameGenjy) return error('OWNER_CONFLICT','IP đã có bằng chứng sở hữu hoặc thông tin cũ cần kiểm tra');
    return ready('Hoàn thiện proxy trong cùng Genjy; giữ nguyên chủ sở hữu');
  }
  return ready('Nhận proxy thay thế; proxy mới chờ gán VM');
}
