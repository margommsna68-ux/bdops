import {describe,expect,it} from 'vitest';
import {gatherOf,requestMoney,milestoneOf,opsPriority,opsLabel,MILESTONE_LABEL} from '@/lib/vm-ops';
const req=(o:Partial<Parameters<typeof requestMoney>[0]>={})=>requestMoney({amount:'24',currency:'USD',state:'REQUESTED',settledAt:null,shortfall:null,consumedAt:null,receipts:[],...o});
const rc=(amount:string,confirmed=true,extra={})=>({amount,currency:'USD',confirmed,failed:false,voided:false,...extra});
describe('VM ops rules',()=>{
  it('labels the existing NEW_VM state as Chưa cài',()=>{expect(opsLabel('NEW_VM')).toBe('Chưa cài');});
  it('no recorded status reads "Chưa ghi"',()=>{expect(opsLabel(null)).toBe('Chưa ghi');expect(opsLabel('LINKED')).toBe('LINKED');});
  it('payout: partial receipt leaves only the open part pending; a linked pending receipt is not added on top',()=>{
    expect(req({receipts:[rc('10'),rc('14',false)]})).toMatchObject({phase:'WAITING',received:'10.00',pendingLinked:'14.00',remaining:'14.00'});
    expect(req({receipts:[rc('24')]}).phase).toBe('RECEIVED');
    expect(req({receipts:[rc('20')],settledAt:'x',shortfall:'4'}).phase).toBe('RECEIVED');// settled short with a stated reason
    expect(req({receipts:[rc('25')]}).phase).toBe('REVIEW');
    expect(req({receipts:[rc('24',true,{voided:true})]}).phase).toBe('WAITING');
    expect(req({receipts:[rc('24',true,{failed:true})]}).phase).toBe('WAITING');
    expect(req({state:'FAILED',receipts:[rc('24',false)]})).toMatchObject({phase:'FAILED',remaining:'0.00'});
    expect(req({consumedAt:'x',receipts:[]}).reviewAfterRecreate).toBe(true);
  });
  it('milestone: waiting, needs recreating (until used), money to reconcile, failed',()=>{
    expect(milestoneOf(null)).toBe('');expect(milestoneOf({phase:'WAITING',consumed:false})).toBe('WAITING');
    expect(milestoneOf({phase:'RECEIVED',consumed:false})).toBe('RECREATE');expect(milestoneOf({phase:'RECEIVED',consumed:true})).toBe('');
    expect(milestoneOf({phase:'REVIEW',consumed:false})).toBe('MONEY_REVIEW');expect(milestoneOf({phase:'CANCELLED',consumed:false})).toBe('FAILED');
  });
  it('LOST_SUS is neither waiting nor received',()=>{
    const m=requestMoney({amount:'12.00',currency:'USD',state:'LOST_SUS',settledAt:null,shortfall:null,consumedAt:null,receipts:[]});
    expect(m).toMatchObject({phase:'LOST',remaining:'0.00',received:'0.00'});
    expect(milestoneOf({phase:'LOST',consumed:false,submission:'SENT'})).toBe('LOST');
    // A VM already recreated after the SUS is not a money mismatch: the loss stays a loss.
    expect(req({state:'LOST_SUS',consumedAt:'x'})).toMatchObject({phase:'LOST',reviewAfterRecreate:false});
    expect(MILESTONE_LABEL.LOST).toBe('Mất do SUS');expect(MILESTONE_LABEL.RECREATE).toBe('Chờ tạo lại');
  });
  it('gathering: 82 + 18 pending is only projected; 100 on the book is reached; the target is a minimum, not a cap',()=>{
    expect(gatherOf('82.00','18.00')).toMatchObject({state:'PROJECTED',missing:'18.00',missingAfterPending:'0.00'});
    expect(gatherOf('100.00','0.00').state).toBe('REACHED');expect(gatherOf('250.00','0').state).toBe('REACHED');
    expect(gatherOf('46.00','0.00','24')).toMatchObject({state:'GATHERING',missing:'54.00',projectedWith:'70.00'});
    expect(gatherOf('99.99','0').state).toBe('GATHERING');
  });
  it('"Cần xử lý trước": SUS, proxy BLOCKED, Earn/VM lỗi, recreate, OFF, waiting for money, preparation steps, then OK',()=>{
    const p=(status:Parameters<typeof opsPriority>[0]['status'],milestone:Parameters<typeof opsPriority>[0]['milestone']='',proxyBlocked=false)=>opsPriority({status,milestone,proxyBlocked});
    const order=[p('SUSPENDED'),p('LINKED','',true),p('EARN_ERROR'),p('LINKED','RECREATE'),p('OFF'),p('LINKED','WAITING'),p('NEW_VM'),p('MAIL_LOGGED'),p('NOT_LINKED'),p('LINKED'),p(null),p('OK')];
    expect([...order].sort((a,b)=>a-b)).toEqual(order);
  });
});
