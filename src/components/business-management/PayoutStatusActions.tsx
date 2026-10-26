"use client";
import {useRef,useState} from 'react';
import toast from 'react-hot-toast';
import type {inferRouterInputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
type Body=inferRouterInputs<AppRouter>['vmOps']['updatePayout'];
type Row={id:string;vmId:string;earnAppId:string;cycle:number;revision:number;current:boolean;consumed:boolean;status:string};
type Action='SENT'|'UNKNOWN'|'FAILED'|'CANCELLED';
const actions:Record<Action,string>={SENT:'Đã gửi trên EarnApp → Chờ về PayPal',UNKNOWN:'Chưa xác định kết quả gửi',FAILED:'Thất bại',CANCELLED:'Huỷ yêu cầu'};
export function PayoutStatusActions({projectId,userId,row,manage,markSubmission,onDone}:{projectId:string;userId:string;row:Row;manage:boolean;markSubmission:boolean;onDone:()=>void}){
 const [snapshot]=useState(row),journal='mth-payout-status:'+JSON.stringify([projectId,userId,snapshot.id]);
 const [initial]=useState(()=>{try{const raw=sessionStorage.getItem(journal);if(!raw)return {body:null,error:''};const body=JSON.parse(raw) as Body;if(body.projectId!==projectId||body.requestId!==snapshot.id||body.vmId!==snapshot.vmId||body.earnAppId!==snapshot.earnAppId||body.expectedCycle!==snapshot.cycle||typeof body.key!=='string'||!Object.hasOwn(actions,body.action))throw Error();return {body,error:''};}catch{return {body:null,error:'Không đọc được lệnh thử lại đã lưu trong phiên. Giữ nguyên phiên và đối chiếu yêu cầu trước khi làm tiếp.'};}});
 const [pending,setPending]=useState<Body|null>(initial.body),[action,setAction]=useState<Action|''>((initial.body?.action as Action)||''),[note,setNote]=useState(initial.body?.note||''),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(initial.error),[busy,setBusy]=useState(false);
 const lock=useRef(false),update=trpc.vmOps.updatePayout.useMutation(),utils=trpc.useUtils();
 const changed=row.revision!==snapshot.revision||!row.current||row.consumed;
 const options:Action[]=[...(markSubmission&&['PREPARING','UNKNOWN'].includes(snapshot.status)?['SENT' as const]:[]),...(markSubmission&&snapshot.status==='PREPARING'?['UNKNOWN' as const]:[]),...(manage&&['PREPARING','UNKNOWN','WAITING','PARTIAL','REVIEW'].includes(snapshot.status)?['FAILED' as const,'CANCELLED' as const]:[])];
 const reason=action==='FAILED'||action==='CANCELLED',disabled=busy||!!initial.error||(!pending&&(changed||!action||reason&&!note.trim()||action==='SENT'&&!confirmed));
 async function save(){
  if(disabled||lock.current)return;lock.current=true;setBusy(true);setError('');const retry=!!pending;
  let command=pending;
  try{
   if(!command){command={projectId,key:crypto.randomUUID(),requestId:snapshot.id,expectedRevision:snapshot.revision,vmId:snapshot.vmId,expectedCycle:snapshot.cycle,earnAppId:snapshot.earnAppId,action:action as Action,note:note.trim()||null};sessionStorage.setItem(journal,JSON.stringify(command));setPending(command);}
   await update.mutateAsync(command);sessionStorage.removeItem(journal);setPending(null);toast.success('Đã cập nhật trạng thái yêu cầu rút');onDone();
   void Promise.all([utils.vmOps.invalidate(),utils.businessManagement.invalidate()]).catch(()=>undefined);
  }catch(e){
   const code=(e as {data?:{code?:string}})?.data?.code;
   // A refused retry cannot settle an earlier command whose answer was lost.
   if(!retry&&code&&['BAD_REQUEST','UNAUTHORIZED','FORBIDDEN','NOT_FOUND','CONFLICT','PRECONDITION_FAILED','UNPROCESSABLE_CONTENT','TOO_MANY_REQUESTS'].includes(code)){sessionStorage.removeItem(journal);setPending(null);}
   setError(e instanceof Error?e.message:'Chưa nhận được kết quả. Thử lại đúng lệnh đã lưu.');
  }finally{lock.current=false;setBusy(false);}
 }
 if((!snapshot.current||snapshot.consumed||!options.length)&&!pending)return <p className="pm-muted">Yêu cầu cũ hoặc đã chốt: mở Lịch sử của VM để đối chiếu.</p>;
 return <div className="pr-status-editor">
  <h2>Cập nhật trạng thái yêu cầu</h2>
  <label>Trạng thái<select className="pm-input" aria-label="Đổi trạng thái yêu cầu" value={action} disabled={busy||!!pending} onChange={e=>{setAction(e.target.value as Action);setError('');}}><option value="">Chọn thao tác</option>{options.map(k=><option key={k} value={k}>{actions[k]}</option>)}{pending&&!options.includes(pending.action as Action)&&<option value={pending.action}>{actions[pending.action as Action]}</option>}</select></label>
  {action==='SENT'&&<label className="pr-status-confirm"><input type="checkbox" checked={confirmed||!!pending} disabled={busy||!!pending} onChange={e=>setConfirmed(e.target.checked)}/>Tôi đã kiểm tra lịch sử EarnApp: yêu cầu đã gửi tới đúng email PayPal của dòng này.</label>}
  <label>{reason?'Căn cứ / lý do (bắt buộc)':'Ghi chú (nếu có)'}<textarea className="pm-input" rows={2} maxLength={500} disabled={busy||!!pending} value={note} onChange={e=>setNote(e.target.value)}/></label>
  <p className="pm-muted">“Chờ về” chỉ ghi nhận đã gửi. Muốn ghi đã nhận tiền, dùng “Ghi tiền về PP” tại ô TIỀN TRONG VM và nhập số thực nhận.</p>
  {changed&&!pending&&<p role="alert" className="pm-error">Yêu cầu vừa thay đổi. Đóng rồi mở lại phần cập nhật để xem bản mới.</p>}
  {pending&&<p className="pm-muted">Lệnh đã lưu trong phiên. Thử lại giữ đúng yêu cầu và nội dung cũ, không tạo lượt rút mới.</p>}
  {error&&<p role="alert" className="pm-error">{error}</p>}
  <button type="button" className="pm-button pm-button-primary" disabled={disabled} onClick={()=>void save()}>{busy?'Đang lưu…':pending?'Thử lại đúng lệnh':'Lưu trạng thái'}</button>
 </div>;
}
