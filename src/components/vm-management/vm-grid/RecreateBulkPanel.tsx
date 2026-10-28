"use client";
import {useEffect,useRef,useState} from 'react';
import {trpc} from '@/lib/trpc';
import {FleetCreate,type CreateInput} from '@/server/fleet-commands/schema';
import type {ManagedVM} from '../shared';
import type {OpsRow} from './OpsCells';
import {bulkPlan,runSequential,runJournaled,readJournal,serverCounts,MANUAL_RECREATE,FLEET_RECORDS,type BulkRow} from './payout-bulk-model';
// "Chờ tạo lại" (owner 28/10/2026): "Tạo lại N VM" for many VMs on many servers, always behind ONE confirmation listing the VMs per
// server. VMs of servers under fleet control get one RECREATE_VM command each (the same fleet command service as the VM panel; the
// server checks MANAGE, UUID / round / revision and recreateRule); the others are listed to recreate by hand, then "Ghi nhận đã tạo
// lại N VM" records each one (vmOps.recreate, one command per VM). Each row keeps its command in this tab; a lost answer is retried
// with the same body, never a second command.
type Row=BulkRow&{label:string};
type Kind='RECREATE'|'RECORD_RECREATED';
/** foreign = the VM panel's key holds ANOTHER fleet action: never resent or dropped here, only reconciled in the VM panel. */
type Status={state:''|'done'|'unknown'|'stuck';error:string;foreign?:boolean};
const FOREIGN='VM còn lệnh điều khiển khác chưa rõ kết quả.';
const message=(e:unknown)=>e instanceof Error?e.message:'Không nhận được phản hồi hợp lệ';
const store=()=>{try{return window.sessionStorage;}catch{return null;}};
// Same key as FleetCommandPanel: the VM panel shows (and retries) a bulk command that is still uncertain.
export const fleetJournalKey=(userId:string,projectId:string,serverId:string,vmId:string)=>'mth-fleet:'+userId+':'+projectId+':'+serverId+':'+vmId;
export const recordJournalKey=(projectId:string,userId:string,vmId:string,cycle:number)=>'mth-recreate-bulk:'+JSON.stringify([projectId,userId,vmId,cycle]);
export function RecreateBulkPanel({projectId,userId,vms,opsOf,rights,onSaved,onBusy}:{projectId:string;userId?:string;vms:ManagedVM[];opsOf:(id:string)=>OpsRow|undefined;rights:{manage:boolean;assign:boolean};onSaved:()=>Promise<unknown>|void;onBusy?:(busy:boolean)=>void}){
  const servers=trpc.fleetCommands.servers.useQuery({projectId},{retry:false,staleTime:60000});
  if(!userId)return <p className="pm-muted text-xs">Đang tải phiên đăng nhập…</p>;
  if(servers.isLoading)return <p className="pm-muted text-xs">Đang kiểm tra server có điều khiển…</p>;
  const enrolled=new Set(servers.data?.serverIds??[]);
  const rows:Row[]=vms.map(vm=>({vmId:vm.id,serverId:vm.serverId,server:vm.server,code:vm.code,label:vm.server+' / '+vm.code,fleetEnrolled:enrolled.has(vm.serverId),ops:opsOf(vm.id)}));
  return <div className="space-y-4">
    {servers.error&&<p className="pm-error text-xs" role="alert">Không đọc được danh sách server có điều khiển ({servers.error.message}); mọi VM coi như tạo tay.</p>}
    {rights.manage&&<Section key={'R:'+userId} kind="RECREATE" projectId={projectId} userId={userId} rows={rows} onSaved={onSaved} onBusy={onBusy}/>}
    {rights.assign&&<Section key={'G:'+userId} kind="RECORD_RECREATED" projectId={projectId} userId={userId} rows={rows} onSaved={onSaved} onBusy={onBusy}/>}
    {!rights.manage&&!rights.assign&&<p className="pm-muted text-xs">Cần quyền quản lý / gán VM để tạo lại.</p>}
  </div>;
}
function Section({kind,projectId,userId,rows,onSaved,onBusy}:{kind:Kind;projectId:string;userId:string;rows:Row[];onSaved:()=>Promise<unknown>|void;onBusy?:(busy:boolean)=>void}){
  const utils=trpc.useContext(),create=trpc.fleetCommands.create.useMutation(),record=trpc.vmOps.recreate.useMutation();
  // The plan is taken when the panel opens; a background reload never adds or retargets a row.
  // "Ghi nhận" never takes a VM with a fleet command kept in this tab (sent / queued from here or from the VM panel): the worker
  // records it when AE has recreated it; a manual record first would make the worker's callback fail.
  const [plan]=useState(()=>{const p=bulkPlan(rows,kind);if(kind==='RECREATE')return p;
    const queued=p.ready.filter(r=>!!readJournal(store(),fleetJournalKey(userId,projectId,r.serverId,r.vmId)));
    return {ready:p.ready.filter(r=>!queued.includes(r)),skipped:[...p.skipped,...queued.map(row=>({row,why:'VM có lệnh tạo lại qua điều khiển đang chờ: web tự ghi nhận khi xong'}))]};});
  const keyOf=(r:Row)=>kind==='RECREATE'?fleetJournalKey(userId,projectId,r.serverId,r.vmId):recordJournalKey(projectId,userId,r.vmId,r.ops!.cycle);
  const [status,setStatus]=useState<Record<string,Status>>(()=>Object.fromEntries(plan.ready.map(r=>{const c=readJournal<{action?:string}>(store(),keyOf(r));
    const foreign=kind==='RECREATE'&&c?.action!=='RECREATE_VM';
    return [r.vmId,c?foreign?{state:'stuck',error:FOREIGN,foreign:true}:{state:'unknown',error:'Lệnh trước chưa rõ kết quả; thử lại đúng lệnh cũ.'}:{state:'',error:''}];})));
  const [confirming,setConfirming]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const lock=useRef(false),mounted=useRef(true);useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const set=(id:string,s:Status)=>setStatus(old=>({...old,[id]:s}));
  const ready=plan.ready.filter(r=>!status[r.vmId]?.state),pending=plan.ready.filter(r=>!status[r.vmId]?.foreign&&(status[r.vmId]?.state==='unknown'||status[r.vmId]?.state==='stuck'));
  const manual=kind==='RECREATE'?plan.skipped.filter(s=>s.why===MANUAL_RECREATE):[],byFleet=kind==='RECORD_RECREATED'?plan.skipped.filter(s=>s.why===FLEET_RECORDS):[];
  const other=plan.skipped.filter(s=>!manual.includes(s)&&!byFleet.includes(s));
  /** RECREATE_VM body from the VM's current fleet binding (UUID máy, round, revision, configuration), or why it cannot be sent. */
  async function fleetBody(r:Row):Promise<CreateInput|string>{
    const c=await utils.fleetCommands.control.fetch({projectId,serverId:r.serverId,vmId:r.vmId});
    const cap=c.capability;
    if(!cap||cap.binding.vmId!==r.vmId||cap.binding.serverId!==r.serverId)return 'Máy chưa sẵn sàng điều khiển (UUID máy / quyền / việc đang chạy); mở khung VM để xem.';
    if(!cap.actions.includes('RECREATE_VM'))return 'Chưa đủ điều kiện tạo lại qua điều khiển; mở khung VM để xem.';
    if(cap.binding.expectedCycle!==r.ops!.cycle)return 'VM đã đổi lượt; đóng và mở lại khung.';
    return FleetCreate.parse({...cap.binding,action:'RECREATE_VM',operationId:crypto.randomUUID(),ttlSeconds:300});
  }
  async function run(retry:boolean){
    if(lock.current)return;lock.current=true;setBusy(true);onBusy?.(true);setNotice('');setConfirming(false);let saved=0;
    try{
      const targets=retry?pending:ready;
      await runSequential(targets,async r=>{
        const key=keyOf(r),stored=readJournal<Record<string,unknown>>(store(),key);
        if(kind==='RECREATE'&&stored&&stored.action!=='RECREATE_VM'){set(r.vmId,{state:'stuck',error:FOREIGN,foreign:true});return;}
        if(kind==='RECORD_RECREATED'&&readJournal(store(),fleetJournalKey(userId,projectId,r.serverId,r.vmId))){set(r.vmId,{state:'',error:'VM có lệnh tạo lại qua điều khiển đang chờ; không ghi nhận tay.'});return;}
        let body:Record<string,unknown>;
        if(stored)body=stored;
        else if(kind==='RECREATE'){let b:CreateInput|string;try{b=await fleetBody(r);}catch(e){set(r.vmId,{state:'',error:message(e)});return;}if(typeof b==='string'){set(r.vmId,{state:'',error:b});return;}body=b;}
        else body={projectId,key:crypto.randomUUID(),vmId:r.vmId,expectedCycle:r.ops!.cycle,note:null};
        const out=await runJournaled(store(),key,body,!!stored,()=>kind==='RECREATE'?create.mutateAsync(body as never):record.mutateAsync(body as never));
        if(out.outcome==='DONE'){saved++;set(r.vmId,{state:'done',error:''});}
        else if(out.outcome==='NOSTORE')set(r.vmId,{state:'',error:'Không lưu được mã chống lặp trong tab; chưa gửi lệnh.'});
        else if(out.outcome==='REFUSED')set(r.vmId,{state:'',error:message(out.error)});
        else if(out.outcome==='STUCK')set(r.vmId,{state:'stuck',error:'Thử lại bị từ chối: '+message(out.error)+'. Đối soát (khung VM / máy thật) trước khi bỏ lệnh cũ.'});
        else set(r.vmId,{state:'unknown',error:'Chưa xác định kết quả. Thử lại đúng lệnh cũ: '+message(out.error)});
      },()=>!mounted.current);
      if(!mounted.current)return;
      setNotice((kind==='RECREATE'?'Đã gửi lệnh tạo lại cho ':'Đã ghi nhận tạo lại ')+saved+' VM. Dòng lỗi giữ nguyên lý do bên dưới.');
      if(saved)try{await onSaved();}catch{setNotice('Đã lưu '+saved+' VM; chưa tải lại được bảng. Không bấm lại.');}
    }finally{lock.current=false;if(mounted.current)setBusy(false);onBusy?.(false);}
  }
  function drop(r:Row){
    if(!window.confirm('Bỏ lệnh chưa rõ kết quả của '+r.label+'? Chỉ bỏ khi đã đối soát: lệnh cũ sẽ không được gửi lại.'))return;
    try{store()?.removeItem(keyOf(r));}catch{/* nothing stored */}set(r.vmId,{state:'',error:''});
  }
  const title=kind==='RECREATE'?`Tạo lại ${ready.length} VM`:`Ghi nhận đã tạo lại ${ready.length} VM`;
  const counts=serverCounts(ready);
  return <section className="space-y-2 text-xs" aria-label={kind==='RECREATE'?'Tạo lại VM':'Ghi nhận đã tạo lại VM'}>
    <p className="font-semibold text-sm">{kind==='RECREATE'?'Tạo lại qua điều khiển':'Ghi nhận đã tạo lại'}</p>
    <p className="pm-muted">{kind==='RECREATE'?'VM thuộc server đã nối điều khiển: mỗi VM một lệnh “Tạo lại VM (AE)”; AE xoá máy cũ, tạo máy mới, web mở lượt mới và lấy SDK mới.':'VM đã tạo lại trên máy thật: web mở lượt mới (Chưa cài), giữ proxy tốt, đóng EarnApp cũ. Không hoàn tác được.'}</p>
    {plan.ready.length>0&&<ul className="space-y-1">{plan.ready.map(r=>{const s=status[r.vmId]??{state:'',error:''};return <li key={r.vmId} aria-label={r.label}><strong>{r.label}</strong>
      {s.state==='done'&&<span className="text-emerald-600"> — {kind==='RECREATE'?'Đã gửi lệnh tạo lại':'Đã ghi nhận tạo lại'}</span>}
      {s.error&&<span className="pm-error" role="alert"> — {s.error}</span>}
      {s.state==='stuck'&&(s.foreign?<span className="pm-muted"> Đối chiếu trong khung VM</span>:<button type="button" className="pm-button pm-button-sm ml-2" disabled={busy} onClick={()=>drop(r)}>Bỏ lệnh chưa rõ (đã đối chiếu)</button>)}</li>;})}</ul>}
    {manual.length>0&&<div><p className="font-semibold">Tạo tay {manual.length} VM</p><ul>{manual.map(s=><li key={s.row.vmId}><strong>{s.row.label}</strong> — Tạo lại trên máy rồi bấm Ghi nhận đã tạo lại</li>)}</ul></div>}
    {byFleet.length>0&&<p className="pm-muted">{byFleet.length} VM thuộc server có điều khiển: web tự ghi nhận khi lệnh “Tạo lại VM (AE)” xong, không ghi nhận tay ở đây.</p>}
    {other.length>0&&<div><p className="font-semibold">Bỏ qua {other.length} VM</p><ul>{other.map(s=><li key={s.row.vmId}><strong>{s.row.label}</strong> — {s.why}</li>)}</ul></div>}
    {notice&&<p role="status">{notice}</p>}
    {confirming?<div role="alertdialog" aria-label={'Xác nhận '+title} className="vm-status-error space-y-2">
      <p><strong>{title}?</strong> {kind==='RECREATE'?'Máy cũ trên các server dưới đây sẽ bị xoá và tạo lại.':'Ghi nhận không hoàn tác được.'}</p>
      <ul>{counts.map(c=><li key={c.server}>{c.server}: {c.count} VM</li>)}</ul>
      <div className="flex gap-2"><button type="button" className="pm-button pm-button-sm" disabled={busy} onClick={()=>setConfirming(false)}>Quay lại</button>
        <button type="button" className="pm-button pm-button-primary pm-button-sm" disabled={busy} onClick={()=>void run(false)}>Xác nhận {title.charAt(0).toLowerCase()+title.slice(1)}</button></div></div>
    :<div className="flex gap-2 flex-wrap">
      {pending.length>0&&<button type="button" className="pm-button" disabled={busy} onClick={()=>{if(kind==='RECREATE'&&!window.confirm('Gửi lại đúng lệnh tạo lại cũ cho '+pending.length+' VM? Lệnh cũ có thể đã chạy; máy chủ chỉ ghi một lần cho mỗi mã lệnh.'))return;void run(true);}}>Thử lại lệnh chưa rõ</button>}
      <button type="button" className="pm-button pm-button-primary" disabled={busy||!ready.length} onClick={()=>setConfirming(true)}>{busy?'Đang gửi…':title}</button></div>}
  </section>;
}
