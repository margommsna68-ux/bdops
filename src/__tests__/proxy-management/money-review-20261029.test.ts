import {describe,expect,it} from 'vitest';
import {parseMoneyNumber,amountOptions,parsePositiveAmount} from '@/lib/money-input';
import {readPurchase,emptyPurchase,switchMode} from '@/components/account-store/purchase-money';
import {parseSdkAmount} from '@/lib/sdk-money';
import {checkTransfer} from '@/lib/paypal-transfer';
import {normalizeCostMoney} from '@/server/business-management/usdt-money';
import {packageTerms} from '@/server/proxy-management/catalog-management';
// Review 29/10/2026 of the US number format (ab90868): old Vietnamese-style VND ("420.000") must never be read as 420, and a lone
// "12,345" in a field with more than 2 decimals (old meaning 12.345) is ambiguous.
const pp=(over:Partial<ReturnType<typeof emptyPurchase>>={})=>({...emptyPurchase(),...over});
describe('VND is whole đồng',()=>{
  it('refuses "420.000", "25.940", "24.000" with the thousands hint, and any decimal part of a VND amount',()=>{
    expect(parseMoneyNumber('420.000',amountOptions('VND')).error).toBe('VND không có phần lẻ — 420.000 là 420,000?');
    expect(parseMoneyNumber('25.940',{fraction:12,vndRate:true}).error).toBe('VND không có phần lẻ — 25.940 là 25,940?');
    expect(parseMoneyNumber('24.000',{fraction:12,vndRate:true}).error).toMatch(/24,000\?/);
    expect(parseMoneyNumber('1.500.000',amountOptions('VND')).error).toMatch(/1,500,000\?/);
    expect(parseMoneyNumber('420.5',amountOptions('VND')).error).toMatch(/VND không có phần lẻ/);
    expect(parseMoneyNumber('420,000',amountOptions('VND'))).toEqual({value:'420000',error:null});
    expect(parseMoneyNumber('25,940.5',{fraction:12,vndRate:true})).toEqual({value:'25940.5',error:null});
    // Other currencies keep their decimals.
    expect(parseMoneyNumber('16.125',amountOptions('USDT'))).toEqual({value:'16.125',error:null});
  });
  it('purchase money (Kho tài khoản, proxy import): VND total / unit price / rate and PPUSD rates',()=>{
    expect(readPurchase(pp({total:'420.000',currency:'VND',rate:'25,940'}),'PP').errors.total).toMatch(/420,000\?/);
    expect(readPurchase(pp({mode:'UNIT',unit:'70.000',quantity:'6',currency:'VND',rate:'25,940'}),'PP').errors.unit).toMatch(/70,000\?/);
    expect(readPurchase(pp({total:'420,000',currency:'VND',rate:'25.940'}),'PP').errors.rate).toMatch(/25,940\?/);
    const r=readPurchase(pp({total:'10',currency:'PPUSD',paypalVndRate:'24.000',vndUsdtRate:'25.940'}),'PP');
    expect(r.errors.paypalVndRate).toMatch(/24,000\?/);expect(r.errors.vndUsdtRate).toMatch(/25,940\?/);
    expect(readPurchase(pp({total:'420,000',currency:'VND',rate:'25,940'}),'PP')).toMatchObject({errors:{},payload:{amount:'420000',rate:'25940'}});
    // An exact division that is not whole đồng stays on the total.
    expect(switchMode(pp({total:'62,502',quantity:'4',currency:'VND',rate:'25,820'}),'UNIT')).toMatchObject({mode:'TOTAL',held:true});
  });
  it('PayPal transfer to VND: amounts whole, old-style rate refused',()=>{
    expect(checkTransfer({type:'EXCHANGE',currency:'USD',receivedCurrency:'VND',debited:'31',rate:'24.000',received:'744,000'}).errors.rate).toMatch(/24,000\?/);
    expect(checkTransfer({type:'EXCHANGE',currency:'USD',receivedCurrency:'VND',debited:'31',rate:'24,000',received:'744.000'}).errors.received).toMatch(/744,000\?/);
  });
  it('server: a non-whole VND cost amount or package price is refused',()=>{
    expect(()=>normalizeCostMoney({amount:'420',currency:'VND',rate:'25940'})).not.toThrow();
    expect(()=>normalizeCostMoney({amount:'420.5',currency:'VND',rate:'25940'})).toThrow(/đồng nguyên/);
    expect(()=>packageTerms({price:'140.5',priceCurrency:'VND'})).toThrow(/đồng nguyên/);
    expect(()=>packageTerms({price:'3750000',priceCurrency:'VND'})).not.toThrow();
    expect(()=>packageTerms({price:'27.5',priceCurrency:'USDT'})).not.toThrow();
  });
});
describe('a lone comma group is ambiguous where more than 2 decimals are allowed',()=>{
  it('SDK money refuses "12,345" / "1,125" and keeps unambiguous forms',()=>{
    expect(parseSdkAmount('12,345')).toEqual({error:'Ghi rõ: 12345 hoặc 12.345'});
    expect(parseSdkAmount('1,125')).toEqual({error:'Ghi rõ: 1125 hoặc 1.125'});
    expect(parseSdkAmount('12,345.5')).toEqual({value:'12345.5'});
    expect(parseSdkAmount('1,234,567')).toEqual({value:'1234567'});
    expect(parseSdkAmount('12.345')).toEqual({value:'12.345'});
  });
  it('USDT amounts and unit prices refuse it; VND and 2-decimal USD fields accept "1,234"',()=>{
    expect(readPurchase(pp({total:'1,125'}),'PP').errors.total).toBe('Ghi rõ: 1125 hoặc 1.125');
    expect(readPurchase(pp({mode:'UNIT',unit:'1,125',quantity:'2'}),'PP').errors.unit).toBe('Ghi rõ: 1125 hoặc 1.125');
    expect(readPurchase(pp({total:'1,125.5'}),'PP').errors).toEqual({});
    expect(parseMoneyNumber('1,234',amountOptions('VND'))).toEqual({value:'1234',error:null});
    expect(parsePositiveAmount('1,234')).toEqual({value:'1234',error:null});
  });
});
