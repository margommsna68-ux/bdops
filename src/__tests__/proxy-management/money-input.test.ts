import {describe,expect,it} from 'vitest';
import {parseViNumber,formatMoney,formatUsd,viInput,viNumber} from '@/lib/money-input';
import {readPurchase,switchMode,changeCurrency,applyQuote,editRate,emptyPurchase,QUOTE_TTL_MS} from '@/components/account-store/purchase-money';
// Money typed by people (owner brief 19/10/2026): Vietnamese convention, "." groups thousands and "," starts the decimals. The
// rate "25.820" was once read as 25,82 (16.266 USDT instead of 16,27): the typed text and the canonical number sent to the API are
// two different things, normalised once here.
describe('Vietnamese money input',()=>{
  it('reads thousands with or without dots and decimals after the comma',()=>{
    for(const [text,value] of [['70000','70000'],['70.000','70000'],['420.000','420000'],['25.820','25820'],['1.234.567,5','1234567.5'],['16,27','16.27'],['0,5','0.5'],[' 420.000 ₫ ','420000'],['$18,00','18'],['25820 VND','25820']] as const)
      expect(parseViNumber(text)).toEqual({value,error:null});
  });
  it('reports ambiguous or malformed text at the field instead of guessing ×/÷ 1.000',()=>{
    for(const text of ['25.82','1.2345','12.5','1,2,3','7a','-5',',5','1..000'])expect(parseViNumber(text).error).toBeTruthy();
    // The English thousands comma is a VND concern (VND prices and "1 USDT = N VND" rates have no real 3-decimal values).
    for(const text of ['70,000','25,820','16,125'])expect(parseViNumber(text,{vnd:true}).error).toBeTruthy();
    expect(parseViNumber('70,000',{vnd:true}).error).toMatch(/70\.000/);
    expect(parseViNumber('15,625',{vnd:true}).error).toMatch(/15,6250/);
    expect(parseViNumber('')).toEqual({value:null,error:null});
    expect(parseViNumber('3,5',{integer:true}).error).toBeTruthy();
  });
  it('exact decimals are valid outside the VND thousands check (independent review 19/10: 0,424 was refused)',()=>{
    for(const [text,value] of [['0,424','0.424'],['16,125','16.125'],['2,125','2.125'],['0,00000001','0.00000001'],['25.820,125','25820.125']] as const)expect(parseViNumber(text)).toEqual({value,error:null});
    // "0,xxx" is never a thousands group, even in a VND field; a VND rate with real decimals is valid.
    expect(parseViNumber('0,424',{vnd:true})).toEqual({value:'0.424',error:null});
    expect(parseViNumber('25.820,5',{vnd:true,fraction:12})).toEqual({value:'25820.5',error:null});
    expect(parseViNumber('1,125',{fraction:12})).toEqual({value:'1.125',error:null});
  });
  it('text the web writes reads back as the same value',()=>{
    for(const value of ['0.424','16.125','15.625','2.12','420000','25820.5','0.00000001','999.999'])for(const vnd of [false,true]){
      expect(parseViNumber(viInput(value,{vnd}),{vnd})).toEqual({value,error:null});
    }
    expect(viInput('0.424')).toBe('0,424');expect(viInput('15.625',{vnd:true})).toBe('15,6250');expect(viInput('15.625')).toBe(viNumber('15.625'));
  });
  it('shows each currency with its own unit; only USD uses $',()=>{
    expect(formatUsd('0')).toBe('$0,00');expect(formatUsd('100')).toBe('$100,00');expect(formatUsd('18.5')).toBe('$18,50');expect(formatUsd('-5')).toBe('-$5,00');
    expect(formatMoney('420000','VND')).toBe('420.000 ₫');expect(formatMoney('16.26646','USDT')).toBe('16,27 USDT');expect(formatMoney('16.26646','USDT',{exact:true})).toBe('16,26646 USDT');expect(formatMoney('18','USD')).toBe('$18,00');
  });
});
const pp=(over:Partial<ReturnType<typeof emptyPurchase>>={})=>({...emptyPurchase(),...over});
const quote={rate:'25820.000000000000',token:'sealed',fetchedAt:'2026-10-19T03:00:00.000Z',side:'BUY' as const};
const t0=Date.parse(quote.fetchedAt);
describe('Purchase money: total paid or price per account',()=>{
  it('6 PP × 70.000 VND at 1 USDT = 25.820 VND gives 420.000 VND ≈ 16,27 USDT (exact 16,266460)',()=>{
    const r=readPurchase(pp({mode:'UNIT',unit:'70.000',quantity:'6',currency:'VND',rate:'25.820'}),'PP',t0);
    expect(r.errors).toEqual({});
    expect(r.payload).toEqual({priceMode:'UNIT',amount:'70000',quantity:6,currency:'VND',rate:'25820',p2pQuoteToken:null});
    expect(r.total).toBe('420000');expect(r.usdt).toBe('16.266460');
    expect(r.formula).toBe('6 PP × 70.000 ₫ = 420.000 ₫');expect(r.usdtText).toBe('≈ 16,27 USDT');expect(r.rateText).toBe('1 USDT = 25.820 VND');
  });
  it('the total is the source: an optional quantity only gives a reference allocation',()=>{
    const r=readPurchase(pp({total:'420.000',quantity:'6',currency:'VND',rate:'25820'}),'PP',t0);
    expect(r.payload).toMatchObject({priceMode:'TOTAL',amount:'420000',quantity:6});expect(r.allocation).toBe('≈ 70.000 ₫ / PP (tham khảo)');
    expect(readPurchase(pp({total:'420.000',currency:'VND',rate:'25820'}),'PP',t0).payload).toMatchObject({priceMode:'TOTAL',amount:'420000',quantity:null});
  });
  it('switching unit price → total carries the total, never the unit price; switching back keeps an exact unit price',()=>{
    const unit=pp({mode:'UNIT',unit:'70.000',quantity:'6',currency:'VND'}),total=switchMode(unit,'TOTAL');
    expect(total).toMatchObject({mode:'TOTAL',total:'420.000',quantity:'6'});
    expect(switchMode(total,'UNIT')).toMatchObject({mode:'UNIT',unit:'70.000',quantity:'6'});
    // Without a quantity there is no total to carry: the total stays empty (70.000 never becomes the whole purchase).
    expect(switchMode(pp({mode:'UNIT',unit:'70.000',currency:'VND'}),'TOTAL')).toMatchObject({mode:'TOTAL',total:''});
    // A changed total that is not unit × quantity drops the old unit price instead of guessing from emails or pasted lines.
    expect(switchMode({...total,total:'400.000'},'UNIT')).toMatchObject({mode:'UNIT',unit:'',quantity:'6'});
  });
  it('2,12 USDT for 5 PP switches to 0,424 per PP and back, many times, without losing or rounding the total (review 19/10)',()=>{
    let s=pp({total:'2,12',quantity:'5'});
    for(let i=0;i<3;i++){
      s=switchMode(s,'UNIT');expect(s.unit).toBe('0,424');
      expect(readPurchase(s,'PP')).toMatchObject({errors:{},total:'2.12',payload:{priceMode:'UNIT',amount:'0.424',quantity:5,currency:'USDT'}});
      expect(readPurchase(s,'PP').formula).toBe('5 PP × 0,424 USDT = 2,12 USDT');
      s=switchMode(s,'TOTAL');expect(s.total).toBe('2,12');
      expect(readPurchase(s,'PP')).toMatchObject({errors:{},payload:{priceMode:'TOTAL',amount:'2.12',quantity:5}});
    }
    // 16,125 USDT typed as a total or a unit price is a valid decimal.
    expect(readPurchase(pp({total:'16,125'}),'PP')).toMatchObject({errors:{},payload:{amount:'16.125'}});
    const u=pp({mode:'UNIT',unit:'16,125',quantity:'2'});expect(readPurchase(u,'PP').payload).toMatchObject({amount:'16.125',quantity:2});expect(switchMode(u,'TOTAL').total).toBe('32,25');
    // VND unit 15.625 ₫ written by the web (62.500 ₫ / 4) reads back; a typed "15,625" ₫ is the thousands warning.
    const v=switchMode(pp({total:'62.500',quantity:'4',currency:'VND',rate:'25.820'}),'UNIT');expect(v.unit).toBe('15.625');
    const w=switchMode(pp({total:'62,5',quantity:'4',currency:'VND',rate:'25.820'}),'UNIT');expect(w.unit).toBe('15,6250');expect(readPurchase(w,'PP')).toMatchObject({errors:{},payload:{amount:'15.625'}});
    expect(readPurchase(pp({mode:'UNIT',unit:'15,625',quantity:'4',currency:'VND',rate:'25.820'}),'PP').errors.unit).toMatch(/15\.625/);
    // An inexact division keeps the total for the way back and says why the unit price is empty.
    const x=switchMode(pp({total:'10',quantity:'3'}),'UNIT');expect(x.unit).toBe('');expect(readPurchase(x,'PP').unitHint).toMatch(/không chia hết/);
    expect(switchMode(x,'TOTAL').total).toBe('10');
  });
  it('a unit price needs the quantity actually bought; rates are required outside USDT and never default to 1',()=>{
    expect(readPurchase(pp({mode:'UNIT',unit:'70.000',currency:'VND',rate:'25820'}),'PP',t0).errors.quantity).toBeTruthy();
    const usd=readPurchase(pp({total:'18',currency:'USD'}),'PP',t0);expect(usd.errors.rate).toBeTruthy();expect(usd.payload).toBeNull();
    expect(readPurchase(pp({total:'12',currency:'USDT'}),'PP',t0).payload).toMatchObject({currency:'USDT',rate:null});
    expect(readPurchase(pp({total:'70,000',currency:'VND',rate:'25820'}),'PP',t0).errors.total).toMatch(/70\.000/);
    expect(readPurchase(pp(),'PP',t0).payload).toBeNull();
  });
  it('a fetched quote is labelled with its source and time, expires visibly, and a changed currency or rate drops it',()=>{
    const s=applyQuote(pp({total:'420.000',currency:'VND'}),quote);
    const fresh=readPurchase(s,'PP',t0+60000);expect(s.rate).toBe('25.820');expect(fresh.payload).toMatchObject({rate:'25820',p2pQuoteToken:'sealed'});expect(fresh.rateSource).toMatch(/Binance P2P/);
    const old=readPurchase(s,'PP',t0+QUOTE_TTL_MS+1);expect(old.quoteExpired).toBe(true);expect(old.payload).toBeNull();
    const manual=editRate(s,'26.000');expect(manual.quote).toBeNull();expect(readPurchase(manual,'PP',t0).payload).toMatchObject({rate:'26000',p2pQuoteToken:null});expect(readPurchase(manual,'PP',t0).rateSource).toBe('Nhập tay');
    expect(changeCurrency(s,'USD')).toMatchObject({currency:'USD',rate:'',quote:null});
  });
});
