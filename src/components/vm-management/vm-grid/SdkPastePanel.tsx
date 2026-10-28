"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {errorMessage} from '../shared';
import {compareCodes} from '@/server/proxy-management/package-terms';
type Preview=inferRouterOutputs<AppRouter>['vmManagement']['sdkPastePreview'];
type Applied=inferRouterOutputs<AppRouter>['vmManagement']['sdkPasteApply'];
type Mode='VM'|'RANGE';
// Dán bảng → SDK (owner brief 20/10/2026), two ways in one box:
//  A. with VM codes: [Server |] VM | SDK | Tiền USD | Ghi chú, matched by server + VM code whatever the row order;
//  B. SDK only: SDK | Tiền USD | Ghi chú from a chosen start VM; line n goes to the VM numbered start + n (never the table's order,
//     filter, sort or selection); blank lines inside keep their VM.
// Checked while typing (nothing written), result per line Dòng → VM → SDK → Kết quả, one "Áp dụng N SDK". Codes are added to the VM's
// list (never replacing one); the same code at the same VM again is "giữ nguyên"; a code on another VM or already used is refused.
// Every line is bound to the VM and its round at the check (review fix 20/10/2026): a VM recreated meanwhile refuses that line at the
// line, a background reload never re-binds it; "Kiểm tra lại" after the result checks the same content again (the text is kept).
const OUTCOME:Record<string,string>={NEW:'Thêm mới',TAKE:'Lấy từ kho',UPDATE:'Cập nhật tiền / ghi chú',SAME:'Giữ nguyên',SKIP:'Bỏ qua',ERROR:'Lỗi'};
export function SdkPasteBody({projectId,serverId,serverCode,servers,onSaved}:{projectId:string;serverId:string;serverCode:string|null;servers:{id:string;code:string}[];onSaved:()=>void}){
  const workspace=trpc.vmManagement.workspace.useQuery({projectId},{staleTime:30000}),check=trpc.vmManagement.sdkPastePreview.useMutation(),apply=trpc.vmManagement.sdkPasteApply.useMutation();
  const [text,setText]=useState(''),[mode,setMode]=useState<Mode>('VM'),[chosen,setChosen]=useState(false),[start,setStart]=useState(''),[result,setResult]=useState<{sig:string;p:Preview}|null>(null),[error,setError]=useState(''),[done,setDone]=useState<Applied|null>(null),[checking,setChecking]=useState(false),[again,setAgain]=useState(0);
  const pending=useRef<{sig:string;key:string}|null>(null),seq=useRef(0);
  const vms=useMemo(()=>(workspace.data?.vms||[]).filter(v=>v.serverId===serverId&&!v.archivedAt).sort((a,b)=>compareCodes(a.code,b.code)),[workspace.data,serverId]);
  // Which way the list is written, until the person picks one: a first cell that is a VM (or server) code means "with VM codes".
  useEffect(()=>{if(chosen)return;const first=text.replace(/\r/g,'').split('\n').find(l=>l.trim());if(!first)return;const c=(first.includes('\t')?first.split('\t'):first.includes('|')?first.split('|'):first.trim().split(/\s+/))[0].trim().toLowerCase();
    const isVm=vms.some(v=>v.code.toLowerCase()===c)||servers.some(s=>s.code.toLowerCase()===c)||/^(vm|server|máy|mã vm)$/i.test(c);setMode(isVm?'VM':'RANGE');},[text,chosen,vms,servers]);
  useEffect(()=>{if(start&&!vms.some(v=>v.id===start))setStart('');},[vms,start]);
  const input={mode,text,serverId:serverId||null,startVmId:mode==='RANGE'?start||null:null},sig=JSON.stringify(input);
  const needsStart=mode==='RANGE'&&(!serverId||!start);
  useEffect(()=>{setDone(null);setError('');
    if(!text.trim()||needsStart){setResult(null);setChecking(false);return;}
    const n=++seq.current;setChecking(true);const t=setTimeout(async()=>{try{const p=await check.mutateAsync({projectId,...input});if(n===seq.current)setResult({sig,p});}catch(e){if(n===seq.current){setResult(null);setError(errorMessage(e));}}finally{if(n===seq.current)setChecking(false);}},400);
    return ()=>clearTimeout(t);},[sig,again]);// eslint-disable-line react-hooks/exhaustive-deps
  const p=result?.sig===sig?result.p:null,ready=p&&!done?p.ready:0;
  async function save(){
    if(!p||!ready||apply.isLoading)return;
    const items=p.rows.filter(r=>r.outcome==='NEW'||r.outcome==='TAKE'||r.outcome==='UPDATE').map(r=>({line:r.line,vmId:r.vmId!,expectedCycle:r.expectedCycle!,code:r.code!,expectedSdkRevision:r.expectedSdkRevision,amount:r.amount,note:r.note}));
    const s=JSON.stringify(items),key=pending.current?.sig===s?pending.current.key:crypto.randomUUID();pending.current={sig:s,key};
    try{const r=await apply.mutateAsync({projectId,key,items});pending.current=null;setDone(r);onSaved();}
    catch(e){setError(errorMessage(e)+' Nội dung được giữ; bấm lại gửi đúng yêu cầu này (không ghi hai lần).');}
  }
  const appliedOf=(line:number)=>done?.rows.find(r=>r.line===line);
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cách dán SDK">
      <button type="button" role="radio" aria-checked={mode==='VM'} className={'pm-button'+(mode==='VM'?' pm-button-primary':'')} disabled={apply.isLoading} onClick={()=>{setChosen(true);setMode('VM');}}>Có mã VM</button>
      <button type="button" role="radio" aria-checked={mode==='RANGE'} className={'pm-button'+(mode==='RANGE'?' pm-button-primary':'')} disabled={apply.isLoading} onClick={()=>{setChosen(true);setMode('RANGE');}}>Chỉ SDK, theo khoảng VM</button>
    </div>
    {mode==='RANGE'&&<label className="pm-label">VM bắt đầu{!serverId?<span className="pm-field-error"> Chọn server ở trên trước</span>:null}
      <select className="pm-input" aria-label="VM bắt đầu" value={start} disabled={!serverId||apply.isLoading} onChange={e=>setStart(e.target.value)}><option value="">Chọn VM bắt đầu…</option>{vms.map(v=><option key={v.id} value={v.id}>{v.code}</option>)}</select></label>}
    <label className="pm-label">Dán từ Sheet<textarea className="pm-input pm-paste" rows={7} aria-label="Danh sách SDK dán" disabled={apply.isLoading} value={text} onChange={e=>setText(e.target.value)}
      placeholder={mode==='VM'?(serverCode?'VM_015\tSDK\t12.40\tghi chú':'moon05\tVM_015\tSDK\t12.40\tghi chú'):'SDK\t12.40\tghi chú\nSDK'}/></label>
    <p className="pm-muted text-xs">{mode==='VM'?(serverCode?'Mỗi dòng: VM | SDK | Tiền USD | Ghi chú (có thể thêm cột Server đầu dòng). ':'Mỗi dòng: Server | VM | SDK | Tiền USD | Ghi chú. ')+'Ghép đúng server + VM, không theo thứ tự dòng; nhiều SDK cùng một VM được.':'Mỗi dòng: SDK | Tiền USD | Ghi chú. Dòng thứ n vào VM số (bắt đầu + n) trong khoảng, không theo thứ tự bảng đang lọc / sắp xếp; dòng trống giữ vị trí.'} Tiền và ghi chú không bắt buộc; ô trống giữ nguyên. SDK được thêm vào danh sách của VM, không thay mã cũ.</p>
    {p?.range&&<p className="text-sm" aria-live="polite"><strong>{p.range.count} dòng</strong>: {p.range.from} → {p.range.to}</p>}
    {checking&&<p className="text-xs pm-muted">Đang kiểm tra…</p>}
    {p&&<><p className="text-sm"><strong>{p.ready}</strong> SDK sẽ ghi · {p.same} giữ nguyên · {p.skipped} bỏ qua · <span className={p.errors?'text-red-600':''}>{p.errors} lỗi</span></p>
      <div className="pm-table-scroll vm-bulk-result"><table className="pm-table"><thead><tr><th>Dòng</th><th>VM</th><th>SDK</th><th>Kết quả</th></tr></thead><tbody>{p.rows.map(r=>{const a=appliedOf(r.line),err=a?a.outcome==='ERROR':r.outcome==='ERROR';
        return <tr key={r.line} className={err?'pm-row-blocked':''}><td className="pm-muted">{r.line}</td><td className="whitespace-nowrap">{r.server?r.server+' / ':''}{r.vm||'—'}</td><td><code className="vm-sdk vm-sdk-full">{r.code||'—'}</code>{r.info&&<div className="pm-muted text-xs">{r.info}</div>}</td>
          <td className={err?'text-red-600':r.outcome==='SAME'||r.outcome==='SKIP'?'pm-muted':''}>{a?(a.outcome==='APPLIED'?'Đã lưu':a.outcome==='SAME'?'Giữ nguyên':'Lỗi')+' · '+a.message:OUTCOME[r.outcome]+' · '+r.message}</td></tr>;})}</tbody></table></div></>}
    {done&&<p role="status" className="pm-success text-sm">Đã lưu {done.applied} SDK · giữ nguyên {done.same} · lỗi {done.errors}.</p>}
    {error&&<p role="alert" className="pm-error">{error}</p>}
    <div className="flex gap-2 justify-end">{done&&done.errors>0&&<button type="button" className="pm-button" onClick={()=>setAgain(n=>n+1)}>Kiểm tra lại</button>}<button className="pm-button pm-button-primary" disabled={apply.isLoading||checking||!ready} onClick={()=>void save()}>{apply.isLoading?'Đang lưu…':`Áp dụng ${ready} SDK`}</button></div>
  </div>;
}
