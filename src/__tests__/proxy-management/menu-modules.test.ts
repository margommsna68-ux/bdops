import {afterEach,describe,expect,it,vi} from 'vitest';
import {personalItems,visibleMenu,type NavItem,type NavLinkItem} from '@/components/layout/nav';
import {parseModules} from '@/lib/features';
import {installTarget} from '@/components/layout/HiddenModule';
const hrefs=(items:NavItem[])=>items.filter((i):i is NavLinkItem=>!('type' in i)).map(i=>i.href);
const labels=(items:NavItem[])=>items.filter((i):i is NavLinkItem=>!('type' in i)).map(i=>i.labelKey);
describe('MoneyToHome menu',()=>{
  it('has one Kho proxy and one Kho tài khoản; Việc cài proxy, Giao việc and the separate PayPal item are gone',()=>{
    const menu=visibleMenu(personalItems(true),{role:'ADMIN',modules:[]});
    expect(labels(menu)).toEqual(['Tổng quan','Kho proxy','Server / VM','Kho tài khoản','Nhận USDT về team','Tiền vào PayPal','Rút / chuyển gốc','Chi phí','Lợi nhuận','Lịch sử thao tác','Nhân viên','Dự án','Thiết lập']);
    expect(hrefs(menu)).not.toContain('/paypals');expect(hrefs(menu)).not.toContain('/vm-tasks');expect(hrefs(menu)).not.toContain('/work');
  });
  it('switching a hidden module on brings its item back (central config, no settings screen)',()=>{
    const menu=visibleMenu(personalItems(false),{role:'ADMIN',modules:[]},parseModules('install_tasks, WORK ,bogus'));
    expect(hrefs(menu)).toEqual(expect.arrayContaining(['/vm-tasks','/work']));
    expect([...parseModules('WORK')]).toEqual(['WORK']);expect(parseModules(undefined).size).toBe(0);
  });
  it('a member with only the PayPal right still reaches Kho tài khoản, on its PayPal tab, and nothing more',()=>{
    const menu=visibleMenu(personalItems(true),{role:'USER',modules:['PAYPALS']});
    expect(labels(menu)).toEqual(['Tổng quan','Kho tài khoản','Lịch sử thao tác','Thiết lập']);
    const store=menu.find((i):i is NavLinkItem=>!('type' in i)&&i.labelKey==='Kho tài khoản')!;expect(store.href).toBe('/paypals');expect(store.also).toEqual(['/gmails']);
    // Server / VM staff open the login tab; a member with neither right gets no store link (no link that would be refused).
    expect(hrefs(visibleMenu(personalItems(true),{role:'USER',modules:['INFRASTRUCTURE']}))).toEqual(['/dashboard','/infrastructure/proxies','/infrastructure/servers','/gmails','/history','/settings']);
    expect(labels(visibleMenu(personalItems(true),{role:'USER',modules:['COSTS']}))).not.toContain('Kho tài khoản');
    // Nhân viên: admin, or a moderator granted user management — the page refuses other moderators.
    expect(labels(visibleMenu(personalItems(true),{role:'MODERATOR',modules:['PAYPALS']}))).not.toContain('Nhân viên');
    expect(labels(visibleMenu(personalItems(true),{role:'MODERATOR',modules:['PAYPALS'],canManageUsers:true}))).toContain('Nhân viên');
  });
  it('no project: only dashboard, settings and admin-only links; separators without items are dropped',()=>{
    const menu=visibleMenu(personalItems(true),{role:null,modules:[]});
    expect(hrefs(menu)).toEqual(['/dashboard','/admin/projects','/settings']);
    expect(menu.filter(i=>'type' in i).map(i=>i.labelKey)).toEqual(['Quản trị']);
  });
});
describe('old links to the hidden Việc cài proxy page',()=>{
  afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
  it('go to the VM install tab, the orphan filter or the pending filter in Server / VM',()=>{
    expect(installTarget('vm1','')).toBe('/infrastructure/servers?vm=vm1&tab=install');
    expect(installTarget(null,'#orphan')).toBe('/infrastructure/servers?view=TASK_ORPHAN');
    expect(installTarget(null,'')).toBe('/infrastructure/servers?view=PENDING');
  });
  it('point at /vm-tasks again once the module is switched on',async()=>{
    vi.stubEnv('NEXT_PUBLIC_MTH_MODULES','INSTALL_TASKS');vi.resetModules();
    const {links}=await import('@/lib/links');expect(links.installs({vm:'v1'})).toBe('/vm-tasks?vm=v1');
  });
});
