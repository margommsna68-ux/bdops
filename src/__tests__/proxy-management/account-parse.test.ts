import {expect,it} from 'vitest';
import {parseLoginLines,parsePaypalLines,parseLinkLines} from '@/server/account-store/parse';
it('login lines: tab, | or : columns, header skipped, emails lowercased, every line kept',()=>{
  const rows=parseLoginLines(['Email\tMật khẩu','A@Example.invalid\tp:w\t2fa\trec@example.invalid\tghi chú','b@example.invalid|pw','c@example.invalid:pw:2fa','sai dòng'].join('\n'));
  expect(rows.map(r=>[r.line,r.email,r.password,r.twoFa,r.recovery,r.error])).toEqual([[2,'a@example.invalid','p:w','2fa','rec@example.invalid',null],[3,'b@example.invalid','pw',null,null,null],[4,'c@example.invalid','pw','2fa',null,null],[5,'sai dòng',null,null,null,expect.any(String)]]);
});
it('PayPal lines: Mã PP then one or more emails, separated by spaces, tabs or | (format example only)',()=>{
  expect(parsePaypalLines('tut-09 | pp09@example.invalid\ntut-10\tPP10@example.invalid  pp10b@example.invalid\ntut-11\ntut-12 a@example.invalid a@example.invalid\ntut-13 bad').map(r=>[r.code,r.emails,r.repeated,!!r.error])).toEqual([['tut-09',['pp09@example.invalid'],[],false],['tut-10',['pp10@example.invalid','pp10b@example.invalid'],[],false],['tut-11',[],[],true],['tut-12',['a@example.invalid'],['a@example.invalid'],false],['tut-13',[],[],true]]);
});
it('link lines: Server | VM | Tài khoản | Email PP (or Mã PP | Email PP); a PayPal code alone is refused; empty keeps, "-" clears',()=>{
  const rows=parseLinkLines('Server|VM|Tài khoản|Email PP\nmoon1|M-001|a@example.invalid|pp1@example.invalid\nmoon1|M-002||tut-10|PP2@example.invalid\nmoon1|M-003|-\nmoon1|M-004\nmoon1|M-005|b@example.invalid|tut-10\nmoon1|M-006||-');
  expect(rows.map(r=>[r.vm,r.login,r.paypalCode,r.paypalEmail,!!r.error])).toEqual([['M-001','a@example.invalid',undefined,'pp1@example.invalid',false],['M-002',undefined,'tut-10','pp2@example.invalid',false],['M-003','-',undefined,undefined,false],['M-004',undefined,undefined,undefined,true],['M-005','b@example.invalid',undefined,undefined,true],['M-006',undefined,undefined,'-',false]]);
});
