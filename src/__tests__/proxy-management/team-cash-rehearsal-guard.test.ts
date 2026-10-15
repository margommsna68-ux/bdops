import {it,expect} from 'vitest';
import {assertCashRehearsalTarget} from '@/server/business-management/rehearsal-guard';
it('restricts rehearsal to a separate explicitly named loopback database',()=>{
 const base='postgresql://test:test@127.0.0.1:55432/';
 expect(assertCashRehearsalTarget(base+'proxy_cash_verify_a',[])).toMatchObject({host:'127.0.0.1',port:'55432',database:'proxy_cash_verify_a'});
 for(const target of ['postgresql://x:x@remote.invalid/proxy_cash_verify_a',base+'proxy_app_trial',base+'proxy_cash_verify_a?host=remote.invalid',base+'proxy_cash_verify_a?options=-c%20search_path=other'])expect(()=>assertCashRehearsalTarget(target,[])).toThrow();
 expect(()=>assertCashRehearsalTarget(base+'proxy_cash_restore_a',[base+'proxy_cash_restore_a'])).toThrow();
 expect(()=>assertCashRehearsalTarget(process.env.DATABASE_URL_TEST!,[process.env.DATABASE_URL_TEST!])).toThrow();
});
