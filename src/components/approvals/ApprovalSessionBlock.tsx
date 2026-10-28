"use client";
import {useEffect,useState} from 'react';
import {trpc} from '@/lib/trpc';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {TotpCodeInput} from './TotpCodeInput';
// "Phiên duyệt" (owner 28/10/2026): a 15-minute approval session per AI token, opened with the ADMIN's own code (WITHDRAWAL_PREPARE of
// that token runs at once while it is open); "Khóa phiên ngay" ends it at once (no code: closing only takes rights away);
// "Duyệt tất cả đang chờ" approves every waiting command with one code. ADMIN only, like the page.
type Session={id:string;tokenId:string;token:string|null;approvedBy:string|null;via:string;openedAt:string;expiresAt:string};
type Token={id:string;name:string;prefix:string;user:string|null};
const hhmm=(iso:string)=>new Intl.DateTimeFormat('vi-VN',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));
const left=(iso:string,now:number)=>{const ms=new Date(iso).getTime()-now;return ms<=0?'đã hết hạn':'còn '+Math.max(1,Math.ceil(ms/60000))+' phút';};
const msg=(e:unknown)=>e instanceof Error?e.message:'Không thực hiện được';
function useNow(active:boolean){const [now,setNow]=useState(()=>Date.now());useEffect(()=>{if(!active)return;const id=setInterval(()=>setNow(Date.now()),15000);return()=>clearInterval(id);},[active]);return now;}
type Open={kind:'OPEN'}|{kind:'ALL'}|{kind:'CLOSE';session:Session|null};
export function ApprovalSessionBlock({projectId,pending}:{projectId:string;pending:number}){
  const q=trpc.opsApproval.sessions.useQuery({projectId},{refetchInterval:15000,refetchIntervalInBackground:false,refetchOnWindowFocus:true});
  const utils=trpc.useUtils();
  const [dialog,setDialog]=useState<Open|null>(null),[notice,setNotice]=useState('');
  const sessions=(q.data?.sessions as Session[]|undefined)??[],tokens=(q.data?.tokens as Token[]|undefined)??[];
  const now=useNow(sessions.length>0);
  const done=(text:string)=>{setDialog(null);setNotice(text);void utils.opsApproval.invalidate();};
  const show=(d:Open)=>{setNotice('');setDialog(d);};
  return <section className="rounded-lg border bg-white p-4 space-y-3" aria-labelledby="approval-session-title" data-testid="approval-sessions">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 id="approval-session-title" className="text-base font-semibold text-gray-900">Phiên duyệt</h2>
        <p className="text-xs text-gray-500">Trong phiên 15 phút, lệnh chuẩn bị rút của đúng token đó được duyệt ngay, không cần chờ từng lệnh.</p></div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={!tokens.length} onClick={()=>show({kind:'OPEN'})}>Mở phiên 15 phút</Button>
        <Button size="sm" variant="outline" disabled={pending<=0} onClick={()=>show({kind:'ALL'})}>{pending>0?'Duyệt tất cả đang chờ ('+pending+')':'Duyệt tất cả đang chờ'}</Button>
        {sessions.length>1&&<Button size="sm" variant="outline" className="text-red-700" onClick={()=>show({kind:'CLOSE',session:null})}>Khóa mọi phiên</Button>}
      </div>
    </div>
    {q.error&&<p role="alert" className="text-sm text-red-600">{q.error.message}</p>}
    {q.isLoading&&<p className="text-sm text-gray-400">Đang tải…</p>}
    {!q.isLoading&&!q.error&&!sessions.length&&<p className="text-sm text-gray-500">Không có phiên duyệt nào đang mở.</p>}
    {!!sessions.length&&<ul className="divide-y">{sessions.map(s=><li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm" data-testid={'session-'+s.id}>
      <div><div className="font-medium text-gray-900">{s.token||'Token cũ'}</div>
        <div className="text-xs text-gray-500">Mở bởi {s.approvedBy||'—'}{s.via==='CLI'?' (qua AI)':''} lúc {hhmm(s.openedAt)} · hết hạn lúc {hhmm(s.expiresAt)} · <span className="text-gray-800">{left(s.expiresAt,now)}</span></div></div>
      <Button size="sm" variant="outline" className="text-red-700" onClick={()=>show({kind:'CLOSE',session:s})}>Khóa phiên ngay</Button>
    </li>)}</ul>}
    {notice&&<p role="status" className="text-sm text-green-700">{notice}</p>}
    {dialog?.kind==='OPEN'&&<OpenDialog projectId={projectId} tokens={tokens} sessions={sessions} onClose={()=>setDialog(null)}
      onDone={r=>done('Đã mở phiên đến '+hhmm(r.expiresAt)+(r.approvedPending?'; duyệt luôn '+r.approvedPending+' lệnh đang chờ của token này.':'.'))}/>}
    {dialog?.kind==='ALL'&&<AllDialog projectId={projectId} pending={pending} onClose={()=>setDialog(null)} onDone={n=>done(n?'Đã duyệt '+n+' lệnh đang chờ.':'Không còn lệnh nào đang chờ.')}/>}
    {dialog?.kind==='CLOSE'&&<CloseDialog projectId={projectId} session={dialog.session} count={sessions.length} onClose={()=>setDialog(null)} onDone={n=>done(n?'Đã khoá '+n+' phiên.':'Phiên đã hết hạn hoặc đã khoá trước đó.')}/>}
  </section>;
}
function OpenDialog({projectId,tokens,sessions,onClose,onDone}:{projectId:string;tokens:Token[];sessions:Session[];onClose:()=>void;onDone:(r:{expiresAt:string;approvedPending:number})=>void}){
  const open=trpc.opsApproval.openSession.useMutation();
  const [tokenId,setTokenId]=useState(tokens.length===1?tokens[0].id:''),[code,setCode]=useState(''),[error,setError]=useState('');
  const ready=!!tokenId&&code.trim().length>=6&&!open.isLoading;
  async function submit(){if(!ready)return;setError('');try{onDone(await open.mutateAsync({projectId,tokenId,code:code.trim()}));}catch(e){setError(msg(e));setCode('');}}
  const replacing=sessions.some(s=>s.tokenId===tokenId);
  return <Dialog open onOpenChange={v=>{if(!v&&!open.isLoading)onClose();}}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>Mở phiên 15 phút</DialogTitle><DialogDescription>Trong 15 phút, lệnh chuẩn bị rút của token này chạy ngay; lệnh đang chờ của token cũng được duyệt luôn.</DialogDescription></DialogHeader>
    <label className="block space-y-1 text-sm"><span className="text-xs text-gray-600">Token AI</span>
      <select className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm" aria-label="Token AI" value={tokenId} onChange={e=>setTokenId(e.target.value)}>
        <option value="">Chọn token…</option>{tokens.map(t=><option key={t.id} value={t.id}>{t.name+' ('+t.prefix+')'+(t.user?' · '+t.user:'')}</option>)}</select></label>
    {replacing&&<p className="text-xs text-amber-700">Token này đang có phiên; mở phiên mới sẽ đóng phiên cũ và tính lại 15 phút từ bây giờ.</p>}
    <TotpCodeInput value={code} onChange={setCode} onSubmit={()=>void submit()} autoFocus={false}/>
    {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex gap-2 justify-end"><Button variant="outline" disabled={open.isLoading} onClick={onClose}>Huỷ</Button><Button disabled={!ready} onClick={()=>void submit()}>{open.isLoading?'Đang mở…':'Mở phiên'}</Button></div>
  </DialogContent></Dialog>;
}
function AllDialog({projectId,pending,onClose,onDone}:{projectId:string;pending:number;onClose:()=>void;onDone:(n:number)=>void}){
  const all=trpc.opsApproval.approveAll.useMutation();
  const [code,setCode]=useState(''),[error,setError]=useState('');
  const ready=code.trim().length>=6&&!all.isLoading;
  async function submit(){if(!ready)return;setError('');try{onDone((await all.mutateAsync({projectId,code:code.trim()})).approved);}catch(e){setError(msg(e));setCode('');}}
  return <Dialog open onOpenChange={v=>{if(!v&&!all.isLoading)onClose();}}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>Duyệt tất cả đang chờ</DialogTitle><DialogDescription>Duyệt {pending} lệnh đang chờ bằng một mã. AI gửi lại đúng lệnh trong hạn thì lệnh chạy.</DialogDescription></DialogHeader>
    <TotpCodeInput value={code} onChange={setCode} onSubmit={()=>void submit()}/>
    {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex gap-2 justify-end"><Button variant="outline" disabled={all.isLoading} onClick={onClose}>Huỷ</Button><Button disabled={!ready} onClick={()=>void submit()}>{all.isLoading?'Đang duyệt…':'Duyệt tất cả'}</Button></div>
  </DialogContent></Dialog>;
}
function CloseDialog({projectId,session,count,onClose,onDone}:{projectId:string;session:Session|null;count:number;onClose:()=>void;onDone:(n:number)=>void}){
  const close=trpc.opsApproval.closeSession.useMutation();
  const [error,setError]=useState('');
  async function submit(){if(close.isLoading)return;setError('');try{onDone((await close.mutateAsync(session?{projectId,sessionId:session.id}:{projectId})).closed);}catch(e){setError(msg(e));}}
  return <Dialog open onOpenChange={v=>{if(!v&&!close.isLoading)onClose();}}><DialogContent className="sm:max-w-md">
    <DialogHeader><DialogTitle>{session?'Khóa phiên ngay':'Khóa mọi phiên của dự án'}</DialogTitle>
      <DialogDescription>{session?'Khoá phiên duyệt của '+(session.token||'token cũ')+'.':'Khoá cả '+count+' phiên đang mở của dự án (mọi phiên, mọi token).'} Lệnh đã duyệt theo phiên mà AI chưa chạy sẽ hết hiệu lực; AI phải xin duyệt lại. Không cần mã 2FA.</DialogDescription></DialogHeader>
    {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex gap-2 justify-end"><Button variant="outline" disabled={close.isLoading} onClick={onClose}>Huỷ</Button><Button className="bg-red-600 hover:bg-red-700" disabled={close.isLoading} onClick={()=>void submit()}>{close.isLoading?'Đang khoá…':session?'Khóa phiên':'Khóa mọi phiên'}</Button></div>
  </DialogContent></Dialog>;
}
