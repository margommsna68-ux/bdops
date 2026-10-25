"use client";
import {useEffect,useRef,useState} from 'react';
import {trpc} from '@/lib/trpc';
import {errorMessage} from '@/components/vm-management/shared';
import {displayMoney,formatMoney} from '@/lib/money-input';
import {applyQuote,applySuggestedQuantity,changeCurrency,editAmount,editQuantity,editRate,manualQuantity,resetSuggestedQuantity,quoteLabel,readPurchase,switchMode,QUOTE_TTL_MS,type PurchaseState} from './purchase-money';
const CURRENCIES=['VND','PPUSD','USDT'];
// Money of a purchase (Nhập kho, Ghi chi phí of a batch): total paid by default, or price per account × quantity bought. Vietnamese
// number input ("70.000", "16,27"), every field checked in place; the canonical numbers are built by readPurchase. With VND the
// Binance P2P BUY reference is fetched through the existing quote endpoint; it may be edited into the rate actually paid (then
// labelled "Nhập tay"). A failed fetch keeps everything and offers Thử lại; an expired quote blocks the save until refreshed or
// kept as a manual rate, so the converted amount never changes at the click.
export interface PurchaseMoneyFieldsProps {projectId:string;unitWord:string;value:PurchaseState;onChange:(v:PurchaseState)=>void;locked:boolean;suggestedQuantity?:number|null}
export function PurchaseMoneyFields({projectId,unitWord,value:storedValue,onChange,locked,suggestedQuantity}:PurchaseMoneyFieldsProps){
  const value=applySuggestedQuantity(storedValue,suggestedQuantity,{locked});
  useEffect(()=>{if(value!==storedValue)onChange(value);},[value,storedValue,onChange]);
  const latest=useRef(value);latest.current=value;
  const p2p=trpc.businessManagement.p2pQuote.useQuery({projectId,currency:value.currency==='USDT'||value.currency==='PPUSD'?'VND':value.currency,side:'BUY'},{enabled:false,retry:false});
  const [fetchError,setFetchError]=useState(''),[fetching,setFetching]=useState(false),tried=useRef('');
  const r=readPurchase(value,unitWord);
  async function fetchQuote(){
    setFetchError('');setFetching(true);const currency=latest.current.currency;
    try{const q=await p2p.refetch();if(q.error||!q.data)throw q.error||new Error('Chưa lấy được giá');
      // Only into the form it was asked for (the currency may have changed meanwhile).
      if(latest.current.currency===currency)onChange(applyQuote(latest.current,{rate:q.data.rate,token:q.data.token,fetchedAt:q.data.fetchedAt,side:q.data.side}));}
    catch(e){if(latest.current.currency===currency)setFetchError(errorMessage(e));}
    finally{setFetching(false);}
  }
  // VND: fetch the reference once per currency choice while the rate is empty (never over a typed rate).
  useEffect(()=>{if((value.currency==='VND'||value.currency==='PPUSD')&&!(value.currency==='PPUSD'?value.vndUsdtRate??'':value.rate).trim()&&!value.quote&&tried.current!==value.currency&&!locked){tried.current=value.currency;void fetchQuote();}if(value.currency!=='VND'&&value.currency!=='PPUSD')tried.current='';},[value.currency,value.rate,value.vndUsdtRate,value.quote,locked]);// eslint-disable-line react-hooks/exhaustive-deps
  const err=(f:keyof typeof r.errors,shown:boolean)=>shown&&r.errors[f]?<span className="pm-field-error" role="alert">{r.errors[f]}</span>:null;
  const unit=value.mode==='UNIT';
  return <div className="acc-money">
    <div className="flex gap-2 items-center flex-wrap" role="radiogroup" aria-label="Cách ghi tiền mua"><span className="text-sm">Tiền mua:</span>
      <button type="button" role="radio" aria-checked={!unit} className={'pm-button'+(!unit?' pm-button-primary':'')} disabled={locked} onClick={()=>onChange(switchMode(value,'TOTAL'))}>Tổng tiền thực trả</button>
      <button type="button" role="radio" aria-checked={unit} className={'pm-button'+(unit?' pm-button-primary':'')} disabled={locked} onClick={()=>onChange(switchMode(value,'UNIT'))}>Tính theo giá mỗi {unitWord}</button></div>
    <div className="acc-import-grid">
      {unit?<label className="pm-label">Giá mỗi {unitWord}<input className="pm-input" inputMode="decimal" value={value.unit} disabled={locked} placeholder="Ví dụ 70.000" aria-invalid={!!r.errors.unit} onChange={e=>onChange(editAmount(value,e.target.value))}/>{err('unit',true)}</label>
        :<label className="pm-label">Tổng tiền thực trả<input className="pm-input" inputMode="decimal" value={value.total} disabled={locked} placeholder="Để trống nếu chưa có giá" aria-invalid={!!r.errors.total} onChange={e=>onChange(editAmount(value,e.target.value))}/>{err('total',true)}</label>}
      <label className="pm-label">{unit?`Số ${unitWord} thực mua`:`Số ${unitWord} thực mua (không bắt buộc)`}<input className="pm-input" inputMode="numeric" value={value.quantity} disabled={locked} placeholder={unitWord==='PP'?'Đếm mã PP, không đếm email':`Số ${unitWord} đã trả tiền`} aria-invalid={!!r.errors.quantity} onChange={e=>onChange(editQuantity(value,e.target.value))}/>{err('quantity',r.priced||!!value.quantity)}
        {suggestedQuantity!==undefined&&suggestedQuantity!==null&&<span className="text-xs pm-muted">{manualQuantity(value)?<>Đang dùng số lượng thực mua nhập tay. <button type="button" className="pm-link" disabled={locked} onClick={()=>onChange(resetSuggestedQuantity(value,suggestedQuantity,{locked}))}>Dùng số lượng danh sách</button></>:<>Theo danh sách: {suggestedQuantity.toLocaleString('vi-VN')} {unitWord}. Có thể sửa số thực mua.</>}</span>}</label>
      <label className="pm-label">Đồng tiền<select className="pm-input" value={value.currency} disabled={locked||fetching} onChange={e=>{setFetchError('');onChange(changeCurrency(value,e.target.value));}}>{!CURRENCIES.includes(value.currency)&&<option value={value.currency} disabled>Chọn đồng tiền</option>}{CURRENCIES.map(c=><option key={c} value={c}>{c==='PPUSD'?'USD PayPal':c}</option>)}</select>{err('currency',r.priced)}</label>
      {value.currency==='PPUSD'&&<label className="pm-label">1 USD PayPal = ? VND<input className="pm-input" inputMode="decimal" value={value.paypalVndRate??''} disabled={locked} placeholder="Ví dụ 24.000" aria-invalid={!!r.errors.paypalVndRate&&r.priced} onChange={e=>onChange({...value,paypalVndRate:e.target.value})}/>{err('paypalVndRate',r.priced)}</label>}
      {value.currency!=='USDT'&&<label className="pm-label">{value.currency==='PPUSD'?'1 USDT = ? VND':`Tỷ giá thực trả: 1 USDT = ? ${value.currency}`}<input className="pm-input" inputMode="decimal" value={value.currency==='PPUSD'?value.vndUsdtRate??'':value.rate} disabled={locked||fetching} placeholder={fetching?'Đang lấy giá…':value.currency==='VND'?'Ví dụ 25.820':''} aria-invalid={!!r.errors[value.currency==='PPUSD'?'vndUsdtRate':'rate']&&r.priced} onChange={e=>onChange(editRate(value,e.target.value))}/>{err(value.currency==='PPUSD'?'vndUsdtRate':'rate',r.priced&&!fetching)}</label>}
    </div>
    {value.currency!=='USDT'&&<div className="text-xs flex gap-2 items-center flex-wrap" aria-live="polite">
      {fetching?<span className="pm-muted">Đang lấy giá tham khảo Binance P2P (Mua USDT bằng {value.currency==='PPUSD'?'VND':value.currency})…</span>
        :fetchError?<><span className="pm-error">{fetchError} Nội dung được giữ; nhập tỷ giá thực trả hoặc thử lại.</span><button type="button" className="pm-button pm-button-quiet" disabled={locked} onClick={()=>void fetchQuote()}>Thử lại</button></>
        :r.rateText?<><span><strong>{r.rateText}</strong> · {r.rateSource}</span>{!r.quoteExpired&&<button type="button" className="pm-button pm-button-quiet" disabled={locked} onClick={()=>void fetchQuote()}>Lấy giá Binance mới</button>}</>
        :<button type="button" className="pm-button pm-button-quiet" disabled={locked} onClick={()=>void fetchQuote()}>Lấy giá Binance P2P</button>}
      {value.currency==='VND'&&!fetching&&!fetchError&&<span className="pm-muted">Giá Binance là tham khảo; sửa thành tỷ giá thực trả nếu khác.</span>}</div>}
    {r.unitHint&&<p className="text-xs pm-muted" aria-live="polite">{r.unitHint}</p>}
    {r.quoteExpired&&value.quote&&<div className="pm-review text-sm" role="alert">Giá Binance {quoteLabel(value.quote).replace('Binance P2P · ','')} đã quá 10 phút nên chưa nhập được. <button type="button" className="pm-button" disabled={locked} onClick={()=>void fetchQuote()}>Lấy giá mới</button> <button type="button" className="pm-button pm-button-quiet" disabled={locked} onClick={()=>onChange({...value,quote:null})}>Giữ {r.rateText}, ghi là nhập tay</button></div>}
    {r.priced&&r.total&&<p className="text-sm acc-money-sum" aria-live="polite">{r.formula?<strong>{r.formula}</strong>:<strong>Tổng {displayMoney(r.total,value.currency)}</strong>}
      {r.usdtText&&<> · <span title={'Lưu chính xác: '+formatMoney(r.usdt!,'USDT',{exact:true})}>{r.usdt?`≈ ${displayMoney(r.usdt,'USDT')}`:r.usdtText}</span></>}{r.allocation&&<span className="pm-muted"> · {r.allocation}</span>}<span className="pm-muted"> · ghi một lần vào Chi phí.</span></p>}
  </div>;
}
// Re-render the form that holds a quote at the moment it expires, so the whole form (the Nhập / Ghi chi phí button included) shows the
// expiry before any click; nothing is re-priced.
export function useQuoteExpiry(quote:{fetchedAt:string}|null){
  const [,tick]=useState(0);
  useEffect(()=>{if(!quote)return;const left=Date.parse(quote.fetchedAt)+QUOTE_TTL_MS-Date.now()+50;if(left<=0)return;const t=setTimeout(()=>tick(n=>n+1),left);return ()=>clearTimeout(t);},[quote]);
}
