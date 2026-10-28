import {describe,it,expect} from 'vitest';
import {emptyPurchase,readPurchase,applyQuote,editRate,changeCurrency,switchMode} from '@/components/account-store/purchase-money';
import {formatMoney} from '@/lib/money-input';
const now=Date.parse('2026-10-23T12:00:00Z');
const draft=()=>({...emptyPurchase(),currency:'PPUSD',total:'250',quantity:'5',paypalVndRate:'24,000',vndUsdtRate:'25,820'});
describe('PayPal cost purchase chain',()=>{
 it('requires two explicit rates, never uses a legacy effective rate as a substitute',()=>{
  const r=readPurchase({...draft(),paypalVndRate:'',vndUsdtRate:'',rate:'1'},'PP',now);
  expect(r.errors).toHaveProperty('paypalVndRate');expect(r.errors).toHaveProperty('vndUsdtRate');expect(r.payload).toBeNull();
 });
 it('converts through VND and sends both chain rates without an effective input rate',()=>{
  const r=readPurchase({...draft(),rate:'999'},'PP',now);
  expect(r.usdt).toBe('232.378002');expect(r.payload).toMatchObject({amount:'250',currency:'PPUSD',paypalVndRate:'24000',vndUsdtRate:'25820',rate:null});
 });
 it('preserves the VND quote on PayPal rate edits and through unit/total switches',()=>{
  const quoted=applyQuote(draft(),{rate:'25820',token:'sealed-vnd',fetchedAt:new Date(now).toISOString(),side:'BUY'});
  expect(quoted.vndUsdtRate).toBe('25,820');expect(quoted.rate).toBe('');
  const changed={...quoted,paypalVndRate:'23,500'};
  const switched=switchMode(switchMode(changed,'UNIT'),'TOTAL');
  expect(switched).toMatchObject({paypalVndRate:'23,500',vndUsdtRate:'25,820',quote:quoted.quote});
  expect(readPurchase(switched,'PP',now).payload?.p2pQuoteToken).toBe('sealed-vnd');
  expect(editRate(switched,'26,000').quote).toBeNull();
  expect(readPurchase(switched,'PP',now+600000).payload).toBeNull();
  expect(changeCurrency(switched,'VND')).toMatchObject({paypalVndRate:'',vndUsdtRate:'',quote:null});
 });
 it('does not allow an older ordinary USD draft to become a new purchase cost',()=>{
  const r=readPurchase({...emptyPurchase(),currency:'USD',total:'20',rate:'1'},'PP',now);
  expect(r.payload).toBeNull();expect(r.errors).toHaveProperty('currency');
 });
 it('labels PayPal dollars distinctly without changing ordinary USD',()=>{
  expect(formatMoney('250','PPUSD')).toBe('$250.00 PayPal');expect(formatMoney('250','USD')).toBe('$250.00');
 });
});
