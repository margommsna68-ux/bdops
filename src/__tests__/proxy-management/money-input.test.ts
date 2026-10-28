import {describe,expect,it} from 'vitest';
import {parseMoneyNumber,formatMoney,formatUsd,moneyInput,moneyNumber,displayMoney,formatLedger} from '@/lib/money-input';
import {readPurchase,switchMode,changeCurrency,applyQuote,editRate,emptyPurchase,editAmount,QUOTE_TTL_MS} from '@/components/account-store/purchase-money';
// Money typed by people, US convention (owner decision 28/10/2026, replaces the Vietnamese convention of 19/10/2026): "." is the
// decimal point, "," an optional thousands separator, for every currency including VND. The typed text and the canonical number sent
// to the API are still two different things, normalised once here; anything ambiguous is refused at the field, never guessed.
describe('US money input',()=>{
  it('reads the decimal point and optional thousands commas',()=>{
    for(const [text,value] of [['12.18','12.18'],['1,234.56','1234.56'],['1234.56','1234.56'],['420,000','420000'],['420000','420000'],['0.424','0.424'],['25,820','25820'],['1,234,567.5','1234567.5'],[' 420,000 ₫ ','420000'],['$18.00','18'],['25820 VND','25820'],['0.00000001','0.00000001'],['24,000.5','24000.5']] as const)
      expect(parseMoneyNumber(text)).toEqual({value,error:null});
  });
  it('refuses a decimal comma and malformed groups with a clear message',()=>{
    for(const text of ['12,18','1.234,56','0,424','16,27','1,2,3','12,1800','1,23.5','7a','-5','.5','1..000','1.2.3','12.','9,'])expect(parseMoneyNumber(text).error,text).toBeTruthy();
    expect(parseMoneyNumber('12,18').error).toMatch(/^Dùng dấu \. cho phần thập phân, ví dụ 12\.18/);
    expect(parseMoneyNumber('1.234,56').error).toMatch(/^Dùng dấu \. cho phần thập phân, ví dụ 12\.18/);
    expect(parseMoneyNumber('')).toEqual({value:null,error:null});
    expect(parseMoneyNumber('3.5',{integer:true}).error).toBeTruthy();
    expect(parseMoneyNumber('1,000',{integer:true})).toEqual({value:'1000',error:null});
    expect(parseMoneyNumber('1.123',{fraction:2}).error).toBeTruthy();
  });
  it('text the web writes reads back as the same value',()=>{
    for(const value of ['0.424','16.125','15.625','15625','2.12','420000','25820.5','0.00000001','999.999','1234567.89'])
      expect(parseMoneyNumber(moneyInput(value))).toEqual({value,error:null});
    expect(moneyInput('0.424')).toBe('0.424');expect(moneyInput('420000')).toBe('420,000');expect(moneyNumber('1234.5')).toBe('1,234.5');expect(moneyNumber('-1234.5')).toBe('-1,234.5');
  });
  it('shows each currency with its own unit in US digits; only USD uses $',()=>{
    expect(formatUsd('0')).toBe('$0.00');expect(formatUsd('100')).toBe('$100.00');expect(formatUsd('18.5')).toBe('$18.50');expect(formatUsd('-5')).toBe('-$5.00');expect(formatUsd('1234.56')).toBe('$1,234.56');
    expect(formatMoney('420000','VND')).toBe('420,000 ₫');expect(formatMoney('16.26646','USDT')).toBe('16.27 USDT');expect(formatMoney('16.26646','USDT',{exact:true})).toBe('16.26646 USDT');expect(formatMoney('18','USD')).toBe('$18.00');
    expect(formatMoney('32.12','PPUSD')).toBe('$32.12 PayPal');expect(formatLedger('1234.5','USD')).toBe('$1,234.50');expect(formatLedger('16.26646','USDT')).toBe('16.26646 USDT');
    expect(displayMoney('420000','VND')).toBe('420,000 ₫');
  });
});
const pp=(over:Partial<ReturnType<typeof emptyPurchase>>={})=>({...emptyPurchase(),...over});
const quote={rate:'25820.000000000000',token:'sealed',fetchedAt:'2026-10-19T03:00:00.000Z',side:'BUY' as const};
const t0=Date.parse(quote.fetchedAt);
describe('Purchase money: total paid or price per account',()=>{
  it('6 PP × 70,000 VND at 1 USDT = 25,820 VND gives 420,000 VND ≈ 16.27 USDT (exact 16.266460)',()=>{
    const r=readPurchase(pp({mode:'UNIT',unit:'70,000',quantity:'6',currency:'VND',rate:'25,820'}),'PP',t0);
    expect(r.errors).toEqual({});
    expect(r.payload).toEqual({priceMode:'UNIT',amount:'70000',quantity:6,currency:'VND',rate:'25820',p2pQuoteToken:null});
    expect(r.total).toBe('420000');expect(r.usdt).toBe('16.266460');
    expect(r.formula).toBe('6 PP × 70,000 ₫ = 420,000 ₫');expect(r.usdtText).toBe('≈ 16.27 USDT');expect(r.rateText).toBe('1 USDT = 25,820 VND');
  });
  it('the total is the source: an optional quantity only gives a reference allocation',()=>{
    const r=readPurchase(pp({total:'420,000',quantity:'6',currency:'VND',rate:'25820'}),'PP',t0);
    expect(r.payload).toMatchObject({priceMode:'TOTAL',amount:'420000',quantity:6});expect(r.allocation).toBe('≈ 70,000 ₫ / PP (tham khảo)');
    expect(readPurchase(pp({total:'420,000',currency:'VND',rate:'25820'}),'PP',t0).payload).toMatchObject({priceMode:'TOTAL',amount:'420000',quantity:null});
  });
  it('switching unit price → total carries the total, never the unit price; switching back keeps an exact unit price',()=>{
    const unit=pp({mode:'UNIT',unit:'70,000',quantity:'6',currency:'VND'}),total=switchMode(unit,'TOTAL');
    expect(total).toMatchObject({mode:'TOTAL',total:'420,000',quantity:'6'});
    expect(switchMode(total,'UNIT')).toMatchObject({mode:'UNIT',unit:'70,000',quantity:'6'});
    // Without a quantity there is no total to carry: the view stays on the unit price with the quantity to fix (review 19/10: it used
    // to become an empty total imported without a cost; 70.000 never becomes the whole purchase either).
    expect(switchMode(pp({mode:'UNIT',unit:'70,000',currency:'VND'}),'TOTAL')).toMatchObject({mode:'UNIT',unit:'70,000',total:''});
    // A changed total that is not unit × quantity drops the old unit price instead of guessing from emails or pasted lines.
    // 400.000 / 6 is not an exact unit price: the view stays on the total (review 19/10, it used to become an empty unit price).
    expect(switchMode({...total,total:'400,000'},'UNIT')).toMatchObject({mode:'TOTAL',total:'400,000',quantity:'6'});
  });
  it('2.12 USDT for 5 PP switches to 0.424 per PP and back, many times, without losing or rounding the total (review 19/10)',()=>{
    let s=pp({total:'2.12',quantity:'5'});
    for(let i=0;i<3;i++){
      s=switchMode(s,'UNIT');expect(s.unit).toBe('0.424');
      expect(readPurchase(s,'PP')).toMatchObject({errors:{},total:'2.12',payload:{priceMode:'UNIT',amount:'0.424',quantity:5,currency:'USDT'}});
      expect(readPurchase(s,'PP').formula).toBe('5 PP · Tổng 2.12 USDT');
      s=switchMode(s,'TOTAL');expect(s.total).toBe('2.12');
      expect(readPurchase(s,'PP')).toMatchObject({errors:{},payload:{priceMode:'TOTAL',amount:'2.12',quantity:5}});
    }
    // 16,125 USDT typed as a total or a unit price is a valid decimal.
    expect(readPurchase(pp({total:'16.125'}),'PP')).toMatchObject({errors:{},payload:{amount:'16.125'}});
    const u=pp({mode:'UNIT',unit:'16.125',quantity:'2'});expect(readPurchase(u,'PP').payload).toMatchObject({amount:'16.125',quantity:2});expect(switchMode(u,'TOTAL').total).toBe('32.25');
    // VND: 62,500 ₫ / 4 = 15,625 ₫ (fifteen thousand) and 62.5 ₫ / 4 = 15.625 ₫, both written by the web and read back unchanged.
    const v=switchMode(pp({total:'62,500',quantity:'4',currency:'VND',rate:'25,820'}),'UNIT');expect(v.unit).toBe('15,625');expect(readPurchase(v,'PP')).toMatchObject({errors:{},payload:{amount:'15625'}});
    const w=switchMode(pp({total:'62.5',quantity:'4',currency:'VND',rate:'25,820'}),'UNIT');expect(w.unit).toBe('15.625');expect(readPurchase(w,'PP')).toMatchObject({errors:{},payload:{amount:'15.625'}});
    // A decimal comma is refused with the US hint.
    expect(readPurchase(pp({mode:'UNIT',unit:'15,62',quantity:'4',currency:'VND',rate:'25,820'}),'PP').errors.unit).toMatch(/12\.18/);
    // An inexact division keeps the total for the way back and says why the unit price is empty.
    const x=switchMode(pp({total:'10',quantity:'3'}),'UNIT');expect(x).toMatchObject({mode:'TOTAL',unit:''});expect(readPurchase(x,'PP').unitHint).toMatch(/không chia hết/);
    expect(switchMode(x,'TOTAL').total).toBe('10');
  });
  it('a unit price needs the quantity actually bought; rates are required outside USDT and never default to 1',()=>{
    expect(readPurchase(pp({mode:'UNIT',unit:'70,000',currency:'VND',rate:'25820'}),'PP',t0).errors.quantity).toBeTruthy();
    const usd=readPurchase(pp({total:'18',currency:'USD'}),'PP',t0);expect(usd.errors.rate).toBeTruthy();expect(usd.payload).toBeNull();
    expect(readPurchase(pp({total:'12',currency:'USDT'}),'PP',t0).payload).toMatchObject({currency:'USDT',rate:null});
    expect(readPurchase(pp({total:'70,000',currency:'VND',rate:'25820'}),'PP',t0).payload).toMatchObject({amount:'70000'});
    expect(readPurchase(pp({total:'70,00',currency:'VND',rate:'25820'}),'PP',t0).errors.total).toMatch(/12\.18/);
    expect(readPurchase(pp(),'PP',t0).payload).toBeNull();
  });
  it('a fetched quote is labelled with its source and time, expires visibly, and a changed currency or rate drops it',()=>{
    const s=applyQuote(pp({total:'420,000',currency:'VND'}),quote);
    const fresh=readPurchase(s,'PP',t0+60000);expect(s.rate).toBe('25,820');expect(fresh.payload).toMatchObject({rate:'25820',p2pQuoteToken:'sealed'});expect(fresh.rateSource).toMatch(/Binance P2P/);
    const old=readPurchase(s,'PP',t0+QUOTE_TTL_MS+1);expect(old.quoteExpired).toBe(true);expect(old.payload).toBeNull();
    const manual=editRate(s,'26,000');expect(manual.quote).toBeNull();expect(readPurchase(manual,'PP',t0).payload).toMatchObject({rate:'26000',p2pQuoteToken:null});expect(readPurchase(manual,'PP',t0).rateSource).toBe('Nhập tay');
    expect(changeCurrency(s,'USD')).toMatchObject({currency:'USD',rate:'',quote:null});
  });
});
// Independent review 19/10/2026 (.runtime/review-purchase-inexact-20261019.test.ts): 10 USDT / 3 PP switched to "giá mỗi PP" left the
// unit empty, readPurchase saw no money and the import went out with priceMode NONE ("Chưa ghi chi phí"). Changing how the money is
// shown never drops an entered amount: the total paid is what gets recorded.
describe('Switching the money view never discards an entered cost',()=>{
  const pp=(o:Partial<ReturnType<typeof emptyPurchase>>={})=>({...emptyPurchase(),...o});
  it('10 USDT / 3 stays on Tổng tiền thực trả with the same amount, many switches, one TOTAL payload of 10',()=>{
    let s=pp({total:'10',quantity:'3'});
    for(let i=0;i<3;i++){
      s=switchMode(s,'UNIT');expect(s).toMatchObject({mode:'TOTAL',total:'10',unit:''});
      const r=readPurchase(s,'PP');
      expect(r.priced).toBe(true);
      expect(r.payload).toEqual({priceMode:'TOTAL',amount:'10',quantity:3,currency:'USDT',rate:null,p2pQuoteToken:null});
      expect(r.allocation).toMatch(/3\.33.*tham khảo/);expect(r.unitHint).toMatch(/không chia hết.*giữ Tổng tiền thực trả/);
      s=switchMode(s,'TOTAL');expect(readPurchase(s,'PP').payload).toMatchObject({priceMode:'TOTAL',amount:'10',quantity:3});
    }
  });
  it('100,000 VND / 3 keeps the total and the rate; the conversion is of the total',()=>{
    const s=switchMode(pp({total:'100,000',quantity:'3',currency:'VND',rate:'25,820'}),'UNIT');
    expect(s).toMatchObject({mode:'TOTAL',total:'100,000',rate:'25,820'});
    const r=readPurchase(s,'PP');
    expect(r.payload).toMatchObject({priceMode:'TOTAL',amount:'100000',quantity:3,currency:'VND',rate:'25820'});
    expect(r.usdt).toBe(readPurchase(pp({total:'100,000',currency:'VND',rate:'25,820'}),'PP').usdt);
  });
  it('a total without quantity, or a total with an error, stays where it is instead of becoming an empty unit price',()=>{
    const a=switchMode(pp({total:'10'}),'UNIT');expect(a).toMatchObject({mode:'TOTAL',total:'10'});
    expect(readPurchase(a,'PP').payload).toMatchObject({priceMode:'TOTAL',amount:'10'});expect(readPurchase(a,'PP').unitHint).toMatch(/số PP thực mua/);
    const b=switchMode(pp({total:'25,82',quantity:'2',currency:'VND',rate:'25,820'}),'UNIT');expect(b).toMatchObject({mode:'TOTAL',total:'25,82'});
    expect(readPurchase(b,'PP')).toMatchObject({priced:true,payload:null});expect(readPurchase(b,'PP').errors.total).toBeTruthy();
  });
  it('an exact division still switches (2.12 / 5 → 0.424) and an empty form still imports without a cost',()=>{
    expect(switchMode(pp({total:'2.12',quantity:'5'}),'UNIT')).toMatchObject({mode:'UNIT',unit:'0.424'});
    const e=switchMode(pp({quantity:'3'}),'UNIT');expect(e.mode).toBe('UNIT');expect(readPurchase(e,'PP')).toMatchObject({priced:false,payload:null});
    expect(readPurchase(pp(),'PP')).toMatchObject({priced:false,payload:null});
  });
  it('only clearing the visible amount means "no cost"; a unit view left empty over a kept total blocks instead',()=>{
    let s=switchMode(pp({total:'2.12',quantity:'5'}),'UNIT');
    s=editAmount(s,'');expect(readPurchase(s,'PP')).toMatchObject({priced:false,payload:null});expect(switchMode(s,'TOTAL').total).toBe('');
    const t=editAmount(pp({total:'10',unit:'3'}),' ');expect(t).toMatchObject({total:'',unit:''});
    const stale=readPurchase(pp({mode:'UNIT',unit:'',total:'10',quantity:'3'}),'PP');
    expect(stale.priced).toBe(true);expect(stale.payload).toBeNull();expect(stale.errors.unit).toMatch(/10 USDT/);
  });
});
// Independent review 19/10/2026 (.runtime/review-purchase-mode-matrix-20261019.test.ts): unit → total fell back to the older total
// (or to an empty one) when the unit price or the quantity was missing / wrong, so a typed cost could be dropped or replaced. Both
// directions are checked over the whole matrix: amount valid / empty / malformed, quantity valid / missing / 0, other view's old
// amount present or not.
describe('Switching total ↔ unit, both directions, every combination',()=>{
  const pp=(o:Partial<ReturnType<typeof emptyPurchase>>={})=>({...emptyPurchase(),...o});
  const other=(m:'TOTAL'|'UNIT')=>m==='TOTAL'?'UNIT':'TOTAL';
  const cases:[string,string,string,string][]=[];
  for(const mode of ['TOTAL','UNIT'])for(const amount of ['9','','9.'])for(const quantity of ['3','','0'])for(const old of ['','10'])cases.push([mode,amount,quantity,old]);
  it.each(cases)('%s amount=%j quantity=%j old other amount=%j',(mode,amount,quantity,old)=>{
    const m=mode as 'TOTAL'|'UNIT',s=pp({mode:m,quantity,...(m==='TOTAL'?{total:amount,unit:old}:{unit:amount,total:old})});
    const before=readPurchase(s,'PP');let cur=s;
    for(let i=0;i<4;i++){
      cur=switchMode(cur,other(cur.mode));const r=readPurchase(cur,'PP');
      if(amount||old){
        // An amount that was not cleared is never "no cost".
        expect(r.priced).toBe(true);
        if(amount){
          // The amount typed is kept and its total is the only total that can be saved; an older amount never comes back.
          expect(r.payload?r.total:null).toBe(before.payload?before.total:null);
          if(!before.payload)expect(Object.keys(r.errors).length).toBeGreaterThan(0);
          if(!before.payload)expect(cur).toMatchObject({mode:m,[m==='TOTAL'?'total':'unit']:amount});
        }
      }else expect(r).toMatchObject({priced:false,payload:null});
    }
  });
  it('9 USDT per PP × 3 → total 27, and back to 9; a changed unit gives the new total, never the older one',()=>{
    let s=switchMode(pp({mode:'UNIT',unit:'9',quantity:'3',total:'10'}),'TOTAL');expect(s).toMatchObject({mode:'TOTAL',total:'27'});
    s=switchMode(s,'UNIT');expect(s).toMatchObject({mode:'UNIT',unit:'9'});
    s=editAmount(s,'10');s=switchMode(s,'TOTAL');expect(readPurchase(s,'PP').payload).toMatchObject({priceMode:'TOTAL',amount:'30',quantity:3});
  });
  it('a unit price without a usable quantity stays on the unit view with the error at the quantity, then switches once it is fixed',()=>{
    for(const q of ['','0']){
      let s=switchMode(pp({mode:'UNIT',unit:'9',quantity:q,total:'10'}),'TOTAL');
      expect(s).toMatchObject({mode:'UNIT',unit:'9',total:'10'});const r=readPurchase(s,'PP');
      expect(r).toMatchObject({priced:true,payload:null});expect(r.errors.quantity).toBeTruthy();expect(r.unitHint).toMatch(/số PP thực mua.*giữ giá mỗi PP/);
      s=switchMode({...s,quantity:'2'},'TOTAL');expect(s).toMatchObject({mode:'TOTAL',total:'18'});
    }
    const bad=switchMode(pp({mode:'UNIT',unit:'9.',quantity:'3'}),'TOTAL');expect(bad).toMatchObject({mode:'UNIT',unit:'9.'});
    expect(readPurchase(bad,'PP').errors.unit).toBeTruthy();expect(readPurchase(bad,'PP').payload).toBeNull();
  });
  it('clearing the visible amount drops both views; switching afterwards stays without cost',()=>{
    let s=switchMode(pp({mode:'UNIT',unit:'9',quantity:'3'}),'TOTAL');s=switchMode(s,'UNIT');s=editAmount(s,'');
    for(let i=0;i<3;i++){s=switchMode(s,s.mode==='UNIT'?'TOTAL':'UNIT');expect(readPurchase(s,'PP')).toMatchObject({priced:false,payload:null});expect(s.total+s.unit).toBe('');}
    s=editAmount(switchMode(s,'TOTAL'),'12');expect(readPurchase(s,'PP').payload).toMatchObject({priceMode:'TOTAL',amount:'12'});
  });
});
