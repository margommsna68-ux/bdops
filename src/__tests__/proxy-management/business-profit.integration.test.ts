import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {saveOperatingAccount} from '@/server/business-management/accounts';
import {saveFinance} from '@/server/business-management/finance';
import {createProfitPeriod,settleProfit,markProfitPaid,readProfitWorkspace,recalculateProfit,reopenProfit,correctProfitPaid} from '@/server/business-management/profit';
import {listOperations} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
afterAll(()=>db.$disconnect());
const range={start:'2026-10-01',end:'2026-10-31',currency:'USD' as const};
const partners=[{name:'A',percentage:'33.33'},{name:'B',percentage:'66.67'}];
it('profit periods snapshot exact cents, reject stale settlement and lock settled money records',async()=>{
 const f=await businessFixture();try{
  const pp=await saveOperatingAccount(f.scope,{kind:'PAYPAL',code:'PP-1',email:randomUUID()+'@fixture.invalid',key:randomUUID()},db);
  await saveFinance(f.scope,{kind:'WITHDRAWAL',date:'2026-10-14',currency:'USD',amount:'10.00',paypalId:pp.id,type:'EXCHANGE',paidToTeam:true,key:randomUUID()},db);
  const split=await createProfitPeriod(f.scope,{...range,partners,key:randomUUID()},db);expect((await readProfitWorkspace(f.scope,range,db)).items[0].allocations.map(a=>a.amount)).toEqual(['3.33','6.67']);
  const cost=await saveFinance(f.scope,{kind:'COST',date:'2026-10-14',currency:'USD',amount:'1',key:randomUUID()},db);
  await expect(settleProfit(f.scope,{id:split.id,expectedRevision:0,key:randomUUID()},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  await recalculateProfit(f.scope,{id:split.id,expectedRevision:0,key:randomUUID()},db);
  const current=await db.profitSplit.findUniqueOrThrow({where:{id:split.id}});await settleProfit(f.scope,{id:split.id,expectedRevision:current.revision,key:randomUUID()},db);
  await expect(saveFinance(f.scope,{kind:'COST',date:'2026-10-14',currency:'USD',amount:'2',key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  await expect(saveFinance(f.scope,{kind:'COST',id:cost.id,expectedRevision:0,date:'2026-11-01',currency:'USD',amount:'2',key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  await expect(createProfitPeriod(f.scope,{...range,partners,key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  const allocation=await db.splitAllocation.findFirstOrThrow({where:{splitId:split.id},orderBy:{partnerName:'asc'}});await markProfitPaid(f.scope,{allocationId:allocation.id,expectedRevision:allocation.revision,key:randomUUID(),reason:'Manual paid fact'},db);
  await expect(reopenProfit(f.scope,{id:split.id,expectedRevision:(await db.profitSplit.findUniqueOrThrow({where:{id:split.id}})).revision,key:randomUUID(),reason:'Change after paid'},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{role:'MODERATOR',allowedModules:['PROFIT']}});
  await expect(correctProfitPaid(f.worker,{allocationId:allocation.id,expectedRevision:allocation.revision+1,key:randomUUID(),reason:'Wrong paid note'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  await correctProfitPaid(f.scope,{allocationId:allocation.id,expectedRevision:allocation.revision+1,key:randomUUID(),reason:'Recorded payment by mistake; no money moved'},db);
  expect((await db.splitAllocation.findUniqueOrThrow({where:{id:allocation.id}})).paid).toBe(false);
  expect((await listOperations(f.scope,db)).find(o=>o.kind==='BUSINESS_PROFIT_PAID_CORRECTION')?.reversible).toBe(false);
 }finally{await f.cleanup();}
});
it('settlement requires recorded withdrawals confirmed back and denies staff, foreign IDs and negative payouts',async()=>{
 const f=await businessFixture(),other=await businessFixture();try{
  const pp=await saveOperatingAccount(f.scope,{kind:'PAYPAL',code:'PP-1',email:randomUUID()+'@fixture.invalid',key:randomUUID()},db);
  await saveFinance(f.scope,{kind:'WITHDRAWAL',date:'2026-10-14',currency:'USD',amount:'1',paypalId:pp.id,type:'EXCHANGE',paidToTeam:false,key:randomUUID()},db);
  const split=await createProfitPeriod(f.scope,{...range,partners,key:randomUUID()},db);await expect(settleProfit(f.scope,{id:split.id,expectedRevision:0,key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  await expect(createProfitPeriod(f.worker,{...range,partners,key:randomUUID()},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(settleProfit(other.scope,{id:split.id,expectedRevision:0,key:randomUUID()},db)).rejects.toMatchObject({code:'NOT_FOUND'});
  await saveFinance(f.scope,{kind:'COST',date:'2026-11-14',currency:'USD',amount:'2',key:randomUUID()},db);
  const loss=await createProfitPeriod(f.scope,{start:'2026-11-01',end:'2026-11-30',currency:'USD',partners,key:randomUUID()},db);await settleProfit(f.scope,{id:loss.id,expectedRevision:0,key:randomUUID()},db);
  const allocation=await db.splitAllocation.findFirstOrThrow({where:{splitId:loss.id}});await expect(markProfitPaid(f.scope,{allocationId:allocation.id,expectedRevision:0,key:randomUUID(),reason:'Cannot pay negative allocation'},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
 }finally{await f.cleanup();await other.cleanup();}
});
it('recalculation can be undone before settlement without pretending a payment occurred',async()=>{
 const f=await businessFixture();try{
  const split=await createProfitPeriod(f.scope,{...range,partners,key:randomUUID()},db);await saveFinance(f.scope,{kind:'COST',date:'2026-10-14',currency:'USD',amount:'1',key:randomUUID()},db);await recalculateProfit(f.scope,{id:split.id,expectedRevision:0,key:randomUUID()},db);
  const op=(await listOperations(f.scope,db)).find(o=>o.kind==='BUSINESS_PROFIT_RECALCULATE')!;await undoOperation(f.scope,op.id,'Wrong draft recalculation',db);expect((await db.profitSplit.findUniqueOrThrow({where:{id:split.id}})).netProfit.toFixed(2)).toBe('0.00');
 }finally{await f.cleanup();}
});
