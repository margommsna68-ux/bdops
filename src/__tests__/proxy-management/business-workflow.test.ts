import {expect,it} from 'vitest';
import {monthRange,commandKeyStore,financialStatus} from '@/components/business-management/workflow';
it('retries retain the command key while changed form data gets a new key',()=>{
 let n=0;const key=commandKeyStore(()=>String(++n));expect(key({amount:'1'})).toBe('1');expect(key({amount:'1'})).toBe('1');expect(key({amount:'2'})).toBe('2');
});
it('month and recorded statuses stay explicit without assuming money arrived',()=>{
 expect(monthRange('2026-02')).toEqual({start:'2026-02-01',end:'2026-02-28'});
 expect(monthRange('2024-02').end).toBe('2024-02-29');expect(()=>monthRange('2026-13')).toThrow();
 expect(financialStatus('FUND',{confirmed:false,failed:false})).toBe('Chờ nhận');
 expect(financialStatus('WITHDRAWAL',{type:'MIXING',paidToTeam:true})).toBe('Chuyển nội bộ');
});
