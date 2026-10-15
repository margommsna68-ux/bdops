import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {teamCashFixture,businessDB as db} from './team-cash-fixture';
import {saveUsdtCost} from '@/server/business-management/usdt-costs';
import {saveTeamReceipt} from '@/server/business-management/team-receipts';
import {teamCashSources} from '@/server/business-management/team-cash-report';
import {undoOperation} from '@/server/operation-history/undo';
const range={start:'2026-10-01',end:'2026-10-31'};
it('uses only confirmed team USDT minus costs across original currencies, without deducting netted fees twice',async()=>{
 const f=await teamCashFixture();try{
  const receiptKey=randomUUID(),r=await saveTeamReceipt(f.scope,{key:receiptKey,receivedDate:'2026-10-15',amountUsdt:'100',referenceId:randomUUID(),status:'CONFIRMED'},db);
  await saveUsdtCost(f.scope,{key:randomUUID(),date:'2026-10-15',amount:'2500000',currency:'VND',rate:'25000',category:'SERVER',treatment:'CASH_COST'},db);
  await saveUsdtCost(f.scope,{key:randomUUID(),date:'2026-10-15',amount:'5',currency:'USDT',category:'OTHER',treatment:'CASH_COST'},db);
  await saveUsdtCost(f.scope,{key:randomUUID(),date:'2026-10-15',amount:'5',currency:'USD',category:'OTHER',treatment:'ALREADY_NETTED',sourceReceiptId:r.id},db);
  const op=await db.operationJournal.findUniqueOrThrow({where:{projectId_commandKey:{projectId:f.scope.projectId,commandKey:receiptKey}}});await expect(undoOperation(f.scope,op.id,'Cannot orphan reconciliation',db)).rejects.toThrow();
  expect((await teamCashSources(f.scope,range,db)).report).toMatchObject({basis:'TEAM_RECEIVED',currency:'USDT',teamReceived:'100.000000',cost:'105.000000',net:'-5.000000',blockingCount:0,excludedNettedCostCount:1,unlinkedReceiptCount:1});
  await db.costRecord.create({data:{projectId:f.scope.projectId,date:new Date('2026-10-15'),total:'100',currency:'USD'}});
  const source=await db.collectorExpense.create({data:{projectId:f.scope.projectId,collectorId:f.scope.userId,date:new Date('2026-10-15'),type:'TEAM_PAYMENT',amount:'100',referenceId:'old'}});
  const first=await teamCashSources(f.scope,range,db);expect(first.report.blockingCount).toBe(2);
  await db.collectorExpense.update({where:{id:source.id},data:{amount:'101'}});expect((await teamCashSources(f.scope,range,db)).report.sourceHash).not.toBe(first.report.sourceHash);
 }finally{await f.cleanup();}
});
