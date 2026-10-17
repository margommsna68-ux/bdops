"use client";
import {useState} from 'react';
import toast from 'react-hot-toast';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {errorMessage} from '@/components/vm-management/shared';
type Preview=inferRouterOutputs<AppRouter>['accountStore']['importPreview'];
type Committed=inferRouterOutputs<AppRouter>['accountStore']['importCommit'];
export type StockKind='LOGIN'|'PAYPAL';
export type AppendTarget={id:string;code:string;type?:'GMAIL'|'APPLE_ID'|null};
const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
const CURRENCIES=['USDT','VND','USD'];
const trim=(n:string)=>n.includes('.')?n.replace(/\.?0+$/,''):n;
// Display only (the server computes the recorded total exactly).
const product=(qty:string,unit:string)=>{const q=Number(qty),u=Number(unit);return q>0&&Number.isInteger(q)&&u>0?trim((q*u).toFixed(8)):null;};
// Nhập kho in place (no dialog per account): paste many lines or fill one, choose the type explicitly, one preview table with
// every line (valid / already there / error), then one "Nhập N dòng hợp lệ".
// - Opened normally it is a NEW purchase: its own batch with a generated code, money entered as the total actually paid (or unit
//   price × quantity actually bought), recorded once in Chi phí.
// - Opened from a batch ("Nhập bổ sung") it continues that batch only, with no money; after an import with error lines the panel
//   switches to adding to the batch just created, so fixing them never records a second cost.
// - One command key per previewed request: a double click or a retry after a lost response replays it instead of buying twice.
export function ImportPanel({projectId,kind,append,canCost,onDone,onClose}:{projectId:string;kind:StockKind;append?:AppendTarget|null;canCost:boolean;onDone:()=>void;onClose:()=>void}){
  const [target,setTarget]=useState<AppendTarget|null>(append||null);
  const [type,setType]=useState<'GMAIL'|'APPLE_ID'|''>(append?.type||''),[mode,setMode]=useState<'paste'|'one'>('paste'),[text,setText]=useState(''),[one,setOne]=useState({email:'',password:'',twoFa:'',recovery:'',notes:'',code:''});
  const [source,setSource]=useState(''),[date,setDate]=useState(today()),[unitMode,setUnitMode]=useState(false),[amount,setAmount]=useState(''),[quantity,setQuantity]=useState(''),[currency,setCurrency]=useState('USDT'),[rate,setRate]=useState(''),[notes,setNotes]=useState('');
  const [preview,setPreview]=useState<Preview|null>(null),[done,setDone]=useState<Committed|null>(null),[error,setError]=useState(''),[key,setKey]=useState<string|null>(null);
  const check=trpc.accountStore.importPreview.useMutation(),commit=trpc.accountStore.importCommit.useMutation(),busy=check.isLoading||commit.isLoading;
  const lineText=()=>mode==='paste'?text:kind==='PAYPAL'?`${one.code.trim()}\t${one.email.trim()}`:[one.email,one.password,one.twoFa,one.recovery,one.notes].map(s=>s.replace(/\t/g,' ')).join('\t').replace(/\t+$/,'');
  const priced=canCost&&!!amount.trim();
  const input=()=>({projectId,kind,loginType:kind==='LOGIN'?(type||null):null,text:lineText(),
    ...(target?{append:{batchId:target.id}}:{batch:{source:source||null,purchasedAt:date,priceMode:priced?(unitMode?'UNIT' as const:'TOTAL' as const):'NONE' as const,amount:priced?amount:null,quantity:unitMode&&quantity.trim()?Number(quantity):null,currency:priced?currency:null,rate:priced&&currency!=='USDT'?rate||null:null,notes:notes||null}})});
  // Any change to what would be sent ends this request: the next preview gets a new key.
  const reset=()=>{setPreview(null);setDone(null);setError('');setKey(null);};
  async function runPreview(){setError('');setDone(null);try{setPreview(await check.mutateAsync(input()));setKey(crypto.randomUUID());}catch(e){setError(errorMessage(e));setPreview(null);}}
  async function runCommit(){
    if(!preview||!key||commit.isLoading)return;setError('');
    try{const r=await commit.mutateAsync({...input(),key});setDone(r);setPreview(null);setKey(null);onDone();
      toast.success(`Đã nhập ${r.applied} dòng vào lô ${r.batch.code}`+(r.errors?` · ${r.errors} dòng lỗi`:''));
      const bad=new Set(r.rows.filter(x=>x.outcome==='ERROR').map(x=>x.line));
      if(mode==='paste')setText(text.replace(/\r/g,'').split('\n').filter((_,i)=>bad.has(i+1)).join('\n'));else if(!bad.size)setOne({email:'',password:'',twoFa:'',recovery:'',notes:'',code:''});
      // Error lines left: the purchase is recorded, fixing them continues this batch (no money fields, no second cost).
      if(bad.size&&!target)setTarget({id:r.batch.id,code:r.batch.code,type:type||null});
      setAmount('');setQuantity('');setRate('');
    }catch(e){setError(errorMessage(e)+' · Bấm lại để thử: cùng yêu cầu không nhập hay ghi chi phí hai lần.');}
  }
  const ready=preview?.ready||0,total=unitMode?product(quantity,amount):null;
  const field=(set:(v:string)=>void)=>(e:{target:{value:string}})=>{set(e.target.value);reset();};
  return <section className="acc-import" aria-label="Nhập kho">
    <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="text-base font-semibold">{target?<>Nhập bổ sung vào lô <span className="pm-code">{target.code}</span></>:kind==='PAYPAL'?'Nhập PayPal · lần mua mới':'Nhập Gmail / Apple ID · lần mua mới'}</h2>
      <div className="vm-kind-tabs" role="tablist"><button type="button" role="tab" aria-selected={mode==='paste'} className={mode==='paste'?'active':''} onClick={()=>{setMode('paste');reset();}}>Dán danh sách</button><button type="button" role="tab" aria-selected={mode==='one'} className={mode==='one'?'active':''} onClick={()=>{setMode('one');reset();}}>Một tài khoản</button></div></div>
    {target&&<p className="text-xs pm-muted">Thêm tài khoản còn thiếu của lô này; không ghi tiền mua thêm. <button type="button" className="underline" disabled={busy} onClick={()=>{setTarget(null);reset();}}>Đây là lần mua mới</button></p>}
    {kind==='LOGIN'&&<div className="flex gap-2 items-center flex-wrap" role="radiogroup" aria-label="Loại tài khoản"><span className="text-sm">Loại:</span>{(['GMAIL','APPLE_ID'] as const).map(t=><button key={t} type="button" role="radio" aria-checked={type===t} className={'pm-button'+(type===t?' pm-button-primary':'')} disabled={busy||!!target?.type} onClick={()=>{setType(t);reset();}}>{t==='GMAIL'?'Gmail':'Apple ID'}</button>)}<span className="pm-muted text-xs">Chọn rõ loại; web không đoán từ đuôi email.</span></div>}
    {mode==='paste'?<><textarea className="pm-input pm-paste" rows={6} aria-label="Danh sách tài khoản" disabled={busy} value={text} onChange={field(setText)} placeholder={kind==='PAYPAL'?'tut-09 | pp09@example.invalid\ntut-10 | pp10@example.invalid':'acc01@example.invalid | mật khẩu | 2FA | email khôi phục | ghi chú'}/>
      <p className="pm-muted text-xs">{kind==='PAYPAL'?'Mỗi dòng một PayPal: Mã PP | Email nhận tiền. Không cần mật khẩu, 2FA, ngân hàng hay giấy tờ.':'Mỗi dòng: Tài khoản | Mật khẩu | 2FA | Email khôi phục | Ghi chú (tab, | hoặc :). Các cột sau tài khoản có thể bỏ trống.'}</p></>
      :<div className="acc-import-grid">{kind==='PAYPAL'?<><label className="pm-label">Mã PP<input className="pm-input" value={one.code} onChange={e=>{setOne({...one,code:e.target.value});reset();}}/></label><label className="pm-label">Email nhận tiền<input className="pm-input" value={one.email} onChange={e=>{setOne({...one,email:e.target.value});reset();}}/></label></>
        :<><label className="pm-label">Tài khoản (email)<input className="pm-input" value={one.email} onChange={e=>{setOne({...one,email:e.target.value});reset();}}/></label><label className="pm-label">Mật khẩu<input type="password" autoComplete="new-password" className="pm-input" value={one.password} onChange={e=>{setOne({...one,password:e.target.value});reset();}}/></label><label className="pm-label">2FA<input type="password" autoComplete="off" className="pm-input" value={one.twoFa} onChange={e=>{setOne({...one,twoFa:e.target.value});reset();}}/></label><label className="pm-label">Email khôi phục<input className="pm-input" value={one.recovery} onChange={e=>{setOne({...one,recovery:e.target.value});reset();}}/></label><label className="pm-label">Ghi chú<input className="pm-input" value={one.notes} onChange={e=>{setOne({...one,notes:e.target.value});reset();}}/></label></>}</div>}
    {!target&&<div className="acc-import-grid">
      <label className="pm-label">Nguồn mua<input className="pm-input" value={source} maxLength={200} disabled={busy} placeholder="Shop / người bán" onChange={field(setSource)}/></label>
      <label className="pm-label">Ngày mua<input type="date" className="pm-input" value={date} disabled={busy} onChange={field(setDate)}/></label>
      {canCost&&(unitMode?<>
        <label className="pm-label">Số lượng thực mua<input className="pm-input" inputMode="numeric" value={quantity} disabled={busy} placeholder="Số tài khoản đã trả tiền" onChange={e=>{setQuantity(e.target.value.replace(/\D/g,''));reset();}}/></label>
        <label className="pm-label">Giá / tài khoản<input className="pm-input" inputMode="decimal" value={amount} disabled={busy} onChange={e=>{setAmount(e.target.value.replace(',','.'));reset();}}/></label></>
        :<label className="pm-label">Tổng tiền thực trả<input className="pm-input" inputMode="decimal" value={amount} disabled={busy} placeholder="Để trống nếu chưa có giá" onChange={e=>{setAmount(e.target.value.replace(',','.'));reset();}}/></label>)}
      {priced&&<label className="pm-label">Đồng tiền<select className="pm-input" value={currency} disabled={busy} onChange={field(setCurrency)}>{CURRENCIES.map(c=><option key={c}>{c}</option>)}</select></label>}
      {priced&&currency!=='USDT'&&<label className="pm-label">Tỷ giá: 1 USDT = ? {currency}<input className="pm-input" inputMode="decimal" value={rate} disabled={busy} onChange={e=>{setRate(e.target.value.replace(',','.'));reset();}}/></label>}
      <label className="pm-label">Ghi chú lô<input className="pm-input" value={notes} maxLength={1000} disabled={busy} onChange={field(setNotes)}/></label>
    </div>}
    {!target&&canCost&&<p className="text-xs pm-muted">{unitMode?<><span aria-live="polite">{total?<><strong>{quantity} × {trim(amount)} = {total} {currency}</strong> ghi một lần vào Chi phí. </>:'Nhập số lượng thực mua và giá mỗi tài khoản. '}</span><button type="button" className="underline" disabled={busy} onClick={()=>{setUnitMode(false);setQuantity('');reset();}}>Nhập tổng tiền</button></>
      :<>{priced?'Ghi một lần vào Chi phí, không đổi theo số dòng nhập được. ':'Không nhập tiền: lô ghi Chưa ghi chi phí. '}<button type="button" className="underline" disabled={busy} onClick={()=>{setUnitMode(true);reset();}}>Tính theo giá mỗi tài khoản</button></>}</p>}
    {!target&&!canCost&&<p className="pm-muted text-xs">Lô nhập ghi Chưa ghi chi phí. Người có quyền Chi phí ghi tiền thực trả sau ở tab Lô nhập (một lần).</p>}
    {preview&&<>
      <p className="text-sm"><strong>{preview.ready}</strong> hợp lệ · {preview.exists} đã có · <span className={preview.errors?'text-red-600':''}>{preview.errors} lỗi</span> · {preview.batch.existing?<>Vào lô <strong>{preview.batch.code}</strong>, {preview.batch.cost==='RECORDED'?'chi phí đã ghi, không ghi thêm':'chưa ghi chi phí (ghi ở tab Lô nhập)'}.</>:<>Lô mới <strong>{preview.batch.code}</strong>{preview.batch.total?<> · chi phí ghi một lần: <strong>{trim(preview.batch.total.amount)} {preview.batch.total.currency}</strong> ≈ {trim(preview.batch.total.usdt)} USDT{preview.batch.total.unit&&preview.batch.total.quantity?` (${preview.batch.total.quantity} × ${trim(preview.batch.total.unit)})`:''}.</>:preview.batch.cost==='WILL_RECORD'?' · chi phí ghi một lần.':' · Chưa ghi chi phí.'}</>}</p>
      <div className="vm-bulk-table"><table className="pm-table"><thead><tr><th>Dòng</th><th>{kind==='PAYPAL'?'Mã PP · Email':'Tài khoản'}</th>{kind==='LOGIN'&&<th>Có</th>}<th>Kết quả</th></tr></thead><tbody>{preview.rows.map(r=><tr key={r.line} className={r.outcome==='ERROR'?'pm-row-blocked':''}><td className="pm-muted">{r.line}</td><td className="whitespace-nowrap">{r.account}{kind==='PAYPAL'&&<span className="pm-muted"> · {r.email}</span>}</td>
        {kind==='LOGIN'&&<td className="text-xs pm-muted whitespace-nowrap">{[r.hasPassword&&'mật khẩu',r.has2fa&&'2FA',r.hasRecovery&&'khôi phục'].filter(Boolean).join(', ')||'—'}</td>}
        <td className={r.outcome==='ERROR'?'text-red-600':r.outcome==='EXISTS'?'pm-muted':'text-green-700'}>{r.outcome==='READY'?'Hợp lệ':r.outcome==='EXISTS'?'Đã có':'Lỗi'} · {r.message}</td></tr>)}</tbody></table></div></>}
    {done&&<p role="status" className="pm-success text-sm">Đã nhập {done.applied} · đã có {done.exists} · lỗi {done.errors} vào lô {done.batch.code}{done.batch.appended?' (nhập bổ sung, không ghi chi phí thêm)':done.batch.costRecorded?' (chi phí đã ghi một lần)':' (chưa ghi chi phí)'}. {done.errors?'Ô dán chỉ còn các dòng lỗi; sửa rồi nhập bổ sung vào cùng lô.':''}</p>}
    {error&&<p role="alert" className="pm-error text-sm">{error}</p>}
    <div className="flex gap-2 justify-end flex-wrap"><button type="button" className="pm-button pm-button-quiet" disabled={busy} onClick={onClose}>Đóng</button>
      {preview&&ready>0?<><button type="button" className="pm-button" disabled={busy} onClick={reset}>Sửa lại</button><button type="button" className="pm-button pm-button-primary" disabled={busy} onClick={()=>void runCommit()}>{busy?'Đang nhập…':`Nhập ${ready} dòng hợp lệ`}</button></>
        :<button type="button" className="pm-button pm-button-primary" disabled={busy||!lineText().trim()||kind==='LOGIN'&&!type} onClick={()=>void runPreview()}>{busy?'Đang kiểm tra…':kind==='LOGIN'&&!type?'Chọn Gmail hoặc Apple ID':'Xem trước'}</button>}</div>
  </section>;
}
