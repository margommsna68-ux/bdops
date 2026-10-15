import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {teamCashFixture,businessDB as db} from './team-cash-fixture';
import {authorizeTeamCash,activateTeamCash} from '@/server/business-management/team-cash-scope';
import {createManagedServer} from '@/server/vm-management/metadata';
import {saveFinance} from '@/server/business-management/finance';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
it('cash-only PayPal access does not grant infrastructure or operator finance writes',async()=>{
 const f=await teamCashFixture('PAYPAL_ONLY');try{
  await expect(authorizeTeamCash(f.scope,'COSTS',true,db)).resolves.toBeDefined();
  await expect(authorizeTeamCash(f.worker,'COSTS',true,db)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(createManagedServer(f.scope,{code:'forbidden',vmCodes:['VM_001']},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(saveFinance(f.scope,{kind:'COST',key:randomUUID(),date:'2026-10-15',amount:'1',currency:'USD'},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
  const key=randomUUID();const first=await activateTeamCash(f.scope,{key},db);expect(await activateTeamCash(f.scope,{key},db)).toMatchObject({id:first.id,replay:true});
  await db.project.update({where:{id:f.scope.projectId},data:{settings:{}}});
  await expect(authorizeTeamCash(f.scope,'WITHDRAWALS',true,db)).resolves.toBeDefined();
  const pp=await db.payPalAccount.create({data:{projectId:f.scope.projectId,code:'cash-only-pp',primaryEmail:'cash@fixture.invalid'}});
  await saveFinance(f.scope,{kind:'FUND',key:randomUUID(),date:'2026-10-15',amount:'1',currency:'USD',paypalId:pp.id,transactionId:'fund-cash-only'},db);
  const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'}} as unknown as Context);
  await expect(caller.paypal.list({projectId:f.scope.projectId})).resolves.toBeDefined();
  expect((await db.project.findUniqueOrThrow({where:{id:f.scope.projectId}})).type).toBe('PAYPAL_ONLY');
  await db.projectMember.delete({where:{userId_projectId:{userId:f.scope.userId,projectId:f.scope.projectId}}});
  await expect(authorizeTeamCash(f.scope,'COSTS',true,db)).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();}
});
