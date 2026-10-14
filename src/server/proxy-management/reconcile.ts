import type {Owner,ProxyContext,ReconciliationPlan,SheetSnapshot,Subgroup} from './types';
import {fullProxy} from './parse';
export function buildReconciliation(input:SheetSnapshot,existing:ProxyContext):ReconciliationPlan{
  const ownership=new Map<string,{ip:string;owner:Owner;subgroup:Subgroup;sourceRefs:string[]}>();
  for(const row of input.rows){
    if(!row.proxy||row.kind==='LOOKUP_HISTORY'||row.kind==='VM') continue;
    const previous=ownership.get(row.proxy.ip),known=existing.identities.find(i=>i.ip===row.proxy!.ip);
    const genjy=known?.owner==='GENJY'||previous?.owner==='GENJY'||row.kind==='GENJY_REFERENCE';
    const owner=genjy?'GENJY':row.owner;
    const subgroup=known?.subgroup==='PC_CHUNG'||previous?.subgroup==='PC_CHUNG'||row.subgroup==='PC_CHUNG'?'PC_CHUNG':null;
    ownership.set(row.proxy.ip,{ip:row.proxy.ip,owner,subgroup:owner==='GENJY'?subgroup:null,sourceRefs:[...(previous?.sourceRefs||[]),row.sourceRef]});
  }
  const seen=new Set<string>();
  const rows=input.rows.map((row,index)=>{
    const base={row:index+1,sourceRefs:[row.sourceRef]};
    if(row.kind==='LOOKUP_HISTORY') return {...base,outcome:'SKIP' as const,message:'Chỉ dùng tra lịch sử; không tính vào kho hiện hành'};
    if(row.kind==='VM') return {...base,outcome:'SKIP' as const,message:row.valueState==='BLANK'?'VM thiếu proxy':row.valueState==='FULL'?'Vị trí VM để đối chiếu':'Giữ nguyên ô cần kiểm tra'};
    if(!row.proxy) return {...base,outcome:'ERROR' as const,code:'INVALID_INPUT' as const,message:'Dòng chưa nhận diện được proxy'};
    const p=row.proxy,owner=ownership.get(p.ip)!;
    const known=existing.identities.find(i=>i.ip===p.ip);
    if((known?.owner==='GENJY'||owner.owner==='GENJY')&&row.owner==='SELF') return {...base,outcome:'ERROR' as const,code:'OWNER_CONFLICT' as const,newIp:p.ip,owner:'GENJY' as const,message:'IP của Genjy; cần đối chiếu xung đột sở hữu'};
    if(row.kind==='OWNER_DECISION'||row.kind==='GENJY_REFERENCE') return {...base,outcome:'SKIP' as const,newIp:p.ip,owner:owner.owner,message:'Giữ bằng chứng sở hữu; chưa phải hàng đầy đủ'};
    const variants=new Set(input.rows.filter(r=>r.kind==='CURRENT_INVENTORY'&&r.proxy?.ip===p.ip).map(r=>JSON.stringify({proxy:r.proxy,owner:r.owner,subgroup:r.subgroup})));
    if(variants.size>1) return {...base,outcome:'ERROR' as const,code:'DUPLICATE_INPUT' as const,newIp:p.ip,message:'Cùng IP có thông tin hiện hành khác nhau; cần kiểm tra trước khi nhập'};
    if(seen.has(p.ip)) return {...base,outcome:'SKIP' as const,newIp:p.ip,message:'Cùng IP đã có dòng đối chiếu'};
    seen.add(p.ip);
    if(p.format==='BARE'||owner.owner==='UNKNOWN') return {...base,outcome:'ERROR' as const,code:'OWNER_CONFLICT' as const,newIp:p.ip,message:'Cần đủ thông tin và xác định chủ sở hữu'};
    const endpoints=existing.endpoints.filter(e=>e.proxy.ip===p.ip);
    if(endpoints.length){
      if(endpoints.some(e=>['REPLACED','DIE'].includes(e.inventoryState))) return {...base,outcome:'ERROR' as const,code:'HISTORICAL_IP' as const,newIp:p.ip,message:'IP có lịch sử đã loại; không nhận lại thành hàng hiện hành'};
      if(endpoints.length!==1||endpoints[0].proxy.format!=='FULL'||fullProxy(endpoints[0].proxy)!==fullProxy(p)) return {...base,outcome:'ERROR' as const,code:'CURRENT_IP' as const,newIp:p.ip,message:'IP đã có với thông tin khác; cần đối chiếu trước'};
      return {...base,outcome:'SKIP' as const,newIp:p.ip,message:'Đã có đúng proxy trong kho; giữ dữ liệu web hiện tại'};
    }
    if(existing.history.some(e=>e.ip===p.ip)||existing.receipts.some(e=>e.oldIp===p.ip||e.newIp===p.ip)) return {...base,outcome:'ERROR' as const,code:'HISTORICAL_IP' as const,newIp:p.ip,message:'IP đã có lịch sử; không tự phục hồi từ Sheet'};
    if(!existing.source.scanSucceeded) return {...base,outcome:'ERROR' as const,code:'SOURCE_UNAVAILABLE' as const,newIp:p.ip,message:'Chưa quét được nguồn Genjy; chưa nhận proxy vào kho'};
    return {...base,outcome:'READY' as const,newIp:p.ip,owner:owner.owner,subgroup:owner.subgroup,message:'Sẵn sàng đối chiếu kho; chưa tự gán VM'};
  });
  return {rows,snapshots:input.snapshots.map(({evidence:_evidence,...snapshot})=>snapshot),ownership:Array.from(ownership.values()),vmRefs:input.rows.filter(r=>r.kind==='VM'&&r.vmKey).map(r=>{
    const exact=existing.endpoints.filter(e=>r.valueState==='FULL'&&r.proxy?.format==='FULL'&&e.proxy.format==='FULL'&&fullProxy(e.proxy)===fullProxy(r.proxy));
    return {vmKey:r.vmKey!,sourceRef:r.sourceRef,valueState:r.valueState,endpointId:exact.length===1?exact[0].id:null};
  })};
}
