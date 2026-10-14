import {afterAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {businessDB as db,businessFixture} from './business-fixture';
import {saveOperatingAccount,bindVMAccount,readOperatingWorkspace,copyOperatingCredentials,archiveOperatingAccount} from '@/server/business-management/accounts';
import {saveWork,readWorkWorkspace} from '@/server/business-management/work';
import {listOperations} from '@/server/operation-history/journal';
import {undoOperation} from '@/server/operation-history/undo';
import {appRouter} from '@/server/routers/_app';
import type {Context} from '@/server/trpc';
afterAll(()=>db.$disconnect());
it('canonical accounts are masked and VM binding keeps proxy state and has safe history',async()=>{
 const f=await businessFixture();try{
  const pp=await saveOperatingAccount(f.scope,{kind:'PAYPAL',email:randomUUID()+'@fixture.invalid',code:'PP-1',password:'private-fixture-secret',key:randomUUID()},db);
  const gmail=await saveOperatingAccount(f.scope,{kind:'GMAIL',email:randomUUID()+'@fixture.invalid',paypalId:pp.id,password:'private-fixture-secret',key:randomUUID()},db),create=(await listOperations(f.scope,db)).find(o=>o.kind==='BUSINESS_ACCOUNT')!;
  await bindVMAccount(f.worker,{vmId:f.vm.id,gmailId:gmail.id,expectedRevision:0,key:randomUUID()},db);
  const vm=await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}});expect(vm.gmailId).toBe(gmail.id);expect(vm.proxyId).toBeNull();expect(vm.desiredConfigurationId).toBeNull();
  const dto=JSON.stringify(await readOperatingWorkspace(f.worker,db));expect(dto).not.toMatch(/password|twoFa|credentialCipher|private-fixture-secret/);
  await expect(undoOperation(f.scope,create.id,'Account is linked',db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  await expect(archiveOperatingAccount(f.scope,{kind:'GMAIL',id:gmail.id,expectedRevision:(await db.gmailAccount.findUniqueOrThrow({where:{id:gmail.id}})).revision,key:randomUUID()},db)).rejects.toMatchObject({code:'INVALID_INPUT'});
 }finally{await f.cleanup();}
});
it('foreign links, viewer writes and stale account edits never partially change data',async()=>{
 const f=await businessFixture(),other=await businessFixture();try{
  const mail=await saveOperatingAccount(other.scope,{kind:'GMAIL',email:randomUUID()+'@fixture.invalid',key:randomUUID()},db);
  await expect(bindVMAccount(f.scope,{vmId:f.vm.id,gmailId:mail.id,expectedRevision:0,key:randomUUID()},db)).rejects.toMatchObject({code:'NOT_FOUND'});expect((await db.virtualMachine.findUniqueOrThrow({where:{id:f.vm.id}})).gmailId).toBeNull();
  await db.projectMember.update({where:{userId_projectId:{userId:f.worker.userId,projectId:f.scope.projectId}},data:{role:'VIEWER'}});
  await expect(saveOperatingAccount(f.worker,{kind:'GMAIL',email:randomUUID()+'@fixture.invalid',key:randomUUID()},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(saveOperatingAccount(other.scope,{kind:'GMAIL',id:mail.id,email:'changed@fixture.invalid',expectedRevision:99,key:randomUUID()},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
 }finally{await f.cleanup();await other.cleanup();}
});
it('copy requires capability and PIN, failed attempts persist and successful copies are audited',async()=>{
 const f=await businessFixture();try{
  const mail=await saveOperatingAccount(f.scope,{kind:'GMAIL',email:randomUUID()+'@fixture.invalid',password:'private-fixture-secret',twoFa:'totp-fixture',token:'token-fixture',key:randomUUID()},db);
  await expect(copyOperatingCredentials(f.worker,{kind:'GMAIL',id:mail.id,pin:'123456'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(copyOperatingCredentials(f.scope,{kind:'GMAIL',id:mail.id,pin:'wrong'},db)).rejects.toMatchObject({code:'FORBIDDEN'});expect((await db.user.findUniqueOrThrow({where:{id:f.scope.userId}})).pinFailedCount).toBe(1);
  expect(await copyOperatingCredentials(f.scope,{kind:'GMAIL',id:mail.id,pin:'123456'},db)).toMatchObject({secret:'private-fixture-secret',twoFa:'totp-fixture',token:'token-fixture'});expect(await db.auditLog.count({where:{projectId:f.scope.projectId,action:'COPY_OPERATING_ACCOUNT'}})).toBe(1);
  for(let n=0;n<3;n++)await expect(copyOperatingCredentials(f.scope,{kind:'GMAIL',id:mail.id,pin:'wrong'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(copyOperatingCredentials(f.scope,{kind:'GMAIL',id:mail.id,pin:'123456'},db)).rejects.toMatchObject({code:'FORBIDDEN'});
 }finally{await f.cleanup();}
});
it('project tasks validate assignee and VM scope and use optimistic revisions',async()=>{
 const f=await businessFixture(),other=await businessFixture();try{
  await expect(saveWork(f.scope,{title:'Invalid assignee',assigneeId:other.scope.userId,key:randomUUID()},db)).rejects.toMatchObject({code:'NOT_FOUND'});
  const task=await saveWork(f.worker,{title:'Kiểm tra máy',vmId:f.vm.id,assigneeId:f.worker.userId,dueDate:'2026-10-14',key:randomUUID()},db);
  expect((await readWorkWorkspace(f.worker,db)).items[0].dueDate).toBe('2026-10-14');
  await saveWork(f.worker,{id:task.id,title:'Kiểm tra máy',status:'COMPLETED',expectedRevision:0,key:randomUUID()},db);
  await expect(saveWork(f.worker,{id:task.id,title:'Overwrite',status:'PENDING',expectedRevision:0,key:randomUUID()},db)).rejects.toMatchObject({code:'STALE_PREVIEW'});
  expect((await readWorkWorkspace(f.worker,db)).items[0]).toMatchObject({status:'COMPLETED'});expect(await db.vMTask.count({where:{vmId:f.vm.id}})).toBe(0);
 }finally{await f.cleanup();await other.cleanup();}
});
it('legacy account reads, deletion and edit history cannot bypass the new managed account path',async()=>{
 const f=await businessFixture();try{
  const mail=await saveOperatingAccount(f.scope,{kind:'GMAIL',email:randomUUID()+'@fixture.invalid',password:'private-fixture-secret',key:randomUUID()},db),caller=appRouter.createCaller({prisma:db,session:{user:{id:f.scope.userId},expires:'2099-01-01'}} as unknown as Context);
  await expect(caller.gmail.list({projectId:f.scope.projectId})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
  await db.project.update({where:{id:f.scope.projectId},data:{settings:{businessMode:'FULL'}}});
  await expect(caller.gmail.getCredentials({projectId:f.scope.projectId,id:mail.id})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
  await expect(caller.deleteRequest.create({projectId:f.scope.projectId,entity:'GmailAccount',entityId:mail.id})).rejects.toMatchObject({code:'PRECONDITION_FAILED'});
 }finally{await db.deleteRequest.deleteMany({where:{projectId:f.scope.projectId}});await f.cleanup();}
});
