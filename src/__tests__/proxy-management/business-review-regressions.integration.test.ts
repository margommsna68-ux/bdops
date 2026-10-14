import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {saveOperatingAccount} from '@/server/business-management/accounts';
import {saveFinance} from '@/server/business-management/finance';
import {createProfitPeriod,settleProfit} from '@/server/business-management/profit';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
import {decrypt} from '@/lib/encryption';
const caller=(userId:string)=>appRouter.createCaller({prisma:db,session:{user:{id:userId},expires:'2099-01-01'}} as unknown as Context);
afterAll(()=>db.$disconnect());
it('create user rejects global duplicate names without changing password, PIN or role',async()=>{
 const f=await businessFixture(),other=await businessFixture();try{
  const username='review-'+randomUUID().slice(0,8);await db.user.update({where:{id:other.scope.userId},data:{username,password:'unchanged-fixture-hash'}});
  await expect(caller(f.scope.userId).project.createUser({projectId:f.scope.projectId,username,name:'Overwrite',password:'FixtureOnly123!',pin:'111111',role:'USER',allowedModules:[]})).rejects.toMatchObject({code:'CONFLICT'});
  expect((await db.user.findUniqueOrThrow({where:{id:other.scope.userId}})).password).toBe('unchanged-fixture-hash');
 }finally{await db.projectMember.deleteMany({where:{projectId:f.scope.projectId,userId:other.scope.userId}});await f.cleanup();await other.cleanup();}
});
it('moderator creation cannot downgrade an existing admin and reset routes reject foreign/global targets',async()=>{
 const f=await businessFixture(),other=await businessFixture();try{
  const username='admin-'+randomUUID().slice(0,8);await db.user.update({where:{id:f.scope.userId},data:{username}});await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{role:'MODERATOR',canManageUsers:true}});
  await expect(caller(f.worker.userId).project.createUser({projectId:f.scope.projectId,username,name:'Downgrade',password:'FixtureOnly123!',role:'USER',allowedModules:[]})).rejects.toMatchObject({code:'CONFLICT'});
  await expect(caller(f.scope.userId).user.adminResetPin({projectId:f.scope.projectId,userId:other.scope.userId,newPin:'111111'})).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();await other.cleanup();}
});
it('project member DTO never contains password/PIN hashes or invisible other-project memberships',async()=>{
 const f=await businessFixture(),other=await businessFixture();try{
  await db.projectMember.create({data:{projectId:other.scope.projectId,userId:f.scope.userId,role:'USER'}});
  const data=await caller(f.worker.userId).project.getById({projectId:f.scope.projectId}),text=JSON.stringify(data);
  expect(text).not.toMatch(/"password"|"pin"/);expect(text).not.toContain(other.scope.projectId);
 }finally{await db.projectMember.deleteMany({where:{projectId:other.scope.projectId,userId:f.scope.userId}});await f.cleanup();await other.cleanup();}
});
it('agent legacy expense cannot alter a foreign settled business withdrawal',async()=>{
 const f=await businessFixture(),other=await businessFixture();try{
  await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'FULL'}}});
  const pp=await saveOperatingAccount(other.scope,{kind:'PAYPAL',code:'PP-review',email:randomUUID()+'@fixture.invalid',key:randomUUID()},db),wd=await saveFinance(other.scope,{kind:'WITHDRAWAL',date:'2026-10-14',currency:'USD',amount:'10',paypalId:pp.id,paidToTeam:true,key:randomUUID()},db);
  const split=await createProfitPeriod(other.scope,{start:'2026-10-01',end:'2026-10-31',currency:'USD',partners:[{name:'A',percentage:'100'}],key:randomUUID()},db);await settleProfit(other.scope,{id:split.id,expectedRevision:0,key:randomUUID()},db);
  const agentEmail=await db.agentPaypalEmail.create({data:{projectId:other.scope.projectId,userId:f.scope.userId,email:'agent@fixture.invalid'}});await db.withdrawal.update({where:{id:wd.id},data:{agentEmailId:agentEmail.id}});const before=await db.withdrawal.findUniqueOrThrow({where:{id:wd.id}});
  await expect(caller(f.scope.userId).agentPP.createExpense({projectId:f.scope.projectId,type:'TEAM_PAYMENT',amount:10,referenceId:'fixture',linkedWithdrawalIds:[wd.id]})).rejects.toBeDefined();
  await caller(f.scope.userId).agentPP.walletBalance({projectId:f.scope.projectId});expect((await db.withdrawal.findUniqueOrThrow({where:{id:wd.id}})).revision).toBe(before.revision);
  const expense=await db.collectorExpense.create({data:{projectId:f.scope.projectId,collectorId:f.scope.userId,type:'OTHER',amount:1,referenceId:'preexisting-invalid-link',date:new Date()}});await db.withdrawal.update({where:{id:wd.id},data:{expenseId:expense.id}});
  await expect(caller(f.scope.userId).agentPP.deleteExpense({projectId:f.scope.projectId,id:expense.id})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});expect((await db.withdrawal.findUniqueOrThrow({where:{id:wd.id}})).paidToTeam).toBe(true);
 }finally{await db.withdrawal.deleteMany({where:{projectId:other.scope.projectId}});await db.agentPaypalEmail.deleteMany({where:{projectId:other.scope.projectId}});await db.collectorExpense.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();await other.cleanup();}
});
it('infra moderator detail hides finance/history and denies foreign target metadata',async()=>{
 const f=await businessFixture(),other=await businessFixture();try{
  const pp=await saveOperatingAccount(f.scope,{kind:'PAYPAL',code:'PP-review',email:randomUUID()+'@fixture.invalid',key:randomUUID()},db);await saveFinance(f.scope,{kind:'FUND',date:'2026-10-14',currency:'USD',amount:'100',paypalId:pp.id,transactionId:'SECRET-TX',confirmed:true,key:randomUUID()},db);
  await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{role:'MODERATOR'}});
  const data=await caller(f.worker.userId).user.getDetail({projectId:f.scope.projectId,userId:f.worker.userId});expect(data.recentFunds).toEqual([]);expect(data.editHistory).toEqual([]);expect(JSON.stringify(data)).not.toContain('SECRET-TX');
  await expect(caller(f.worker.userId).user.getDetail({projectId:f.scope.projectId,userId:other.scope.userId})).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();await other.cleanup();}
});
it('profit source snapshots include source row IDs and revisions for later tracking',async()=>{
 const f=await businessFixture();try{
  const cost=await saveFinance(f.scope,{kind:'COST',date:'2026-10-14',currency:'USD',amount:'1',key:randomUUID()},db),period=await createProfitPeriod(f.scope,{start:'2026-10-01',end:'2026-10-31',currency:'USD',partners:[{name:'A',percentage:'100'}],key:randomUUID()},db),row=await db.profitSplit.findUniqueOrThrow({where:{id:period.id}}),snapshot=JSON.parse(decrypt(row.sourceSnapshotCipher!));
  expect(snapshot.facts.costs).toEqual([[cost.id,0]]);
 }finally{await f.cleanup();}
});
