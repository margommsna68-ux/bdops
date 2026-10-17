"use client";
import {useEffect,useState} from 'react';
import toast from 'react-hot-toast';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {errorMessage} from '@/components/vm-management/shared';
type Preview=inferRouterOutputs<AppRouter>['accountStore']['importPreview'];
type Committed=inferRouterOutputs<AppRouter>['accountStore']['importCommit'];
export type StockKind='LOGIN'|'PAYPAL';
const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const CURRENCIES=['USDT','VND','USD'];
// Nhập kho in place (no dialog per account): paste many lines or fill one, choose the type explicitly, one preview table with
// every line (valid / already there / error), then one "Nhập N dòng hợp lệ". The batch carries the purchase: price per account or
// the total actually paid, recorded once in Chi phí. Error lines stay in the box to fix and import into the same batch.
export function ImportPanel({projectId,kind,batchCode,canCost,onDone,onClose}:{projectId:string;kind:StockKind;batchCode?:string;canCost:boolean;onDone:()=>void;onClose:()=>void}){
  const [type,setType]=useState<'GMAIL'|'APPLE_ID'|''>(''),[mode,setMode]=useState<'paste'|'one'>('paste'),[text,setText]=useState(''),[one,setOne]=useState({email:'',password:'',twoFa:'',recovery:'',notes:'',code:''});
  const [code,setCode]=useState(batchCode||''),[source,setSource]=useState(''),[date,setDate]=useState(today()),[price,setPrice]=useState<'NONE'|'UNIT'|'TOTAL'>('NONE'),[amount,setAmount]=useState(''),[currency,setCurrency]=useState('USDT'),[rate,setRate]=useState(''),[notes,setNotes]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null),[done,setDone]=useState<Committed|null>(null),[error,setError]=useState('');
  const check=trpc.accountStore.importPreview.useMutation(),commit=trpc.accountStore.importCommit.useMutation(),busy=check.isLoading||commit.isLoading;
  useEffect(()=>{if(!batchCode&&!code)setCode((kind==='PAYPAL'?'PP':'TK')+'-'+today());},[batchCode,code,kind]);
  const lineText=()=>mode==='paste'?text:kind==='PAYPAL'?`${one.code.trim()}\t${one.email.trim()}`:[one.email,one.password,one.twoFa,one.recovery,one.notes].map(s=>s.replace(/\t/g,' ')).join('\t').replace(/\t+$/,'');
  const input=()=>({projectId,kind,loginType:kind==='LOGIN'?(type||null):null,text:lineText(),batch:{code,source:source||null,purchasedAt:date,priceMode:canCost?price:'NONE' as const,amount:amount||null,currency,rate:currency==='USDT'?null:rate||null,notes:notes||null}});
  const reset=()=>{setPreview(null);setDone(null);setError('');};
  async function runPreview(){setError('');setDone(null);try{setPreview(await check.mutateAsync(input()));}catch(e){setError(errorMessage(e));setPreview(null);}}
  async function runCommit(){
    if(!preview)return;setError('');
    try{const r=await commit.mutateAsync({...input(),key:crypto.randomUUID()});setDone(r);onDone();
      toast.success(`Đã nhập ${r.applied} dòng`+(r.errors?` · ${r.errors} dòng lỗi`:''));
      // Keep only the error lines to fix; the batch now exists, so a retry continues it without a second cost.
      const bad=new Set(r.rows.filter(x=>x.outcome==='ERROR').map(x=>x.line));
      if(mode==='paste')setText(text.replace(/\r/g,'').split('\n').filter((_,i)=>bad.has(i+1)).join('\n'));else if(!bad.size)setOne({email:'',password:'',twoFa:'',recovery:'',notes:'',code:''});
      setPreview(null);setPrice('NONE');
    }catch(e){setError(errorMessage(e));}
  }
  const existing=preview?.batch.existing,ready=preview?.ready||0;
  return <section className="acc-import" aria-label="Nhập kho">
    <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="text-base font-semibold">{kind==='PAYPAL'?'Nhập PayPal':'Nhập Gmail / Apple ID'}</h2>
      <div className="vm-kind-tabs" role="tablist"><button type="button" role="tab" aria-selected={mode==='paste'} className={mode==='paste'?'active':''} onClick={()=>{setMode('paste');reset();}}>Dán danh sách</button><button type="button" role="tab" aria-selected={mode==='one'} className={mode==='one'?'active':''} onClick={()=>{setMode('one');reset();}}>Một tài khoản</button></div></div>
    {kind==='LOGIN'&&<div className="flex gap-2 items-center flex-wrap" role="radiogroup" aria-label="Loại tài khoản"><span className="text-sm">Loại:</span>{(['GMAIL','APPLE_ID'] as const).map(t=><button key={t} type="button" role="radio" aria-checked={type===t} className={'pm-button'+(type===t?' pm-button-primary':'')} disabled={busy} onClick={()=>{setType(t);reset();}}>{t==='GMAIL'?'Gmail':'Apple ID'}</button>)}<span className="pm-muted text-xs">Chọn rõ loại; web không đoán từ đuôi email.</span></div>}
    {mode==='paste'?<><textarea className="pm-input pm-paste" rows={6} aria-label="Danh sách tài khoản" disabled={busy} value={text} onChange={e=>{setText(e.target.value);reset();}} placeholder={kind==='PAYPAL'?'tut-09 | pp09@example.invalid\ntut-10 | pp10@example.invalid':'acc01@example.invalid | mật khẩu | 2FA | email khôi phục | ghi chú'}/>
      <p className="pm-muted text-xs">{kind==='PAYPAL'?'Mỗi dòng một PayPal: Mã PP | Email nhận tiền. Không cần mật khẩu, 2FA, ngân hàng hay giấy tờ. Số lượng tự đếm từ danh sách.':'Mỗi dòng: Tài khoản | Mật khẩu | 2FA | Email khôi phục | Ghi chú (tab, | hoặc :). Các cột sau tài khoản có thể bỏ trống.'}</p></>
      :<div className="acc-import-grid">{kind==='PAYPAL'?<><label className="pm-label">Mã PP<input className="pm-input" value={one.code} onChange={e=>{setOne({...one,code:e.target.value});reset();}}/></label><label className="pm-label">Email nhận tiền<input className="pm-input" value={one.email} onChange={e=>{setOne({...one,email:e.target.value});reset();}}/></label></>
        :<><label className="pm-label">Tài khoản (email)<input className="pm-input" value={one.email} onChange={e=>{setOne({...one,email:e.target.value});reset();}}/></label><label className="pm-label">Mật khẩu<input type="password" autoComplete="new-password" className="pm-input" value={one.password} onChange={e=>{setOne({...one,password:e.target.value});reset();}}/></label><label className="pm-label">2FA<input type="password" autoComplete="off" className="pm-input" value={one.twoFa} onChange={e=>{setOne({...one,twoFa:e.target.value});reset();}}/></label><label className="pm-label">Email khôi phục<input className="pm-input" value={one.recovery} onChange={e=>{setOne({...one,recovery:e.target.value});reset();}}/></label><label className="pm-label">Ghi chú<input className="pm-input" value={one.notes} onChange={e=>{setOne({...one,notes:e.target.value});reset();}}/></label></>}</div>}
    <div className="acc-import-grid">
      <label className="pm-label">Lô nhập<input className="pm-input" value={code} maxLength={60} disabled={busy} onChange={e=>{setCode(e.target.value);reset();}}/></label>
      <label className="pm-label">Nguồn mua<input className="pm-input" value={source} maxLength={200} disabled={busy||!!existing} placeholder="Shop / người bán" onChange={e=>{setSource(e.target.value);reset();}}/></label>
      <label className="pm-label">Ngày mua<input type="date" className="pm-input" value={date} disabled={busy||!!existing} onChange={e=>{setDate(e.target.value);reset();}}/></label>
      <label className="pm-label">Ghi chú lô<input className="pm-input" value={notes} maxLength={1000} disabled={busy||!!existing} onChange={e=>{setNotes(e.target.value);reset();}}/></label>
      {canCost&&!existing&&<label className="pm-label">Tiền mua<select className="pm-input" value={price} disabled={busy} onChange={e=>{setPrice(e.target.value as typeof price);reset();}}><option value="NONE">Chưa có giá (Chưa ghi chi phí)</option><option value="UNIT">Giá mỗi tài khoản</option><option value="TOTAL">Tổng tiền thực trả của lô</option></select></label>}
      {canCost&&!existing&&price!=='NONE'&&<><label className="pm-label">{price==='UNIT'?'Giá / tài khoản':'Tổng đã trả'}<input className="pm-input" inputMode="decimal" value={amount} disabled={busy} onChange={e=>{setAmount(e.target.value.replace(',','.'));reset();}}/></label>
        <label className="pm-label">Đồng tiền<select className="pm-input" value={currency} disabled={busy} onChange={e=>{setCurrency(e.target.value);reset();}}>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label>
        {currency!=='USDT'&&<label className="pm-label">Tỷ giá: 1 USDT = ? {currency}<input className="pm-input" inputMode="decimal" value={rate} disabled={busy} onChange={e=>{setRate(e.target.value.replace(',','.'));reset();}}/></label>}</>}
    </div>
    {!canCost&&<p className="pm-muted text-xs">Lô nhập ghi Chưa ghi chi phí. Người có quyền Chi phí ghi tiền thực trả sau ở tab Lô nhập (một lần).</p>}
    {preview&&<>
      <p className="text-sm"><strong>{preview.ready}</strong> hợp lệ · {preview.exists} đã có · <span className={preview.errors?'text-red-600':''}>{preview.errors} lỗi</span> · {existing?<>Lô <strong>{preview.batch.code}</strong> đã có: nhập tiếp, {preview.batch.cost==='RECORDED'?'chi phí đã ghi, không ghi thêm':'chưa ghi chi phí (ghi ở tab Lô nhập)'}.</>:preview.batch.total?<>Chi phí ghi một lần: <strong>{preview.batch.total.amount.replace(/\.?0+$/,'')} {preview.batch.total.currency}</strong> ≈ {preview.batch.total.usdt.replace(/\.?0+$/,'')} USDT{preview.batch.total.unit?` (${preview.batch.total.lines} dòng × ${preview.batch.total.unit.replace(/\.?0+$/,'')})`:''}.</>:'Chưa ghi chi phí.'}</p>
      <div className="vm-bulk-table"><table className="pm-table"><thead><tr><th>Dòng</th><th>{kind==='PAYPAL'?'Mã PP · Email':'Tài khoản'}</th>{kind==='LOGIN'&&<th>Có</th>}<th>Kết quả</th></tr></thead><tbody>{preview.rows.map(r=><tr key={r.line} className={r.outcome==='ERROR'?'pm-row-blocked':''}><td className="pm-muted">{r.line}</td><td className="whitespace-nowrap">{r.account}{kind==='PAYPAL'&&<span className="pm-muted"> · {r.email}</span>}</td>
        {kind==='LOGIN'&&<td className="text-xs pm-muted whitespace-nowrap">{[r.hasPassword&&'mật khẩu',r.has2fa&&'2FA',r.hasRecovery&&'khôi phục'].filter(Boolean).join(', ')||'—'}</td>}
        <td className={r.outcome==='ERROR'?'text-red-600':r.outcome==='EXISTS'?'pm-muted':'text-green-700'}>{r.outcome==='READY'?'Hợp lệ':r.outcome==='EXISTS'?'Đã có':'Lỗi'} · {r.message}</td></tr>)}</tbody></table></div></>}
    {done&&<p role="status" className="pm-success text-sm">Đã nhập {done.applied} · đã có {done.exists} · lỗi {done.errors} vào lô {done.batch.code}{done.batch.costRecorded?' (chi phí đã ghi một lần)':' (chưa ghi chi phí)'}. {done.errors?'Ô dán chỉ còn các dòng lỗi; sửa rồi nhập tiếp vào cùng lô.':''}</p>}
    {error&&<p role="alert" className="pm-error text-sm">{error}</p>}
    <div className="flex gap-2 justify-end flex-wrap"><button type="button" className="pm-button pm-button-quiet" disabled={busy} onClick={onClose}>Đóng</button>
      {preview&&ready>0?<><button type="button" className="pm-button" disabled={busy} onClick={reset}>Sửa lại</button><button type="button" className="pm-button pm-button-primary" disabled={busy} onClick={()=>void runCommit()}>{busy?'Đang nhập…':`Nhập ${ready} dòng hợp lệ`}</button></>
        :<button type="button" className="pm-button pm-button-primary" disabled={busy||!lineText().trim()||kind==='LOGIN'&&!type||!code.trim()} onClick={()=>void runPreview()}>{busy?'Đang kiểm tra…':kind==='LOGIN'&&!type?'Chọn Gmail hoặc Apple ID':'Xem trước'}</button>}</div>
  </section>;
}
