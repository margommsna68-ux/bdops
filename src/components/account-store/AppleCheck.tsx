"use client";
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import toast from 'react-hot-toast';

type Overview=inferRouterOutputs<AppRouter>['appleCheck']['overview'];
type Job=Overview['jobs'][number];
type Intent={projectId:string;accountId:string;expectedRevision:number;key:string};
const RESULT:Record<string,string>={LOGIN_SUCCESS:'Đăng nhập Apple thành công',APPLE_LOCKED:'Apple Locked',CHALLENGE_REQUIRED:'Cần xác minh · đã dừng',INVALID_CREDENTIALS:'Sai thông tin đăng nhập',PROXY_ERROR:'Lỗi proxy',NETWORK_ERROR:'Lỗi mạng',TIMEOUT:'Hết thời gian',UNKNOWN:'Chưa rõ kết quả',CANCELLED:'Đã huỷ'};
const PHASE:Record<string,string>={QUEUED:'Đang chờ',WAITING_PROXY:'Chờ proxy phù hợp',WAITING_RESOURCES:'Chờ tài nguyên',LEASED:'Đang chuẩn bị',CLAIMED:'Đang chuẩn bị',ROUTE_READY:'Đã kiểm tra đường truyền',SUBMITTING:'Đang đăng nhập',RUNNING:'Đang kiểm tra',CLEANING:'Đang dọn trình duyệt',DONE:'Đã kết thúc',FINISHED:'Đã kết thúc',COMPLETED:'Đã kết thúc',CANCELLED:'Đã huỷ',UNKNOWN:'Chưa rõ kết quả'};
const WORKER_STATE:Record<string,string>={OFFLINE:'Worker ngoại tuyến · yêu cầu chờ máy',IDLE:'Sẵn sàng',BUSY:'Đang kiểm tra',WAITING_DESKTOP:'Worker chờ desktop · yêu cầu chờ máy',WAITING_RESOURCES:'Worker chờ tài nguyên',CLEANUP_FAILED:'Worker cần xử lý lỗi dọn trình duyệt'};
function jobStatus(job:Job,worker:Overview['worker']){
  if(job.result)return RESULT[job.result]??'Chưa rõ kết quả';
  if(job.phase==='QUEUED'){
    if(!worker?.online||worker.state==='WAITING_DESKTOP')return 'Đang chờ máy';
    if(worker.state==='WAITING_RESOURCES')return 'Đang chờ tài nguyên';
  }
  return PHASE[job.phase]??'Đang xử lý';
}
// A reported outcome does not release a job whose browser cleanup is still unresolved.
const active=(job:Job)=>job.cleanup==='FAILED'||job.result==='UNKNOWN'&&job.cleanup!=='OK'||job.result===null&&!['DONE','FINISHED','COMPLETED','CANCELLED','UNKNOWN'].includes(job.phase);
const when=(value:string)=>new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok',hour12:false});
function refused(error:unknown){
  if(!error||typeof error!=='object'||!('data' in error)||!error.data||typeof error.data!=='object'||!('code' in error.data))return false;
  return ['BAD_REQUEST','CONFLICT','FORBIDDEN','NOT_FOUND','UNAUTHORIZED','PRECONDITION_FAILED','TOO_MANY_REQUESTS'].includes(String(error.data.code));
}
type Shared={projectId:string;data:Overview|undefined;error:boolean;jobs:Job[];pending:Set<string>;errors:Record<string,string>;retry:Set<string>;request:(id:string,revision:number)=>Promise<void>;cancel:(job:Job)=>Promise<void>};
const Context=createContext<Shared|null>(null);
function useChecks(){const value=useContext(Context);if(!value)throw Error('AppleCheck requires AppleCheckProvider');return value;}

