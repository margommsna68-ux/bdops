import {describe,expect,it} from 'vitest';
import {orderLoginRows,openView,PAGE_SIZE,readAccountUrl,switchKind,withFilter,writeAccountUrl} from '@/components/account-store/account-url';

const read=(query:string,initial:'login'|'paypal'='login')=>readAccountUrl(new URLSearchParams(query),initial);
describe('login status and sort URL state',()=>{
  it('preserves the existing default order and URLs without extra filter keys',()=>{
    expect(read('')).not.toHaveProperty('status');expect(read('')).not.toHaveProperty('sort');
    expect(writeAccountUrl(read('sort=CREATED'),'login')).toBe('');
  });
  it.each(['APPLE_LOCKED','GOOGLE_VERIFY','GOOGLE_DISABLED','ACTIVE','SUSPENDED'])('round-trips exact status %s separately from inventory state',status=>{
    const u=read('state=ASSIGNED&status='+status+'&sort=LATEST_ISSUE&page=2');
    expect(u).toMatchObject({state:'ASSIGNED',status,sort:'LATEST_ISSUE',page:2});
    expect(read(writeAccountUrl(u,'login'))).toEqual(u);
    expect(withFilter(u,{status:'GOOGLE_VERIFY'})).toMatchObject({page:1,status:'GOOGLE_VERIFY',sort:'LATEST_ISSUE'});
  });
  it('drops invalid values and login filters on PayPal, including direct PayPal URLs',()=>{
    const u=read('type=APPLE_ID&status=APPLE_LOCKED&sort=ERRORS_FIRST&page=3');
    expect(read(writeAccountUrl(switchKind(u,'paypal'),'login'))).not.toHaveProperty('status');
    expect(read('tab=paypal&status=GOOGLE_DISABLED&sort=EMAIL')).not.toHaveProperty('sort');
    expect(writeAccountUrl({...u,tab:'paypal'},'login')).not.toMatch(/status=|sort=/);
    expect(read('status=WRONG&sort=WRONG')).not.toHaveProperty('status');
    expect(openView(u,'history')).not.toHaveProperty('status');
  });
});
describe('login ordering before pagination',()=>{
  const rows=[{email:'z@example.invalid',status:'ACTIVE',loginIssueAt:null},
    {email:'c@example.invalid',status:'GOOGLE_VERIFY',loginIssueAt:'2026-10-24T03:00:00Z'},
    {email:'b@example.invalid',status:'APPLE_LOCKED',loginIssueAt:'2026-10-24T06:00:00Z'},
    {email:'a@example.invalid',status:'GOOGLE_DISABLED',loginIssueAt:null}];
  it('keeps original created order by default, and errors-first keeps stable order inside each group',()=>{
    expect(orderLoginRows(rows).map(r=>r.email)).toEqual(['z@example.invalid','c@example.invalid','b@example.invalid','a@example.invalid']);
    expect(orderLoginRows(rows,'ERRORS_FIRST').map(r=>r.email)).toEqual(['c@example.invalid','b@example.invalid','a@example.invalid','z@example.invalid']);
    expect(rows[0].email).toBe('z@example.invalid');
  });
  it('sorts latest issue newest first with missing/invalid dates last; email is ascending',()=>{
    expect(orderLoginRows(rows,'LATEST_ISSUE').map(r=>r.email)).toEqual(['b@example.invalid','c@example.invalid','z@example.invalid','a@example.invalid']);
    expect(orderLoginRows(rows,'EMAIL').map(r=>r.email)).toEqual(['a@example.invalid','b@example.invalid','c@example.invalid','z@example.invalid']);
    expect(orderLoginRows([{...rows[0],loginIssueAt:'bad-date'},rows[1]],'LATEST_ISSUE')[0].email).toBe('c@example.invalid');
  });
  it('brings an issue beyond the first page onto the first page when ordered first',()=>{
    const many=[...Array.from({length:PAGE_SIZE},(_,i)=>({...rows[0],email:`${i}@example.invalid`})),rows[2]];
    expect(orderLoginRows(many,'ERRORS_FIRST').slice(0,PAGE_SIZE)[0].email).toBe('b@example.invalid');
  });
});
