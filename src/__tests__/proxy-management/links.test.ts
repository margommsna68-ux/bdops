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
    const href=links.vms({serverId:'srv1',vm:'vm9',tab:'install'});expect(href).toBe('/infrastructure/servers/srv1?vm=vm9&tab=install');
    const back=readGridUrl(params(href.split('?')[1]));expect(back).toMatchObject({vm:'vm9',tab:'install',view:''});expect(writeGridUrl(back)).toBe('?vm=vm9&tab=install');
    for(const view of ['ACCOUNT_MISSING','PAYPAL_MISSING','SDK_MISSING','REVIEW','PENDING'] as const)expect(readGridUrl(params(links.vms({view}).split('?')[1])).view).toBe(view);
    expect(links.vms({tab:'install'})).toBe('/infrastructure/servers');// a tab without a VM means nothing
  });
  it('opens the registry with every filter the registry reads, OTHER state and history tab included',()=>{
    expect(links.proxies({state:'BLOCKED'})).toBe('/infrastructure/proxies?state=BLOCKED');
    const href=links.proxies({q:'1.2.3.4',group:'TUT',state:'OTHER',package:'due',servers:['moon1','none'],tab:'history'});
    const u=readRegistryUrl(params(href.split('?')[1]));
    expect(u).toEqual({q:'1.2.3.4',servers:['moon1',UNASSIGNED_SERVER],group:'TUT',state:'OTHER',pkg:'due',sort:'PACKAGE',view:'HISTORY'});
    expect('/infrastructure/proxies'+writeRegistryUrl(u)).toBe(href);
    expect(writeRegistryUrl({...u,sort:'IP'})).toContain('sort=IP');
    expect(readRegistryUrl(params('state=bogus&tab=nope&sort=x'))).toMatchObject({state:'',view:'CURRENT',sort:'PACKAGE'});
    expect(writeRegistryUrl(readRegistryUrl(params('group=SHARED')),'240292')).toBe('?group=SHARED&pay=240292');
    expect(filterKey(readRegistryUrl(params('group=TUT')))).not.toBe(filterKey(readRegistryUrl(params('group=TUT&tab=all'))));
  });
  it('keeps the three money flows apart and builds filtered work, install and cost links',()=>{
    expect(links.teamReceipts()).toBe('/withdrawals');expect(links.teamReceipts({sources:true})).toBe('/withdrawals?view=sources');
    expect(links.originalWithdrawals(true)).toBe('/withdrawals?view=original');expect(links.originalWithdrawals(false)).toBe('/withdrawals');
    expect(links.paypalIn()).toBe('/funds');
    expect(links.costs({month:'2026-10',server:'s1'})).toBe('/costs?month=2026-10&server=s1');expect(links.costs({month:'bad'})).toBe('/costs');
    expect(links.work({kind:'SHEET_REVIEW'})).toBe('/work?kind=SHEET_REVIEW');expect(links.work({kind:'TASK',vm:'v1'})).toBe('/work?vm=v1');
    // Việc cài proxy is hidden by default: install links open the VM (or the pending filter) in Server / VM.
    expect(links.installs({vm:'v1'})).toBe('/infrastructure/servers?vm=v1&tab=install');expect(links.installs()).toBe('/infrastructure/servers?view=PENDING');
    expect(links.accounts({tab:'paypal'})).toBe('/gmails?tab=paypal');expect(links.accounts({tab:'login'})).toBe('/gmails');
  });
  it('opens package payment in the package list, and orphan install tasks at the VM or the Server / VM filter',()=>{
    expect(links.packages()).toBe('/infrastructure/proxies?packages=due');expect(links.packages({pay:'231243'})).toBe('/infrastructure/proxies?pay=231243');
    expect(links.orphanTasks([{serverId:'s1',vmId:'v1'}])).toBe('/infrastructure/servers/s1?vm=v1&tab=install');
    const many=links.orphanTasks([{serverId:'s1',vmId:'v1'},{serverId:'s2',vmId:'v2'}]);expect(many).toBe('/infrastructure/servers?view=TASK_ORPHAN');
    expect(readGridUrl(params(many.split('?')[1])).view).toBe('TASK_ORPHAN');
  });
});