// The stock table owns exactly one query. Rows receive public metadata only.
export function AppleCheckProvider({projectId,children}:{projectId:string;children:ReactNode}){
  return <ProjectAppleCheckProvider key={projectId} projectId={projectId}>{children}</ProjectAppleCheckProvider>;
}
function ProjectAppleCheckProvider({projectId,children}:{projectId:string;children:ReactNode}){
  const overview=trpc.appleCheck.overview.useQuery({projectId},{refetchInterval:5000,refetchIntervalInBackground:false});
  const requestJob=trpc.appleCheck.request.useMutation({retry:false}),cancelJob=trpc.appleCheck.cancel.useMutation({retry:false}),utils=trpc.useUtils();
  const [accepted,setAccepted]=useState<Job[]>([]),[pending,setPending]=useState<Set<string>>(new Set()),[errors,setErrors]=useState<Record<string,string>>({});
  const running=useRef(new Set<string>()),intents=useRef(new Map<string,Intent>()),live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const jobs=[...(overview.data?.jobs??[])];for(const job of accepted){
    const index=jobs.findIndex(j=>j.id===job.id),remote=jobs[index];
    if(!remote)jobs.push(job);
    else if(remote.result===null&&job.result!==null)jobs[index]=job;
    else if(active(remote)&&job.cancelRequested)jobs[index]={...remote,cancelRequested:true};
  }
  const terminal=jobs.filter(j=>!active(j)).map(j=>`${j.id}:${j.result}:${j.stale}`).sort().join('|'),lastTerminal=useRef('');
  useEffect(()=>{if(lastTerminal.current!==terminal){lastTerminal.current=terminal;void utils.accountStore.invalidate();}},[terminal,utils]);
  function start(id:string){if(running.current.has(id))return false;running.current.add(id);setPending(new Set(running.current));setErrors(e=>({...e,[id]:''}));return true;}
  function finish(id:string){running.current.delete(id);if(live.current)setPending(new Set(running.current));}
  async function request(id:string,revision:number){
    if(!overview.data?.canCheck||overview.error||!start(id))return;
    const input=intents.current.get(id)??{projectId,accountId:id,expectedRevision:revision,key:crypto.randomUUID()};intents.current.set(id,input);
    try{const job=await requestJob.mutateAsync(input);if(!live.current)return;intents.current.delete(id);setAccepted(old=>[...old.filter(j=>j.id!==job.id),job]);void utils.appleCheck.overview.invalidate({projectId});}
    catch(error){
      if(refused(error)){
        intents.current.delete(id);void utils.accountStore.invalidate();void utils.appleCheck.overview.invalidate({projectId});
        if(live.current)setErrors(e=>({...e,[id]:'Yêu cầu bị từ chối. Kiểm tra phiên bản tài khoản, quyền và thời gian chờ 15 phút trước khi thử lại.'}));
      }else if(live.current)setErrors(e=>({...e,[id]:'Chưa rõ yêu cầu đã được nhận. Gửi lại dùng cùng mã yêu cầu; không tự đăng nhập lại.'}));
    }
    finally{finish(id);}
  }
  async function cancel(job:Job){
    if(!overview.data?.canCheck||overview.error||!start(job.accountId))return;
    try{const result=await cancelJob.mutateAsync({projectId,jobId:job.id});if(live.current)setAccepted(old=>[...old.filter(j=>j.id!==job.id),result]);void utils.appleCheck.overview.invalidate({projectId});}
    catch{if(live.current)setErrors(e=>({...e,[job.accountId]:'Chưa xác nhận huỷ. Có thể gửi lại yêu cầu huỷ.'}));}finally{finish(job.accountId);}
  }
  return <Context.Provider value={{projectId,data:overview.data,error:!!overview.error,jobs,pending,errors,retry:new Set(intents.current.keys()),request,cancel}}>{children}</Context.Provider>;
}

