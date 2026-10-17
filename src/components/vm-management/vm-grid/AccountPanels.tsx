"use client";
import {useState} from 'react';
import toast from 'react-hot-toast';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {errorMessage,type ManagedVM} from '../shared';
type Preview=inferRouterOutputs<AppRouter>['accountStore']['linkPreview'];
type Applied=inferRouterOutputs<AppRouter>['accountStore']['linkApply'];
// Preview → one "Gán N VM" → every row re-checked by the server; rows saved or refused one by one (a row is never half saved).
function useLinks(projectId:string,onSaved:()=>void){
  const apply=trpc.accountStore.linkApply.useMutation(),utils=trpc.useUtils();
  const [result,setResult]=useState<Preview|null>(null),[applied,setApplied]=useState<Applied|null>(null),[error,setError]=useState(''),[checking,setChecking]=useState(false);
  return {result,applied,error,busy:checking||apply.isLoading,
    reset:()=>{setResult(null);setApplied(null);setError('');},
    check:async(fn:()=>Promise<Preview>)=>{setError('');setApplied(null);setChecking(true);try{setResult(await fn());}catch(e){setError(errorMessage(e));setResult(null);}finally{setChecking(false);}},
    save:async()=>{
      if(!result)return null;const items=result.rows.filter(r=>r.outcome==='READY'&&r.vmId).map(r=>({line:r.line,vmId:r.vmId!,expectedRevision:r.expectedRevision!,...(r.login!==undefined?{login:r.login}:{}),...(r.paypal!==undefined?{paypal:r.paypal}:{})}));if(!items.length)return null;
      setError('');try{const r=await apply.mutateAsync({projectId,key:crypto.randomUUID(),items});setApplied(r);await utils.accountStore.invalidate();onSaved();
        if(r.applied)toast.success(`Đã lưu ${r.applied} VM`+(r.errors?` · ${r.errors} dòng chưa lưu`:''));else toast.error('Không dòng nào được lưu; xem lý do từng dòng');return r;}
      catch(e){setError(errorMessage(e));return null;}
    }};
}
function LinkTable({preview,applied}:{preview:Preview;applied:Applied|null}){
  const after=new Map((applied?.rows||[]).map(r=>[r.line,r])),show=(v:{login:string|null;paypal:string|null})=>v.login?v.login+(v.paypal?' · '+v.paypal:''):v.paypal||'trống';
  return <div className="vm-bulk-table"><table className="pm-table"><thead><tr><th>Dòng</th><th>VM</th><th>Cũ → mới</th><th>Kết quả</th></tr></thead><tbody>{preview.rows.map(r=>{const a=after.get(r.line),outcome=a?a.outcome:r.outcome,message=a?a.message:r.message;
    return <tr key={r.line} className={outcome==='ERROR'?'pm-row-blocked':''}><td className="pm-muted">{r.line}</td><td className="whitespace-nowrap">{r.server?r.server+' / ':''}{r.vm||'—'}</td><td className="vm-bulk-change"><span className="pm-muted">{show(r.before)}</span> → <strong>{show(r.after)}</strong></td>
      <td className={outcome==='ERROR'?'text-red-600':outcome==='SKIP'?'pm-muted':outcome==='APPLIED'?'text-green-700':''}>{outcome==='READY'?'Hợp lệ':outcome==='APPLIED'?'Đã lưu':outcome==='SKIP'?'Không thay đổi':'Lỗi'} · {message}</td></tr>;})}</tbody></table></div>;
}
const Counts=({p}:{p:Preview})=><p className="text-sm"><strong>{p.ready}</strong> hợp lệ · {p.skipped} không thay đổi · <span className={p.errors?'text-red-600':''}>{p.errors} lỗi</span></p>;
// Dán bảng → Tài khoản: Server | VM | Tài khoản | Mã PP (with one server chosen: VM | Tài khoản | Mã PP).
export function AccountPasteBody({projectId,serverCode,text,setText,onSaved}:{projectId:string;serverCode:string|null;text:string;setText:(s:string)=>void;onSaved:()=>void}){
  const links=useLinks(projectId,onSaved),preview=trpc.accountStore.linkPreview.useMutation();
  // With a server chosen, lines may omit the Server cell; a line that already starts with that server (or the header) is kept as is.
  const full=()=>serverCode?text.replace(/\r/g,'').split('\n').map(l=>{const first=(l.includes('\t')?l.split('\t'):l.split('|'))[0].trim().toLowerCase();return !l.trim()||first===serverCode.toLowerCase()||first==='server'?l:serverCode+(l.includes('\t')?'\t':' | ')+l;}).join('\n'):text;
  async function apply(){
    const r=await links.save();if(!r||!links.result)return;
    const failed=new Set([...links.result.rows.filter(x=>x.outcome==='ERROR').map(x=>x.line),...r.rows.filter(x=>x.outcome==='ERROR').map(x=>x.line)]);
    setText(text.replace(/\r/g,'').split('\n').filter((_,i)=>failed.has(i+1)).join('\n'));
  }
  return <>
    <label className="pm-label">Dán từ Sheet<textarea className="pm-input pm-paste" rows={7} aria-label="Danh sách dán" disabled={links.busy} value={text} placeholder={serverCode?'VM_001\tacc01@example.invalid\ttut-09':'moon05\tVM_001\tacc01@example.invalid\ttut-09'} onChange={e=>{setText(e.target.value);links.reset();}}/></label>
    <p className="pm-muted text-xs">{serverCode?'Mỗi dòng: VM | Tài khoản | Mã PP.':'Mỗi dòng: Server | VM | Tài khoản | Mã PP.'} Ghép theo server + mã VM. Tài khoản và PayPal phải có sẵn trong Kho tài khoản. Ô trống giữ nguyên; gõ dấu - ở cột Tài khoản để bỏ gán. Tài khoản / PayPal đang giữ cho VM khác bị chặn, không tự chuyển.</p>
    {links.result&&<><Counts p={links.result}/><LinkTable preview={links.result} applied={links.applied}/></>}
    {links.applied&&<p role="status" className="pm-success text-sm">Đã lưu {links.applied.applied} · không thay đổi {links.applied.skipped} · lỗi {links.applied.errors}. {text.trim()?'Ô dán chỉ còn các dòng lỗi.':''}</p>}
    {links.error&&<p role="alert" className="pm-error">{links.error}</p>}
    <div className="flex gap-2 justify-end">{links.result&&!links.applied&&links.result.ready>0?<button className="pm-button pm-button-primary" disabled={links.busy} onClick={()=>void apply()}>{links.busy?'Đang lưu…':`Áp dụng ${links.result.ready} dòng hợp lệ`}</button>
      :<button className="pm-button pm-button-primary" disabled={links.busy||!text.trim()} onClick={()=>void links.check(()=>preview.mutateAsync({projectId,text:full()}))}>{links.busy?'Đang kiểm tra…':'Xem trước'}</button>}</div>
  </>;
}
// Selected VMs → take NEW accounts of the chosen type from the stock (and a NEW PayPal each if asked), preview, then one click.
export function AccountBulkPanel({projectId,vms,onSaved}:{projectId:string;vms:ManagedVM[];onSaved:()=>void}){
  const [type,setType]=useState<'GMAIL'|'APPLE_ID'|''>(''),[withPaypal,setWithPaypal]=useState(true),links=useLinks(projectId,onSaved),plan=trpc.accountStore.autoPlan.useMutation();
  const [info,setInfo]=useState<{notPlanned:{server:string;vm:string;message:string}[]}|null>(null);
  return <div className="space-y-3">
    <p className="text-sm">Gán tài khoản NEW trong kho cho {vms.length} VM đã chọn. VM đã có tài khoản được giữ nguyên{withPaypal?' (chỉ thêm PayPal nếu còn thiếu)':''}.</p>
    <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Loại tài khoản">{(['GMAIL','APPLE_ID'] as const).map(t=><button key={t} type="button" role="radio" aria-checked={type===t} className={'pm-button'+(type===t?' pm-button-primary':'')} disabled={links.busy} onClick={()=>{setType(t);links.reset();}}>{t==='GMAIL'?'Gmail':'Apple ID'}</button>)}</div>
    <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={withPaypal} disabled={links.busy} onChange={e=>{setWithPaypal(e.target.checked);links.reset();}}/>Kèm một PayPal NEW cho mỗi VM</label>
    {links.result&&<><Counts p={links.result}/><LinkTable preview={links.result} applied={links.applied}/></>}
    {info?.notPlanned.length?<p className="text-xs pm-muted">Không gán: {info.notPlanned.slice(0,8).map(n=>`${n.server}/${n.vm} (${n.message})`).join(', ')}{info.notPlanned.length>8?` và ${info.notPlanned.length-8} VM khác`:''}</p>:null}
    {links.error&&<p role="alert" className="pm-error">{links.error}</p>}
    <div className="flex gap-2 justify-end">{links.result&&!links.applied&&links.result.ready>0?<><button className="pm-button" disabled={links.busy} onClick={links.reset}>Sửa lại</button><button className="pm-button pm-button-primary" disabled={links.busy} onClick={()=>void links.save()}>{links.busy?'Đang lưu…':`Gán ${links.result.ready} VM`}</button></>
      :<button className="pm-button pm-button-primary" disabled={links.busy||!type||!vms.length} onClick={()=>void links.check(async()=>{const r=await plan.mutateAsync({projectId,vmIds:vms.map(v=>v.id),loginType:type as 'GMAIL'|'APPLE_ID',withPaypal});setInfo(r);return r;})}>{links.busy?'Đang kiểm tra…':type?'Xem trước':'Chọn Gmail hoặc Apple ID'}</button>}</div>
  </div>;
}
