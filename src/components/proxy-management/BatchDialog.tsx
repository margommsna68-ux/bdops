"use client";
import {useState,useEffect,useMemo,useRef} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {trpc} from '@/lib/trpc';
import type {BatchInput,BatchKind,BatchPreview,CommitResult,ProxyPurchaseInput} from '@/server/proxy-management/types';
import {parseProxyRows} from '@/server/proxy-management/parse';
import {PurchaseMoneyFields,useQuoteExpiry} from '@/components/account-store/PurchaseMoneyFields';
import {applySuggestedQuantity,emptyPurchase,manualQuantity as hasManualQuantity,readPurchase,type PurchaseState} from '@/components/account-store/purchase-money';
import {displayMoney} from '@/lib/money-input';
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
/** Initial list estimate; the server's money-free preview still checks existing stock and approved port streams. */
export function countFullProxyQuantity(text:string){
  try{return new Set(parseProxyRows(text).flatMap(l=>l.proxy?.format==='FULL'?[l.proxy.ip+':'+l.proxy.port]:[])).size;}catch{return 0;}
}
export function BatchDialog({projectId,kind,onClose,onSaved,onImported}:{projectId:string;kind:BatchKind;onClose:()=>void;onSaved:()=>void;/** NEW import fully saved: the parent tells the person and the dialog closes. */onImported?:(r:{applied:number;batchId:string})=>void}){
  const [oldText,setOldText]=useState(''),[newText,setNewText]=useState(''),[group,setGroup]=useState<GroupPick>({kind:'TUT'}),[date,setDate]=useState(''),[pkg,setPkg]=useState<PackageChoiceValue>({mode:'AUTO'});
  const [costEnabled,setCostEnabled]=useState(false),[purchaseRecorded,setPurchaseRecorded]=useState(false),[money,setMoney]=useState<PurchaseState>(emptyPurchase),[checkedQuantity,setCheckedQuantity]=useState<number|null>(null),[quantityReview,setQuantityReview]=useState(false);
  const [purchaseDate,setPurchaseDate]=useState(()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Bangkok'}));
  const listQuantity=useMemo(()=>countFullProxyQuantity(oldText),[oldText]);
  const manualQuantity=hasManualQuantity(money),moneyValue=applySuggestedQuantity(money,checkedQuantity??listQuantity);
  const purchaseMoney=readPurchase(moneyValue,'proxy'),moneyBlocked=kind==='NEW'&&costEnabled&&!purchaseRecorded&&!purchaseMoney.payload;
  useQuoteExpiry(costEnabled&&!purchaseRecorded?moneyValue.quote:null);
  const catalog=trpc.proxyManagement.catalog.useQuery({projectId},{enabled:kind==='NEW'}),groups=trpc.proxyManagement.groups.useQuery({projectId},{enabled:kind==='NEW'});
  const cashAccess=trpc.businessManagement.cashAccess.useQuery({projectId},{enabled:kind==='NEW',retry:false}),canRecordPurchase=kind==='NEW'&&!!cashAccess.data?.writeCosts;
  const owner=group.kind==='GENJY'||group.kind==='SHARED'?'GENJY':group.kind==='TUT'?'SELF':'OTHER',subgroup=group.kind==='SHARED'?'PC_CHUNG' as const:undefined,groupSummary=group.kind==='GENJY'?'Genjy riêng':group.kind==='SHARED'?'Chung mooon–Genjy':group.kind==='TUT'?'kho TUT':'nhóm '+(group.kind==='NEW'?(group.name.trim()||'mới'):groups.data?.find(g=>g.id===group.id)?.name||'');
  const [key,setKey]=useState(()=>crypto.randomUUID()),[preview,setPreview]=useState<BatchPreview|null>(null),[error,setError]=useState(''),[saved,setSaved]=useState<string|null>(null);
  const [history,setHistory]=useState<string|null>(null),[report,setReport]=useState<{text:string;copied:boolean}|null>(null),[partial,setPartial]=useState(''),[adopt,setAdopt]=useState<string|null>(null);
  useEffect(()=>{if(!adopt)return;const g=groups.data?.find(x=>x.name.trim().toLowerCase()===adopt.toLowerCase());if(g){setGroup({kind:'GROUP',id:g.id});setAdopt(null);}},[adopt,groups.data]);
  // IPs and reasons only (no credentials); shown in a textarea when the clipboard is unavailable.
  async function copyRejected(){if(!preview)return;const text=rejectedReport(preview.rows);try{await navigator.clipboard.writeText(text);setReport({text,copied:true});}catch{setReport({text,copied:false});}}
  const inspect=trpc.proxyManagement.preview.useMutation(),commit=trpc.proxyManagement.commit.useMutation();
  const [uncertain,setUncertain]=useState(false);
  const pendingCommit=useRef<{projectId:string;token:string;idempotencyKey:string}|null>(null);
  const priorUnknown=useRef(false);
  const busy=inspect.isLoading||commit.isLoading,locked=busy||uncertain;
  const changed=(fn:()=>void)=>{if(locked)return;fn();setCheckedQuantity(null);setQuantityReview(false);setPreview(null);setKey(crypto.randomUUID());setError('');setSaved(null);setReport(null);};
  const changeMoney=(value:PurchaseState)=>changed(()=>setMoney(value));
  async function commitChecked(input:{token:string;idempotencyKey:string}){
    const request={projectId,...input};pendingCommit.current=request;setUncertain(true);
    return commit.mutateAsync(request);
  }
  // Nhập mới (20/10/2026): everything saved → close and hand back to the table; some lines refused → keep only those lines (the saved ones
  // are never sent again) with their reasons and a new key; a lost answer keeps everything for the retry (failed()).
  function done(result:CommitResult,checked=preview){
    pendingCommit.current=null;priorUnknown.current=false;setUncertain(false);
    if(kind==='NEW'&&!result.undone){
      if(!result.errors&&onImported){onSaved();onImported({applied:result.applied,batchId:result.batchId});onClose();return;}
      if(result.errors){
      // Partial (review fix 20/10/2026): not "saved" — the input stays open with only the refused lines, their reasons and Kiểm tra / Lưu.
      // A package / group created by this save is picked as existing, so the next save never tries to create it again.
      const bad=result.rows.filter(r=>r.outcome==='ERROR');
      setOldText(refusedLines(oldText,bad));setPreview(checked?{...checked,purchase:undefined,rows:bad,ready:0}:null);setKey(crypto.randomUUID());
      if(result.applied>0&&costEnabled){setPurchaseRecorded(true);setCostEnabled(false);setMoney(emptyPurchase());}
      setCheckedQuantity(null);setQuantityReview(false);
      if(pkg.mode==='NEW')setPkg({mode:'EXISTING',code:pkg.code.trim()});
      if(group.kind==='NEW')setAdopt(group.name.trim());
      void catalog.refetch?.();void groups.refetch?.();
      setPartial(`Đã lưu ${result.applied} proxy. Còn ${bad.length} dòng cần sửa bên dưới; dòng đã lưu không gửi lại.`);onSaved();return;
    }}
    setSaved(result.undone?'Đợt này đã được hoàn tác. Dữ liệu không được ghi lại.':`Đã lưu ${result.applied} proxy${result.skipped?` · ${result.skipped} giữ nguyên`:''}${result.errors?` · ${result.errors} cần kiểm tra`:''}.`);onSaved();}
  function failed(e:unknown){
    const message=e instanceof Error?e.message:'Chưa nhận được kết quả; bấm Lưu lại để kiểm tra.';setError(message);
    const failure=e as {data?:{code?:string;httpStatus?:number};code?:string},code=failure?.data?.code||failure?.code;
    if(pendingCommit.current){
      const refused=['CONFLICT','BAD_REQUEST','FORBIDDEN','UNAUTHORIZED','NOT_FOUND','PRECONDITION_FAILED','STALE_PREVIEW','INVALID_INPUT','VALIDATION'].includes(code||'')||/^STALE_PREVIEW\b|^VALIDATION\b/.test(message);
      if(priorUnknown.current||!refused){priorUnknown.current=true;return;}
      // A first definitive refusal proves this command did not write. A refusal after an unknown answer proves nothing about that earlier attempt.
      pendingCommit.current=null;setUncertain(false);setPreview(null);setQuantityReview(false);setCheckedQuantity(null);setKey(crypto.randomUUID());return;
    }
    if(code==='CONFLICT'||/STALE_PREVIEW|CONFLICT|KEY_PAYLOAD_MISMATCH/.test(message)){setPreview(null);setKey(crypto.randomUUID());}
  }
  async function check(){if(locked||moneyBlocked)return;if(costEnabled&&!canRecordPurchase){setError('Bạn chưa có quyền ghi chi phí trong dự án này.');return;}setError('');try{
    const input:BatchInput={kind,text:kind==='REPLACE'?undefined:oldText,removedText:kind==='REPLACE'?oldText:undefined,addedText:kind==='REPLACE'?newText:undefined,owner:kind==='NEW'?owner:undefined,subgroup:kind==='NEW'?subgroup:undefined,groupId:kind==='NEW'&&group.kind==='GROUP'?group.id:undefined,newGroup:kind==='NEW'&&group.kind==='NEW'?{name:group.name.trim()}:undefined,receivedDate:date||null,packageCode:kind==='NEW'&&pkg.mode==='EXISTING'?pkg.code:undefined,newPackage:kind==='NEW'&&pkg.mode==='NEW'?{code:pkg.code.trim(),site:pkg.site.trim()||null}:undefined,idempotencyKey:key};
    if(kind==='NEW'&&costEnabled&&!purchaseRecorded){
      if(!manualQuantity){
        const counted=await inspect.mutateAsync({projectId,...input,idempotencyKey:crypto.randomUUID()});
        setCheckedQuantity(counted.ready);
        // This token contains no purchase. Never commit it, or an earlier priced amount, after reducing the default quantity.
        if(counted.ready!==listQuantity){setQuantityReview(true);setPreview(counted);setError('Có proxy trùng / đã có hoặc chưa nhập được. Sửa / bỏ các dòng bị từ chối rồi kiểm tra lại, hoặc nhập rõ số lượng thực mua theo hoá đơn. Chưa ghi chi phí.');return;}
      }
      if(!purchaseMoney.payload)return;
      input.purchase={...purchaseMoney.payload,purchasedAt:purchaseDate,...(!manualQuantity?{quantity:undefined}:{})} as ProxyPurchaseInput;
    }
    const checked=(p:BatchPreview)=>{
      setPreview(p);
      if(input.purchase&&!p.purchase){setPreview(null);throw new Error('Máy chủ chưa xác nhận tiền mua. Chưa lưu proxy hoặc chi phí; kiểm tra lại.');}
      if(input.purchase&&!manualQuantity&&(p.ready!==listQuantity||p.purchase?.quantity!==p.ready)){
        setCheckedQuantity(p.ready);setQuantityReview(true);throw new Error('Số proxy có thể nhập đã đổi. Sửa / bỏ dòng trùng hoặc nhập rõ số lượng thực mua rồi kiểm tra lại tiền mua; chưa ghi chi phí.');
      }
    };
    const result=await submitCheckedBatch(input,input=>inspect.mutateAsync({projectId,...input}),commitChecked,checked);if(result.phase==='SAVED')done(result.result,result.preview);
  }catch(e){failed(e);}}
  async function save(){if(!preview||quantityReview||busy)return;setError('');try{done(await (pendingCommit.current?commit.mutateAsync(pendingCommit.current):commitChecked({token:preview.token,idempotencyKey:key})));}catch(e){failed(e);}}
  return <Dialog open onOpenChange={open=>{if(!open&&!locked) onClose();}}><DialogContent className="pm-dialog max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle className="text-xl">{titles[kind]}</DialogTitle><DialogDescription>{kind==='REPLACE'?'Dòng 1 ở trên thay bằng dòng 1 ở dưới. IP mới viết tắt sẽ lấy port, user và pass của đúng proxy cũ.':kind==='BLOCKED'?'Dán IP hoặc đầy đủ proxy. Hệ thống tự tìm, ghi BLOCKED và ngày giờ.':'Dán đầy đủ IP:port:user:pass, mỗi dòng một proxy.'}</DialogDescription></DialogHeader>
    {partial&&!saved&&<p role="status" className="pm-review text-sm">{partial}</p>}{!saved&&<div className="space-y-4">
      <label className="pm-label">{kind==='REPLACE'?'Proxy cũ bị BLOCKED':kind==='BLOCKED'?'Danh sách bị BLOCKED':'Danh sách proxy mới'}<textarea autoFocus className="pm-input pm-paste" rows={kind==='REPLACE'?5:8} value={oldText} disabled={locked} placeholder={kind==='NEW'?'Dán IP:port:user:pass tại đây':'Dán danh sách IP tại đây'} onChange={e=>changed(()=>setOldText(e.target.value))}/></label>
      {kind==='NEW'&&<PackageChoice packages={catalog.data||[]} value={pkg} disabled={locked} onChange={v=>changed(()=>setPkg(v))}/>}
      {kind==='NEW'&&(purchaseRecorded?<p className="pm-review text-xs">Chi phí lần mua đã được ghi cùng phần đã nhập; sửa các dòng còn lại không ghi thêm chi phí.</p>:canRecordPurchase&&<section className="space-y-3 border-t pt-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={costEnabled} disabled={locked} onChange={e=>changed(()=>setCostEnabled(e.target.checked))}/>Ghi chi phí mua proxy (không bắt buộc)</label>
        {costEnabled?<><PurchaseMoneyFields projectId={projectId} unitWord="proxy" value={moneyValue} onChange={changeMoney} locked={locked} suggestedQuantity={checkedQuantity??listQuantity}/><p className="text-xs pm-muted">Số lượng danh sách chỉ gồm proxy đầy đủ, hợp lệ, không trùng; còn kiểm tra kho trước khi ghi tiền.</p><label className="pm-label">Ngày mua<input type="date" className="pm-input" value={purchaseDate} disabled={locked} onChange={e=>changed(()=>setPurchaseDate(e.target.value))}/></label>{!purchaseMoney.priced&&<p className="pm-muted text-xs">Nhập tiền mua hoặc bỏ chọn Ghi chi phí mua proxy để chỉ nhập kho.</p>}</>:<p className="pm-muted text-xs">Chỉ nhập kho nếu chưa ghi tiền mua. Có thể ghi thanh toán gói sau.</p>}
      </section>)}
      {kind==='REPLACE'&&<label className="pm-label">Proxy mới được replace<textarea className="pm-input pm-paste" rows={5} value={newText} disabled={locked} placeholder="Dán IP mới hoặc đầy đủ IP:port:user:pass" onChange={e=>changed(()=>setNewText(e.target.value))}/></label>}
      {kind==='NEW'&&<label className="pm-label">Từ nhóm<GroupChoiceSelect groups={groups.data||[]} value={group} disabled={locked} allowGenjy onChange={v=>changed(()=>setGroup(v))}/><span className="pm-muted text-xs font-normal">TUT là kho của anh (được điền VM). Nhóm tự đặt chỉ để quản lý, không tự điền VM.</span></label>}
      {kind!=='BLOCKED'&&<details className="pm-options"><summary>Tuỳ chọn{kind==='NEW'?' · '+groupSummary:''}{date?' · '+date:''}</summary><div className="flex gap-4 flex-wrap mt-3"><label className="pm-label">Ngày nhận <span className="pm-muted font-normal">(không bắt buộc)</span><input type="date" className="pm-input" value={date} disabled={locked} onChange={e=>changed(()=>setDate(e.target.value))}/></label></div></details>}
    </div>}
    {error&&<p role="alert" className="pm-error flex gap-2"><AlertCircle size={18} className="shrink-0"/>{error}</p>}
    {uncertain&&!busy&&<p role="status" className="pm-review text-sm">Chưa xác định kết quả. Nội dung và tiền mua được giữ cố định; bấm Lưu lại để gửi đúng token và mã yêu cầu ban đầu, không ghi thêm khoản chi.</p>}
    {preview?.purchase&&!saved&&<p className="pm-review text-sm" data-testid="proxy-purchase-preview">Chi phí đã kiểm tra: {preview.purchase.quantity} proxy · {displayMoney(preview.purchase.total,preview.purchase.currency)} · {displayMoney(preview.purchase.usdt,'USDT')} · ghi một lần.</p>}
    {saved&&<p role="status" className="pm-success flex gap-2"><Check size={18}/>{saved}</p>}
    {preview&&!saved&&<div className="pm-review"><div className="flex gap-3 flex-wrap items-center mb-3 text-sm"><strong data-testid="preview-summary">{previewSummary(preview)}</strong>{preview.errors>0&&<button type="button" className="pm-button pm-button-quiet" onClick={()=>void copyRejected()}><Copy size={14}/>Copy {preview.errors} dòng bị từ chối</button>}{report?.copied&&<span className="pm-muted text-xs" role="status">Đã copy IP và lý do (không kèm user/pass)</span>}</div>
      {report&&!report.copied&&<label className="pm-label mb-3">Không truy cập được clipboard; copy thủ công<textarea readOnly className="pm-input pm-paste" rows={4} value={report.text}/></label>}
      <div className="max-h-60 overflow-auto"><table className="pm-table text-sm"><thead><tr><th>Dòng</th><th>Proxy</th><th>Kết quả</th></tr></thead><tbody>{preview.rows.map(r=>{const dup=isDuplicate(r);return <tr key={r.row}><td>{r.row}</td><td><div className="font-mono">{r.oldIp}{r.newIp&&r.oldIp?' → ':''}{r.newIp}{!r.oldIp&&!r.newIp&&<span className="pm-muted">(không đọc được)</span>}</div>{r.packageCode&&<div className="pm-muted text-xs mt-1">Gói {r.packageCode}</div>}{r.owner&&<div className="pm-muted text-xs mt-1">{r.owner==='GENJY'?(r.subgroup==='PC_CHUNG'?'Chung mooon–Genjy':'Genjy riêng'):r.owner==='SELF'?'TUT':r.owner==='OTHER'?(r.groupName||'Nhóm khác'):'Chưa xác định'}</div>}{r.existing&&<div className="pm-muted text-xs mt-1 flex gap-2 items-center flex-wrap">{r.existing.foreign?<span>Thuộc dự án khác</span>:r.existing.locations.length>0?<span>Đang ở {r.existing.locations.join(', ')}</span>:r.existing.state?<span>Chưa gán VM</span>:null}{!r.existing.foreign&&<button type="button" className="pm-button pm-button-quiet" aria-label={'Xem lịch sử '+(r.newIp||r.oldIp)} onClick={()=>setHistory(r.existing!.identityId)}><History size={13}/>Lịch sử</button>}</div>}{r.sourceRefs.length>0&&<div className="pm-muted text-xs mt-1 break-all">Nguồn: {r.sourceRefs.join(', ')}</div>}</td><td><span className={`pm-badge ${r.outcome==='ERROR'?(dup?'pm-badge-amber':'pm-badge-red'):'pm-badge-muted'}`}>{r.outcome==='READY'?'Hợp lệ':r.outcome==='SKIP'?'Giữ nguyên':dup?'Trùng':'Cần kiểm tra'}</span><p className="pm-muted mt-1 text-xs">{r.message}</p></td></tr>;})}</tbody></table></div></div>}
    {history&&<HistoryPanel projectId={projectId} identityId={history} onClose={()=>setHistory(null)}/>}
    <div className="flex justify-end gap-2 pt-2"><button className="pm-button" disabled={locked} onClick={onClose}>{saved?'Đóng':'Huỷ'}</button>{!saved&&<button className="pm-button pm-button-primary" disabled={busy||quantityReview||!uncertain&&moneyBlocked||!oldText.trim()||(!!preview&&!preview.ready)||(kind==='NEW'&&pkg.mode==='NEW'&&!pkg.code.trim())||(kind==='NEW'&&group.kind==='NEW'&&!group.name.trim())} onClick={preview?save:check}>{busy&&<Loader2 size={16} className="animate-spin"/>}{inspect.isLoading?'Đang kiểm tra…':commit.isLoading?'Đang lưu…':preview?`Lưu ${preview.ready} dòng hợp lệ`:'Kiểm tra và lưu'}</button>}</div>
  </DialogContent></Dialog>;
}
