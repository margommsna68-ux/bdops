import {it,expect} from 'vitest';
import {teamCashFixture,businessDB as db} from './team-cash-fixture';
it('stores exact original money and nullable unverified receipts',async()=>{
 const f=await teamCashFixture();try{
  const cost=await db.costRecord.create({data:{projectId:f.scope.projectId,date:new Date(),amount:'2500000.12345678',total:'2500000.12345678',currency:'VND',usdtRate:'25000.000000000000',usdtAmount:'100.000005',profitTreatment:'CASH_COST'}});
  expect(cost.total.toFixed(8)).toBe('2500000.12345678');
  const receipt=await db.teamReceipt.create({data:{projectId:f.scope.projectId,receivedAt:new Date(),createdById:f.scope.userId}});
  expect(receipt.amountUsdt).toBeNull();
  await expect(db.teamReceipt.create({data:{projectId:f.scope.projectId,receivedAt:new Date(),createdById:f.scope.userId,status:'CONFIRMED'}})).rejects.toThrow();
 }finally{await f.cleanup();}
});
