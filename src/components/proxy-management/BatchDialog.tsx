"use client";
import {useState,useEffect} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {trpc} from '@/lib/trpc';
import type {BatchKind,BatchPreview,CommitResult} from '@/server/proxy-management/types';
import {isDuplicate,previewSummary,rejectedReport,submitCheckedBatch} from './quick-save';
import {GroupChoiceSelect,type GroupPick} from './RegistryEdit';
import {HistoryPanel} from './HistoryPanel';
import {Check,AlertCircle,Loader2,Copy,History} from 'lucide-react';
const titles={NEW:'Nhập proxy mới',BLOCKED:'Báo BLOCKED',REPLACE:'Nhận proxy thay thế',SHEET:'Đối chiếu Sheet'};
export type PackageChoiceValue={mode:'AUTO'}|{mode:'EXISTING';code:string}|{mode:'NEW';code:string;site:string};
export function PackageChoice({packages,value,onChange,disabled}:{packages:{id:string;code:string}[];value:PackageChoiceValue;onChange:(v:PackageChoiceValue)=>void;disabled?:boolean}){
  return <div className="space-y-3"><label className="pm-label">Gói proxy<select className="pm-input" disabled={disabled} value={value.mode==='AUTO'?'':value.mode==='NEW'?'__NEW__':value.code} onChange={e=>{const v=e.target.value;onChange(v===''?{mode:'AUTO'}:v==='__NEW__'?{mode:'NEW',code:'',site:''}:{mode:'EXISTING',code:v});}}><option value="">Tự nhận theo user/pass</option>{packages.map(p=><option key={p.id} value={p.code}>{p.code}</option>)}<option value="__NEW__">Gói mới…</option></select></label>
    {value.mode==='NEW'&&<div className="grid sm:grid-cols-2 gap-4"><label className="pm-label">Tên gói mới<input required className="pm-input" maxLength={80} value={value.code} disabled={disabled} placeholder="Ví dụ: 236273" onChange={e=>onChange({...value,code:e.target.value})}/></label><label className="pm-label">Site / nhà cung cấp<input className="pm-input" maxLength={120} value={value.site} disabled={disabled} placeholder="proxiware.com, vietphe…" onChange={e=>onChange({...value,site:e.target.value})}/></label></div>}
    {value.mode==='NEW'&&<p className="pm-muted text-xs">Gói mới nhận đúng một user/pass; tất cả dòng dán phải cùng user/pass đó.</p>}
  </div>;
}
/** The pasted lines the server refused (rows are numbered like parseProxyRows: blank lines skipped), in their order. */
export const refusedLines=(text:string,rows:{row:number;outcome:string}[])=>{const lines=text.split(/\r?\n/).filter(l=>l.trim());return rows.filter(r=>r.outcome==='ERROR').map(r=>lines[r.row-1]??'').filter(l=>l.trim()).join('\n');};
export function BatchDialog({projectId,kind,onClose,onSaved,onImported}:{projectId:string;kind:BatchKind;onClose:()=>void;onSaved:()=>void;/** NEW import fully saved: the parent tells the person and the dialog closes. */onImported?:(r:{applied:number;batchId:string})=>void}){
  const [oldText,setOldText]=useState(''),[newText,setNewText]=useState(''),[group,setGroup]=useState<GroupPick>({kind:'TUT'}),[date,setDate]=useState(''),[pkg,setPkg]=useState<PackageChoiceValue>({mode:'AUTO'});
  const catalog=trpc.proxyManagement.catalog.useQuery({projectId},{enabled:kind==='NEW'}),groups=trpc.proxyManagement.groups.useQuery({projectId},{enabled:kind==='NEW'});
  const owner=group.kind==='GENJY'||group.kind==='SHARED'?'GENJY':group.kind==='TUT'?'SELF':'OTHER',subgroup=group.kind==='SHARED'?'PC_CHUNG' as const:undefined,groupSummary=group.kind==='GENJY'?'Genjy riêng':group.kind==='SHARED'?'Chung mooon–Genjy':group.kind==='TUT'?'kho TUT':'nhóm '+(group.kind==='NEW'?(group.name.trim()||'mới'):groups.data?.find(g=>g.id===group.id)?.name||'');
  const [key,setKey]=useState(()=>crypto.randomUUID()),[preview,setPreview]=useState<BatchPreview|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState<string|null>(null);
  const [history,setHistory]=useState<string|null>(null),[report,setReport]=useState<{text:string;copied:boolean}|null>(null),[partial,setPartial]=useState(''),[adopt,setAdopt]=useState<string|null>(null);
  useEffect(()=>{if(!adopt)return;const g=groups.data?.find(x=>x.name.trim().toLowerCase()===adopt.toLowerCase());if(g){setGroup({kind:'GROUP',id:g.id});setAdopt(null);}},[adopt,groups.data]);
  // IPs and reasons only (no credentials); shown in a textarea when the clipboard is unavailable.
  async function copyRejected(){if(!preview)return;const text=rejectedReport(preview.rows);try{await navigator.clipboard.writeText(text);setReport({text,copied:true});}catch{setReport({text,copied:false});}}
  const inspect=trpc.proxyManagement.preview.useMutation(),commit=trpc.proxyManagement.commit.useMutation();
  const busy=inspect.isLoading||commit.isLoading;
  const changed=(fn:()=>void)=>{fn();setPreview(null);setKey(crypto.randomUUID());setError('');setSaved(null);setReport(null);};
  // Nhập mới (20/10/2026): everything saved → close and hand back to the table; some lines refused → keep only those lines (the saved ones
  // are never sent again) with their reasons and a new key; a lost answer keeps everything for the retry (failed()).
  function done(result:CommitResult){
    if(kind==='NEW'&&!result.undone&&onImported){
      if(!result.errors){onSaved();onImported({applied:result.applied,batchId:result.batchId});onClose();return;}
      // Partial (review fix 20/10/2026): not "saved" — the input stays open with only the refused lines, their reasons and Kiểm tra / Lưu.
      // A package / group created by this save is picked as existing, so the next save never tries to create it again.
      const bad=result.rows.filter(r=>r.outcome==='ERROR');
      setOldText(refusedLines(oldText,bad));setPreview(preview?{...preview,rows:bad,ready:0}:null);setKey(crypto.randomUUID());
      if(pkg.mode==='NEW')setPkg({mode:'EXISTING',code:pkg.code.trim()});
      if(group.kind==='NEW')setAdopt(group.name.trim());
      void catalog.refetch?.();void groups.refetch?.();
      setPartial(`Đã lưu ${result.applied} proxy. Còn ${bad.length} dòng cần sửa bên dưới; dòng đã lưu không gửi lại.`);onSaved();return;
    }
    setSaved(result.undone?'Đợt này đã được hoàn tác. Dữ liệu không được ghi lại.':`Đã lưu ${result.applied} proxy${result.skipped?` · ${result.skipped} giữ nguyên`:''}${result.errors?` · ${result.errors} cần kiểm tra`:''}.`);onSaved();}
  function failed(e:unknown){const message=e instanceof Error?e.message:'Chưa nhận được kết quả; bấm Lưu lại để kiểm tra.';setError(message);const code=(e as {data?:{code?:string}})?.data?.code;if(code==='CONFLICT'||/STALE_PREVIEW|CONFLICT|KEY_PAYLOAD_MISMATCH/.test(message)){setPreview(null);setKey(crypto.randomUUID());}}
  async function check(){setError('');try{const result=await submitCheckedBatch({kind,text:kind==='REPLACE'?undefined:oldText,removedText:kind==='REPLACE'?oldText:undefined,addedText:kind==='REPLACE'?newText:undefined,owner:kind==='NEW'?owner:undefined,subgroup:kind==='NEW'?subgroup:undefined,groupId:kind==='NEW'&&group.kind==='GROUP'?group.id:undefined,newGroup:kind==='NEW'&&group.kind==='NEW'?{name:group.name.trim()}:undefined,receivedDate:date||null,packageCode:kind==='NEW'&&pkg.mode==='EXISTING'?pkg.code:undefined,newPackage:kind==='NEW'&&pkg.mode==='NEW'?{code:pkg.code.trim(),site:pkg.site.trim()||null}:undefined,idempotencyKey:key},input=>inspect.mutateAsync({projectId,...input}),input=>commit.mutateAsync({projectId,...input}),setPreview);if(result.phase==='SAVED')done(result.result);}catch(e){failed(e);}}
  async function save(){if(!preview)return;setError('');try{done(await commit.mutateAsync({projectId,token:preview.token,idempotencyKey:key}));}catch(e){failed(e);}}
  return <Dialog open onOpenChange={open=>{if(!open&&!busy) onClose();}}><DialogContent className="pm-dialog max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="text-xl">{titles[kind]}</DialogTitle><DialogDescription>{kind==='REPLACE'?'Dòng 1 ở trên thay bằng dòng 1 ở dưới. IP mới viết tắt sẽ lấy port, user và pass của đúng proxy cũ.':kind==='BLOCKED'?'Dán IP hoặc đầy đủ proxy. Hệ thống tự tìm, ghi BLOCKED và ngày giờ.':'Dán đầy đủ IP:port:user:pass, mỗi dòng một proxy.'}</DialogDescription></DialogHeader>
    {partial&&!saved&&<p role="status" className="pm-review text-sm">{partial}</p>}{!saved&&<div className="space-y-4">
      <label className="pm-label">{kind==='REPLACE'?'Proxy cũ bị BLOCKED':kind==='BLOCKED'?'Danh sách bị BLOCKED':'Danh sách proxy mới'}<textarea autoFocus className="pm-input pm-paste" rows={kind==='REPLACE'?5:8} value={oldText} disabled={busy} placeholder={kind==='NEW'?'Dán IP:port:user:pass tại đây':'Dán danh sách IP tại đây'} onChange={e=>changed(()=>setOldText(e.target.value))}/></label>
      {kind==='NEW'&&<PackageChoice packages={catalog.data||[]} value={pkg} disabled={busy} onChange={v=>changed(()=>setPkg(v))}/>}
      {kind==='REPLACE'&&<label className="pm-label">Proxy mới được replace<textarea className="pm-input pm-paste" rows={5} value={newText} disabled={busy} placeholder="Dán IP mới hoặc đầy đủ IP:port:user:pass" onChange={e=>changed(()=>setNewText(e.target.value))}/></label>}
      {kind==='NEW'&&<label className="pm-label">Từ nhóm<GroupChoiceSelect groups={groups.data||[]} value={group} disabled={busy} allowGenjy onChange={v=>changed(()=>setGroup(v))}/><span className="pm-muted text-xs font-normal">TUT là kho của anh (được điền VM). Nhóm tự đặt chỉ để quản lý, không tự điền VM.</span></label>}
      {kind!=='BLOCKED'&&<details className="pm-options"><summary>Tuỳ chọn{kind==='NEW'?' · '+groupSummary:''}{date?' · '+date:''}</summary><div className="flex gap-4 flex-wrap mt-3"><label className="pm-label">Ngày nhận <span className="pm-muted font-normal">(không bắt buộc)</span><input type="date" className="pm-input" value={date} disabled={busy} onChange={e=>changed(()=>setDate(e.target.value))}/></label></div></details>}
    </div>}
    {error&&<p role="alert" className="pm-error flex gap-2"><AlertCircle size={18} className="shrink-0"/>{error}</p>}
    {saved&&<p role="status" className="pm-success flex gap-2"><Check size={18}/>{saved}</p>}
    {preview&&!saved&&<div className="pm-review"><div className="flex gap-3 flex-wrap items-center mb-3 text-sm"><strong data-testid="preview-summary">{previewSummary(preview)}</strong>{preview.errors>0&&<button type="button" className="pm-button pm-button-quiet" onClick={()=>void copyRejected()}><Copy size={14}/>Copy {preview.errors} dòng bị từ chối</button>}{report?.copied&&<span className="pm-muted text-xs" role="status">Đã copy IP và lý do (không kèm user/pass)</span>}</div>
      {report&&!report.copied&&<label className="pm-label mb-3">Không truy cập được clipboard; copy thủ công<textarea readOnly className="pm-input pm-paste" rows={4} value={report.text}/></label>}
      <div className="max-h-60 overflow-auto"><table className="pm-table text-sm"><thead><tr><th>Dòng</th><th>Proxy</th><th>Kết quả</th></tr></thead><tbody>{preview.rows.map(r=>{const dup=isDuplicate(r);return <tr key={r.row}><td>{r.row}</td><td><div className="font-mono">{r.oldIp}{r.newIp&&r.oldIp?' → ':''}{r.newIp}{!r.oldIp&&!r.newIp&&<span className="pm-muted">(không đọc được)</span>}</div>{r.packageCode&&<div className="pm-muted text-xs mt-1">Gói {r.packageCode}</div>}{r.owner&&<div className="pm-muted text-xs mt-1">{r.owner==='GENJY'?(r.subgroup==='PC_CHUNG'?'Chung mooon–Genjy':'Genjy riêng'):r.owner==='SELF'?'TUT':r.owner==='OTHER'?(r.groupName||'Nhóm khác'):'Chưa xác định'}</div>}{r.existing&&<div className="pm-muted text-xs mt-1 flex gap-2 items-center flex-wrap">{r.existing.foreign?<span>Thuộc dự án khác</span>:r.existing.locations.length>0?<span>Đang ở {r.existing.locations.join(', ')}</span>:r.existing.state?<span>Chưa gán VM</span>:null}{!r.existing.foreign&&<button type="button" className="pm-button pm-button-quiet" aria-label={'Xem lịch sử '+(r.newIp||r.oldIp)} onClick={()=>setHistory(r.existing!.identityId)}><History size={13}/>Lịch sử</button>}</div>}{r.sourceRefs.length>0&&<div className="pm-muted text-xs mt-1 break-all">Nguồn: {r.sourceRefs.join(', ')}</div>}</td><td><span className={`pm-badge ${r.outcome==='ERROR'?(dup?'pm-badge-amber':'pm-badge-red'):'pm-badge-muted'}`}>{r.outcome==='READY'?'Hợp lệ':r.outcome==='SKIP'?'Giữ nguyên':dup?'Trùng':'Cần kiểm tra'}</span><p className="pm-muted mt-1 text-xs">{r.message}</p></td></tr>;})}</tbody></table></div></div>}
    {history&&<HistoryPanel projectId={projectId} identityId={history} onClose={()=>setHistory(null)}/>}
    <div className="flex justify-end gap-2 pt-2"><button className="pm-button" disabled={busy} onClick={onClose}>{saved?'Đóng':'Huỷ'}</button>{!saved&&<button className="pm-button pm-button-primary" disabled={busy||!oldText.trim()||(!!preview&&!preview.ready)||(kind==='NEW'&&pkg.mode==='NEW'&&!pkg.code.trim())||(kind==='NEW'&&group.kind==='NEW'&&!group.name.trim())} onClick={preview?save:check}>{busy&&<Loader2 size={16} className="animate-spin"/>}{inspect.isLoading?'Đang kiểm tra…':commit.isLoading?'Đang lưu…':preview?`Lưu ${preview.ready} dòng hợp lệ`:'Kiểm tra và lưu'}</button>}</div>
  </DialogContent></Dialog>;
}
