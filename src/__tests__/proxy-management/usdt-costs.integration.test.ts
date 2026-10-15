import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {teamCashFixture,businessDB as db} from './team-cash-fixture';
import {saveUsdtCost,voidUsdtCost,lastCostRate} from '@/server/business-management/usdt-costs';
import {undoOperation} from '@/server/operation-history/undo';
const input=()=>({key:randomUUID(),date:'2026-10-15',amount:'2500000',currency:'VND',rate:'25000',category:'SERVER',treatment:'CASH_COST' as const});
it('cost quotes freeze, edits are journaled and undo restores the exact original quote',async()=>{
 const f=await teamCashFixture();try{
  const i=input(),saved=await saveUsdtCost(f.scope,i,db);
  expect(await saveUsdtCost(f.scope,i,db)).toMatchObject({id:saved.id,replay:true});
  await saveUsdtCost(f.scope,{...input(),date:'2026-10-16',amount:'2700000',rate:'27000'},db);
  expect((await lastCostRate(f.scope,'VND',db))?.rate).toBe('27000.000000000000');
  expect((await db.costRecord.findUniqueOrThrow({where:{id:saved.id}})).usdtRate!.toString()).toBe('25000');
  const key=randomUUID();await saveUsdtCost(f.scope,{...i,id:saved.id,expectedRevision:0,key,rate:'20000',reason:'Correct quote'},db);
  const op=await db.operationJournal.findUniqueOrThrow({where:{projectId_commandKey:{projectId:f.scope.projectId,commandKey:key}}});
  await undoOperation(f.scope,op.id,'Restore quote',db);
  const row=await db.costRecord.findUniqueOrThrow({where:{id:saved.id}});expect(row.usdtAmount!.toFixed(6)).toBe('100.000000');expect(row.usdtRate!.toFixed(12)).toBe('25000.000000000000');
  await expect(saveUsdtCost(f.scope,{...i,id:saved.id,expectedRevision:0,key:randomUUID(),reason:'stale'},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  await voidUsdtCost(f.scope,{id:saved.id,expectedRevision:row.revision,key:randomUUID(),reason:'Discard'},db);expect((await db.costRecord.findUniqueOrThrow({where:{id:saved.id}})).businessManaged).toBe(true);
 }finally{await f.cleanup();}
});
it('rejects foreign links, missing quotes and ambiguous reconciliation; rolls back failures',async()=>{
 const f=await teamCashFixture(),other=await teamCashFixture();try{
  for(const patch of [{serverId:other.server.id},{currency:'USD',rate:undefined},{treatment:'ALREADY_NETTED' as const}])await expect(saveUsdtCost(f.scope,{...input(),...patch},db)).rejects.toThrow();
  const source=await db.collectorExpense.create({data:{projectId:f.scope.projectId,collectorId:f.scope.userId,type:'TEAM_PAYMENT',amount:'100',referenceId:'test'}});
  await expect(saveUsdtCost(f.scope,{...input(),sourceCollectorExpenseId:source.id},db)).rejects.toThrow();
  await expect(saveUsdtCost(f.scope,input(),db,{afterWrite:()=>{throw Error('injected');}})).rejects.toThrow('injected');
  expect(await db.costRecord.count({where:{projectId:f.scope.projectId}})).toBe(0);
  expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).desiredConfigurationId).toBeNull();
 }finally{await f.cleanup();await other.cleanup();}
});
