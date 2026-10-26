import {it,expect} from 'vitest';
import {compareVmColumn,readGridUrl,writeGridUrl} from '@/components/vm-management/vm-grid/grid-model';
it('column sorting compares money numerically and retains missing values last in both directions',()=>{
 for(const desc of [false,true]){expect(compareVmColumn(null,0,desc)).toBeGreaterThan(0);expect(compareVmColumn(0,null,desc)).toBeLessThan(0);}
 expect([10,2,0,null].sort((a,b)=>compareVmColumn(a,b))).toEqual([0,2,10,null]);
 expect([10,2,0,null].sort((a,b)=>compareVmColumn(a,b,true))).toEqual([10,2,0,null]);
 expect(compareVmColumn('a@example.invalid','b@example.invalid')).toBeLessThan(0);
});
it('all header sort modes survive URL reload',()=>{
 for(const sort of ['BALANCE','BALANCE_ASC','OPS_ASC','OPS_DESC','ACCOUNT_ASC','ACCOUNT_DESC']){
 const u=readGridUrl(new URLSearchParams({sort}));expect(u.sort).toBe(sort);expect(readGridUrl(new URLSearchParams(writeGridUrl(u))).sort).toBe(sort);
 }
});
