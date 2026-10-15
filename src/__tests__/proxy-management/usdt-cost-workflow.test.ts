import {it,expect} from 'vitest';
import {costPreview,changeCostCurrency,selectFinanceView} from '@/components/business-management/team-cash-workflow';
it('clears an incompatible quote when changing currency and previews exact USDT',()=>{
 expect(costPreview({amount:'2500000',currency:'VND',rate:'25000'})).toBe('100.000000');
 expect(changeCostCurrency({amount:'1',currency:'VND',rate:'25000'},'USD').rate).toBe('');
 expect(changeCostCurrency({amount:'1',currency:'VND',rate:'25000'},'USDT').rate).toBe('1');
 expect(selectFinanceView({businessMode:null,teamCashEnabled:true})).toBe('TEAM_CASH');
});