export function AppleCheck({accountId,revision,disabled=false}:{accountId:string;revision:number;disabled?:boolean}){
  const checks=useChecks(),[expanded,setExpanded]=useState(false);
  const jobs=checks.jobs.filter(j=>j.accountId===accountId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),current=jobs.find(active),latest=current??jobs[0],worker=checks.data?.worker;
  const unavailable=!worker?.enabled||worker.state==='CLEANUP_FAILED';
  const notice=!worker?.enabled?'Worker chưa bật':worker.state==='CLEANUP_FAILED'?WORKER_STATE.CLEANUP_FAILED:!worker.online?WORKER_STATE.OFFLINE:['WAITING_DESKTOP','WAITING_RESOURCES'].includes(worker.state)?WORKER_STATE[worker.state]:null;
  const busy=checks.pending.has(accountId),retry=checks.retry.has(accountId);
  if(!checks.data)return <span className="pm-muted text-xs">{checks.error?'Không tải được Check Apple ID':'Đang tải Check Apple ID…'}</span>;
  return <div className="mt-2 max-w-sm whitespace-normal space-y-1 text-xs" aria-label="Check Apple ID">
    {checks.data.canCheck&&!disabled&&<button type="button" className="pm-button pm-button-quiet" disabled={busy||!!current||!!unavailable||checks.error} onClick={()=>void checks.request(accountId,revision)}>{busy?'Đang gửi…':retry?'Gửi lại yêu cầu':'Check Apple ID'}</button>}
    {notice&&checks.data.canCheck&&<p className="pm-muted">{notice}</p>}
    {checks.error&&<p role="alert" className="pm-error">Không tải được trạng thái check mới nhất.</p>}
    {!latest&&<p className="pm-muted">Chưa kiểm tra</p>}
    {latest&&<div role="status"><span>{latest.cancelRequested&&active(latest)?'Đang chờ huỷ':jobStatus(latest,worker??null)}</span>{' · '}<time className="pm-muted" dateTime={latest.observedAt??latest.createdAt}>{when(latest.observedAt??latest.createdAt)}</time>{latest.stale&&<span className="pm-muted"> · Cần kiểm tra lại · kết quả phiên bản cũ</span>}</div>}
    {checks.errors[accountId]&&<p role="alert" className="pm-error">{checks.errors[accountId]}</p>}
    {!!jobs.length&&<button type="button" className="pm-link" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'Ẩn lịch sử check':`Lịch sử check (${jobs.length})`}</button>}
    {expanded&&<ol className="space-y-2 border-l pl-2">{jobs.map(job=><li key={job.id} className="break-words space-y-1">
      <div>{jobStatus(job,worker??null)}{job.stale?' · Phiên bản cũ (chỉ lịch sử)':''}</div>
      <time className="pm-muted" dateTime={job.observedAt??job.createdAt}>{when(job.observedAt??job.createdAt)}</time>
      <div className="pm-muted">Tiến trình: {PHASE[job.phase]??'Đang xử lý'} · Dọn trình duyệt: {job.cleanup==='OK'?'Hoàn tất':job.cleanup==='FAILED'?'Thất bại · worker tạm ngừng':'Chưa xác nhận'}</div>
      {job.reasonCode&&<div className="pm-muted">Mã kết quả: {job.reasonCode}</div>}
      {active(job)&&checks.data?.canCheck&&<button type="button" className="pm-link" disabled={busy||job.cancelRequested||checks.error} onClick={()=>void checks.cancel(job)}>{job.cancelRequested?'Đang chờ huỷ':'Huỷ check'}</button>}
    </li>)}</ol>}
  </div>;
}

