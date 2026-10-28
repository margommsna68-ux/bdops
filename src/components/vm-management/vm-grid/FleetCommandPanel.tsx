"use client";
import {useEffect,useRef,useState} from 'react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {FleetCreate,READ_ACTIONS,type CreateInput} from '@/server/fleet-commands/schema';

type Target={projectId:string;serverId:string;vmId:string};
type Control=inferRouterOutputs<AppRouter>['fleetCommands']['control'];
const ACTION:Record<string,string>={START_VM:'Bật VM',SHUTDOWN_VM:'Tắt VM nhẹ nhàng',POWER_OFF_VM:'Tắt nguồn VM',CHECK_HEALTH:'Kiểm tra sức khỏe',CHECK_PROXY:'Kiểm tra proxy',REPLACE_PROXY:'Áp dụng proxy mới trên máy (AE)',RECREATE_VM:'Tạo lại VM (AE)',READ_SDK:'Lấy SDK lên web'};
const STATE:Record<string,string>={QUEUED:'Đang chờ',CLAIMED:'Đã nhận lệnh',DISPATCHED:'Đã chuyển thực hiện',UNKNOWN:'Chưa rõ kết quả — cần đối soát',SUCCEEDED:'Đã xác minh hoàn tất',FAILED:'Đã xác minh thất bại',CANCELLED:'Đã huỷ trước khi thực hiện',EXPIRED:'Đã hết hạn',REFUSED:'Đã từ chối'};
const PROGRESS:Record<string,string>={RECEIVED:'Đã nhận',AE_ACCEPTED:'AE đã nhận',VERIFYING:'Đang xác minh',CANCEL_REQUESTED:'Đã yêu cầu huỷ',RECONCILING:'Đang đối soát'};
function restore(key:string,target:Target){
 try{
  const raw=sessionStorage.getItem(key);if(!raw)return {pending:null,corrupt:false};
  if(raw.length>4096)throw new Error();
  const b=FleetCreate.parse(JSON.parse(raw));
  if(b.projectId!==target.projectId||b.serverId!==target.serverId||b.vmId!==target.vmId)throw new Error();
  return {pending:b,corrupt:false};
 }catch{return {pending:null,corrupt:true};}
}
export function FleetCommandPanel(target:Target){
 return <FleetControl key={target.projectId+':'+target.serverId+':'+target.vmId} target={target}/>;
}
function FleetControl({target}:{target:Target}){
 const q=trpc.fleetCommands.control.useQuery(target,{refetchInterval:5000,keepPreviousData:false,retry:false});
 if(q.error)return <section className="vm-panel-card"><h3>Điều khiển VM</h3><p role="alert" className="pm-error">{q.error.message}</p></section>;
 if(!q.data)return <p className="pm-muted text-xs">Đang kiểm tra quyền điều khiển…</p>;
 return <FleetControls key={q.data.userId} target={target} data={q.data} refreshing={q.isFetching} reload={async()=>{await q.refetch();}}/>;
}
function FleetControls({target,data,refreshing,reload}:{target:Target;data:Control;refreshing:boolean;reload:()=>Promise<void>}){
 const storageKey='mth-fleet:'+data.userId+':'+target.projectId+':'+target.serverId+':'+target.vmId;
 const [stored,setStored]=useState(()=>restore(storageKey,target)),[chosen,setChosen]=useState<CreateInput['action']>('CHECK_HEALTH'),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false);
 const create=trpc.fleetCommands.create.useMutation(),cancel=trpc.fleetCommands.cancel.useMutation();
 const cap=data.capability,scopeMatches=cap?.binding.projectId===target.projectId&&cap.binding.serverId===target.serverId&&cap.binding.vmId===target.vmId;
 const actions=scopeMatches?cap!.actions:[],action=actions.includes(chosen)?chosen:actions.includes('CHECK_HEALTH')?'CHECK_HEALTH':actions[0];
 const signature=JSON.stringify(cap?.binding);
 useEffect(()=>setConfirmed(false),[signature,action]);
 async function send(){
  if(lock.current||refreshing||stored.corrupt||(!stored.pending&&(!scopeMatches||!action||!READ_ACTIONS.includes(action)&&!confirmed)))return;
  lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const body=stored.pending??FleetCreate.parse({...cap!.binding,action,operationId:crypto.randomUUID(),ttlSeconds:300});
   // Persist the FULL immutable body before contacting the server. Never make a new ID after an uncertain answer.
   try{sessionStorage.setItem(storageKey,JSON.stringify(body));}catch{throw new Error('Chưa lưu được lệnh trong phiên này; chưa gửi.');}
   setStored({pending:body,corrupt:false});
   await create.mutateAsync(body);
   // A closed instance's late ACK must not remove a newer command created in the reopened panel.
   if(sessionStorage.getItem(storageKey)===JSON.stringify(body))sessionStorage.removeItem(storageKey);
   setStored({pending:null,corrupt:false});setConfirmed(false);setNotice('Đã ghi nhận lệnh. Theo dõi kết quả bên dưới.');
   void reload();
  }catch(e){setError(e instanceof Error?e.message:'Chưa nhận được kết quả; thử lại đúng lệnh cũ.');}
  finally{lock.current=false;setBusy(false);}
 }
 async function requestCancel(operationId:string){
  if(lock.current||refreshing)return;lock.current=true;setBusy(true);setError('');
  try{await cancel.mutateAsync({projectId:target.projectId,operationId});setNotice('Đã ghi nhận yêu cầu huỷ; thao tác đã thực hiện không đảo ngược.');void reload();}
  catch(e){setError(e instanceof Error?e.message:'Chưa xác nhận yêu cầu huỷ; có thể thử lại.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="vm-panel-card space-y-2" aria-label="Điều khiển VM"><h3>Điều khiển VM</h3>
  {stored.corrupt?<p role="alert" className="pm-error">Không đọc được lệnh đang giữ. Cần đối soát trước khi gửi lệnh mới.</p>:stored.pending?<div className="space-y-2"><p className="pm-muted text-xs">Chưa xác nhận lệnh {ACTION[stored.pending.action]}. Giữ nguyên nội dung và mã lệnh khi thử lại.</p><button type="button" className="pm-button" disabled={busy||refreshing} onClick={()=>void send()}>Thử lại đúng lệnh cũ</button></div>:scopeMatches&&actions.length?<form className="space-y-2" onSubmit={e=>{e.preventDefault();void send();}}>
   <label className="block text-xs">Lệnh cho VM này<select aria-label="Lệnh VM" className="pm-input w-full" value={action} disabled={busy||refreshing} onChange={e=>{setChosen(e.target.value as CreateInput['action']);setConfirmed(false);}}>{actions.map(a=><option key={a} value={a}>{ACTION[a]}</option>)}</select></label>
   {!READ_ACTIONS.includes(action!)&&<label className="flex gap-2 text-xs items-start"><input type="checkbox" checked={confirmed} disabled={busy||refreshing} onChange={e=>setConfirmed(e.target.checked)}/>Tôi xác nhận {ACTION[action!].toLowerCase()} trên VM này.{action==='RECREATE_VM'&&' AE xoá máy cũ và tạo máy mới; web mở lượt mới và lấy SDK mới.'}{action==='REPLACE_PROXY'&&' AE tắt VM, áp proxy mới rồi bật lại.'}</label>}
   <button className="pm-button" type="submit" disabled={busy||refreshing||!READ_ACTIONS.includes(action!)&&!confirmed}>Gửi lệnh</button>
  </form>:<p className="pm-muted text-xs">Điều khiển VM đang tạm khóa. Cần quyền hiện tại và canary được backend cho phép.</p>}
  {error&&<p role="alert" className="pm-error text-xs">{error}</p>}{notice&&<p role="status" className="text-xs">{notice}</p>}
  <p className="pm-muted text-xs">Huỷ sau khi đã chuyển thực hiện chỉ là yêu cầu; không đảo ngược thao tác trên máy.</p>
  <ul className="space-y-2 text-xs" aria-label="Lệnh gần đây" aria-live="polite">{data.items.map(c=><li key={c.operationId} className="space-y-1"><strong>{ACTION[c.action]||c.action}</strong> · {STATE[c.state]||c.state}<div className="pm-muted break-all">{c.operationId}</div>
   {c.events.map(e=>{const code=e.detail&&typeof e.detail==='object'&&!Array.isArray(e.detail)&&'code' in e.detail?String(e.detail.code):'';return <p key={e.eventId} className="pm-muted">{PROGRESS[code]??(e.kind==='NATIVE_AUTH'?'Đã cấp quyền bắt đầu native':e.kind==='DISPATCH'?'Đã chuyển lệnh':e.kind==='COMPLETE'?'Đã ghi nhận kết quả':'Đã cập nhật tiến độ')}</p>;})}
   {c.cancelRequestedAt&&<p>Đã yêu cầu huỷ; chờ kết quả thực tế.</p>}{c.canCancel&&<button type="button" className="pm-button pm-button-quiet" disabled={busy||refreshing} onClick={()=>void requestCancel(c.operationId)}>Yêu cầu huỷ</button>}
  </li>)}</ul>{!data.items.length&&<p className="pm-muted text-xs">Chưa có lệnh cho VM này.</p>}
 </section>;
}
