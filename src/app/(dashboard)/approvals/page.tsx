"use client";
import {useEffect,useState} from 'react';
import {trpc} from '@/lib/trpc';
import {useProjectStore} from '@/lib/store';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {countdown,summaryPairs} from '@/lib/approvals-ui';
import {ApprovalSessionBlock} from '@/components/approvals/ApprovalSessionBlock';
import {TotpCodeInput} from '@/components/approvals/TotpCodeInput';
const STATUS:Record<string,{t:string;c:string}>={PENDING:{t:'Đang chờ',c:'bg-amber-100 text-amber-800'},APPROVED:{t:'Đã duyệt, chờ AI gửi lại',c:'bg-blue-100 text-blue-800'},CONSUMED:{t:'Đã duyệt và đã chạy',c:'bg-green-100 text-green-800'},REJECTED:{t:'Đã từ chối',c:'bg-red-100 text-red-800'},EXPIRED:{t:'Hết hạn',c:'bg-gray-100 text-gray-700'}};
const when=(iso:string|null)=>iso?new Date(iso).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok',hour12:false}):'—';
// Phê duyệt lệnh AI (owner decision 23/10/2026): the AI's critical commands (withdrawal, full proxy, full SDK code) wait here. The ADMIN
// of the project reads the summary the server kept (allowed fields only, never credentials) and approves / rejects with their OWN Google
// Authenticator code (never the session's unlock, never a code the AI could hold). The AI then retries with the same Idempotency-Key.
type Row={id:string;action:string;label:string;status:string;summary:Record<string,unknown>;requestedAt:string;expiresAt:string;requestedBy:string|null;token:string|null;decidedBy:string|null;decidedAt:string|null;decisionNote:string|null;consumedAt:string|null};
function useNow(active:boolean){const [now,setNow]=useState(()=>Date.now());useEffect(()=>{if(!active)return;const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id);},[active]);return now;}
export default function ApprovalsPage(){
  const projectId=useProjectStore(s=>s.currentProjectId),role=useProjectStore(s=>s.currentRole);
  const [tab,setTab]=useState<'OPEN'|'DONE'>('OPEN');
  const [dialog,setDialog]=useState<{row:Row;approve:boolean}|null>(null);
  const utils=trpc.useUtils();
  const enabled=!!projectId&&role==='ADMIN';
  const open=trpc.opsApproval.list.useQuery({projectId:projectId||'',status:'OPEN'},{enabled,refetchInterval:15000,refetchIntervalInBackground:false,refetchOnWindowFocus:true});
  // "Đã xử lý": everything that is not waiting. The router lists one status per call, so four small reads are merged client-side.
  const approved=trpc.opsApproval.list.useQuery({projectId:projectId||'',status:'APPROVED'},{enabled:enabled&&tab==='DONE'});
  const consumed=trpc.opsApproval.list.useQuery({projectId:projectId||'',status:'CONSUMED'},{enabled:enabled&&tab==='DONE'});
  const rejected=trpc.opsApproval.list.useQuery({projectId:projectId||'',status:'REJECTED'},{enabled:enabled&&tab==='DONE'});
  const expired=trpc.opsApproval.list.useQuery({projectId:projectId||'',status:'EXPIRED'},{enabled:enabled&&tab==='DONE'});
  const now=useNow(tab==='OPEN'&&!!open.data?.length);
  const refresh=()=>{void utils.opsApproval.invalidate();};
  if(!projectId)return <p className="text-gray-500 p-8">Chọn dự án trước.</p>;
  if(role!=='ADMIN')return <p className="text-sm text-gray-600 p-8" role="alert">Chỉ ADMIN của dự án xem và duyệt lệnh AI.</p>;
  const doneRows:Row[]=([approved,consumed,rejected,expired].flatMap(q=>(q.data as Row[]|undefined)||[])).sort((a,b)=>(b.decidedAt||b.requestedAt).localeCompare(a.decidedAt||a.requestedAt));
  const doneLoading=tab==='DONE'&&[approved,consumed,rejected,expired].some(q=>q.isLoading);
  const rows:Row[]=tab==='OPEN'?((open.data as Row[]|undefined)||[]):doneRows;
  const error=tab==='OPEN'?open.error:[approved,consumed,rejected,expired].find(q=>q.error)?.error;
  return <div className="space-y-4" data-testid="approvals-page">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-gray-900">Phê duyệt lệnh AI</h1>
        <p className="text-sm text-gray-500">Lệnh quan trọng của AI (rút tiền, lấy proxy đầy đủ, xem mã SDK) chờ ADMIN duyệt bằng mã Google Authenticator. Yêu cầu hết hạn sau 15 phút; AI gửi lại cùng Idempotency-Key sau khi được duyệt.</p></div>
      <Button size="sm" variant="outline" onClick={refresh}>Tải lại</Button>
    </div>
    <ApprovalSessionBlock projectId={projectId} pending={((open.data as Row[]|undefined)||[]).filter(r=>r.status==='PENDING'&&new Date(r.expiresAt).getTime()>now).length}/>
    <div className="flex gap-1 border-b border-gray-200" role="tablist">
      {([['OPEN','Đang chờ'+(open.data?.length?' ('+open.data.length+')':'')],['DONE','Đã xử lý']] as const).map(([k,label])=>
        <button key={k} role="tab" aria-selected={tab===k} onClick={()=>setTab(k)} className={`px-3 py-2 text-sm border-b-2 -mb-px ${tab===k?'border-blue-600 text-blue-700 font-medium':'border-transparent text-gray-500 hover:text-gray-800'}`}>{label}</button>)}
    </div>
    {error&&<p role="alert" className="text-sm text-red-600">{error.message}</p>}
    {(tab==='OPEN'?open.isLoading:doneLoading)&&<p className="text-sm text-gray-400">Đang tải…</p>}
    {!error&&!(tab==='OPEN'?open.isLoading:doneLoading)&&!rows.length&&<p className="text-sm text-gray-500 rounded-lg border bg-white p-6 text-center">{tab==='OPEN'?'Không có lệnh nào đang chờ duyệt.':'Chưa có lệnh nào được xử lý.'}</p>}
    {!!rows.length&&<div className="rounded-lg border bg-white overflow-x-auto"><table className="w-full text-sm min-w-[760px]">
      <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 px-3">Lệnh</th><th className="px-3">Nội dung</th><th className="px-3">AI · token</th><th className="px-3">Thời gian</th><th className="px-3">{tab==='OPEN'?'Hết hạn':'Kết quả'}</th>{tab==='OPEN'&&<th className="px-3"/>}</tr></thead>
      <tbody>{rows.map(r=>{const st=STATUS[r.status]||{t:r.status,c:'bg-gray-100 text-gray-700'};const expiredNow=new Date(r.expiresAt).getTime()<=now;
        return <tr key={r.id} className="border-t align-top" data-testid={'approval-'+r.id}>
          <td className="py-2 px-3"><div className="font-medium text-gray-900">{r.label}</div><code className="text-[11px] text-gray-500">{r.action}</code></td>
          <td className="px-3"><dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-xs">{summaryPairs(r.summary).map(p=><div key={p.key} className="contents"><dt className="text-gray-500">{p.label}</dt><dd className="text-gray-900 break-all">{p.value}</dd></div>)}</dl></td>
          <td className="px-3 text-xs"><div>{r.requestedBy||'—'}</div><div className="text-gray-500">{r.token||'—'}</div></td>
          <td className="px-3 text-xs"><div>Gửi {when(r.requestedAt)}</div>{r.decidedAt&&<div className="text-gray-500">Xử lý {when(r.decidedAt)}{r.decidedBy?' · '+r.decidedBy:''}</div>}{r.consumedAt&&<div className="text-gray-500">AI chạy {when(r.consumedAt)}</div>}</td>
          <td className="px-3 text-xs">{tab==='OPEN'?<span className={expiredNow?'text-red-600':'text-gray-800'} aria-live="off">{countdown(r.expiresAt,now)}<div className="text-gray-500">{when(r.expiresAt)}</div></span>
            :<><Badge className={st.c+' text-xs'}>{st.t}</Badge>{r.decisionNote&&<div className="text-gray-600 mt-1">{r.decisionNote}</div>}{r.status==='APPROVED'&&<div className="text-gray-500 mt-1">Hạn {when(r.expiresAt)}</div>}</>}</td>
          {tab==='OPEN'&&<td className="px-3 py-2"><div className="flex gap-1.5 justify-end">
            <Button size="sm" disabled={expiredNow} onClick={()=>setDialog({row:r,approve:true})}>Duyệt</Button>
            <Button size="sm" variant="outline" disabled={expiredNow} onClick={()=>setDialog({row:r,approve:false})}>Từ chối</Button></div></td>}
        </tr>;})}</tbody></table></div>}
    {dialog&&<DecideDialog projectId={projectId} row={dialog.row} approve={dialog.approve} onClose={()=>setDialog(null)} onDone={()=>{setDialog(null);refresh();}}/>}
  </div>;
}
function DecideDialog({projectId,row,approve,onClose,onDone}:{projectId:string;row:Row;approve:boolean;onClose:()=>void;onDone:()=>void}){
  const decide=trpc.opsApproval.decide.useMutation();
  const [code,setCode]=useState(''),[note,setNote]=useState(''),[error,setError]=useState('');
  async function submit(){
    if(decide.isLoading||code.trim().length<6)return;setError('');
    try{await decide.mutateAsync({projectId,approvalId:row.id,approve,code:code.trim(),note:note.trim()||null});onDone();}
    catch(e){setError(e instanceof Error?e.message:'Không thực hiện được');setCode('');}
  }
  return <Dialog open onOpenChange={v=>{if(!v&&!decide.isLoading)onClose();}}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>{approve?'Duyệt lệnh AI':'Từ chối lệnh AI'}</DialogTitle>
        <DialogDescription>{row.label}{row.requestedBy?' · '+row.requestedBy:''}{row.token?' · '+row.token:''}</DialogDescription></DialogHeader>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm rounded-md border border-gray-200 bg-gray-50 p-3" aria-label="Nội dung lệnh">
        {summaryPairs(row.summary).map(p=><div key={p.key} className="contents"><dt className="text-gray-500">{p.label}</dt><dd className="text-gray-900 break-all">{p.value}</dd></div>)}
        {!summaryPairs(row.summary).length&&<div className="col-span-2 text-gray-500">Không có chi tiết thêm.</div>}
      </dl>
      {approve&&<p className="text-xs text-gray-600">Duyệt đúng nội dung trên: AI đổi nội dung thì duyệt này không dùng được. Lệnh chạy khi AI gửi lại trong hạn.</p>}
      {!approve&&<label className="block space-y-1 text-sm"><span className="text-xs text-gray-600">Lý do từ chối (tuỳ chọn, AI sẽ thấy)</span><Input value={note} maxLength={300} aria-label="Lý do từ chối" onChange={e=>setNote(e.target.value)}/></label>}
      <TotpCodeInput value={code} onChange={setCode} onSubmit={()=>void submit()}/>
      {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="outline" disabled={decide.isLoading} onClick={onClose}>Huỷ</Button>
        <Button className={approve?'':'bg-red-600 hover:bg-red-700'} disabled={code.trim().length<6||decide.isLoading} onClick={()=>void submit()}>{decide.isLoading?'Đang gửi…':approve?'Duyệt':'Từ chối'}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
