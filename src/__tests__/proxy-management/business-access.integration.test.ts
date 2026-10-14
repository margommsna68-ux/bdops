import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {readOperatingWorkspace,saveOperatingAccount} from '@/server/business-management/accounts';
import {saveFinance} from '@/server/business-management/finance';
import {readFinanceWorkspace} from '@/server/business-management/report';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
afterAll(()=>db.$disconnect());
it('PayPal and withdrawal permissions remain separate from infrastructure and receipts',async()=>{
 const f=await businessFixture();try{
  const pp=await saveOperatingAccount(f.scope,{kind:'PAYPAL',email:randomUUID()+'@fixture.invalid',code:'PP-access',key:randomUUID()},db);
  await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{role:'MODERATOR',allowedModules:['PAYPALS','WITHDRAWALS']}});
  const accounts=await readOperatingWorkspace(f.worker,db);expect(accounts.paypals).toHaveLength(1);expect(accounts.gmails).toHaveLength(0);expect(accounts.vms).toHaveLength(0);
  await saveFinance(f.worker,{kind:'WITHDRAWAL',date:'2026-10-14',currency:'USD',amount:'10.00',paypalId:pp.id,paidToTeam:true,key:randomUUID()},db);
  const finance=await readFinanceWorkspace(f.worker,{start:'2026-10-01',end:'2026-10-31',currency:'USD'},db);expect(finance.withdrawals).toHaveLength(1);expect(finance.funds).toHaveLength(0);expect(finance.report).toBeNull();
  await expect(saveFinance(f.worker,{kind:'FUND',date:'2026-10-14',currency:'USD',amount:'10.00',paypalId:pp.id,transactionId:'forbidden',key:randomUUID()},db)).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();}
});
it('settings require membership and legacy history stays closed after a business mode change',async()=>{
 const f=await businessFixture(),other=await businessFixture();try{
  const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'}} as unknown as Context);
  await expect(caller.project.getSettings({projectId:other.scope.projectId})).rejects.toMatchObject({code:'FORBIDDEN'});
  await saveOperatingAccount(f.scope,{kind:'GMAIL',email:randomUUID()+'@fixture.invalid',key:randomUUID()},db);
  await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'FULL'}}});
  await expect(caller.editHistory.list({projectId:f.scope.projectId})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
 }finally{await f.cleanup();await other.cleanup();}
});
it('creating a business project is explicit and an existing code never grants admin access',async()=>{
 const f=await businessFixture(),other=await businessFixture();let created:string|undefined;try{
  const caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'}} as unknown as Context);
  const existingCode=randomUUID().slice(0,8).toUpperCase();await db.project.update({where:{id:other.scope.projectId},data:{code:existingCode}});
  await expect(caller.project.create({name:'Not mine',code:existingCode})).rejects.toMatchObject({code:'CONFLICT'});
  const p=await caller.project.create({name:'Fixture business',code:randomUUID().slice(0,8),businessMode:'PROXY_VM'});created=p.id;expect(p.settings).toMatchObject({businessMode:'PROXY_VM'});
 }finally{if(created){await db.auditLog.deleteMany({where:{projectId:created}});await db.projectMember.deleteMany({where:{projectId:created}});await db.project.delete({where:{id:created}});}await db.projectMember.deleteMany({where:{projectId:other.scope.projectId,userId:f.scope.userId}});await f.cleanup();await other.cleanup();}
});
