import {describe,it,expect} from 'vitest';
import {normalizeCostMoney} from '@/server/business-management/usdt-money';
describe('PayPal dollars are converted through their recorded VND value',()=>{
 it('keeps the two rates and calculates the exact chain once',()=>{
  const r=normalizeCostMoney({amount:'250',currency:'PPUSD',paypalVndRate:'24000',vndUsdtRate:'25940'} as any);
  expect(r.usdt).toBe('231.303007');expect(r.currency).toBe('PPUSD');
 });
 it('does not accept an assumed direct USD rate or an example as a default',()=>{
  expect(()=>normalizeCostMoney({amount:'250',currency:'PPUSD',rate:'1'})).toThrow();
  expect(()=>normalizeCostMoney({amount:'250',currency:'PPUSD',paypalVndRate:'24000'} as any)).toThrow();
 });
 it('rejects inconsistent direct and chained rates',()=>{
  expect(()=>normalizeCostMoney({amount:'250',currency:'PPUSD',rate:'1',paypalVndRate:'24000',vndUsdtRate:'25940'} as any)).toThrow();
 });
 it('retains VND and historical USD behavior',()=>{
  expect(normalizeCostMoney({amount:'408000',currency:'VND',rate:'25940'}).usdt).toBe('15.728604');
  expect(normalizeCostMoney({amount:'250',currency:'USD',rate:'1'}).usdt).toBe('250.000000');
 });
});
