import {expect,it} from 'vitest';
import {parseLoginLines,parsePaypalLines,parseLinkLines} from '@/server/account-store/parse';
it('login lines: tab, | or : columns, header skipped, emails lowercased, every line kept',()=>{
  const rows=parseLoginLines(['Email\tMật khẩu','A@Example.invalid\tp:w\t2fa\trec@example.invalid\tghi chú','b@example.invalid|pw','c@example.invalid:pw:2fa','sai dòng'].join('\n'));
  expect(rows.map(r=>[r.line,r.email,r.password,r.twoFa,r.recovery,r.error])).toEqual([[2,'a@example.invalid','p:w','2fa','rec@example.invalid',null],[3,'b@example.invalid','pw',null,null,null],[4,'c@example.invalid','pw','2fa',null,null],[5,'sai dòng',null,null,null,expect.any(String)]]);
});
it('PayPal lines need exactly Mã PP | Email (format example only)',()=>{
  expect(parsePaypalLines('tut-09 | pp09@example.invalid\ntut-10\tPP10@example.invalid\ntut-11').map(r=>[r.code,r.email,!!r.error])).toEqual([['tut-09','pp09@example.invalid',false],['tut-10','pp10@example.invalid',false],['tut-11','',true]]);
});
it('link lines: Server | VM | Tài khoản | Mã PP; empty keeps, "-" clears',()=>{
  const rows=parseLinkLines('Server|VM|Tài khoản|Mã PP\nmoon1|M-001|a@example.invalid|tut-09\nmoon1|M-002||tut-10\nmoon1|M-003|-\nmoon1|M-004');
  expect(rows.map(r=>[r.vm,r.login,r.paypal,!!r.error])).toEqual([['M-001','a@example.invalid','tut-09',false],['M-002',undefined,'tut-10',false],['M-003','-',undefined,false],['M-004',undefined,undefined,true]]);
});
