"use client";
import {useState} from 'react';
import toast from 'react-hot-toast';
import {trpc} from '@/lib/trpc';
import type {BulkKind,BulkPreview,BulkApplyResult} from '@/server/vm-management/bulk';
import {AllocationForm} from '../AllocationDialog';
import {errorMessage,type ManagedVM} from '../shared';
import {AccountPasteBody} from './AccountPanels';
type PasteKind=Exclude<BulkKind,'GMAIL'>|'ACCOUNT';
const KIND_LABEL:Record<PasteKind,string>={SDK:'SDK',PROXY:'Proxy',ACCOUNT:'Tài khoản + PP',NOTE:'Ghi chú'};
const HINT:Record<Exclude<BulkKind,'GMAIL'>,string>={SDK:'Mã SDK, mỗi VM một mã khác nhau.',PROXY:'IP, IP:port hoặc IP:port:user:pass (TUT hoặc Chung mooon–Genjy). Chỉ giao vào VM đang trống.',NOTE:'Ghi chú tối đa 1000 ký tự; phần sau cột VM là ghi chú.'};
type Input={kind:BulkKind;serverId?:string;text?:string;items?:{vmId:string;value:string}[]};
// Preview in the same form, then one Áp dụng saves the valid rows. The server re-checks every row; rows changed since the preview
// or in conflict stay unchanged and are listed. No extra confirmation after the preview.
function useBulk(projectId:string,onSaved:()=>void){
  const preview=trpc.vmManagement.bulkPreview.useMutation(),apply=trpc.vmManagement.bulkApply.useMutation();
  const [result,setResult]=useState<BulkPreview|null>(null),[applied,setApplied]=useState<BulkApplyResult|null>(null),[error,setError]=useState('');
  return {result,applied,error,busy:preview.isLoading||apply.isLoading,
    reset:()=>{setResult(null);setApplied(null);setError('');},
    check:async(input:Input)=>{setError('');setApplied(null);try{setResult(await preview.mutateAsync({projectId,...input}));}catch(e){setError(errorMessage(e));setResult(null);}},
    save:async()=>{
      if(!result) return null;const items=result.rows.filter(r=>r.outcome==='READY'&&r.vmId).map(r=>({line:r.line,vmId:r.vmId!,expectedRevision:r.expectedRevision!,value:r.value}));if(!items.length) return null;
      setError('');try{const r=await apply.mutateAsync({projectId,kind:result.kind,key:crypto.randomUUID(),items});setApplied(r);onSaved();
        if(r.applied) toast.success(`Đã lưu ${r.applied} dòng`+(r.errors?` · ${r.errors} dòng chưa lưu`:''));else toast.error('Không dòng nào được lưu; xem lý do từng dòng');return r;}
      catch(e){setError(errorMessage(e));return null;}
    }};
}
function ResultTable({preview,applied}:{preview:BulkPreview;applied:BulkApplyResult|null}){
  const after=new Map((applied?.rows||[]).map(r=>[r.line,r]));
  return <div className="vm-bulk-table"><table className="pm-table"><thead><tr><th>Dòng</th><th>VM</th><th>Cũ → mới</th><th>Kết quả</th></tr></thead><tbody>{preview.rows.map(r=>{const a=after.get(r.line),outcome=a?a.outcome:r.outcome,message=a?a.message:r.message;
    return <tr key={r.line} className={outcome==='ERROR'?'pm-row-blocked':''}><td className="pm-muted">{r.line}</td><td className="whitespace-nowrap">{r.server?r.server+' / ':''}{r.vm||'—'}</td><td className="vm-bulk-change"><span className="pm-muted">{r.before||'trống'}</span> → <strong>{r.outcome==='READY'&&r.value===null?'(xoá)':r.after||'—'}</strong></td>
      <td className={outcome==='ERROR'?'text-red-600':outcome==='SKIP'?'pm-muted':outcome==='APPLIED'?'text-green-700':''}>{outcome==='READY'?'Hợp lệ':outcome==='APPLIED'?'Đã lưu':outcome==='SKIP'?'Giữ nguyên':'Lỗi'} · {message}</td></tr>;})}</tbody></table></div>;
}
function Counts({p}:{p:BulkPreview}){return <p className="text-sm"><strong>{p.ready}</strong> hợp lệ · {p.skipped} giữ nguyên · <span className={p.errors?'text-red-600':''}>{p.errors} lỗi</span></p>;}
// Dán bảng: one kind per batch. One server: VM | value. Several servers: Server | VM | value. Matched by server + VM code.
export function PasteTablePanel({projectId,servers,serverId,onSaved}:{projectId:string;servers:{id:string;code:string}[];serverId?:string;onSaved:()=>void}){
  const [kind,setKind]=useState<PasteKind>('SDK'),[server,setServer]=useState(serverId||''),[text,setText]=useState(''),bulk=useBulk(projectId,onSaved);
  const change=(fn:()=>void)=>{fn();bulk.reset();};
  async function apply(){
    const r=await bulk.save();if(!r||!bulk.result) return;
    // Keep only the lines that still need work (refused at preview or at save) so a retry never re-sends saved rows.
    const failed=new Set([...bulk.result.rows.filter(x=>x.outcome==='ERROR').map(x=>x.line),...r.rows.filter(x=>x.outcome==='ERROR').map(x=>x.line)]);
    const lines=text.replace(/\r/g,'').split('\n');setText(lines.filter((_,i)=>failed.has(i+1)).join('\n'));
  }
  return <div className="space-y-3">
    <div className="vm-kind-tabs" role="tablist" aria-label="Loại cập nhật">{(Object.keys(KIND_LABEL) as PasteKind[]).map(k=><button key={k} type="button" role="tab" aria-selected={kind===k} className={kind===k?'active':''} disabled={bulk.busy} onClick={()=>change(()=>setKind(k))}>{KIND_LABEL[k]}</button>)}</div>
    <label className="pm-label">Server<select className="pm-input" aria-label="Server của danh sách" disabled={bulk.busy} value={server} onChange={e=>change(()=>setServer(e.target.value))}><option value="">Nhiều server (dán kèm cột Server)</option>{servers.map(s=><option key={s.id} value={s.id}>{s.code}</option>)}</select></label>
    {kind==='ACCOUNT'?<AccountPasteBody projectId={projectId} serverCode={servers.find(s=>s.id===server)?.code??null} text={text} setText={setText} onSaved={onSaved}/>:<>
    <label className="pm-label">Dán từ Sheet<textarea className="pm-input pm-paste" rows={7} aria-label="Danh sách dán" disabled={bulk.busy} value={text} placeholder={server?`VM_001\t…\nVM_002\t…`:`moon05\tVM_001\t…\nmoon06\tVM_002\t…`} onChange={e=>change(()=>setText(e.target.value))}/></label>
    <p className="pm-muted text-xs">{server?'Mỗi dòng: VM | giá trị.':'Mỗi dòng: Server | VM | giá trị.'} {HINT[kind]} Ô trống giữ nguyên{kind!=='PROXY'?'; gõ "-" để xoá giá trị':''}.</p>
    {bulk.result&&<><Counts p={bulk.result}/><ResultTable preview={bulk.result} applied={bulk.applied}/></>}
    {bulk.applied&&<p role="status" className="pm-success text-sm">Đã lưu {bulk.applied.applied} · giữ nguyên {bulk.applied.skipped} · lỗi {bulk.applied.errors}. {text.trim()?'Ô dán chỉ còn các dòng lỗi để sửa và thử lại.':''}</p>}
    {bulk.error&&<p role="alert" className="pm-error">{bulk.error}</p>}
    <div className="flex gap-2 justify-end">{bulk.result&&!bulk.applied&&bulk.result.ready>0?<button className="pm-button pm-button-primary" disabled={bulk.busy} onClick={()=>void apply()}>{bulk.busy?'Đang lưu…':`Áp dụng ${bulk.result.ready} dòng hợp lệ`}</button>:<button className="pm-button pm-button-primary" disabled={bulk.busy||!text.trim()} onClick={()=>void bulk.check({kind,serverId:server||undefined,text})}>{bulk.busy?'Đang kiểm tra…':'Xem trước'}</button>}</div>
    </>}
  </div>;
}
// Same value for every selected VM (note or existing Gmail). "-" clears.
function SameValuePanel({projectId,kind,vms,onSaved,children,value,clearLabel}:{projectId:string;kind:'NOTE';vms:ManagedVM[];onSaved:()=>void;children:React.ReactNode;value:string;clearLabel:string}){
  const bulk=useBulk(projectId,onSaved),[cleared,setCleared]=useState(false);
  const run=(clear:boolean)=>{setCleared(clear);void bulk.check({kind,items:vms.map(v=>({vmId:v.id,value:clear?'-':value}))});};
  return <div className="space-y-3">{children}
    {bulk.result&&<><Counts p={bulk.result}/><ResultTable preview={bulk.result} applied={bulk.applied}/></>}
    {bulk.error&&<p role="alert" className="pm-error">{bulk.error}</p>}
    <div className="flex gap-2 justify-end flex-wrap">{bulk.result&&!bulk.applied&&bulk.result.ready>0?<><button className="pm-button" disabled={bulk.busy} onClick={bulk.reset}>Sửa lại</button><button className="pm-button pm-button-primary" disabled={bulk.busy} onClick={()=>void bulk.save()}>{bulk.busy?'Đang lưu…':`Áp dụng ${bulk.result.ready} VM${cleared?' (xoá)':''}`}</button></>:<>
      <button className="pm-button pm-button-quiet" disabled={bulk.busy||!vms.length} onClick={()=>run(true)}>{clearLabel}</button><button className="pm-button pm-button-primary" disabled={bulk.busy||!vms.length||!value.trim()} onClick={()=>run(false)}>Xem trước</button></>}</div>
  </div>;
}
export function NotesPanel({projectId,vms,onSaved}:{projectId:string;vms:ManagedVM[];onSaved:()=>void}){
  const [note,setNote]=useState('');
  return <SameValuePanel projectId={projectId} kind="NOTE" vms={vms} onSaved={onSaved} value={note} clearLabel="Xoá ghi chú các VM này"><label className="pm-label">Ghi chú cho {vms.length} VM đã chọn<textarea className="pm-input" rows={4} maxLength={1000} aria-label="Ghi chú hàng loạt" value={note} onChange={e=>setNote(e.target.value)}/></label><p className="pm-muted text-xs">{note.length}/1000 ký tự. Thay ghi chú hiện có của từng VM; VM đã có đúng ghi chú này được giữ nguyên.</p></SameValuePanel>;
}

