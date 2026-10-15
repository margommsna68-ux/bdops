import {describe,it,expect} from 'vitest';
import {allocateUsdt,normalizeCostMoney,parseOriginalMoney,parseUsdt} from '@/server/business-management/usdt-money';

describe('exact USDT conversion',()=>{
 it('preserves original money and freezes an explicit directional quote',()=>{
  expect(normalizeCostMoney({amount:'2500000',currency:' vnd ',rate:'25000'})).toEqual({amount:'2500000.00000000',currency:'VND',rate:'25000.000000000000',usdt:'100.000000'});
  expect(normalizeCostMoney({amount:'1.000001',currency:'USDT'}).usdt).toBe('1.000001');
  expect(normalizeCostMoney({amount:'1',currency:'EUR',rate:'3'}).usdt).toBe('0.333333');
  expect(normalizeCostMoney({amount:'0.0000015',currency:'EUR',rate:'1'}).usdt).toBe('0.000002');
  expect(normalizeCostMoney({amount:'0.00000001',currency:'EUR',rate:'0.000000000001'}).usdt).toBe('10000.000000');
 });
 it('requires real rates and rejects zero, ambiguous or overflowing values',()=>{
  for(const input of [{amount:'1',currency:'USD'},{amount:'1',currency:'USDT',rate:'2'},{amount:'1',currency:'EUR',rate:'0'},{amount:'0.00000001',currency:'EUR',rate:'1'},{amount:'9999999999999999',currency:'EUR',rate:'0.000000000001'}])expect(()=>normalizeCostMoney(input)).toThrow();
  for(const amount of ['0','-1','1e3','Infinity','NaN',' ',' 1','01','1.000000001','10000000000000000'])expect(()=>parseOriginalMoney(amount)).toThrow();
  for(const rate of ['-1','1e3','1.0000000000001','1000000000000'])expect(()=>normalizeCostMoney({amount:'1',currency:'EUR',rate})).toThrow();
  expect(()=>normalizeCostMoney({amount:'1',currency:'US$'})).toThrow();
  expect(parseOriginalMoney('9999999999999999.99999999')).toBe('9999999999999999.99999999');
  expect(parseUsdt('999999999999999999.999999')).toBe('999999999999999999.999999');
  for(const v of ['0','1.0000001','1000000000000000000'])expect(()=>parseUsdt(v)).toThrow();
 });
 it('allocates signed micro-USDT exactly and deterministically',()=>{
  const partners=[{name:'A',percentage:'50'},{name:'B',percentage:'50'}];
  expect(allocateUsdt('0.000001',partners).map(x=>x.amount)).toEqual(['0.000001','0.000000']);
  expect(allocateUsdt('-0.000001',partners).map(x=>x.amount)).toEqual(['-0.000001','0.000000']);
  expect(allocateUsdt('-0',partners).map(x=>x.amount)).toEqual(['0.000000','0.000000']);
  expect(()=>allocateUsdt('1',[partners[0],partners[0]])).toThrow();
  expect(()=>allocateUsdt('1',[{name:'A',percentage:'99'}])).toThrow();
  expect(allocateUsdt('99999999999999999999.999999',[{name:'A',percentage:'100'}])[0].amount).toBe('99999999999999999999.999999');
 });
});