export function AppleCheckConfiguration(){
  const {projectId,data,error}=useChecks();
  return data?.canManage?<WorkerConfiguration key={projectId} projectId={projectId} data={data} unavailable={error}/>:null;
}
function WorkerConfiguration({projectId,data,unavailable}:{projectId:string;data:Overview;unavailable:boolean}){
  const utils=trpc.useUtils(),security=trpc.user.securityStatus.useQuery(undefined,{refetchOnWindowFocus:true});
  const configure=trpc.appleCheck.configure.useMutation({retry:false,cacheTime:0}),disable=trpc.appleCheck.disable.useMutation({retry:false});
  const [name,setName]=useState(data.worker?.name??''),[group,setGroup]=useState(data.worker?.proxyGroupId??''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [held,setHeld]=useState<{token:string;generation:number}|null>(null),running=useRef(false);
  const allowed=!!security.data?.unlocked&&!security.error&&!unavailable&&data.canManage;
  const generation=useRef({allowed,value:0});if(generation.current.allowed!==allowed)generation.current={allowed,value:generation.current.value+1};
  const mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current.value++;};},[]);
  useEffect(()=>{if(!allowed){setHeld(null);configure.reset();}},[allowed]);// eslint-disable-line react-hooks/exhaustive-deps
  const token=allowed&&held?.generation===generation.current.value?held.token:null;
  async function save(){
    if(running.current||!allowed||token||!name.trim()||!data.groups.some(g=>g.id===group))return;
    running.current=true;setBusy(true);setMessage('');const started=generation.current.value;
    try{const result=await configure.mutateAsync({projectId,name:name.trim(),proxyGroupId:group});if(mounted.current&&generation.current.value===started)setHeld({token:result.token,generation:started});void utils.appleCheck.overview.invalidate({projectId});}
    catch{if(mounted.current)setMessage('Chưa xác nhận cấu hình. Kiểm tra worker trước khi tạo token mới.');}
    finally{configure.reset();running.current=false;if(mounted.current)setBusy(false);}
  }
  async function stop(){
    if(running.current||!allowed)return;running.current=true;setBusy(true);setMessage('');setHeld(null);
    try{await disable.mutateAsync({projectId});void utils.appleCheck.overview.invalidate({projectId});}catch{if(mounted.current)setMessage('Chưa xác nhận tắt worker.');}finally{running.current=false;if(mounted.current)setBusy(false);}
  }
  return <details className="pm-surface p-3 text-sm space-y-3" onToggle={e=>{if(!e.currentTarget.open){setHeld(null);generation.current.value++;configure.reset();}}}>
    <summary className="cursor-pointer font-medium">Cấu hình Check Apple ID</summary>
    <p className="pm-muted text-xs">Chỉ dùng proxy NEW chưa gán trong nhóm được chọn để kiểm tra; không dùng proxy đang gán cho VM. Có thể chọn TUT hoặc nhóm có sẵn. Đổi cấu hình sẽ thay token cũ.</p>
    {data.worker&&<p className="text-xs">{data.worker.name} · {data.worker.enabled?'Đã bật':'Đã tắt'} · {data.worker.online?'Trực tuyến':'Ngoại tuyến'} · {WORKER_STATE[data.worker.state]??'Đang cập nhật trạng thái'}{data.worker.lastSeenAt&&<> · <time dateTime={data.worker.lastSeenAt}>{when(data.worker.lastSeenAt)}</time></>}</p>}
    {!allowed&&<p className="pm-muted text-xs">Mở khoá phiên bằng 2FA / PIN để quản lý kết nối.</p>}
    <div className="flex flex-wrap gap-3"><label className="pm-label flex-1 min-w-0">Tên worker<input className="pm-input w-full" value={name} maxLength={80} disabled={busy||!!token} onChange={e=>setName(e.target.value)}/></label>
      <label className="pm-label flex-1 min-w-0">Nhóm proxy cho phép kiểm tra<select className="pm-input w-full" value={group} disabled={busy||!!token} onChange={e=>setGroup(e.target.value)}><option value="">Chọn nhóm proxy</option>{data.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label></div>
    {!data.groups.length&&<p className="pm-muted text-xs">Chưa có nhóm proxy phù hợp.</p>}
    {token?<div role="status" className="pm-surface p-3 space-y-2"><p>Token chỉ hiện một lần. Lưu vào kho bí mật của worker.</p><code className="block break-all select-all">{token}</code><div className="flex flex-wrap gap-2"><button type="button" className="pm-button pm-button-quiet" onClick={()=>{void navigator.clipboard.writeText(token).then(()=>toast.success('Đã copy token'),()=>toast.error('Trình duyệt chưa cho phép copy'));}}>Copy token</button><button type="button" className="pm-button pm-button-quiet" onClick={()=>{setHeld(null);configure.reset();}}>Đã lưu · Ẩn token</button></div></div>:<button type="button" className="pm-button pm-button-primary" disabled={busy||!allowed||!name.trim()||!data.groups.some(g=>g.id===group)} onClick={()=>void save()}>{busy?'Đang lưu…':'Lưu cấu hình / tạo token'}</button>}
    {data.worker?.enabled&&<button type="button" className="pm-button pm-button-quiet ml-2" disabled={busy||!allowed} onClick={()=>void stop()}>Tắt worker</button>}
    {message&&<p role="alert" className="pm-error text-xs">{message}</p>}
  </details>;
}
