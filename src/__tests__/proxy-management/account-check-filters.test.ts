import {expect,it} from 'vitest';
import {readAccountUrl,writeAccountUrl,switchKind,openView,orderLoginRows,PAGE_SIZE} from '@/components/account-store/account-url';
import {accountCheckState} from '@/components/account-store/check-status';

it('retains result/source filtering and sort in URL and clears them on tab/history changes',()=>{
  const u=readAccountUrl(new URLSearchParams('check=APPLE_LOCKED&source=Shop+%C4%90%E1%BB%8F&sort=SOURCE_DESC&page=2'),'login');
  expect(u).toMatchObject({check:'APPLE_LOCKED',source:'Shop Đỏ',sort:'SOURCE_DESC',page:2});
  expect(readAccountUrl(new URLSearchParams(writeAccountUrl(u,'login')),'login')).toEqual(u);
  expect(writeAccountUrl(switchKind(u,'paypal'),'login')).not.toMatch(/check=|source=|sort=/);
  expect(writeAccountUrl(openView(u,'history'),'login')).not.toMatch(/check=|source=|sort=/);
  const missing=readAccountUrl(new URLSearchParams('sourceMissing=1&source=Shop'),'login');
  expect(missing).toMatchObject({sourceMissing:true});expect(missing.source).toBeUndefined();
});
it('uses the active/latest check exactly as the cell, retaining stale and not-applicable states',()=>{
  const base={accountId:'a',createdAt:'2026-10-25T01:00:00Z',result:'APPLE_LOCKED',cleanup:'OK',phase:'DONE',stale:false};
  expect(accountCheckState('GMAIL','a',[base])).toBe('NOT_APPLICABLE');
  expect(accountCheckState('APPLE_ID','a',[])).toBe('UNCHECKED');
  expect(accountCheckState('APPLE_ID','a',[base])).toBe('APPLE_LOCKED');
  expect(accountCheckState('APPLE_ID','a',[{...base,stale:true}])).toBe('STALE');
  expect(accountCheckState('APPLE_ID','a',[base,{...base,createdAt:'2026-10-25T02:00:00Z',phase:'QUEUED',result:null,cleanup:null}])).toBe('CHECKING');
  expect(accountCheckState('APPLE_ID','a',[base],false)).toBe('UNAVAILABLE');
});
it('sorts source/result across the complete dataset before pagination, with missing sources last both ways',()=>{
  const rows=Array.from({length:PAGE_SIZE+5},(_,n)=>({id:String(n),email:n+'@example.invalid',status:'ACTIVE',source:n===104?'A Shop':n===0?null:'B Shop',checkState:n===104?'APPLE_LOCKED' as const:'LIVE_2FA' as const}));
  expect(orderLoginRows(rows,'SOURCE').slice(0,PAGE_SIZE)[0].id).toBe('104');
  expect(orderLoginRows(rows,'SOURCE_DESC').at(-1)?.id).toBe('0');
  expect(orderLoginRows(rows,'CHECK_STATUS')[0].id).toBe('104');
  expect(orderLoginRows(rows,'CHECK_STATUS_DESC').at(-1)?.id).toBe('104');
});
