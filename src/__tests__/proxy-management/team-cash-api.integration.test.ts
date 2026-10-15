import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {teamCashFixture,businessDB as db} from './team-cash-fixture';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
it('cash APIs enforce fresh role/module and project checks in a PayPal-only project',async()=>{
 const f=await teamCashFixture('PAYPAL_ONLY'),other=await teamCashFixture();
 const caller=(userId:string)=>appRouter.createCaller({prisma:db,session:{user:{id:userId},expires:'2099-01-01'}} as unknown as Context);
 try{
  const admin=caller(f.scope.userId),worker=caller(f.worker.userId),i={projectId:f.scope.projectId,key:randomUUID(),date:'2026-10-15',amount:'5',currency:'USDT',category:'OTHER' as const,treatment:'CASH_COST' as const};
  await expect(admin.businessManagement.cashAccess({projectId:f.scope.projectId})).resolves.toMatchObject({enabled:true,infra:false,writeCosts:true});
  await expect(worker.businessManagement.saveCashCost(i)).rejects.toMatchObject({code:'FORBIDDEN'});
  const saved=await admin.businessManagement.saveCashCost(i);expect(saved.id).toBeTruthy();
  await expect(admin.businessManagement.copyAccount({projectId:f.scope.projectId,kind:'PAYPAL',id:'unknown',pin:'123456'})).rejects.toMatchObject({code:'FORBIDDEN'});
  await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{role:'VIEWER',allowedModules:['COSTS']}});
  await expect(worker.businessManagement.cashCosts({projectId:f.scope.projectId,start:'2026-10-01',end:'2026-10-31'})).resolves.toHaveLength(1);
  await expect(worker.businessManagement.saveCashCost({...i,key:randomUUID()})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(admin.businessManagement.cashReceipts({projectId:other.scope.projectId,start:'2026-10-01',end:'2026-10-31'})).rejects.toMatchObject({code:'FORBIDDEN'});
  const foreign=await db.collectorExpense.create({data:{projectId:other.scope.projectId,collectorId:other.scope.userId,type:'TEAM_PAYMENT',amount:'5',referenceId:'foreign-private'}});
  expect((await admin.agentPP.listExpenses({projectId:f.scope.projectId})).some(x=>x.id===foreign.id)).toBe(false);
  await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{allowedModules:[]}});
  await expect(worker.businessManagement.cashCosts({projectId:f.scope.projectId,start:'2026-10-01',end:'2026-10-31'})).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();await other.cleanup();}
});
