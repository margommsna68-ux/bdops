import {describe,expect,it} from 'vitest';
import {sidebarIdentity} from '@/components/layout/nav';
import {projectLabel} from '@/lib/utils';

// The sidebar footer names the user the way the Nhân viên page does (name, @username), never the project code.
describe('sidebarIdentity',()=>{
  it('shows the stored name like Nhân viên and the login as @username',()=>{
    expect(sidebarIdentity({name:'tut grove',username:'tut',email:'x@example.invalid'})).toEqual({name:'Tut Grove',handle:'@tut',initial:'T'});
  });
  it('falls back to the login, then the email, never to a project code',()=>{
    expect(sidebarIdentity({name:null,username:'tut'})).toEqual({name:'Tut',handle:'@tut',initial:'T'});
    expect(sidebarIdentity({email:'a@example.invalid'})).toEqual({name:'A@example.invalid',handle:'',initial:'A'});
    expect(sidebarIdentity({})).toEqual({name:'User',handle:'',initial:'U'});
  });
});
describe('Vietnamese names',()=>{
  it('capitalises each word without breaking accented letters',()=>{
    expect(sidebarIdentity({name:'bản thử',username:'proxy-trial'}).name).toBe('Bản Thử');
    expect(sidebarIdentity({name:'đặng văn ân'}).name).toBe('Đặng Văn Ân');
  });
});
describe('projectLabel',()=>{
  it('names a project by its name, the code only when there is no name',()=>{
    expect(projectLabel({code:'PERSONAL_SHEET',name:'MOON'})).toBe('MOON');
    expect(projectLabel({code:'AE',name:''})).toBe('AE');
    expect(projectLabel(null)).toBe('—');
  });
});
