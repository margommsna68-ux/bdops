import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {teamCashFixture,businessDB as db} from './team-cash-fixture';
import {saveUsdtCost} from '@/server/business-management/usdt-costs';
import {saveTeamReceipt} from '@/server/business-management/team-receipts';
import {createTeamCashPeriod,settleTeamCashPeriod,reopenTeamCashPeriod} from '@/server/business-management/team-cash-profit';
import {createProfitPeriod} from '@/server/business-management/profit';
import {undoOperation} from '@/server/operation-history/undo';
import {businessFixture} from './business-fixture';
import {settleProfit} from '@/server/business-management/profit';
it('locks converted VND edits and undo after USDT settlement, with six-decimal allocation',async()=>{
 const f=await teamCashFixture();try{
  await saveTeamReceipt(f.scope,{key:randomUUID(),receivedDate:'2026-10-15',amountUsdt:'100.000001',referenceId:randomUUID(),status:'CONFIRMED'},db);
  const i={key:randomUUID(),date:'2026-10-15',amount:'25000',currency:'VND',rate:'25000',category:'SERVER',treatment:'CASH_COST' as const},cost=await saveUsdtCost(f.scope,i,db);
  const p=await createTeamCashPeriod(f.scope,{key:randomUUID(),start:'2026-10-01',end:'2026-10-31',partners:[{name:'A',percentage:'50'},{name:'B',percentage:'50'}]},db);
  const row=await db.profitSplit.findUniqueOrThrow({where:{id:p.id},include:{allocations:{orderBy:{partnerName:'asc'}}}});expect(row.allocations.map(x=>x.amount.toFixed(6))).toEqual(['49.500001','49.500000']);
  await settleTeamCashPeriod(f.scope,{id:p.id,expectedRevision:0,key:randomUUID()},db);
  await expect(saveUsdtCost(f.scope,{...i,id:cost.id,expectedRevision:0,date:'2026-11-01',reason:'Move',key:randomUUID()},db)).rejects.toThrow();
  const op=await db.operationJournal.findUniqueOrThrow({where:{projectId_commandKey:{projectId:f.scope.projectId,commandKey:i.key}}});await expect(undoOperation(f.scope,op.id,'Undo cost',db)).rejects.toThrow();
  await expect(createProfitPeriod(f.scope,{key:randomUUID(),start:'2026-11-01',end:'2026-11-30',currency:'USD',partners:[{name:'A',percentage:'100'}]},db)).rejects.toThrow();
  await reopenTeamCashPeriod(f.scope,{id:p.id,expectedRevision:1,key:randomUUID(),reason:'Reconcile'},db);
  expect((await db.profitSplit.findUniqueOrThrow({where:{id:p.id}})).settled).toBe(false);
 }finally{await f.cleanup();}
});
it('keeps historical settled USD amounts, paid facts and encrypted basis unchanged',async()=>{
 const f=await businessFixture();try{
  const p=await createProfitPeriod(f.scope,{key:randomUUID(),start:'2026-09-01',end:'2026-09-30',currency:'USD',partners:[{name:'A',percentage:'100'}]},db);await settleProfit(f.scope,{id:p.id,expectedRevision:0,key:randomUUID()},db);
  const before=await db.profitSplit.findUniqueOrThrow({where:{id:p.id},include:{allocations:true}});
  await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'PROXY_VM',teamCashEnabled:true}}});
  await saveTeamReceipt(f.scope,{key:randomUUID(),receivedDate:'2026-10-15',amountUsdt:'10',referenceId:randomUUID(),status:'CONFIRMED'},db);
  expect(await db.profitSplit.findUniqueOrThrow({where:{id:p.id},include:{allocations:true}})).toEqual(before);
 }finally{await f.cleanup();}
});
