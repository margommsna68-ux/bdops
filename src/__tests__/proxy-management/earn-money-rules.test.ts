import {describe,expect,it} from 'vitest';
import {balanceState,moneyFlags,suggestPaypal,milestoneOf,BALANCE_STALE_HOURS} from '@/lib/vm-ops';
// EarnApp money at the VM (owner brief 20/10/2026): pure rules shared by the grid, the filters and the server.
const now=new Date('2026-10-20T10:00:00Z');
const ok=(amount:string,at:string,w:'YES'|'NO'|'UNKNOWN'='UNKNOWN')=>({outcome:'OK' as const,amount,currency:'USD',withdrawable:w,checkedAt:at});
describe('balance state',()=>{
  it('never checked ≠ checked at 0; a failed check keeps the last good figure; an old figure is stale; "có thể rút" only when observed',()=>{
    expect(balanceState({latest:null,lastOk:null},now)).toMatchObject({kind:'UNCHECKED'});
    expect(balanceState({latest:ok('0.00','2026-10-20T09:00:00Z'),lastOk:ok('0.00','2026-10-20T09:00:00Z')},now)).toMatchObject({kind:'OK',zero:true,stale:false,withdrawable:'UNKNOWN'});
    const failed={outcome:'FAILED' as const,amount:null,currency:'USD',withdrawable:'UNKNOWN' as const,checkedAt:'2026-10-20T09:30:00Z',failure:'Không đăng nhập được'};
    expect(balanceState({latest:failed,lastOk:ok('8.00','2026-10-19T09:00:00Z')},now)).toMatchObject({kind:'FAILED',last:{amount:'8.00'},failure:'Không đăng nhập được'});
    const h=BALANCE_STALE_HOURS+1,old=new Date(now.getTime()-h*3600e3).toISOString();
    expect(balanceState({latest:ok('10.00',old,'YES'),lastOk:ok('10.00',old,'YES')},now)).toMatchObject({kind:'OK',stale:true,withdrawable:'YES'});
  });
});
describe('money filters',()=>{
  const row=(o:object)=>({hasEarnApp:true,balance:{latest:null,lastOk:null},request:null,...o});
  it('each filter answers its own question; unknown money is never 0',()=>{
    expect(moneyFlags(row({}),now)).toMatchObject({UNCHECKED:true,WITHDRAWABLE:false,CHECK:false});
    expect(moneyFlags(row({hasEarnApp:false}),now).UNCHECKED).toBe(false);
    const fresh=ok('10.00','2026-10-20T09:15:00Z','YES');
    expect(moneyFlags(row({balance:{latest:fresh,lastOk:fresh}}),now)).toMatchObject({WITHDRAWABLE:true,UNCHECKED:false});
    const unknown=ok('10.00','2026-10-20T09:15:00Z');expect(moneyFlags(row({balance:{latest:unknown,lastOk:unknown}}),now).WITHDRAWABLE).toBe(false); // $10 is not "có thể rút" by itself
    expect(moneyFlags(row({balance:{latest:fresh,lastOk:fresh},request:{submission:'SENT',state:'REQUESTED',phase:'WAITING'}}),now)).toMatchObject({WAITING:true,WITHDRAWABLE:false});
    expect(moneyFlags(row({request:{submission:'SENT',state:'REQUESTED',phase:'RECEIVED'}}),now).RECEIVED).toBe(true);
    expect(moneyFlags(row({request:{submission:'UNKNOWN',state:'REQUESTED',phase:'WAITING'}}),now)).toMatchObject({CHECK:true,WAITING:false});
    expect(moneyFlags(row({request:{submission:'PREPARING',state:'REQUESTED',phase:'WAITING'}}),now).WAITING).toBe(false);
  });
  it('preparing / unknown milestones are not "Chờ tiền về"',()=>{
    expect(milestoneOf({phase:'WAITING',consumed:false,submission:'PREPARING'})).toBe('PREPARING');
    expect(milestoneOf({phase:'WAITING',consumed:false,submission:'UNKNOWN'})).toBe('UNKNOWN');
    expect(milestoneOf({phase:'WAITING',consumed:false,submission:'SENT'})).toBe('WAITING');expect(milestoneOf({phase:'WAITING',consumed:false})).toBe('WAITING');
  });
});
describe('suggest a PayPal',()=>{
  const pp=(code:string,balance:string,pending='0.00',held='0.00',o:object={})=>({id:code,code,usable:true,freeEmails:2,own:false,balanceUsd:balance,pendingUsd:pending,heldUsd:held,...o});
  it('the EarnApp\'s own email wins and is never changed silently',()=>{
    expect(suggestPaypal([pp('pp-1','10.00'),pp('pp-2','50.00',undefined,undefined,{own:true})],'10.00')).toMatchObject({paypalId:'pp-2',why:expect.stringMatching(/đã có email nhận/)});
  });
  it('closest to $100 without going over, counting money already held / waiting; $82 + $18 waiting is already projected full',()=>{
    const r=suggestPaypal([pp('pp-82','82.00','18.00'),pp('pp-60','60.00'),pp('pp-85','85.00'),pp('pp-held','70.00','0.00','25.00')],'10.00');
    expect(r).toMatchObject({paypalId:'pp-85'}); // 85 + 10 = 95 ≤ 100; pp-held is 95 + 10 > 100; pp-82 is projected full (82 + 18)
    expect(r?.why).toMatch(/pp-85/);
    expect(suggestPaypal([pp('pp-82','82.00','18.00'),pp('pp-99','99.00')],'10.00')).toMatchObject({paypalId:'pp-99'}); // nothing fits: the one still gathering
    expect(suggestPaypal([pp('pp-82','82.00','18.00'),pp('pp-x','30.00',undefined,undefined,{usable:false}),pp('pp-y','20.00',undefined,undefined,{freeEmails:0})],'10.00')).toBeNull();
    expect(suggestPaypal([pp('pp-a','10.00',undefined,undefined,{balanceUsd:null})],'10.00')).toBeNull(); // no money rights → no automatic pick
  });
});
describe('sort and summary over the whole filtered result',()=>{
  const row=(o:Partial<import('@/lib/vm-ops').MoneyRow>)=>({hasEarnApp:true,balance:{latest:null,lastOk:null},request:null,...o}) as import('@/lib/vm-ops').MoneyRow;
  const b=(amount:string|null,at:string,cur='USD')=>({outcome:'OK' as const,amount,currency:cur,withdrawable:'UNKNOWN' as const,checkedAt:at});
  it('balance high → low with unknown last; never checked first for "lâu chưa kiểm tra"; oldest waiting first',async()=>{
    const {moneySortKey}=await import('@/lib/vm-ops');
    const rows=[row({balance:{latest:b('5.00','2026-10-20T08:00:00Z'),lastOk:b('5.00','2026-10-20T08:00:00Z')}}),row({}),row({balance:{latest:b('12.50','2026-10-19T08:00:00Z'),lastOk:b('12.50','2026-10-19T08:00:00Z')}}),row({hasEarnApp:false})];
    const order=(s:'BALANCE'|'CHECKED_OLD')=>rows.map((r,i)=>[moneySortKey(s,r),i]).sort((x,y)=>x[0]-y[0]).map(x=>x[1]);
    expect(order('BALANCE')).toEqual([2,0,1,3]);expect(order('CHECKED_OLD')).toEqual([1,2,0,3]);
    const w=(at:string)=>row({request:{submission:'SENT',state:'REQUESTED',phase:'WAITING',requestedAt:at,submittedAt:at,money:{remaining:'4.00',currency:'USD'}}});
    const ws=[w('2026-10-19T00:00:00Z'),row({}),w('2026-10-10T00:00:00Z')];expect(ws.map((r,i)=>[moneySortKey('WAITING_OLD',r),i]).sort((x,y)=>x[0]-y[0]).map(x=>x[1])).toEqual([2,0,1]);
  });
  it('summary: balances and waiting money per currency, never added together; unknown is counted, not 0',async()=>{
    const {moneySummary}=await import('@/lib/vm-ops');
    const s=moneySummary([row({balance:{latest:b('10.00','2026-10-20T08:00:00Z'),lastOk:b('10.00','2026-10-20T08:00:00Z')},request:{submission:'SENT',state:'REQUESTED',phase:'WAITING',requestedAt:'2026-10-19',money:{remaining:'4.00',currency:'USD'}}}),
      row({balance:{latest:b('0.00','2026-10-20T08:00:00Z'),lastOk:b('0.00','2026-10-20T08:00:00Z')}}),row({balance:{latest:b('3.50','2026-10-20T08:00:00Z','EUR'),lastOk:b('3.50','2026-10-20T08:00:00Z','EUR')}}),row({}),row({hasEarnApp:false}),
      row({request:{submission:'PREPARING',state:'REQUESTED',phase:'WAITING',requestedAt:'2026-10-19',money:{remaining:'9.00',currency:'USD'}}})]);
    expect(s).toEqual({balances:[{currency:'EUR',amount:'3.50'},{currency:'USD',amount:'10.00'}],waiting:[{currency:'USD',amount:'4.00'}],unchecked:2,known:3,unassigned:1});
    // Every VM without an EarnApp account (owner brief 20/10/2026): counted as "chưa gán", never as "chưa kiểm tra" or $0.
    expect(moneySummary([row({hasEarnApp:false}),row({hasEarnApp:false})])).toEqual({balances:[],waiting:[],unchecked:0,known:0,unassigned:2});
  });
});
