import {it,expect} from 'vitest';
import {selectFinanceView,formatExact} from '@/components/business-management/team-cash-workflow';
import {commandKeyStore} from '@/components/business-management/workflow';
it('selects the effective finance mode and retries only an identical complete money input',()=>{
 expect(selectFinanceView({businessMode:null,teamCashEnabled:false})).toBe('LEGACY');expect(selectFinanceView({businessMode:'PROXY_VM',teamCashEnabled:false})).toBe('MANAGED_LEGACY_BASIS');
 expect(formatExact('2500000.00000000')).toBe('2.500.000');expect(formatExact('-100.123456')).toBe('-100,123456');
 let n=0;const key=commandKeyStore(()=>String(++n));const input={amount:'1',rate:'25000',source:'receipt',treatment:'CASH_COST'};
 expect(key(input)).toBe(key({...input}));expect(key({...input,rate:'27000'})).not.toBe(key(input));
});
