import {describe,expect,it} from 'vitest';
import {checkTransfer} from '@/lib/paypal-transfer';
// One rule for TransferForm and recordTransfer (review 18/10/2026): the fee is in the source currency and inside the total debited;
// received = round_half_up((debited − fee) × rate, 2) − receiver fee; same currency: rate 1.
const base={type:'MIXING' as const,currency:'USD',receivedCurrency:'USD',debited:'31',fee:'1',received:null as string|null,rate:null as string|null,receiverFee:null as string|null};
describe('checkTransfer',()=>{
  it('same currency: the receiving side gets debited − fee; 31 incl. fee 1 → 30',()=>{
    const r=checkTransfer({...base,received:'30'});expect(r.errors).toEqual({});expect(r.expected).toBe('30.00');
  });
  it('refuses 31 debited, fee 1, received 31 at the received field',()=>{
    const r=checkTransfer({...base,received:'31'});expect(r.expected).toBe('30.00');expect(r.errors.received).toMatch(/30,00 USD/);
  });
  it('different currency: (31 − 1) × 25 000 = 750 000 VND; 30 VND is refused',()=>{
    expect(checkTransfer({...base,receivedCurrency:'VND',rate:'25000',received:'750000'}).errors).toEqual({});
    const r=checkTransfer({...base,receivedCurrency:'VND',rate:'25000',received:'30'});expect(r.expected).toBe('750000.00');expect(r.errors.received).toMatch(/750\.000,00 VND/);
    expect(checkTransfer({...base,receivedCurrency:'VND',received:'750000'}).errors.rate).toMatch(/tỷ giá/i);
  });
  it('rounds half up to 2 decimals: 10 × 0.99 = 9.90; 0.03 × 0.5 = 0.015 → 0.02',()=>{
    expect(checkTransfer({...base,debited:'10',fee:null,receivedCurrency:'USDT',rate:'0.99',received:'9.9'}).errors).toEqual({});
    expect(checkTransfer({...base,debited:'0.03',fee:null,receivedCurrency:'USDT',rate:'0.5'}).expected).toBe('0.02');
  });
  it('a receiving-side fee is explicit, in the receiving currency, and taken from the computed amount',()=>{
    expect(checkTransfer({...base,receiverFee:'0.5',received:'29.5'}).errors).toEqual({});
    expect(checkTransfer({...base,receiverFee:'0.5',received:'30'}).errors.received).toMatch(/29,50/);
    expect(checkTransfer({...base,receiverFee:'30',received:'0'}).errors.receiverFee).toBeTruthy();
  });
  it('checks each field: fee inside the total, bad numbers, missing received on an internal transfer',()=>{
    expect(checkTransfer({...base,fee:'31',received:'0'}).errors.fee).toBeTruthy();
    expect(checkTransfer({...base,debited:'abc'}).errors.debited).toBeTruthy();
    expect(checkTransfer({...base,fee:'1.234',received:'30'}).errors.fee).toBeTruthy();
    expect(checkTransfer({...base}).errors.received).toMatch(/thực nhận/);
    expect(checkTransfer({...base,type:'EXCHANGE'}).errors).toEqual({});// out to outside: received only if known
    expect(checkTransfer({...base,type:'EXCHANGE',received:'31'}).errors.received).toBeTruthy();
    expect(checkTransfer({...base,rate:'2',received:'30'}).errors.rate).toBeTruthy();// same currency takes no rate
  });
});