// Gán proxy cho VM đã chọn: autofill exactly these VMs with unused TUT NEW, or pick by hand (TUT or Chung mooon–Genjy) per VM.
export function AssignProxyPanel({projectId,vms,sourceConnected,onSaved}:{projectId:string;vms:ManagedVM[];sourceConnected:boolean;onSaved:()=>void}){
  const [mode,setMode]=useState<'AUTO'|'MANUAL'>('AUTO'),eligible=trpc.vmManagement.eligible.useQuery({projectId},{enabled:mode==='MANUAL'}),bulk=useBulk(projectId,onSaved),[picks,setPicks]=useState<Record<string,string>>({});
  const list=vms.slice(0,100),chosen=new Set(Object.values(picks).filter(Boolean));
  return <div className="space-y-3">
    <div className="vm-kind-tabs" role="tablist"><button type="button" role="tab" aria-selected={mode==='AUTO'} className={mode==='AUTO'?'active':''} onClick={()=>setMode('AUTO')}>Tự điền TUT NEW</button><button type="button" role="tab" aria-selected={mode==='MANUAL'} className={mode==='MANUAL'?'active':''} onClick={()=>{setMode('MANUAL');bulk.reset();}}>Chọn tay</button></div>
    {mode==='AUTO'?(!sourceConnected?<p className="pm-source-warning">Cần kết nối nguồn Genjy trước khi tự điền.</p>:<AllocationForm key={vms.map(v=>v.id).join()} projectId={projectId} vmIds={vms.map(v=>v.id)} onClose={()=>{}} onSaved={onSaved}/>):<>
      <p className="pm-muted text-xs">Chọn proxy NEW chưa dùng cho từng VM (TUT hoặc Chung mooon–Genjy). Chỉ VM đang trống mới nhận proxy; proxy đã cài/đang cài không bị thả.{vms.length>100?` Hiện 100/${vms.length} VM đầu.`:''}</p>
      <div className="vm-bulk-table"><table className="pm-table"><tbody>{list.map(v=><tr key={v.id}><td className="whitespace-nowrap">{v.server} / {v.code}</td><td><select className="pm-input" aria-label={'Proxy cho '+v.code} value={picks[v.id]||''} disabled={bulk.busy} onChange={e=>{setPicks({...picks,[v.id]:e.target.value});bulk.reset();}}><option value="">— giữ nguyên —</option>{eligible.data?.filter(p=>!chosen.has(p.ip+':'+p.port)||picks[v.id]===p.ip+':'+p.port).map(p=><option key={p.endpointId} value={p.ip+':'+p.port}>{p.ip}:{p.port} · {p.shared?'Chung':'TUT'}</option>)}</select></td></tr>)}</tbody></table></div>
      {eligible.error&&<p role="alert" className="pm-error">{eligible.error.message}</p>}
      {bulk.result&&<><Counts p={bulk.result}/><ResultTable preview={bulk.result} applied={bulk.applied}/></>}{bulk.error&&<p role="alert" className="pm-error">{bulk.error}</p>}
      <div className="flex justify-end gap-2">{bulk.result&&!bulk.applied&&bulk.result.ready>0?<button className="pm-button pm-button-primary" disabled={bulk.busy} onClick={()=>void bulk.save().then(r=>{if(r)setPicks({});})}>{bulk.busy?'Đang lưu…':`Áp dụng ${bulk.result.ready} VM`}</button>:<button className="pm-button pm-button-primary" disabled={bulk.busy||!chosen.size} onClick={()=>void bulk.check({kind:'PROXY',items:list.filter(v=>picks[v.id]).map(v=>({vmId:v.id,value:picks[v.id]}))})}>Xem trước</button>}</div>
    </>}
  </div>;
}
