"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Copy,Loader2,Search} from 'lucide-react';
import toast from 'react-hot-toast';
import {trpc} from '@/lib/trpc';
import {useBusinessKey} from '@/components/business-management/shared';
import {errorMessage,useVMRefresh,type ManagedVM} from '../shared';
import {proxyAddress,vmView} from '../workflow';
import {currentOf} from '@/server/vm-management/state';
import {useAnchored} from './SdkCell';
// Proxy cell (owner decision 19/10/2026, REPLACES the install progress and the install actions): the proxy the VM uses, a copy button
// and only the warnings that matter (Blocked, Cần kiểm tra). Clicking the content opens "Thay proxy" next to the cell: the current
// proxy, a proxy of the stock (search / paste, checked while choosing) or the proxy the provider sent as replacement, one Áp dụng.
// The button is muted while nothing would change and blue for a valid change; the current proxy again is no change.
export interface ProxyRights {assign:boolean;copy:boolean;replace:boolean}
export type ProxyTone='none'|'ok'|'blocked'|'review';
export function proxyCellInfo(v:ManagedVM){
  const view=vmView(v),cur=currentOf(v),config=[v.desired,v.installed].find(c=>c&&c.endpointId===cur.endpointId)||null;
  const hold=cur.endpointId?v.holds.find(h=>h.endpointId===cur.endpointId):undefined;
  type Candidate={endpointId:string;ip:string|null;port:number|null;label:string};const seen=new Map<string,Candidate>();
  for(const c of [v.desired,v.installed])if(c?.endpointId&&!seen.has(c.endpointId))seen.set(c.endpointId,{endpointId:c.endpointId,ip:c.ip,port:c.port,label:c===v.desired?'Đã giao':'Đã cài trước đây'});
  for(const h of v.holds)if(h.role==='UNCERTAIN'&&!seen.has(h.endpointId))seen.set(h.endpointId,{endpointId:h.endpointId,ip:h.ip,port:h.port,label:'Giữ để kiểm tra'});
  const candidates=Array.from(seen.values());
  const tone:ProxyTone=view==='BLOCKED'?'blocked':view==='REVIEW'?'review':config?'ok':'none';
  const warning=view==='BLOCKED'?'Blocked':view==='REVIEW'?'Cần kiểm tra':null;
  const reason=view==='REVIEW'?(cur.review?'Có nhiều proxy cũ trên VM ('+candidates.map(c=>proxyAddress(c)).join(', ')+'); chọn proxy đang dùng':hold&&hold.owner!=='SELF'&&!hold.shared?'Proxy Genjy / chưa rõ sở hữu':hold?'Proxy đang '+hold.state+'; thay proxy':'Ô cũ chưa đọc được; chọn proxy'):view==='BLOCKED'?'Proxy BLOCKED: thay bằng proxy dự phòng hoặc nhận replace từ nhà cung cấp':null;
  return {view,tone,current:config?{endpointId:config.endpointId,ip:config.ip,port:config.port,state:hold?.state??null}:null,warning,reason,candidates};
}
const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
type Check={outcome:'READY'|'SKIP'|'ERROR';message:string;endpointId:string|null;label:string|null};
export function ProxyCell({projectId,vm,rights,onCopy,onBusy}:{projectId:string;vm:ManagedVM;rights:ProxyRights;onCopy:(vm:ManagedVM)=>void;onBusy:(vmId:string,busy:boolean)=>void}){
  const info=proxyCellInfo(vm),[open,setOpen]=useState(false),anchor=useRef<HTMLDivElement>(null),pop=useRef<HTMLDivElement>(null),pos=useAnchored(open,anchor,pop,380);
  const busy=useRef(false),close=(refocus=true)=>{if(busy.current)return;setOpen(false);if(refocus)anchor.current?.focus({preventScroll:true});};const closeRef=useRef(close);closeRef.current=close;
  useEffect(()=>{if(!open)return;const down=(e:MouseEvent)=>{if(!pop.current?.contains(e.target as Node)&&!anchor.current?.contains(e.target as Node))closeRef.current(false);};const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing){e.stopPropagation();closeRef.current();}};
    document.addEventListener('mousedown',down);document.addEventListener('keydown',key,true);return ()=>{document.removeEventListener('mousedown',down);document.removeEventListener('keydown',key,true);};},[open]);
  if(vm.archivedAt)return <span className="pm-badge pm-badge-muted">Đã xoá</span>;
  const shown=info.current||(info.candidates.length===1?info.candidates[0]:null);
  return <div className="vm-status">
    <div ref={anchor} role="button" tabIndex={0} className="vm-proxy-trigger vm-cell-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label={`Proxy ${vm.code}: ${shown?proxyAddress(shown):'chưa có'}${info.warning?' · '+info.warning:''}. Bấm để ${rights.assign?'thay proxy':'xem'}`} title={info.reason||undefined} data-cell={vm.id+'|proxy'}
      onClick={()=>{if(busy.current)return;if(open)close();else setOpen(true);}} onKeyDown={e=>{if((e.key==='Enter'||e.key===' '||e.key==='F2')&&!open){e.preventDefault();setOpen(true);}}}>
      {info.view==='REVIEW'&&info.candidates.length>1?<div className="vm-proxy">{info.candidates.map(c=><div key={c.endpointId} className="vm-proxy-line"><span className="pm-ip vm-ellipsis" title={c.label}>{proxyAddress(c)}</span></div>)}</div>
        :shown?<div className="vm-proxy-line"><span className="pm-ip vm-ellipsis" title={proxyAddress(shown)}>{proxyAddress(shown)}</span>{rights.copy&&info.current&&<button type="button" className="vm-cell-icon" aria-label={'Copy proxy '+vm.code} title="Copy proxy (chỉ copy)" onClick={e=>{e.stopPropagation();onCopy(vm);}} onKeyDown={e=>e.stopPropagation()}><Copy size={13}/></button>}</div>
        :<span className="pm-muted vm-proxy-line">—</span>}
      {info.warning&&<span className={'vm-proxy-state vm-proxy-state-'+(info.tone==='blocked'?'review':'failed')}>{info.warning}</span>}
    </div>
    {open&&typeof document!=='undefined'&&createPortal(<div ref={pop} role="dialog" aria-label={`Thay proxy ${vm.server} / ${vm.code}`} className="vm-status-pop vm-proxy-pop" style={{top:pos?.top??-9999,left:pos?.left??-9999,maxHeight:pos?.maxHeight}}>
      <ChangeProxy projectId={projectId} vm={vm} info={info} rights={rights} onBusy={b=>{busy.current=b;onBusy(vm.id,b);}} onDone={()=>{setOpen(false);anchor.current?.focus({preventScroll:true});}} onCancel={()=>close()}/>
    </div>,document.body)}
  </div>;
}
export function ChangeProxy({projectId,vm,info,rights,onBusy,onDone,onCancel}:{projectId:string;vm:ManagedVM;info:ReturnType<typeof proxyCellInfo>;rights:ProxyRights;onBusy:(b:boolean)=>void;onDone:()=>void;onCancel:()=>void}){
  const blocked=info.tone==='blocked'&&!!info.current;
  const [tab,setTab]=useState<'stock'|'replace'>('stock'),[q,setQ]=useState(''),[picked,setPicked]=useState<string|null>(null),[check,setCheck]=useState<{sig:string;r:Check}|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const eligible=trpc.vmManagement.eligible.useQuery({projectId},{enabled:rights.assign,staleTime:10000}),probe=trpc.vmManagement.proxyCheck.useMutation(),change=trpc.vmManagement.changeProxy.useMutation(),refresh=useVMRefresh(),keyFor=useBusinessKey(),seq=useRef(0);
  const text=q.trim(),list=useMemo(()=>{const n=text.toLowerCase();return (eligible.data||[]).filter(p=>!n||(p.ip+':'+p.port).includes(n)).slice(0,60);},[eligible.data,text]);
  // What is being checked: a picked row, else the pasted text when it is not just a search inside the list.
  const target=picked?{endpointId:picked}:text&&!list.some(p=>p.ip+':'+p.port===text)&&/^\d{1,3}(\.\d{1,3}){3}/.test(text)&&(text.split(':').length>=2||!list.length)?{text}:null,sig=JSON.stringify(target);
  useEffect(()=>{if(!target||!rights.assign){setCheck(null);return;}const n=++seq.current;const t=setTimeout(()=>{probe.mutateAsync({projectId,vmId:vm.id,...target}).then(r=>{if(n===seq.current)setCheck({sig,r});}).catch(e=>{if(n===seq.current)setCheck({sig,r:{outcome:'ERROR',message:errorMessage(e),endpointId:null,label:null}});});},picked?0:350);return ()=>clearTimeout(t);},[sig]);// eslint-disable-line react-hooks/exhaustive-deps
  const result=check&&check.sig===sig?check.r:null,ready=result?.outcome==='READY'&&!!result.endpointId;
  async function apply(){
    if(!ready||saving)return;setSaving(true);onBusy(true);setError('');
    const input={projectId,vmId:vm.id,expectedVmRevision:vm.revision,expectedCycle:vm.cycle,endpointId:result!.endpointId!};
    try{const r=await change.mutateAsync({...input,key:keyFor(input)});await refresh();toast.success(vm.code+': '+r.message,{duration:2500});onBusy(false);setSaving(false);onDone();}
    catch(e){setError(errorMessage(e)+' Lựa chọn được giữ; bấm Áp dụng lại sẽ gửi đúng yêu cầu này.');setSaving(false);onBusy(false);}
  }
  return <div className="space-y-2 text-sm">
    <p className="vm-status-pop-title"><strong>{vm.server} / {vm.code}</strong> · Thay proxy</p>
    <p className="text-xs">Đang dùng: {info.current?<><strong className="pm-ip">{proxyAddress(info.current)}</strong>{info.warning?<span className={'vm-proxy-state vm-proxy-state-'+(blocked?'review':'failed')}> {info.warning}</span>:null}</>:info.candidates.length>1?<span className="text-amber-700">cần đối chiếu: {info.candidates.map(c=>proxyAddress(c)+' ('+c.label+')').join(', ')}</span>:<span className="pm-muted">chưa có proxy</span>}</p>
    {info.reason&&<p className="text-xs pm-muted">{info.reason}</p>}
    {!rights.assign?<p className="text-xs pm-muted">Chỉ xem: tài khoản chưa có quyền gán proxy.</p>:<>
    {blocked&&<div className="vm-kind-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab==='stock'} className={tab==='stock'?'active':''} onClick={()=>setTab('stock')}>Proxy trong kho</button><button type="button" role="tab" aria-selected={tab==='replace'} className={tab==='replace'?'active':''} onClick={()=>setTab('replace')}>Nhận replace</button></div>}
    {tab==='stock'?<>
      {info.candidates.length>1&&<div className="flex flex-wrap gap-1">{info.candidates.map(c=><button key={c.endpointId} type="button" className={'pm-button pm-button-quiet'+(picked===c.endpointId?' active':'')} onClick={()=>{setPicked(c.endpointId);setQ('');}}>Dùng {proxyAddress(c)}</button>)}</div>}
      <label className="pm-label text-xs">Tìm hoặc dán proxy (IP, IP:port, IP:port:user:pass)<span className="relative"><Search size={13} className="absolute left-2 top-2.5 pm-muted"/><input autoFocus className="pm-input pl-7" value={q} onChange={e=>{setQ(e.target.value);setPicked(null);}} placeholder="Ví dụ 84.32.138.211" spellCheck={false}/></span></label>
      <ul role="listbox" aria-label="Proxy NEW trong kho" className="vm-proxy-pick">{eligible.isLoading&&<li className="pm-muted text-xs"><Loader2 size={12} className="inline animate-spin"/> Đang tải kho…</li>}
        {list.map(p=><li key={p.endpointId}><button type="button" role="option" aria-selected={picked===p.endpointId} className={picked===p.endpointId?'active':''} onClick={()=>setPicked(p.endpointId)}><span className="pm-ip">{p.ip}:{p.port}</span><span className="pm-muted text-xs">{p.shared?'Chung mooon–Genjy':'TUT'} · NEW</span></button></li>)}
        {eligible.data&&!list.length&&<li className="pm-muted text-xs">{text?'Không có proxy NEW khớp trong kho.':'Kho không còn proxy NEW đủ điều kiện.'}</li>}</ul>
    </>:<ReplaceFromProvider projectId={projectId} vm={vm} oldIp={info.current!.ip!} onBusy={onBusy} onDone={onDone}/>}
    {tab==='stock'&&result&&<p className={'text-xs '+(result.outcome==='ERROR'?'vm-status-error':result.outcome==='SKIP'?'pm-muted':'text-green-700')} role={result.outcome==='ERROR'?'alert':'status'}>{result.label?<strong className="pm-ip">{result.label}</strong>:null} {result.message}</p>}
    {tab==='stock'&&target&&!result&&<p className="text-xs pm-muted"><Loader2 size={12} className="inline animate-spin"/> Đang kiểm tra…</p>}
    {error&&<p role="alert" className="vm-status-error">{error}</p>}
    {tab==='stock'&&<div className="flex gap-2 justify-end"><button type="button" className="pm-button pm-button-quiet" disabled={saving} onClick={onCancel}>Huỷ</button><button type="button" className="pm-button pm-button-primary" disabled={!ready||saving} onClick={()=>void apply()}>{saving?'Đang áp dụng…':'Áp dụng'}</button></div>}
    </>}
  </div>;
}
// The provider sent a replacement for the BLOCKED proxy of this VM: the same "Nhận replace" as Kho proxy (the old proxy becomes Đã
// replace and leaves the Blocked list, the new one is used by this VM in the same save). A bare IP inherits port / user / pass.
function ReplaceFromProvider({projectId,vm,oldIp,onBusy,onDone}:{projectId:string;vm:ManagedVM;oldIp:string;onBusy:(b:boolean)=>void;onDone:()=>void}){
  const preview=trpc.proxyManagement.preview.useMutation(),commit=trpc.proxyManagement.commit.useMutation(),refresh=useVMRefresh(),utils=trpc.useUtils();
  const [text,setText]=useState(''),[checked,setChecked]=useState<{text:string;token:string;key:string;row:{outcome:string;message:string;newIp?:string}}|null>(null),[error,setError]=useState(''),[saving,setSaving]=useState(false),seq=useRef(0);
  const added=text.trim();
  useEffect(()=>{setError('');if(!added){setChecked(null);return;}const n=++seq.current,key=crypto.randomUUID();
    const t=setTimeout(()=>{preview.mutateAsync({projectId,kind:'REPLACE',removedText:oldIp,addedText:added,receivedDate:today(),idempotencyKey:key}).then(p=>{if(n===seq.current)setChecked({text:added,token:p.token,key,row:p.rows[0]});}).catch(e=>{if(n===seq.current){setChecked(null);setError(errorMessage(e));}});},400);return ()=>clearTimeout(t);},[added]);// eslint-disable-line react-hooks/exhaustive-deps
  const current=checked&&checked.text===added?checked:null,ready=current?.row.outcome==='READY';
  async function save(){
    if(!ready||saving)return;setSaving(true);onBusy(true);setError('');
    try{await commit.mutateAsync({projectId,token:current!.token,idempotencyKey:current!.key});await Promise.all([refresh(),utils.vmManagement.eligible.invalidate()]);toast.success(vm.code+': đã nhận replace '+oldIp+' → '+(current!.row.newIp||added));onBusy(false);setSaving(false);onDone();}
    catch(e){setError(errorMessage(e)+' Nội dung được giữ; bấm lại sẽ gửi đúng yêu cầu này.');setSaving(false);onBusy(false);}
  }
  return <div className="space-y-2">
    <p className="text-xs">Proxy cũ <strong className="pm-ip">{oldIp}</strong> sẽ thành Đã replace (rời danh sách Blocked); proxy mới dùng ngay cho {vm.code}.</p>
    <label className="pm-label text-xs">Proxy mới nhà cung cấp gửi<input autoFocus className="pm-input" value={text} disabled={saving} placeholder="IP mới hoặc IP:port:user:pass" spellCheck={false} onChange={e=>setText(e.target.value)}/></label>
    {added&&!current&&!error&&<p className="text-xs pm-muted"><Loader2 size={12} className="inline animate-spin"/> Đang kiểm tra…</p>}
    {current&&<p className={'text-xs '+(ready?'text-green-700':'vm-status-error')} role={ready?'status':'alert'}>{current.row.newIp?<strong className="pm-ip">{current.row.newIp}</strong>:null} {current.row.message}</p>}
    {error&&<p role="alert" className="vm-status-error">{error}</p>}
    <div className="flex justify-end"><button type="button" className="pm-button pm-button-primary" disabled={!ready||saving} onClick={()=>void save()}>{saving?'Đang lưu…':'Áp dụng replace'}</button></div>
  </div>;
}
