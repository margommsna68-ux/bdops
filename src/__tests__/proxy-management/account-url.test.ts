import {describe,expect,it} from 'vitest';
import {openView,readAccountUrl,sameQuery,switchKind,writeAccountUrl} from '@/components/account-store/account-url';
import {appendToBatch,discardDraft,importDraft} from '@/components/account-store/ImportPanel';
import {links} from '@/lib/links';
const params=(s:string)=>new URLSearchParams(s);
describe('Kho tài khoản URL',()=>{
  it('two kind tabs; history and review are views inside the kind; the page kind is the default',()=>{
    expect(readAccountUrl(params(''),'login')).toEqual({tab:'login',view:'',q:'',type:'',state:'',batch:'',pp:'',show:'',month:'',asof:''});
    expect(readAccountUrl(params(''),'paypal').tab).toBe('paypal');
    const u=readAccountUrl(params('tab=paypal&view=history&batch=PP-2026-10-17'),'login');expect(u).toMatchObject({tab:'paypal',view:'history',batch:'PP-2026-10-17'});
    expect(writeAccountUrl(u,'login')).toBe('?tab=paypal&view=history&batch=PP-2026-10-17');expect(writeAccountUrl(u,'paypal')).toBe('?view=history&batch=PP-2026-10-17');
    expect(links.accounts({tab:'paypal',view:'review'})).toBe('/gmails?tab=paypal&view=review');
  });
  it('old Lô nhập / Cần kiểm tra links open the same content in the kind of the page they were on',()=>{
    expect(readAccountUrl(params('tab=batch'),'paypal')).toMatchObject({tab:'paypal',view:'history'});
    expect(readAccountUrl(params('tab=review'),'login')).toMatchObject({tab:'login',view:'review'});
    expect(writeAccountUrl(readAccountUrl(params('tab=batch'),'paypal'),'paypal')).toBe('?view=history');
    expect(sameQuery('?view=history','view=history')).toBe(true);expect(sameQuery('?tab=batch','?view=history')).toBe(false);
  });
  it('switching kind drops the other kind’s filters; a view keeps the kind; bad values are ignored',()=>{
    const u=readAccountUrl(params('type=APPLE_ID&state=NEW&q=abc&batch=TK-1'),'login');
    expect(switchKind(u,'paypal')).toEqual({tab:'paypal',view:'',q:'',type:'',state:'',batch:'',month:''});
    expect(openView(u,'history','TK-1')).toMatchObject({tab:'login',view:'history',batch:'TK-1',q:'',state:''});
    expect(readAccountUrl(params('tab=paypal&type=GMAIL&state=WHATEVER'),'login')).toMatchObject({type:'',state:''});
  });
});
describe('PayPal rows in the URL',()=>{
  it('opens the emails of a PayPal or the rows behind its money, with the month; only on the PayPal tab',()=>{
    const u=readAccountUrl(params('tab=paypal&pp=pp-13&show=in&month=2026-09'),'login');expect(u).toMatchObject({pp:'pp-13',show:'in',month:'2026-09'});
    expect(writeAccountUrl(u,'login')).toBe('?tab=paypal&month=2026-09&pp=pp-13&show=in');
    expect(readAccountUrl(params('pp=pp-13&show=in'),'login')).toMatchObject({pp:'',show:''});
    expect(readAccountUrl(params('tab=paypal&pp=x&show=bad&month=2026-13'),'login')).toMatchObject({show:'',month:''});
    // Without a month, an open money list keeps its cut-off day; it is dropped with a month, for the email list, or when malformed.
    const d=readAccountUrl(params('tab=paypal&pp=pp-13&show=in&asof=2026-10-18'),'login');expect(d.asof).toBe('2026-10-18');
    expect(writeAccountUrl(d,'login')).toBe('?tab=paypal&pp=pp-13&show=in&asof=2026-10-18');
    expect(readAccountUrl(params('tab=paypal&pp=pp-13&show=in&month=2026-09&asof=2026-10-18'),'login').asof).toBe('');
    expect(readAccountUrl(params('tab=paypal&pp=pp-13&show=emails&asof=2026-10-18'),'login').asof).toBe('');
    expect(readAccountUrl(params('tab=paypal&pp=pp-13&show=out&asof=18-10-2026'),'login').asof).toBe('');
  });
});
describe('import drafts',()=>{
  it('are kept per project and kind, never shared between Gmail and PayPal or across projects',()=>{
    const a=importDraft('p1','PAYPAL'),b=importDraft('p1','LOGIN'),c=importDraft('p2','PAYPAL');
    a.values.text='tut-01 | pp@example.invalid';expect(importDraft('p1','PAYPAL').values.text).toBe('tut-01 | pp@example.invalid');
    expect(b.values.text).toBeUndefined();expect(c.values.text).toBeUndefined();
    // Nhập bổ sung keeps what was typed but targets that purchase and drops the old preview; discarding empties only that draft.
    a.values.preview={rows:[]};a.values.amount='10';appendToBatch(a,{id:'b1',code:'PP-1',type:null});
    expect(a.values).toMatchObject({text:'tut-01 | pp@example.invalid',target:{id:'b1',code:'PP-1'}});expect(a.values.preview).toBeUndefined();expect(a.values.amount).toBeUndefined();
    b.values.text='x@example.invalid';discardDraft(a);expect(a.values).toEqual({});expect(b.values.text).toBe('x@example.invalid');
  });
});
