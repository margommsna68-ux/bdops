import {expect,it} from 'vitest';
import {matchPackage} from '@/server/proxy-management/catalog';
it('matches exact user and password, not user alone',()=>{
  const p={ip:'192.0.2.1',port:80,username:'test',password:'one',format:'FULL' as const};
  const catalog=[{id:'a',code:'account-a',username:'test',password:'one'},{id:'b',code:'account-b',username:'test',password:'two'}];
  expect(matchPackage(p,catalog)).toBe('account-a'); expect(matchPackage({...p,password:'two'},catalog)).toBe('account-b');expect(matchPackage({...p,password:'unknown'},catalog)).toBeNull();
  expect(matchPackage(p,[...catalog,{...catalog[0],id:'ambiguous',code:'other'}])).toBeNull();
});
