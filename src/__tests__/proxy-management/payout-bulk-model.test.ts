import {afterEach,describe,expect,it,vi} from 'vitest';
import {bulkPlan,runSequential,serverCounts,runJournaled,receiptBody,MANUAL_RECREATE,FLEET_RECORDS,type BulkRow} from '@/components/vm-management/vm-grid/payout-bulk-model';
import {enrolledServerIds} from '@/server/fleet-commands/guards';
// Bulk actions (owner 28/10/2026): "Đã rút N dòng", "Tiền đã về N dòng", "Tạo lại N VM", "Ghi nhận đã tạo lại N VM". Pure rules.
const money={lost:null,amount:'10.00',currency:'USD',received:'0.00',pendingLinked:'0.00',remaining:'10.00',shortfall:null};
const req=(o:Record<string,unknown>={})=>({id:'r',revision:1,cycle:1,earnAppId:'ea',state:'REQUESTED',submission:'PREPARING',phase:'WAITING',money,...o});
const row=(id:string,o:Partial<BulkRow>&{request?:ReturnType<typeof req>|null;milestone?:string;member?:boolean}={}):BulkRow=>({vmId:id,serverId:o.serverId??'s1',server:o.server??'MOON-01',code:'VM_'+id,fleetEnrolled:o.fleetEnrolled,
  ops:!('ops' in o)?{cycle:1,milestone:o.milestone??'',merge:o.member?{role:'MEMBER'}:null,request:o.request===undefined?req({id:'r'+id}):o.request&&{...o.request,id:o.request.id==='r'?'r'+id:o.request.id}}:o.ops});
