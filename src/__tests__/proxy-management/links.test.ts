import {describe,expect,it} from 'vitest';
import {links} from '@/lib/links';
import {readGridUrl,writeGridUrl} from '@/components/vm-management/vm-grid/grid-model';
import {filterKey,readRegistryUrl,writeRegistryUrl} from '@/components/proxy-management/registry-url';
import {UNASSIGNED_SERVER} from '@/server/proxy-management/types';
const params=(s:string)=>new URLSearchParams(s);
describe('shared link builder',()=>{
  it('opens the Server / VM grid on the server, view, VM and tab that the grid itself reads back',()=>{
    expect(links.vms()).toBe('/infrastructure/servers');
    expect(links.vms({view:'MISSING'})).toBe('/infrastructure/servers?view=MISSING');
    const href=links.vms({serverId:'srv1',vm:'vm9',tab:'proxy'});expect(href).toBe('/infrastructure/servers/srv1?vm=vm9&tab=proxy');
    const back=readGridUrl(params(href.split('?')[1]));expect(back).toMatchObject({vm:'vm9',tab:'proxy',view:''});expect(writeGridUrl(back)).toBe('?vm=vm9&tab=proxy');
    for(const view of ['ACCOUNT_MISSING','PAYPAL_MISSING','SDK_MISSING','REVIEW','ASSIGNED','BLOCKED'] as const)expect(readGridUrl(params(links.vms({view}).split('?')[1])).view).toBe(view);
    // Links from before 19/10/2026: Chờ cài / Đã cài open "Có proxy", the orphan-task view and the install tab are gone.
    expect(readGridUrl(params('view=PENDING')).view).toBe('ASSIGNED');expect(readGridUrl(params('view=TASK_ORPHAN')).view).toBe('');expect(readGridUrl(params('vm=v1&tab=install')).tab).toBe('proxy');
    expect(links.vms({tab:'proxy'})).toBe('/infrastructure/servers');// a tab without a VM means nothing
  });
  it('opens the registry with every filter the registry reads, OTHER state and history tab included',()=>{
    expect(links.proxies({state:'BLOCKED'})).toBe('/infrastructure/proxies?state=BLOCKED');
    const href=links.proxies({q:'1.2.3.4',group:'TUT',state:'OTHER',package:'due',servers:['moon1','none'],tab:'history'});
    const u=readRegistryUrl(params(href.split('?')[1]));
    expect(u).toEqual({q:'1.2.3.4',servers:['moon1',UNASSIGNED_SERVER],group:'TUT',state:'OTHER',pkg:'due',sort:'PACKAGE',view:'HISTORY',page:1,batch:''});
    expect('/infrastructure/proxies'+writeRegistryUrl(u)).toBe(href);
    expect(writeRegistryUrl({...u,sort:'IP'})).toContain('sort=IP');
    expect(readRegistryUrl(params(writeRegistryUrl({...u,state:'BLOCKED',pkg:'231243',sort:'BLOCKED_FIRST'}).slice(1)))).toMatchObject({state:'BLOCKED',pkg:'231243',sort:'BLOCKED_FIRST'});
    expect(readRegistryUrl(params('state=bogus&tab=nope&sort=x'))).toMatchObject({state:'',view:'CURRENT',sort:'PACKAGE'});
    expect(writeRegistryUrl(readRegistryUrl(params('group=SHARED')),'240292')).toBe('?group=SHARED&pay=240292');
    expect(filterKey(readRegistryUrl(params('group=TUT')))).not.toBe(filterKey(readRegistryUrl(params('group=TUT&tab=all'))));
  });
  it('keeps the registry page in the URL; a filter change is a new result, a page change is not',()=>{
    const u=readRegistryUrl(params('group=TUT&state=NEW&page=2'));expect(u.page).toBe(2);expect(writeRegistryUrl(u)).toBe('?group=TUT&state=NEW&page=2');
    expect(writeRegistryUrl({...u,page:1})).toBe('?group=TUT&state=NEW');
    expect(filterKey(u)).toBe(filterKey({...u,page:5}));expect(filterKey(u)).not.toBe(filterKey({...u,state:'LIVE'}));
    for(const bad of ['0','-1','abc','1.5','9999999'])expect(readRegistryUrl(params('page='+bad)).page).toBe(1);
    expect(links.proxies({state:'BLOCKED',page:3})).toBe('/infrastructure/proxies?state=BLOCKED&page=3');
  });
  it('keeps the three money flows apart and builds filtered work, install and cost links',()=>{
    expect(links.teamReceipts()).toBe('/withdrawals');expect(links.teamReceipts({sources:true})).toBe('/withdrawals?view=sources');
    expect(links.originalWithdrawals(true)).toBe('/withdrawals?view=original');expect(links.originalWithdrawals(false)).toBe('/withdrawals');
    expect(links.paypalIn()).toBe('/funds');
    expect(links.costs({month:'2026-10',server:'s1'})).toBe('/costs?month=2026-10&server=s1');expect(links.costs({month:'bad'})).toBe('/costs');
    expect(links.work({kind:'SHEET_REVIEW'})).toBe('/work?kind=SHEET_REVIEW');expect(links.work({kind:'TASK',vm:'v1'})).toBe('/work?vm=v1');
    // 19/10/2026: no install step; old install links open the VM (or Server / VM).
    expect(links.installs({vm:'v1'})).toBe('/infrastructure/servers?vm=v1');expect(links.installs()).toBe('/infrastructure/servers');
    expect(links.accounts({tab:'paypal'})).toBe('/gmails?tab=paypal');expect(links.accounts({tab:'login'})).toBe('/gmails');
  });
  it('opens package payment in the package list',()=>{
    expect(links.packages()).toBe('/infrastructure/proxies?packages=due');expect(links.packages({pay:'231243'})).toBe('/infrastructure/proxies?pay=231243');
  });
});
