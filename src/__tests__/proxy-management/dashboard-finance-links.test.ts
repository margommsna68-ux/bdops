import {describe,expect,it} from 'vitest';
import {financeTargets} from '@/components/dashboard/finance-links';
import {links,readPeriod} from '@/lib/links';
const params=(s:string)=>new URLSearchParams(s);
describe('Tổng quan finance links',()=>{
  it('opens each money list on the dashboard month, and a chart column on its own day',()=>{
    const t=financeTargets({withdrawals:true,costs:true,profit:true},'2026-09');
    expect(t.received).toBe('/withdrawals?month=2026-09');expect(t.cost).toBe('/costs?month=2026-09');expect(t.profit).toBe('/profit?month=2026-09');
    expect(t.unverified).toBe('/withdrawals?view=sources&month=2026-09');
    expect(t.receivedDay('2026-09-15')).toBe('/withdrawals?month=2026-09&date=2026-09-15');expect(t.costDay('2026-09-03')).toBe('/costs?month=2026-09&date=2026-09-03');
  });
  it('only links to lists the member may read; the numbers themselves stay',()=>{
    const profitOnly=financeTargets({withdrawals:false,costs:false,profit:true},'2026-09');
    expect(profitOnly).toMatchObject({received:null,cost:null,unverified:null,profit:'/profit?month=2026-09'});
    expect(profitOnly.receivedDay('2026-09-15')).toBeNull();expect(profitOnly.costDay('2026-09-15')).toBeNull();
    const costsOnly=financeTargets({withdrawals:false,costs:true,profit:true},'2026-09');expect(costsOnly.cost).toBe('/costs?month=2026-09');expect(costsOnly.received).toBeNull();
    const receiptsOnly=financeTargets({withdrawals:true,costs:false,profit:true},'2026-09');expect(receiptsOnly.received).toBe('/withdrawals?month=2026-09');expect(receiptsOnly.costDay('2026-09-01')).toBeNull();
  });
  it('the money pages read the same month and day back; a day outside the month or a bad value is ignored',()=>{
    expect(readPeriod(params('month=2026-09&date=2026-09-15'),'2026-10')).toEqual({month:'2026-09',date:'2026-09-15'});
    expect(readPeriod(params('date=2026-09-15'),'2026-10')).toEqual({month:'2026-09',date:'2026-09-15'});
    expect(readPeriod(params('month=2026-09&date=2026-08-15'),'2026-10')).toEqual({month:'2026-09',date:null});
    expect(readPeriod(params('month=2026-13'),'2026-10')).toEqual({month:'2026-10',date:null});
    expect(readPeriod(params(''),'2026-10')).toEqual({month:'2026-10',date:null});
    expect(links.costs({date:'bad',month:'2026-09'})).toBe('/costs?month=2026-09');expect(links.profit()).toBe('/profit');
  });
});
