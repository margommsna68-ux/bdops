import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {teamCashFixture,businessDB as db} from './team-cash-fixture';
import {saveTeamReceipt,voidTeamReceipt,restoreTeamReceipt} from '@/server/business-management/team-receipts';
import {undoOperation} from '@/server/operation-history/undo';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
const input=()=>({key:randomUUID(),receivedDate:'2026-10-15',amountUsdt:'100.123456',referenceId:randomUUID(),status:'CONFIRMED' as const});
it('links original USD without duplicating or undoing a historical collector outflow',async()=>{
 const f=await teamCashFixture();try{
  const source=await db.collectorExpense.create({data:{projectId:f.scope.projectId,collectorId:f.scope.userId,type:'TEAM_PAYMENT',amount:'110',referenceId:'original'}}),i={...input(),collectorId:f.scope.userId,sourceCollectorExpenseId:source.id,collectorUsdAmount:'110'};
  const r=await saveTeamReceipt(f.scope,i,db);expect(await saveTeamReceipt(f.scope,i,db)).toMatchObject({id:r.id,replay:true});
  expect((await db.teamReceipt.findUniqueOrThrow({where:{id:r.id}})).amountUsdt!.toFixed(6)).toBe('100.123456');
  expect(await db.collectorExpense.count({where:{projectId:f.scope.projectId}})).toBe(1);
  const op=await db.operationJournal.findUniqueOrThrow({where:{projectId_commandKey:{projectId:f.scope.projectId,commandKey:i.key}}});await undoOperation(f.scope,op.id,'Undo source link',db);
  const actual=await db.collectorExpense.findUniqueOrThrow({where:{id:source.id}});expect(actual.amount.toString()).toBe('110');expect(actual.voidedAt).toBeNull();expect(actual.businessManaged).toBe(true);
  await expect(saveTeamReceipt(f.scope,{...input(),referenceId:i.referenceId},db)).rejects.toThrow();
 }finally{await f.cleanup();}
});
it('owns exactly one new USD outflow, voids/restores it and rolls back faults',async()=>{
 const f=await teamCashFixture('PAYPAL_ONLY');try{
  const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'}} as unknown as Context);
  const wallet=()=>caller.agentPP.walletBalance({projectId:f.scope.projectId});
  const before=await wallet();
  const i={...input(),collectorId:f.scope.userId,collectorUsdAmount:'110'},r=await saveTeamReceipt(f.scope,i,db);
  expect((await wallet()).walletBalance-before.walletBalance).toBe(-110);
  await voidTeamReceipt(f.scope,{id:r.id,expectedRevision:0,key:randomUUID(),reason:'Wrong entry'},db);
  expect(await db.collectorExpense.count({where:{projectId:f.scope.projectId,voidedAt:null}})).toBe(0);
  expect((await wallet()).walletBalance).toBe(before.walletBalance);
  await restoreTeamReceipt(f.scope,{id:r.id,expectedRevision:1,key:randomUUID(),reason:'Verified transfer'},db);
  expect(await db.collectorExpense.count({where:{projectId:f.scope.projectId,voidedAt:null}})).toBe(1);
  expect((await wallet()).walletBalance-before.walletBalance).toBe(-110);
  await expect(saveTeamReceipt(f.scope,input(),db,{afterWrite:()=>{throw Error('fault');}})).rejects.toThrow('fault');expect(await db.teamReceipt.count({where:{projectId:f.scope.projectId}})).toBe(1);
 }finally{await f.cleanup();}
});
it('global transaction references and source links allow one concurrent claimant',async()=>{
 const f=await teamCashFixture(),other=await teamCashFixture();try{
  const referenceId=randomUUID(),results=await Promise.allSettled([saveTeamReceipt(f.scope,{...input(),referenceId},db),saveTeamReceipt(other.scope,{...input(),referenceId},db)]);
  expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
  const source=await db.collectorExpense.create({data:{projectId:f.scope.projectId,collectorId:f.scope.userId,type:'TEAM_PAYMENT',amount:'110',referenceId:'race'}});
  const attempts=await Promise.allSettled([1,2].map(()=>saveTeamReceipt(f.scope,{...input(),collectorId:f.scope.userId,sourceCollectorExpenseId:source.id},db)));
  expect(attempts.filter(x=>x.status==='fulfilled')).toHaveLength(1);
 }finally{await f.cleanup();await other.cleanup();}
});
