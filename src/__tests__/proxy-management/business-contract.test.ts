import {expect,it} from 'vitest';
import {money,period,allocateCents} from '@/server/business-management/money';
it('uses exact decimal cents and rejects malformed or overflowing amounts',()=>{
  expect(money('0.10').plus(money('0.20')).toFixed(2)).toBe('0.30');
  for(const value of ['1e3','NaN','Infinity','-1','01.00','0.001','10000000000.00'])expect(()=>money(value)).toThrow();
});
it('uses valid Bangkok days and an exclusive next-day end',()=>{
  const range=period('2026-10-01','2026-10-31');expect(range.start.toISOString()).toBe('2026-09-30T17:00:00.000Z');expect(range.end.toISOString()).toBe('2026-10-31T17:00:00.000Z');
  for(const [start,end] of [['2026-02-30','2026-03-01'],['2026-10-14','2026-10-01'],['14/10/2026','2026-10-15']])expect(()=>period(start,end)).toThrow();
});
it('allocates all cents exactly including negative profit and rejects invalid percentage totals',()=>{
  const partners=[{name:'A',percentage:'33.33'},{name:'B',percentage:'66.67'}];
  expect(allocateCents('10.00',partners).map(p=>p.amount)).toEqual(['3.33','6.67']);
  expect(allocateCents('-0.01',partners).map(p=>p.amount)).toEqual(['0.00','-0.01']);
  expect(allocateCents('10000000000.00',[{name:'A',percentage:'100'}])[0].amount).toBe('10000000000.00');
  expect(()=>allocateCents('10.00',[{name:'A',percentage:'50'}])).toThrow();
  expect(()=>allocateCents('10.00',[{name:'A',percentage:'50'},{name:'A',percentage:'50'}])).toThrow();
});
