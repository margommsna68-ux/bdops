import {describe,expect,it} from 'vitest';
import {applyFilters,countWith,matchVm,serverDistribution,vmIdLines,DEFAULT_FILTERS,type GridFilters,type VmFacts} from '@/components/vm-management/vm-grid/filter-model';
// One VM of the grid as the model sees it. Everything optional is "known and empty" unless the test says otherwise.
function fact(p:Partial<VmFacts>&{id:string;server:string;code:string}):VmFacts{
  return {serverId:'s-'+p.server,archived:false,serverArchived:false,view:'ASSIGNED',applyPending:false,todo:false,noSdk:false,hasAccount:false,hasPaypal:false,opsKey:'NONE',milestone:'',moneyFlags:{UNCHECKED:false,WITHDRAWABLE:false,WAITING:false,RECEIVED:false,CHECK:false},vmMoney:'UNCHECKED',text:(p.server+' '+p.code).toLowerCase(),...p};
}
const F=(p:Partial<GridFilters>={}):GridFilters=>({...DEFAULT_FILTERS,...p});
// moon06: 3 VMs (two without SDK, one OFF), moon05: 2 VMs (one without SDK, one deleted), vt-01: 1 VM with everything.
const rows:VmFacts[]=[
  fact({id:'a',server:'moon06',code:'VM_010',noSdk:true,opsKey:'NOT_LINKED'}),
  fact({id:'b',server:'moon06',code:'VM_002',noSdk:true,opsKey:'OFF',view:'BLOCKED'}),
  fact({id:'c',server:'moon06',code:'VM_003',opsKey:'OFF',vmMoney:'STALE'}),
  fact({id:'d',server:'moon05',code:'VM_001',noSdk:true,opsKey:'OK',text:'moon05 vm_001 earn@mail.test'}),
  fact({id:'e',server:'moon05',code:'VM_009',archived:true,noSdk:true}),
  fact({id:'f',server:'vt-01',code:'VM_001',hasAccount:true,hasPaypal:true,opsKey:'OK',vmMoney:'OK'}),
];
describe('Server/VM filter model',()=>{
  it('applies the groups together: OR inside the status group, AND between groups, server last',()=>{
    expect(applyFilters(rows,F({view:'SDK_MISSING'})).map(v=>v.id)).toEqual(['a','b','d']);
    expect(applyFilters(rows,F({st:['OFF','OK']})).map(v=>v.id).sort()).toEqual(['b','c','d','f']);
    expect(applyFilters(rows,F({view:'SDK_MISSING',st:['OFF','OK']})).map(v=>v.id).sort()).toEqual(['b','d']);
    expect(applyFilters(rows,F({view:'SDK_MISSING',st:['OFF','OK'],serverId:'s-moon06'})).map(v=>v.id)).toEqual(['b']);
    expect(applyFilters(rows,F({q:'earn@'})).map(v=>v.id)).toEqual(['d']);
    expect(applyFilters(rows,F({view:'BLOCKED',warn:true})).map(v=>v.id)).toEqual(['b']);
  });
  it('the deleted view lists only deleted VMs and never mixes them into the other views',()=>{
    expect(applyFilters(rows,F({view:'DELETED'})).map(v=>v.id)).toEqual(['e']);
    expect(applyFilters(rows,F()).map(v=>v.id)).not.toContain('e');
    expect(applyFilters(rows,F({view:'SDK_MISSING'})).map(v=>v.id)).not.toContain('e');
    // A VM of a deleted server is not an active row either.
    expect(applyFilters([fact({id:'z',server:'old',code:'VM_001',serverArchived:true})],F())).toEqual([]);
  });
  it('the distribution applies every condition except the server, counts before paging and sorts by count then natural name',()=>{
    const d=serverDistribution(rows,F({view:'SDK_MISSING',serverId:'s-moon06'}));
    expect(d).toEqual({total:3,items:[{serverId:'s-moon06',code:'moon06',count:2},{serverId:'s-moon05',code:'moon05',count:1}]});
    // Equal counts: natural order of the names (moon2 before moon10).
    const tie=serverDistribution([fact({id:'1',server:'moon10',code:'VM_001'}),fact({id:'2',server:'moon2',code:'VM_001'})],F());
    expect(tie!.items.map(i=>i.code)).toEqual(['moon2','moon10']);
    // Each VM once: the total is the sum of the items and equals the unscoped result.
    expect(d!.items.reduce((n,i)=>n+i.count,0)).toBe(d!.total);expect(applyFilters(rows,F({view:'SDK_MISSING'})).length).toBe(d!.total);
  });
  it('counts next to a choice apply the other groups and replace only their own group',()=>{
    const fl=F({view:'SDK_MISSING',st:['OFF'],serverId:'s-moon06'});
    // Status chips: the SDK view and the server still apply; the status group is replaced by the chip's own value.
    expect(countWith(rows,fl,{st:['NOT_LINKED']})).toBe(1);expect(countWith(rows,fl,{st:['OK']})).toBe(0);
    // View chips: status OFF and server moon06 still apply.
    expect(countWith(rows,fl,{view:''})).toBe(2);expect(countWith(rows,fl,{view:'BLOCKED'})).toBe(1);
    // Money chips keep the view / status / server.
    expect(countWith(rows,F({st:['OFF']}),{money:'STALE'})).toBe(1);expect(countWith(rows,F({st:['OFF'],view:'SDK_MISSING'}),{money:'STALE'})).toBe(0);
  });
  it('a condition that needs data not loaded yet answers null, never 0',()=>{
    const pending=[fact({id:'p',server:'moon06',code:'VM_001',hasAccount:null,hasPaypal:null,moneyFlags:null})];
    expect(matchVm(pending[0],F({view:'ACCOUNT_MISSING'}))).toBeNull();expect(matchVm(pending[0],F({money:'WITHDRAWABLE'}))).toBeNull();
    expect(countWith(pending,F(),{view:'PAYPAL_MISSING'})).toBeNull();expect(serverDistribution(pending,F({money:'RECEIVED'}))).toBeNull();
    // A definite no from another group wins over the unknown one.
    expect(matchVm(pending[0],F({view:'ACCOUNT_MISSING',st:['OK']}))).toBe(false);
    // Loaded data answers normally; the Tiền VM states come from the workspace, so they never wait for the board.
    expect(countWith(rows,F(),{view:'ACCOUNT_MISSING'})).toBe(4);expect(countWith(rows,F(),{money:'UNCHECKED'})).toBe(3);
  });
  it('copies identities only, one per line, server then VM in natural order',()=>{
    expect(vmIdLines([rows[0],rows[3],rows[1],rows[5]])).toBe('moon05 | VM_001\nmoon06 | VM_002\nmoon06 | VM_010\nvt-01 | VM_001');
  });
});