const why=(p:ReturnType<typeof bulkPlan>,id:string)=>p.skipped.find(s=>s.row.vmId===id)?.why;
describe('bulkPlan',()=>{
  it('SEND ("Đã rút N dòng"): only PREPARING requests; others skipped with a reason',()=>{
    const p=bulkPlan([row('1'),row('2',{request:req({submission:'SENT'})}),row('3',{request:null}),row('4',{request:req({submission:'UNKNOWN'})}),row('5',{request:req({state:'FAILED',phase:'FAILED'})}),row('6',{member:true}),row('7',{ops:undefined as never})],'SEND');
    expect(p.ready.map(r=>r.vmId)).toEqual(['1']);
    expect(p.skipped).toHaveLength(6);for(const s of p.skipped)expect(s.why.length).toBeGreaterThan(3);
    expect(why(p,'2')).toContain('Đã rút');expect(why(p,'3')).toContain('Chưa có yêu cầu');expect(why(p,'6')).toContain('VM chính');
  });
  it('RECEIVE ("Tiền đã về N dòng"): SENT and waiting, or late money after SUS; never PREPARING / received / without money rights',()=>{
    const p=bulkPlan([row('1',{request:req({submission:'SENT'})}),row('2'),row('3',{request:req({submission:'SENT',phase:'RECEIVED'})}),row('4',{request:req({submission:'SENT',money:null})}),row('5',{request:req({submission:'SENT',state:'LOST_SUS',phase:'LOST'})}),row('6',{request:req({submission:'SENT',phase:'REVIEW'})})],'RECEIVE');
    expect(p.ready.map(r=>r.vmId)).toEqual(['1','5']);
    expect(why(p,'2')).toContain('Chưa ghi "Đã rút"');expect(why(p,'4')).toContain('quyền');
  });
  it('one request is acted on once even when two rows show it',()=>{
    const p=bulkPlan([row('1',{request:req({id:'same'})}),row('2',{request:req({id:'same'})})],'SEND');
    expect(p.ready).toHaveLength(1);expect(why(p,'2')).toBeTruthy();
  });
  it('RECREATE: only "Chờ tạo lại"; VMs on servers without fleet control are left for a manual recreate',()=>{
    const p=bulkPlan([row('1',{milestone:'RECREATE',fleetEnrolled:true}),row('2',{milestone:'RECREATE',fleetEnrolled:false}),row('3',{milestone:'WAITING',fleetEnrolled:true})],'RECREATE');
    expect(p.ready.map(r=>r.vmId)).toEqual(['1']);
    expect(why(p,'2')).toBe(MANUAL_RECREATE);expect(MANUAL_RECREATE).toContain('Tạo lại trên máy rồi bấm Ghi nhận đã tạo lại');
    expect(why(p,'3')).toContain('Chờ tạo lại');
  });
  it('RECORD_RECREATED: "Chờ tạo lại" VMs of servers WITHOUT fleet control only (the worker records the enrolled ones)',()=>{
    const p=bulkPlan([row('1',{milestone:'RECREATE',fleetEnrolled:true}),row('2',{milestone:'RECREATE'}),row('3',{milestone:''})],'RECORD_RECREATED');
    expect(p.ready.map(r=>r.vmId)).toEqual(['2']);expect(why(p,'1')).toBe(FLEET_RECORDS);expect(why(p,'3')).toContain('Chờ tạo lại');
  });
  it('RECEIVE: late money after SUS only on a request that was sent (never a never-sent one)',()=>{
    const p=bulkPlan([row('1',{request:req({submission:'PREPARING',state:'LOST_SUS',phase:'LOST'})}),row('2',{request:req({submission:'UNKNOWN',state:'LOST_SUS',phase:'LOST'})})],'RECEIVE');
    expect(p.ready.map(r=>r.vmId)).toEqual(['2']);expect(why(p,'1')).toContain('Chưa ghi "Đã rút"');
  });
  it('a request that is no longer the VM’s current one is skipped as such',()=>{
    const p=bulkPlan([{...row('1',{request:req({submission:'SENT'})}),notCurrent:true}],'RECEIVE');
    expect(why(p,'1')).toBe('Yêu cầu không còn hiện hành');
  });
});
describe('runSequential',()=>{
  it('a revision conflict on one row does not stop the others; one call per row, in order',async()=>{
    const calls:string[]=[];
    const out=await runSequential(['a','b','c'],async x=>{calls.push(x);if(x==='b')throw Object.assign(new Error('Revision đã đổi'),{data:{code:'CONFLICT'}});return x+'!';});
    expect(calls).toEqual(['a','b','c']);
    expect(out.map(o=>o.ok)).toEqual([true,false,true]);
    expect(out[1].ok?null:(out[1].error as Error).message).toBe('Revision đã đổi');
  });
  it('stops before the next row once asked to (closed panel)',async()=>{
    let stop=false;const calls:string[]=[];
    await runSequential(['a','b'],async x=>{calls.push(x);stop=true;},()=>stop);
    expect(calls).toEqual(['a']);
  });
});
describe('serverCounts (confirmation of "Tạo lại N VM")',()=>{
  it('VM counts per server in natural order',()=>{
    expect(serverCounts([row('1',{server:'MOON-10'}),row('2',{server:'MOON-2'}),row('3',{server:'MOON-2'})])).toEqual([{server:'MOON-2',count:2},{server:'MOON-10',count:1}]);
  });
});
function memory(){const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},removeItem:(k:string)=>{m.delete(k);},get size(){return m.size;}};}
describe('runJournaled (one key per row, never two writes)',()=>{
  it('stores the exact command before sending and clears it after success',async()=>{
    const s=memory(),send=vi.fn(async()=>{expect(s.size).toBe(1);});
    expect(await runJournaled(s,'k',{key:'x'},false,send)).toEqual({outcome:'DONE'});expect(s.size).toBe(0);
  });
  it('a definite refusal of a first send keeps nothing; a lost answer keeps the command for the same retry',async()=>{
    const s=memory();
    const r1=await runJournaled(s,'k',{key:'x'},false,async()=>{throw Object.assign(new Error('no'),{data:{code:'CONFLICT'}});});
    expect(r1.outcome).toBe('REFUSED');expect(s.size).toBe(0);
    const r2=await runJournaled(s,'k',{key:'y'},false,async()=>{throw new Error('502');});
    expect(r2.outcome).toBe('UNKNOWN');expect(JSON.parse(s.getItem('k')!)).toEqual({key:'y'});
    const r3=await runJournaled(s,'k',{key:'y'},true,async()=>{throw Object.assign(new Error('revoked'),{data:{code:'FORBIDDEN'}});});
    expect(r3.outcome).toBe('STUCK');expect(s.size).toBe(1);
  });
  it('without storage nothing is sent',async()=>{
    const send=vi.fn();const bad={getItem:()=>null,setItem:()=>{throw new Error('quota');},removeItem:()=>{}};
    expect((await runJournaled(bad,'k',{},false,send)).outcome).toBe('NOSTORE');expect(send).not.toHaveBeenCalled();
  });
});
describe('receiptBody',()=>{
  it('settleRemainder only when the amount is below what is open',()=>{
    const today='2026-10-28';
    expect(receiptBody({valid:true,amount:'9.62',showSettle:true},{currency:'USD',date:today,today,txid:' ',settle:true,now:new Date('2026-10-28T05:00:00Z')})).toEqual({amount:'9.62',currency:'USD',receivedAt:'2026-10-28T05:00:00.000Z',transactionId:null,settleRemainder:true});
    expect(receiptBody({valid:true,amount:'10.00',showSettle:false},{currency:'USD',date:'2026-10-27',today,txid:'TX',settle:true})).toEqual({amount:'10.00',currency:'USD',receivedAt:'2026-10-27T12:00:00+07:00',transactionId:'TX'});
    expect(receiptBody({valid:false,amount:null,showSettle:false},{currency:'USD',date:today,today,txid:'',settle:true})).toBeNull();
  });
});
describe('receiptBody with a large surplus (review 29/10/2026)',()=>{
  it('no body until the surplus is confirmed; then acceptSurplus:true is sent, never otherwise',()=>{
    const today='2026-10-28',o={currency:'USD',date:'2026-10-27',today,txid:'',settle:true};
    expect(receiptBody({valid:true,amount:'11.50',showSettle:false,surplusConfirm:true},o)).toBeNull();
    expect(receiptBody({valid:true,amount:'11.50',showSettle:false,surplusConfirm:true},{...o,acceptSurplus:true})).toMatchObject({amount:'11.50',acceptSurplus:true});
    expect(receiptBody({valid:true,amount:'10.50',showSettle:false,surplusConfirm:false},{...o,acceptSurplus:true})).not.toHaveProperty('acceptSurplus');
  });
});
describe('enrolledServerIds (fleet control read, no secrets)',()=>{
  afterEach(()=>vi.unstubAllEnvs());
  it('lists enrolled servers of the project only when M1 is ready; broken config = none',()=>{
    vi.stubEnv('FLEET_CONTROL_M1_READY','1');
    vi.stubEnv('FLEET_CONTROL_SERVERS',JSON.stringify([{projectId:'p',serverId:'s1',serverUuid:'dda631e2-3ce9-492c-a733-f2b96873dd02'},{projectId:'q',serverId:'s9',serverUuid:'332ec214-e130-4d8a-8371-cca9aac37cd9'}]));
    expect(enrolledServerIds('p')).toEqual(['s1']);
    vi.stubEnv('FLEET_CONTROL_SERVERS','not json');expect(enrolledServerIds('p')).toEqual([]);
    vi.stubEnv('FLEET_CONTROL_M1_READY','0');vi.stubEnv('FLEET_CONTROL_SERVERS',JSON.stringify([{projectId:'p',serverId:'s1',serverUuid:'dda631e2-3ce9-492c-a733-f2b96873dd02'}]));
    expect(enrolledServerIds('p')).toEqual([]);
  });
});
