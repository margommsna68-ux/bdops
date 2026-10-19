import {describe,expect,it} from 'vitest';
import {parseViNumber,formatMoney,formatUsd} from '@/lib/money-input';
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
    for(const text of ['70,000','25,820','25.82','1.2345','12.5','1,2,3','7a','-5',',5','1..000'])expect(parseViNumber(text).error).toBeTruthy();
    expect(parseViNumber('70,000').error).toMatch(/70\.000/);
    expect(parseViNumber('')).toEqual({value:null,error:null});
    expect(parseViNumber('3,5',{integer:true}).error).toBeTruthy();
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
