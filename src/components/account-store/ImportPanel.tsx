"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import toast from 'react-hot-toast';
import type {inferRouterOutputs} from '@trpc/server';
import type {AppRouter} from '@/server/routers/_app';
import {trpc} from '@/lib/trpc';
import {errorMessage} from '@/components/vm-management/shared';
import {PurchaseMoneyFields,useQuoteExpiry} from './PurchaseMoneyFields';
import {emptyPurchase,readPurchase,type PurchaseState} from './purchase-money';
import {formatMoney} from '@/lib/money-input';
type Preview=inferRouterOutputs<AppRouter>['accountStore']['importPreview'];
type Committed=inferRouterOutputs<AppRouter>['accountStore']['importCommit'];
export type StockKind='LOGIN'|'PAYPAL';
export type AppendTarget={id:string;code:string;type?:'GMAIL'|'APPLE_ID'|null};
const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
// Drafts per project and account kind, in this tab's memory only (never the URL, localStorage or sessionStorage: a draft can hold
// passwords and 2FA). Switching Gmail ↔ PayPal, opening Lịch sử nhập kho or leaving the page and coming back keeps each kind's own
// draft (text, money, preview); another project has its own. A full reload or closing the tab drops them.
export type ImportDraft={open:boolean;nonce:number;values:Record<string,unknown>};
const drafts=new Map<string,ImportDraft>();
export function importDraft(projectId:string,kind:StockKind):ImportDraft{const k=projectId+':'+kind;let d=drafts.get(k);if(!d){d={open:false,nonce:0,values:{}};drafts.set(k,d);}return d;}
// Continue one purchase (Nhập bổ sung): the draft's target becomes that batch (its type), and the previous preview is dropped.
export function appendToBatch(d:ImportDraft,target:AppendTarget){const {text,one,mode}=d.values;d.values={text,one,mode,target,type:target.type||undefined};d.nonce++;}
export function discardDraft(d:ImportDraft){d.values={};d.nonce++;}
function useDraft<T>(d:ImportDraft,name:string,initial:T):[T,(v:T)=>void]{
  const [value,setValue]=useState<T>(()=>name in d.values&&d.values[name]!==undefined?d.values[name] as T:initial);
  const set=useCallback((v:T)=>{d.values[name]=v;setValue(v);},[d,name]);
  return [value,set];
}
// Nhập kho in place (no dialog per account): paste many lines or fill one, choose the type explicitly. The lines are checked
// automatically while typing (the check writes nothing; a result that no longer matches the text is never used), every line shows
// valid / already there / error, then one "Nhập". The server checks everything again when saving.
// - PayPal: "Mã PP email1 email2 …"; a code with several emails is one PayPal. A code already in stock with new emails is shown
//   with "Bổ sung email" (into that PayPal, no purchase, no cost).
// - A save whose answer was lost keeps its key and freezes the content until it is retried with the same key or checked again.
// - Opened normally it is a NEW purchase: its own batch with a generated code, money entered as the total actually paid (or unit
//   price × quantity actually bought), recorded once in Chi phí.
// - Opened from a batch ("Nhập bổ sung") it continues that batch only, with no money; after an import with error lines the panel
//   switches to adding to the batch just created, so fixing them never records a second cost.
// - One command key per previewed request: a double click or a retry after a lost response replays it instead of buying twice.
export function ImportPanel({projectId,kind,canCost,onDone,onClose,onDiscard}:{projectId:string;kind:StockKind;canCost:boolean;onDone:()=>void;onClose:()=>void;onDiscard:()=>void}){
  const d=importDraft(projectId,kind);
  const [target,setTarget]=useDraft<AppendTarget|null>(d,'target',null);
  const [type,setType]=useDraft<'GMAIL'|'APPLE_ID'|''>(d,'type',''),[mode,setMode]=useDraft<'paste'|'one'>(d,'mode','paste'),[text,setText]=useDraft(d,'text',''),[one,setOne]=useDraft(d,'one',{email:'',password:'',twoFa:'',recovery:'',notes:'',code:'',twoFaLink:'',smsLink:'',phone:''}),[format,setFormat]=useDraft<'APPLE5'|'STANDARD'>(d,'format','APPLE5');
  const [source,setSource]=useDraft(d,'source',''),[date,setDate]=useDraft(d,'date',today()),[money,setMoney]=useDraft<PurchaseState>(d,'money',emptyPurchase()),[notes,setNotes]=useDraft(d,'notes','');
  const [preview,setPreview]=useDraft<Preview|null>(d,'preview',null),[done,setDone]=useDraft<Committed|null>(d,'done',null),[error,setError]=useDraft(d,'error',''),[key,setKey]=useDraft<string|null>(d,'key',null);
  const [checkedSig,setCheckedSig]=useDraft(d,'checkedSig',''),[keySig,setKeySig]=useDraft(d,'keySig',''),[uncertain,setUncertain]=useDraft(d,'uncertain',false),[recheck,setRecheck]=useState(0),[checkError,setCheckError]=useState('');
  const check=trpc.accountStore.importPreview.useMutation(),commit=trpc.accountStore.importCommit.useMutation(),addEmails=trpc.accountStore.addEmails.useMutation(),busy=commit.isLoading,locked=commit.isLoading||uncertain;
  // Apple ID (20/10/2026): the list as bought, Email | Mật khẩu | Link lấy 2FA | Link SMS | Số điện thoại; the older pattern stays as a
  // secondary option. Gmail keeps its pattern. The type is chosen by the person, never read from the email domain.
  const apple5=kind==='LOGIN'&&type==='APPLE_ID'&&format==='APPLE5';
  const lineText=()=>mode==='paste'?text:kind==='PAYPAL'?`${one.code.trim()}\t${one.email.trim()}`:(apple5?[one.email,one.password,one.twoFaLink||'',one.smsLink||'',one.phone||'']:[one.email,one.password,one.twoFa,one.recovery,one.notes]).map(s=>s.replace(/\t/g,' ')).join('\t').replace(/\t+$/,'');
  // Money: canonical numbers only (the typed Vietnamese text is parsed once in readPurchase); a money field with an error blocks the
  // check and Nhập instead of sending something the server could read differently.
  useQuoteExpiry(money.quote);
  const unitWord=kind==='PAYPAL'?'PP':'tài khoản',m=readPurchase(money,unitWord),priced=canCost&&m.priced,moneyBlocked=priced&&!m.payload;
  const input=()=>({projectId,kind,loginType:kind==='LOGIN'?(type||null):null,loginFormat:kind==='LOGIN'&&type==='APPLE_ID'?format:null,text:lineText(),
    ...(target?{append:{batchId:target.id}}:{batch:{source:source||null,purchasedAt:date,...(priced&&m.payload?m.payload:{priceMode:'NONE' as const,amount:null,quantity:canCost?m.payload?.quantity??null:null,currency:null,rate:null,p2pQuoteToken:null}),notes:notes||null}})});
  // What would be sent now. The check result and the request key belong to exactly this content.
  const sig=JSON.stringify(input()),empty=!lineText().trim()||kind==='LOGIN'&&!type,fresh=!!preview&&checkedSig===sig&&!moneyBlocked,seq=useRef(0);
  useEffect(()=>{
    if(uncertain)return;setCheckError('');
    if(empty||moneyBlocked){if(preview)setPreview(null);seq.current++;return;}
    const n=++seq.current,timer=setTimeout(async()=>{
      try{const r=await check.mutateAsync(JSON.parse(sig));if(n!==seq.current)return;setPreview(r);setCheckedSig(sig);if(keySig!==sig){setKey(crypto.randomUUID());setKeySig(sig);}}
      catch(e){if(n===seq.current){setPreview(null);setCheckError(errorMessage(e));}}
    },400);
    return ()=>clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[sig,recheck,uncertain,moneyBlocked]);
  const reset=()=>{setDone(null);setError('');};
  async function runCommit(){
    // A retry after a lost answer sends exactly the content of the first attempt with its key (never re-read from the fields).
    const body=uncertain?keySig:sig;if(!uncertain&&!fresh||!key||!body||commit.isLoading)return;setError('');
    try{const r=await commit.mutateAsync({...JSON.parse(body),key});setDone(r);setPreview(null);setKey(null);setKeySig('');setUncertain(false);onDone();
      toast.success(kind==='PAYPAL'?`Đã nhập ${r.applied} PP (${r.emails} email) vào lô ${r.batch.code}`+(r.errors?` · ${r.errors} dòng cần sửa`:''):`Đã nhập ${r.applied} dòng vào lô ${r.batch.code}`+(r.errors?` · ${r.errors} dòng lỗi`:''));
      // The editor keeps only what is not saved: lines to fix, and codes that wait for "Bổ sung email".
      const keep=new Set(r.rows.filter(x=>x.outcome==='ERROR'||x.outcome==='ADD').map(x=>x.line));
      if(mode==='paste')setText(text.replace(/\r/g,'').split('\n').filter((_,i)=>keep.has(i+1)).join('\n'));else if(!keep.size)setOne({email:'',password:'',twoFa:'',recovery:'',notes:'',code:'',twoFaLink:'',smsLink:'',phone:''});
      // Error lines left: the purchase is recorded, fixing them continues this batch (no money fields, no second cost).
      if(r.errors&&!target)setTarget({id:r.batch.id,code:r.batch.code,type:type||null});
      setMoney(emptyPurchase());
    }catch(e){setUncertain(true);setError(errorMessage(e)+' · Chưa rõ đã lưu hay chưa. Bấm "Thử lại" (cùng yêu cầu, không nhập hay ghi chi phí hai lần) hoặc "Kiểm tra lại" để xem kho trước.');}
  }
  async function addTo(row:{existingId:string|null;account:string;newEmails?:string[]}){
    if(!row.existingId||!row.newEmails?.length)return;
    try{const r=await addEmails.mutateAsync({projectId,paypalId:row.existingId,emails:row.newEmails,key:crypto.randomUUID()});toast.success(`Đã bổ sung ${r.applied} email vào ${r.code}`+(r.errors?` · ${r.errors} email bị chặn`:''));onDone();setRecheck(n=>n+1);}
    catch(e){toast.error(errorMessage(e));}
  }
  const ready=preview?.ready||0;
  const field=(set:(v:string)=>void)=>(e:{target:{value:string}})=>{set(e.target.value);reset();};
  const counts=preview as (Preview&{add?:number;emails?:number})|null;
  return <section className="acc-import" aria-label={kind==='PAYPAL'?'Nhập PayPal':'Nhập Gmail / Apple ID'} data-kind={kind}>
    <div className="flex items-center justify-between gap-2 flex-wrap"><h2 className="text-base font-semibold">{target?<>Nhập bổ sung vào lô <span className="pm-code">{target.code}</span></>:kind==='PAYPAL'?'Nhập PayPal · lần mua mới':'Nhập Gmail / Apple ID · lần mua mới'}</h2>
      <div className="vm-kind-tabs" role="tablist"><button type="button" role="tab" aria-selected={mode==='paste'} className={mode==='paste'?'active':''} onClick={()=>{setMode('paste');reset();}}>Dán danh sách</button><button type="button" role="tab" aria-selected={mode==='one'} className={mode==='one'?'active':''} onClick={()=>{setMode('one');reset();}}>Một tài khoản</button></div></div>
    {target&&<p className="text-xs pm-muted">Thêm tài khoản còn thiếu của lô này; không ghi tiền mua thêm. <button type="button" className="underline" disabled={locked} onClick={()=>{setTarget(null);reset();}}>Đây là lần mua mới</button></p>}
    {kind==='LOGIN'&&<div className="flex gap-2 items-center flex-wrap" role="radiogroup" aria-label="Loại tài khoản"><span className="text-sm">Loại:</span>{(['GMAIL','APPLE_ID'] as const).map(t=><button key={t} type="button" role="radio" aria-checked={type===t} className={'pm-button'+(type===t?' pm-button-primary':'')} disabled={locked||!!target?.type} onClick={()=>{setType(t);reset();}}>{t==='GMAIL'?'Gmail':'Apple ID'}</button>)}<span className="pm-muted text-xs">Chọn rõ loại; web không đoán từ đuôi email.</span>
      {type==='APPLE_ID'&&<label className="flex items-center gap-1 text-xs pm-muted ml-auto"><input type="checkbox" checked={format==='STANDARD'} disabled={locked} onChange={e=>{setFormat(e.target.checked?'STANDARD':'APPLE5');reset();}}/>Mẫu cũ (Tài khoản | Mật khẩu | 2FA | Email khôi phục | Ghi chú)</label>}</div>}
    {mode==='paste'?<><textarea className="pm-input pm-paste" rows={6} aria-label="Danh sách tài khoản" disabled={locked} value={text} onChange={field(setText)} placeholder={kind==='PAYPAL'?'pp-13 a13@example.invalid b13@example.invalid c13@example.invalid\npp-14 | a14@example.invalid':apple5?'apple01@example.invalid|Mật khẩu|https://…/2fa?id=…|https://…/sms/…|0123456789':'acc01@example.invalid | mật khẩu | 2FA | email khôi phục | ghi chú'}/>
      <p className="pm-muted text-xs">{kind==='PAYPAL'?'Mỗi dòng: Mã PP rồi các email nhận tiền (cách nhau bằng khoảng trắng, tab hoặc |). Một mã nhiều email là một PP; mã lặp ở nhiều dòng được gộp. Không cần mật khẩu, 2FA, ngân hàng hay giấy tờ.':apple5?'Mỗi dòng: Email | Mật khẩu | Link lấy 2FA | Link SMS | Số điện thoại (tab hoặc |, đúng thứ tự; ô trống giữ vị trí). Link và mật khẩu giữ nguyên chữ hoa / thường; số điện thoại giữ số 0 đầu và dấu +. Email đuôi gmail.com vẫn là Apple ID.':'Mỗi dòng: Tài khoản | Mật khẩu | 2FA | Email khôi phục | Ghi chú (tab, | hoặc :). Các cột sau tài khoản có thể bỏ trống.'}</p></>
      :<div className="acc-import-grid">{kind==='PAYPAL'?<><label className="pm-label">Mã PP<input className="pm-input" value={one.code} onChange={e=>{setOne({...one,code:e.target.value});reset();}}/></label><label className="pm-label">Email nhận tiền<input className="pm-input" value={one.email} onChange={e=>{setOne({...one,email:e.target.value});reset();}}/></label></>
        :apple5?<><label className="pm-label">Email Apple ID<input className="pm-input" value={one.email} onChange={e=>{setOne({...one,email:e.target.value});reset();}}/></label><label className="pm-label">Mật khẩu<input type="password" autoComplete="new-password" className="pm-input" value={one.password} onChange={e=>{setOne({...one,password:e.target.value});reset();}}/></label><label className="pm-label">Link lấy 2FA<input className="pm-input" placeholder="https://…" value={one.twoFaLink||''} onChange={e=>{setOne({...one,twoFaLink:e.target.value});reset();}}/></label><label className="pm-label">Link SMS<input className="pm-input" placeholder="https://…" value={one.smsLink||''} onChange={e=>{setOne({...one,smsLink:e.target.value});reset();}}/></label><label className="pm-label">Số điện thoại<input className="pm-input" inputMode="tel" value={one.phone||''} onChange={e=>{setOne({...one,phone:e.target.value});reset();}}/></label></>
        :<><label className="pm-label">Tài khoản (email)<input className="pm-input" value={one.email} onChange={e=>{setOne({...one,email:e.target.value});reset();}}/></label><label className="pm-label">Mật khẩu<input type="password" autoComplete="new-password" className="pm-input" value={one.password} onChange={e=>{setOne({...one,password:e.target.value});reset();}}/></label><label className="pm-label">2FA<input type="password" autoComplete="off" className="pm-input" value={one.twoFa} onChange={e=>{setOne({...one,twoFa:e.target.value});reset();}}/></label><label className="pm-label">Email khôi phục<input className="pm-input" value={one.recovery} onChange={e=>{setOne({...one,recovery:e.target.value});reset();}}/></label><label className="pm-label">Ghi chú<input className="pm-input" value={one.notes} onChange={e=>{setOne({...one,notes:e.target.value});reset();}}/></label></>}</div>}
    {!target&&<div className="acc-import-grid">
      <label className="pm-label">Nguồn mua<input className="pm-input" value={source} maxLength={200} disabled={locked} placeholder="Shop / người bán" onChange={field(setSource)}/></label>
      <label className="pm-label">Ngày mua<input type="date" className="pm-input" value={date} disabled={locked} onChange={field(setDate)}/></label>
      <label className="pm-label">Ghi chú lô<input className="pm-input" value={notes} maxLength={1000} disabled={locked} onChange={field(setNotes)}/></label>
    </div>}
    {!target&&canCost&&<PurchaseMoneyFields projectId={projectId} unitWord={unitWord} value={money} locked={locked} onChange={v=>{setMoney(v);reset();}}/>}
    {!target&&canCost&&!m.priced&&<p className="text-xs pm-muted">Không nhập tiền: lô ghi Chưa ghi chi phí (ghi sau ở Lịch sử nhập kho, một lần).</p>}
    {!target&&!canCost&&<p className="pm-muted text-xs">Lô nhập ghi Chưa ghi chi phí. Người có quyền Chi phí ghi tiền thực trả sau ở tab Lô nhập (một lần).</p>}
    {!empty&&!fresh&&!uncertain&&!moneyBlocked&&<p className="text-sm pm-muted" role="status">Đang kiểm tra…{checkError?'':' (chưa nhập gì)'}</p>}
    {checkError&&<p role="alert" className="pm-error text-sm">{checkError}</p>}
    {preview&&fresh&&<>
      <p className="text-sm" role="status">{kind==='PAYPAL'?<><strong>{preview.ready}</strong> PP mới ({counts?.emails??0} email) · {preview.exists} đã có{counts?.add?<> · <strong>{counts.add}</strong> mã đã có kèm email mới</>:null}</>:<><strong>{preview.ready}</strong> hợp lệ · {preview.exists} đã có</>} · <span className={preview.errors?'text-red-600':''}>{preview.errors} dòng cần sửa</span> · {preview.batch.existing?<>Vào lô <strong>{preview.batch.code}</strong>, {preview.batch.cost==='RECORDED'?'chi phí đã ghi, không ghi thêm':'chưa ghi chi phí (ghi ở tab Lô nhập)'}.</>:<>Lô mới <strong>{preview.batch.code}</strong>{preview.batch.total?<> · chi phí ghi một lần: <strong>{formatMoney(preview.batch.total.amount,preview.batch.total.currency,{exact:true})}</strong>{preview.batch.total.currency!=='USDT'?<> ≈ <span title={'Lưu chính xác: '+formatMoney(preview.batch.total.usdt,'USDT',{exact:true})}>{formatMoney(preview.batch.total.usdt,'USDT')}</span></>:null}{preview.batch.total.unit&&preview.batch.total.quantity?` (${preview.batch.total.quantity} ${unitWord} × ${formatMoney(preview.batch.total.unit,preview.batch.total.currency,{exact:true})})`:''}.</>:preview.batch.cost==='WILL_RECORD'?' · chi phí ghi một lần.':' · Chưa ghi chi phí.'}</>}</p>
      <div className="vm-bulk-table"><table className="pm-table"><thead><tr><th>Dòng</th><th>{kind==='PAYPAL'?'Mã PP · Email':'Tài khoản'}</th>{kind==='LOGIN'&&<th>Có</th>}<th>Kết quả</th></tr></thead><tbody>{preview.rows.map(r=><tr key={r.line} className={r.outcome==='ERROR'?'pm-row-blocked':''}><td className="pm-muted">{r.line}</td><td className="whitespace-nowrap">{r.account}{kind==='PAYPAL'&&<span className="pm-muted"> · {r.email}</span>}</td>
        {kind==='LOGIN'&&<td className="text-xs pm-muted whitespace-nowrap">{[r.hasPassword&&'mật khẩu',r.has2fa&&'2FA',r.hasRecovery&&'khôi phục',r.has2faLink&&'link 2FA',r.hasSmsLink&&'link SMS',r.hasPhone&&'SĐT'].filter(Boolean).join(', ')||'—'}</td>}
        <td className={r.outcome==='ERROR'?'text-red-600':r.outcome==='EXISTS'?'pm-muted':r.outcome==='ADD'?'':'text-green-700'}>{r.outcome==='READY'?'Hợp lệ':r.outcome==='EXISTS'?'Đã có':r.outcome==='ADD'?'Mã đã có':'Cần sửa'} · {r.message}{r.outcome==='ADD'&&r.newEmails?.length?<> <button type="button" className="pm-button pm-button-quiet" disabled={locked||addEmails.isLoading} onClick={()=>void addTo(r)}>Bổ sung {r.newEmails.length} email vào {r.account}</button></>:null}</td></tr>)}</tbody></table></div></>}
    {done&&<p role="status" className="pm-success text-sm">Đã nhập {done.applied} · đã có {done.exists} · lỗi {done.errors} vào lô {done.batch.code}{done.batch.appended?' (nhập bổ sung, không ghi chi phí thêm)':done.batch.costRecorded?' (chi phí đã ghi một lần)':' (chưa ghi chi phí)'}. {done.errors?'Ô dán chỉ còn các dòng lỗi; sửa rồi nhập bổ sung vào cùng lô.':''}</p>}
    {error&&<p role="alert" className="pm-error text-sm">{error}</p>}
    <div className="flex gap-2 justify-end flex-wrap">{(text||one.email||one.code||preview)&&<button type="button" className="pm-button pm-button-quiet mr-auto" disabled={locked} onClick={onDiscard}>Bỏ nháp</button>}<button type="button" className="pm-button pm-button-quiet" disabled={locked} title="Nội dung đang nhập được giữ trong phiên này" onClick={onClose}>Đóng</button>
      {uncertain?<><button type="button" className="pm-button" disabled={busy} onClick={()=>{setUncertain(false);setError('');setRecheck(n=>n+1);onDone();}}>Kiểm tra lại</button><button type="button" className="pm-button pm-button-primary" disabled={busy} onClick={()=>void runCommit()}>{busy?'Đang gửi lại…':'Thử lại'}</button></>
        :<button type="button" className="pm-button pm-button-primary" disabled={busy||!fresh||!ready} onClick={()=>void runCommit()}>{busy?'Đang nhập…':kind==='LOGIN'&&!type?'Chọn Gmail hoặc Apple ID':moneyBlocked?'Sửa ô tiền mua':!fresh?'Đang kiểm tra…':!ready?'Không có dòng mới để nhập':kind==='PAYPAL'?`Nhập ${ready} PP (${counts?.emails??0} email)`:`Nhập ${ready} dòng hợp lệ`}</button>}</div>
  </section>;
}
